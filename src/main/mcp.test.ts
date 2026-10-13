import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BROWSER_TOOLS_OFF } from '@shared/browser'
import type { Agent, Workspace } from '@shared/types'
import type { BrowserService } from './browser'
import type { Board } from './board'
import type { AgentCreateInput, ProjectCreateInput, ProjectUpdateInput } from '@shared/agentApi'
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
    remove: vi.fn(async (i: { name: string }) => `remove ${i.name}`),
    status: vi.fn(async (i: { name: string }) => `status ${i.name}`),
    log: vi.fn(async (i: { name: string; last?: number }) => `log ${i.name} ${i.last ?? ''}`),
    projects: () => [
      { name: 'Chung', chung: true, folder: '', path: 'C:/p', goal: '', note: null, agents: ['Agent 1', 'Shell'], mine: true },
      { name: 'web-shop', chung: false, folder: 'apps/web', path: 'C:/p/apps/web', goal: 'Bán hàng', note: 'C:/p/vault/70 Projects/web-shop/web-shop.md', agents: ['Dev · web-shop'], mine: false },
      { name: 'docs', chung: false, folder: 'docs', path: 'C:/p/docs', goal: '', note: 'C:/p/vault/70 Projects/docs/docs.md', agents: [], mine: false }
    ],
    createProject: vi.fn(async (i: ProjectCreateInput) => {
      if (i.name === 'web-shop') throw new Error('Đã có project tên này')
      return `Created project "${i.name}"`
    }),
    updateProject: vi.fn(async (i: ProjectUpdateInput) => `updated ${i.name}`)
  }

  const sync = vi.fn(async () => {})
  async function client(withTeam: boolean, agentApi?: { manage: boolean; message: boolean; read?: boolean }): Promise<Client> {
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

  it('agent_status / agent_log: chuyển tham số; nhóm read tắt thì ẩn và báo lỗi', async () => {
    const c = await client(true)
    expect(text(await c.callTool({ name: 'agent_status', arguments: { name: 'Tester' } }))).toBe('status Tester')
    expect(text(await c.callTool({ name: 'agent_log', arguments: { name: 'Tester', last: 5, include_tools: true, query: 'lỗi' } }))).toBe('log Tester 5')
    expect(team.log).toHaveBeenCalledWith({ name: 'Tester', last: 5, include_tools: true, query: 'lỗi' })
    const big = await c.callTool({ name: 'agent_log', arguments: { name: 'Tester', last: 500 } })
    expect(big.isError).toBe(true)
    const off = await client(true, { manage: true, message: true, read: false })
    const list = await names(off)
    expect(list).not.toContain('agent_status')
    expect(list).not.toContain('agent_log')
    expect(list).toContain('agent_send')
    expect(text(await off.callTool({ name: 'agent_log', arguments: { name: 'Tester' } }))).toBe(AGENT_API_OFF.read)
  })

  it('project_list: Chung + project, chỗ của mình, thư mục / mục tiêu / note / agent; luôn có (cả khi tắt manage)', async () => {
    const c = await client(true, { manage: false, message: false, read: false })
    expect(await names(c)).toContain('project_list')
    const t = text(await c.callTool({ name: 'project_list', arguments: {} }))
    expect(t).toContain('Workspace "W" — 2 project(s):')
    expect(t).toContain('- "Chung" (workspace root, not a project) ← you are here — folder C:/p — 2 agent(s): "Agent 1", "Shell"')
    expect(t).toContain(
      '- project "web-shop" — code folder apps/web (C:/p/apps/web) — goal: Bán hàng — vault note: C:/p/vault/70 Projects/web-shop/web-shop.md — 1 agent(s): "Dev · web-shop"'
    )
    expect(t).toContain('- project "docs" — code folder docs (C:/p/docs) — vault note: C:/p/vault/70 Projects/docs/docs.md — no agents')
  })

  it('project_list: workspace chưa có project', async () => {
    const one = { ...team, projects: () => [team.projects()[0]] }
    const server = createStagMcp({ agent, workspace, board: {} as Board, browser: {} as BrowserService, teammates: () => [], syncSessionFile: sync, handoff: async () => {}, team: one })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const c = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(a), c.connect(b)])
    expect(text(await c.callTool({ name: 'project_list', arguments: {} }))).toContain('Workspace "W" has no projects yet')
  })

  it('project_create / project_update / agent_create(project): chuyển tham số, lỗi thành isError, nhóm manage', async () => {
    const c = await client(true)
    const input = { name: 'mobile', folder: 'apps/mobile', goal: 'App điện thoại', team: 'duo' }
    const r = await c.callTool({ name: 'project_create', arguments: input })
    expect(r.isError).toBeFalsy()
    expect(text(r)).toBe('Created project "mobile"')
    expect(team.createProject).toHaveBeenCalledWith(input)
    const dup = await c.callTool({ name: 'project_create', arguments: { name: 'web-shop' } })
    expect(dup.isError).toBe(true)
    expect(text(dup)).toContain('Đã có project')
    expect(text(await c.callTool({ name: 'project_update', arguments: { name: 'docs', new_name: 'handbook', goal: '' } }))).toBe('updated docs')
    expect(team.updateProject).toHaveBeenCalledWith({ name: 'docs', new_name: 'handbook', goal: '' })
    await c.callTool({ name: 'agent_create', arguments: { name: 'QA', kind: 'claude', project: 'web-shop' } })
    expect(team.create).toHaveBeenLastCalledWith({ name: 'QA', kind: 'claude', project: 'web-shop' })
    // Không có tool xoá project cho agent.
    expect((await names(c)).some((n) => n.startsWith('project_') && /delete|remove/.test(n))).toBe(false)

    const off = await client(true, { manage: false, message: true })
    const list = await names(off)
    expect(list).not.toContain('project_create')
    expect(list).not.toContain('project_update')
    expect(text(await off.callTool({ name: 'project_create', arguments: { name: 'x' } }))).toBe(AGENT_API_OFF.manage)
  })

  it('không có team API → lỗi rõ ràng', async () => {
    const r = await (await client(false)).callTool({ name: 'agent_list', arguments: {} })
    expect(r.isError).toBe(true)
  })
})

