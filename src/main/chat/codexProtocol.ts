// Mô hình hội thoại của ô chat Codex: biến thông báo / yêu cầu JSON-RPC của `codex app-server` (đã kiểm với
// codex-cli 0.162.0, kiểu lấy từ `codex app-server generate-ts`) thành ChatItem như ô chat Claude. Thuần dữ liệu,
// không I/O (xem codexProtocol.test.ts). Dùng lại ChatModel cho danh sách mục, thẻ xin quyền, trạng thái.
//
// Khác Claude: Codex chia lượt thành các "item" (agentMessage, reasoning, commandExecution, fileChange, mcpToolCall…),
// mỗi item có item/started → delta → item/completed. Các item liền nhau của một lượt gom vào một mục assistant
// (một khối mỗi item); có mục khác chen vào (thẻ xin quyền, thông báo) thì mở mục assistant mới để giữ thứ tự.
import { CHAT_OUTPUT_MAX, type ChatBlock, type ChatItem } from '@shared/chat'
import { ChatModel, type Ingested } from './protocol'

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>
type AskItem = Extract<ChatItem, { kind: 'ask' }>
type ToolBlock = Extract<ChatBlock, { type: 'tool' }>
type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function clip(text: string): { output: string; truncated?: true } {
  return text.length > CHAT_OUTPUT_MAX ? { output: text.slice(0, CHAT_OUTPUT_MAX), truncated: true } : { output: text }
}

/** Yêu cầu của app-server cần người dùng trả lời (session giữ lại để gửi `result` đúng dạng). */
export interface CodexAsk {
  /** id JSON-RPC của yêu cầu (gửi lại trong câu trả lời). */
  rpcId: number | string
  method: string
  params: Json
  item: AskItem
}

export interface CodexIngested extends Ingested {
  codexAsk?: CodexAsk
  /** Yêu cầu app không hỗ trợ: trả lời ngay bằng `result` này (hoặc `error`). */
  reply?: { rpcId: number | string; result?: unknown; error?: string }
}

/** Lệnh để hiện: script người dùng thấy (commandActions) thay cho `"powershell.exe" -Command '…'`. */
export function commandText(item: Json): string {
  const actions = arr(item.commandActions)
  if (actions.length === 1 && isObj(actions[0]) && str(actions[0].command)) return str(actions[0].command)
  const c = item.command
  if (Array.isArray(c)) return c.map(String).join(' ')
  return str(c)
}

/** Kết quả tool MCP (content: khối text / image / resource) → chữ. */
function mcpResultText(item: Json): string {
  if (isObj(item.error) && str(item.error.message)) return str(item.error.message)
  const r = isObj(item.result) ? item.result : null
  if (!r) return ''
  const parts = arr(r.content).map((c) => (isObj(c) ? (c.type === 'text' ? str(c.text) : c.type === 'image' ? '[ảnh]' : '') : ''))
  const text = parts.filter(Boolean).join('\n')
  if (text) return text
  return r.structuredContent === undefined || r.structuredContent === null ? '' : JSON.stringify(r.structuredContent, null, 2)
}

/** Thay đổi file của một fileChange: { path, kind: add | delete | update, diff, movePath? }. */
export function fileChanges(item: Json): Array<{ path: string; kind: string; diff: string; movePath?: string }> {
  return arr(item.changes)
    .filter(isObj)
    .map((c) => {
      const k = isObj(c.kind) ? c.kind : {}
      const movePath = str(k.move_path)
      return { path: str(c.path), kind: str(k.type) || 'update', diff: str(c.diff), ...(movePath ? { movePath } : {}) }
    })
}

/** Trạng thái tool của một item đã xong. */
function toolState(item: Json): ToolBlock['state'] {
  const s = str(item.status)
  if (s === 'declined') return 'denied'
  if (s === 'failed' || s === 'inProgress') return 'error'
  if (item.type === 'commandExecution' && num(item.exitCode) !== undefined && item.exitCode !== 0) return 'error'
  if (item.type === 'dynamicToolCall' && item.success === false) return 'error'
  if (item.type === 'mcpToolCall' && isObj(item.error)) return 'error'
  return 'ok'
}

