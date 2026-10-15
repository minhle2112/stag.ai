import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, CreateAgentRequest, Workspace } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AgentService } from './agents'
import { ProjectService } from './projects'
import type { SettingsStore } from './settings'
import { WorkspaceStore } from './workspace'

const paths = vi.hoisted(() => ({ userData: '', trashed: [] as string[] }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => paths.userData
  },
  shell: {
    trashItem: async (p: string) => {
      paths.trashed.push(p)
      await (await import('node:fs')).promises.rm(p, { recursive: true, force: true })
    }
  }
}))

let root: string
let ws: Workspace
let store: WorkspaceStore

/** AgentService giả: chỉ phần ProjectService dùng. */
function fakeAgents(): AgentService & { list: Agent[]; removed: Array<{ id: string; keepNote?: boolean }> } {
  const list: Agent[] = []
  const removed: Array<{ id: string; keepNote?: boolean }> = []
  let n = 0
  const create = async (req: CreateAgentRequest): Promise<Agent> => {
    const a: Agent = { id: `a${++n}`, workspaceId: req.workspaceId, kind: req.kind, name: req.name, role: req.role, permissionMode: req.permissionMode, createdAt: '', ...(req.projectId ? { projectId: req.projectId } : {}) }
    list.push(a)
    return a
  }
  return {
    list,
    removed,
    snapshot: (id: string) => ({ agents: list.filter((a) => a.workspaceId === id), layout: { cells: [], closed: {}, view: null }, running: [] }),
    create,
    clone: async (id: string, projectId: string | null, name?: string) => {
      const src = list.find((a) => a.id === id)!
      return create({ workspaceId: src.workspaceId, kind: src.kind ?? 'claude', name: name ?? `${src.role} copy`, role: src.role, permissionMode: src.permissionMode, ...(projectId ? { projectId } : {}) })
    },
    projectAgents: (wsId: string, pid: string) => list.filter((a) => a.workspaceId === wsId && a.projectId === pid),
    remove: async (id: string, opts: { keepNote?: boolean } = {}) => {
      removed.push({ id, ...opts })
      list.splice(
        list.findIndex((a) => a.id === id),
        1
      )
    },
    forgetProject: async () => {}
  } as unknown as AgentService & { list: Agent[]; removed: Array<{ id: string; keepNote?: boolean }> }
}

