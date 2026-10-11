// Một phiên ô chat: tiến trình `claude -p --input-format stream-json --output-format stream-json` sống suốt phiên,
// mỗi lượt của người dùng là một dòng JSON trên stdin. Giữ ChatModel (nguồn sự thật) và đẩy thay đổi sang renderer.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ChatEvent, ChatImage, ChatItem, ChatSnapshot, ChatState } from '@shared/chat'
import { ChatModel } from './protocol'

type Body<T> = T extends unknown ? Omit<T, 'agentId'> : never
/** Sự kiện chưa có agentId (AgentService điền khi gửi sang renderer). */
export type ChatEventBody = Body<ChatEvent>

export interface ChatSessionOptions {
  command: string
  /** Chuỗi = dòng lệnh thô (file .cmd chạy qua cmd.exe, xem spawnSpec). */
  args: string[] | string
  cwd: string
  env: NodeJS.ProcessEnv
  /** Đẩy sự kiện sang renderer (ChatEvent.agentId do bên gọi điền). */
  emit: (e: ChatEventBody) => void
  /** Tiến trình đã thoát (mọi lý do). */
  onExit: (info: { code: number | null; stderr: string }) => void
  /** Số đo context đổi (cho kanban / bàn giao). */
  onContext?: (used: number | undefined, size: number | undefined) => void
  /** Phase đổi (idle / busy / waiting) — để cập nhật trạng thái agent trên board. */
  onPhase?: (phase: ChatState['phase']) => void
}

/** Gộp các thay đổi liên tiếp trong chừng này ms thành một lần gửi (stream chữ không làm renderer nghẹt). */
const FLUSH_MS = 40

export class ChatSession {
  readonly model = new ChatModel()
  /** Lần cuối app gõ một lượt vào (ms). */
  lastSentAt = 0
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, ChatItem>()
  private stateDirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private buf = ''
  private stderr = ''
  private lastPhase: ChatState['phase'] = 'off'
  private lastCtx = ''
  /** requestId → dữ liệu cần để trả lời thẻ xin quyền. */
  private asks = new Map<string, { input: unknown; suggestions: unknown[] }>()
  private exited = false

  constructor(private readonly opts: ChatSessionOptions) {}

  get alive(): boolean {
    return !!this.proc && !this.exited
  }

  snapshot(): ChatSnapshot {
    return { items: this.model.items.slice(), state: this.model.state }
  }