/** Item dạng tool → tên + tham số theo quy ước tên tool của Claude (để thẻ tool của renderer vẽ đúng). */
export function toolOf(item: Json): { name: string; input: unknown } | null {
  switch (str(item.type)) {
    case 'commandExecution':
      return { name: 'Bash', input: { command: commandText(item), ...(str(item.cwd) ? { cwd: str(item.cwd) } : {}) } }
    case 'fileChange':
      return { name: 'ApplyPatch', input: { changes: fileChanges(item) } }
    case 'mcpToolCall':
      return { name: `mcp__${str(item.server)}__${str(item.tool)}`, input: item.arguments ?? {} }
    case 'dynamicToolCall':
      return { name: str(item.namespace) ? `mcp__${str(item.namespace)}__${str(item.tool)}` : str(item.tool), input: item.arguments ?? {} }
    case 'webSearch': {
      const action = isObj(item.action) ? item.action : {}
      return { name: 'WebSearch', input: { query: str(item.query) || str(action.query) || arr(action.queries).map(String).join(' · ') } }
    }
    case 'imageView':
      return { name: 'Read', input: { file_path: str(item.path) } }
    case 'collabAgentToolCall':
      return { name: 'Task', input: { description: str(item.tool), prompt: str(item.prompt) } }
    default:
      return null
  }
}

/** Kết quả hiện dưới thẻ tool của một item đã xong. */
function toolOutput(item: Json): string {
  switch (str(item.type)) {
    case 'commandExecution':
      return str(item.aggregatedOutput)
    case 'mcpToolCall':
      return mcpResultText(item)
    case 'dynamicToolCall':
      return arr(item.contentItems)
        .map((c) => (isObj(c) ? str(c.text) : ''))
        .filter(Boolean)
        .join('\n')
    default:
      return ''
  }
}

/** Phần tóm tắt suy nghĩ (summary) hoặc nội dung suy nghĩ của một item reasoning. */
function reasoningText(item: Json): string {
  const s = arr(item.summary).map(String).filter(Boolean)
  if (s.length) return s.join('\n\n')
  return arr(item.content).map(String).filter(Boolean).join('\n\n')
}

/** Cửa sổ hạn mức của Codex (usedPercent 0..100, resetsAt epoch giây). */
function quotaWindow(v: unknown): { utilization: number; resetsAt: number; mins?: number } | undefined {
  if (!isObj(v)) return undefined
  const used = num(v.usedPercent)
  const reset = num(v.resetsAt)
  if (used === undefined || reset === undefined) return undefined
  return { utilization: used / 100, resetsAt: reset, mins: num(v.windowDurationMins) }
}

export class CodexChatModel extends ChatModel {
  /** Thread id của phiên (cũng là id để `thread/resume`). */
  threadId?: string
  /** Lượt đang chạy (để `turn/interrupt` / `turn/steer`). */
  turnId?: string
  /** Tiền tố id thẻ xin quyền: id JSON-RPC đếm lại từ 0 mỗi tiến trình, không được trùng thẻ của phiên trước. */
  askPrefix = ''

  /** id item Codex → (mục assistant chứa nó, vị trí khối). */
  private blockAt = new Map<string, { itemId: string; index: number }>()

  protected forget(id: string): void {
    super.forget(id)
    for (const [codexId, at] of this.blockAt) if (at.itemId === id) this.blockAt.delete(codexId)
  }
  /** Mục assistant đang gom khối và lượt của nó. */
  private seg: { itemId: string; turnId: string } | null = null
  private codexTurnStartedAt: number | null = null
  private interruptAskedCodex = false

  /** Người dùng bấm ngắt lượt. */
  override markInterrupt(): void {
    super.markInterrupt()
    this.interruptAskedCodex = true
  }

  override beginTurn(): void {
    if (this.codexTurnStartedAt === null) this.codexTurnStartedAt = Date.now()
    this.setPhase('busy')
  }

