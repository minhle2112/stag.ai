// Logic thuần của ô chat (không DOM, không window): áp sự kiện vào danh sách, gom khối, định dạng số liệu, phím gửi,
// lịch sử ↑, kiểm tra ảnh dán. Tách riêng để vitest chạy trong Node.
import type { ChatBlock, ChatEvent, ChatImage, ChatItem, ChatState } from '@shared/chat'
import { fmtNumber, fmtTime, t as tr, type PlainKey } from '@shared/i18n'

type AskItem = Extract<ChatItem, { kind: 'ask' }>
type ToolBlock = Extract<ChatBlock, { type: 'tool' }>

// ---------- danh sách + sự kiện ----------

export const EMPTY_ITEMS: ChatItem[] = []
export const OFF_STATE: ChatState = { phase: 'off' }

/** Dữ liệu ô chat của một agent trong store. */
export interface ChatSlice {
  items: ChatItem[]
  state: ChatState
  /** Đã có snapshot / reset từ main (trước đó sự kiện lẻ bị bỏ qua vì snapshot sẽ phủ lên). */
  loaded: boolean
  /** Tin đã gửi lúc Claude đang bận, chưa thấy main phát lại dưới dạng mục `user` (chip "đang xếp hàng"). */
  queued: string[]
  /** Lỗi gửi gần nhất (hiện trên composer, xoá khi gửi lại). */
  error?: string
}

export const emptySlice = (): ChatSlice => ({ items: EMPTY_ITEMS, state: OFF_STATE, loaded: false, queued: [] })

/** Thêm mục mới hoặc thay mục cùng `id`; chỉ mục đổi mới có tham chiếu mới (để React.memo bỏ qua phần còn lại). */
export function upsertItem(items: ChatItem[], item: ChatItem): ChatItem[] {
  // Stream gửi lại đúng mục cuối: tìm từ cuối lên.
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].id === item.id) {
      const next = items.slice()
      next[i] = item
      return next
    }
  }
  return [...items, item]
}

/** Giữ lại ở `queued` những tin chưa được main phát lại (so theo nội dung, mỗi mục `user` khớp một tin). */
export function dropQueued(queued: string[], echoed: string): string[] {
  const i = queued.indexOf(echoed.trim())
  if (i < 0) return queued
  return queued.filter((_, j) => j !== i)
}

/** Áp một sự kiện main → renderer lên map theo agent. Trả về chính `map` nếu không có gì đổi. */
export function applyEvent(map: Record<string, ChatSlice>, ev: ChatEvent): Record<string, ChatSlice> {
  const cur = map[ev.agentId]
  if (ev.type === 'reset') {
    return { ...map, [ev.agentId]: { ...(cur ?? emptySlice()), items: ev.items, state: ev.state, loaded: true, queued: [] } }
  }
  // Chưa nạp snapshot: sự kiện lẻ đã nằm trong snapshot sắp tới (IPC giữ thứ tự), bỏ qua.
  if (!cur?.loaded) return map
  if (ev.type === 'upsert') {
    const queued = ev.item.kind === 'user' && ev.item.origin === 'user' ? dropQueued(cur.queued, ev.item.text) : cur.queued
    return { ...map, [ev.agentId]: { ...cur, items: upsertItem(cur.items, ev.item), queued } }
  }
  // Hết bận (rảnh / đã dừng) thì không còn tin nào xếp hàng.
  const idle = ev.state.phase === 'idle' || ev.state.phase === 'off'
  return { ...map, [ev.agentId]: { ...cur, state: ev.state, queued: idle && cur.queued.length ? [] : cur.queued } }
}

/** So sánh sâu hai giá trị JSON (tham số tool, kết quả structured clone: mỗi lần gửi lại là đối tượng mới). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Tool mà thẻ xin quyền KHÔNG trả lời bằng phím Enter (cần người dùng chọn / duyệt có chủ ý). */
export const CHOICE_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Đang bận mà chưa có gì đang chạy hiện ra: cần dòng "đang làm…" cuối danh sách. */
export function showWorking(items: ChatItem[], phase: string): boolean {
  if (phase !== 'busy') return false
  const last = items[items.length - 1]
  if (!last) return true
  if (last.kind === 'ask') return false
  if (last.kind !== 'assistant') return true
  if (last.streaming) return false
  const tail = last.blocks[last.blocks.length - 1]
  return !(tail && tail.type === 'tool' && tail.state === 'running')
}