  /** Nạp lịch sử (phiên tiếp tục) rồi chạy tiến trình. */
  start(history: ChatItem[], sessionId: string, resumed = false): void {
    this.model.load(history)
    if (!resumed && history.length) this.model.addNotice('info', 'Phiên mới')
    // Tiếp tục phiên: Claude chỉ báo `init` sau tin đầu tiên, nên coi như đã sẵn sàng ngay.
    const phase = resumed ? 'idle' : 'starting'
    this.model.patchState({ phase, sessionId })
    this.opts.emit({ type: 'reset', items: this.model.items.slice(), state: this.model.state })
    this.lastPhase = phase
    const o = this.opts
    const proc = spawn(o.command, Array.isArray(o.args) ? o.args : [o.args], {
      cwd: o.cwd,
      env: o.env,
      windowsHide: true,
      windowsVerbatimArguments: typeof o.args === 'string',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => this.onStdout(d))
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-4000)
    })
    // Ghi vào stdin của tiến trình đã chết ném EPIPE: không để làm sập main.
    proc.stdin.on('error', () => undefined)
    proc.on('error', (e) => {
      this.stderr += `\n${e.message}`
      this.finish(null)
    })
    proc.on('exit', (code) => this.finish(code))
  }

  /** Gửi một lượt của người dùng (hoặc tin từ agent khác / lời mở của app). */
  send(text: string, opts: { origin?: 'user' | 'agent' | 'app'; from?: string; images?: ChatImage[]; display?: string } = {}): void {
    if (!this.alive) throw new Error('Phiên chat chưa chạy')
    const content: unknown[] = []
    for (const im of opts.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })
    content.push({ type: 'text', text })
    this.write({ type: 'user', message: { role: 'user', content } })
    this.lastSentAt = Date.now()
    const item = this.model.addUser(opts.display ?? text, opts.origin ?? 'user', { from: opts.from, images: opts.images?.length })
    this.model.beginTurn()
    this.queue(item)
    this.stateDirty = true
    this.flushSoon()
  }

  /** Ngắt lượt đang chạy (như Esc trong terminal). */
  interrupt(): void {
    if (!this.alive) return
    this.model.markInterrupt()
    this.write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } })
    // Đang chờ duyệt mà bị ngắt: thẻ xin quyền không còn ý nghĩa.
    for (const it of this.model.items) {
      if (it.kind !== 'ask' || it.state !== 'pending') continue
      this.asks.delete(it.requestId)
      const next = this.model.resolveAsk(it.requestId, 'cancelled')
      if (next) this.queue(next)
    }
    if (this.model.state.phase === 'waiting') {
      this.model.setPhase('busy')
      this.stateDirty = true
    }
    this.flushSoon()
  }

  /** Trả lời thẻ xin quyền. */
  answer(requestId: string, behavior: 'allow' | 'deny', remember = false, updatedInput?: unknown): void {
    const ask = this.asks.get(requestId)
    if (!ask || !this.alive) return
    this.asks.delete(requestId)
    const response =
      behavior === 'allow'
        ? { behavior: 'allow', updatedInput: updatedInput ?? ask.input, ...(remember && ask.suggestions.length ? { updatedPermissions: ask.suggestions } : {}) }
        : { behavior: 'deny', message: 'Người dùng từ chối yêu cầu này trong stag.ai.' }
    this.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
    const it = this.model.resolveAsk(requestId, behavior === 'allow' ? 'allowed' : 'denied')
    if (it) this.queue(it)
    if (this.model.state.phase === 'waiting' && !this.hasPendingAsk()) this.model.setPhase('busy')
    this.stateDirty = true
    this.flushSoon()
  }

  hasPendingAsk(): boolean {
    return this.model.items.some((i) => i.kind === 'ask' && i.state === 'pending')
  }

  /** Thông báo của app chen vào hội thoại (vd. "Đã đổi quyền"). */
  notice(level: 'info' | 'warn' | 'error', text: string): void {
    this.queue(this.model.addNotice(level, text))
    this.flushSoon()
  }

  kill(): void {
    try {
      this.proc?.stdin.end()
    } catch {
      // đã đóng
    }
    this.proc?.kill()
  }

  // ---- nội bộ ----

  private write(obj: unknown): void {
    if (!this.proc || this.exited) return
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  private onStdout(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      let ev: unknown
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      const r = this.model.ingest(ev)
      for (const it of r.changed) this.queue(it)
      if (r.stateChanged) this.stateDirty = true
      if (r.ask) this.asks.set(r.ask.item.requestId, { input: r.ask.item.input, suggestions: r.ask.suggestions })
    }
    this.flushSoon()
  }

  private queue(item: ChatItem): void {
    this.pending.set(item.id, item)
  }

  private flushSoon(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), FLUSH_MS)
  }

  private flush(): void {
    this.timer = null
    for (const item of this.pending.values()) this.opts.emit({ type: 'upsert', item })
    this.pending.clear()
    if (this.stateDirty) {
      this.stateDirty = false
      const st = this.model.state
      this.opts.emit({ type: 'state', state: st })
      if (st.phase !== this.lastPhase) {
        this.lastPhase = st.phase
        this.opts.onPhase?.(st.phase)
      }
      const ctx = `${st.contextUsed ?? ''}/${st.contextSize ?? ''}`
      if (ctx !== this.lastCtx) {
        this.lastCtx = ctx
        this.opts.onContext?.(st.contextUsed, st.contextSize)
      }
    }
  }

  private finish(code: number | null): void {
    if (this.exited) return
    this.exited = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // Đọc nốt phần còn lại trong bộ đệm stdout (dòng cuối không có \n).
    if (this.buf.trim()) this.onStdoutFinal()
    const closed = this.model.closeAll()
    for (const it of closed) this.queue(it)
    const failed = code !== null && code !== 0 && code !== 143 && code !== 130
    if (failed && this.stderr.trim()) this.queue(this.model.addNotice('error', this.stderr.trim().slice(-600)))
    for (const item of this.pending.values()) this.opts.emit({ type: 'upsert', item })
    this.pending.clear()
    this.opts.emit({ type: 'state', state: this.model.state })
    this.lastPhase = 'off'
    this.opts.onPhase?.('off')
    this.opts.onExit({ code, stderr: this.stderr })
  }

  private onStdoutFinal(): void {
    try {
      const r = this.model.ingest(JSON.parse(this.buf.trim()))
      for (const it of r.changed) this.queue(it)
    } catch {
      // dòng cuối dở dang
    }
    this.buf = ''
  }
}
