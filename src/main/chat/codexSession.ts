// Ô chat Codex: một tiến trình `codex app-server` (JSON-RPC 2.0 qua stdio, experimental, đã kiểm với codex-cli
// 0.162.0) sống suốt phiên. initialize → thread/start | thread/resume → turn/start (turn/steer khi đang chạy) /
// turn/interrupt. Thông báo + yêu cầu duyệt của Codex dịch sang ChatItem trong CodexChatModel (codexProtocol.ts).
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ChatItem } from '@shared/chat'
import { codexHookTrustArgs } from '../codex'
import { codexAnswer, CodexChatModel, type CodexAsk } from './codexProtocol'
import { ChatSessionBase, type ChatSendOptions, type ChatSessionOptions } from './session'

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export interface CodexThreadParams {
  cwd: string
  /** Luật phiên của agent (thêm một tin developer, không thay system prompt). */
  developerInstructions: string
  sandbox?: string
  approvalPolicy?: string
  approvalsReviewer?: string
}

export interface CodexChatOptions extends ChatSessionOptions {
  /** Cấu hình `-c` đặt trước lệnh con `app-server` (MCP stag, hook, connector, skill, model…). */
  args: string[]
  thread: CodexThreadParams
  /** Thread id của phiên trước (tiếp tục phiên) — không có = thread mới. */
  resumeId?: string
  /** Chỉ tin cậy hook có lệnh chứa chuỗi này (URL hook của app). */
  hookUrl: string
  /** Biết thread id (để lần sau `thread/resume` / `codex resume`). */
  onSessionId?: (threadId: string) => void
}

/** Hạn chờ một yêu cầu JSON-RPC của app (thread/start có thể chờ máy chủ MCP khởi động). */
const REQUEST_MS = 120_000
/** Hạn chờ app-server chạy thử để lấy hash hook. */
const TRUST_MS = 20_000

const CLIENT_INFO = { name: 'stag', title: 'stag.ai', version: '1' }
const CAPABILITIES = { experimentalApi: true, requestAttestation: false }

/** Hash hook đã lấy (cùng lệnh + tham số → cùng key / hash): không chạy thử lại mỗi phiên. */
const trustCache = new Map<string, Array<{ key: string; hash: string }>>()

/**
 * Hook trong `-c` của app-server không chạy cho tới khi được tin cậy (xem codexHookTrustArgs). Chạy thử một app-server
 * với đúng tham số đó, hỏi `hooks/list`, giữ key + hash của các hook nguồn "sessionFlags" có lệnh gọi về app (`hookUrl`).
 * Chỉ `initialize` + `hooks/list`: không mở thread, không gọi model.
 */
export function codexHookTrust(o: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; hookUrl: string }): Promise<Array<{ key: string; hash: string }>> {
  const cacheKey = [o.command, o.cwd, ...o.args].join('\0')
  const hit = trustCache.get(cacheKey)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve, reject) => {
    const proc = spawn(o.command, [...o.args, 'app-server'], { cwd: o.cwd, env: o.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let stderr = ''
    let done = false
    const end = (err: Error | null, list?: Array<{ key: string; hash: string }>): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        proc.stdin.end()
      } catch {
        // đã đóng
      }
      proc.kill()
      if (err) reject(err)
      else {
        trustCache.set(cacheKey, list!)
        resolve(list!)
      }
    }
    const timer = setTimeout(() => end(new Error('codex app-server không trả lời hooks/list')), TRUST_MS)
    const send = (o2: unknown): void => {
      proc.stdin.write(JSON.stringify(o2) + '\n')
    }
    proc.stdin.on('error', () => undefined)
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => (stderr = (stderr + d).slice(-2000)))
    proc.on('error', (e) => end(e))
    proc.on('exit', (code) => end(new Error(`codex app-server thoát (${code}) trước khi trả lời hooks/list${stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ''}`)))
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let m: Json
        try {
          m = JSON.parse(line) as Json
        } catch {
          continue
        }
        if (m.id === 1) {
          if (m.error) return end(new Error(`initialize lỗi: ${JSON.stringify(m.error)}`))
          send({ jsonrpc: '2.0', method: 'initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'hooks/list', params: { cwds: [o.cwd] } })
        } else if (m.id === 2) {
          if (m.error || !isObj(m.result)) return end(new Error(`hooks/list lỗi: ${JSON.stringify(m.error)}`))
          const out: Array<{ key: string; hash: string }> = []
          for (const entry of Array.isArray(m.result.data) ? m.result.data : []) {
            if (!isObj(entry)) continue
            for (const h of Array.isArray(entry.hooks) ? entry.hooks : []) {
              if (!isObj(h) || h.source !== 'sessionFlags' || !str(h.command).includes(o.hookUrl)) continue
              if (str(h.key) && str(h.currentHash) && !out.some((x) => x.key === h.key)) out.push({ key: str(h.key), hash: str(h.currentHash) })
            }
          }
          end(null, out)
        }
      }
    })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: CLIENT_INFO, capabilities: CAPABILITIES } })
  })
}

