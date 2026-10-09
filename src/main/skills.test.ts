import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeSkillSettings,
  codexSkillArgs,
  codexSkillConfigEntries,
  codexSkillsFromList,
  findSkillDirs,
  scanClaudeSkills,
  skillInstructions,
  SkillLibrary
} from './skills'

let tmp: string
let lib: SkillLibrary

const write = async (p: string, text: string): Promise<void> => {
  await fs.mkdir(join(p, '..'), { recursive: true })
  await fs.writeFile(p, text, 'utf8')
}
const md = (name: string, desc = `Skill ${name}.`): string => `---\nname: ${name}\ndescription: ${desc}\n---\n\nBody of ${name}.\n`

beforeEach(async () => {
  tmp = await fs.mkdtemp(join(tmpdir(), 'stag-skills-'))
  lib = new SkillLibrary(join(tmp, 'skills'), resolve('resources/skill-catalog'), join(tmp, 'sessions'))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('thư viện skill', () => {
  it('tạo, đọc, sửa (đổi tên theo frontmatter), gỡ', async () => {
    await lib.create('my-skill', 'Does a thing')
    expect(await lib.list()).toMatchObject([{ name: 'my-skill', description: 'Does a thing', files: 1, source: { kind: 'created' } }])
    await expect(lib.create('my-skill', 'again')).rejects.toThrow(/Đã có/)
    await expect(lib.create('Bad', 'x')).rejects.toThrow(/a-z/)
    await expect(lib.create('nodesc', ' ')).rejects.toThrow(/description/)

    const doc = await lib.read('my-skill')
    expect(doc.md).toContain('name: my-skill')
    expect(doc.editable).toBe(true)

    // Lỗi trong nội dung vẫn lưu, chỉ báo lại; skill lỗi không "dùng được".
    expect(await lib.save('my-skill', '---\nname: my-skill\n---\nno desc')).toEqual({ name: 'my-skill', problem: expect.stringMatching(/description/) })
    expect(await lib.usable()).toEqual([])
    expect((await lib.list())[0].problem).toMatch(/description/)

    const r = await lib.save('my-skill', md('renamed'))
    expect(r).toEqual({ name: 'renamed', problem: null })
    expect((await lib.list()).map((s) => [s.name, s.source.kind])).toEqual([['renamed', 'created']])
    await lib.create('other', 'x')
    await expect(lib.save('renamed', md('other'))).rejects.toThrow(/Đã có skill "other"/)

    await lib.remove('renamed')
    expect((await lib.list()).map((s) => s.name)).toEqual(['other'])
  })

  it('nhập thư mục: một skill, nhiều skill, tên trùng, tên lấy từ thư mục khi frontmatter sai', async () => {
    const src = join(tmp, 'src')
    await write(join(src, 'one', 'SKILL.md'), md('one'))
    await write(join(src, 'one', 'scripts', 'run.py'), 'print(1)')
    await write(join(src, 'one', 'node_modules', 'x.js'), 'skip')
    await write(join(src, 'nested', 'deep', 'two', 'SKILL.md'), md('two'))
    await write(join(src, 'fix-me', 'SKILL.md'), md('Bad Name'))
    await write(join(src, 'Bad Folder', 'SKILL.md'), md('Also Bad'))
    expect((await findSkillDirs(src)).length).toBe(4)

    const r = await lib.importDir(src, { kind: 'folder', from: src })
    expect(r.added.sort()).toEqual(['fix-me', 'one', 'two'])
    expect(r.skipped).toEqual([{ name: 'Also Bad', reason: expect.stringMatching(/không hợp lệ/) }])
    expect((await lib.read('one')).files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.py'])
    expect((await lib.read('fix-me')).md).toContain('name: fix-me')
    expect((await lib.list()).find((s) => s.name === 'one')?.source).toMatchObject({ kind: 'folder', from: src })

    const again = await lib.importDir(join(src, 'one'), { kind: 'folder' })
    expect(again).toEqual({ added: [], skipped: [{ name: 'one', reason: 'đã có trong thư viện' }] })
    await expect(lib.importDir(join(tmp, 'empty-nothing'), { kind: 'folder' })).rejects.toThrow(/Không thấy SKILL.md/)
  })

  it('nhập zip; chặn đường dẫn ra ngoài', async () => {
    const z = new JSZip()
    z.file('pack/alpha/SKILL.md', md('alpha'))
    z.file('pack/alpha/ref.md', 'ref')
    const ok = join(tmp, 'ok.zip')
    await fs.writeFile(ok, await z.generateAsync({ type: 'nodebuffer' }))
    expect((await lib.importZip(ok)).added).toEqual(['alpha'])
    expect((await lib.read('alpha')).files.length).toBe(2)

    const bad = new JSZip()
    bad.file('../evil/SKILL.md', md('evil'))
    const badFile = join(tmp, 'bad.zip')
    await fs.writeFile(badFile, await bad.generateAsync({ type: 'nodebuffer' }))
    await expect(lib.importZip(badFile)).rejects.toThrow(/không an toàn/)
    expect(await fs.readdir(join(tmp, 'skills'))).not.toContain('evil')
    // Thư mục giải nén tạm đã dọn.
    expect((await fs.readdir(join(tmp, 'skills'))).filter((n) => n.startsWith('.import-'))).toEqual([])
  })

  it('cài từ danh mục kèm app', async () => {
    const cat = await lib.catalog()
    expect(cat.map((e) => e.slug)).toContain('wireframe')
    expect((await lib.catalogDoc('wireframe')).files.length).toBeGreaterThan(3)
    expect(await lib.installCatalog('wireframe')).toEqual({ added: ['wireframe'], skipped: [] })
    expect((await lib.list())[0]).toMatchObject({ name: 'wireframe', source: { kind: 'catalog', from: 'wireframe' } })
    await expect(lib.installCatalog('nope')).rejects.toThrow(/Không có skill/)
  })

  it('chuẩn bị skill cho phiên: chép vào .claude/skills của thư mục phiên, bỏ skill lỗi; dọn khi xong', async () => {
    await lib.create('good', 'Good one')
    await lib.create('broken', 'x')
    await lib.save('broken', 'no frontmatter')
    const r = await lib.prepareSession('sess-1', ['good', 'broken'])
    expect(r.dir).toBe(join(tmp, 'sessions', 'sess-1'))
    expect(r.skills).toEqual([{ name: 'good', description: 'Good one', path: join(tmp, 'sessions', 'sess-1', '.claude', 'skills', 'good', 'SKILL.md') }])
    expect(await fs.readFile(r.skills[0].path, 'utf8')).toContain('name: good')
    expect(await lib.prepareSession('sess-2', [])).toEqual({ dir: null, skills: [] })
    await lib.cleanSession('sess-1')
    await expect(fs.stat(r.dir!)).rejects.toThrow()
    await expect(lib.prepareSession('../x', ['good'])).rejects.toThrow(/không hợp lệ/)
  })
})

describe('skill có sẵn của Claude Code', () => {
  it('user, claude.ai, project, plugin đã bật', async () => {
    const home = join(tmp, 'home')
    const cwd = join(tmp, 'proj')
    await write(join(home, '.claude', 'skills', 'seo', 'SKILL.md'), md('seo'))
    await write(join(home, '.claude', 'skills', 'synced', 'acct1', 'pdf', 'SKILL.md'), md('pdf'))
    await write(join(cwd, '.claude', 'skills', 'proj-skill', 'SKILL.md'), md('proj-skill'))
    const plug = join(home, '.claude', 'plugins', 'cache', 'm', 'shop', '1.0')
    await write(join(plug, 'skills', 'shop-admin', 'SKILL.md'), md('shop-admin'))
    const off = join(home, '.claude', 'plugins', 'cache', 'm', 'off', '1.0')
    await write(join(off, 'skills', 'nope', 'SKILL.md'), md('nope'))
    await write(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'shop@m': [{ installPath: plug }], 'off@m': [{ installPath: off }] } })
    )
    await write(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'shop@m': true, 'off@m': false } }))

    const list = await scanClaudeSkills(cwd, home)
    expect(list.map((s) => [s.name, s.scope, s.toggleKey])).toEqual([
      ['seo', 'user', 'claude:seo'],
      ['pdf', 'claude.ai', 'claude:pdf'],
      ['proj-skill', 'project', 'claude:proj-skill'],
      ['shop:shop-admin', 'plugin', 'claude-plugin:shop@m']
    ])
    expect(list[0].path).toBe(join(home, '.claude', 'skills', 'seo', 'SKILL.md'))
  })

  it('file --settings: skillOverrides + enabledPlugins chỉ khi có tắt', () => {
    expect(claudeSkillSettings({ library: [], denied: { claude: [], codex: ['x'] }, plugins: [] })).toEqual({})
    expect(claudeSkillSettings({ library: [], denied: { claude: ['seo'], codex: [] }, plugins: ['shop@m'] })).toEqual({
      skillOverrides: { seo: 'off' },
      enabledPlugins: { 'shop@m': false }
    })
  })
})