/** Thẻ xin quyền đang chờ, cũ nhất trước (phím tắt Enter / Esc trả lời thẻ này). */
export function firstPendingAsk(items: ChatItem[]): AskItem | undefined {
  for (const it of items) if (it.kind === 'ask' && it.state === 'pending') return it
  return undefined
}

// ---------- dòng hiển thị (giao diện "Hội thoại") ----------

type TurnItemT = Extract<ChatItem, { kind: 'turn' }>

/** Một mục trong khối "Đã làm N bước": tool, suy nghĩ, hoặc thẻ xin quyền đã trả lời. */
export type StepEntry =
  | { type: 'tool'; key: string; block: ToolBlock }
  | { type: 'thinking'; key: string; text: string; active: boolean }
  | { type: 'ask'; key: string; item: AskItem }

/**
 * Dòng của danh sách hội thoại sau khi gom: tool + suy nghĩ liên tiếp trong một lượt (kể cả qua nhiều tin assistant
 * và thẻ xin quyền đã trả lời) thành một khối `steps`; cuối lượt là thẻ file đã sửa (`files`) và dòng `meta`.
 */
export type ViewRow =
  | { type: 'user'; key: string; item: Extract<ChatItem, { kind: 'user' }> }
  | { type: 'notice'; key: string; item: Extract<ChatItem, { kind: 'notice' }> }
  | { type: 'ask'; key: string; item: AskItem }
  | { type: 'text'; key: string; text: string; caret: boolean }
  /** Tin assistant đang stream mà chưa có khối nào. */
  | { type: 'answering'; key: string }
  | { type: 'steps'; key: string; entries: StepEntry[] }
  /** Tool sửa / ghi file đã chạy xong trong lượt (thứ tự gọi). */
  | { type: 'files'; key: string; tools: ToolBlock[] }
  /** Cuối lượt: số liệu (null = lượt chưa có mục `turn`, vd. phiên dừng giữa chừng) + chữ trả lời để chép. */
  | { type: 'meta'; key: string; turn: TurnItemT | null; copyText: string }

/** Tool có ghi file (thẻ file cuối lượt). */
export const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'ApplyPatch'])

/** `phase` đang chạy lượt (lượt cuối chưa đóng). */
function turnOpen(phase: string): boolean {
  return phase === 'busy' || phase === 'waiting' || phase === 'starting'
}

export function buildRows(items: ChatItem[], phase: string): ViewRow[] {
  const rows: ViewRow[] = []
  let steps: Extract<ViewRow, { type: 'steps' }> | null = null
  // Số liệu của lượt đang gom.
  let files: ToolBlock[] = []
  let texts: string[] = []
  let hasAssistant = false
  // Tool đang chờ người dùng duyệt: thẻ xin quyền đã hiện lệnh / diff, không lặp lại thành "Đang chạy…" trong khối bước.
  const asking = new Set<string>()
  for (const it of items) if (it.kind === 'ask' && it.state === 'pending' && it.toolUseId) asking.add(it.toolUseId)

  const closeSteps = (): void => {
    steps = null
  }
  const addEntry = (e: StepEntry): void => {
    if (!steps) {
      steps = { type: 'steps', key: `s:${e.key}`, entries: [] }
      rows.push(steps)
    }
    steps.entries.push(e)
  }
  const endTurn = (turn: TurnItemT | null, key: string): void => {
    closeSteps()
    if (files.length) rows.push({ type: 'files', key: `f:${key}`, tools: files })
    if (turn || (hasAssistant && texts.length)) rows.push({ type: 'meta', key: `m:${key}`, turn, copyText: texts.join('\n\n') })
    files = []
    texts = []
    hasAssistant = false
  }

  for (const it of items) {
    switch (it.kind) {
      case 'user':
        // Tin mới mà lượt trước chưa có mục `turn` (lịch sử cắt ngang): đóng lượt đó lại.
        if (hasAssistant) endTurn(null, it.id)
        closeSteps()
        rows.push({ type: 'user', key: it.id, item: it })
        break
      case 'notice':
        closeSteps()
        rows.push({ type: 'notice', key: it.id, item: it })
        break
      case 'ask':
        if (it.state === 'pending') {
          closeSteps()
          rows.push({ type: 'ask', key: it.id, item: it })
        } else addEntry({ type: 'ask', key: it.id, item: it })
        break
      case 'turn':
        endTurn(it, it.id)
        break
      case 'assistant': {
        hasAssistant = true
        if (!it.blocks.length) {
          if (it.streaming) {
            closeSteps()
            rows.push({ type: 'answering', key: `${it.id}:a` })
          }
          break
        }
        const lastIdx = it.blocks.length - 1
        it.blocks.forEach((b, i) => {
          const key = `${it.id}:${i}`
          const live = !!it.streaming && i === lastIdx
          if (b.type === 'text') {
            // Chữ rỗng (đang mở khối) không cắt khối bước.
            if (!b.text.trim()) return
            closeSteps()
            texts.push(b.text.trim())
            rows.push({ type: 'text', key, text: b.text, caret: live })
          } else if (b.type === 'thinking') {
            if (!b.text.trim() && !live) return
            addEntry({ type: 'thinking', key, text: b.text, active: live })
          } else {
            if (b.state === 'running' && asking.has(b.toolUseId)) return
            addEntry({ type: 'tool', key: b.toolUseId || key, block: b })
            if (b.state === 'ok' && FILE_TOOLS.has(b.name)) files.push(b)
          }
        })
        break
      }
    }
  }
  // Lượt cuối chưa đóng: còn chạy thì chưa hiện thẻ file / meta; đã dừng (rảnh / tắt) thì hiện.
  if (hasAssistant && !turnOpen(phase)) endTurn(null, 'end')
  return rows
}

