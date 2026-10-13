// Phiên ô chat: một tiến trình CLI sống suốt phiên, vào / ra bằng JSON từng dòng. Lớp nền giữ ChatModel (nguồn sự
// thật), gộp thay đổi đẩy sang renderer, báo phase / context cho board. Hai loại:
// - ChatSession (Claude Code): `claude -p --input-format stream-json --output-format stream-json`, mỗi lượt là một
//   dòng trên stdin, xin quyền qua control_request.
// - CodexChatSession (codexSession.ts): `codex app-server`, JSON-RPC.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
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

export interface ChatSendOptions {
  origin?: 'user' | 'agent' | 'app'
  from?: string
  images?: ChatImage[]
  /** Chữ hiện trong ô (khác chữ gửi cho agent: tin agent khác gửi bỏ lời đánh dấu). */
  display?: string
}

/**
 * Dừng tiến trình CLI cùng mọi tiến trình con của nó. Trên Windows `proc.kill()` chỉ giết đúng một tiến trình, lệnh
 * agent đang chạy qua tool shell (`npm run dev`, test, máy chủ MCP stdio) sẽ sống tiếp và giữ cổng / file.
 */
export function killTree(proc: { pid?: number; kill: () => boolean }): void {
  if (process.platform === 'win32' && proc.pid) {
    execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, (err) => {
      // taskkill lỗi (tiến trình đã thoát, không có quyền…): vẫn thử cách thường.
      if (err) proc.kill()
    })
  } else proc.kill()
}

/** Gộp các thay đổi liên tiếp trong chừng này ms thành một lần gửi (stream chữ không làm renderer nghẹt). */
const FLUSH_MS = 40

export abstract class ChatSessionBase {
  abstract readonly model: ChatModel
  /** Lần cuối app gõ một lượt vào (ms). */
  lastSentAt = 0
  protected proc: ChildProcessWithoutNullStreams | null = null
  protected stateDirty = false
  protected stderr = ''
  protected exited = false
  /** Đã gọi kill(): tiến trình chưa kịp mở (Codex đang chạy thử hook) thì không mở nữa. */
  protected killed = false
  /** Tiến trình không mở được (sự kiện 'error' của spawn). */
  private spawnFailed = false
  private pending = new Map<string, ChatItem>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private buf = ''
  private lastPhase: ChatState['phase'] = 'off'
  private lastCtx = ''

  constructor(protected readonly opts: ChatSessionOptions) {}

  get alive(): boolean {
    return !!this.proc && !this.exited
  }

  snapshot(): ChatSnapshot {
    return { items: this.model.items.slice(), state: this.model.state }
  }

  /** Nạp lịch sử (phiên tiếp tục, hoặc hội thoại cũ trong ô) rồi chạy tiến trình. */
  abstract start(history: ChatItem[], sessionId: string, resumed?: boolean): void
  /** Gửi một lượt của người dùng (hoặc tin từ agent khác / lời mở của app). */
  abstract send(text: string, opts?: ChatSendOptions): void
  /** Ngắt lượt đang chạy (như Esc trong terminal). */
  abstract interrupt(): void
  /** Trả lời thẻ xin quyền. */
  abstract answer(requestId: string, behavior: 'allow' | 'deny', remember?: boolean, updatedInput?: unknown): void
  /** Một dòng JSON từ stdout của tiến trình. */
  protected abstract onLine(ev: unknown): void

  hasPendingAsk(): boolean {
    return this.model.items.some((i) => i.kind === 'ask' && i.state === 'pending')
  }

  /** Thông báo của app chen vào hội thoại (vd. "Đã đổi quyền"). */
  notice(level: 'info' | 'warn' | 'error', text: string): void {
    this.queue(this.model.addNotice(level, text))
    this.flushSoon()
  }

  kill(): void {
    this.killed = true
    // Chưa có tiến trình (Codex còn chạy thử hook trước khi mở app-server): kết thúc phiên ngay, boot() thấy `killed` thì dừng.
    if (!this.proc) {
      this.finish(null)
      return
    }
    try {
      this.proc.stdin.end()
    } catch {
      // đã đóng
    }
    killTree(this.proc)
  }

  // ---- cho lớp con ----

  /** Nạp lịch sử, đặt phase đầu, gửi `reset` sang renderer. */
  protected begin(history: ChatItem[], sessionId: string | undefined, phase: ChatState['phase'], newSession: boolean): void {
    this.model.load(history)
    if (newSession && history.length) this.model.addNotice('info', 'Phiên mới')
    this.model.patchState({ phase, ...(sessionId ? { sessionId } : {}) })
    this.opts.emit({ type: 'reset', items: this.model.items.slice(), state: this.model.state })
    this.lastPhase = phase
  }

