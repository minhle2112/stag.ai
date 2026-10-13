import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Workspace } from '@shared/types'
import type { InspectTarget, PageCmd, SaveInput } from '@shared/inspect'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' },
  ipcMain: { handle: () => {}, on: () => {} }
}))

const { InspectService, cleanTarget, pickAgent } = await import('./inspect')

let root: string
let ws: Workspace
let svc: InstanceType<typeof InspectService>
const sent: PageCmd[] = []
const queued: string[] = []
const page = {
  wsId: 'ws1',
  tabId: 'tab1',
  owner: { kind: 'user' as const },
  inspect: true,
  viewport: 'desk' as const,
  wc: {
    isDestroyed: () => false,
    send: (_ch: string, c: PageCmd) => {
      sent.push(c)
      // Trang trả lời ngay lệnh có reqId (đọc lại style): không có phần tử.
      if ('reqId' in c) queueMicrotask(() => (svc as unknown as { reqs: Map<string, (v: unknown) => void> }).reqs.get(c.reqId)?.(null))
    }
  }
}
const browser = {
  attachInspect: () => {},
  pageTab: () => page,
  page: () => page,
  pages: () => [page],
  setInspect: () => true,
  capture: async () => Buffer.from('png')
}
const agent: Agent = { id: 'ag1', workspaceId: 'ws1', name: 'Dev', role: '', permissionMode: 'default', createdAt: '' }

const target: InspectTarget = {
  tag: 'a.cta',
  label: 'Đặt bàn',
  selector: 'a.cta',
  path: 'body > a:nth-child(1)',
  text: 'Đặt bàn',
  rect: { x: 1, y: 2, w: 100, h: 40 },
  pt: { x: 0.3, y: 0.6 },
  scroll: { x: 0, y: 0 },
  viewport: { kind: 'desk', w: 1200, h: 800, dpr: 1 },
  style: 'font 14px',
  html: '<a class="cta">Đặt bàn</a>',
  source: { chip: 'html', label: 'site/index.html:29', file: 'site/index.html', line: 29 }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-insp-'))
  ws = { id: 'ws1', name: 'W', path: root, vaultPath: join(root, 'vault'), createdAt: '' } as Workspace
  sent.length = 0
  queued.length = 0
  svc = new InspectService(browser as never, (id) => (id === 'ws1' ? ws : undefined), {
    changed: () => {},
    queued: (id) => queued.push(id),
    focus: () => {}
  })
  svc.attachTeam(() => [{ id: 'ag1', name: 'Dev', running: true, busy: false }])
})

afterEach(async () => {
  await new Promise((r) => setTimeout(r, 120))
  await fs.rm(root, { recursive: true, force: true })
})

// Hàm riêng của dịch vụ (nhận IPC từ trang): gọi thẳng trong test.
const priv = (): {
  hello(p: unknown, url: string): Promise<{ pins: Array<{ id: number }>; lastAgentId: string | null }>
  pageCapture(p: unknown, a: unknown): Promise<{ captureId: string } | null>
  pageSave(p: unknown, i: SaveInput): Promise<number>
  reanchor(p: unknown, a: unknown): Promise<void>
} => svc as never

async function save(text = 'Nút to hơn', send = true, pinId?: number): Promise<number> {
  await priv().hello(page, 'http://localhost:5173/#x')
  const cap = send ? await priv().pageCapture(page, { rect: target.rect, scroll: target.scroll }) : null
  return priv().pageSave(page, {
    ...(pinId !== undefined ? { pinId } : {}),
    ...(cap ? { captureId: cap.captureId } : {}),
    target,
    url: 'http://localhost:5173/',
    title: 'Home',
    text,
    agentId: 'ag1',
    send
  })
}

const pinOf = async (id: number): Promise<Record<string, unknown>> => (await svc.snapshot('ws1')).pins.find((p) => p.id === id) as never