  /** Một thông báo / yêu cầu từ app-server (một dòng JSON trên stdout, không phải câu trả lời cho yêu cầu của app). */
  ingestCodex(msg: Json): CodexIngested {
    const out: CodexIngested = { changed: [], stateChanged: false }
    const method = str(msg.method)
    const p = isObj(msg.params) ? msg.params : {}
    if (msg.id !== undefined && msg.id !== null && method) return this.onServerRequest(msg.id as number | string, method, p, out)
    switch (method) {
      case 'turn/started': {
        const turn = isObj(p.turn) ? p.turn : {}
        this.turnId = str(turn.id) || this.turnId
        if (this.codexTurnStartedAt === null) this.codexTurnStartedAt = Date.now()
        if (this.state.phase !== 'waiting') out.stateChanged = this.setPhase('busy')
        return out
      }
      case 'turn/completed':
        return this.onTurnCompleted(isObj(p.turn) ? p.turn : {}, out)
      case 'item/started':
        if (isObj(p.item)) this.onItem(p.item, str(p.turnId), false, out)
        return out
      case 'item/completed':
        if (isObj(p.item)) this.onItem(p.item, str(p.turnId), true, out)
        return out
      case 'item/agentMessage/delta':
        this.appendText(str(p.itemId), str(p.turnId), 'text', str(p.delta), out)
        return out
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        this.appendText(str(p.itemId), str(p.turnId), 'thinking', str(p.delta), out)
        return out
      case 'item/reasoning/summaryPartAdded':
        // Phần tóm tắt mới: cách đoạn trước (chỉ khi đã có chữ).
        if (this.blockAt.has(str(p.itemId))) this.appendText(str(p.itemId), str(p.turnId), 'thinking', '\n\n', out)
        return out
      case 'item/commandExecution/outputDelta':
        this.appendOutput(str(p.itemId), str(p.delta), out)
        return out
      case 'thread/tokenUsage/updated': {
        const u = isObj(p.tokenUsage) ? p.tokenUsage : {}
        const last = isObj(u.last) ? u.last : {}
        const used = num(last.totalTokens)
        const size = num(u.modelContextWindow)
        if (used || size) {
          this.patchState({ ...(used ? { contextUsed: used } : {}), ...(size ? { contextSize: size } : {}) })
          out.stateChanged = true
        }
        return out
      }
      case 'account/rateLimits/updated': {
        const r = isObj(p.rateLimits) ? p.rateLimits : {}
        const wins = [quotaWindow(r.primary), quotaWindow(r.secondary)].filter((w): w is NonNullable<typeof w> => !!w)
        if (!wins.length) return out
        // Codex: cửa sổ 5 giờ + tuần (gói trả tiền) hoặc một cửa sổ dài (gói free): cửa sổ ≤ 6 giờ là "5 giờ", còn lại "dài".
        const short = wins.find((w) => (w.mins ?? 0) > 0 && (w.mins ?? 0) <= 360)
        const long = wins.find((w) => w !== short)
        const strip = (w: (typeof wins)[number]): { utilization: number; resetsAt: number } => ({ utilization: w.utilization, resetsAt: w.resetsAt })
        this.patchState({ quota: { ...(short ? { fiveHour: strip(short) } : {}), ...(long ? { sevenDay: strip(long) } : {}) } })
        out.stateChanged = true
        return out
      }
      case 'serverRequest/resolved': {
        // Codex tự đóng yêu cầu (lượt bị ngắt, agent duyệt tự trả lời…): thẻ còn chờ thì huỷ.
        const id = `${this.askPrefix}${String(p.requestId)}`
        const cur = this.byId.get(`ask-${id}`)
        if (cur?.kind === 'ask' && cur.state === 'pending') {
          const it = this.resolveAsk(id, 'cancelled')
          if (it) out.changed.push(it)
          if (this.state.phase === 'waiting' && !this.pendingAsk()) out.stateChanged = this.setPhase('busy')
        }
        return out
      }
      case 'error': {
        const e = isObj(p.error) ? p.error : {}
        const text = str(e.message) || 'Codex báo lỗi'
        out.changed.push(this.addNotice(p.willRetry === true ? 'warn' : 'error', p.willRetry === true ? `API đang thử lại… (${text})` : text))
        return out
      }
      case 'warning':
        if (str(p.message)) out.changed.push(this.addNotice('warn', str(p.message)))
        return out
      case 'thread/compacted':
        out.changed.push(this.addNotice('info', 'Đã nén context'))
        return out
      case 'thread/started': {
        const t = isObj(p.thread) ? p.thread : {}
        if (str(t.id) && !this.threadId) {
          this.threadId = str(t.id)
          this.patchState({ sessionId: this.threadId })
          out.stateChanged = true
        }
        return out
      }
      default:
        return out
    }
  }

  /** Thêm một item đã xong (nạp lịch sử từ rollout). */
  addCompletedItem(item: Json, turnId: string): ChatItem[] {
    const out: CodexIngested = { changed: [], stateChanged: false }
    this.onItem(item, turnId, true, out)
    return out.changed
  }

