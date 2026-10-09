import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BROWSER_TOOLS_OFF } from '@shared/browser'
import type { Agent, Workspace } from '@shared/types'
import type { BrowserService } from './browser'
import type { Board } from './board'
import { createStagMcp } from './mcp'

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
