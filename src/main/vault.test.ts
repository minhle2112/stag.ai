import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultProjectName, detectVaults, inspectVaultDir, readNote, vaultDirName, vaultTree } from './vault'

let root: string
let project: string
let appData: string

const STAG_INDEX = '---\ntype: index\nupdated: 2026-01-01\n---\n# INDEX\n'

async function put(rel: string, content = ''): Promise<void> {
  const file = join(project, rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
}

async function mkdir(rel: string): Promise<void> {
  await fs.mkdir(join(project, rel), { recursive: true })
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-vault-'))
  project = join(root, 'proj')
  appData = join(root, 'AppData')
  await fs.mkdir(project, { recursive: true })
  vi.stubEnv('APPDATA', appData)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true })
})

describe('inspectVaultDir (thư mục vault tự chọn)', () => {
  it('đúng mẫu / khác mẫu / trống (bỏ mục ẩn); trong hay ngoài thư mục dự án', async () => {
    await put('proj memory/_INDEX.md', STAG_INDEX)
    expect(await inspectVaultDir(join(project, 'proj memory'), project)).toEqual({
      path: join(project, 'proj memory'),
      relPath: 'proj memory',
      kind: 'stag',
      empty: false,
      outside: false
    })
    await put('deep/a/b/c/note.md', 'x')
    expect(await inspectVaultDir(join(project, 'deep/a/b/c'), project)).toMatchObject({ relPath: join('deep', 'a', 'b', 'c'), kind: 'other', empty: false })
    const outside = join(root, 'elsewhere')
    await fs.mkdir(join(outside, '.obsidian'), { recursive: true })
    expect(await inspectVaultDir(outside, project)).toEqual({ path: outside, relPath: outside, kind: 'other', empty: true, outside: true })
    expect((await inspectVaultDir(project, project)).relPath).toBe('')
  })

  it('không có thư mục → lỗi', async () => {
    await expect(inspectVaultDir(join(root, 'nope'), project)).rejects.toThrow(/Không tìm thấy thư mục/)
  })
})

describe('detectVaults', () => {
  it('thư mục trống → không có vault', async () => {
    expect(await detectVaults(project)).toEqual([])
  })

  it('thư mục con có _INDEX.md type: index → vault đúng mẫu stag', async () => {
    await put('proj memory/_INDEX.md', STAG_INDEX)
    expect(await detectVaults(project)).toEqual([
      { path: join(project, 'proj memory'), relPath: 'proj memory', kind: 'stag' }
    ])
  })

  it('_INDEX.md xuống dòng CRLF vẫn nhận', async () => {
    await put('m/_INDEX.md', STAG_INDEX.replace(/\n/g, '\r\n'))
    expect((await detectVaults(project)).map((v) => v.kind)).toEqual(['stag'])
  })

  it('_INDEX.md không có type: index → không phải vault', async () => {
    await put('a/_INDEX.md', '# Không frontmatter\ntype: index\n')
    await put('b/_INDEX.md', '---\ntype: note\n---\n')
    expect(await detectVaults(project)).toEqual([])
  })

  it('có .obsidian/ → vault có sẵn khác mẫu', async () => {
    await mkdir('notes/.obsidian')
    await put('notes/a.md', 'x')
    expect(await detectVaults(project)).toEqual([
      { path: join(project, 'notes'), relPath: 'notes', kind: 'other' }
    ])
  })

  it('chính thư mục dự án là vault → relPath rỗng, không quét vault lồng bên trong', async () => {
    await mkdir('.obsidian')
    await put('inner/_INDEX.md', STAG_INDEX)
    expect(await detectVaults(project)).toEqual([{ path: project, relPath: '', kind: 'other' }])
  })

  it('vault đúng mẫu lên trước, rồi theo relPath', async () => {
    await mkdir('z-obs/.obsidian')
    await mkdir('a-obs/.obsidian')
    await put('m memory/_INDEX.md', STAG_INDEX)
    await mkdir('m memory/.obsidian')
    expect((await detectVaults(project)).map((v) => [v.relPath, v.kind])).toEqual([
      ['m memory', 'stag'],
      ['a-obs', 'other'],
      ['z-obs', 'other']
    ])
  })

  it('quét tối đa 2 cấp và bỏ qua node_modules, .git…', async () => {
    await mkdir(join('a', 'b', '.obsidian')) // cấp 2 → thấy
    await mkdir(join('a', 'b2', 'c', '.obsidian')) // cấp 3 → không thấy
    await mkdir(join('node_modules', 'pkg', '.obsidian'))
    await mkdir(join('.git', '.obsidian'))
    expect((await detectVaults(project)).map((v) => v.relPath)).toEqual([join('a', 'b')])
  })
})

describe('vaultTree / readNote', () => {
  it('chỉ lấy thư mục + .md, bỏ mục ẩn, thư mục lên trước', async () => {
    await put('v/_INDEX.md')
    await put('v/10 A/note 2.md')
    await put('v/10 A/note 10.md')
    await put('v/10 A/ảnh.png')
    await put('v/.obsidian/app.json')
    await put('v/.hidden.md')
    const tree = await vaultTree(join(project, 'v'))
    expect(tree).toEqual([
      {
        name: '10 A',
        rel: '10 A',
        dir: true,
        children: [
          { name: 'note 2', rel: '10 A/note 2.md', dir: false },
          { name: 'note 10', rel: '10 A/note 10.md', dir: false }
        ]
      },
      { name: '_INDEX', rel: '_INDEX.md', dir: false }
    ])
  })

  it('vault không tồn tại → cây rỗng', async () => {
    expect(await vaultTree(join(project, 'không có'))).toEqual([])
  })

  it('readNote đọc note trong vault, chặn đường dẫn thoát ra ngoài', async () => {
    await put('v/a.md', 'nội dung')
    await put('bí mật.md', 'không được đọc')
    const vault = join(project, 'v')
    expect(await readNote(vault, 'a.md')).toBe('nội dung')
    await expect(readNote(vault, '../bí mật.md')).rejects.toThrow('ngoài vault')
    await expect(readNote(vault, join(project, 'bí mật.md'))).rejects.toThrow('ngoài vault')
    // Thư mục anh em có tên bắt đầu bằng tên vault cũng là "ngoài".
    await put('v2/x.md', 'x')
    await expect(readNote(vault, '../v2/x.md')).rejects.toThrow('ngoài vault')
  })
})

describe('tên', () => {
  it('vaultDirName / defaultProjectName', () => {
    expect(vaultDirName('stag.ai')).toBe('stag.ai memory')
    expect(defaultProjectName(join(root, 'Dự án X'))).toBe('Dự án X')
  })
})