  /** Dòng tổng kết một lượt (nạp lịch sử: task_complete / turn_aborted). */
  addTurn(durationMs: number, outcome: string): ChatItem {
    this.seg = null
    const turn: ChatItem = { kind: 'turn', id: `t-${++this.seq}`, at: this.now(), durationMs, outcome }
    this.put(turn)
    return turn
  }

  pendingAsk(): boolean {
    return this.items.some((i) => i.kind === 'ask' && i.state === 'pending')
  }

  // ---- nội bộ ----

  protected override put(item: ChatItem): void {
    super.put(item)
    // Mục khác chen vào sau mục assistant đang gom: khối sau phải vào một mục assistant mới (giữ thứ tự hiện).
    if (this.seg && item.id !== this.seg.itemId && this.items[this.items.length - 1] === item) this.seg = null
  }

  /** Mục assistant để thêm khối mới của lượt `turnId`. */
  private segment(turnId: string): AssistantItem {
    const cur = this.seg ? this.byId.get(this.seg.itemId) : undefined
    if (cur?.kind === 'assistant' && this.seg?.turnId === turnId) return cur
    const item: AssistantItem = { kind: 'assistant', id: `a-${++this.seq}`, at: this.now(), blocks: [], ...(this.state.model ? { model: this.state.model } : {}) }
    this.put(item)
    this.seg = { itemId: item.id, turnId }
    return item
  }

  /**
   * `streaming` của mục assistant = đang nhận chữ (con trỏ nháy ở khối cuối). Tool đang chạy thì không: renderer
   * tự hiện "đang làm…" khi lượt bận mà không có gì đang stream.
   */
  private addBlock(codexId: string, turnId: string, block: ChatBlock, out: CodexIngested): void {
    const owner = this.segment(turnId)
    const next: AssistantItem = { ...owner, blocks: [...owner.blocks, block], streaming: block.type !== 'tool' }
    this.blockAt.set(codexId, { itemId: owner.id, index: owner.blocks.length })
    this.put(next)
    this.changed(out, next)
  }

  /** Đổi khối của item `codexId` (không có → false). `streaming` đặt lại cờ đang nhận chữ của mục chứa nó. */
  private updateBlock(codexId: string, fn: (b: ChatBlock) => ChatBlock, out: CodexIngested, streaming?: boolean): boolean {
    const at = this.blockAt.get(codexId)
    const owner = at ? this.byId.get(at.itemId) : undefined
    if (!at || owner?.kind !== 'assistant' || !owner.blocks[at.index]) return false
    const blocks = owner.blocks.slice()
    blocks[at.index] = fn(blocks[at.index])
    const next: AssistantItem = { ...owner, blocks, ...(streaming !== undefined ? { streaming } : {}) }
    this.put(next)
    this.changed(out, next)
    return true
  }

  private changed(out: CodexIngested, item: ChatItem): void {
    const i = out.changed.findIndex((c) => c.id === item.id)
    if (i >= 0) out.changed[i] = item
    else out.changed.push(item)
  }

  private appendText(codexId: string, turnId: string, type: 'text' | 'thinking', delta: string, out: CodexIngested): void {
    if (!delta) return
    const ok = this.updateBlock(codexId, (b) => (b.type === 'text' || b.type === 'thinking' ? { ...b, text: b.text + delta } : b), out, true)
    if (!ok && delta.trim()) this.addBlock(codexId, turnId, { type, text: delta }, out)
  }

  private appendOutput(codexId: string, delta: string, out: CodexIngested): void {
    if (!delta) return
    this.updateBlock(
      codexId,
      (b) => {
        if (b.type !== 'tool' || b.truncated) return b
        const text = (b.output ?? '') + delta
        return { ...b, ...clip(text) }
      },
      out
    )
  }

