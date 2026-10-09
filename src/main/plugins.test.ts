import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeSettings } from '@shared/settings'
import type { PluginEvent } from '@shared/plugins'
import { forkWorker, PluginHost, type PluginHostApi } from './plugins'

const HELLO = resolve('examples/stag-plugin-hello')
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
  board: async () => [],
  vaultRead: async () => null,
  vaultWrite: async () => {},
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
    const sdk = resolve('examples/stag-plugin-sdk/index.mjs').replace(/\\/g, '/')
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
