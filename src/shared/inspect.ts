// Chế độ "Soi" của ô Browser: người dùng bình luận thẳng lên một phần tử của trang, app gói ngữ cảnh (URL, selector,
// style, HTML, ảnh cắt vùng, nguồn) rồi gửi cho agent đã chọn; agent trả lời bằng tool MCP inspect_reply, câu trả lời
// hiện thành một tin trong mạch bình luận. Dữ liệu ở `<dự án>/.stag/inspect/index.json`, ảnh ở `.stag/inspect/img/`.
// File này: kiểu dữ liệu + logic thuần (chuyển trạng thái, hàng chờ mỗi agent, gói tin gửi agent) — dùng chung cho main,
// preload của trang và renderer; test bằng vitest.

/** Trạng thái một bình luận (ghim).
 * - draft: chữ gõ dở trong hộp bình luận của một phần tử, chưa gửi (ghim nét đứt "…").
 * - queued: đã gửi, chờ agent (agent đang bận / phiên chưa mở, hoặc đã gõ vào phiên nhưng chưa tới lượt).
 * - working: agent đang sửa mục này.
 * - new: agent đã trả lời, bạn chưa xem (ghim vàng).
 * - read: đã xem câu trả lời (ghim viền teal).
 * - closed: bạn đã đóng (✓); ghim ẩn. */
export type InspectState = 'draft' | 'queued' | 'working' | 'new' | 'read' | 'closed'

/** Có câu trả lời mới chờ bạn xem. */
export const needsYou = (s: InspectState): boolean => s === 'new'
/** Agent đang giữ (đã gửi, chưa trả lời). */
export const withAgent = (s: InspectState): boolean => s === 'queued' || s === 'working'
/** Mạch bình luận đang mở (đã gửi, chưa đóng). */
export const isOpen = (s: InspectState): boolean => s !== 'closed' && s !== 'draft'

/** Khung màn hình của tab (BrowserService vẫn hỗ trợ; giao diện Soi luôn dùng cả ô). */
export type ViewportKind = 'desk' | 'tab' | 'mob'
export const VIEWPORT_WIDTH: Record<Exclude<ViewportKind, 'desk'>, number> = { tab: 820, mob: 390 }
export const VIEWPORT_NAME: Record<ViewportKind, string> = { desk: 'Desktop', tab: 'Tablet', mob: 'Mobile' }

/** Loại nguồn của phần tử (chỉ dùng trong gói tin gửi agent). */
export type SourceChip = 'code' | 'html' | 'wp' | 'el' | 'theme' | 'plugin' | 'none'

export interface InspectSource {
  chip: SourceChip
  /** Dòng ngắn, vd. "src/App.tsx:42" hoặc "Block core/cover · trang Home (#12)". */
  label: string
  /** File trong dự án (tương đối) nếu biết. */
  file?: string
  line?: number
  /** Sửa ở đây ảnh hưởng tới đâu (child / parent theme, revision…), tiếng Việt. */
  effect?: string
  /** Gợi ý cho agent (tiếng Anh): cách sửa đúng chỗ, vd. "WP post 12, block 1.3 (core/button) — edit with WP-CLI". */
  hint?: string
  /** Nguồn thuộc phần tử cha (phần tử này không tự có nguồn). */
  inherited?: boolean
}