  private onItem(item: Json, turnId: string, done: boolean, out: CodexIngested): void {
    const id = str(item.id)
    const type = str(item.type)
    if (!id) return
    switch (type) {
      case 'userMessage':
      case 'hookPrompt':
        // Lời người dùng do app tự thêm khi gửi (addUser); lịch sử đọc riêng (codexHistory.ts).
        return
      case 'agentMessage': {
        const text = str(item.text)
        if (this.blockAt.has(id)) {
          if (done) this.updateBlock(id, (b) => (b.type === 'text' && text ? { ...b, text } : b), out, false)
        } else if (text || !done) {
          // Mở khối ngay cả khi chưa có chữ: delta sau ghép vào đúng chỗ.
          this.addBlock(id, turnId, { type: 'text', text }, out)
          if (done) this.updateBlock(id, (b) => b, out, false)
        }
        return
      }
      case 'reasoning': {
        if (!done) return
        const text = reasoningText(item)
        if (this.blockAt.has(id)) this.updateBlock(id, (b) => (b.type === 'thinking' && text.trim() ? { ...b, text } : b), out, false)
        else if (text.trim()) {
          this.addBlock(id, turnId, { type: 'thinking', text }, out)
          this.updateBlock(id, (b) => b, out, false)
        }
        return
      }
      case 'plan': {
        const text = str(item.text)
        if (!done || !text.trim()) return
        if (this.blockAt.has(id)) this.updateBlock(id, (b) => (b.type === 'text' ? { ...b, text } : b), out)
        else this.addBlock(id, turnId, { type: 'text', text }, out)
        return
      }
      case 'contextCompaction':
        if (done) this.changed(out, this.addNotice('info', 'Đã nén context'))
        return
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        if (done) this.changed(out, this.addNotice('info', type === 'enteredReviewMode' ? 'Bắt đầu review' : 'Xong review'))
        return
    }
    const tool = toolOf(item)
    if (!tool) return
    if (!this.blockAt.has(id)) this.addBlock(id, turnId, { type: 'tool', toolUseId: id, name: tool.name, input: tool.input, state: 'running' }, out)
    if (!done) return
    const output = toolOutput(item)
    this.updateBlock(
      id,
      (b) => {
        if (b.type !== 'tool') return b
        // Lệnh đã stream output: giữ bản stream nếu bản cuối trống.
        const text = output || b.output || ''
        return { ...b, name: tool.name, input: tool.input, state: toolState(item), ...(text ? clip(text) : {}) }
      },
      out
    )
  }

  private onTurnCompleted(turn: Json, out: CodexIngested): CodexIngested {
    // Đóng các mục assistant đang stream và tool còn chạy.
    for (const it of this.items) {
      if (it.kind !== 'assistant') continue
      const running = it.blocks.some((b) => b.type === 'tool' && b.state === 'running')
      if (!it.streaming && !running) continue
      const next: AssistantItem = {
        ...it,
        streaming: false,
        blocks: it.blocks.map((b) => (b.type === 'tool' && b.state === 'running' ? { ...b, state: 'error' as const } : b))
      }
      this.put(next)
      this.changed(out, next)
    }
    const status = str(turn.status)
    const interrupted = status === 'interrupted' || (status === 'failed' && this.interruptAskedCodex)
    this.interruptAskedCodex = false
    const started = this.codexTurnStartedAt
    this.codexTurnStartedAt = null
    const durationMs = num(turn.durationMs) ?? (started ? Date.now() - started : 0)
    this.seg = null
    const item: ChatItem = {
      kind: 'turn',
      id: `t-${++this.seq}`,
      at: this.now(),
      durationMs,
      outcome: interrupted ? 'interrupted' : status === 'failed' ? 'error_during_execution' : 'success'
    }
    this.put(item)
    this.changed(out, item)
    const err = isObj(turn.error) ? turn.error : null
    if (err && !interrupted && str(err.message)) this.changed(out, this.addNotice('error', [str(err.message), str(err.additionalDetails)].filter(Boolean).join('\n')))
    if (str(turn.id) === this.turnId) this.turnId = undefined
    // Thẻ xin quyền của lượt đã hết: không còn ai chờ.
    for (const it of this.items) {
      if (it.kind !== 'ask' || it.state !== 'pending') continue
      const next = this.resolveAsk(it.requestId, 'cancelled')
      if (next) this.changed(out, next)
    }
    out.stateChanged = true
    this.patchState({ phase: this.state.phase === 'off' ? 'off' : 'idle' })
    return out
  }

