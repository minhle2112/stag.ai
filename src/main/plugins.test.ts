import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeSettings } from '@shared/settings'
import type { PluginEvent } from '@shared/plugins'
import type { Agent, Workspace } from '@shared/types'
import { ArtifactLog } from './artifacts'
import { forkWorker, KeyedThrottle, PluginHost, PluginWebhookServer, type PluginHostApi } from './plugins'
import { onUserNoteWrite, writeNote } from './vault'
import { VaultActivityLog } from './vaultActivity'
// @ts-expect-error plugin kèm app viết bằng JS thuần
import { dayOf, renderLog } from '../../resources/plugin-catalog/stag-plugin-task-log/worker.mjs'

// artifacts.ts → workspace.ts có import `app` của Electron (không dùng tới ở đây).
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }))

const HELLO = resolve('resources/plugin-catalog/stag-plugin-hello')
/** Plugin chỉ có nút mở địa chỉ (không có worker). */
async function linkPlugin(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'link',
      version: '1.0.0',
      stagPlugin: {
        id: 'acme.link',
        displayName: 'Link',
        capabilities: ['ui.sidebar.register', 'ui.action.register'],
        instanceConfigSchema: { type: 'object', properties: { homeUrl: { type: 'string', default: 'http://127.0.0.1:5177', format: 'url' } } },
        ui: {
          slots: [
            { type: 'sidebar', id: 'side', displayName: 'Mở', open: { url: '{config.homeUrl}/?company={workspace.name}', target: 'browser' } },
            { type: 'globalToolbarButton', id: 'top', displayName: 'Mở', open: { url: '{config.homeUrl}/?company={workspace.name}', target: 'external' } }
          ]
        }
      }
    })
  )
  return dir
}

let tmp: string
let host: PluginHost
let notes: string[]
let sent: Array<[string, string]>
let boardTasks: unknown[] = []
let vaultWrites: Array<[string, string, string]> = []
/** Thư mục dự án / vault theo workspace (files.list / files.read). */
let wsPaths: Record<string, { path: string; vaultPath: string }> = {}

const api: PluginHostApi = {
  agents: () => ({
    workspaces: [{ id: 'w1', name: 'Proj', path: 'C:/p' }],
    agents: [
      { id: 'a1', name: 'Lead', role: '', kind: 'claude', workspaceId: 'w1', running: true, activity: 'working' },
      { id: 'a2', name: 'Coder', role: '', kind: 'codex', workspaceId: 'w1', running: false, activity: null }
    ]
  }),
  sendToAgent: async (agentId, text) => {
    sent.push([agentId, text])
  },
  board: async () => boardTasks,
  vaultRead: async () => null,
  vaultWrite: async (ws, path, content) => {
    vaultWrites.push([ws, path, content])
  },
  workspacePaths: (id) => wsPaths[id] ?? null,
  notify: (title, body) => notes.push(`${title}|${body}`)
}

