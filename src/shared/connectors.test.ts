import { describe, expect, it } from 'vitest'
import { connectorOn, effectiveConnectors, emptyConnector, normalizeConnector, normalizeConnectors, parseMcpJson, slugify, validateConnector } from './connectors'
import { normalizeSettings, patchApp, patchOverrides } from './settings'
import { DEFAULT_SETTINGS, type Connector, type Settings } from './types'

const conn = (id: string, patch: Partial<Connector> = {}): Connector => ({ ...emptyConnector(id), command: 'npx', ...patch })

function withConnectors(items: Connector[], extra: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, app: { ...DEFAULT_SETTINGS.app, connectors: { items, inherited: {} } }, ...extra }
}

describe('normalizeConnector', () => {
  it('giữ trường hợp lệ, bỏ trường sai', () => {
    const c = normalizeConnector({
      id: 'gh',
      transport: 'http',
      url: ' https://x/mcp ',
      bearerSecret: 'GH TOKEN',
      headers: { 'X-Ok': { value: 'a' }, 'bad header': { value: 'b' }, 'X-S': { secret: 'S1' } },
      env: { '1BAD': { value: 'x' } },
      toolPolicy: { list: 'block', x: 'nope' },
      approval: 'allow'
    })!
    expect(c.url).toBe('https://x/mcp')
    expect(c.bearerSecret).toBe('')
    expect(c.headers).toEqual({ 'X-Ok': { value: 'a' }, 'X-S': { secret: 'S1' } })
    expect(c.env).toEqual({})
    expect(c.toolPolicy).toEqual({ list: 'block' })
    expect(c.approval).toBe('allow')
    expect(normalizeConnector({ id: 'Bad Id' })).toBeNull()
  })

  it('bỏ connector trùng id và id "stag"', () => {
    const s = normalizeConnectors({ items: [conn('a'), conn('a'), conn('stag')], inherited: { 'claude:x': false, y: false } })
    expect(s.items.map((c) => c.id)).toEqual(['a'])
    expect(s.inherited).toEqual({ 'claude:x': false })
  })
})

describe('validateConnector', () => {
  it('báo lỗi rõ', () => {
    expect(validateConnector(conn('a'), ['a'])).toMatch(/Đã có/)
    expect(validateConnector(conn('stag'), [])).toMatch(/của chính app/)
    expect(validateConnector(conn('a', { command: '' }), [])).toMatch(/chương trình/)
    expect(validateConnector(conn('a', { transport: 'http', url: 'ftp://x' }), [])).toMatch(/https/)
    expect(validateConnector(conn('a', { transport: 'http', url: 'https://u:p@x' }), [])).toMatch(/mật khẩu/)
    expect(validateConnector(conn('a', { transport: 'http', url: 'https://x/mcp' }), [])).toBeNull()
  })
})

describe('bật / tắt theo cấp', () => {
  const s = withConnectors([conn('a'), conn('b', { enabled: false })], {
    workspaces: { w: { connectors: { a: false, 'claude:docs': false } } },
    agents: { g: { connectors: { a: true, b: true } } }
  })
  it('agent → workspace → app', () => {
    expect(connectorOn(s, 'a')).toBe(true)
    expect(connectorOn(s, 'a', 'w')).toBe(false)
    expect(connectorOn(s, 'a', 'w', 'g')).toBe(true)
    expect(connectorOn(s, 'b', 'w')).toBe(false)
    expect(connectorOn(s, 'b', 'w', 'g')).toBe(true)
    expect(connectorOn(s, 'missing')).toBe(false)
    // Máy chủ có sẵn: mặc định bật.
    expect(connectorOn(s, 'claude:docs')).toBe(true)
    expect(connectorOn(s, 'claude:docs', 'w')).toBe(false)
  })
  it('effectiveConnectors', () => {
    expect(effectiveConnectors(s, 'w').servers.map((c) => c.id)).toEqual([])
    expect(effectiveConnectors(s, 'w', 'g').servers.map((c) => c.id)).toEqual(['a', 'b'])
    expect(effectiveConnectors(s, 'w', 'g').denied).toEqual({ claude: ['docs'], codex: [] })
    expect(effectiveConnectors(s).denied).toEqual({ claude: [], codex: [] })
  })
})