/** Ảnh đính kèm → UserInput của Codex (data URL). */
function userInput(text: string, images: ChatSendOptions['images']): unknown[] {
  const input: unknown[] = (images ?? []).map((im) => ({ type: 'image', url: `data:${im.mediaType};base64,${im.data}` }))
  input.push({ type: 'text', text, text_elements: [] })
  return input
}

export class CodexChatSession extends ChatSessionBase {
  readonly model = new CodexChatModel()
  private rpcSeq = 0
  private waits = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  /** requestId (thẻ) → yêu cầu của Codex đang chờ trả lời. */
  private asks = new Map<string, CodexAsk>()
  /** Lượt chờ gửi: thread chưa sẵn sàng, hoặc turn/start trước chưa có trả lời. */
  private outbox: unknown[][] = []
  private ready = false
  private starting = false
  private interruptWanted = false

  constructor(private readonly codex: CodexChatOptions) {
    super(codex)
  }

  start(history: ChatItem[], _sessionId: string, resumed = false): void {
    this.begin(history, this.codex.resumeId, 'starting', !resumed)
    this.model.askPrefix = `${randomUUID().slice(0, 8)}-`
    void this.boot().catch((e: Error) => {
      this.stderr = `${this.stderr}\n${e.message}`.trim()
      this.queue(this.model.addNotice('error', `Không mở được phiên Codex: ${e.message}`))
      if (this.proc && !this.exited) this.kill()
      else this.finish(null)
    })
  }

  send(text: string, opts: ChatSendOptions = {}): void {
    if (this.exited) throw new Error('Phiên chat chưa chạy')
    this.outbox.push(userInput(text, opts.images))
    this.lastSentAt = Date.now()
    this.queue(this.model.addUser(opts.display ?? text, opts.origin ?? 'user', { from: opts.from, images: opts.images?.length }))
    this.model.beginTurn()
    this.stateDirty = true
    this.flushSoon()
    this.pump()
  }

  interrupt(): void {
    // Không có lượt nào đang chạy (và không đang mở phiên): không đánh dấu, lượt sau không bị coi là "đã ngắt".
    if (!this.alive || (this.model.state.phase === 'idle' && !this.starting)) return
    this.model.markInterrupt()
    // Thẻ còn chờ: báo Codex huỷ (không thì lượt treo chờ câu trả lời).
    for (const [requestId, ask] of this.asks) {
      this.respond(ask.rpcId, codexAnswer(ask, 'deny', false))
      this.asks.delete(requestId)
      const next = this.model.resolveAsk(requestId, 'cancelled')
      if (next) this.queue(next)
    }
    if (this.model.state.phase === 'waiting') {
      this.model.setPhase('busy')
      this.stateDirty = true
    }
    if (this.model.turnId) void this.request('turn/interrupt', { threadId: this.model.threadId, turnId: this.model.turnId }).catch(() => undefined)
    else if (this.starting) this.interruptWanted = true
    this.flushSoon()
  }

  answer(requestId: string, behavior: 'allow' | 'deny', remember = false, updatedInput?: unknown): void {
    const ask = this.asks.get(requestId)
    if (!ask || !this.alive) return
    this.asks.delete(requestId)
    this.respond(ask.rpcId, codexAnswer(ask, behavior, remember, updatedInput))
    const it = this.model.resolveAsk(requestId, behavior === 'allow' ? 'allowed' : 'denied')
    if (it) this.queue(it)
    if (this.model.state.phase === 'waiting' && !this.hasPendingAsk()) this.model.setPhase('busy')
    this.stateDirty = true
    this.flushSoon()
  }

  // ---- nội bộ ----

