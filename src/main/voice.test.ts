import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE, type VoiceSettings } from '@shared/types'
import type { VoiceModel, VoiceStatus } from '@shared/voice'
import type { SpawnWorker, WorkerProc } from './plugins'
import { VoiceService } from './voice'

const payload = Buffer.from('giả làm file model nén '.repeat(500))
const model: VoiceModel = {
  id: 'test',
  label: 'Test',
  archive: 'test-model',
  url: 'https://example.invalid/test-model.tar.bz2',
  bytes: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex'),
  files: ['a.onnx', 'tokenizer/vocab.json']
}

/** Giải nén giả: tạo đủ file của model trong thư mục đích. */
const fakeExtract = async (_archive: string, into: string): Promise<void> => {
  await fs.mkdir(join(into, model.archive, 'tokenizer'), { recursive: true })
  await fs.writeFile(join(into, model.archive, 'a.onnx'), 'x')
  await fs.writeFile(join(into, model.archive, 'tokenizer', 'vocab.json'), '{}')
}

/** Worker giả: trả lời load / transcribe như voiceWorker.ts. */
interface FakeWorker extends WorkerProc {
  sent: Array<Record<string, unknown>>
  killed: boolean
  crash(code: number): void
}
function fakeSpawn(opts: { loadFails?: boolean; text?: string; hold?: boolean } = {}): { spawn: SpawnWorker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = []
  const spawn: SpawnWorker = () => {
    let onMsg: (m: unknown) => void = () => {}
    let onExit: (c: number | null) => void = () => {}
    const w: FakeWorker = {
      pid: 1,
      sent: [],
      killed: false,
      send(m) {
        const msg = m as { id: number; type: string; hotwords?: string[] }
        w.sent.push(msg as Record<string, unknown>)
        if (opts.hold && msg.type === 'transcribe') return
        setTimeout(() => {
          if (msg.type === 'load') onMsg(opts.loadFails ? { id: msg.id, ok: false, error: 'hỏng' } : { id: msg.id, ok: true, result: null })
          else onMsg({ id: msg.id, ok: true, result: { text: opts.text ?? 'xin chào', ms: 5, echo: false } })
        }, 1)
      },
      onMessage: (fn) => (onMsg = fn),
      onExit: (fn) => (onExit = fn),
      onOutput: () => {},
      kill() {
        w.killed = true
        setTimeout(() => onExit(null), 1)
      },
      crash(code) {
        onExit(code)
      }
    }
    workers.push(w)
    return w
  }
  return { spawn, workers }
}

let dir: string
let statuses: VoiceStatus[]
let settings: VoiceSettings

function service(extra: Partial<ConstructorParameters<typeof VoiceService>[0]> = {}): VoiceService {
  return new VoiceService({
    dir,
    spawn: fakeSpawn().spawn,
    workerScript: 'worker.js',
    env: {},
    settings: () => settings,
    onStatus: (s) => statuses.push(s),
    model,
    extract: fakeExtract,
    fetch: (async () => new Response(payload)) as typeof fetch,
    ...extra
  })
}

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'stag-voice-'))
  statuses = []
  settings = { ...DEFAULT_VOICE }
})
afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('VoiceService: tải model', () => {
  it('chưa có model → missing; tải xong (đúng SHA-256) → ready, dọn thư mục tạm', async () => {
    const v = service()
    await v.load()
    expect(v.get().model).toBe('missing')
    await v.download()
    expect(v.get().model).toBe('ready')
    expect(statuses.map((s) => s.model)).toEqual(expect.arrayContaining(['downloading', 'verifying', 'extracting', 'ready']))
    expect(existsSync(join(dir, 'models', 'test-model', 'tokenizer', 'vocab.json'))).toBe(true)
    expect(existsSync(join(dir, 'tmp'))).toBe(false)
    // Mở app lần sau: thấy model sẵn.
    const again = service()
    await again.load()
    expect(again.get().model).toBe('ready')
  })

  it('file tải về sai mã kiểm tra → lỗi, không giữ model', async () => {
    const v = service({ fetch: (async () => new Response(Buffer.from('khác hẳn'))) as typeof fetch })
    await v.download()
    expect(v.get().model).toBe('error')
    expect(v.get().error).toMatch(/không khớp mã kiểm tra/)
    expect(existsSync(join(dir, 'models', 'test-model'))).toBe(false)
  })

  it('máy chủ lỗi → error; gói thiếu file → error', async () => {
    const v = service({ fetch: (async () => new Response('nope', { status: 404 })) as typeof fetch })
    await v.download()
    expect(v.get()).toMatchObject({ model: 'error', error: expect.stringMatching(/404/) })
    const w = service({ extract: async () => {} })
    await w.download()
    expect(w.get()).toMatchObject({ model: 'error', error: expect.stringMatching(/thiếu file/) })
  })

  it('huỷ giữa chừng → missing (không báo lỗi)', async () => {
    let v!: VoiceService
    const slow = (async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(payload.subarray(0, 100)))
          init?.signal?.addEventListener('abort', () => c.error(new Error('aborted')))
          setTimeout(() => v.cancelDownload(), 5)
        }
      })
      return new Response(body)
    }) as typeof fetch
    v = service({ fetch: slow })
    await v.download()
    expect(v.get().model).toBe('missing')
    expect(v.get().error).toBeUndefined()
  })

  it.runIf(process.platform === 'win32')('giải nén thật bằng tar.exe của Windows (thư mục có dấu cách + chữ có dấu)', async () => {
    const src = join(dir, 'nguồn có dấu cách')
    await fakeExtract('', src)
    // Tạo gói bằng chính tar.exe (cũng phải dùng cwd + tên tương đối vì đường dẫn có chữ có dấu).
    execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-cjf', 'model.tar.bz2', model.archive], { cwd: src })
    const bytes = readFileSync(join(src, 'model.tar.bz2'))
    const real: VoiceModel = { ...model, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    const home = join(dir, 'dữ liệu app')
    const v = new VoiceService({
      dir: home,
      spawn: fakeSpawn().spawn,
      workerScript: 'w.js',
      env: {},
      settings: () => settings,
      onStatus: () => {},
      model: real,
      fetch: (async () => new Response(bytes)) as typeof fetch
    })
    await v.download()
    expect(v.get()).toMatchObject({ model: 'ready' })
    expect(readFileSync(join(home, 'models', 'test-model', 'tokenizer', 'vocab.json'), 'utf8')).toBe('{}')
  })

  it('xoá model', async () => {
    const v = service()
    await v.download()
    await v.removeModel()
    expect(v.get().model).toBe('missing')
    expect(existsSync(join(dir, 'models', 'test-model'))).toBe(false)
  })
})

