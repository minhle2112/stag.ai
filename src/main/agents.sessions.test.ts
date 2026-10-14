import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { DEFAULT_SETTINGS, type Agent, type Workspace } from '@shared/types'
import { AgentService } from './agents'
import { SkillLibrary } from './skills'

const paths = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => paths.userData,
    getPreferredSystemLanguages: () => ['en-US'],
    getLocale: () => 'en-US'
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { trashItem: async () => {} }
}))

/** Đối tượng giả: hàm nào không khai thì là hàm rỗng trả undefined. */
const stub = <T>(over: Record<string, unknown> = {}): T =>
  new Proxy(over, { get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : () => undefined) }) as T

let root: string
let ws: Workspace
let skills: SkillLibrary
/** pty giả: `fail` = spawn ném lỗi (CLI không chạy được); onExit của lần spawn gần nhất. */
let pty: { fail: boolean; onExit: (() => void) | null }

const agentsFile = (): string => join(paths.userData, 'agents.json')
const readStore = async (): Promise<{ agents: Agent[]; firstTasks?: Record<string, unknown>; openSessions?: unknown[] }> =>
  JSON.parse(await fs.readFile(agentsFile(), 'utf8'))
const sessionFiles = async (): Promise<string[]> => (await fs.readdir(join(ws.path, '.sessions')).catch(() => [] as string[])).sort()

function service(): AgentService {
  const svc = new AgentService(
    stub({
      spawn: (_owner: unknown, _spec: unknown, o: { onExit: () => void }) => {
        if (pty.fail) throw new Error('spawn lỗi')
        pty.onExit = o.onExit
        return 'pty-1'
      }
    }),
    stub({ get: (id: string) => (id === ws.id ? ws : undefined), list: () => [ws] }),
    stub({ openTask: async () => undefined, dropAgentTasks: async () => {} }),
    stub(),
    stub({ get: () => DEFAULT_SETTINGS }),
    stub(),
    stub(),
    stub({ exe: async () => ({ path: 'cli-exe' }), env: () => ({}), launchArgs: () => [] }),
    stub(),
    stub(),
    stub({ fresh: async () => new Map() }),
    stub(),
    skills,
    stub({ writer: stub(), compactIndex: async () => null, compact: async () => null }),
    stub()
  )
  // Máy chủ trạng thái giả: file cấu hình riêng của phiên ghi cạnh file phiên như hub thật.
  ;(svc as unknown as { hub: unknown }).hub = stub({
    writeSessionConfigs: async (base: string) => {
      await fs.writeFile(`${base}.mcp.json`, '{}')
      return { mcpFile: `${base}.mcp.json` }
    },
    claudeArgs: () => [],
    issueToken: () => ({ token: 't', env: {} }),
    endpoints: () => ({ hookUrl: 'http://127.0.0.1:1/hook', mcpUrl: 'http://127.0.0.1:1/mcp' })
  })
  return svc
}

const owner = stub<WebContents>({ isDestroyed: () => false })

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-agents-'))
  paths.userData = join(root, 'userData')
  await fs.mkdir(paths.userData, { recursive: true })
  ws = { id: 'w1', name: 'shop', path: join(root, 'shop'), vaultPath: join(root, 'shop', 'mem'), createdAt: '' }
  await fs.mkdir(ws.vaultPath, { recursive: true })
  skills = new SkillLibrary(join(paths.userData, 'skills'), resolve('resources/skill-catalog'), join(paths.userData, 'skill-sessions'))
  pty = { fail: false, onExit: null }
})
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 30))
  await fs.rm(root, { recursive: true, force: true })
})

