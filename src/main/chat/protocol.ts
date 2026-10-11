// Mô hình hội thoại của ô chat: biến từng dòng stdout của `claude -p --output-format stream-json
// --include-partial-messages` thành danh sách `ChatItem` + `ChatState` (shared/chat.ts). Thuần dữ liệu, không I/O,
// để thử bằng chuỗi sự kiện thật (xem protocol.test.ts).
import { CHAT_OUTPUT_MAX, type ChatBlock, type ChatItem, type ChatState } from '@shared/chat'

/** Giữ tối đa chừng này mục trong bộ nhớ; vượt thì bỏ TRIM_ITEMS mục cũ nhất. */
const MAX_ITEMS = 1500
const TRIM_ITEMS = 300

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>
type AskItem = Extract<ChatItem, { kind: 'ask' }>
type ToolBlock = Extract<ChatBlock, { type: 'tool' }>

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Số token đang nằm trong context theo usage của một message (input + cache). */
function contextTokens(usage: unknown): number | undefined {
  if (!isObj(usage)) return undefined
  const sum = (num(usage.input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0) + (num(usage.cache_read_input_tokens) ?? 0)
  return sum > 0 ? sum : undefined
}

/** Nội dung tool_result (chuỗi hoặc mảng khối) → chữ. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (isObj(c) ? (c.type === 'text' ? str(c.text) : c.type === 'image' ? '[ảnh]' : '') : ''))
    .filter(Boolean)
    .join('\n')
}

function clip(text: string): { text: string; truncated: boolean } {
  return text.length > CHAT_OUTPUT_MAX ? { text: text.slice(0, CHAT_OUTPUT_MAX), truncated: true } : { text, truncated: false }
}

export interface Ingested {
  /** Các mục vừa thêm / đổi (gửi sang renderer). */
  changed: ChatItem[]
  stateChanged: boolean
  /** Có thẻ xin quyền mới (session cần nhớ gợi ý để trả lời). */
  ask?: { item: AskItem; suggestions: unknown[] }
}

export class ChatModel {
  items: ChatItem[] = []
  state: ChatState = { phase: 'off' }
  now: () => string = () => new Date().toISOString()

  private seq = 0
  private byId = new Map<string, ChatItem>()
  /** message.id (Anthropic) → có dựng từ stream_event (khối đã đủ, `assistant` chỉ để đối chiếu). */
  private streamed = new Set<string>()
  /** Khối đang stream: item id → (index khối của API → vị trí trong blocks). */
  private blockPos = new Map<string, Map<number, number>>()
  /** tool_use_id → json đang ghép dần. */
  private partialJson = new Map<string, string>()
  /** tool_use_id → id mục assistant chứa nó. */
  private toolOwner = new Map<string, string>()
  private turnStartedAt: number | null = null
  /** Người dùng vừa ngắt lượt: `result` lỗi kế tiếp là do ngắt, không phải lỗi thật. */
  private interruptAsked = false

  // ---- thêm mục do chính app tạo ----

