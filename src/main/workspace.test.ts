import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateWorkspaceRequest } from '@shared/types'
import { today } from './fsutil'
import { autoMemoryDir, ensureIgnored, gitignoreEscape, safeName, WorkspaceStore } from './workspace'

// userData và thư mục home (~/.claude/projects/...) đều trỏ vào thư mục tạm.
// Template gốc lấy từ resources/templates của repo (chỉ đọc) để test đúng template thật.
const paths = vi.hoisted(() => ({ userData: '', home: '' }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`test chưa mock app.getPath('${name}')`)
      return paths.userData
    }
  }
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const homedir = (): string => {
    if (!paths.home) throw new Error('test chưa đặt home tạm')
    return paths.home
  }
  return { ...actual, default: { ...actual, homedir }, homedir }
})

let root: string
let project: string

const count = (text: string, re: RegExp): number => (text.match(new RegExp(re.source, 'gm')) ?? []).length
const readFile = (p: string): Promise<string> => fs.readFile(p, 'utf8')

function req(over: Partial<CreateWorkspaceRequest> = {}): CreateWorkspaceRequest {
  return { path: project, name: 'Demo', vault: { mode: 'new' }, gitInit: false, ...over }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-workspace-'))
  paths.userData = join(root, 'userData')
  paths.home = join(root, 'home')
  project = join(root, 'Demo')
  await fs.mkdir(project, { recursive: true })
})

afterEach(async () => {
  paths.home = ''
  await fs.rm(root, { recursive: true, force: true })
})

describe('autoMemoryDir', () => {
  it('mọi ký tự ngoài [A-Za-z0-9] thành -, đặt trong ~/.claude/projects', () => {
    expect(autoMemoryDir('C:\\Users\\piopy\\Desktop\\stag.ai')).toBe(
      join(paths.home, '.claude', 'projects', 'C--Users-piopy-Desktop-stag-ai', 'memory')
    )
  })

  it('đường dẫn viết bằng / cho cùng thư mục', () => {
    expect(autoMemoryDir('C:/Users/piopy/Desktop/stag.ai')).toBe(autoMemoryDir('C:\\Users\\piopy\\Desktop\\stag.ai'))
  })
})

describe('safeName', () => {
  it('thay ký tự cấm trong tên file Windows và cắt khoảng trắng', () => {
    expect(safeName('  a<b>c:d"e/f\\g|h?i*j  ')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeName('Dự án đẹp')).toBe('Dự án đẹp')
  })
})

describe('ensureIgnored', () => {
  it('không phải repo git → không làm gì', async () => {
    expect(await ensureIgnored(project, ['.stag/'], 'x')).toEqual([])
    await expect(fs.access(join(project, '.gitignore'))).rejects.toThrow()
  })

  it('thêm dòng còn thiếu, giữ nội dung cũ, chạy lại không thêm trùng', async () => {
    await fs.mkdir(join(project, '.git'))
    await fs.writeFile(join(project, '.gitignore'), 'node_modules/\n/.sessions/', 'utf8')

    expect(await ensureIgnored(project, ['.sessions/', '.stag/'], 'Kanban')).toEqual(['.stag/'])
    expect(await readFile(join(project, '.gitignore'))).toBe('node_modules/\n/.sessions/\n\n# Kanban\n.stag/\n')

    expect(await ensureIgnored(project, ['.sessions/', '.stag/'], 'Kanban')).toEqual([])
  })

  it('.gitignore chưa có → tạo mới không có dòng trống đầu', async () => {
    await fs.mkdir(join(project, '.git'))
    expect(await ensureIgnored(project, ['a/'], 'H')).toEqual(['a/'])
    expect(await readFile(join(project, '.gitignore'))).toBe('# H\na/\n')
  })
})