  /** Chạy tiến trình (`args` thay cho opts.args nếu có). */
  protected spawnProcess(args?: string[]): void {
    if (this.killed || this.exited) return
    const o = this.opts
    const a = args ?? o.args
    const proc = spawn(o.command, Array.isArray(a) ? a : [a], {
      cwd: o.cwd,
      env: o.env,
      windowsHide: true,
      windowsVerbatimArguments: typeof a === 'string',
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
      this.spawnFailed = true
      this.finish(null)
    })
    proc.on('exit', (code) => this.finish(code))
  }

  protected write(obj: unknown): void {
    if (!this.proc || this.exited) return
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  protected queue(item: ChatItem): void {
    this.pending.set(item.id, item)
  }

  protected flushSoon(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), FLUSH_MS)
  }

  /** Tiến trình thoát (hoặc không mở được): đóng mọi thứ đang dở, báo lỗi nếu có. */
  protected finish(code: number | null): void {
    if (this.exited) return
    this.exited = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // Đọc nốt phần còn lại trong bộ đệm stdout (dòng cuối không có \n).
    if (this.buf.trim()) {
      try {
        this.onLine(JSON.parse(this.buf.trim()))
      } catch {
        // dòng cuối dở dang
      }
      this.buf = ''
    }
    const closed = this.model.closeAll()
    for (const it of closed) this.queue(it)
    // Không mở được tiến trình (không có exe…): code null nhưng vẫn phải báo lỗi.
    const failed = this.spawnFailed || (code !== null && code !== 0 && code !== 143 && code !== 130)
    if (failed && this.stderr.trim()) this.queue(this.model.addNotice('error', this.stderr.trim().slice(-600)))
    for (const item of this.pending.values()) this.opts.emit({ type: 'upsert', item })
    this.pending.clear()
    this.opts.emit({ type: 'state', state: this.model.state })
    this.lastPhase = 'off'
    this.opts.onPhase?.('off')
    this.opts.onExit({ code, stderr: this.stderr })
  }

  // ---- nội bộ ----

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
      this.onLine(ev)
    }
    this.flushSoon()
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
}

/** Ô chat Claude Code: `claude -p --input-format stream-json --output-format stream-json`. */
export class ChatSession extends ChatSessionBase {
  readonly model = new ChatModel()
  /** requestId → dữ liệu cần để trả lời thẻ xin quyền. */
  private asks = new Map<string, { input: unknown; suggestions: unknown[] }>()

  start(history: ChatItem[], sessionId: string, resumed = false): void {
    // Tiếp tục phiên: Claude chỉ báo `init` sau tin đầu tiên, nên coi như đã sẵn sàng ngay.
    this.begin(history, sessionId, resumed ? 'idle' : 'starting', !resumed)
    this.spawnProcess()
  }

  send(text: string, opts: ChatSendOptions = {}): void {
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

  interrupt(): void {
    // Không có lượt nào đang chạy: không đánh dấu (không thì lượt sau bị coi là "đã ngắt").
    if (!this.alive || this.model.state.phase === 'idle') return
    this.model.markInterrupt()
    // Đang chờ duyệt mà bị ngắt: trả lời từ chối trước (không thì Claude còn chờ câu trả lời), rồi huỷ thẻ.
    for (const it of this.model.items) {
      if (it.kind !== 'ask' || it.state !== 'pending') continue
      if (this.asks.has(it.requestId))
        this.write({
          type: 'control_response',
          response: { subtype: 'success', request_id: it.requestId, response: { behavior: 'deny', message: 'Người dùng đã ngắt lượt này trong stag.ai.', interrupt: true } }
        })
      this.asks.delete(it.requestId)
      const next = this.model.resolveAsk(it.requestId, 'cancelled')
      if (next) this.queue(next)
    }
    this.write({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } })
    if (this.model.state.phase === 'waiting') {
      this.model.setPhase('busy')
      this.stateDirty = true
    }
    this.flushSoon()
  }

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

  protected onLine(ev: unknown): void {
    const r = this.model.ingest(ev)
    for (const it of r.changed) this.queue(it)
    if (r.stateChanged) this.stateDirty = true
    if (r.ask) this.asks.set(r.ask.item.requestId, { input: r.ask.item.input, suggestions: r.ask.suggestions })
  }
}