/** Tóm tắt khối bước (lúc không chạy): "Đã làm 4 bước · có suy nghĩ", chip tên tool, số bước lỗi. */
export function stepsSummary(entries: StepEntry[]): { label: string; chips: string[]; failed: number; running: ToolBlock | null } {
  let tools = 0
  let thinking = false
  let failed = 0
  let asks = 0
  let running: ToolBlock | null = null
  const chips: string[] = []
  for (const e of entries) {
    if (e.type === 'thinking') thinking = true
    else if (e.type === 'ask') asks++
    else {
      tools++
      if (e.block.state === 'error' || e.block.state === 'denied') failed++
      if (e.block.state === 'running' && !running) running = e.block
      const m = /^mcp__.+?__(.+)$/.exec(e.block.name)
      const chip = m ? m[1] : e.block.name
      if (!chips.includes(chip)) chips.push(chip)
    }
  }
  let label: string
  if (tools) label = `${tr('chat.steps.done', { count: tools })}${thinking ? tr('chat.steps.withThinking') : ''}`
  else if (thinking) label = tr('chat.steps.thinking')
  else label = tr('chat.steps.asks', { count: asks })
  return { label, chips, failed, running }
}

/** Đang chạy: có tool chưa xong hoặc đang stream suy nghĩ. */
export function stepsActive(entries: StepEntry[]): boolean {
  return entries.some((e) => (e.type === 'tool' && e.block.state === 'running') || (e.type === 'thinking' && e.active))
}

// ---------- số liệu ----------

/** "claude-opus-4-5-20251101" → "Opus 4.5"; "claude-sonnet-4-5[1m]" → "Sonnet 4.5 · 1M"; lạ thì giữ nguyên (rút gọn). */
export function shortModel(model: string | undefined): string {
  if (!model) return ''
  const raw = model.trim()
  const ctx = /\[(\d+)m\]/i.exec(raw)
  let s = raw.toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/^claude[-_]/, '').replace(/[-_]\d{8}$/, '')
  const fam = /(opus|sonnet|haiku)/.exec(s)
  if (fam) {
    // Phiên bản đứng sau họ ("opus-4-5") hoặc trước ("3-5-sonnet").
    const after = s.slice(s.indexOf(fam[1]) + fam[1].length)
    const before = s.slice(0, s.indexOf(fam[1]))
    const num = (t: string): string | null => {
      const m = /(\d+)(?:[-_.](\d+))?/.exec(t)
      return m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]) : null
    }
    const v = num(after) ?? num(before)
    const name = fam[1][0].toUpperCase() + fam[1].slice(1)
    return `${name}${v ? ` ${v}` : ''}${ctx ? ` · ${ctx[1]}M` : ''}`
  }
  s = raw.replace(/^claude[-_]/i, '')
  return s.length > 22 ? `${s.slice(0, 21)}…` : s
}