  private onServerRequest(rpcId: number | string, method: string, p: Json, out: CodexIngested): CodexIngested {
    const requestId = `${this.askPrefix}${String(rpcId)}`
    const itemId = str(p.itemId)
    const reason = str(p.reason)
    let tool: string
    let input: unknown
    let canRemember = false
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        tool = 'Bash'
        input = { command: commandText(p), ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}) }
        // "Luôn cho phép" = acceptForSession (chỉ khi Codex cho chọn: availableDecisions).
        const avail = arr(p.availableDecisions)
        canRemember = !avail.length || avail.includes('acceptForSession')
        break
      }
      case 'item/fileChange/requestApproval': {
        tool = 'ApplyPatch'
        // Thẻ xin quyền không mang nội dung sửa: lấy từ khối fileChange (item/started đến trước).
        const at = this.blockAt.get(itemId)
        const owner = at ? this.byId.get(at.itemId) : undefined
        const block = owner?.kind === 'assistant' && at ? owner.blocks[at.index] : undefined
        input = block?.type === 'tool' ? block.input : { changes: [] }
        canRemember = true
        break
      }
      case 'item/permissions/requestApproval':
        tool = 'Permissions'
        input = { permissions: p.permissions ?? {}, ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}) }
        canRemember = true
        break
      case 'item/tool/requestUserInput': {
        // Câu hỏi cho người dùng: vẽ như AskUserQuestion của Claude (trả lời qua updatedInput.answers).
        tool = 'AskUserQuestion'
        const questions = arr(p.questions)
          .filter(isObj)
          .map((q) => ({
            id: str(q.id),
            question: str(q.question),
            header: str(q.header),
            multiSelect: false,
            options: arr(q.options)
              .filter(isObj)
              .map((o) => ({ label: str(o.label), description: str(o.description) }))
          }))
        input = { questions }
        break
      }
      case 'mcpServer/elicitation/request':
        if (str(p.mode) !== 'url') {
          out.reply = { rpcId, result: { action: 'decline', content: null, _meta: null } }
          this.changed(out, this.addNotice('warn', `Máy chủ MCP "${str(p.serverName)}" hỏi một biểu mẫu (chưa hỗ trợ trong ô chat): đã từ chối.`))
          return out
        }
        tool = 'MCP'
        input = { server: str(p.serverName), message: str(p.message), url: str(p.url) }
        break
      case 'applyPatchApproval':
      case 'execCommandApproval':
        // API cũ (v1) không dùng với thread/start: từ chối cho an toàn.
        out.reply = { rpcId, result: { decision: 'denied' } }
        return out
      default:
        out.reply = { rpcId, error: `stag.ai không hỗ trợ yêu cầu ${method}` }
        return out
    }
    const item: AskItem = {
      kind: 'ask',
      id: `ask-${requestId}`,
      at: this.now(),
      requestId,
      ...(itemId ? { toolUseId: itemId } : {}),
      tool,
      input,
      ...(reason ? { reason } : {}),
      canRemember,
      state: 'pending'
    }
    this.put(item)
    this.changed(out, item)
    out.codexAsk = { rpcId, method, params: p, item }
    out.stateChanged = this.setPhase('waiting')
    return out
  }
}

/**
 * Câu trả lời (`result`) cho một yêu cầu của app-server theo lựa chọn ở thẻ. `updatedInput` (AskUserQuestion):
 * `{ answers: { "<câu hỏi>": "nhãn, nhãn" } }` như thẻ của Claude.
 */
export function codexAnswer(ask: Pick<CodexAsk, 'method' | 'params' | 'item'>, behavior: 'allow' | 'deny', remember: boolean, updatedInput?: unknown): unknown {
  switch (ask.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: behavior === 'allow' ? (remember ? 'acceptForSession' : 'accept') : 'decline' }
    case 'item/permissions/requestApproval': {
      const req = isObj(ask.params.permissions) ? ask.params.permissions : {}
      // Cho phép = cấp đúng phần được xin (bỏ trường null); từ chối = không cấp gì.
      const granted: Json = {}
      if (behavior === 'allow') for (const [k, v] of Object.entries(req)) if (v !== null && v !== undefined) granted[k] = v
      return { permissions: granted, scope: remember ? 'session' : 'turn' }
    }
    case 'item/tool/requestUserInput': {
      const qs = arr(isObj(ask.item.input) ? ask.item.input.questions : []).filter(isObj)
      const given = isObj(updatedInput) && isObj(updatedInput.answers) ? updatedInput.answers : {}
      const answers: Json = {}
      if (behavior === 'allow') {
        for (const q of qs) {
          const v = given[str(q.question)]
          if (typeof v === 'string' && v) answers[str(q.id)] = { answers: v.split(', ') }
        }
      }
      return { answers }
    }
    case 'mcpServer/elicitation/request':
      return { action: behavior === 'allow' ? 'accept' : 'decline', content: null, _meta: null }
    default:
      return {}
  }
}