const settings = { get: () => DEFAULT_SETTINGS, forget: async () => {} } as unknown as SettingsStore

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-projects-'))
  paths.userData = join(root, 'userData')
  paths.trashed = []
  const dir = join(root, 'shop')
  await fs.mkdir(join(dir, 'apps', 'web'), { recursive: true })
  await fs.writeFile(join(dir, 'apps', 'web', 'package.json'), '{}')
  await fs.mkdir(join(dir, 'apps', 'mobile'), { recursive: true })
  await fs.writeFile(join(dir, 'apps', 'mobile', 'package.json'), '{}')
  await fs.mkdir(join(dir, 'docs'), { recursive: true })
  await fs.mkdir(join(dir, 'mem'), { recursive: true })
  await fs.writeFile(join(dir, 'mem', '_INDEX.md'), '# idx\n')
  await fs.mkdir(paths.userData, { recursive: true })
  ws = { id: 'w1', name: 'shop', path: dir, vaultPath: join(dir, 'mem'), createdAt: '' }
  await fs.writeFile(join(paths.userData, 'workspaces.json'), JSON.stringify([ws]))
  store = new WorkspaceStore()
  await store.load()
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ProjectService', () => {
  it('liệt kê thư mục gốc + apps/*, bỏ vault, đánh dấu package.json', async () => {
    const svc = new ProjectService(store, fakeAgents(), settings)
    const f = await svc.folders('w1')
    expect(f.map((x) => x.path)).toEqual(['apps', 'apps/mobile', 'apps/web', 'docs'])
    expect(f.find((x) => x.path === 'apps/web')?.pkg).toBe(true)
  })

  it('tạo project với thư mục mới tự đặt tên, note vault, đội mẫu', async () => {
    const agents = fakeAgents()
    const svc = new ProjectService(store, agents, settings)
    const res = await svc.create({
      workspaceId: 'w1',
      name: 'Cổng Admin',
      goal: 'Trang quản trị',
      folder: { mode: 'new', name: '' },
      team: [
        { role: 'Dev', name: 'Dev · Cổng Admin', kind: 'claude' },
        { role: 'Tester', name: 'Tester · Cổng Admin', kind: 'codex' }
      ]
    })
    expect(res.project).toMatchObject({ name: 'Cổng Admin', folder: 'cong-admin', goal: 'Trang quản trị', note: '70 Projects/Cổng Admin/Cổng Admin.md' })
    expect(res.createdFolder).toBe(true)
    expect((await fs.stat(join(ws.path, 'cong-admin'))).isDirectory()).toBe(true)
    expect(res.agents.map((a) => [a.name, a.projectId])).toEqual([
      ['Dev · Cổng Admin', res.project.id],
      ['Tester · Cổng Admin', res.project.id]
    ])
    const note = await fs.readFile(join(ws.vaultPath, '70 Projects', 'Cổng Admin', 'Cổng Admin.md'), 'utf8')
    expect(note).toContain('type: project')
    expect(note).toContain('[[Dev · Cổng Admin]] (Dev)')
    expect(note).toContain('Back to: [[_INDEX]]')
    expect(store.get('w1')?.projects).toHaveLength(1)
    expect(store.get('w1')?.projectHintOff).toBe(true)

    // Trùng tên thư mục tự đặt → -2.
    await fs.mkdir(join(ws.path, 'shop-b'))
    const b = await svc.create({ workspaceId: 'w1', name: 'shop b', goal: '', folder: { mode: 'new', name: '' }, team: [] })
    expect(b.project.folder).toBe('shop-b-2')
  })

  it('từ chối: trùng tên project, thư mục lồng nhau, thư mục mới đã có, tên agent trùng', async () => {
    const agents = fakeAgents()
    const svc = new ProjectService(store, agents, settings)
    await svc.create({ workspaceId: 'w1', name: 'web', goal: '', folder: { mode: 'existing', path: 'apps/web' }, team: [{ role: 'Dev', name: 'Dev · web', kind: 'claude' }] })
    await expect(svc.create({ workspaceId: 'w1', name: 'WEB', goal: '', folder: { mode: 'existing', path: 'docs' }, team: [] })).rejects.toThrow(/A project named "web" already exists/)
    await expect(svc.create({ workspaceId: 'w1', name: 'apps', goal: '', folder: { mode: 'existing', path: 'apps' }, team: [] })).rejects.toThrow(/cannot be nested/)
    await expect(svc.create({ workspaceId: 'w1', name: 'd', goal: '', folder: { mode: 'new', name: 'docs' }, team: [] })).rejects.toThrow(/Folder docs already exists/)
    await expect(svc.create({ workspaceId: 'w1', name: 'm', goal: '', folder: { mode: 'existing', path: 'apps/mobile' }, team: [{ role: 'Dev', name: 'dev · WEB', kind: 'claude' }] })).rejects.toThrow(/An agent named/)
    await expect(svc.create({ workspaceId: 'w1', name: 'v', goal: '', folder: { mode: 'existing', path: 'mem' }, team: [] })).rejects.toThrow(/vault/)
    await expect(svc.create({ workspaceId: 'w1', name: 'x', goal: '', folder: { mode: 'existing', path: '../x' }, team: [] })).rejects.toThrow()
    expect(store.get('w1')?.projects).toHaveLength(1)
  })

  it('xoá project: xoá agent (giữ note), thư mục giữ nguyên trừ khi tick; liên kết bị bỏ', async () => {
    const agents = fakeAgents()
    const svc = new ProjectService(store, agents, settings)
    const web = await svc.create({ workspaceId: 'w1', name: 'web', goal: '', folder: { mode: 'existing', path: 'apps/web' }, team: [{ role: 'Dev', name: 'Dev · web', kind: 'claude' }] })
    const mob = await svc.create({ workspaceId: 'w1', name: 'mobile', goal: '', folder: { mode: 'existing', path: 'apps/mobile' }, team: [] })
    await svc.allowLink('w1', web.project.id, mob.project.id)
    expect(store.get('w1')?.projectLinks).toHaveLength(1)

    const info = await svc.deleteInfo('w1', web.project.id)
    expect(info).toMatchObject({ files: 1, exists: true })

    await svc.remove('w1', web.project.id, false)
    expect(agents.removed).toEqual([{ id: web.agents[0].id, keepNote: true }])
    expect((await fs.stat(join(ws.path, 'apps', 'web'))).isDirectory()).toBe(true)
    expect(store.get('w1')?.projects?.map((p) => p.name)).toEqual(['mobile'])
    expect(store.get('w1')?.projectLinks).toEqual([])
    // Note project giữ nguyên.
    await fs.access(join(ws.vaultPath, '70 Projects', 'web', 'web.md'))

    await svc.remove('w1', mob.project.id, true)
    expect(paths.trashed).toEqual([join(ws.path, 'apps', 'mobile')])
    await expect(fs.access(join(ws.path, 'apps', 'mobile'))).rejects.toThrow()
  })

  it('tool project_create: tự gắn vào AgentService; folderChoice + plan chọn thư mục, chưa ghi gì', async () => {
    const agents = fakeAgents() as ReturnType<typeof fakeAgents> & { attachProjects: (s: ProjectService) => void }
    agents.attachProjects = vi.fn()
    const svc = new ProjectService(store, agents, settings)
    expect(agents.attachProjects).toHaveBeenCalledWith(svc)

    expect(await svc.folderChoice('w1', undefined)).toEqual({ mode: 'new', name: '' })
    expect(await svc.folderChoice('w1', ' apps\\web/ ')).toEqual({ mode: 'existing', path: 'apps/web' })
    expect(await svc.folderChoice('w1', 'apps/admin')).toEqual({ mode: 'new', name: 'apps/admin' })
    await expect(svc.folderChoice('w1', '../ngoai')).rejects.toThrow(/Invalid folder/)

    const team = [{ role: 'Dev', name: 'Dev · Cổng Admin', kind: 'claude' as const }]
    const auto = await svc.plan({ workspaceId: 'w1', name: 'Cổng Admin', goal: '', folder: await svc.folderChoice('w1', ''), team })
    expect(auto).toEqual({ name: 'Cổng Admin', folder: 'cong-admin', created: true, note: '70 Projects/Cổng Admin/Cổng Admin.md' })
    expect(await svc.plan({ workspaceId: 'w1', name: 'web', goal: '', folder: await svc.folderChoice('w1', 'apps/web'), team: [] })).toEqual({
      name: 'web',
      folder: 'apps/web',
      created: false,
      note: '70 Projects/web/web.md'
    })
    await expect(svc.plan({ workspaceId: 'w1', name: 'v', goal: '', folder: await svc.folderChoice('w1', 'mem'), team: [] })).rejects.toThrow(/vault/)
    // plan không tạo thư mục, project hay agent.
    await expect(fs.access(join(ws.path, 'cong-admin'))).rejects.toThrow()
    expect(store.get('w1')?.projects ?? []).toHaveLength(0)
    expect(agents.list).toHaveLength(0)

    // Tạo đúng thư mục đã chốt trên thẻ hỏi.
    const res = await svc.create({ workspaceId: 'w1', name: 'Cổng Admin', goal: '', folder: { mode: 'new', name: auto.folder }, team })
    expect(res.project.folder).toBe('cong-admin')
    expect(res.createdFolder).toBe(true)
  })

  it('đổi tên / mục tiêu, không trùng tên project khác', async () => {
    const svc = new ProjectService(store, fakeAgents(), settings)
    const a = await svc.create({ workspaceId: 'w1', name: 'web', goal: '', folder: { mode: 'existing', path: 'apps/web' }, team: [] })
    await svc.create({ workspaceId: 'w1', name: 'mobile', goal: '', folder: { mode: 'existing', path: 'apps/mobile' }, team: [] })
    await expect(svc.update('w1', a.project.id, { name: 'Mobile' })).rejects.toThrow(/already exists/)
    const w = await svc.update('w1', a.project.id, { name: 'web-shop', goal: ' Bán hàng ' })
    expect(w.projects?.[0]).toMatchObject({ name: 'web-shop', goal: 'Bán hàng', folder: 'apps/web', note: '70 Projects/web/web.md' })
  })

  it('folderChoice từ chối thư mục cấm / không hợp lệ (cho tool project_create)', async () => {
    const svc = new ProjectService(store, fakeAgents(), settings)
    for (const bad of ['../x', 'a/../x', 'C:\\Windows', '.', '.git', '.stag/x', '.sessions', 'node_modules/x', 'a<b', 'apps/nul', 'foo.']) {
      await expect(svc.folderChoice('w1', bad), bad).rejects.toThrow(/Invalid folder/)
    }
    // Lý do đúng cho từng loại (agent biết phải sửa gì).
    const why = async (f: string): Promise<string> => (await svc.folderChoice('w1', f).catch((e: Error) => e.message)) as string
    expect(await why('C:\\Windows')).toMatch(/not an absolute path/)
    expect(await why('a/../x')).toMatch(/without "\." or "\.\."/)
    expect(await why('node_modules/x')).toMatch(/"node_modules" is used by/)
    expect(await why('a<b')).toMatch(/cannot contain/)
    expect(await why('foo.')).toMatch(/end with a dot/)
    expect(await why('apps/nul')).toMatch(/"nul" is a reserved Windows name/)
    // Thư mục vault / lồng trong vault: folderChoice cho qua, plan chặn.
    for (const f of ['mem', 'MEM', 'mem/sub']) {
      await expect(svc.plan({ workspaceId: 'w1', name: 'v', goal: '', folder: await svc.folderChoice('w1', f), team: [] }), f).rejects.toThrow(/vault/)
    }
    // Một file trùng tên: báo rõ là file (không nhắc nút "Dùng thư mục có sẵn" của hộp thoại).
    await fs.writeFile(join(ws.path, 'docs', 'a.txt'), 'x')
    await expect(svc.folderChoice('w1', 'docs/a.txt')).rejects.toThrow(/is a file, not a folder/)
  })

  // Tester 2026-10-13 (B1): đổi tên project giữ nguyên `note`, nên một project mới đặt đúng tên cũ từng lấy chung note
  // của project cũ → giờ project mới nhận note riêng ("<tên> 2").
  it('project mới đặt tên cũ của project đã đổi tên không dùng chung note', async () => {
    const svc = new ProjectService(store, fakeAgents(), settings)
    const a = await svc.create({ workspaceId: 'w1', name: 'shop-web', goal: 'Cũ', folder: { mode: 'existing', path: 'apps/web' }, team: [] })
    await svc.update('w1', a.project.id, { name: 'shop' })
    const b = await svc.create({ workspaceId: 'w1', name: 'shop-web', goal: 'Mới', folder: { mode: 'new', name: '' }, team: [] })
    expect(b.project.note.toLowerCase()).not.toBe(a.project.note.toLowerCase())
    const note = await fs.readFile(join(ws.vaultPath, ...b.project.note.split('/')), 'utf8')
    expect(note).toContain('Mới')
  })
})