/** 840 → "<1s", 12_300 → "12s", 102_000 → "1m 42s", 3_900_000 → "1h 05m". */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return ''
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** 0.0312 → "$0,03", 0.004 → "<$0,01" (dấu phẩy thập phân kiểu Việt). */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !(usd > 0)) return ''
  const money = (n: number): string => fmtNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
  return usd < 0.01 ? `<$${money(0.01)}` : `$${money(usd)}`
}

const OUTCOME_LABEL: Record<string, PlainKey> = {
  interrupted: 'chat.outcome.interrupted',
  error_max_turns: 'chat.outcome.maxTurns',
  error_during_execution: 'chat.outcome.execError'
}

/** Dòng số liệu cuối lượt: "1m 42s · $0,21"; lượt không thành công thì có nhãn đầu ("đã ngắt · 3s"). null = không có gì. */
export function turnLine(t: { durationMs: number; costUsd?: number; outcome: string }): string | null {
  const parts: string[] = []
  if (t.outcome !== 'success') parts.push(OUTCOME_LABEL[t.outcome] ? tr(OUTCOME_LABEL[t.outcome]) : t.outcome.replace(/^error_/, '').replace(/_/g, ' '))
  const d = formatDuration(t.durationMs)
  const c = formatCost(t.costUsd)
  if (d) parts.push(d)
  if (c) parts.push(c)
  return parts.length ? parts.join(' · ') : null
}

export type CtxTone = 'normal' | 'warn' | 'full'

export interface CtxInfo {
  /** 0..100, null = chưa biết kích thước cửa sổ. */
  pct: number | null
  text: string
  tone: CtxTone
  title: string
}

export const DEFAULT_CTX_LIMIT = 85

