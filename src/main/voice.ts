import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { join, relative } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cleanHotwords, VOICE_MODEL, type VoiceModel, type VoiceResult, type VoiceStatus } from '@shared/voice'
import { HOTWORD_MAX } from '@shared/voiceVocab'
import type { VoiceSettings } from '@shared/types'
import type { SpawnWorker, WorkerProc } from './plugins'

/**
 * Gõ bằng giọng nói (V1) — phía main. Model Qwen3-ASR tải về userData/voice/models khi người dùng bấm Tải
 * (không kèm bộ cài, ~880 MB), kiểm SHA-256, giải nén bằng tar của Windows.
 *
 * Nhận dạng chạy trong một utilityProcess riêng (voiceWorker.ts): **không chạy lúc mở app** (0 RAM khi không dùng),
 * bật khi người dùng bắt đầu nói (`prewarm`, nạp ~2,5 s trùng lúc đang nói), tắt sau `unloadMinutes` không dùng
 * (đo 2026-10-09: ~1,15 GB khi nạp xong, ~1,4 GB sau khi nhận dạng, giữ nguyên tới khi tắt tiến trình).
 */
export interface VoiceDeps {
  /** userData/voice */
  dir: string
  spawn: SpawnWorker
  /** Đường dẫn file worker đã build (out/main/voiceWorker.js). */
  workerScript: string
  env: NodeJS.ProcessEnv
  settings: () => VoiceSettings
  onStatus: (s: VoiceStatus) => void
  fetch?: typeof fetch
  model?: VoiceModel
  /** Lệnh giải nén .tar.bz2 (mặc định tar.exe của Windows). */
  extract?: (archive: string, into: string) => Promise<void>
  /** Số luồng CPU cho nhận dạng (V0: 4 là vừa, 2 chậm hơn, 8 không nhanh hơn). */
  threads?: number
  /** Hết giờ chờ worker (ms). */
  timeoutMs?: number
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Giải nén .tar.bz2 bằng tar của Windows (bsdtar). Gọi bằng đường dẫn đầy đủ: tar GNU (Git Bash) trong PATH hiểu "C:" là
 * máy từ xa. tar.exe đọc tham số theo bảng mã ANSI nên hỏng với đường dẫn có chữ tiếng Việt (vd. tài khoản Windows
 * "Nguyễn…"): đặt thư mục làm việc (Node truyền bằng API Unicode) và chỉ đưa tên tương đối (`archive` phải là tên ASCII).
 */
function windowsExtract(archive: string, into: string): Promise<void> {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  return new Promise((resolve, reject) =>
    execFile(tar, ['-xjf', relative(into, archive)], { cwd: into, windowsHide: true, maxBuffer: 1 << 20 }, (err, _out, stderr) =>
      err ? reject(new Error(`Giải nén không được: ${String(stderr || err.message).trim().slice(0, 300)}`)) : resolve()
    )
  )
}

export class VoiceService {
  private model: VoiceModel
  private status: VoiceStatus = { model: 'missing', engine: 'off' }
  private abort: AbortController | null = null
  private proc: WorkerProc | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private d: VoiceDeps) {
    this.model = d.model ?? VOICE_MODEL
  }

  get modelDir(): string {
    return join(this.d.dir, 'models', this.model.archive)
  }

  get(): VoiceStatus {
    return { ...this.status }
  }

  private set(patch: Partial<VoiceStatus>, replace = false): void {
    this.status = replace ? ({ engine: this.status.engine, ...patch } as VoiceStatus) : { ...this.status, ...patch }
    this.d.onStatus(this.get())
  }

  private hasModel(): boolean {
    return this.model.files.every((f) => existsSync(join(this.modelDir, f)))
  }

  /** Đọc trạng thái model trên đĩa lúc mở app (không bật worker). */
  async load(): Promise<void> {
    this.set({ model: this.hasModel() ? 'ready' : 'missing' }, true)
  }

  // ---------- tải model ----------

  /** Tải + kiểm + giải nén model. Chạy nền; tiến độ / lỗi báo qua onStatus. */
  async download(): Promise<void> {
    if (this.abort || this.status.model === 'ready') return
    const abort = new AbortController()
    this.abort = abort
    const tmp = join(this.d.dir, 'tmp')
    // Tên ASCII cố định: tar.exe chỉ nhận tên tương đối, không đọc được chữ có dấu (xem windowsExtract).
    const file = join(tmp, 'model.tar.bz2')
    const out = join(tmp, 'extract')
    try {
      await fs.rm(tmp, { recursive: true, force: true })
      await fs.mkdir(out, { recursive: true })
      this.set({ model: 'downloading', received: 0, total: this.model.bytes }, true)

      const res = await (this.d.fetch ?? fetch)(this.model.url, { signal: abort.signal })
      if (!res.ok || !res.body) throw new Error(`Máy chủ trả về lỗi ${res.status}.`)
      const hash = createHash('sha256')
      let received = 0
      let last = 0
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, cb) => {
          hash.update(chunk)
          received += chunk.length
          const now = Date.now()
          if (now - last > 250) {
            last = now
            this.set({ received })
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), meter, createWriteStream(file), { signal: abort.signal })
      this.set({ model: 'verifying', received })
      if (received !== this.model.bytes || hash.digest('hex') !== this.model.sha256)
        throw new Error('File tải về không khớp mã kiểm tra (có thể bị hỏng giữa đường). Thử tải lại.')

      this.set({ model: 'extracting' })
      await (this.d.extract ?? windowsExtract)(file, out)
      if (abort.signal.aborted) throw new Error('aborted')
      const unpacked = join(out, this.model.archive)
      if (!this.model.files.every((f) => existsSync(join(unpacked, f)))) throw new Error('Gói model thiếu file, không dùng được.')
      await fs.mkdir(join(this.d.dir, 'models'), { recursive: true })
      await fs.rm(this.modelDir, { recursive: true, force: true })
      await fs.rename(unpacked, this.modelDir)
      this.set({ model: 'ready' }, true)
    } catch (e) {
      const cancelled = abort.signal.aborted
      this.set(cancelled ? { model: 'missing' } : { model: 'error', error: String((e as Error)?.message ?? e) }, true)
    } finally {
      this.abort = null
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }

