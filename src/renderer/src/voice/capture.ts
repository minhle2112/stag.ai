import { VOICE_RATE } from '@shared/voice'

/** Người nói hay bắt đầu ngay lúc nhấn phím: giữ 0,3 s âm thanh trước khi nhấn (khi micro đang mở sẵn). */
export const PRE_MS = 300
/** …và thả phím trước khi dứt chữ cuối (V0: 13/16 câu bị cụt): thu thêm 0,5 s sau khi thả. */
export const POST_MS = 500
/** Giữ micro mở thêm một lúc sau khi nói để lần nói kế tiếp không phải chờ mở lại (đèn micro của Windows vẫn sáng). */
export const WARM_MS = 30_000

/**
 * Thu âm 16 kHz mono qua AudioWorklet (public/voice-capture.js). AudioContext chạy thẳng ở 16 kHz:
 * Chromium tự đổi tần số mẫu của micro. Micro chỉ mở khi bạn nói (và WARM_MS sau đó), không mở sẵn.
 */
export class MicCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private micId: string | null = null
  private opening: Promise<void> | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  /** Khối âm thanh gần nhất khi chưa ghi (pre-roll). */
  private pre: Float32Array[] = []
  private preLen = 0
  /** Đang ghi: bộ đệm liền (lớn dần). */
  private buf: Float32Array | null = null
  private len = 0
  onLevel: (peak: number) => void = () => {}

  get recording(): boolean {
    return this.buf !== null
  }

  /** Mở micro (đổi micro thì mở lại). Lỗi quyền / không có micro thì ném ra. */
  open(micId: string): Promise<void> {
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = null
    if (this.ctx && this.micId === micId) return Promise.resolve()
    if (this.opening) return this.opening
    this.opening = (async () => {
      this.close()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: micId ? { exact: micId } : undefined,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      try {
        const ctx = new AudioContext({ sampleRate: VOICE_RATE })
        await ctx.audioWorklet.addModule(new URL('voice-capture.js', document.baseURI).href)
        const node = new AudioWorkletNode(ctx, 'voice-tap')
        node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data)
        ctx.createMediaStreamSource(stream).connect(node)
        this.ctx = ctx
        this.stream = stream
        this.micId = micId
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop())
        throw e
      }
    })().finally(() => (this.opening = null))
    return this.opening
  }

  private push(s: Float32Array): void {
    let peak = 0
    for (let i = 0; i < s.length; i++) peak = Math.max(peak, Math.abs(s[i]))
    this.onLevel(peak)
    if (this.buf) {
      if (this.len + s.length > this.buf.length) {
        const next = new Float32Array(Math.max(this.buf.length * 2, this.len + s.length))
        next.set(this.buf.subarray(0, this.len))
        this.buf = next
      }
      this.buf.set(s, this.len)
      this.len += s.length
    } else {
      this.pre.push(s)
      this.preLen += s.length
      while (this.pre.length > 1 && this.preLen - this.pre[0].length >= (VOICE_RATE * PRE_MS) / 1000) this.preLen -= this.pre.shift()!.length
    }
  }

  /** Bắt đầu ghi, kèm phần pre-roll đang có. */
  start(): void {
    this.buf = new Float32Array(VOICE_RATE * 30)
    this.len = 0
    const pre = this.pre
    this.pre = []
    this.preLen = 0
    for (const p of pre) this.push(p)
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  /** Âm thanh đã ghi tới giờ (view, không chép). */
  samples(): Float32Array {
    return this.buf ? this.buf.subarray(0, this.len) : new Float32Array(0)
  }

  /** Thôi ghi sau POST_MS; trả về toàn bộ âm thanh đã ghi. */
  async stop(postMs = POST_MS): Promise<Float32Array> {
    if (!this.buf) return new Float32Array(0)
    if (postMs > 0) await new Promise((r) => setTimeout(r, postMs))
    const out = this.samples().slice()
    this.buf = null
    this.len = 0
    return out
  }

  /** Bỏ bản đang ghi (Esc khi đang nói). */
  discard(): void {
    this.buf = null
    this.len = 0
  }

  /** Đóng micro sau WARM_MS không dùng. */
  closeLater(ms = WARM_MS): void {
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = setTimeout(() => this.close(), ms)
  }

  close(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = null
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close().catch(() => {})
    this.stream = null
    this.ctx = null
    this.micId = null
    this.pre = []
    this.preLen = 0
    this.buf = null
    this.len = 0
  }
}
