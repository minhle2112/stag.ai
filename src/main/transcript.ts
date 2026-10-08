import { promises as fs, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { samePath } from './fsutil'

/**
 * Theo dõi transcript JSONL của phiên Claude Code để biết người dùng bấm Esc ngắt agent.
 * Claude Code không bắn hook Stop khi bị ngắt; nó chỉ ghi vào transcript một dòng user có nội dung
 * đúng bằng "[Request interrupted by user]" hoặc "[Request interrupted by user for tool use]"
 * (đã kiểm trên transcript thật, Claude Code 2.1.138 → 2.1.293).
 */

export interface Interrupt {
  /** Thời điểm Claude Code ghi dòng ngắt (ISO). */
  at: string
  /** Ngắt lúc đang chạy tool (hoặc từ chối hộp thoại xin quyền). */
  forToolUse: boolean
}

const MARKER = 'Request interrupted by user'
const INTERRUPT_TEXT = /^\[Request interrupted by user( for tool use)?\]$/

/** Dòng ngắt chỉ dài vài trăm byte: dòng dở dang dài hơn mức này chắc chắn không phải dòng ngắt. */
const MAX_PENDING = 256 * 1024

/** Tên thư mục dự án trong ~/.claude/projects: mọi ký tự ngoài [A-Za-z0-9] thành '-'. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * Đường dẫn transcript đoán trước cho phiên. Chỉ là phỏng đoán ban đầu (đường dẫn rất dài có thể bị
 * Claude Code rút gọn khác đi): hook nào cũng gửi `transcript_path` thật, khi đó đổi sang theo nó.
 */
export function transcriptPath(cwd: string, sessionId: string, home = homedir()): string {
  return join(home, '.claude', 'projects', projectDirName(cwd), `${sessionId}.jsonl`)
}

interface TranscriptLine {
  type?: unknown
  isSidechain?: unknown
  isMeta?: unknown
  isCompactSummary?: unknown
  timestamp?: unknown
  message?: { role?: unknown; content?: unknown }
}

/**
 * Một dòng transcript có phải dòng "người dùng ngắt" của phiên chính không.
 * Bỏ qua dòng của subagent (isSidechain), bản tóm tắt compact, và mọi chỗ chỉ *nhắc tới* chuỗi đó
 * (lời nhắn, kết quả tool, lệnh…): nội dung phải đúng nguyên văn.
 */
export function parseInterrupt(line: string, now = (): string => new Date().toISOString()): Interrupt | null {
  if (!line.includes(MARKER)) return null
  let e: TranscriptLine
  try {
    e = JSON.parse(line) as TranscriptLine
  } catch {
    return null
  }
  if (!e || typeof e !== 'object' || e.type !== 'user') return null
  if (e.isSidechain === true || e.isMeta === true || e.isCompactSummary === true) return null
  if (e.message?.role !== 'user') return null
  const content = e.message.content
  const texts =
    typeof content === 'string'
      ? [content]
      : Array.isArray(content)
        ? content
            .filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
        : []
  for (const text of texts) {
    const m = INTERRUPT_TEXT.exec(text.trim())
    if (m) return { at: typeof e.timestamp === 'string' ? e.timestamp : now(), forToolUse: !!m[1] }
  }
  return null
}

/** Độ dài context của phiên chính tại một thời điểm (đọc từ transcript). */
export interface ContextSample {
  /** Token đầu vào của lượt gần nhất (input + cache tạo + cache đọc) = độ dài context lúc đó. */
  used: number
  /** Model của lượt đó; null với mẫu sau compact. */
  model: string | null
  at: string
  /** Mẫu lấy từ dòng compact_boundary (`postTokens`): context vừa được tóm tắt lại. */
  compacted?: boolean
}

interface ContextLine {
  type?: unknown
  subtype?: unknown
  isSidechain?: unknown
  timestamp?: unknown
  compactMetadata?: { postTokens?: unknown }
  message?: { model?: unknown; usage?: Record<string, unknown> }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/**
 * Một dòng transcript có cho biết độ dài context của phiên chính không: dòng assistant có `usage`
 * (mỗi khối nội dung một dòng, cùng `usage`), hoặc dòng `compact_boundary` (độ dài sau compact).
 * Bỏ qua subagent (context riêng) và tin nhắn `<synthetic>` (Claude Code tự sinh, usage bằng 0).
 */
export function parseContext(line: string, now = (): string => new Date().toISOString()): ContextSample | null {
  const usage = line.includes('"usage"')
  if (!usage && !line.includes('compact_boundary')) return null
  let e: ContextLine
  try {
    e = JSON.parse(line) as ContextLine
  } catch {
    return null
  }
  if (!e || typeof e !== 'object' || e.isSidechain === true) return null
  const at = typeof e.timestamp === 'string' ? e.timestamp : now()
  if (e.type === 'system' && e.subtype === 'compact_boundary') {
    const used = num(e.compactMetadata?.postTokens)
    return used ? { used, model: null, at, compacted: true } : null
  }
  if (e.type !== 'assistant' || !usage) return null
  const model = typeof e.message?.model === 'string' ? e.message.model : null
  if (model === '<synthetic>') return null
  const u = e.message?.usage
  if (!u || typeof u !== 'object') return null
  const used = num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens)
  return used ? { used, model, at } : null
}

/**
 * Cắt luồng byte nối thêm vào file JSONL thành từng dòng trọn vẹn. Dòng dở dang giữ lại chờ lần sau
 * (cắt theo byte '\n' nên không làm vỡ ký tự UTF-8). Dòng quá dài (kết quả tool lớn) thì bỏ hẳn
 * tới hết dòng thay vì giữ cả chục MB trong bộ nhớ.
 */
export class JsonlTail {
  private pending: Buffer = Buffer.alloc(0)
  private skipping = false

  push(chunk: Buffer): string[] {
    let buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    if (this.skipping) {
      const nl = buf.indexOf(0x0a)
      if (nl < 0) {
        this.pending = Buffer.alloc(0)
        return []
      }
      buf = buf.subarray(nl + 1)
      this.skipping = false
    }
    const last = buf.lastIndexOf(0x0a)
    const done = last < 0 ? Buffer.alloc(0) : buf.subarray(0, last)
    const rest = last < 0 ? buf : buf.subarray(last + 1)
    if (rest.length > MAX_PENDING) {
      this.pending = Buffer.alloc(0)
      this.skipping = true
    } else {
      this.pending = Buffer.from(rest)
    }
    if (!done.length) return []
    return done
      .toString('utf8')
      .split('\n')
      .filter((l) => l.trim())
  }

  reset(): void {
    this.pending = Buffer.alloc(0)
    this.skipping = false
  }
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size
  } catch {
    return 0
  }
}