describe('InspectService', () => {
  it('nháp lưu xuống đĩa; gửi nháp thì cùng số, kèm ảnh vùng cắt, nhớ agent', async () => {
    const id = await save('Nút', false)
    expect(await pinOf(id)).toMatchObject({ state: 'draft', target: { pt: { x: 0.3, y: 0.6 } } })
    expect(queued).toEqual([])
    expect(await save('Nút to hơn', true, id)).toBe(id)
    const p = await pinOf(id)
    expect(p).toMatchObject({ state: 'queued', images: { before: `.stag/inspect/img/p${id}-before.png` } })
    expect((p as { thread: Array<{ text: string }> }).thread.map((m) => m.text)).toEqual(['Nút to hơn'])
    expect(queued).toEqual(['ag1'])
    expect(await fs.readFile(join(root, '.stag', 'inspect', 'img', `p${id}-before.png`), 'utf8')).toBe('png')
    const disk = JSON.parse(await fs.readFile(join(root, '.stag', 'inspect', 'index.json'), 'utf8'))
    expect(disk.lastAgent).toBe('ag1')
  })

  it('gửi → gói tin → gõ vào phiên → agent trả lời → có trả lời mới, trang tải lại → đã xem', async () => {
    const id = await save()
    const [packet] = await svc.queuedFor('ag1')
    expect(packet.text).toContain(`#${id} "Nút to hơn"`)
    expect(packet.text).toContain('source: site/index.html:29')
    expect(packet.display).toBe(`Bình luận #${id} từ chế độ Soi`)
    await svc.delivered(packet.ws, 'ag1', [id])
    expect((await pinOf(id)).state).toBe('working')
    expect(await svc.queuedFor('ag1')).toEqual([])
    const out = await svc.reply(ws, agent, { id, text: 'Đã sửa', changes: 'site/index.html:12 — padding' })
    expect(out).toContain('reply in the comment thread')
    expect((await pinOf(id)).state).toBe('new')
    expect(sent.some((c) => c.type === 'reload')).toBe(true)
    await svc.act('ws1', { type: 'read', id })
    expect((await pinOf(id)).state).toBe('read')
  })

  it('agent hỏi lại: tin trả lời, không tải lại trang', async () => {
    const id = await save()
    await svc.delivered(ws, 'ag1', [id])
    await svc.reply(ws, agent, { id, text: 'Đổi màu gì?', ask: true, quick: ['Xanh'] })
    expect((await pinOf(id)).state).toBe('new')
    expect(sent.some((c) => c.type === 'reload')).toBe(false)
  })

  it('agent chỉ trả lời bằng chữ (không có changes): không tải lại trang', async () => {
    const id = await save()
    await svc.delivered(ws, 'ag1', [id])
    await svc.reply(ws, agent, { id, text: 'Bản dịch: "Book a table"' })
    expect((await pinOf(id)).state).toBe('new')
    expect(sent.some((c) => c.type === 'reload')).toBe(false)
  })

  it('trả lời trong mạch → vòng 2 vào hàng, gói tin có lịch sử', async () => {
    const id = await save()
    await svc.delivered(ws, 'ag1', [id])
    await svc.reply(ws, agent, { id, text: 'Đã sửa', changes: 'x' })
    queued.length = 0
    await svc.act('ws1', { type: 'reply', id, text: 'To nữa' })
    expect(await pinOf(id)).toMatchObject({ state: 'queued', round: 2 })
    expect(queued).toEqual(['ag1'])
    const [packet] = await svc.queuedFor('ag1')
    expect(packet.text).toContain('now (round 2) the user says: "To nữa"')
  })

  it('đóng khi agent chưa làm: ra khỏi hàng; agent trả lời muộn → mạch vẫn đóng', async () => {
    const id = await save()
    await svc.act('ws1', { type: 'close', id })
    expect(await svc.queuedFor('ag1')).toEqual([])
    const out = await svc.reply(ws, agent, { id, text: 'Đã sửa' })
    expect(out).toContain('already closed')
    expect((await pinOf(id)).state).toBe('closed')
  })

  it('đóng mục đang trả lời: mục kế tiếp chỉ lên "đang trả lời" khi agent trả lời', async () => {
    const a = await save('Một')
    const b = await save('Hai')
    await svc.delivered(ws, 'ag1', [a, b])
    await svc.act('ws1', { type: 'close', id: a })
    expect((await pinOf(b)).state).toBe('queued')
    await svc.reply(ws, agent, { id: a, text: 'Xong' })
    expect((await pinOf(b)).state).toBe('working')
  })

  it('mở lại: agent chưa trả lời → gửi lại; đã trả lời → đã xem', async () => {
    const a = await save()
    await svc.act('ws1', { type: 'close', id: a })
    queued.length = 0
    await svc.act('ws1', { type: 'reopen', id: a })
    expect((await pinOf(a)).state).toBe('queued')
    expect(queued).toEqual(['ag1'])
    await svc.delivered(ws, 'ag1', [a])
    await svc.reply(ws, agent, { id: a, text: 'ok' })
    await svc.act('ws1', { type: 'close', id: a })
    await svc.act('ws1', { type: 'reopen', id: a })
    expect((await pinOf(a)).state).toBe('read')
  })

  it('agent khác / số lạ / nháp → lỗi', async () => {
    const id = await save()
    await expect(svc.reply(ws, { ...agent, id: 'other' }, { id, text: 'x' })).rejects.toThrow(/not to you/)
    await expect(svc.reply(ws, agent, { id: 99, text: 'x' })).rejects.toThrow(/No comment #99/)
    const d = await save('nháp', false)
    await expect(svc.reply(ws, agent, { id: d, text: 'x' })).rejects.toThrow(/not been sent/)
  })

  it('xoá nháp (xoá hết chữ); mạch đã gửi không xoá được', async () => {
    const d = await save('nháp', false)
    const s = await save()
    await svc.removeDraft('ws1', d)
    await svc.removeDraft('ws1', s)
    expect((await svc.snapshot('ws1')).pins.map((p) => p.id)).toEqual([s])
  })

  it('nháp đã bị gửi ở chỗ khác: lưu thành mục mới, không sửa mạch đã gửi', async () => {
    const id = await save()
    const again = await save('khác', false, id)
    expect(again).not.toBe(id)
    expect((await pinOf(id)).state).toBe('queued')
    await expect(priv().pageSave(page, { target, url: '', title: '', text: 'a', agentId: 'nope', send: false })).rejects.toThrow(/Agent/)
  })

  it('trang dò lại phần tử sau khi sửa: lưu khoá mới', async () => {
    const id = await save()
    await priv().reanchor(page, { id, selector: 'a.cta.big', path: 'body > a:nth-child(2)', text: 'Đặt bàn ngay', label: 'Đặt bàn ngay' })
    expect(await pinOf(id)).toMatchObject({ target: { selector: 'a.cta.big', path: 'body > a:nth-child(2)', text: 'Đặt bàn ngay', label: 'Đặt bàn ngay', pt: { x: 0.3, y: 0.6 } } })
  })

  it('trang nhận ghim của nó + agent chọn sẵn', async () => {
    const id = await save()
    const st = await priv().hello(page, 'http://localhost:5173/')
    expect(st.pins.map((p) => p.id)).toEqual([id])
    expect(st.lastAgentId).toBe('ag1')
    expect((await priv().hello(page, 'http://localhost:5173/other')).pins).toEqual([])
  })

  it('đọc dữ liệu bản Soi cũ', async () => {
    await fs.mkdir(join(root, '.stag', 'inspect'), { recursive: true })
    const old = { id: 4, url: 'http://x/', title: '', agentId: 'ag1', agentName: 'Dev', scope: 'one', state: 'review', request: 'fix', round: 1, target, thread: [{ by: 'user', text: 'a', at: '', round: 1 }], images: {}, createdAt: '', updatedAt: '' }
    await fs.writeFile(join(root, '.stag', 'inspect', 'index.json'), JSON.stringify({ version: 1, next: 5, pins: [old] }))
    expect(await pinOf(4)).toMatchObject({ state: 'read' })
    expect(await pinOf(4)).not.toHaveProperty('scope')
  })
})

describe('pickAgent', () => {
  const a = (id: string, running: boolean, busy: boolean): { id: string; name: string; running: boolean; busy: boolean; load: number } => ({ id, name: id, running, busy, load: 0 })
  it('agent lần trước → rảnh có phiên → có phiên → đầu tiên', () => {
    const team = [a('x', false, false), a('y', true, true), a('z', true, false)]
    expect(pickAgent(team, 'y')).toBe('y')
    expect(pickAgent(team, 'gone')).toBe('z')
    expect(pickAgent([a('x', false, false), a('y', true, true)], undefined)).toBe('y')
    expect(pickAgent([a('x', false, false)], undefined)).toBe('x')
    expect(pickAgent([], undefined)).toBeNull()
  })
})

describe('cleanTarget', () => {
  it('bỏ gói thiếu selector + path, cắt chuỗi dài, lọc nguồn lạ, kẹp điểm bấm', () => {
    expect(cleanTarget(undefined)).toBeNull()
    expect(cleanTarget({ ...target, selector: '', path: '' })).toBeNull()
    const t = cleanTarget({ ...target, html: 'x'.repeat(5000), pt: { x: 7, y: -1 }, source: { chip: 'evil' as never, label: 'a' }, group: { n: 1, kind: 'loop', selector: 'li' } })!
    expect(t.html).toHaveLength(1200)
    expect(t.pt).toEqual({ x: 1, y: 0 })
    expect(t.source?.chip).toBe('none')
    expect(t.group).toBeUndefined()
  })
})
