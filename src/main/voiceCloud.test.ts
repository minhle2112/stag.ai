import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CloudUsage, cloudError, monthKey, sonioxConfig, toPcm16, VoiceCloud, type WsFactory, type WsLike } from './voiceCloud'

/** WebSocket giả: ghi lại mọi thứ gửi đi, test tự đẩy câu trả lời của "Soniox". */
class FakeWs implements WsLike {
  binaryType = 'blob'
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  sent: Array<string | Uint8Array> = []
  closed = false
  constructor(
    public url: string,
    public headers: Record<string, string>
  ) {}
  send(d: string | ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(typeof d === 'string' ? d : new Uint8Array(d as ArrayBuffer))
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code: 1000, reason: '' })
  }
  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }
  reply(r: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(r) })
  }
}

function setup(key: string | null = 'k-test') {
  const sockets: FakeWs[] = []
  const ws: WsFactory = (url, headers) => {
    const s = new FakeWs(url, headers)
    sockets.push(s)
    return s
  }
  const usage: number[] = []
  const cloud = new VoiceCloud({ key: () => key ?? undefined, ws, onUsage: (s) => usage.push(s) })
  return { cloud, sockets, usage }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('VoiceCloud (Soniox)', () => {
  it('gửi key qua header, cấu hình tiếng Việt + từ gợi ý trước, âm thanh đã chờ lúc chưa mở; chữ hiện dần rồi chữ cuối', async () => {
    const { cloud, sockets, usage } = setup()
    const texts: Array<[string, string]> = []
    cloud.start('a1', ['handleClick', 'App.tsx'], (f, p) => texts.push([f, p]))
    const ws = sockets[0]
    expect(ws.headers).toEqual({ Authorization: 'Bearer k-test' })
    cloud.audio('a1', new Float32Array(1600))
    expect(ws.sent).toHaveLength(0)
    ws.open()
    const cfg = JSON.parse(ws.sent[0] as string)
    expect(cfg).toMatchObject({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16000, num_channels: 1, language_hints: ['vi', 'en'] })
    expect(cfg.context.terms).toEqual(['handleClick', 'App.tsx'])
    expect((ws.sent[1] as Uint8Array).length).toBe(3200)
    expect(JSON.stringify(cfg)).not.toContain('k-test')

    ws.reply({ tokens: [{ text: 'Sửa', is_final: true }, { text: ' hàm', is_final: false }] })
    ws.reply({ tokens: [{ text: ' hàm', is_final: true }, { text: ' handle', is_final: false }] })
    expect(texts.at(-1)).toEqual(['Sửa hàm', 'handle'])

    const end = cloud.end('a1')
    await tick()
    expect(ws.sent.at(-1)).toBe('')
    ws.reply({ tokens: [{ text: ' handleClick', is_final: true }, { text: '<fin>', is_final: true }] })
    ws.reply({ tokens: [], finished: true })
    await expect(end).resolves.toBe('Sửa hàm handleClick')
    expect(ws.closed).toBe(true)
    expect(usage).toEqual([0.1])
  })

  it('kết thúc trước khi kết nối kịp mở: gửi cấu hình, âm thanh rồi mới báo hết', async () => {
    const { cloud, sockets } = setup()
    cloud.start('a2', [], () => {})
    cloud.audio('a2', new Float32Array(160))
    const end = cloud.end('a2')
    sockets[0].open()
    expect(sockets[0].sent.map((x) => (typeof x === 'string' ? (x ? 'cfg' : 'END') : 'pcm'))).toEqual(['cfg', 'pcm', 'END'])
    sockets[0].reply({ tokens: [{ text: 'ok', is_final: true }], finished: true })
    await expect(end).resolves.toBe('ok')
  })

  it('chưa có key → báo ngay, không mở kết nối', () => {
    const { cloud, sockets } = setup(null)
    expect(() => cloud.start('a3', [], () => {})).toThrow(/Chưa có API key Soniox/)
    expect(sockets).toHaveLength(0)
    expect(cloud.hasKey()).toBe(false)
  })

  it('key sai / hết tiền / mất mạng / đóng giữa chừng → lỗi dễ hiểu', async () => {
    const { cloud, sockets } = setup()
    cloud.start('b1', [], () => {})
    sockets[0].open()
    sockets[0].reply({ tokens: [], error_code: 401, error_type: 'unauthenticated', error_message: 'Incorrect API key provided.' })
    await expect(cloud.end('b1')).rejects.toThrow(/API key Soniox không đúng/)

    // Lỗi báo ngay lúc xảy ra (renderer bật máy trên máy trong lúc người dùng còn nói), không đợi tới lúc kết thúc.
    const errors: string[] = []
    cloud.start('b2', [], () => {}, (m) => errors.push(m))
    sockets[1].onerror?.({})
    expect(errors).toEqual(['Không kết nối được Soniox (kiểm tra mạng).'])
    await expect(cloud.end('b2')).rejects.toThrow(/Không kết nối được Soniox/)

    cloud.start('b3', [], () => {})
    sockets[2].open()
    const end = cloud.end('b3')
    sockets[2].close()
    await expect(end).rejects.toThrow(/đóng kết nối giữa chừng/)

    expect(cloudError({ error_code: 402, error_type: 'payment_required' })).toMatch(/hết tiền/)
    expect(cloudError({ error_code: 429 })).toMatch(/giới hạn/)
  })

  it('huỷ → đóng kết nối, vẫn tính giây đã gửi; lượt đã huỷ thì end báo lỗi', async () => {
    const { cloud, sockets, usage } = setup()
    cloud.start('c1', [], () => {})
    sockets[0].open()
    cloud.audio('c1', new Float32Array(16000))
    cloud.cancel('c1')
    expect(sockets[0].closed).toBe(true)
    expect(usage).toEqual([1])
    await expect(cloud.end('c1')).rejects.toThrow(/đã kết thúc/)
  })

  it('test(): gửi nửa giây im lặng, thành công khi Soniox kết thúc bình thường', async () => {
    const { cloud, sockets } = setup()
    const t = cloud.test()
    sockets[0].open()
    expect((sockets[0].sent[1] as Uint8Array).length).toBe(16000)
    sockets[0].reply({ tokens: [], finished: true })
    await expect(t).resolves.toBeUndefined()
  })

  it('toPcm16 + giới hạn từ gợi ý', () => {
    const pcm = toPcm16(new Float32Array([0, 1, -1, 2]))
    const v = new DataView(pcm.buffer)
    expect([v.getInt16(0, true), v.getInt16(2, true), v.getInt16(4, true), v.getInt16(6, true)]).toEqual([0, 32767, -32768, 32767])
    const many = Array.from({ length: 400 }, (_, i) => `t${i}`)
    expect((sonioxConfig(many).context as { terms: string[] }).terms).toHaveLength(150)
  })
})

describe('CloudUsage', () => {
  it('cộng giây theo tháng, lưu ra file, mở lại vẫn còn', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag-cloud-'))
    try {
      const file = join(dir, 'voice', 'cloud-usage.json')
      const u = new CloudUsage(file)
      await u.load()
      const oct = new Date(2026, 9, 9, 10)
      await u.add(30, oct)
      await u.add(12.5, oct)
      await u.add(99, new Date(2026, 10, 1, 10))
      const again = new CloudUsage(file)
      await again.load()
      expect(again.month(oct)).toBe(42.5)
      expect(again.month(new Date(2026, 11, 1))).toBe(0)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('tính theo tháng giờ máy, không theo UTC', async () => {
    expect(monthKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01')
    expect(monthKey(new Date(2026, 11, 31, 23, 55))).toBe('2026-12')
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag-cloud-'))
    try {
      const u = new CloudUsage(join(dir, 'cloud-usage.json'))
      // 00:30 ngày 1/11 giờ máy (ở VN theo UTC vẫn là 31/10): tính vào tháng 11.
      await u.add(20, new Date(2026, 10, 1, 0, 30))
      await u.add(5, new Date(2026, 9, 31, 23, 30))
      expect(u.month(new Date(2026, 10, 15))).toBe(20)
      expect(u.month(new Date(2026, 9, 15))).toBe(5)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