describe('cài đặt', () => {
  it('đọc / ghi connector trong settings.json', () => {
    const s = normalizeSettings({ version: 2, app: { connectors: { items: [conn('a')], inherited: { 'codex:x': false } } }, agents: { g: { connectors: { a: false, 'bad key!': true } } } })
    expect(s.app.connectors.items).toHaveLength(1)
    expect(s.agents.g).toEqual({ connectors: { a: false } })
    expect(normalizeSettings({ version: 2 }).app.connectors).toEqual({ items: [], inherited: {} })
  })
  it('patchApp chỉ sửa phần inherited, giữ danh sách', () => {
    const app = withConnectors([conn('a')]).app
    const next = patchApp(app, { connectors: { inherited: { 'claude:x': false } } })
    expect(next.connectors).toEqual({ items: app.connectors.items, inherited: { 'claude:x': false } })
    expect(patchApp(app, { handoff: { autoHandoff: false } }).connectors).toBe(app.connectors)
  })
  it('patchOverrides: connectors null = bỏ', () => {
    expect(patchOverrides({ connectors: { a: true }, handoff: { autoHandoff: false } }, { connectors: null })).toEqual({ handoff: { autoHandoff: false } })
  })
})

describe('parseMcpJson', () => {
  it('dạng mcpServers: tách token thành bí mật', () => {
    const r = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          'My GitHub': { command: 'npx', args: ['-y', 'gh'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x', LOG: 'info', REF: '${HOME_TOKEN}' } },
          linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k1', 'X-Team': 't' } }
        }
      }),
      ['linear']
    )
    expect(r.errors).toEqual([])
    const [gh, lin] = r.connectors
    expect(gh.id).toBe('my-github')
    expect(gh.label).toBe('My GitHub')
    expect(gh.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: { secret: 'MY_GITHUB_GITHUB_PERSONAL_ACCESS_TOKEN' }, LOG: { value: 'info' }, REF: { value: '${HOME_TOKEN}' } })
    expect(lin.id).toBe('linear-2')
    expect(lin.transport).toBe('http')
    expect(lin.bearerSecret).toBe('LINEAR_2_TOKEN')
    expect(lin.headers).toEqual({ 'X-Api-Key': { secret: 'LINEAR_2_X_API_KEY' }, 'X-Team': { value: 't' } })
    expect(r.secrets).toEqual([
      { name: 'MY_GITHUB_GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_x' },
      { name: 'LINEAR_2_TOKEN', value: 'abc' },
      { name: 'LINEAR_2_X_API_KEY', value: 'k1' }
    ])
  })
  it('một máy chủ lẻ, servers (VS Code), lỗi', () => {
    expect(parseMcpJson('{"command":"uvx","args":["mcp-server-fetch"]}').connectors[0]).toMatchObject({ id: 'server', command: 'uvx' })
    expect(parseMcpJson('{"servers":{"a":{"url":"https://a"}}}').connectors[0]).toMatchObject({ id: 'a', transport: 'http' })
    expect(parseMcpJson('{').errors[0]).toMatch(/JSON không đọc được/)
    expect(parseMcpJson('{"mcpServers":{"x":{"args":[]}}}').errors[0]).toMatch(/thiếu "command"/)
    expect(parseMcpJson('{"stag":{"command":"x"}}').connectors[0].id).toBe('stag-2')
  })
})

describe('slugify', () => {
  it('bỏ dấu, chữ thường', () => {
    expect(slugify('Đồ Án  GitHub!')).toBe('do-an-github')
    expect(slugify('***')).toBe('server')
  })
})