describe('WorkspaceStore.create', () => {
  it('tạo vault mới đúng mẫu (không tạo .obsidian) + CLAUDE.md + cache MEMORY.md', async () => {
    const store = new WorkspaceStore()
    const { workspace, report } = await store.create(req())
    const vault = join(project, 'Demo memory')

    expect(workspace).toMatchObject({ name: 'Demo', path: project, vaultPath: vault })
    expect(await readFile(join(vault, '_INDEX.md'))).toMatch(/^---\r?\ntype: index/)
    await expect(fs.stat(join(vault, '.obsidian'))).rejects.toThrow()
    expect(await readFile(join(vault, '10 Demo', 'Demo.md'))).toContain('Demo')
    expect(await fs.readdir(join(vault, '40 Log'))).toContain(`${today()}.md`)
    // .keep không bị chép vào vault thật
    expect(await fs.readdir(join(vault, '60 Agents'))).toEqual([])

    const claude = await readFile(join(project, 'CLAUDE.md'))
    expect(claude).toContain(vault)
    expect(count(claude, /^## Memory/)).toBe(1)
    expect(claude).not.toMatch(/\{\{[A-Z_]+\}\}/)

    const memory = await readFile(join(autoMemoryDir(project), 'MEMORY.md'))
    expect(memory).toContain(vault)
    expect(memory).toContain('_INDEX.md')

    expect(report.some((r) => r.startsWith('Tạo vault mới'))).toBe(true)
    // Không phải repo git, không gitInit → không có .gitignore
    await expect(fs.access(join(project, '.gitignore'))).rejects.toThrow()

    // Danh sách workspace lưu ở userData và đọc lại được.
    const again = new WorkspaceStore()
    await again.load()
    expect(again.list()).toEqual([workspace])
  })

  it('CLAUDE.md có sẵn: chỉ nối mục Memory một lần, giữ nội dung cũ', async () => {
    await fs.writeFile(join(project, 'CLAUDE.md'), '# Dự án của tôi\nLuật riêng.', 'utf8')
    const store = new WorkspaceStore()
    const first = await store.create(req())
    expect(first.report).toContain('CLAUDE.md có sẵn: thêm mục Memory vào cuối file')

    const after1 = await readFile(join(project, 'CLAUDE.md'))
    expect(after1.startsWith('# Dự án của tôi\nLuật riêng.\n\n## Memory')).toBe(true)
    expect(count(after1, /^## Memory/)).toBe(1)

    // Bỏ khỏi app rồi thêm lại (dùng vault có sẵn) → không nối thêm lần nữa.
    await store.remove(first.workspace.id)
    const second = await store.create(req({ vault: { mode: 'existing', path: first.workspace.vaultPath, augment: false } }))
    expect(second.report).toContain('CLAUDE.md đã có mục Memory, giữ nguyên')
    expect(await readFile(join(project, 'CLAUDE.md'))).toBe(after1)
  })

  it('CLAUDE.md đã nhắc vault bằng / và khác hoa thường → giữ nguyên', async () => {
    const vault = join(project, 'Demo memory')
    const original = `# X\nVault ở ${vault.replace(/\\/g, '/').toLowerCase()}\n`
    await fs.writeFile(join(project, 'CLAUDE.md'), original, 'utf8')
    await new WorkspaceStore().create(req())
    expect(await readFile(join(project, 'CLAUDE.md'))).toBe(original)
  })

  it('MEMORY.md đã trỏ về vault bằng / (khác \\, khác hoa thường) → không thêm dòng trùng', async () => {
    const vault = join(project, 'Demo memory')
    const memDir = autoMemoryDir(project)
    await fs.mkdir(memDir, { recursive: true })
    const original = `- Vault: \`${vault.replace(/\\/g, '/').toUpperCase()}\`\n`
    await fs.writeFile(join(memDir, 'MEMORY.md'), original, 'utf8')

    const { report } = await new WorkspaceStore().create(req())

    expect(report).toContain('Cache auto memory đã trỏ về vault, giữ nguyên')
    expect(await readFile(join(memDir, 'MEMORY.md'))).toBe(original)
  })

  it('MEMORY.md có sẵn nội dung khác → nối đúng một dòng, lần sau không nối nữa', async () => {
    const memDir = autoMemoryDir(project)
    await fs.mkdir(memDir, { recursive: true })
    await fs.writeFile(join(memDir, 'MEMORY.md'), '- ghi chú cũ', 'utf8')

    const store = new WorkspaceStore()
    const first = await store.create(req())
    const after1 = await readFile(join(memDir, 'MEMORY.md'))
    expect(after1.startsWith('- ghi chú cũ\n- ')).toBe(true)
    expect(count(after1, /Demo memory/)).toBe(1)

    await store.remove(first.workspace.id)
    // Lần này đường dẫn dự án và vault viết bằng / → vẫn phải nhận ra là cùng một vault.
    await store.create(
      req({
        path: project.replace(/\\/g, '/'),
        vault: { mode: 'existing', path: first.workspace.vaultPath.replace(/\\/g, '/'), augment: false }
      })
    )
    expect(await readFile(join(memDir, 'MEMORY.md'))).toBe(after1)
  })

  it('vault Obsidian khác mẫu (không _INDEX.md), không bổ sung → giữ nguyên, dùng biến thể plain', async () => {
    const vault = join(project, 'notes')
    await fs.mkdir(join(vault, '.obsidian'), { recursive: true })
    await fs.writeFile(join(vault, 'a.md'), 'x', 'utf8')

    const { report } = await new WorkspaceStore().create(req({ vault: { mode: 'existing', path: vault, augment: false } }))

    expect(report).toContain('Dùng vault có sẵn "notes", giữ nguyên')
    expect((await fs.readdir(vault)).sort()).toEqual(['.obsidian', 'a.md'])
    const claude = await readFile(join(project, 'CLAUDE.md'))
    expect(claude).toContain('not in the stag.ai layout')
    expect(claude).not.toContain('_INDEX.md')
    expect(await readFile(join(autoMemoryDir(project), 'MEMORY.md'))).not.toContain('_INDEX.md')
  })

  it('bổ sung vault đúng mẫu có sẵn: thêm phần thiếu, không ghi đè, không tạo log/quyết định mang ngày mới', async () => {
    const vault = join(project, 'Demo memory')
    await fs.mkdir(vault, { recursive: true })
    const index = '---\ntype: index\n---\n# INDEX của tôi\n'
    await fs.writeFile(join(vault, '_INDEX.md'), index, 'utf8')

    const { report } = await new WorkspaceStore().create(req({ vault: { mode: 'existing', path: vault, augment: true } }))

    expect(await readFile(join(vault, '_INDEX.md'))).toBe(index)
    expect(await fs.readdir(join(vault, '40 Log'))).toEqual(['_Template.md'])
    expect((await fs.readdir(join(vault, '50 Decisions'))).filter((f) => f.startsWith(today()))).toEqual([])
    expect(report.some((r) => r.startsWith('Bổ sung vào vault có sẵn'))).toBe(true)
  })

  it('repo git có sẵn → .gitignore loại trừ vault, .sessions/ (không thêm .obsidian/)', async () => {
    await fs.mkdir(join(project, '.git'))
    await new WorkspaceStore().create(req())
    const gi = await readFile(join(project, '.gitignore'))
    expect(gi.split('\n')).toEqual(expect.arrayContaining(['Demo memory/', '.sessions/']))
    expect(gi).not.toContain('.obsidian/')
  })

  it('vault tự chọn ngoài thư mục dự án (trống, bổ sung template): dùng đường dẫn tuyệt đối, .gitignore không có dòng ../', async () => {
    const outside = join(root, 'Notes', 'My vault')
    await fs.mkdir(outside, { recursive: true })
    await fs.mkdir(join(project, '.git'))
    const { workspace, report } = await new WorkspaceStore().create(req({ vault: { mode: 'existing', path: outside, augment: true } }))
    expect(workspace.vaultPath).toBe(outside)
    expect(await readFile(join(outside, '_INDEX.md'))).toMatch(/^---\r?\ntype: index/)
    expect(await readFile(join(project, 'CLAUDE.md'))).toContain(outside)
    const gi = await readFile(join(project, '.gitignore'))
    expect(gi).not.toContain('..')
    expect(gi.split('\n')).toContain('.sessions/')
    expect(report.some((r) => r.includes('vault nằm ngoài thư mục dự án'))).toBe(true)
  })

  it('vault có sẵn mà thư mục không tồn tại → lỗi, không tạo gì', async () => {
    const missing = join(root, 'nope')
    await expect(new WorkspaceStore().create(req({ vault: { mode: 'existing', path: missing, augment: true } }))).rejects.toThrow(/Không tìm thấy thư mục vault/)
    await expect(fs.stat(missing)).rejects.toThrow()
  })

  it('báo lỗi: thư mục không có / đã là workspace (khác / \\) / vault mới trùng tên thư mục có sẵn', async () => {
    const store = new WorkspaceStore()
    await expect(store.create(req({ path: join(root, 'không có') }))).rejects.toThrow('Không tìm thấy thư mục')

    await fs.mkdir(join(project, 'Demo memory'))
    await expect(store.create(req())).rejects.toThrow('Đã có thư mục')

    await fs.rm(join(project, 'Demo memory'), { recursive: true })
    await store.create(req())
    await expect(store.create(req({ path: project.replace(/\\/g, '/').toUpperCase() }))).rejects.toThrow('đã là một workspace')
  })

  it('tên có ký tự cấm được làm sạch trước khi đặt tên vault', async () => {
    const { workspace } = await new WorkspaceStore().create(req({ name: 'A/B:C' }))
    expect(workspace.name).toBe('A-B-C')
    expect(workspace.vaultPath).toBe(join(project, 'A-B-C memory'))
  })
})

describe('WorkspaceStore.load', () => {
  it('workspaces.json hỏng: mở với danh sách trống, giữ bản hỏng; lưu lại được', async () => {
    await fs.mkdir(paths.userData, { recursive: true })
    const file = join(paths.userData, 'workspaces.json')
    await fs.writeFile(file, '[{"id":"a","pa')
    const store = new WorkspaceStore()
    await store.load()
    expect(store.list()).toEqual([])
    expect((await fs.readdir(paths.userData)).some((n) => n.startsWith('workspaces.json.broken-'))).toBe(true)
    await Promise.all([store.create(req()), store.remove('nope')])
    expect(JSON.parse(await readFile(file))).toHaveLength(1)
  })
})

describe('gitignoreEscape', () => {
  it('thoát ký tự đặc biệt của .gitignore', () => {
    expect(gitignoreEscape('Demo memory')).toBe('Demo memory')
    expect(gitignoreEscape('#notes')).toBe('\\#notes')
    expect(gitignoreEscape('!x')).toBe('\\!x')
    expect(gitignoreEscape('a [b]*?')).toBe('a \\[b]\\*\\?')
    expect(gitignoreEscape('trail ')).toBe('trail\\ ')
  })
})

describe('WorkspaceStore.inspect', () => {
  it('trả thông tin thư mục và workspace đã có (so đường dẫn không phân biệt / \\)', async () => {
    vi.stubEnv('APPDATA', join(root, 'AppData')) // không đọc obsidian.json thật
    try {
      const store = new WorkspaceStore()
      const { workspace } = await store.create(req())
      const info = await store.inspect(project.replace(/\\/g, '/'))
      expect(info.path).toBe(project)
      expect(info.suggestedName).toBe('Demo')
      expect(info.isGitRepo).toBe(false)
      expect(info.candidates.map((c) => [c.relPath, c.kind])).toEqual([['Demo memory', 'stag']])
      expect(info.existing).toEqual(workspace)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
