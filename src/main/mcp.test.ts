import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BROWSER_TOOLS_OFF } from '@shared/browser'
import type { Agent, Workspace } from '@shared/types'
import type { BrowserService } from './browser'
import type { Board } from './board'
import { createStagMcp, type TeamApi } from './mcp'

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
      { id: 'a1', name: 'Agent 1', role: 'Lead', kind: 'claude', kindLabel: 'Claude Code', model: 'opus', effort: 'high', permissionMode: 'default', running: true, activity: 'working' },
      { id: 'a2', name: 'Tester', role: '', kind: 'codex', kindLabel: 'Codex', model: '', effort: null, permissionMode: 'acceptEdits', running: false, activity: null },
      { id: 'a3', name: 'Shell', role: '', kind: 'terminal', kindLabel: 'Terminal', model: null, effort: null, permissionMode: 'default', running: true, activity: null }
    ],
    adapters: async () => [
      { kind: 'claude', label: 'Claude Code', available: true, detail: '2.1.300, logged in', defaultModel: 'opus', defaultEffort: 'high', models: [{ id: 'opus', label: 'Opus', efforts: ['low', 'high'] }] },
      { kind: 'codex', label: 'Codex', available: false, detail: 'Không tìm thấy codex', defaultModel: '', defaultEffort: null, models: [] },
      { kind: 'terminal', label: 'Terminal', available: true, detail: '', defaultModel: null, defaultEffort: null, models: [] }
    ]
  }

  async function client(withTeam: boolean): Promise<Client> {
    const server = createStagMcp({
      agent,
      workspace,
      board: {} as Board,
      browser: {} as BrowserService,
      teammates: () => [],
      syncSessionFile: async () => {},
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
    expect(t).toContain('- Agent 1 (you) — role: Lead — Claude Code [kind: claude], model opus, effort high, permission: default — session running (working)')
    expect(t).toContain('- Tester — Codex [kind: codex], model default (CLI config), permission: acceptEdits — session stopped')
    expect(t).toContain('- Shell — plain terminal — session running')
  })

  it('adapter_models: loại tạo được, có sẵn hay không, model + effort', async () => {
    const t = text(await (await client(true)).callTool({ name: 'adapter_models', arguments: {} }))
    expect(t).toContain('kind "claude" — Claude Code: available (2.1.300, logged in). Default here: model opus, effort high. Known models: opus (Opus) [effort: low|high].')
    expect(t).toContain('kind "codex" — Codex: NOT available (Không tìm thấy codex)')
    expect(t).toContain('kind "terminal" — Terminal: available. No model choice.')
  })

  it('không có team API → lỗi rõ ràng', async () => {
    const r = await (await client(false)).callTool({ name: 'agent_list', arguments: {} })
    expect(r.isError).toBe(true)
  })
})
