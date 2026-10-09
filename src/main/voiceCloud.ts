import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { CLOUD_TERMS_MAX, SONIOX_SECRET } from '@shared/voice'

/**
 * Gõ bằng giọng nói (V3): máy nhận dạng đám mây Soniox, nghe trực tiếp qua WebSocket trong lúc người dùng nói (chữ hiện dần).
 * Chạy ở main: API key lấy từ kho bí mật (safeStorage), không bao giờ sang renderer. Mỗi lượt nói một kết nối
 * (Soniox tính tiền theo độ dài luồng). Âm thanh gửi dạng PCM 16-bit 16 kHz mono.
 * Tài liệu: soniox.com/docs/stt/api-reference/websocket-api (đọc 2026-10-09).
 */
export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const SONIOX_MODEL = 'stt-rt-v5'

/** Phần WebSocket cần dùng (WebSocket có sẵn của Node; test thay bằng bản giả). */
export interface WsLike {
  binaryType: string
  readyState: number
  onopen: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: ((e: unknown) => void) | null
  onclose: ((e: { code: number; reason: string }) => void) | null
  send(data: string | ArrayBufferLike | ArrayBufferView): void
  close(code?: number, reason?: string): void
}
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike

const nodeWs: WsFactory = (url, headers) =>
  // WebSocket của Node (undici) nhận thêm `headers` (đã thử: Soniox trả "Incorrect API key", không phải "Missing API key").
  new (WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => WsLike)(url, { headers })

interface Token {
  text: string
  is_final?: boolean
}
interface Reply {
  tokens?: Token[]
  finished?: boolean
  error_code?: number
  error_type?: string
  error_message?: string
}

/** Câu báo lỗi dễ hiểu theo `error_type` / mã lỗi của Soniox. */
export function cloudError(r: Reply): string {
  const t = r.error_type ?? ''
  if (t === 'unauthenticated' || r.error_code === 401) return 'API key Soniox không đúng hoặc đã bị thu hồi (Cài đặt → Giọng nói).'
  if (r.error_code === 402 || /payment|balance|credit|quota/i.test(t)) return 'Tài khoản Soniox hết tiền hoặc hết hạn mức (console.soniox.com).'
  if (r.error_code === 429) return 'Soniox đang giới hạn số yêu cầu, thử lại sau ít giây.'
  return `Soniox báo lỗi: ${(r.error_message ?? t ?? 'không rõ').slice(0, 200)}`
}

/** Float32 [-1, 1] → PCM 16-bit little-endian. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(out.buffer)
}

export interface CloudSessionOptions {
  key: string
  /** Từ gợi ý (tên hàm, file…) → `context.terms`. */
  terms: readonly string[]
  url?: string
  ws?: WsFactory
  /** Chữ đã chốt + chữ đang đoán (chưa chốt), gọi mỗi lần Soniox trả về. */
  onText?: (final: string, partial: string) => void
  /** Lỗi giữa chừng (mất mạng, key sai…), báo ngay để renderer chuẩn bị máy trên máy. */
  onError?: (message: string) => void
  /** Chờ tối đa sau khi kết thúc luồng. */
  finishTimeoutMs?: number
}

/** Một lượt nói gửi lên Soniox. */
export class CloudSession {
  private ws: WsLike
  private ready = false
  private queue: Uint8Array[] = []
  private finalText = ''
  private partial = ''
  private error: string | null = null
  private done = false
  private ending: { resolve: (t: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  /** Giây âm thanh đã gửi (để báo chi phí). */
  seconds = 0

  constructor(private o: CloudSessionOptions) {
    this.ws = (o.ws ?? nodeWs)(o.url ?? SONIOX_URL, { Authorization: `Bearer ${o.key}` })
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify(sonioxConfig(o.terms)))
      this.ready = true
      for (const b of this.queue) this.ws.send(b)
      this.queue = []
      if (this.ending) this.ws.send('')
    }
    this.ws.onmessage = (e) => this.onReply(e.data)
    this.ws.onerror = () => this.fail('Không kết nối được Soniox (kiểm tra mạng).')
    this.ws.onclose = (e) => {
      if (!this.done) this.fail(this.error ?? `Soniox đóng kết nối giữa chừng (mã ${e.code}).`)
    }
  }