  cancelDownload(): void {
    this.abort?.abort()
  }

  /** Xoá model đã tải (người dùng bấm Xoá trong Cài đặt): tắt worker trước. */
  async removeModel(): Promise<void> {
    this.cancelDownload()
    this.unload()
    await fs.rm(this.modelDir, { recursive: true, force: true })
    this.set({ model: 'missing' }, true)
  }

  // ---------- worker ----------

  /** Người dùng bắt đầu nói: bật worker + nạp model ngay để lúc thả phím đã sẵn sàng. */
  prewarm(): void {
    if (this.status.model !== 'ready') return
    void this.ensureWorker().catch(() => {})
  }

  private ensureWorker(): Promise<void> {
    if (this.ready) return this.ready
    if (this.status.model !== 'ready') return Promise.reject(new Error('Chưa tải model nhận dạng giọng nói (Cài đặt → Giọng nói).'))
    const proc = this.d.spawn(this.d.workerScript, { cwd: this.d.dir, env: this.d.env, name: 'voice' })
    this.proc = proc
    proc.onMessage((raw) => {
      const m = raw as { id: number; ok: boolean; result?: unknown; error?: string }
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error || 'Lỗi nhận dạng.'))
    })
    proc.onOutput((text, err) => {
      // sherpa in log C++ ra stderr (gợi ý max_total_len…): chỉ ghi khi chạy dev.
      if (err && process.env.STAG_VOICE_DEBUG) console.error('[voice]', text.trim().slice(0, 500))
    })
    // Thoát bất ngờ (unload() đã gỡ proc trước khi kill nên không vào đây).
    proc.onExit((code) => {
      if (this.proc !== proc) return
      this.drop(`Tiến trình nhận dạng thoát bất ngờ (mã ${code}).`)
      this.set({ engine: 'off', error: `Tiến trình nhận dạng thoát bất ngờ (mã ${code}).` })
    })
    this.set({ engine: 'loading', error: undefined })
    const ready = this.call('load', { modelDir: this.modelDir, threads: this.d.threads ?? 4 }).then(
      () => {
        if (this.proc === proc) this.set({ engine: 'ready' })
        this.touch()
      },
      (e: Error) => {
        if (this.proc === proc) {
          this.unload()
          this.set({ error: `Không nạp được model: ${e.message}` })
        }
        throw e
      }
    )
    this.ready = ready
    return ready
  }

  private call(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const proc = this.proc
    if (!proc) return Promise.reject(new Error('Tiến trình nhận dạng chưa chạy.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Nhận dạng quá lâu, đã huỷ.'))
      }, this.d.timeoutMs ?? 90_000)
      this.pending.set(id, { resolve, reject, timer })
      proc.send({ id, type, ...payload })
    })
  }

  /** Nhận dạng một đoạn âm thanh 16 kHz mono (≤ ~12 s, renderer đã cắt). */
  async transcribe(samples: Float32Array, hotwords: readonly string[]): Promise<VoiceResult> {
    await this.ensureWorker()
    this.touch()
    try {
      return (await this.call('transcribe', { samples, hotwords: cleanHotwords(hotwords, HOTWORD_MAX), language: 'Vietnamese' })) as VoiceResult
    } finally {
      this.touch()
    }
  }

  /** Hẹn giờ tắt worker khi không dùng (đổi Cài đặt cũng gọi lại). */
  touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const min = this.d.settings().unloadMinutes
    if (!this.proc || min <= 0) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.pending.size) return this.touch()
      this.unload()
    }, min * 60_000)
    this.idleTimer.unref?.()
  }

  /** Gỡ worker hiện tại khỏi dịch vụ ngay (lần nói sau bật worker mới), báo lỗi cho các lời gọi đang chờ. */
  private drop(reason: string): WorkerProc | null {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    const proc = this.proc
    this.proc = null
    this.ready = null
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason))
    }
    this.pending.clear()
    return proc
  }

  /** Tắt worker: hệ điều hành lấy lại toàn bộ RAM của model. */
  unload(): void {
    const proc = this.drop('Đã dừng nhận dạng.')
    if (!proc) return
    proc.kill()
    this.set({ engine: 'off' })
  }

  shutdown(): void {
    this.cancelDownload()
    this.unload()
  }
}