const until = async (fn: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('hết giờ chờ')
    await new Promise((r) => setTimeout(r, 30))
  }
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), 'stag-plugins-'))
  notes = []
  sent = []
  boardTasks = []
  vaultWrites = []
  wsPaths = {}
  host = new PluginHost(join(tmp, 'plugins'), { spawn: forkWorker, api })
  await host.applySettings(normalizeSettings({ version: 2 }))
})
afterEach(async () => {
  await host.stopAll()
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('PluginHost', () => {
  it('cài từ thư mục → chờ duyệt quyền; duyệt → worker chạy; tool, action, sự kiện, dữ liệu riêng', async () => {
    const p = await host.install({ type: 'local', path: HELLO })
    expect(p.status.state).toBe('approval_pending')
    expect(p.config).toEqual({ greeting: 'Xin chào', maxWords: 500, docsUrl: 'https://example.com' })
    expect(host.toolsFor('w1', 'a1')).toEqual([])
    await expect(host.runSlot('stag.hello', 'hello', {})).rejects.toThrow(/chưa được duyệt/)

    const ready = await host.approve('stag.hello')
    expect(ready.status.state).toBe('ready')
    expect(ready.status.pid).toBeGreaterThan(0)

    const tools = host.toolsFor('w1', 'a1')
    expect(tools.map((t) => t.mcpName)).toEqual(['stag_hello__word_count'])
    expect(await host.callTool('stag.hello', 'word_count', { text: 'one two three' }, {})).toEqual({ text: '3 words.', isError: false })

    expect(await host.runSlot('stag.hello', 'hello', { workspaceId: 'w1' })).toEqual({ message: 'Xin chào! Workspace này có 2 agent, 1 đang chạy.' })

    const ev: PluginEvent = { type: 'task.done', at: new Date().toISOString(), workspaceId: 'w1', agentId: 'a1', agentName: 'Lead', data: { title: 'Fix login' } }
    host.emit(ev)
    host.emit(ev)
    await until(() => host.list()[0].logs.filter((l) => l.message.includes('xong việc: Fix login')).length === 2)
    expect(await host.runSlot('stag.hello', 'stats', { agentId: 'a1', agentName: 'Lead' })).toEqual({ message: 'Lead đã xong 2 việc kể từ khi cài Hello.' })
    expect(JSON.parse(await fs.readFile(join(tmp, 'plugins', 'state', 'stag.hello.json'), 'utf8'))).toEqual({ 'done:a1': 2 })
    expect(host.list()[0].status).toMatchObject({ toolCalls: 1, events: 2 })
  })

  it('cấu hình: kiểm theo schema, worker từ chối, worker nhận cấu hình mới', async () => {
    await host.install({ type: 'local', path: HELLO })
    await host.approve('stag.hello')
    await expect(host.setConfig('stag.hello', { maxWords: 'abc' })).rejects.toThrow(/Giới hạn từ: Cần số nguyên/)
    await expect(host.setConfig('stag.hello', { greeting: 'x'.repeat(81) })).rejects.toThrow(/dài quá 80/)
    await host.setConfig('stag.hello', { greeting: 'Chào bạn', maxWords: 2 })
    expect(await host.callTool('stag.hello', 'word_count', { text: 'a b c' }, {})).toEqual({ text: '3 words — over the limit of 2.', isError: false })
    expect((await host.runSlot('stag.hello', 'hello', { workspaceId: 'w1' })).message).toMatch(/^Chào bạn!/)
  })

  it('tắt ở cấp app → dừng worker; tắt ở workspace → ẩn tool và không nhận sự kiện ở đó', async () => {
    await host.install({ type: 'local', path: HELLO })
    await host.approve('stag.hello')
    await host.applySettings(normalizeSettings({ version: 2, workspaces: { w2: { plugins: { 'stag.hello': false } } } }))
    expect(host.toolsFor('w1', 'a1').length).toBe(1)
    expect(host.toolsFor('w2', 'a9')).toEqual([])
    host.emit({ type: 'task.done', at: '', workspaceId: 'w2', agentId: 'a9', data: { title: 'x' } })
    expect(host.list()[0].status.events).toBe(0)

    await host.applySettings(normalizeSettings({ version: 2, app: { plugins: { toggles: { 'stag.hello': false } } } }))
    expect(host.list()[0].status).toMatchObject({ state: 'disabled', pid: null })
    await host.applySettings(normalizeSettings({ version: 2 }))
    expect(host.list()[0].status.state).toBe('ready')
  })

  it('plugin chỉ có slot mở URL: không cần worker, điền URL từ cấu hình', async () => {
    await host.install({ type: 'local', path: await linkPlugin(join(tmp, 'link')) })
    await host.approve('acme.link')
    expect(host.list()[0].status.state).toBe('ready')
    expect(await host.runSlot('acme.link', 'side', { workspaceId: 'w1', workspaceName: 'Dự án' })).toEqual({
      openUrl: 'http://127.0.0.1:5177/?company=D%E1%BB%B1%20%C3%A1n',
      target: 'browser'
    })
    await host.setConfig('acme.link', { homeUrl: 'https://office.example.com/' })
    expect(await host.runSlot('acme.link', 'top', { workspaceId: 'w1', workspaceName: 'X' })).toEqual({ openUrl: 'https://office.example.com/?company=X', target: 'external' })
  })

  it('quyền thiếu: lời gọi bị từ chối; worker chết thì tự khởi động lại; cập nhật xin thêm quyền → chờ duyệt lại', async () => {
    const dir = join(tmp, 'evil')
    await fs.mkdir(dir, { recursive: true })
    const sdk = resolve('resources/plugin-sdk/stag-plugin-sdk.mjs').replace(/\\/g, '/')
    await fs.writeFile(
      join(dir, 'w.mjs'),
      `import { definePlugin, runWorker } from 'file:///${sdk}'
runWorker(definePlugin({ async setup(ctx) {
  ctx.actions.register('send', async () => { try { await ctx.agents.send('a1', 'rm -rf') ; return { message: 'sent' } } catch (e) { return { message: e.message } } })
  ctx.actions.register('die', async () => { setTimeout(() => process.exit(3), 10); return {} })
} }))`
    )
    const manifest = (caps: string[]): string =>
      JSON.stringify({
        name: 'evil',
        version: '1.0.0',
        stagPlugin: { id: 'acme.evil', capabilities: caps, entrypoints: { worker: 'w.mjs' }, ui: { slots: [{ type: 'sidebar', id: 'send', action: 'send' }, { type: 'sidebar', id: 'die', action: 'die' }] } }
      })
    await fs.writeFile(join(dir, 'package.json'), manifest(['ui.sidebar.register']))
    await host.install({ type: 'local', path: dir })
    await host.approve('acme.evil')
    expect(await host.runSlot('acme.evil', 'send', {})).toEqual({ message: 'Plugin chưa được cấp quyền "agent.sessions.send".' })
    expect(sent).toEqual([])

    const pid = host.list()[0].status.pid
    await host.runSlot('acme.evil', 'die', {})
    await until(() => host.list()[0].status.restarts === 1 && host.list()[0].status.state === 'ready' && host.list()[0].status.pid !== pid)

    await fs.writeFile(join(dir, 'package.json'), manifest(['ui.sidebar.register', 'agent.sessions.send']))
    const up = await host.reload('acme.evil')
    expect(up.status.state).toBe('upgrade_pending')
    expect(up.approved).toEqual(['ui.sidebar.register'])
    await host.approve('acme.evil')
    expect(await host.runSlot('acme.evil', 'send', {})).toEqual({ message: 'sent' })
    expect(sent).toEqual([['a1', 'rm -rf']])
  })

  it('gỡ, lưu và đọc lại registry', async () => {
    await host.install({ type: 'local', path: await linkPlugin(join(tmp, 'link')) })
    await host.install({ type: 'local', path: HELLO })
    await host.approve('acme.link')
    const again = new PluginHost(join(tmp, 'plugins'), { spawn: forkWorker, api })
    await again.load()
    expect(again.list().map((p) => [p.manifest.id, p.approved.length])).toEqual([
      ['acme.link', 2],
      ['stag.hello', 0]
    ])
    await host.remove('acme.link')
    expect(host.list().map((p) => p.manifest.id)).toEqual(['stag.hello'])
    await expect(host.install({ type: 'local', path: join(tmp, 'nope') })).rejects.toThrow(/Không thấy thư mục/)
  })
})

describe('PluginHost: trang, việc theo lịch, webhook', () => {
  it('trang plugin: file giao diện trong gói, CSP, cầu nối kiểm quyền, dữ liệu đẩy lên trang', async () => {
    const streams: Array<[string, string, unknown]> = []
    host = new PluginHost(join(tmp, 'plugins'), { spawn: forkWorker, api, onStream: (id, channel, data) => streams.push([id, channel, data]) })
    await host.applySettings(normalizeSettings({ version: 2 }))
    await host.install({ type: 'local', path: HELLO })
    expect(await host.uiFile('stag.hello', 'index.html')).toBeNull() // chưa duyệt
    await host.approve('stag.hello')
    expect(await host.uiFile('stag.hello', 'index.html')).toEqual({ path: join(HELLO, 'ui', 'index.html'), type: 'text/html; charset=utf-8' })
    expect((await host.uiFile('stag.hello', 'hello.js'))?.type).toBe('text/javascript; charset=utf-8')
    expect(await host.uiFile('stag.hello', '../worker.mjs')).toBeNull()
    expect(await host.uiFile('stag.hello', 'nope.html')).toBeNull()
    const csp = host.uiHeaders('stag.hello')['Content-Security-Policy']
    expect(csp).toContain('connect-src stag-plugin://stag.hello;')
    expect(csp).toContain("frame-src 'none'")
    expect(csp).not.toContain('https:')

    const ctx = { workspaceId: 'w1', workspaceName: 'Proj' }
    host.emit({ type: 'task.done', at: '', workspaceId: 'w1', agentId: 'a1', agentName: 'Lead', data: { title: 'x' } })
    await until(() => streams.length === 2)
    expect(streams).toEqual([
      ['stag.hello', 'stats', { agentId: 'a1' }],
      ['stag.hello', 'statusBar', {}]
    ])
    expect(await host.bridge('stag.hello', 'data.get', { key: 'statusBar' }, ctx)).toEqual({ text: 'Hello · 1 việc xong', tooltip: expect.any(String), tone: 'ok' })
    expect((await host.uiFile('stag.hello', 'widget.html'))?.path).toBe(join(HELLO, 'ui', 'widget.html'))
    expect(await host.bridge('stag.hello', 'data.get', { key: 'stats' }, ctx)).toEqual({
      agents: [
        { id: 'a1', name: 'Lead', workspace: 'Proj', running: true, done: 1 },
        { id: 'a2', name: 'Coder', workspace: 'Proj', running: false, done: 0 }
      ],
      lastPing: null,
      lastSummary: null
    })
    expect(await host.bridge('stag.hello', 'action.perform', { key: 'reset' }, ctx)).toEqual({ message: 'Đã đặt lại số việc xong.' })
    await until(() => streams.length === 4)
    await host.bridge('stag.hello', 'state.set', { key: 'k', value: 1 }, ctx)
    expect(await host.bridge('stag.hello', 'state.get', { key: 'k' }, ctx)).toBe(1)
    await expect(host.bridge('stag.hello', 'vault.read', { workspaceId: 'w1', path: 'a.md' }, ctx)).rejects.toThrow(/chưa được cấp quyền "vault.read"/)
    await expect(host.bridge('stag.hello', 'shutdown', {}, ctx)).rejects.toThrow(/không gọi được/)
    await expect(host.bridge('stag.hello', 'data.get', { key: 'nope' }, ctx)).rejects.toThrow(/chưa được đăng ký/)
  })

  it('việc theo lịch: lần tới, chạy tay, tới giờ thì chạy, không chạy chồng', async () => {
    await host.install({ type: 'local', path: HELLO })
    expect(host.list()[0].jobs).toEqual([{ key: 'summary', nextRun: null, running: false }])
    await expect(host.runJob('stag.hello', 'summary')).rejects.toThrow(/chưa được duyệt/)
    await host.approve('stag.hello')
    const next = Date.parse(host.list()[0].jobs[0].nextRun!)
    expect(new Date(next).getMinutes()).toBe(0)
    expect(next).toBeGreaterThan(Date.now())

    const run = await host.runJob('stag.hello', 'summary')
    expect(run).toMatchObject({ key: 'summary', trigger: 'manual', ok: true })
    expect(host.list()[0].logs.some((l) => l.message === 'Tổng kết (manual): Chưa agent nào xong việc.')).toBe(true)

    await host.tickJobs(new Date(next - 1000))
    expect(host.list()[0].jobRuns.length).toBe(1) // chưa tới giờ
    await host.tickJobs(new Date(next + 5000))
    const info = host.list()[0]
    expect(info.jobRuns.map((r) => [r.trigger, r.ok])).toEqual([
      ['schedule', true],
      ['manual', true]
    ])
    expect(Date.parse(info.jobs[0].nextRun!)).toBe(next + 3600_000)
    await expect(host.runJob('stag.hello', 'nope')).rejects.toThrow(/không có việc/)
    await expect(Promise.all([host.runJob('stag.hello', 'summary'), host.runJob('stag.hello', 'summary')])).rejects.toThrow(/đang chạy/)
  })

  it('webhook: địa chỉ có mã bí mật, chuyển cho worker, ghi lần nhận, đổi mã', async () => {
    const server = new PluginWebhookServer(host)
    try {
      const base = await server.start(0)
      await host.install({ type: 'local', path: HELLO })
      await host.approve('stag.hello')
      const url = host.list()[0].webhookUrls.ping
      expect(url.startsWith(`${base}/plugins/stag.hello/webhooks/ping?token=`)).toBe(true)
      expect(url).toMatch(/token=[0-9a-f]{36}$/)
      expect(JSON.stringify(host.list())).not.toContain('webhookToken')
      const post = (u: string, body: string, type = 'application/json'): Promise<Response> => fetch(u, { method: 'POST', headers: { 'Content-Type': type }, body })

      const r = await post(url, '{"hi":1}')
      expect(r.status).toBe(200)
      expect(await r.json()).toMatchObject({ ok: true })
      expect(await host.bridge('stag.hello', 'state.get', { key: 'lastPing' }, {})).toMatchObject({ body: { hi: 1 } })
      expect((await post(url.replace(/token=\w+/, 'token=bad'), '{}')).status).toBe(404)
      expect((await fetch(url)).status).toBe(405)
      expect((await post(url, '{bad')).status).toBe(400)
      expect((await post(`${base}/plugins/stag.hello/webhooks/nope?token=x`, '{}')).status).toBe(404)
      expect(host.list()[0].deliveries.map((d) => d.status)).toEqual([400, 200])

      await host.rotateWebhookToken('stag.hello')
      expect((await post(url, '{}')).status).toBe(404)
      const url2 = host.list()[0].webhookUrls.ping
      await host.applySettings(normalizeSettings({ version: 2, app: { plugins: { toggles: { 'stag.hello': false } } } }))
      expect((await post(url2, '{}')).status).toBe(503)
    } finally {
      server.stop()
    }
  })
})

describe('PluginHost: plugin kèm app, tạo plugin từ mẫu', () => {
  const CATALOG = resolve('resources/plugin-catalog')
  const SDK = resolve('resources/plugin-sdk/stag-plugin-sdk.mjs')
  const withCatalog = (): PluginHost => new PluginHost(join(tmp, 'plugins'), { spawn: forkWorker, api, catalogDir: CATALOG, sdkFile: SDK })

  it('mọi bản SDK (plugin kèm app, skill stag-plugin-author) giống hệt bản gốc', async () => {
    const sdk = await fs.readFile(SDK, 'utf8')
    const copies = [
      ...(await fs.readdir(CATALOG)).map((d) => join(CATALOG, d, 'stag-plugin-sdk.mjs')),
      resolve('resources/skill-catalog/stag-plugin-author/stag-plugin-sdk.mjs')
    ]
    expect(copies.length).toBeGreaterThanOrEqual(3)
    for (const f of copies) expect(await fs.readFile(f, 'utf8'), f).toBe(sdk)
  })

  it('danh mục: liệt kê, cài, Nhật ký việc ghi việc xong hôm nay vào vault', async () => {
    host = withCatalog()
    await host.applySettings(normalizeSettings({ version: 2 }))
    const cat = await host.catalog()
    expect(cat.map((c) => [c.slug, c.manifest.id, c.installed])).toEqual([
      ['stag-plugin-hello', 'stag.hello', false],
      ['stag-plugin-task-log', 'stag.task-log', false]
    ])
    const p = await host.install({ type: 'catalog', slug: 'stag-plugin-task-log' })
    expect(p.source).toEqual({ type: 'catalog', slug: 'stag-plugin-task-log' })
    expect(p.status.state).toBe('approval_pending')
    expect((await host.catalog()).find((c) => c.slug === 'stag-plugin-task-log')?.installed).toBe(true)
    await expect(host.install({ type: 'catalog', slug: '../x' })).rejects.toThrow(/Không có plugin/)
    await host.approve('stag.task-log')

    const ctx = { workspaceId: 'w1', workspaceName: 'Proj' }
    expect(await host.runSlot('stag.task-log', 'today', ctx)).toEqual({ message: 'Hôm nay chưa có việc nào xong, chưa ghi gì.' })
    const now = new Date().toISOString()
    boardTasks = [
      { id: 't1', agentName: 'Lead', title: 'Fix login', scope: 'src/auth', status: 'done', createdAt: now, doneAt: now, summary: 'Token refresh fixed' },
      { id: 't2', agentName: 'Coder', title: 'Old', scope: '', status: 'done', createdAt: '2020-01-01T00:00:00Z', doneAt: '2020-01-01T10:00:00Z' },
      { id: 't3', agentName: 'Coder', title: 'Docs', scope: 'docs', status: 'open', createdAt: now }
    ]
    const day = dayOf(new Date())
    expect(await host.runSlot('stag.task-log', 'today', ctx)).toEqual({ message: `Đã ghi Task log/${day}.md trong vault.` })
    expect(vaultWrites.length).toBe(1)
    expect(vaultWrites[0][0]).toBe('w1')
    expect(vaultWrites[0][2]).toContain('## Done (1)\n- **Lead**: Fix login (scope: src/auth) — Token refresh fixed')
    expect(vaultWrites[0][2]).toContain('## Still open (1)\n- **Coder**: Docs (scope: docs)')

    // Việc theo lịch: mọi workspace (agents.list), cùng nội dung.
    await host.runJob('stag.task-log', 'daily')
    expect(vaultWrites.map((w) => w[1])).toEqual([`Task log/${day}.md`, `Task log/${day}.md`])
    await host.setConfig('stag.task-log', { folder: '/Nhật ký/', includeOpen: false })
    await host.runJob('stag.task-log', 'daily')
    expect(vaultWrites[2][1]).toBe(`Nhật ký/${day}.md`)
    expect(vaultWrites[2][2]).not.toContain('Still open')
    expect(renderLog(day, [], true)).toBeNull()
  })

  it('tạo plugin từ mẫu: file, SDK, cài tại chỗ, chạy được; trùng mã / thư mục có file thì báo lỗi', async () => {
    host = withCatalog()
    await host.applySettings(normalizeSettings({ version: 2 }))
    const parent = join(tmp, 'mine')
    await fs.mkdir(parent)
    const p = await host.scaffold({ parentDir: parent, name: 'Báo cáo "tuần"', id: 'my.bao-cao', template: 'page' })
    const dir = join(parent, 'stag-plugin-bao-cao')
    expect(p.source).toEqual({ type: 'local', path: dir })
    expect((await fs.readdir(dir)).sort()).toEqual(['README.md', 'package.json', 'stag-plugin-sdk.mjs', 'ui', 'worker.mjs'])
    expect(await fs.readFile(join(dir, 'stag-plugin-sdk.mjs'), 'utf8')).toBe(await fs.readFile(SDK, 'utf8'))
    expect(p.manifest.ui.slots.map((s) => s.type)).toEqual(['sidebar', 'page'])
    await host.approve('my.bao-cao')
    expect(await host.callTool('my.bao-cao', 'hello', { name: 'An' }, {})).toEqual({ text: 'Xin chào, An!', isError: false })
    expect(await host.runSlot('my.bao-cao', 'click', {})).toEqual({ message: 'Đã bấm 1 lần.' })
    expect(await host.bridge('my.bao-cao', 'data.get', { key: 'info' }, { workspaceName: 'Proj' })).toEqual({ clicks: 1, workspace: 'Proj' })
    expect((await host.uiFile('my.bao-cao', 'index.html'))?.path).toBe(join(dir, 'ui', 'index.html'))
    expect(host.list()[0].logs.some((l) => l.message === 'Báo cáo "tuần" đã sẵn sàng')).toBe(true)

    const b = await host.scaffold({ parentDir: parent, name: 'Gọn', id: 'my.gon', template: 'basic' })
    expect(b.manifest.entrypoints).toEqual({ worker: './worker.mjs' })
    await expect(host.scaffold({ parentDir: parent, name: 'X', id: 'my.gon', template: 'basic' })).rejects.toThrow(/Đã có plugin/)
    await fs.mkdir(join(parent, 'stag-plugin-z'))
    await fs.writeFile(join(parent, 'stag-plugin-z', 'a.txt'), 'x')
    await expect(host.scaffold({ parentDir: parent, name: 'Z', id: 'my.z', template: 'basic' })).rejects.toThrow(/đã có file/)
    await expect(host.scaffold({ parentDir: parent, name: 'Z', id: 'Bad Id', template: 'basic' })).rejects.toThrow(/Mã plugin/)
  })
})

describe('PluginHost: sự kiện mới + quyền files.read', () => {
  const SDK = resolve('resources/plugin-sdk/stag-plugin-sdk.mjs').replace(/\\/g, '/')
  const A: Agent = { id: 'a1', workspaceId: 'w1', name: 'Lead', role: '', permissionMode: 'default', createdAt: '2026-01-01T00:00:00.000Z' }

  /** Plugin thử: ghi sự kiện vào nhật ký, action "ls" gọi ctx.files.list / read. */
  async function filesPlugin(dir: string, caps: string[]): Promise<string> {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      join(dir, 'w.mjs'),
      `import { definePlugin, runWorker } from 'file:///${SDK}'
runWorker(definePlugin({ async setup(ctx) {
  for (const t of ['artifact.written', 'vault.note.changed', 'handoff.done', 'scope.conflict'])
    ctx.events.on(t, async (e) => ctx.logger.info('EV ' + JSON.stringify({ type: e.type, ws: e.workspaceId, agent: e.agentName ?? null, data: e.data })))
  ctx.actions.register('ls', async (params, run) => {
    try {
      const list = await ctx.files.list(run.workspaceId)
      const { text } = await ctx.files.read(run.workspaceId, 'src/a.txt')
      return { message: JSON.stringify({ names: list.map((x) => x.name), text }) }
    } catch (e) { return { message: 'ERR ' + e.message } }
  })
} }))`
    )
    await fs.writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'files',
        version: '1.0.0',
        stagPlugin: {
          id: 'acme.files',
          capabilities: ['ui.sidebar.register', 'events.subscribe', ...caps],
          entrypoints: { worker: 'w.mjs' },
          events: ['artifact.written', 'vault.note.changed', 'handoff.done', 'scope.conflict'],
          ui: { slots: [{ type: 'sidebar', id: 'ls', action: 'ls' }] }
        }
      })
    )
    return dir
  }

  const evLogs = (): Array<{ type: string; ws: string; agent: string | null; data: Record<string, unknown> }> =>
    host
      .list()
      .find((p) => p.manifest.id === 'acme.files')!
      .logs.filter((l) => l.message.startsWith('EV '))
      .map((l) => JSON.parse(l.message.slice(3)))

  it('KeyedThrottle: mỗi khoá một lần trong khoảng, không trượt', () => {
    let t = 0
    const g = new KeyedThrottle(5000, () => t)
    expect(g.pass('a')).toBe(true)
    t = 1000
    expect(g.pass('a')).toBe(false)
    expect(g.pass('b')).toBe(true)
    t = 4999
    expect(g.pass('a')).toBe(false)
    t = 5000
    expect(g.pass('a')).toBe(true) // ghi liên tục vẫn ra một sự kiện mỗi 5 s
    t = 9000
    expect(g.pass('a')).toBe(false)
    expect(g.pass('b')).toBe(true)
  })

  it('sự kiện mới tới worker qua emit: artifact (từ ArtifactLog, có giới hạn), vault agent / người dùng, bàn giao, đụng phạm vi', async () => {
    await host.install({ type: 'local', path: await filesPlugin(join(tmp, 'files'), []) })
    await host.approve('acme.files')
    const proj = join(tmp, 'proj')
    await fs.mkdir(join(proj, 'src'), { recursive: true })
    const ws: Workspace = { id: 'w1', name: 'Proj', path: proj, vaultPath: join(proj, 'Proj memory'), createdAt: '' }
    const ev = (type: PluginEvent['type'], a: Agent | null, data: Record<string, unknown>): PluginEvent => ({
      type,
      at: new Date().toISOString(),
      workspaceId: ws.id,
      ...(a ? { agentId: a.id, agentName: a.name } : {}),
      data
    })

    // Như index.ts: ArtifactLog → KeyedThrottle → emit.
    const gate = new KeyedThrottle(5000)
    const artifacts = new ArtifactLog(
      () => {},
      (w, a, files) => {
        for (const f of files) if (f.kind !== 'delete' && gate.pass(`${w.id}|${a.id}|${f.rel.toLowerCase()}`)) host.emit(ev('artifact.written', a, { path: f.rel, kind: f.kind }))
      }
    )
    const write = (file: string, tool = 'Write'): Promise<void> => artifacts.onToolUse(ws, A, { hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { file_path: file }, cwd: proj })
    await write(join(proj, 'src', 'a.ts'))
    await write(join(proj, 'src', 'a.ts'), 'Edit') // cùng file trong 5 s → bỏ
    await write(join(proj, 'src', 'b.ts'), 'Edit')
    await write(join(ws.vaultPath, 'x.md')) // note vault không phải artifact

    const activity = new VaultActivityLog(
      () => {},
      (w, a, rels) => rels.forEach((rel) => host.emit(ev('vault.note.changed', a, { path: rel, by: 'agent' })))
    )
    activity.onToolUse(ws, A, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: join(ws.vaultPath, 'r.md') } }) // đọc: không có sự kiện
    activity.onToolUse(ws, A, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(ws.vaultPath, '30 Features', 'Login.md') } })

    await fs.mkdir(ws.vaultPath, { recursive: true })
    const userWrites: Array<[string, string]> = []
    onUserNoteWrite((vaultPath, rel) => {
      userWrites.push([vaultPath, rel])
      host.emit(ev('vault.note.changed', null, { path: rel, by: 'user' }))
    })
    try {
      await writeNote(ws.vaultPath, 'u.md', 'mới', null)
      expect(await writeNote(ws.vaultPath, 'u.md', 'x', 'cũ')).toMatchObject({ status: 'conflict' }) // không lưu → không báo
    } finally {
      onUserNoteWrite(null)
    }
    expect(userWrites).toEqual([[ws.vaultPath, 'u.md']])

    host.emit(ev('handoff.done', A, { percent: 81, fromSessionId: 's1', summary: 'Xong phần đăng nhập' }))
    host.emit(ev('scope.conflict', A, { path: 'src/auth/x.ts', ownerAgentName: 'Coder', decision: 'ask' }))
    host.emit(ev('task.done', A, { title: 'không khai' })) // plugin không khai task.done

    await until(() => evLogs().length === 6)
    expect(evLogs()).toEqual([
      { type: 'artifact.written', ws: 'w1', agent: 'Lead', data: { path: 'src/a.ts', kind: 'write' } },
      { type: 'artifact.written', ws: 'w1', agent: 'Lead', data: { path: 'src/b.ts', kind: 'edit' } },
      { type: 'vault.note.changed', ws: 'w1', agent: 'Lead', data: { path: '30 Features/Login.md', by: 'agent' } },
      { type: 'vault.note.changed', ws: 'w1', agent: null, data: { path: 'u.md', by: 'user' } },
      { type: 'handoff.done', ws: 'w1', agent: 'Lead', data: { percent: 81, fromSessionId: 's1', summary: 'Xong phần đăng nhập' } },
      { type: 'scope.conflict', ws: 'w1', agent: 'Lead', data: { path: 'src/auth/x.ts', ownerAgentName: 'Coder', decision: 'ask' } }
    ])
    expect(host.list().find((p) => p.manifest.id === 'acme.files')!.status.events).toBe(6)

    // Tắt ở workspace → không nhận.
    await host.applySettings(normalizeSettings({ version: 2, workspaces: { w1: { plugins: { 'acme.files': false } } } }))
    host.emit(ev('handoff.done', A, { percent: 90 }))
    expect(host.list().find((p) => p.manifest.id === 'acme.files')!.status.events).toBe(6)
    await artifacts.flush()
  })

  it('files.list / files.read: cần quyền, chỉ trong dự án, bỏ thư mục của app / git / vault, chặn nhị phân và file lớn', async () => {
    const proj = join(tmp, 'proj')
    const vault = join(proj, 'Proj memory')
    const outside = join(tmp, 'outside')
    for (const d of ['src', 'node_modules/x', '.git', '.stag', '.sessions', vault, outside]) await fs.mkdir(resolve(proj, d), { recursive: true })
    await fs.writeFile(join(proj, 'src', 'a.txt'), 'xin chào\n')
    await fs.writeFile(join(proj, 'README.md'), '# Proj')
    await fs.writeFile(join(proj, '.git', 'config'), '[remote] url=https://token@x')
    await fs.writeFile(join(proj, '.stag', 'artifacts.json'), '{}')
    await fs.writeFile(join(vault, '_INDEX.md'), 'vault')
    await fs.writeFile(join(outside, 'secret.txt'), 'bí mật')
    await fs.writeFile(join(proj, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
    await fs.writeFile(join(proj, 'big.txt'), 'x'.repeat(1024 * 1024 + 1))
    await fs.writeFile(join(proj, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9])) // "café" Latin-1
    await fs.symlink(outside, join(proj, 'escape'), 'junction')
    await fs.symlink(join(proj, 'src'), join(proj, 'src-link'), 'junction')
    wsPaths = { w1: { path: proj, vaultPath: vault } }
    const ctx = { workspaceId: 'w1' }

    // Không có quyền files.read: worker và trang đều bị từ chối.
    const dir = await filesPlugin(join(tmp, 'files'), [])
    await host.install({ type: 'local', path: dir })
    await host.approve('acme.files')
    expect(await host.runSlot('acme.files', 'ls', ctx)).toEqual({ message: 'ERR Plugin chưa được cấp quyền "files.read".' })
    await expect(host.bridge('acme.files', 'files.list', { workspaceId: 'w1' }, ctx)).rejects.toThrow(/chưa được cấp quyền "files.read"/)
    await expect(host.bridge('acme.files', 'files.read', { workspaceId: 'w1', path: 'README.md' }, ctx)).rejects.toThrow(/chưa được cấp quyền "files.read"/)

    // Xin thêm quyền → chờ duyệt lại → chạy được.
    await filesPlugin(dir, ['files.read'])
    expect((await host.reload('acme.files')).status.state).toBe('upgrade_pending')
    await host.approve('acme.files')
    expect(JSON.parse((await host.runSlot('acme.files', 'ls', ctx)).message!)).toEqual({
      names: ['src', 'src-link', 'big.txt', 'bin.dat', 'latin1.txt', 'README.md'],
      text: 'xin chào\n'
    })
    const list = (path?: string): Promise<unknown> => host.bridge('acme.files', 'files.list', { workspaceId: 'w1', ...(path !== undefined ? { path } : {}) }, ctx)
    const read = (path: string): Promise<unknown> => host.bridge('acme.files', 'files.read', { workspaceId: 'w1', path }, ctx)
    expect(await list('src')).toEqual([{ name: 'a.txt', path: 'src/a.txt', type: 'file', size: 10 }])
    expect(await list('src-link')).toEqual([{ name: 'a.txt', path: 'src/a.txt', type: 'file', size: 10 }])
    expect(await list()).toContainEqual({ name: 'README.md', path: 'README.md', type: 'file', size: 6 })
    expect(await read('src\\a.txt')).toEqual({ text: 'xin chào\n' })
    expect(await read('./README.md')).toEqual({ text: '# Proj' })

    // Thoát ra ngoài dự án.
    await expect(read('../outside/secret.txt')).rejects.toThrow(/trong thư mục dự án/)
    await expect(read('src/../../outside/secret.txt')).rejects.toThrow(/trong thư mục dự án/)
    await expect(read(join(outside, 'secret.txt'))).rejects.toThrow(/trong thư mục dự án/)
    await expect(read('/etc/passwd')).rejects.toThrow(/trong thư mục dự án/)
    await expect(read('escape/secret.txt')).rejects.toThrow(/trong thư mục dự án/)
    await expect(list('escape')).rejects.toThrow(/trong thư mục dự án/)
    // Thư mục của app / git / vault.
    await expect(read('.git/config')).rejects.toThrow(/dữ liệu của git/)
    await expect(list('.stag')).rejects.toThrow(/dữ liệu của git/)
    await expect(read('Proj memory/_INDEX.md')).rejects.toThrow(/vault/)
    // Nhị phân, quá lớn, không phải UTF-8, không có, thư mục.
    await expect(read('bin.dat')).rejects.toThrow(/nhị phân/)
    await expect(read('big.txt')).rejects.toThrow(/quá lớn/)
    await expect(read('latin1.txt')).rejects.toThrow(/UTF-8/)
    await expect(read('nope.txt')).rejects.toThrow(/Không thấy/)
    await expect(read('src')).rejects.toThrow(/không phải file/)
    // File hay chứa mã bí mật: thấy trong danh sách nhưng không đọc được.
    for (const f of ['.env', 'src/.env.local', '.mcp.json', 'deploy.PEM']) {
      await fs.writeFile(join(proj, f), 'TOKEN=abc')
      await expect(read(f)).rejects.toThrow(/mã bí mật/)
    }
    expect(await list()).toContainEqual({ name: '.env', path: '.env', type: 'file', size: 9 })
    await expect(list('README.md')).rejects.toThrow(/không phải thư mục/)
    // Workspace không có / plugin tắt ở workspace đó.
    await expect(host.bridge('acme.files', 'files.list', { workspaceId: 'w9' }, ctx)).rejects.toThrow(/Không có workspace/)
    await host.applySettings(normalizeSettings({ version: 2, workspaces: { w1: { plugins: { 'acme.files': false } } } }))
    await expect(list()).rejects.toThrow(/tắt ở workspace/)
  })
})
