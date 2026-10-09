import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyConnector } from '@shared/connectors'
import type { Connector } from '@shared/types'
import {
  claudeConfigs,
  claudeServers,
  claudeSettingsExtra,
  codexConnectorArgs,
  codexServerNames,
  connectorEnv,
  parseClaudeMcpList,
  parseCodexMcpList,
  windowsCommand
} from './connectors'

const stdio = (id: string, patch: Partial<Connector> = {}): Connector => ({ ...emptyConnector(id), command: 'npx', args: ['-y', 'pkg'], ...patch })
const http = (id: string, patch: Partial<Connector> = {}): Connector => ({ ...emptyConnector(id), transport: 'http', url: 'https://x/mcp', ...patch })
const secrets: Record<string, string> = { GH: 'ghp_1', API: 'k-2', OTHER: 'o' }
const get = (n: string): string | undefined => secrets[n]

describe('connectorEnv', () => {
  it('stdio: biến KEY; http: STAG_SECRET_<TÊN> (bearer) và STAG_HDR_<ID>_<HEADER> (cả tiền tố)', () => {
    const env = connectorEnv(
      [
        stdio('a', { env: { GITHUB_TOKEN: { secret: 'GH' }, LOG: { value: 'x' } } }),
        http('b', { bearerSecret: 'API', headers: { 'X-K': { secret: 'OTHER' }, Authorization: { secret: 'GH', prefix: 'Token token=' } } })
      ],
      get
    )
    expect(env).toEqual({ GITHUB_TOKEN: 'ghp_1', STAG_SECRET_API: 'k-2', STAG_HDR_B_X_K: 'o', STAG_HDR_B_AUTHORIZATION: 'Token token=ghp_1' })
  })
  it('thiếu bí mật / trùng biến khác giá trị → lỗi', () => {
    expect(() => connectorEnv([http('b', { bearerSecret: 'NOPE' })], get)).toThrow(/cần bí mật NOPE/)
    expect(() => connectorEnv([stdio('a', { env: { T: { secret: 'GH' } } }), stdio('c', { env: { T: { secret: 'API' } } })], get)).toThrow(/cùng đặt biến T/)
    // Cùng biến, cùng giá trị: được.
    expect(connectorEnv([stdio('a', { env: { T: { secret: 'GH' } } }), stdio('c', { env: { T: { secret: 'GH' } } })], get)).toEqual({ T: 'ghp_1' })
  })
})

describe('claudeServers', () => {
  it('bí mật thành ${…}, lệnh đã bọc cmd /c', () => {
    const out = claudeServers(
      [stdio('a', { env: { GITHUB_TOKEN: { secret: 'GH' }, LOG: { value: 'x' } } }), http('b', { bearerSecret: 'API', headers: { 'X-T': { value: 't' } } })],
      { a: { command: 'cmd', args: ['/c', 'npx', '-y', 'pkg'] } }
    )
    expect(out).toEqual({
      a: { type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', 'pkg'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG: 'x' } },
      b: { type: 'http', url: 'https://x/mcp', headers: { 'X-T': 't', Authorization: 'Bearer ${STAG_SECRET_API}' } }
    })
    expect(JSON.stringify(out)).not.toContain('ghp_1')
  })
})

describe('claudeSettingsExtra', () => {
  it('quyền tool + tắt máy chủ có sẵn', () => {
    const extra = claudeSettingsExtra({
      servers: [
        stdio('a', { approval: 'allow', toolPolicy: { del: 'block', send: 'ask' } }),
        stdio('b', { toolPolicy: { read: 'allow', write: 'ask' } })
      ],
      denied: { claude: ['claude.ai Canva'], codex: ['x'] }
    })
    expect(extra).toEqual({
      allow: ['mcp__a', 'mcp__b__read'],
      ask: ['mcp__a__send'],
      deny: ['mcp__a__del'],
      deniedMcpServers: [{ serverName: 'claude.ai Canva' }]
    })
  })
})

describe('codexConnectorArgs', () => {
  it('stdio + http + tắt máy chủ có sẵn, không lộ bí mật', () => {
    const args = codexConnectorArgs(
      {
        servers: [
          stdio('a', { env: { GITHUB_TOKEN: { secret: 'GH' }, LOG: { value: 'x' } }, approval: 'allow', toolPolicy: { del: 'block', send: 'ask', 'we.ird': 'ask' } }),
          http('b', { bearerSecret: 'API', headers: { 'X-K': { secret: 'OTHER' }, 'X-T': { value: 't' } }, toolPolicy: { read: 'allow' } })
        ],
        denied: { claude: [], codex: ['old', 'bad name'] }
      },
      { a: { command: 'cmd', args: ['/c', 'npx', '-y', 'pkg'] } },
      new Set(['old', 'bad name'])
    )
    const c = args.filter((_, i) => i % 2 === 1)
    expect(args.filter((_, i) => i % 2 === 0).every((x) => x === '-c')).toBe(true)
    expect(c).toEqual([
      'mcp_servers.a.command="cmd"',
      'mcp_servers.a.args=["/c","npx","-y","pkg"]',
      'mcp_servers.a.env={"LOG"="x"}',
      'mcp_servers.a.env_vars=["GITHUB_TOKEN"]',
      'mcp_servers.a.default_tools_approval_mode="approve"',
      'mcp_servers.a.disabled_tools=["del"]',
      'mcp_servers.a.tools.send.approval_mode="prompt"',
      'mcp_servers.b.url="https://x/mcp"',
      'mcp_servers.b.bearer_token_env_var="STAG_SECRET_API"',
      'mcp_servers.b.http_headers={"X-T"="t"}',
      'mcp_servers.b.env_http_headers={"X-K"="STAG_HDR_B_X_K"}',
      'mcp_servers.b.tools.read.approval_mode="approve"',
      'mcp_servers.old.enabled=false'
    ])
  })
})

describe('codexServerNames', () => {
  it('đọc tên bảng mcp_servers', () => {
    const toml = ['model = "x"', '[mcp_servers.alpha]', 'command = "a"', '[mcp_servers.alpha.env]', 'K = "v"', '[mcp_servers."with.dot"]', "[ mcp_servers . 'q' ]", '[other]'].join('\n')
    expect(codexServerNames(toml)).toEqual(['alpha', 'with.dot', 'q'])
  })
  it('không tắt máy chủ không có trong config.toml', () => {
    expect(codexConnectorArgs({ servers: [], denied: { claude: [], codex: ['ghost', 'real'] } }, {}, new Set(['real']))).toEqual(['-c', 'mcp_servers.real.enabled=false'])
  })
})

describe('windowsCommand', () => {
  it('.cmd / .bat trong PATH → cmd /c; .exe giữ nguyên; ngoài Windows giữ nguyên', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stag-conn-'))
    writeFileSync(join(dir, 'tool.cmd'), '@echo off')
    writeFileSync(join(dir, 'real.exe'), '')
    const env = { PATH: dir }
    expect(await windowsCommand('tool', ['-x'], dir, env, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'tool', '-x'] })
    expect(await windowsCommand('real', ['-x'], dir, env, 'win32')).toEqual({ command: 'real', args: ['-x'] })
    expect(await windowsCommand('C:\\a\\b.bat', [], dir, env, 'win32')).toEqual({ command: 'cmd', args: ['/c', 'C:\\a\\b.bat'] })
    expect(await windowsCommand('tool', [], dir, env, 'linux')).toEqual({ command: 'tool', args: [] })
  })
})