  private async boot(): Promise<void> {
    const o = this.codex
    let trust: Array<{ key: string; hash: string }> = []
    try {
      trust = await codexHookTrust({ command: o.command, args: o.args, cwd: o.cwd, env: o.env, hookUrl: o.hookUrl })
    } catch (e) {
      console.error('[codex-chat] hooks/list', e)
    }
    // Người dùng dừng / xoá agent trong lúc chạy thử hook: không mở app-server nữa.
    if (this.killed || this.exited) return
    if (!trust.length) this.queue(this.model.addNotice('warn', 'Codex chưa tin cậy hook của stag.ai: việc đang làm, khoá phạm vi và sản phẩm của phiên này có thể không cập nhật.'))
    this.spawnProcess([...o.args, ...codexHookTrustArgs(trust), 'app-server'])
    await this.request('initialize', { clientInfo: CLIENT_INFO, capabilities: CAPABILITIES })
    this.notify('initialized')
    const params = { ...o.thread }
    let res: unknown
    if (o.resumeId) {
      try {
        res = await this.request('thread/resume', { threadId: o.resumeId, ...params, excludeTurns: true })
      } catch (e) {
        this.queue(this.model.addNotice('warn', `Không tiếp tục được phiên Codex ${o.resumeId} (${(e as Error).message}): mở phiên mới.`))
      }
    }
    res ??= await this.request('thread/start', params)
    const r = isObj(res) ? res : {}
    const thread = isObj(r.thread) ? r.thread : {}
    const threadId = str(thread.id)
    if (!threadId) throw new Error('app-server không trả về thread id')
    this.model.threadId = threadId
    this.model.patchState({ sessionId: threadId, ...(str(r.model) ? { model: str(r.model) } : {}) })
    if (this.model.state.phase === 'starting') this.model.setPhase('idle')
    this.stateDirty = true
    this.ready = true
    this.codex.onSessionId?.(threadId)
    this.flushSoon()
    this.pump()
  }

  /** Gửi lượt kế tiếp: thread sẵn sàng và không có turn/start nào đang chờ trả lời. */
  private pump(): void {
    if (!this.ready || this.starting || this.exited || !this.outbox.length) return
    const input = this.outbox.shift()!
    const threadId = this.model.threadId
    const turnId = this.model.turnId
    this.starting = true
    // Lượt đang chạy: thêm vào lượt đó (steer), như gõ thêm khi Codex đang làm trong TUI.
    const req = turnId ? this.request('turn/steer', { threadId, input, expectedTurnId: turnId }) : this.request('turn/start', { threadId, input })
    req
      .then((res) => {
        const r = isObj(res) ? res : {}
        const id = isObj(r.turn) ? str(r.turn.id) : str(r.turnId)
        if (id) this.model.turnId = id
      })
      .catch((e: Error) => {
        if (turnId) {
          // Lượt vừa xong trước khi kịp steer: gửi thành lượt mới.
          if (this.model.turnId === turnId) this.model.turnId = undefined
          this.outbox.unshift(input)
          return
        }
        this.queue(this.model.addNotice('error', `Codex không nhận lượt: ${e.message}`))
        if (!this.outbox.length && this.model.state.phase === 'busy') this.model.setPhase('idle')
        this.stateDirty = true
        this.flushSoon()
      })
      .finally(() => {
        this.starting = false
        if (this.interruptWanted && this.model.turnId) {
          this.interruptWanted = false
          void this.request('turn/interrupt', { threadId, turnId: this.model.turnId }).catch(() => undefined)
        }
        this.pump()
      })
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.proc || this.exited) return Promise.reject(new Error('app-server đã dừng'))
    const id = ++this.rpcSeq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waits.delete(id)
        reject(new Error(`${method}: quá thời gian chờ`))
      }, REQUEST_MS)
      this.waits.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  protected onLine(ev: unknown): void {
    if (!isObj(ev)) return
    // Câu trả lời cho yêu cầu của app.
    if (ev.id !== undefined && ev.id !== null && !ev.method) {
      const w = this.waits.get(ev.id as number)
      if (!w) return
      this.waits.delete(ev.id as number)
      clearTimeout(w.timer)
      if (ev.error) {
        const err = isObj(ev.error) ? ev.error : {}
        w.reject(new Error(str(err.message) || JSON.stringify(ev.error)))
      } else w.resolve(ev.result)
      return
    }
    const r = this.model.ingestCodex(ev)
    for (const it of r.changed) this.queue(it)
    if (r.stateChanged) this.stateDirty = true
    if (r.codexAsk) this.asks.set(r.codexAsk.item.requestId, r.codexAsk)
    if (r.reply) this.write({ jsonrpc: '2.0', id: r.reply.rpcId, ...(r.reply.error ? { error: { code: -32601, message: r.reply.error } } : { result: r.reply.result }) })
    // Codex tự đóng yêu cầu (serverRequest/resolved) hoặc hết lượt: bỏ thẻ khỏi danh sách chờ trả lời.
    for (const id of this.asks.keys()) {
      const cur = this.model.items.find((i) => i.kind === 'ask' && i.requestId === id)
      if (cur?.kind === 'ask' && cur.state !== 'pending') this.asks.delete(id)
    }
    if (str(ev.method) === 'turn/completed') this.pump()
  }

  protected override finish(code: number | null): void {
    for (const w of this.waits.values()) {
      clearTimeout(w.timer)
      w.reject(new Error('app-server đã dừng'))
    }
    this.waits.clear()
    super.finish(code)
  }
}
