import { describe, expect, it } from 'vitest'
import { PLUGIN_CAPABILITIES, PLUGIN_EVENTS, RISKY_CAPABILITIES, statusTextFrom, cronProblem, describeCron, fillSlotUrl, pluginFolderFor, pluginIdFrom, newCapabilities, nextCronRun, normalizePluginConfig, parsePluginManifest, pluginToolName } from './plugins'
import { normalizeSettings, pluginOn } from './settings'
import hello from '../../resources/plugin-catalog/stag-plugin-hello/package.json'

const pkg = (m: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({ name: 'p', version: '1.2.3', ...extra, stagPlugin: { id: 'acme.x', ...m } })

describe('manifest plugin', () => {
  it('đọc plugin mẫu Hello và plugin chỉ có nút mở địa chỉ', () => {
    const h = parsePluginManifest(hello)
    expect(h).toMatchObject({ name: 'stag-plugin-hello', version: '1.0.0', manifest: { id: 'stag.hello', entrypoints: { worker: './worker.mjs' } } })
    expect(h.manifest.tools.map((t) => t.name)).toEqual(['word_count'])
    expect(h.manifest.instanceConfigSchema?.properties.maxWords).toMatchObject({ type: 'integer', default: 500, minimum: 1 })
    expect(h.manifest.ui.slots.map((s) => [s.type, s.action ?? s.open?.target ?? s.path])).toEqual([
      ['sidebar', 'hello'],
      ['agentMenu', 'stats'],
      ['globalToolbarButton', 'browser'],
      ['page', 'index.html'],
      ['settingsPage', 'settings.html'],
      ['dashboardWidget', 'widget.html'],
      ['statusBarItem', 'hello']
    ])
    expect(h.manifest.ui.slots.at(-1)?.dataKey).toBe('statusBar')
    expect(h.manifest.entrypoints).toEqual({ worker: './worker.mjs', ui: './ui' })
    expect(h.manifest.jobs).toEqual([{ key: 'summary', displayName: 'Tổng kết', description: expect.any(String), schedule: '0 * * * *' }])
    expect(h.manifest.webhooks.map((w) => w.endpointKey)).toEqual(['ping'])
    const c = parsePluginManifest(
      pkg({ capabilities: ['ui.action.register'], ui: { slots: [{ type: 'globalToolbarButton', id: 'go', open: { url: 'https://x.dev/{workspace.name}', target: 'external' } }] } })
    )
    expect(c.manifest.entrypoints).toEqual({})
    expect(c.manifest.ui.slots[0].open).toEqual({ url: 'https://x.dev/{workspace.name}', target: 'external' })
  })

  it('báo lỗi chỉ rõ trường', () => {
    expect(() => parsePluginManifest({ name: 'x' })).toThrow(/stagPlugin/)
    expect(() => parsePluginManifest(pkg({ id: 'Bad Id' }))).toThrow(/stagPlugin.id/)
    expect(() => parsePluginManifest(pkg({ id: 'stag' }))).toThrow(/dành cho chính app/)
    expect(() => parsePluginManifest(pkg({ apiVersion: 2 }))).toThrow(/apiVersion/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['root.everything'] }))).toThrow(/root.everything/)
    expect(() => parsePluginManifest(pkg({ entrypoints: { worker: '../evil.js' } }))).toThrow(/entrypoints.worker/)
    expect(() => parsePluginManifest(pkg({ entrypoints: { worker: 'w.js' }, tools: [{ name: 't', description: 'd' }] }))).toThrow(/agent.tools.register/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['agent.tools.register'], tools: [{ name: 't', description: 'd' }] }))).toThrow(/cần worker/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['ui.sidebar.register'], ui: { slots: [{ type: 'sidebar', id: 's', open: { url: 'file:///c:/x' } }] } }))).toThrow(/open.url/)
    expect(() => parsePluginManifest(pkg({ ui: { slots: [{ type: 'sidebar', id: 's', open: { url: 'https://x' } }] } }))).toThrow(/ui.sidebar.register/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['ui.action.register'], ui: { slots: [{ type: 'agentMenu', id: 's', action: 'go' }] } }))).toThrow(/không có entrypoints.worker/)
    expect(() => parsePluginManifest(pkg({ events: ['task.done'], entrypoints: { worker: 'w.js' } }))).toThrow(/events.subscribe/)
  })

  it('trang (page / settingsPage / dashboardWidget), thanh trạng thái, việc theo lịch, webhook', () => {
    const w0 = { entrypoints: { worker: 'w.js' } }
    const ui = { entrypoints: { ui: 'ui' }, capabilities: ['ui.page.register', 'instance.settings.register'] }
    const a = parsePluginManifest(pkg({ ...ui, ui: { slots: [{ type: 'page', id: 'p' }, { type: 'settingsPage', id: 's', path: './x/set.html' }] } }))
    expect(a.manifest.ui.slots).toEqual([
      { type: 'page', id: 'p', displayName: 'p', path: 'index.html' },
      { type: 'settingsPage', id: 's', displayName: 's', path: 'x/set.html' }
    ])
    expect(() => parsePluginManifest(pkg({ capabilities: ['ui.page.register'], ui: { slots: [{ type: 'page', id: 'p' }] } }))).toThrow(/entrypoints.ui/)
    expect(() => parsePluginManifest(pkg({ entrypoints: { ui: 'ui' }, ui: { slots: [{ type: 'page', id: 'p' }] } }))).toThrow(/ui.page.register/)
    expect(() => parsePluginManifest(pkg({ ...ui, ui: { slots: [{ type: 'page', id: 'p', path: '../a.html' }] } }))).toThrow(/path/)
    expect(() => parsePluginManifest(pkg({ ...ui, ui: { slots: [{ type: 'page', id: 'p', path: 'a.js' }] } }))).toThrow(/\.html/)
    expect(() => parsePluginManifest(pkg({ ...ui, ui: { slots: [{ type: 'page', id: 'p' }, { type: 'page', id: 'p' }] } }))).toThrow(/trùng id/)
    expect(() => parsePluginManifest(pkg({ entrypoints: { ui: 'C:/x' } }))).toThrow(/entrypoints.ui/)

    // Widget trong lưới agent + chữ trên thanh trạng thái.
    const wg = parsePluginManifest(
      pkg({
        entrypoints: { ui: 'ui', worker: 'w.js' },
        capabilities: ['ui.dashboardWidget.register', 'ui.action.register'],
        ui: { slots: [{ type: 'dashboardWidget', id: 'w', path: 'w.html' }, { type: 'statusBarItem', id: 'st', displayName: 'Trạng thái', dataKey: 'status' }, { type: 'statusBarItem', id: 'go', open: { url: 'https://x.dev' } }] }
      })
    )
    expect(wg.manifest.ui.slots).toEqual([
      { type: 'dashboardWidget', id: 'w', displayName: 'w', path: 'w.html' },
      { type: 'statusBarItem', id: 'st', displayName: 'Trạng thái', dataKey: 'status' },
      { type: 'statusBarItem', id: 'go', displayName: 'go', open: { url: 'https://x.dev', target: 'browser' } }
    ])
    expect(() => parsePluginManifest(pkg({ ...ui, ui: { slots: [{ type: 'dashboardWidget', id: 'w' }] } }))).toThrow(/ui.dashboardWidget.register/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['ui.action.register'], ui: { slots: [{ type: 'statusBarItem', id: 's', dataKey: 'x' }] } }))).toThrow(/không có entrypoints.worker/)
    expect(() => parsePluginManifest(pkg({ ...w0, capabilities: ['ui.action.register'], ui: { slots: [{ type: 'statusBarItem', id: 's', dataKey: 'Bad Key' }] } }))).toThrow(/dataKey/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['ui.action.register'], ui: { slots: [{ type: 'clock', id: 's' }] } }))).toThrow(/statusBarItem/)
    expect(statusTextFrom('  3 việc ')).toEqual({ text: '3 việc', tone: 'default' })
    expect(statusTextFrom({ text: 'Lỗi', tone: 'error', tooltip: 'x' })).toEqual({ text: 'Lỗi', tone: 'error', tooltip: 'x' })
    expect(statusTextFrom({ text: 'a', tone: 'pink' })).toEqual({ text: 'a', tone: 'default' })
    expect(statusTextFrom({ text: '' })).toBeNull()
    expect(statusTextFrom(null)).toBeNull()

    const w = { entrypoints: { worker: 'w.js' } }
    const b = parsePluginManifest(
      pkg({ ...w, capabilities: ['jobs.schedule', 'webhooks.receive'], jobs: [{ key: 'sync', schedule: '*/5 * * * *' }], webhooks: [{ endpointKey: 'gh-push', displayName: 'GitHub' }] })
    )
    expect(b.manifest.jobs).toEqual([{ key: 'sync', displayName: 'sync', description: '', schedule: '*/5 * * * *' }])
    expect(b.manifest.webhooks).toEqual([{ endpointKey: 'gh-push', displayName: 'GitHub', description: '' }])
    expect(() => parsePluginManifest(pkg({ ...w, jobs: [{ key: 'a', schedule: '* * * * *' }] }))).toThrow(/jobs.schedule/)
    expect(() => parsePluginManifest(pkg({ ...w, capabilities: ['jobs.schedule'], jobs: [{ key: 'a', schedule: '61 * * * *' }] }))).toThrow(/jobs\[0\].schedule: trường phút/)
    expect(() => parsePluginManifest(pkg({ capabilities: ['jobs.schedule'], jobs: [{ key: 'a', schedule: '* * * * *' }] }))).toThrow(/cần worker/)
    expect(() => parsePluginManifest(pkg({ ...w, webhooks: [{ endpointKey: 'x' }] }))).toThrow(/webhooks.receive/)
    expect(() => parsePluginManifest(pkg({ ...w, capabilities: ['webhooks.receive'], webhooks: [{ endpointKey: 'A B' }] }))).toThrow(/endpointKey/)
  })

  it('sự kiện mới và quyền files.read', () => {
    const w = { entrypoints: { worker: 'w.js' } }
    const events = ['artifact.written', 'vault.note.changed', 'handoff.done', 'scope.conflict']
    const m = parsePluginManifest(pkg({ ...w, capabilities: ['events.subscribe', 'files.read'], events })).manifest
    expect(m.events).toEqual(events)
    expect(m.capabilities).toEqual(['events.subscribe', 'files.read'])
    for (const e of events) expect(PLUGIN_EVENTS[e as keyof typeof PLUGIN_EVENTS]).toBeTruthy()
    expect(PLUGIN_CAPABILITIES['files.read']).toBe('Đọc file trong thư mục dự án của workspace')
    // files.read đứng ngay trước http.outbound; không phải quyền nặng.
    const keys = Object.keys(PLUGIN_CAPABILITIES)
    expect(keys.indexOf('files.read')).toBe(keys.indexOf('http.outbound') - 1)
    expect(RISKY_CAPABILITIES).not.toContain('files.read')
    expect(PLUGIN_CAPABILITIES['events.subscribe']).toMatch(/tạo \/ sửa file/)
    expect(() => parsePluginManifest(pkg({ ...w, capabilities: ['events.subscribe'], events: ['file.deleted'] }))).toThrow(/file.deleted/)
  })

  it('quyền mới khi cập nhật', () => {
    const { manifest } = parsePluginManifest(pkg({ capabilities: ['ui.notify', 'agents.read'] }))
    expect(newCapabilities(manifest, ['ui.notify'])).toEqual(['agents.read'])
    expect(newCapabilities(manifest, ['ui.notify', 'agents.read'])).toEqual([])
  })
})

