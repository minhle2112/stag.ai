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

/**
 * Đọc phần mới nối thêm vào transcript (poll nhẹ bằng stat; file có thể chưa tồn tại lúc phiên mới mở).
 * Chỉ xét phần ghi sau lúc bắt đầu theo dõi: transcript cũ khi `--resume` có thể đã chứa dòng ngắt.
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
    private onInterrupt: (i: Interrupt) => void
  ) {}

  /**
   * Bắt đầu theo dõi từ cuối file hiện tại (chưa có file thì từ đầu). Đồng bộ (một lần stat) để gọi
   * ngay sau khi chạy tiến trình mà không chen `await` vào giữa lúc chạy và lúc ghi nhận phiên.
   */
  static open(file: string, onInterrupt: (i: Interrupt) => void, intervalMs = 700): TranscriptWatcher {
    const w = new TranscriptWatcher(file, onInterrupt)
    try {
      w.offset = statSync(file).size
    } catch {
      w.offset = 0
    }
    w.timer = setInterval(() => void w.poll(), intervalMs)
    w.timer.unref?.()
    return w
  }

  get path(): string {
    return this.file
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
  }

  /** Đọc phần mới; trả về các lần ngắt tìm thấy (đồng thời gọi onInterrupt). */
  async poll(): Promise<Interrupt[]> {
    if (this.busy || !this.timer) return []
    this.busy = true
    const gen = this.generation
    const file = this.file
    const found: Interrupt[] = []
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
      }
    } catch {
      // File chưa có / đang bị khoá: lần sau đọc lại.
      return []
    } finally {
      this.busy = false
    }
    for (const i of found) this.onInterrupt(i)
    return found
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