  addUser(text: string, origin: 'user' | 'agent' | 'app', opts: { from?: string; images?: number } = {}): ChatItem {
    const item: ChatItem = {
      kind: 'user',
      id: `u-${++this.seq}`,
      at: this.now(),
      text,
      origin,
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.images ? { images: opts.images } : {})
    }
    this.put(item)
    return item
  }

  addNotice(level: 'info' | 'warn' | 'error', text: string): ChatItem {
    const item: ChatItem = { kind: 'notice', id: `n-${++this.seq}`, at: this.now(), level, text }
    this.put(item)
    return item
  }

  /** Người dùng bấm ngắt lượt đang chạy. */
  markInterrupt(): void {
    this.interruptAsked = true
  }

  /** Người dùng gửi một lượt: coi là đang bận cho tới khi `result`. */
  beginTurn(): void {
    if (this.turnStartedAt === null) this.turnStartedAt = Date.now()
    this.setPhase('busy')
  }

  setPhase(phase: ChatState['phase']): boolean {
    if (this.state.phase === phase) return false
    this.state = { ...this.state, phase }
    return true
  }

  patchState(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch }
  }

  /** Trả lời một thẻ xin quyền. */
  resolveAsk(requestId: string, state: AskItem['state']): ChatItem | undefined {
    const cur = this.byId.get(`ask-${requestId}`)
    if (!cur || cur.kind !== 'ask') return undefined
    const next: AskItem = { ...cur, state }
    this.put(next)
    return next
  }

  /** Tiến trình thoát: mọi thứ đang dang dở dừng lại. */
  closeAll(): ChatItem[] {
    const out: ChatItem[] = []
    for (const it of this.items) {
      if (it.kind === 'assistant' && (it.streaming || it.blocks.some((b) => b.type === 'tool' && b.state === 'running'))) {
        const next: AssistantItem = {
          ...it,
          streaming: false,
          blocks: it.blocks.map((b) => (b.type === 'tool' && b.state === 'running' ? { ...b, state: 'error' as const } : b))
        }
        this.put(next)
        out.push(next)
      } else if (it.kind === 'ask' && it.state === 'pending') {
        const next: AskItem = { ...it, state: 'cancelled' }
        this.put(next)
        out.push(next)
      }
    }
    this.state = { ...this.state, phase: 'off' }
    this.turnStartedAt = null
    return out
  }

  /** Nạp lịch sử (đọc từ transcript) thay cho danh sách hiện tại. */
  load(items: ChatItem[]): void {
    this.items = []
    this.byId.clear()
    for (const it of items) this.put(it)
  }

  // ---- đọc một dòng stdout ----

  ingest(raw: unknown): Ingested {
    const out: Ingested = { changed: [], stateChanged: false }
    if (!isObj(raw)) return out
    const type = str(raw.type)
    // Tin của agent con (tool Task): chỉ để tool Task kết thúc, không vẽ lại ruột bên trong.
    if (raw.parent_tool_use_id && type !== 'user' && type !== 'result') return out
    switch (type) {
      case 'system':
        return this.onSystem(raw, out)
      case 'stream_event':
        return this.onStream(raw, out)
      case 'assistant':
        return this.onAssistant(raw, out)
      case 'user':
        return this.onUser(raw, out)
      case 'rate_limit_event':
        return this.onRateLimit(raw, out)
      case 'result':
        return this.onResult(raw, out)
      case 'control_request':
        return this.onControlRequest(raw, out)
      case 'control_cancel_request': {
        const id = str(raw.request_id)
        const it = this.resolveAsk(id, 'cancelled')
        if (it) {
          out.changed.push(it)
          if (this.state.phase === 'waiting') out.stateChanged = this.setPhase('busy')
        }
        return out
      }
      default:
        return out
    }
  }

  private put(item: ChatItem): void {
    const had = this.byId.get(item.id)
    this.byId.set(item.id, item)
    if (had) {
      const i = this.items.indexOf(had)
      if (i >= 0) this.items[i] = item
      else this.items.push(item)
    } else {
      this.items.push(item)
      // Phiên rất dài: bỏ bớt mục cũ nhất (transcript trên đĩa vẫn đủ).
      if (this.items.length > MAX_ITEMS) {
        for (const d of this.items.splice(0, TRIM_ITEMS)) this.byId.delete(d.id)
      }
    }
  }

  private onSystem(ev: Json, out: Ingested): Ingested {
    const sub = str(ev.subtype)
    if (sub === 'init') {
      const model = str(ev.model)
      this.state = { ...this.state, sessionId: str(ev.session_id) || this.state.sessionId, ...(model ? { model } : {}) }
      if (this.state.phase === 'starting' || this.state.phase === 'off') this.state = { ...this.state, phase: 'idle' }
      out.stateChanged = true
    } else if (sub === 'status') {
      if (str(ev.status) === 'requesting' && this.state.phase !== 'waiting') out.stateChanged = this.setPhase('busy')
    } else if (sub === 'permission_denied') {
      const toolUseId = str(ev.tool_use_id)
      const changed = this.setToolState(toolUseId, 'denied')
      if (changed) out.changed.push(changed)
    } else if (sub === 'api_retry') {
      const n = this.addNotice('warn', 'API đang thử lại…')
      out.changed.push(n)
    }
    return out
  }

  private onStream(ev: Json, out: Ingested): Ingested {
    const e = ev.event
    if (!isObj(e)) return out
    const kind = str(e.type)
    if (kind === 'message_start') {
      const m = isObj(e.message) ? e.message : {}
      const msgId = str(m.id)
      if (!msgId) return out
      this.streamed.add(msgId)
      const ctx = contextTokens(m.usage)
      if (ctx) {
        this.state = { ...this.state, contextUsed: ctx, ...(str(m.model) ? { model: str(m.model) } : {}) }
        out.stateChanged = true
      }
      const item: AssistantItem = { kind: 'assistant', id: msgId, at: this.now(), blocks: [], streaming: true, ...(str(m.model) ? { model: str(m.model) } : {}) }
      this.put(item)
      this.blockPos.set(msgId, new Map())
      out.changed.push(item)
      return out
    }
    // Các sự kiện còn lại thuộc message gần nhất đang stream.
    const cur = this.currentStreaming()
    if (!cur) return out
    const pos = this.blockPos.get(cur.id) ?? new Map<number, number>()
    this.blockPos.set(cur.id, pos)
    const index = num(e.index)

    if (kind === 'content_block_start' && index !== undefined && isObj(e.content_block)) {
      const cb = e.content_block
      const t = str(cb.type)
      let block: ChatBlock | null = null
      if (t === 'text') block = { type: 'text', text: str(cb.text) }
      else if (t === 'thinking') block = { type: 'thinking', text: str(cb.thinking) }
      else if (t === 'tool_use') {
        const toolUseId = str(cb.id)
        block = { type: 'tool', toolUseId, name: str(cb.name), input: isObj(cb.input) ? cb.input : {}, state: 'running' }
        this.toolOwner.set(toolUseId, cur.id)
        this.partialJson.set(toolUseId, '')
      }
      if (!block) return out
      pos.set(index, cur.blocks.length)
      const next: AssistantItem = { ...cur, blocks: [...cur.blocks, block] }
      this.put(next)
      out.changed.push(next)
      return out
    }

    if (kind === 'content_block_delta' && index !== undefined && isObj(e.delta)) {
      const at = pos.get(index)
      if (at === undefined) return out
      const block = cur.blocks[at]
      const d = e.delta
      const dt = str(d.type)
      let nextBlock: ChatBlock | null = null
      if (block.type === 'text' && dt === 'text_delta') nextBlock = { ...block, text: block.text + str(d.text) }
      else if (block.type === 'thinking' && dt === 'thinking_delta') nextBlock = { ...block, text: block.text + str(d.thinking) }
      else if (block.type === 'tool' && dt === 'input_json_delta') {
        this.partialJson.set(block.toolUseId, (this.partialJson.get(block.toolUseId) ?? '') + str(d.partial_json))
        return out // tool: chờ content_block_stop rồi mới parse
      }
      if (!nextBlock) return out
      const blocks = cur.blocks.slice()
      blocks[at] = nextBlock
      const next: AssistantItem = { ...cur, blocks }
      this.put(next)
      out.changed.push(next)
      return out
    }

    if (kind === 'content_block_stop' && index !== undefined) {
      const at = pos.get(index)
      if (at === undefined) return out
      const block = cur.blocks[at]
      let blocks = cur.blocks
      if (block.type === 'tool') {
        const json = this.partialJson.get(block.toolUseId) ?? ''
        if (json) {
          try {
            const parsed: unknown = JSON.parse(json)
            blocks = blocks.slice()
            blocks[at] = { ...block, input: parsed }
          } catch {
            // json cắt dở (bị ngắt giữa chừng): giữ input rỗng
          }
        }
      } else if (block.type === 'thinking' && !block.text.trim()) {
        // Model không trả chữ suy nghĩ (chỉ chữ ký): bỏ khối trống.
        blocks = blocks.filter((_, i) => i !== at)
        const next: AssistantItem = { ...cur, blocks }
        // Vị trí các khối sau bị dịch 1.
        for (const [idx, p] of pos) if (p > at) pos.set(idx, p - 1)
        pos.delete(index)
        this.put(next)
        out.changed.push(next)
        return out
      }
      if (blocks !== cur.blocks) {
        const next: AssistantItem = { ...cur, blocks }
        this.put(next)
        out.changed.push(next)
      }
      return out
    }

    if (kind === 'message_delta') {
      const ctx = contextTokens(e.usage)
      if (ctx) {
        this.state = { ...this.state, contextUsed: ctx }
        out.stateChanged = true
      }
      return out
    }

    if (kind === 'message_stop') {
      const next: AssistantItem = { ...cur, streaming: false }
      this.put(next)
      out.changed.push(next)
      return out
    }
    return out
  }

  /** `assistant`: đủ một khối của message. Có stream thì chỉ đối chiếu (điền input tool), không thì dựng mục. */
  private onAssistant(ev: Json, out: Ingested): Ingested {
    const m = isObj(ev.message) ? ev.message : null
    if (!m) return out
    const msgId = str(m.id)
    const content = Array.isArray(m.content) ? m.content : []
    if (!msgId) return out
    if (this.streamed.has(msgId)) {
      const it = this.byId.get(msgId)
      if (it?.kind !== 'assistant') return out
      let blocks = it.blocks
      for (const c of content) {
        if (!isObj(c) || c.type !== 'tool_use') continue
        const id = str(c.id)
        const i = blocks.findIndex((b) => b.type === 'tool' && b.toolUseId === id)
        if (i < 0) continue
        const b = blocks[i] as ToolBlock
        const empty = isObj(b.input) && Object.keys(b.input).length === 0
        if (empty && isObj(c.input)) {
          blocks = blocks.slice()
          blocks[i] = { ...b, input: c.input }
        }
      }
      if (blocks !== it.blocks) {
        const next: AssistantItem = { ...it, blocks }
        this.put(next)
        out.changed.push(next)
      }
      return out
    }
    // Không có stream (không bật --include-partial-messages hoặc nạp từ log): dựng từ khối đầy đủ, nhiều sự kiện cùng message.id nối tiếp nhau.
    const existing = this.byId.get(msgId)
    const base: AssistantItem =
      existing?.kind === 'assistant'
        ? existing
        : { kind: 'assistant', id: msgId, at: this.now(), blocks: [], ...(str(m.model) ? { model: str(m.model) } : {}) }
    const blocks = base.blocks.slice()
    for (const c of content) {
      if (!isObj(c)) continue
      const t = str(c.type)
      if (t === 'text' && str(c.text)) blocks.push({ type: 'text', text: str(c.text) })
      else if (t === 'thinking' && str(c.thinking)) blocks.push({ type: 'thinking', text: str(c.thinking) })
      else if (t === 'tool_use') {
        const toolUseId = str(c.id)
        if (blocks.some((b) => b.type === 'tool' && b.toolUseId === toolUseId)) continue
        blocks.push({ type: 'tool', toolUseId, name: str(c.name), input: c.input ?? {}, state: 'running' })
        this.toolOwner.set(toolUseId, msgId)
      }
    }
    const next: AssistantItem = { ...base, blocks }
    this.put(next)
    out.changed.push(next)
    return out
  }

  private onUser(ev: Json, out: Ingested): Ingested {
    const m = isObj(ev.message) ? ev.message : null
    const content = m && Array.isArray(m.content) ? m.content : []
    const meta = Array.isArray(ev.tool_result_meta) ? ev.tool_result_meta : []
    for (const c of content) {
      if (!isObj(c) || c.type !== 'tool_result') continue
      const toolUseId = str(c.tool_use_id)
      const text = clip(resultText(c.content))
      const info = meta.find((x) => isObj(x) && str(x.id) === toolUseId)
      const denied = isObj(info) && (str(info.non_execution_kind) === 'user-rejected' || (isObj(info.permission_decision) && str(info.permission_decision.decision) === 'reject'))
      // Transcript không có tool_result_meta: nhận ra tool bị từ chối qua lời báo của Claude Code.
      const rejectedText = c.is_error === true && /requested permissions|doesn't want to proceed|was rejected|user rejected/i.test(text.text)
      const state: ToolBlock['state'] = denied || rejectedText ? 'denied' : c.is_error === true ? 'error' : 'ok'
      const changed = this.setToolState(toolUseId, state, text.text, text.truncated)
      if (changed) out.changed.push(changed)
    }
    return out
  }

  private onRateLimit(ev: Json, out: Ingested): Ingested {
    const info = isObj(ev.rate_limit_info) ? ev.rate_limit_info : null
    const wins = info && isObj(info.unifiedWindows) ? info.unifiedWindows : null
    if (!wins) return out
    const win = (v: unknown): { utilization: number; resetsAt: number } | undefined => {
      if (!isObj(v)) return undefined
      const u = num(v.utilization)
      const r = num(v.resetsAt)
      return u === undefined || r === undefined ? undefined : { utilization: u, resetsAt: r }
    }
    const fiveHour = win(wins.five_hour)
    const sevenDay = win(wins.seven_day)
    if (!fiveHour && !sevenDay) return out
    this.state = { ...this.state, quota: { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}) } }
    out.stateChanged = true
    return out
  }

  private onResult(ev: Json, out: Ingested): Ingested {
    // Đóng mọi message còn stream.
    for (const it of this.items) {
      if (it.kind === 'assistant' && it.streaming) {
        const next: AssistantItem = { ...it, streaming: false }
        this.put(next)
        out.changed.push(next)
      }
    }
    const sub = str(ev.subtype)
    const cost = num(ev.total_cost_usd)
    const modelUsage = isObj(ev.modelUsage) ? ev.modelUsage : null
    let size: number | undefined
    if (modelUsage) {
      const model = this.state.model && isObj(modelUsage[this.state.model]) ? (modelUsage[this.state.model] as Json) : (Object.values(modelUsage).find(isObj) as Json | undefined)
      size = model ? num(model.contextWindow) : undefined
    }
    const started = this.turnStartedAt
    this.turnStartedAt = null
    const durationMs = num(ev.duration_ms) ?? (started ? Date.now() - started : 0)
    const failed = ev.is_error === true || sub.startsWith('error')
    const interrupted = failed && (this.interruptAsked || /interrupt/i.test(str(ev.result) + str(ev.terminal_reason)))
    this.interruptAsked = false
    const turn: ChatItem = {
      kind: 'turn',
      id: `t-${++this.seq}`,
      at: this.now(),
      durationMs,
      ...(cost !== undefined ? { costUsd: cost } : {}),
      outcome: interrupted ? 'interrupted' : sub || 'success'
    }
    this.put(turn)
    out.changed.push(turn)
    if (ev.is_error === true && !interrupted && str(ev.result)) {
      out.changed.push(this.addNotice('error', str(ev.result)))
    }
    // Tool nào còn "running" mà lượt đã hết: lỗi (bị ngắt).
    for (const it of this.items) {
      if (it.kind === 'assistant' && it.blocks.some((b) => b.type === 'tool' && b.state === 'running')) {
        const next: AssistantItem = { ...it, blocks: it.blocks.map((b) => (b.type === 'tool' && b.state === 'running' ? { ...b, state: 'error' as const } : b)) }
        this.put(next)
        out.changed.push(next)
      }
    }
    this.state = {
      ...this.state,
      phase: this.state.phase === 'off' ? 'off' : 'idle',
      ...(cost !== undefined ? { costUsd: cost } : {}),
      ...(size ? { contextSize: size } : {})
    }
    out.stateChanged = true
    return out
  }

  private onControlRequest(ev: Json, out: Ingested): Ingested {
    const req = isObj(ev.request) ? ev.request : null
    if (!req || str(req.subtype) !== 'can_use_tool') return out
    const requestId = str(ev.request_id)
    if (!requestId) return out
    const suggestions = Array.isArray(req.permission_suggestions) ? req.permission_suggestions : []
    const toolUseId = str(req.tool_use_id)
    const item: AskItem = {
      kind: 'ask',
      id: `ask-${requestId}`,
      at: this.now(),
      requestId,
      ...(toolUseId ? { toolUseId } : {}),
      tool: str(req.tool_name) || str(req.display_name),
      input: req.input ?? {},
      ...(str(req.description) ? { reason: str(req.description) } : {}),
      canRemember: suggestions.length > 0,
      state: 'pending'
    }
    this.put(item)
    out.changed.push(item)
    out.ask = { item, suggestions }
    out.stateChanged = this.setPhase('waiting')
    return out
  }

  private currentStreaming(): AssistantItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (it.kind === 'assistant' && it.streaming) return it
    }
    return undefined
  }

  private setToolState(toolUseId: string, state: ToolBlock['state'], output?: string, truncated?: boolean): ChatItem | undefined {
    const owner = this.toolOwner.get(toolUseId)
    const it = owner ? this.byId.get(owner) : this.findToolOwner(toolUseId)
    if (it?.kind !== 'assistant') return undefined
    let hit = false
    const blocks = it.blocks.map((b) => {
      if (b.type !== 'tool' || b.toolUseId !== toolUseId) return b
      hit = true
      return { ...b, state, ...(output !== undefined ? { output } : {}), ...(truncated ? { truncated: true } : {}) }
    })
    if (!hit) return undefined
    const next: AssistantItem = { ...it, blocks }
    this.put(next)
    return next
  }

  private findToolOwner(toolUseId: string): AssistantItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (it.kind === 'assistant' && it.blocks.some((b) => b.type === 'tool' && b.toolUseId === toolUseId)) return it
    }
    return undefined
  }
}