export interface TranscriptHandlers {
  onInterrupt?: (i: Interrupt) => void
  onContext?: (c: ContextSample) => void
}

/** Lượng byte cuối file đọc để lấy độ dài context hiện có (tiếp tục phiên cũ, hoặc theo sang file khác). */
const SEED_BYTES = 4 * 1024 * 1024

/** Mẫu context mới nhất trong `[from, to)` byte của file (đọc ngược từng dòng). */
async function lastContextIn(file: string, to: number): Promise<ContextSample | null> {
  if (to <= 0) return null
  const from = Math.max(0, to - SEED_BYTES)
  const handle = await fs.open(file, 'r')
  let buf: Buffer
  try {
    buf = Buffer.alloc(to - from)
    const { bytesRead } = await handle.read(buf, 0, buf.length, from)
    buf = buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
  const lines = buf.toString('utf8').split('\n')
  // Dòng đầu có thể bị cắt giữa chừng khi không đọc từ đầu file: JSON.parse sẽ bỏ qua nó.
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = parseContext(lines[i])
    if (c) return c
  }
  return null
}

/**
 * Đọc phần mới nối thêm vào transcript (poll nhẹ bằng stat; file có thể chưa tồn tại lúc phiên mới mở).
 * Dòng ngắt chỉ xét phần ghi sau lúc bắt đầu theo dõi: transcript cũ khi `--resume` có thể đã chứa dòng
 * ngắt. Độ dài context thì lấy luôn mẫu mới nhất trong phần đã có (để hiện ngay khi tiếp tục phiên).
 */