  private onReply(data: unknown): void {
    let r: Reply
    try {
      r = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)) as Reply
    } catch {
      return
    }
    if (r.error_code || r.error_type) return this.fail(cloudError(r))
    let partial = ''
    for (const t of r.tokens ?? []) {
      if (t.text === '<fin>' || t.text === '<end>') continue
      if (t.is_final) this.finalText += t.text
      else partial += t.text
    }
    this.partial = partial
    this.o.onText?.(this.finalText.trim(), partial.trim())
    if (r.finished) {
      this.done = true
      const text = this.finalText.trim()
      if (this.ending) {
        clearTimeout(this.ending.timer)
        this.ending.resolve(text)
        this.ending = null
      }
      this.close()
    }
  }

  private fail(msg: string): void {
    if (this.done) return
    this.done = true
    this.error = msg
    this.o.onError?.(msg)
    if (this.ending) {
      clearTimeout(this.ending.timer)
      this.ending.reject(new Error(msg))
      this.ending = null
    }
    this.close()
  }

  private close(): void {
    try {
      this.ws.close(1000)
    } catch {
      /* đã đóng */
    }
  }

  /** Lỗi đã xảy ra (key sai, mất mạng…), null = vẫn ổn. */
  get failed(): string | null {
    return this.error
  }

  audio(samples: Float32Array): void {
    if (this.done || this.ending || !samples.length) return
    this.seconds += samples.length / 16000
    const pcm = toPcm16(samples)
    if (this.ready) this.ws.send(pcm)
    else this.queue.push(pcm)
  }

  /** Hết âm thanh: báo Soniox (chuỗi rỗng) và chờ chữ cuối cùng. */
  finish(): Promise<string> {
    if (this.error) return Promise.reject(new Error(this.error))
    if (this.done) return Promise.resolve(this.finalText.trim())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Soniox trả lời quá lâu.'), this.o.finishTimeoutMs ?? 15_000)
      this.ending = { resolve, reject, timer }
      if (this.ready) this.ws.send('')
    })
  }

  cancel(): void {
    this.done = true
    if (this.ending) {
      clearTimeout(this.ending.timer)
      this.ending.reject(new Error('Đã huỷ.'))
      this.ending = null
    }
    this.close()
  }
}

/** Tin nhắn cấu hình đầu tiên: tiếng Việt lẫn tiếng Anh, ngữ cảnh lập trình, từ gợi ý. */
export function sonioxConfig(terms: readonly string[]): Record<string, unknown> {
  return {
    model: SONIOX_MODEL,
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    language_hints: ['vi', 'en'],
    context: {
      general: [
        { key: 'domain', value: 'Software development' },
        { key: 'topic', value: 'Spoken instructions to an AI coding agent, in Vietnamese mixed with English code terms' }
      ],
      terms: terms.slice(0, CLOUD_TERMS_MAX)
    }
  }
}

/** Số giây đã gửi lên đám mây theo tháng (userData/voice/cloud-usage.json) để Cài đặt báo chi phí. */
export class CloudUsage {
  private months: Record<string, number> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      const j = JSON.parse(await fs.readFile(this.file, 'utf8')) as { months?: Record<string, unknown> }
      for (const [k, v] of Object.entries(j.months ?? {})) if (/^\d{4}-\d{2}$/.test(k) && typeof v === 'number' && v >= 0) this.months[k] = v
    } catch {
      this.months = {}
    }
  }

  month(now = new Date()): number {
    return this.months[now.toISOString().slice(0, 7)] ?? 0
  }

  add(seconds: number, now = new Date()): Promise<void> {
    const k = now.toISOString().slice(0, 7)
    this.months[k] = (this.months[k] ?? 0) + seconds
    const text = JSON.stringify({ months: this.months })
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      await fs.writeFile(this.file, text)
    }).catch(() => {})
    return this.writing
  }
}

/** Các lượt nói đang mở (theo id renderer đặt) + key từ kho bí mật. */
export class VoiceCloud {
  private sessions = new Map<string, CloudSession>()

  constructor(
    private d: {
      key: () => string | undefined
      url?: string
      ws?: WsFactory
      onUsage?: (seconds: number) => void
    }
  ) {}

  hasKey(): boolean {
    return !!this.d.key()
  }

  start(id: string, terms: readonly string[], onText: (final: string, partial: string) => void, onError?: (message: string) => void): void {
    const key = this.d.key()
    if (!key) throw new Error(`Chưa có API key Soniox (Cài đặt → Giọng nói, lưu trong bí mật ${SONIOX_SECRET}).`)
    this.sessions.get(id)?.cancel()
    this.sessions.set(id, new CloudSession({ key, terms, url: this.d.url, ws: this.d.ws, onText, onError }))
  }

  audio(id: string, samples: Float32Array): void {
    this.sessions.get(id)?.audio(samples)
  }

  /** Kết thúc lượt nói → chữ cuối cùng (lỗi thì ném, renderer tự chuyển sang máy trên máy nếu có). */
  async end(id: string): Promise<string> {
    const s = this.sessions.get(id)
    if (!s) throw new Error('Lượt nói đã kết thúc.')
    try {
      return await s.finish()
    } finally {
      this.sessions.delete(id)
      if (s.seconds) this.d.onUsage?.(s.seconds)
    }
  }

  cancel(id: string): void {
    const s = this.sessions.get(id)
    this.sessions.delete(id)
    s?.cancel()
    if (s?.seconds) this.d.onUsage?.(s.seconds)
  }

  /** Thử key: gửi nửa giây im lặng, chờ Soniox kết thúc bình thường. */
  async test(): Promise<void> {
    const key = this.d.key()
    if (!key) throw new Error('Chưa có API key Soniox.')
    const s = new CloudSession({ key, terms: [], url: this.d.url, ws: this.d.ws, finishTimeoutMs: 10_000 })
    s.audio(new Float32Array(8000))
    await s.finish()
  }

  shutdown(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id)
  }
}