describe('máy chủ có sẵn', () => {
  it('đọc claude mcp list', () => {
    const out = [
      'Checking MCP server health…',
      '',
      'claude.ai Canva: https://mcp.canva.com/mcp - ✔ Connected',
      'claude.ai Supermetrics: https://mcp.supermetrics.com/mcp - ! Needs authentication',
      'plugin:expo:expo: npx -y expo-mcp - ✗ Failed to connect',
      'tiled: node C:/x/tiled - mcp.js - ✔ Connected',
      'dummy: node -e 1 - ⏸ Pending approval (run `claude` to approve)'
    ].join('\n')
    const list = parseClaudeMcpList(out, { user: {}, local: { tiled: {} }, project: { dummy: {} } })
    expect(list.map((s) => [s.name, s.source, s.target, s.status, s.copyable])).toEqual([
      ['claude.ai Canva', 'claude.ai', 'https://mcp.canva.com/mcp', 'Connected', false],
      ['claude.ai Supermetrics', 'claude.ai', 'https://mcp.supermetrics.com/mcp', 'Needs authentication', false],
      ['plugin:expo:expo', 'plugin', 'npx -y expo-mcp', 'Failed to connect', false],
      ['tiled', 'local', 'node C:/x/tiled - mcp.js', 'Connected', true],
      ['dummy', 'project', 'node -e 1', 'Pending approval (run `claude` to approve)', true]
    ])
    expect(list[0].key).toBe('claude:claude.ai Canva')
  })
  it('đọc codex mcp list --json', () => {
    const list = parseCodexMcpList(
      JSON.stringify([
        { name: 'h', enabled: true, transport: { type: 'streamable_http', url: 'https://e/mcp' } },
        { name: 't', enabled: false, transport: { type: 'stdio', command: 'node', args: ['x.js'] } }
      ])
    )
    expect(list.map((s) => [s.key, s.target, s.status])).toEqual([
      ['codex:h', 'https://e/mcp', 'Bật trong config.toml'],
      ['codex:t', 'node x.js', 'Đã tắt trong config.toml']
    ])
    expect(parseCodexMcpList('not json')).toEqual([])
  })
  it('claudeConfigs: user / local (theo thư mục) / .mcp.json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'stag-home-'))
    const proj = mkdtempSync(join(tmpdir(), 'stag-proj-'))
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { u: { command: 'a' } }, projects: { [proj.replace(/\\/g, '/').toUpperCase()]: { mcpServers: { l: { command: 'b' } } } } })
    )
    writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { p: { command: 'c' } } }))
    const c = await claudeConfigs(proj, home)
    expect(Object.keys(c.user)).toEqual(['u'])
    expect(Object.keys(c.local)).toEqual(['l'])
    expect(Object.keys(c.project)).toEqual(['p'])
  })
})