describe('Codex', () => {
  it('đọc kết quả skills/list', () => {
    const list = codexSkillsFromList({
      data: [
        {
          cwd: 'C:/p',
          errors: [],
          skills: [
            { name: 'imagegen', description: 'Make images', scope: 'system', path: 'C:/x/imagegen/SKILL.md', enabled: true },
            { name: 'proj', description: '', shortDescription: 'Short', scope: 'repo', path: 'C:/p/.agents/skills/proj/SKILL.md', enabled: false },
            { name: 'imagegen', scope: 'user' }
          ]
        }
      ]
    })
    expect(list).toEqual([
      { runtime: 'codex', name: 'proj', description: 'Short', scope: 'repo', path: 'C:/p/.agents/skills/proj/SKILL.md', toggleKey: 'codex:proj', disabledInCli: true },
      { runtime: 'codex', name: 'imagegen', description: 'Make images', scope: 'system', path: 'C:/x/imagegen/SKILL.md', toggleKey: 'codex:imagegen' }
    ])
  })

  it('giữ mục [[skills.config]] của người dùng khi tắt skill', async () => {
    const toml = [
      'model = "x"',
      '[[skills.config]]',
      'path = "C:/a/SKILL.md"',
      'enabled = false',
      '',
      '[[skills.config]] # comment',
      "name = 'keep-me'",
      'enabled = true',
      '[[skills.config]]',
      'name = "seo"',
      'enabled = true',
      '[mcp_servers.x]',
      'command = "y"'
    ].join('\n')
    expect(codexSkillConfigEntries(toml)).toEqual([
      { path: 'C:/a/SKILL.md', enabled: false },
      { name: 'keep-me', enabled: true },
      { name: 'seo', enabled: true }
    ])
    const home = join(tmp, 'codex-home')
    await write(join(home, 'config.toml'), toml)
    const prev = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    try {
      expect(await codexSkillArgs([], tmp)).toEqual([])
      expect(await codexSkillArgs(['seo', 'imagegen'], tmp)).toEqual([
        '-c',
        'skills.config=[{path="C:/a/SKILL.md",enabled=false},{name="keep-me",enabled=true},{name="seo",enabled=false},{name="imagegen",enabled=false}]'
      ])
    } finally {
      if (prev === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = prev
    }
  })

  it('mục skill trong luật phiên', () => {
    expect(skillInstructions([])).toBe('')
    const t = skillInstructions([{ name: 'a', description: 'Does A', path: 'C:\\s\\a\\SKILL.md' }])
    expect(t).toContain('## Skills from stag.ai')
    expect(t).toContain('- **a**: Does A (file: C:/s/a/SKILL.md)')
  })
})