describe('tool artifact_publish / artifact_reply (tab Sản phẩm)', () => {
  it('chỉ có khi app gắn kho sản phẩm; chuyển tham số và báo lỗi cho agent', async () => {
    const publish = vi.fn(async (i: { file: string }) => {
      if (i.file === 'missing.md') throw new Error('File "missing.md" does not exist in the project.')
      return 'Published "R" as v1'
    })
    const reply = vi.fn(async () => 'Reply added to c1')
    const server = createStagMcp({
      agent,
      workspace,
      board: {} as Board,
      browser: {} as BrowserService,
      teammates: () => [],
      syncSessionFile: async () => {},
      handoff: async () => {},
      artifacts: { publish, reply }
    })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(a), client.connect(b)])
    expect(await names(client)).toEqual(expect.arrayContaining(['artifact_publish', 'artifact_reply']))
    const ok = await client.callTool({ name: 'artifact_publish', arguments: { file: 'docs/r.md', title: 'R', description: 'd', fixes: ['c2'] } })
    expect((ok.content as Array<{ text: string }>)[0].text).toBe('Published "R" as v1')
    expect(publish).toHaveBeenCalledWith({ file: 'docs/r.md', title: 'R', description: 'd', fixes: ['c2'] })
    const bad = await client.callTool({ name: 'artifact_publish', arguments: { file: 'missing.md', title: 'R', description: '' } })
    expect(bad.isError).toBe(true)
    await client.callTool({ name: 'artifact_reply', arguments: { id: 'c1', text: 'OK?', options: ['Yes', 'No'] } })
    expect(reply).toHaveBeenCalledWith({ id: 'c1', text: 'OK?', options: ['Yes', 'No'] })

    const { client: plain } = await connect(undefined)
    expect((await names(plain)).some((n) => n.startsWith('artifact_'))).toBe(false)
  })
})