export class TranscriptWatcher {
  private offset = 0
  private tail = new JsonlTail()
  private timer: NodeJS.Timeout | null = null
  private busy = false
  /** Tăng mỗi lần đổi file, để lượt đọc đang dở của file cũ không ghi đè vị trí đọc. */
  private generation = 0

  private constructor(
    private file: string,
    private handlers: TranscriptHandlers
  ) {}

  /**
   * Bắt đầu theo dõi từ cuối file hiện tại (chưa có file thì từ đầu). Đồng bộ (một lần stat) để gọi
   * ngay sau khi chạy tiến trình mà không chen `await` vào giữa lúc chạy và lúc ghi nhận phiên.
   */
  static open(file: string, handlers: TranscriptHandlers, intervalMs = 700): TranscriptWatcher {
    const w = new TranscriptWatcher(file, handlers)
    try {
      w.offset = statSync(file).size
    } catch {
      w.offset = 0
    }
    w.timer = setInterval(() => void w.poll(), intervalMs)
    w.timer.unref?.()
    void w.seed(file, w.offset, w.generation)
    return w
  }

  get path(): string {
    return this.file
  }

  /** Báo độ dài context mới nhất có sẵn trong file (phần trước `upto`). */
  private async seed(file: string, upto: number, gen: number): Promise<void> {
    if (!this.handlers.onContext) return
    let c: ContextSample | null = null
    try {
      c = await lastContextIn(file, upto)
    } catch {
      return
    }
    // Mẫu cũ hơn mẫu poll() đã báo thì bên nhận tự bỏ qua (so theo thời điểm).
    if (c && gen === this.generation && this.timer) this.handlers.onContext(c)
  }

  /** Hook báo transcript ở chỗ khác (đoán sai đường dẫn, hoặc /clear sang phiên mới): theo file đó từ cuối. */
  async follow(file: string): Promise<void> {
    if (!this.timer || samePath(file, this.file)) return
    const gen = ++this.generation
    const size = await sizeOf(file)
    if (gen !== this.generation || !this.timer) return
    this.file = file
    this.offset = size
    this.tail.reset()
    void this.seed(file, size, gen)
  }

  /** Đọc phần mới; trả về các lần ngắt tìm thấy (đồng thời gọi các handler). */
  async poll(): Promise<Interrupt[]> {
    if (this.busy || !this.timer) return []
    this.busy = true
    const gen = this.generation
    const file = this.file
    const found: Interrupt[] = []
    let context: ContextSample | null = null
    try {
      const size = await sizeOf(file)
      if (size < this.offset) {
        // File bị ghi lại từ đầu (không thường gặp): đọc lại từ đầu sẽ báo nhầm ngắt cũ → chỉ theo phần mới.
        this.offset = size
        this.tail.reset()
        return []
      }
      if (size === this.offset) return []
      const handle = await fs.open(file, 'r')
      let chunk: Buffer
      try {
        const length = size - this.offset
        chunk = Buffer.alloc(length)
        const { bytesRead } = await handle.read(chunk, 0, length, this.offset)
        chunk = chunk.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      if (gen !== this.generation || !this.timer) return []
      this.offset += chunk.length
      for (const line of this.tail.push(chunk)) {
        const i = parseInterrupt(line)
        if (i) found.push(i)
        context = parseContext(line) ?? context
      }
    } catch {
      // File chưa có / đang bị khoá: lần sau đọc lại.
      return []
    } finally {
      this.busy = false
    }
    for (const i of found) this.handlers.onInterrupt?.(i)
    if (context) this.handlers.onContext?.(context)
    return found
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