describe('cấu hình, URL slot, tên tool', () => {
  const { manifest } = parsePluginManifest(hello)
  it('điền mặc định, ép kiểu, báo lỗi', () => {
    expect(normalizePluginConfig(manifest.instanceConfigSchema, {})).toEqual({ config: { greeting: 'Xin chào', maxWords: 500, docsUrl: 'https://example.com' }, errors: {} })
    expect(normalizePluginConfig(manifest.instanceConfigSchema, { maxWords: '20', greeting: 'Hi' }).config).toEqual({ greeting: 'Hi', maxWords: 20, docsUrl: 'https://example.com' })
    expect(normalizePluginConfig(manifest.instanceConfigSchema, { maxWords: '2.5' }).errors).toEqual({ maxWords: 'Cần số nguyên.' })
    expect(normalizePluginConfig(manifest.instanceConfigSchema, { maxWords: 0 }).errors).toEqual({ maxWords: 'Nhỏ nhất 1.' })
    expect(normalizePluginConfig(manifest.instanceConfigSchema, { docsUrl: 'ftp://x' }).errors.docsUrl).toMatch(/http/)
  })

  it('URL slot: config đứng đầu giữ nguyên, còn lại mã hoá', () => {
    const url = fillSlotUrl('{config.homeUrl}/?company={workspace.name}&a={agent.name}&x={config.homeUrl}', {
      config: { homeUrl: 'http://127.0.0.1:5177/' },
      workspace: { id: 'w', name: 'Dự án A&B', path: 'C:/p' },
      agent: { id: 'a', name: 'Lead' }
    })
    expect(url).toBe('http://127.0.0.1:5177/?company=D%E1%BB%B1%20%C3%A1n%20A%26B&a=Lead&x=http%3A%2F%2F127.0.0.1%3A5177%2F')
    expect(fillSlotUrl('https://x/{workspace.name}', { config: {} })).toBe('https://x/')
  })

  it('cron: đọc, lần chạy kế tiếp, mô tả', () => {
    expect(cronProblem('0 * * * *')).toBeNull()
    expect(cronProblem('* * * *')).toMatch(/5 trường/)
    expect(cronProblem('0 24 * * *')).toMatch(/giờ/)
    expect(cronProblem('0 9 * * 1-5,7')).toBeNull()
    const at = (s: string): string => {
      const d = nextCronRun(s, new Date(2026, 9, 9, 10, 17, 30))!
      return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`
    }
    // 2026-10-09 là thứ Sáu.
    expect(at('* * * * *')).toBe('2026-10-9 10:18')
    expect(at('0 * * * *')).toBe('2026-10-9 11:0')
    expect(at('*/15 * * * *')).toBe('2026-10-9 10:30')
    expect(at('0 9 * * 1-5')).toBe('2026-10-12 9:0')
    expect(at('30 8 1 * *')).toBe('2026-11-1 8:30')
    expect(at('0 0 29 2 *')).toBe('2028-2-29 0:0')
    // Giới hạn cả ngày lẫn thứ → một trong hai (như cron chuẩn): ngày 13 hoặc Chủ nhật.
    expect(at('0 12 13 * 0')).toBe('2026-10-11 12:0')
    expect(nextCronRun('0 0 31 2 *', new Date(2026, 0, 1))).toBeNull()
    expect(describeCron('0 * * * *')).toBe('Đầu mỗi giờ')
    expect(describeCron('*/5 * * * *')).toBe('Mỗi 5 phút')
    expect(describeCron('30 18 * * *')).toBe('Hằng ngày lúc 18:30')
    expect(describeCron('0 9 * * 1-5')).toBe('Thứ 2–6 lúc 09:00')
    expect(describeCron('0 9 1 * *')).toBe('0 9 1 * *')
  })

  it('gợi ý mã + thư mục cho plugin mới', () => {
    expect(pluginIdFrom('Báo cáo tuần')).toBe('my.bao-cao-tuan')
    expect(pluginIdFrom('Đồng hồ  Ổn định!')).toBe('my.dong-ho-on-dinh')
    expect(pluginIdFrom('***')).toBe('')
    expect(pluginFolderFor('my.bao-cao')).toBe('stag-plugin-bao-cao')
    expect(pluginFolderFor('acme.x_y')).toBe('stag-plugin-x-y')
  })

  it('tên tool MCP', () => {
    expect(pluginToolName('stag.hello', 'word_count')).toBe('stag_hello__word_count')
    expect(pluginToolName('acme.launcher-x', 'go')).toBe('acme_launcher_x__go')
  })

  it('bật / tắt plugin theo cấp', () => {
    const s = normalizeSettings({ version: 2, app: { plugins: { toggles: { 'a.b': false, 'BAD KEY': false } } }, workspaces: { w: { plugins: { 'a.b': true } } } })
    expect(s.app.plugins.toggles).toEqual({ 'a.b': false })
    expect(pluginOn(s, 'a.b')).toBe(false)
    expect(pluginOn(s, 'a.b', 'w')).toBe(true)
    expect(pluginOn(s, 'other')).toBe(true)
  })
})
