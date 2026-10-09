import { describe, expect, it } from 'vitest'
import { fillSlotUrl, newCapabilities, normalizePluginConfig, parsePluginManifest, pluginToolName } from './plugins'
import { normalizeSettings, pluginOn } from './settings'
import hello from '../../examples/stag-plugin-hello/package.json'

const pkg = (m: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({ name: 'p', version: '1.2.3', ...extra, stagPlugin: { id: 'acme.x', ...m } })

describe('manifest plugin', () => {
  it('đọc plugin mẫu Hello và plugin chỉ có nút mở địa chỉ', () => {
    const h = parsePluginManifest(hello)
    expect(h).toMatchObject({ name: 'stag-plugin-hello', version: '1.0.0', manifest: { id: 'stag.hello', entrypoints: { worker: './worker.mjs' } } })
    expect(h.manifest.tools.map((t) => t.name)).toEqual(['word_count'])
    expect(h.manifest.instanceConfigSchema?.properties.maxWords).toMatchObject({ type: 'integer', default: 500, minimum: 1 })
    expect(h.manifest.ui.slots.map((s) => [s.type, s.action ?? s.open?.target])).toEqual([
      ['sidebar', 'hello'],
      ['agentMenu', 'stats'],
      ['globalToolbarButton', 'browser']
    ])
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