describe('việc đầu của agent chưa chạy (firstTasks)', () => {
  it('lưu file: thoát app trước khi mở ô vẫn còn; xoá agent / workspace thì bỏ', async () => {
    let svc = service()
    await svc.load()
    const a = await svc.create({ workspaceId: ws.id, kind: 'claude', name: 'Dev', role: 'dev', permissionMode: 'default', firstTask: 'Sửa trang chủ' })
    const b = await svc.create({ workspaceId: ws.id, kind: 'claude', name: 'QA', role: 'qa', permissionMode: 'default', firstTask: 'Thử trang chủ' })
    expect((await readStore()).firstTasks?.[a.id]).toMatchObject({ task: 'Sửa trang chủ', user: true })

    // Mở lại app: việc đầu vẫn còn.
    svc = service()
    await svc.load()
    expect(Object.keys((await readStore()).firstTasks ?? {}).sort()).toEqual([a.id, b.id].sort())

    await svc.remove(a.id, { keepNote: true })
    expect(Object.keys((await readStore()).firstTasks ?? {})).toEqual([b.id])
    await svc.removeWorkspace(ws.id)
    expect((await readStore()).firstTasks ?? {}).toEqual({})
  })

  it('mở phiên: việc đầu thành lời mở rồi bỏ khỏi file', async () => {
    const svc = service()
    await svc.load()
    const a = await svc.create({ workspaceId: ws.id, kind: 'codex', name: 'Dev', role: '', permissionMode: 'default', firstTask: 'Sửa trang chủ' })
    await svc.start(owner, { agentId: a.id, resume: false, cols: 80, rows: 24 })
    expect((await readStore()).firstTasks?.[a.id]).toBeUndefined()
    pty.onExit?.()
  })

  it('mở app: bỏ việc đầu của agent không còn', async () => {
    await fs.writeFile(agentsFile(), JSON.stringify({ agents: [], layouts: {}, firstTasks: { ghost: { from: '', task: 'x', created: true } } }))
    await service().load()
    expect((await readStore()).firstTasks).toEqual({})
  })
})

describe('file phiên trong .sessions/', () => {
  it('mở phiên lỗi: dọn file phiên và bản chép skill, không để file mồ côi', async () => {
    await skills.create('helper', 'Helps')
    const svc = service()
    await svc.load()
    const a = await svc.create({ workspaceId: ws.id, kind: 'claude', name: 'Dev', role: '', permissionMode: 'default' })
    pty.fail = true
    await expect(svc.start(owner, { agentId: a.id, resume: false, cols: 80, rows: 24 })).rejects.toThrow(/spawn lỗi/)
    await new Promise((r) => setTimeout(r, 30))
    expect(await sessionFiles()).toEqual([])
    expect(await fs.readdir(skills.sessionsRoot).catch(() => [])).toEqual([])
    expect((await readStore()).openSessions ?? []).toEqual([])
  })

  it('Codex: phiên đóng thì dọn; app tắt đột ngột thì lần mở sau dọn (id phiên khác lastSessionId)', async () => {
    let svc = service()
    await svc.load()
    const a = await svc.create({ workspaceId: ws.id, kind: 'codex', name: 'Dev', role: '', permissionMode: 'default' })
    await svc.start(owner, { agentId: a.id, resume: false, cols: 80, rows: 24 })
    expect((await sessionFiles()).length).toBeGreaterThan(0)
    pty.onExit?.()
    expect(await sessionFiles()).toEqual([])
    await new Promise((r) => setTimeout(r, 30))
    expect((await readStore()).openSessions ?? []).toEqual([])

    // Lần này app "chết" khi phiên đang chạy (không gọi onExit / shutdown), Codex đã báo thread id riêng.
    await svc.start(owner, { agentId: a.id, resume: false, cols: 80, rows: 24 })
    const store = await readStore()
    store.agents[0].lastSessionId = 'codex-thread-id'
    await fs.writeFile(agentsFile(), JSON.stringify(store))
    expect((await sessionFiles()).length).toBeGreaterThan(0)
    svc = service()
    await svc.load()
    expect(await sessionFiles()).toEqual([])
    expect((await readStore()).openSessions).toBeUndefined()
  })

  it('danh sách phiên sửa tay trỏ ra ngoài .sessions/: không xoá', async () => {
    await fs.writeFile(join(root, 'keep.md'), 'x')
    await fs.writeFile(agentsFile(), JSON.stringify({ agents: [], layouts: {}, openSessions: [{ workspaceId: ws.id, sessionId: '../../keep' }] }))
    await service().load()
    expect(await fs.readFile(join(root, 'keep.md'), 'utf8')).toBe('x')
  })
})