describe('VoiceService: tiến trình nhận dạng', () => {
  async function ready(opts: Parameters<typeof fakeSpawn>[0] = {}): Promise<{ v: VoiceService; workers: FakeWorker[] }> {
    const f = fakeSpawn(opts)
    const v = service({ spawn: f.spawn })
    await v.download()
    return { v, workers: f.workers }
  }

  it('không chạy lúc mở app; chưa có model thì không bật và báo cần tải', async () => {
    const f = fakeSpawn()
    const v = service({ spawn: f.spawn })
    await v.load()
    v.prewarm()
    expect(f.workers).toHaveLength(0)
    await expect(v.transcribe(new Float32Array(10), [])).rejects.toThrow(/Chưa tải model/)
    expect(v.get().engine).toBe('off')
  })

  it('prewarm bật đúng một worker, nạp model; transcribe dùng lại worker đó, gửi gợi ý đã làm sạch + tiếng Việt', async () => {
    const { v, workers } = await ready({ text: 'sửa hàm handleClick' })
    v.prewarm()
    v.prewarm()
    expect(workers).toHaveLength(1)
    const r = await v.transcribe(new Float32Array([0.1, 0.2]), ['handleClick', 'a,b', 'handleclick'])
    expect(r.text).toBe('sửa hàm handleClick')
    expect(workers).toHaveLength(1)
    expect(v.get().engine).toBe('ready')
    const t = workers[0].sent.find((m) => m.type === 'transcribe')!
    expect(t).toMatchObject({ hotwords: ['handleClick', 'a b'], language: 'Vietnamese' })
    expect(workers[0].sent[0]).toMatchObject({ type: 'load', modelDir: join(dir, 'models', 'test-model'), threads: 4 })
  })

  it('không dùng `unloadMinutes` phút → tắt worker (trả RAM); lần sau bật worker mới', async () => {
    const { v, workers } = await ready()
    settings.unloadMinutes = 5
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = v.transcribe(new Float32Array(4), [])
    await vi.advanceTimersByTimeAsync(10)
    await p
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(workers[0].killed).toBe(false)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(workers[0].killed).toBe(true)
    expect(v.get().engine).toBe('off')
    const q = v.transcribe(new Float32Array(4), [])
    await vi.advanceTimersByTimeAsync(10)
    await q
    expect(workers).toHaveLength(2)
  })

  it('unloadMinutes = 0 → giữ tới khi tắt app', async () => {
    const { v, workers } = await ready()
    settings.unloadMinutes = 0
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = v.transcribe(new Float32Array(4), [])
    await vi.advanceTimersByTimeAsync(10)
    await p
    await vi.advanceTimersByTimeAsync(3 * 3600_000)
    expect(workers[0].killed).toBe(false)
    v.shutdown()
    expect(workers[0].killed).toBe(true)
  })

  it('giải phóng khi đang nhận dạng → lời gọi đang chờ báo lỗi, không treo', async () => {
    const { v, workers } = await ready({ hold: true })
    const p = v.transcribe(new Float32Array(4), [])
    await new Promise((r) => setTimeout(r, 10))
    v.unload()
    await expect(p).rejects.toThrow(/Đã dừng/)
    expect(workers[0].killed).toBe(true)
  })

  it('worker chết bất ngờ → báo lỗi, lần sau bật lại được', async () => {
    const { v, workers } = await ready({ hold: true })
    const p = v.transcribe(new Float32Array(4), [])
    await new Promise((r) => setTimeout(r, 10))
    workers[0].crash(3)
    await expect(p).rejects.toThrow(/thoát bất ngờ/)
    expect(v.get()).toMatchObject({ engine: 'off', error: expect.stringMatching(/mã 3/) })
  })

  it('nạp model lỗi → báo lỗi, tắt worker', async () => {
    const { v, workers } = await ready({ loadFails: true })
    await expect(v.transcribe(new Float32Array(4), [])).rejects.toThrow(/hỏng/)
    expect(workers[0].killed).toBe(true)
    expect(v.get().error).toMatch(/Không nạp được model/)
  })
})
