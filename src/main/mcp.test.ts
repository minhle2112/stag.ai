import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BROWSER_TOOLS_OFF } from '@shared/browser'
import type { Agent, Workspace } from '@shared/types'
import type { BrowserService } from './browser'
import type { Board } from './board'
import type { AgentCreateInput } from '@shared/agentApi'
import { AGENT_API_OFF, createStagMcp, type TeamApi } from './mcp'

// browser.ts dùng Electron; test chỉ cần danh sách phím.
vi.mock('./browser', () => ({ BROWSER_KEYS: ['Enter', 'Tab'] }))

const agent = { id: 'a1', name: 'Agent 1', workspaceId: 'w1' } as Agent
const workspace = { id: 'w1', name: 'W', path: 'C:/p', vaultPath: 'C:/p/vault' } as Workspace

async function connect(browserTools: boolean | undefined): Promise<{ client: Client; navigate: ReturnType<typeof vi.fn> }> {
  const navigate = vi.fn(async (_a: Agent, url: string) => `Opened: ${url}`)
  const server = createStagMcp({
    agent,
    workspace,
    board: {} as Board,
    browser: { agentNavigate: navigate } as unknown as BrowserService,
    teammates: () => [],
    syncSessionFile: async () => {},
    handoff: async () => {},
    browserTools
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return { client, navigate }
}

const names = async (c: Client): Promise<string[]> => (await c.listTools()).tools.map((t) => t.name)

describe('tool trình duyệt theo Cài đặt', () => {
  it('bật (mặc định): liệt kê và gọi được', async () => {
    const { client, navigate } = await connect(undefined)
    expect(await names(client)).toEqual(expect.arrayContaining(['task_start', 'browser_navigate', 'browser_screenshot', 'browser_console']))
    const r = await client.callTool({ name: 'browser_navigate', arguments: { url: 'http://localhost:1' } })
    expect(r.isError).toBeFalsy()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('tắt: không liệt kê tool browser_*, các tool khác giữ nguyên', async () => {
    const { client } = await connect(false)
    const list = await names(client)
    expect(list.some((n) => n.startsWith('browser_'))).toBe(false)
    expect(list).toEqual(expect.arrayContaining(['task_start', 'task_list', 'session_handoff']))
    // Liệt kê lần nữa vẫn ẩn (không để lại trạng thái).
    expect((await names(client)).some((n) => n.startsWith('browser_'))).toBe(false)
  })

  it('tắt giữa phiên: phiên đã thấy tool gọi tới thì nhận lỗi rõ ràng, không chạy', async () => {
    const { client, navigate } = await connect(false)
    for (const name of ['browser_navigate', 'browser_screenshot', 'browser_console']) {
      const r = await client.callTool({ name, arguments: name === 'browser_navigate' ? { url: 'http://localhost:1' } : {} })
      expect(r.isError).toBe(true)
      expect((r.content as Array<{ text: string }>)[0].text).toBe(BROWSER_TOOLS_OFF)
    }
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('tool agent_list / adapter_models (Agent API A1)', () => {
  const team: TeamApi = {
    agents: () => [
      { id: 'a1', name: 'Agent 1', role: 'Lead', kind: 'claude', kindLabel: 'Claude Code', model: 'opus', effort: 'high', permissionMode: 'default', running: true, activity: 'working', context: 42 },
      { id: 'a2', name: 'Tester', role: '', kind: 'codex', kindLabel: 'Codex', model: '', effort: null, permissionMode: 'acceptEdits', running: false, activity: null },
      { id: 'a3', name: 'Shell', role: '', kind: 'terminal', kindLabel: 'Terminal', model: null, effort: null, permissionMode: 'default', running: true, activity: null }
    ],
    adapters: async () => [
      { kind: 'claude', label: 'Claude Code', available: true, detail: '2.1.300, logged in', defaultModel: 'opus', defaultEffort: 'high', models: [{ id: 'opus', label: 'Opus', efforts: ['low', 'high'] }] },
      { kind: 'codex', label: 'Codex', available: false, detail: 'Không tìm thấy codex', defaultModel: '', defaultEffort: null, models: [] },
      { kind: 'terminal', label: 'Terminal', available: true, detail: '', defaultModel: null, defaultEffort: null, models: [] }
    ],
    create: vi.fn(async (input: AgentCreateInput) => {
      if (input.name === 'Lead') throw new Error('An agent named "Lead" already exists')
      return `Created agent "${input.name}"`
    }),
    update: vi.fn(async (i: { name: string }) => `update ${i.name}`),
    open: vi.fn(async (i: { name: string }) => `open ${i.name}`),
    stop: vi.fn(async (i: { name: string }) => `stop ${i.name}`),
    send: vi.fn(async (i: { name: string; text: string }) => {
      if (i.name === 'Shell') throw new Error('plain terminal')
      return `send ${i.name}: ${i.text}`
    }),
    handoff: vi.fn(async (i: { name: string; summary: string }) => {
      if (i.name === 'Busy') throw new Error('"Busy" still has an open task')
      return `handoff ${i.name}`
    }),
    remove: vi.fn(async (i: { name: string }) => `remove ${i.name}`)
  }

  const sync = vi.fn(async () => {})
  async function client(withTeam: boolean, agentApi?: { manage: boolean; message: boolean }): Promise<Client> {
    const server = createStagMcp({
      agentApi,
      agent,
      workspace,
      board: {} as Board,
      browser: {} as BrowserService,
      teammates: () => [],
      syncSessionFile: sync,
      handoff: async () => {},
      ...(withTeam ? { team } : {})
    })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const c = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(a), c.connect(b)])
    return c
  }
  const text = (r: Awaited<ReturnType<Client['callTool']>>): string => (r.content as Array<{ text: string }>)[0].text

  it('agent_list: mọi agent, đánh dấu chính mình, model / quyền / phiên', async () => {
    const c = await client(true)
    expect(await names(c)).toEqual(expect.arrayContaining(['agent_list', 'adapter_models']))
    const t = text(await c.callTool({ name: 'agent_list', arguments: {} }))
    expect(t).toContain('3 agent(s)')
    expect(t).toContain('- Agent 1 (you) — role: Lead — Claude Code [kind: claude], model opus, effort high, permission: default — session running (working, context 42% full)')
    expect(t).toContain('- Tester — Codex [kind: codex], model default (CLI config), permission: acceptEdits — session stopped')
    expect(t).toContain('- Shell — plain terminal — session running')
  })

  it('adapter_models: loại tạo được, có sẵn hay không, model + effort', async () => {
    const t = text(await (await client(true)).callTool({ name: 'adapter_models', arguments: {} }))
    expect(t).toContain('kind "claude" — Claude Code: available (2.1.300, logged in). Default here: model opus, effort high. Known models: opus (Opus) [effort: low|high].')
    expect(t).toContain('kind "codex" — Codex: NOT available (Không tìm thấy codex)')
    expect(t).toContain('kind "terminal" — Terminal: available. No model choice.')
  })

  it('agent_create: chuyển nguyên tham số, lỗi kiểm tra thành isError', async () => {
    const c = await client(true)
    const input = { name: 'Tester', kind: 'codex', role: 'Viết test', model: 'gpt-5.6-terra', task: 'viết test cho src/x', open: true }
    const r = await c.callTool({ name: 'agent_create', arguments: input })
    expect(r.isError).toBeFalsy()
    expect(text(r)).toBe('Created agent "Tester"')
    expect(team.create).toHaveBeenCalledWith(input)
    const dup = await c.callTool({ name: 'agent_create', arguments: { name: 'Lead', kind: 'claude' } })
    expect(dup.isError).toBe(true)
    expect(text(dup)).toContain('already exists')
  })

    it('agent_update / open / stop / send / delete: chuyển tham số, lỗi thành isError', async () => {
    const c = await client(true)
    const calls: Array<[string, Record<string, unknown>, string]> = [
      ['agent_update', { name: 'Tester', model: 'default', permission_mode: 'plan' }, 'update Tester'],
      ['agent_open', { name: 'Tester', task: 'chạy test' }, 'open Tester'],
      ['agent_stop', { name: 'Tester' }, 'stop Tester'],
      ['agent_send', { name: 'Tester', text: 'xong chưa?' }, 'send Tester: xong chưa?'],
      ['agent_delete', { name: 'Tester' }, 'remove Tester']
    ]
    for (const [name, args, want] of calls) {
      const r = await c.callTool({ name, arguments: args })
      expect(r.isError).toBeFalsy()
      expect(text(r)).toBe(want)
    }
    expect(team.update).toHaveBeenCalledWith({ name: 'Tester', model: 'default', permission_mode: 'plan' })
    expect(team.open).toHaveBeenCalledWith({ name: 'Tester', task: 'chạy test' })
    const bad = await c.callTool({ name: 'agent_send', arguments: { name: 'Shell', text: 'ls' } })
    expect(bad.isError).toBe(true)
    // Thiếu tham số bắt buộc → MCP SDK báo lỗi, không gọi tới app.
    const missing = await c.callTool({ name: 'agent_send', arguments: { name: 'Tester' } })
    expect(missing.isError).toBe(true)
  })

    it('Cài đặt → Agent API tắt nhóm: ẩn tool của nhóm, gọi thì báo lỗi, agent_list vẫn còn', async () => {
    const c = await client(true, { manage: false, message: true })
    const list = await names(c)
    expect(list).toEqual(expect.arrayContaining(['agent_list', 'adapter_models', 'agent_send']))
    expect(list.some((n) => ['agent_create', 'agent_update', 'agent_open', 'agent_stop', 'agent_delete'].includes(n))).toBe(false)
    const r = await c.callTool({ name: 'agent_create', arguments: { name: 'X', kind: 'claude' } })
    expect(r.isError).toBe(true)
    expect(text(r)).toBe(AGENT_API_OFF.manage)
    const m = await client(true, { manage: true, message: false })
    expect(await names(m)).not.toContain('agent_send')
    const sent = await m.callTool({ name: 'agent_send', arguments: { name: 'Tester', text: 'hi' } })
    expect(text(sent)).toBe(AGENT_API_OFF.message)
  })

  it('agent_handoff: chuyển tham số, ghi lại file phiên; lỗi thì không; thuộc nhóm message', async () => {
    const c = await client(true)
    sync.mockClear()
    const r = await c.callTool({ name: 'agent_handoff', arguments: { name: 'Tester', summary: 'Done: x. Left: y (src/a.ts:12).', title: 'Viết test' } })
    expect(r.isError).toBeFalsy()
    expect(text(r)).toBe('handoff Tester')
    expect(team.handoff).toHaveBeenCalledWith({ name: 'Tester', summary: 'Done: x. Left: y (src/a.ts:12).', title: 'Viết test' })
    expect(sync).toHaveBeenCalledTimes(1)
    const busy = await c.callTool({ name: 'agent_handoff', arguments: { name: 'Busy', summary: 's' } })
    expect(busy.isError).toBe(true)
    expect(sync).toHaveBeenCalledTimes(1)
    const off = await client(true, { manage: true, message: false })
    expect(await names(off)).not.toContain('agent_handoff')
    expect(text(await off.callTool({ name: 'agent_handoff', arguments: { name: 'Tester', summary: 's' } }))).toBe(AGENT_API_OFF.message)
  })

  it('không có team API → lỗi rõ ràng', async () => {
    const r = await (await client(false)).callTool({ name: 'agent_list', arguments: {} })
    expect(r.isError).toBe(true)
  })
})