/** Các phần tử lặp lại quanh phần tử được chọn. loop = cùng một khuôn sinh ra; similar = giống nhau nhưng tách riêng. */
export interface InspectGroup {
  n: number
  kind: 'loop' | 'similar'
  selector: string
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Gói ngữ cảnh chụp lúc bình luận. Mạch bình luận gắn vào selector / đường dẫn / nguồn, không gắn vào node DOM sống
 * (sửa xong trang tải lại hoặc HMR thay node: lớp Soi dò lại theo các khoá này). */
export interface InspectTarget {
  /** vd. "a.s-cta" */
  tag: string
  /** Vài chữ đầu của phần tử (nhãn ngắn trên trang và trong ngăn Bình luận). */
  label?: string
  /** Selector ổn định (id / data-testid / lớp không băm), duy nhất trên trang lúc chụp. */
  selector: string
  /** Đường dẫn :nth-child từ body (dự phòng khi selector không còn khớp). */
  path: string
  /** Chữ hiển thị rút gọn (để tìm lại + để agent biết là phần nào). */
  text: string
  /** Vị trí trong khung nhìn lúc chụp (px CSS). */
  rect: Rect
  /** Điểm bấm trong phần tử (0..1 theo bề ngang / bề cao): ghim đặt ở đây. */
  pt?: { x: number; y: number }
  scroll: { x: number; y: number }
  viewport: { kind: ViewportKind; w: number; h: number; dpr: number }
  /** Style chính, một dòng. */
  style: string
  /** HTML rút gọn. */
  html: string
  source?: InspectSource
  group?: InspectGroup
}

export interface InspectMsg {
  by: 'user' | 'agent'
  text: string
  /** ISO. */
  at: string
  round: number
  /** Agent: đã đổi gì (file:dòng, lệnh WP-CLI…) — chỉ để gửi lại cho agent ở vòng sau, không hiện. */
  changes?: string
}

export interface InspectPin {
  /** Số thứ tự trong workspace (#N), cũng là id agent dùng trong inspect_reply. */
  id: number
  /** URL trang (không có #). */
  url: string
  title: string
  agentId: string
  agentName: string
  state: InspectState
  /** Trạng thái trước khi đóng (Mở lại trả về đúng chỗ). */
  prev?: InspectState
  /** Vòng trao đổi (1 = bình luận đầu tiên, +1 mỗi lần bạn trả lời). */
  round: number
  target: InspectTarget
  thread: InspectMsg[]
  /** Ảnh vùng phần tử lúc gửi (đường dẫn trong dự án), gửi kèm gói tin. */
  images: { before?: string }
  /** queued: gói tin đã gõ vào phiên agent (agent sẽ làm khi tới lượt). */
  delivered?: boolean
  /** ISO lúc vào hàng (thứ tự trong hàng của agent). */
  queuedAt?: string
  createdAt: string
  updatedAt: string
}

/** Ghim gọn gửi xuống trang (preload) để vẽ và tìm lại phần tử. */
export interface PagePin {
  id: number
  state: InspectState
  selector: string
  path: string
  text: string
  tag: string
  agentId: string
  /** Chữ bình luận đầu tiên (nháp: chữ đang gõ dở). */
  title: string
  pt?: { x: number; y: number }
}

/** Agent chọn được trong hộp bình luận. */
export interface InspectAgent {
  id: string
  name: string
  running: boolean
  /** Đang làm một lượt. */
  busy: boolean
  /** Số bình luận đang chờ / đang sửa của agent này (mọi trang). */
  load: number
}

// ---------- trang (preload lớp Soi) ↔ main ----------

/** Kênh IPC giữa lớp Soi trong trang và main. Main chỉ nhận từ webContents là tab browser của app. */
export const PAGE_IPC = {
  /** invoke(url, title) → PageState */
  hello: 'stag-inspect:hello',
  /** main → trang: PageState */
  state: 'stag-inspect:state',
  /** invoke({ rect, scroll }) → CaptureResult | null: chụp vùng phần tử lúc gửi (lớp Soi đã ẩn). */
  capture: 'stag-inspect:capture',
  /** invoke(SaveInput) → số bình luận */
  save: 'stag-inspect:save',
  /** invoke(id): xoá nháp (đã xoá hết chữ) */
  remove: 'stag-inspect:remove',
  /** send(on): bật / tắt Soi (Esc tắt; bấm ghim nháp khi Soi tắt thì bật) */
  soi: 'stag-inspect:soi',
  /** invoke(url) → { file, tags: StaticTag[] } | null: file HTML tĩnh trong dự án ứng với trang (khớp dòng) */
  staticMap: 'stag-inspect:static-map',
  /** send(id): bấm ghim → mở mạch trong ngăn Bình luận */
  focus: 'stag-inspect:focus',
  /** send(Record<id, PinPlace>): ghim nào tìm thấy trên trang */
  places: 'stag-inspect:places',
  /** send(AnchorUpdate): trang dò lại được phần tử của ghim nhưng khoá cũ đã lệch (sau khi sửa / HMR) → cập nhật khoá */
  anchor: 'stag-inspect:anchor',
  /** main → trang: PageCmd */
  cmd: 'stag-inspect:cmd',
  /** send({ reqId, value }): trả lời PageCmd có reqId */
  res: 'stag-inspect:res'
} as const

export interface PageState {
  on: boolean
  viewport: ViewportKind
  pins: PagePin[]
  agents: InspectAgent[]
  lastAgentId: string | null
}

export type PinPlace = 'ok' | 'hidden' | 'orphan'

export interface AnchorUpdate {
  id: number
  selector: string
  path: string
  text: string
  label: string
}

export type PageCmd =
  /** Cuộn tới phần tử và nháy viền. */
  | { type: 'flash'; id: number }
  /** Rê chuột lên mạch trong ngăn: viền phần tử (null = bỏ). */
  | { type: 'peek'; id: number | null }
  /** Agent vừa sửa: tải lại trang (chờ hộp bình luận đang mở đóng lại). */
  | { type: 'reload' }
  /** Đọc lại style / HTML hiện tại của phần tử (gói tin vòng sau): { style, html, text } | null. */
  | { type: 'resnap'; reqId: string; id: number }

export interface CaptureResult {
  captureId: string
}

export interface SaveInput {
  /** Nháp có sẵn của phần tử này. */
  pinId?: number
  captureId?: string
  /** Bắt buộc khi tạo mới; nháp có sẵn thì gửi kèm để chụp lại ngữ cảnh. */
  target?: InspectTarget
  url: string
  title: string
  text: string
  agentId: string
  /** true = gửi; false = lưu nháp. */
  send: boolean
}

/** Việc người dùng làm từ ngăn Bình luận / thanh Browser (renderer → main). */
export type InspectAction =
  | { type: 'toggle'; tabId: string; on?: boolean }
  | { type: 'reply'; id: number; text: string }
  /** Đã xem câu trả lời mới. */
  | { type: 'read'; id: number }
  | { type: 'close'; id: number }
  | { type: 'reopen'; id: number }
  /** Bấm mạch: cuộn tới phần tử. */
  | { type: 'focus'; tabId: string; id: number }
  /** Rê chuột lên mạch: viền phần tử (id null = bỏ). */
  | { type: 'peek'; tabId: string; id: number | null }

export type InspectActionResult = Record<string, never>

/** Cách tìm nguồn cần cài vào dự án (dialog "Tìm nguồn"). */
export type SourceKind = 'vite' | 'next' | 'wordpress'

export interface SourceSetup {
  /** File cấu hình (tương đối dự án); installed = đã chép plugin vào `.stag/inspect/`. */
  vite: { config: string; installed: boolean } | null
  next: { config: string; installed: boolean } | null
  /** wp-content (tương đối dự án); installed = có mu-plugins/stag-inspect.php. */
  wordpress: { wpContent: string; installed: boolean } | null
}

export interface InspectSnapshot {
  pins: InspectPin[]
  /** Theo tab: ghim nào tìm thấy / bị ẩn / không còn trên trang. */
  places: Record<string, Record<number, PinPlace>>
}

/** Bỏ phần # của URL; URL hỏng giữ nguyên. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href
  } catch {
    return url.split('#')[0]
  }
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Nhãn ngắn của phần tử: tên thẻ + vài chữ đầu (không có chữ thì lớp đầu tiên). */
export function elementLabel(t: Pick<InspectTarget, 'tag' | 'text' | 'label'>): { t: string; txt: string } {
  const [name, ...rest] = t.tag.split(/(?=[.#])/)
  const txt = t.label ?? clip(t.text, 22)
  return { t: name || t.tag, txt: txt || (rest.find((x) => x.startsWith('.')) ?? '') }
}

/** Màu riêng của agent (cùng bảng màu với tab Sản phẩm — artifacts/ui.tsx `productColor`): theo tên nên luôn một màu. */
const PALETTE = ['#9aa7ff', '#c79bff', '#ff8fb4', '#e3b38a', '#d6a6d0', '#a9b7c9', '#b8c4ff', '#e7a3a3']
export function agentColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function toPagePin(p: InspectPin): PagePin {
  return {
    id: p.id,
    state: p.state,
    selector: p.target.selector,
    path: p.target.path,
    text: p.target.text,
    tag: p.target.tag,
    agentId: p.agentId,
    title: firstUserText(p),
    ...(p.target.pt ? { pt: p.target.pt } : {})
  }
}

export function firstUserText(p: InspectPin): string {
  return p.thread.find((m) => m.by === 'user')?.text ?? ''
}

/**
 * Dữ liệu ghi bởi bản Soi cũ (review / ask / failed / done, tin hệ thống, phạm vi, hoàn tác): đổi sang mô hình chỉ còn
 * bình luận. Đã có câu trả lời → coi như đã xem; xong → đã đóng.
 */
export function normalizePin(raw: InspectPin): InspectPin {
  const p = raw as InspectPin & { state: string; prev?: string; scope?: unknown; request?: unknown; reverted?: unknown }
  const map = (s: string | undefined): InspectState | undefined =>
    s === 'review' || s === 'ask' || s === 'failed' ? 'read' : s === 'done' ? 'closed' : (s as InspectState | undefined)
  const state = map(p.state) ?? 'closed'
  const prev = map(p.prev)
  const thread = (p.thread ?? []).filter((m) => (m.by as string) !== 'sys').map(({ by, text, at, round, changes }) => ({ by, text, at, round, ...(changes ? { changes } : {}) }))
  const { scope: _s, request: _r, reverted: _v, prev: _p, ...rest } = p
  return {
    ...rest,
    state,
    ...(prev && prev !== 'closed' ? { prev } : {}),
    thread,
    images: p.images?.before ? { before: p.images.before } : {}
  }
}

/** Thứ tự trong hàng của agent (1 = tới lượt tiếp theo), 0 nếu không đang chờ. */
export function queuePosition(pins: InspectPin[], pin: InspectPin): number {
  if (pin.state !== 'queued') return 0
  const q = pins.filter((p) => p.agentId === pin.agentId && p.state === 'queued').sort(byQueue)
  return q.indexOf(pin) + 1
}

function byQueue(a: InspectPin, b: InspectPin): number {
  return (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '') || a.id - b.id
}

/** Mạch trong ngăn Bình luận: mới nhất trước. */
export function sortForList(pins: InspectPin[]): InspectPin[] {
  return [...pins].sort((a, b) => b.id - a.id)
}

const now = (): string => new Date().toISOString()

/** Gửi (lần đầu, trả lời, mở lại khi agent chưa kịp trả lời): vào hàng của agent. `text` = lời trả lời mới. */
export function enqueue(p: InspectPin, at = now(), text?: string): void {
  if (text !== undefined) {
    p.round++
    p.thread.push({ by: 'user', text, at, round: p.round })
  }
  p.state = 'queued'
  p.delivered = false
  p.queuedAt = at
  p.updatedAt = at
}

export interface ReplyInput {
  id: number
  text: string
  changes?: string
  /** Agent hỏi lại / không làm được: vẫn chỉ hiện như một tin trả lời. */
  ask?: boolean
  quick?: string[]
  failed?: boolean
}

/**
 * Agent trả lời (inspect_reply): thêm tin vào mạch, mạch thành "có trả lời mới". Mạch bạn đã đóng thì giữ đóng (tin vẫn
 * lưu). Bạn đã trả lời tiếp mà gói mới chưa gõ vào phiên: giữ trong hàng để gói đó vẫn được gửi.
 * Lỗi (tiếng Anh, agent đọc) nếu mục không phải của agent / chưa gửi.
 */
export function applyReply(p: InspectPin, input: ReplyInput, agentId: string, at = now()): InspectState {
  if (p.agentId !== agentId) throw new Error(`Comment #${p.id} was sent to ${p.agentName}, not to you.`)
  if (p.state === 'draft') throw new Error(`Comment #${p.id} has not been sent to you.`)
  p.thread.push({ by: 'agent', text: input.text, at, round: p.round, ...(input.changes ? { changes: input.changes } : {}) })
  p.updatedAt = at
  if (p.state === 'closed' || (p.state === 'queued' && !p.delivered)) return p.state
  p.state = 'new'
  p.delivered = false
  delete p.queuedAt
  return p.state
}

/** Đã gõ gói tin vào phiên agent: mục đầu tiên chưa có agent nào làm → đang sửa, còn lại chờ tới lượt. */
export function markDelivered(all: InspectPin[], agentId: string, ids: number[]): void {
  const set = new Set(ids)
  for (const p of all) if (set.has(p.id) && p.state === 'queued') p.delivered = true
  promoteNext(all, agentId)
}

/** Agent không còn mục đang sửa → mục đã gõ vào phiên tiếp theo trong hàng thành đang sửa. */
export function promoteNext(all: InspectPin[], agentId: string): InspectPin | null {
  if (all.some((p) => p.agentId === agentId && p.state === 'working')) return null
  const next = all.filter((p) => p.agentId === agentId && p.state === 'queued' && p.delivered).sort(byQueue)[0]
  if (!next) return null
  next.state = 'working'
  next.updatedAt = now()
  return next
}

/** Bạn đóng mạch (✓): ra khỏi hàng chờ của agent; câu trả lời đến sau không mở lại mạch. */
export function close(p: InspectPin, at = now()): void {
  if (!isOpen(p.state)) return
  p.prev = p.state
  p.state = 'closed'
  p.delivered = false
  delete p.queuedAt
  p.updatedAt = at
}

/** Mở lại: agent chưa kịp trả lời tin cuối của bạn → gửi lại (trả về true = vào hàng); có rồi → đã xem. */
export function reopen(p: InspectPin, at = now()): boolean {
  if (p.state !== 'closed') return false
  delete p.prev
  if (p.thread.at(-1)?.by === 'user') {
    enqueue(p, at)
    return true
  }
  p.state = 'read'
  p.updatedAt = at
  return false
}

/** Bạn đã xem câu trả lời mới. */
export function markRead(p: InspectPin, at = now()): boolean {
  if (p.state !== 'new') return false
  p.state = 'read'
  p.updatedAt = at
  return true
}

// ---------- gói tin gửi agent (tiếng Anh; lời người dùng giữ nguyên) ----------

/** Một mục trong gói tin. */
export function packetItem(p: InspectPin): string {
  const t = p.target
  const v = t.viewport
  const lines: string[] = []
  const lastUser = [...p.thread].reverse().find((m) => m.by === 'user')
  lines.push(`#${p.id} "${lastUser?.text ?? ''}"`)
  lines.push(`  page: ${p.url}${p.title ? ` — "${clip(p.title, 80)}"` : ''}`)
  lines.push(`  element: ${t.tag}${t.text ? ` — text "${clip(t.text, 80)}"` : ''}`)
  lines.push(`  selector: ${t.selector}`)
  lines.push(`  path: ${t.path}`)
  const s = t.source
  if (s && s.chip !== 'none') {
    lines.push(`  source: ${s.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : s.label}${s.inherited ? ' (of a parent element)' : ''}${s.file && s.label !== s.file && !s.label.startsWith(s.file) ? ` — ${s.label}` : ''}`)
    if (s.hint) lines.push(`  how to edit: ${s.hint}`)
  } else lines.push('  source: unknown — find it from the selector / HTML / text')
  if (t.group)
    lines.push(
      `  scope: only this element (it is 1 of ${t.group.n} ${t.group.kind === 'loop' ? 'items from the same template — change only this one unless the user says all' : 'similar but separate widgets'}; ${t.group.selector})`
    )
  lines.push(`  viewport: ${VIEWPORT_NAME[v.kind]} ${v.w}×${v.h} (element ${Math.round(t.rect.w)}×${Math.round(t.rect.h)} at x ${Math.round(t.rect.x)}, y ${Math.round(t.rect.y)})`)
  lines.push(`  style: ${t.style}`)
  lines.push(`  html: ${t.html}`)
  if (p.images.before) lines.push(`  screenshot when commented: ${p.images.before}`)
  if (p.round > 1) {
    lines.push('  history:')
    for (const m of p.thread.slice(0, -1)) {
      const who = m.by === 'user' ? 'user' : 'you'
      lines.push(`    round ${m.round} ${who}: "${clip(m.text, 200)}"${m.changes ? ` (changes: ${clip(m.changes, 200)})` : ''}`)
    }
    lines.push(`  now (round ${p.round}) the user says: "${lastUser?.text ?? ''}"`)
  }
  return lines.join('\n')
}

/** Gói tin gõ vào phiên agent cho các mục `pins` (theo thứ tự hàng chờ). */
export function packetMessage(pins: InspectPin[]): string {
  const n = pins.length
  const head = `[stag.ai] ${n === 1 ? 'A comment' : `${n} comments`} from the user on a web page (stag.ai Browser, "Soi" mode). Work on them in this order:`
  const how = [
    'For each one, when you are done call inspect_reply(id, text: one sentence in the conversation language saying what you changed, changes: "file:line — short summary" or the WP-CLI command). The user sees your text as a reply in the comment thread; stag.ai reloads the page.',
    'Unclear request → inspect_reply(id, text: your question) and wait for their answer. Cannot do it (file locked, element not found, tool error) → inspect_reply(id, text: why, failed: true).',
    'Edit the source, never the live DOM. Never edit a production site. WordPress: edit the child theme (copy a parent-theme file into the child theme first), or use WP-CLI on the local copy; purge caches after an edit. Do not edit outside your task scope without asking.'
  ]
  return [head, '', ...pins.map((p) => packetItem(p)).flatMap((b) => [b, '']), ...how].join('\n')
}

/** Dòng hiển thị trong ô chat khi gõ gói tin. */
export function packetDisplay(ids: number[]): string {
  return ids.length === 1 ? `Bình luận #${ids[0]} từ chế độ Soi` : `${ids.length} bình luận từ chế độ Soi (${ids.map((i) => `#${i}`).join(', ')})`
}