/** 85382 → "85k". (Bản gọn của status.formatTokens, để file này không kéo theo module khác.) */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** Số hiện ở composer: "ctx 42%"; đỏ khi ≥ ngưỡng (bàn giao tự động nếu bật, không thì 85%), hổ phách chưa tới 10 điểm. */
export function ctxInfo(used: number | undefined, size: number | undefined, limit: number): CtxInfo | null {
  if (used === undefined || !(used >= 0)) return null
  if (!size) return { pct: null, text: tokens(used), tone: 'normal', title: tr('chat.ctx.titleUsed', { used: fmtNumber(used) }) }
  const pct = Math.min(100, (used / size) * 100)
  const tone: CtxTone = pct >= limit ? 'full' : pct >= limit - 10 ? 'warn' : 'normal'
  return {
    pct,
    text: `${Math.floor(pct)}%`,
    tone,
    title: tr('chat.ctx.title', {
      used: fmtNumber(used),
      size: tokens(size),
      pct: fmtNumber(pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    })
  }
}

/** "5h 25%"; tooltip kèm giờ làm mới. `now` để test. */
export function quotaLabel(
  w: { utilization: number; resetsAt: number } | undefined,
  name: string,
  now = Date.now()
): { text: string; title: string; pct: number } | null {
  if (!w || !(w.utilization >= 0)) return null
  const pct = Math.round(w.utilization * 100)
  const left = Math.max(0, w.resetsAt * 1000 - now)
  const h = Math.floor(left / 3_600_000)
  const m = Math.round((left % 3_600_000) / 60_000)
  const hhmm = fmtTime(w.resetsAt * 1000)
  const when =
    left <= 0
      ? tr('chat.quota.reset')
      : h >= 48
        ? tr('chat.quota.inDays', { count: Math.round(h / 24) })
        : h > 0
          ? tr('chat.quota.inHm', { h, m })
          : tr('chat.quota.inM', { count: m })
  return { text: `${name} ${pct}%`, title: tr('chat.quota.title', { name, pct, when, time: hhmm }), pct }
}

// ---------- composer ----------

export interface KeyLike {
  key: string
  shiftKey: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  /** KeyboardEvent.isComposing (đang gõ IME). */
  isComposing?: boolean
  keyCode?: number
}

/** Đang gõ IME (Telex): Enter lúc này chỉ chốt chữ, không phải gửi. keyCode 229 = "đang xử lý bởi IME". */
export function isImeKey(k: Pick<KeyLike, 'isComposing' | 'keyCode'>): boolean {
  return !!k.isComposing || k.keyCode === 229
}

/** Enter gửi, Shift+Enter xuống dòng, không bao giờ gửi giữa lúc gõ IME. */
export function shouldSubmit(k: KeyLike): boolean {
  return k.key === 'Enter' && !k.shiftKey && !isImeKey(k)
}

export const HISTORY_MAX = 50

/** Đẩy một tin vào lịch sử ↑ (bỏ trùng liền kề, giữ tối đa HISTORY_MAX tin gần nhất). */
export function pushHistory(history: string[], text: string): string[] {
  const t = text.trim()
  if (!t || history[history.length - 1] === t) return history
  const next = [...history, t]
  return next.length > HISTORY_MAX ? next.slice(next.length - HISTORY_MAX) : next
}

/**
 * Duyệt lịch sử bằng ↑ / ↓. `index` = vị trí đang xem (null = đang ở bản nháp). Trả về vị trí mới và chữ cần hiện
 * (`null` text = không đổi). Xuống quá cuối thì về bản nháp (`draft`).
 */
export function historyStep(
  history: string[],
  index: number | null,
  dir: 'up' | 'down',
  draft: string
): { index: number | null; text: string | null } {
  if (!history.length) return { index, text: null }
  if (dir === 'up') {
    const i = index === null ? history.length - 1 : Math.max(0, index - 1)
    return { index: i, text: history[i] }
  }
  if (index === null) return { index, text: null }
  if (index >= history.length - 1) return { index: null, text: draft }
  return { index: index + 1, text: history[index + 1] }
}

export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export type ImageCheck = { ok: true } | { ok: false; reason: string }

/** Kiểm một ảnh dán vào: loại, dung lượng, và số ảnh đã có. */
export function checkImage(file: { type: string; size: number }, already: number): ImageCheck {
  if (already >= MAX_IMAGES) return { ok: false, reason: tr('chat.image.tooMany', { count: MAX_IMAGES }) }
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: tr('chat.image.badType') }
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, reason: tr('chat.image.tooBig', { size: MAX_IMAGE_BYTES / 1024 / 1024 }) }
  return { ok: true }
}

/** "data:image/png;base64,AAAA" → ChatImage (không còn tiền tố data:). */
export function dataUrlToImage(url: string): ChatImage | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return m ? { mediaType: m[1], data: m[2] } : null
}

/** Ghép chữ giọng nói vào ô: tách bằng một khoảng trắng nếu đã có chữ và chưa kết thúc bằng khoảng trắng. */
export function appendText(cur: string, add: string): string {
  if (!add) return cur
  if (!cur || /\s$/.test(cur) || /^\s/.test(add)) return cur + add
  return `${cur} ${add}`
}

// ---------- cỡ chữ ----------

/**
 * Cỡ chữ terminal mà ô chat vẽ đúng 1:1 (px). Nhỏ hơn cỡ mặc định 13 một chút để ô chat mặc định to hơn terminal
 * (13 / 12 ≈ 1,08: chữ thường 13px → ~14px).
 */
export const CHAT_BASE_FONT = 12
const DEFAULT_TERMINAL_FONT = 13

/** Hệ số phóng của ô chat theo cỡ chữ terminal trong Cài đặt (lạ / thiếu = theo cỡ mặc định 13px). */
export function chatZoom(fontSize: number | undefined): number {
  const size = fontSize && Number.isFinite(fontSize) && fontSize > 0 ? fontSize : DEFAULT_TERMINAL_FONT
  return Math.round((size / CHAT_BASE_FONT) * 1000) / 1000
}

// ---------- cuộn ----------

/** Cách đáy ≤ `slack` px thì coi là đang ở đáy (tự cuộn theo nội dung mới). */
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = 40): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack
}

/** `@chữ` ngay trước con trỏ (đầu dòng hoặc sau khoảng trắng, không có khoảng trắng sau @ — email không bật bảng). */
export function atQuery(value: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(value.slice(0, caret))
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null
}
