import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyVaultTemplate, fill, prepareUserTemplates, readTemplate, userTemplatesDir, type TemplateVars } from './templates'

// `app` của Electron trỏ vào thư mục tạm: template gốc ở <appPath>/resources/templates,
// template người dùng ở <userData>/templates.
const paths = vi.hoisted(() => ({ appPath: '', userData: '' }))
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => paths.appPath,
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`test chưa mock app.getPath('${name}')`)
      return paths.userData
    }
  }
}))

let root: string
let bundled: string
let own: string
let dest: string

const vars: TemplateVars = {
  PROJECT: 'Demo',
  DATE: '2026-01-02',
  VAULT_DIR: 'Demo memory',
  VAULT_PATH: 'C:\\x\\Demo\\Demo memory',
  PROJECT_PATH: 'C:\\x\\Demo',
  AUTO_MEMORY_PATH: 'C:\\home\\.claude\\projects\\C--x-Demo\\memory'
}

async function put(base: string, rel: string, content: string): Promise<void> {
  const file = join(base, rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, content, 'utf8')
}

const read = (rel: string): Promise<string> => fs.readFile(join(dest, rel), 'utf8')
const slash = (list: string[]): string[] => list.map((p) => p.replace(/\\/g, '/'))

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-templates-'))
  paths.appPath = join(root, 'app')
  paths.userData = join(root, 'userData')
  bundled = join(paths.appPath, 'resources', 'templates')
  own = join(paths.userData, 'templates')
  dest = join(root, 'dest')

  await put(bundled, 'vault/_INDEX.md', '---\ntype: index\n---\n# {{PROJECT}} — {{VAULT_DIR}}\n')
  await put(bundled, 'vault/10 {{PROJECT}}/{{PROJECT}}.md', 'Dự án {{PROJECT}} ở {{PROJECT_PATH}}\n')
  await put(bundled, 'vault/30 Features/.keep', '')
  await put(bundled, 'vault/40 Log/{{DATE}}.md', '# {{DATE}}\n')
  await put(bundled, 'vault/40 Log/_Template.md', 'mẫu {{UNKNOWN}}\n')
  await put(bundled, 'CLAUDE.md', 'gốc {{PROJECT}}\n')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('fill', () => {
  it('thay mọi chỗ của biến đã biết', () => {
    expect(fill('{{PROJECT}} / {{PROJECT}} @ {{DATE}}', vars)).toBe('Demo / Demo @ 2026-01-02')
  })

  it('giữ nguyên biến không biết và chữ thường', () => {
    expect(fill('{{NOPE}} {{project}} { {PROJECT} }', vars)).toBe('{{NOPE}} {{project}} { {PROJECT} }')
  })

  it('giá trị có dấu \\ và $ được chèn nguyên văn', () => {
    expect(fill('`{{VAULT_PATH}}`', { VAULT_PATH: 'C:\\a\\$1\\b' })).toBe('`C:\\a\\$1\\b`')
  })
})

describe('copyVaultTemplate', () => {
  it('chép cây, thay biến trong tên và nội dung, bỏ .keep nhưng giữ thư mục', async () => {
    const created = await copyVaultTemplate(dest, vars)

    expect(await read('_INDEX.md')).toBe('---\ntype: index\n---\n# Demo — Demo memory\n')
    expect(await read('10 Demo/Demo.md')).toBe('Dự án Demo ở C:\\x\\Demo\n')
    expect(await read('40 Log/2026-01-02.md')).toBe('# 2026-01-02\n')
    expect(await read('40 Log/_Template.md')).toBe('mẫu {{UNKNOWN}}\n')
    expect((await fs.stat(join(dest, '30 Features'))).isDirectory()).toBe(true)
    expect(await fs.readdir(join(dest, '30 Features'))).toEqual([])

    expect(slash(created).sort()).toEqual(
      [
        '10 Demo/',
        '10 Demo/Demo.md',
        '30 Features/',
        '40 Log/',
        '40 Log/2026-01-02.md',
        '40 Log/_Template.md',
        '_INDEX.md'
      ].sort()
    )
  })

  it('skipDated bỏ file có {{DATE}} trong tên', async () => {
    const created = await copyVaultTemplate(dest, vars, true)
    expect(await fs.readdir(join(dest, '40 Log'))).toEqual(['_Template.md'])
    expect(slash(created)).not.toContain('40 Log/2026-01-02.md')
  })

  it('không ghi đè file có sẵn, chỉ báo file mới tạo', async () => {
    await put(dest, '_INDEX.md', 'của người dùng\n')
    await put(dest, '40 Log/_Template.md', 'mẫu riêng\n')

    const created = await copyVaultTemplate(dest, vars, true)

    expect(await read('_INDEX.md')).toBe('của người dùng\n')
    expect(await read('40 Log/_Template.md')).toBe('mẫu riêng\n')
    expect(slash(created)).not.toContain('_INDEX.md')
    expect(slash(created)).not.toContain('40 Log/')
    expect(slash(created)).toContain('10 Demo/Demo.md')
  })

  it('chạy lần hai không tạo thêm gì', async () => {
    await copyVaultTemplate(dest, vars)
    expect(await copyVaultTemplate(dest, vars)).toEqual([])
  })

  it('template người dùng đè lên template gốc theo từng file', async () => {
    await put(own, 'vault/_INDEX.md', '---\ntype: index\n---\n# Bản của tôi: {{PROJECT}}\n')
    await put(own, 'vault/99 Riêng/ghi chú.md', 'thêm {{DATE}}\n')

    await copyVaultTemplate(dest, vars)

    expect(await read('_INDEX.md')).toBe('---\ntype: index\n---\n# Bản của tôi: Demo\n')
    expect(await read('99 Riêng/ghi chú.md')).toBe('thêm 2026-01-02\n')
    // File người dùng chưa chỉnh vẫn lấy từ bản gốc.
    expect(await read('10 Demo/Demo.md')).toBe('Dự án Demo ở C:\\x\\Demo\n')
  })
})

describe('template người dùng', () => {
  it('readTemplate dùng bản người dùng nếu có, không thì bản gốc', async () => {
    expect(await readTemplate('CLAUDE.md', vars)).toBe('gốc Demo\n')
    await put(own, 'CLAUDE.md', 'riêng {{PROJECT}}\n')
    expect(await readTemplate('CLAUDE.md', vars)).toBe('riêng Demo\n')
  })

  it('prepareUserTemplates chép nguyên văn (giữ biến, giữ .keep) và không ghi đè bản đã chỉnh', async () => {
    await put(own, 'CLAUDE.md', 'đã chỉnh\n')

    expect(await prepareUserTemplates()).toBe(userTemplatesDir())

    expect(await fs.readFile(join(own, 'CLAUDE.md'), 'utf8')).toBe('đã chỉnh\n')
    expect(await fs.readFile(join(own, 'vault', '10 {{PROJECT}}', '{{PROJECT}}.md'), 'utf8')).toBe(
      'Dự án {{PROJECT}} ở {{PROJECT_PATH}}\n'
    )
    expect(await fs.readdir(join(own, 'vault', '30 Features'))).toEqual(['.keep'])
  })
})
