import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InstalledAdapter } from '@shared/types'
import { cmdQuote, ExternalAdapterStore, externalArgs, NPM_NAME_RE, NPM_VERSION_RE, parseManifest, resolveCommand, spawnSpec } from './externalAdapters'

const pkg = (stagAdapter: unknown, extra: Record<string, unknown> = {}): unknown => ({ name: 'stag-adapter-x', version: '1.2.3', stagAdapter, ...extra })

describe('parseManifest', () => {
  it('đủ trường tối thiểu, điền mặc định', () => {
    const { manifest, version } = parseManifest(pkg({ id: 'aider', label: 'Aider', command: 'aider' }, { description: 'Pair programming' }))
    expect(version).toBe('1.2.3')
    expect(manifest).toEqual({
      id: 'aider',
      label: 'Aider',
      description: 'Pair programming',
      command: 'aider',
      args: [],
      versionArgs: ['--version'],
      install: '',
      homepage: '',
      models: [],
      modelFlag: '',
      rules: null,
      prompt: null,
      mcpConfigFlag: ''
    })
  })

  it('đọc model (chuỗi hoặc {id,label}), rules, prompt, cờ', () => {
    const { manifest } = parseManifest(
      pkg({
        id: 'x-cli',
        label: 'X',
        command: '{pkg}/bin/x.exe',
        models: ['m-1', { id: 'm-2', label: 'Model 2' }],
        modelFlag: '--model',
        rules: { flag: '--read' },
        prompt: { positional: true },
        mcpConfigFlag: '--mcp-config',
        homepage: 'javascript:alert(1)'
      })
    )
    expect(manifest.models).toEqual([
      { id: 'm-1', label: 'm-1' },
      { id: 'm-2', label: 'Model 2' }
    ])
    expect(manifest.rules).toEqual({ flag: '--read' })
    expect(manifest.prompt).toEqual({ positional: true })
    expect(manifest.homepage).toBe('')
  })

  it('báo lỗi rõ ràng khi khai báo sai', () => {
    expect(() => parseManifest({ name: 'x' })).toThrow(/thiếu mục "stagAdapter"/)
    expect(() => parseManifest(pkg({ label: 'X', command: 'x' }))).toThrow(/stagAdapter.id/)
    expect(() => parseManifest(pkg({ id: 'claude', label: 'X', command: 'x' }))).toThrow(/trùng adapter có sẵn/)
    expect(() => parseManifest(pkg({ id: 'Bad Id', label: 'X', command: 'x' }))).toThrow(/stagAdapter.id/)
    expect(() => parseManifest(pkg({ id: 'ok', label: 'X', command: 'x', modelFlag: '--m; rm' }))).toThrow(/modelFlag/)
    expect(() => parseManifest(pkg({ id: 'ok', label: 'X', command: 'x', rules: { env: 'STAG_TOKEN' } }))).toThrow(/rules/)
    expect(() => parseManifest(pkg({ id: 'ok', label: 'X', command: 'x', args: 'a b' }))).toThrow(/args/)
  })
})

describe('tên / phiên bản npm', () => {
  it('chặn ký tự cmd.exe hiểu thành lệnh', () => {
    expect(NPM_NAME_RE.test('@scope/stag-adapter-aider')).toBe(true)
    expect(NPM_NAME_RE.test('a&calc')).toBe(false)
    expect(NPM_VERSION_RE.test('1.2.0')).toBe(true)
    expect(NPM_VERSION_RE.test('~1.2')).toBe(true)
    expect(NPM_VERSION_RE.test('>=1')).toBe(false)
    expect(NPM_VERSION_RE.test('1 & calc')).toBe(false)
  })
})

const entry = (manifest: Partial<InstalledAdapter['manifest']>, rest: Partial<InstalledAdapter> = {}): InstalledAdapter => ({
  manifest: {
    id: 'x',
    label: 'X',
    description: '',
    command: 'x',
    args: [],
    versionArgs: ['--version'],
    install: '',
    homepage: '',
    models: [],
    modelFlag: '',
    rules: null,
    prompt: null,
    mcpConfigFlag: '',
    ...manifest
  },
  source: { type: 'local', path: 'D:/a' },
  dir: 'D:/a',
  version: '1.0.0',
  installedAt: '',
  enabled: true,
  model: '',
  extraArgs: '',
  env: '',
  ...rest
})

describe('externalArgs', () => {
  const o = { rulesFile: 'C:/p/.sessions/s.rules.md', prompt: 'Start a new session.', mcpFile: 'C:/u/mcp.json' }

  it('thứ tự: args gói, model, luật phiên, MCP, tham số thêm, lời mở cuối', () => {
    const a = entry(
      { args: ['{pkg}/cli.js', '--no-git'], modelFlag: '--model', rules: { flag: '--read' }, mcpConfigFlag: '--mcp-config', prompt: { flag: '--message' } },
      { model: 'sonnet', extraArgs: '--dark "x y"' }
    )
    expect(externalArgs(a, o).args).toEqual([
      'D:/a/cli.js',
      '--no-git',
      '--model',
      'sonnet',
      '--read',
      o.rulesFile,
      '--mcp-config',
      o.mcpFile,
      '--dark',
      'x y',
      '--message',
      'Start a new session.'
    ])
  })

  it('luật phiên qua biến môi trường, lời mở là tham số cuối, không có model nếu gói không nhận', () => {
    const a = entry({ rules: { env: 'X_RULES' }, prompt: { positional: true } }, { model: 'ignored', env: 'A=1\nSTAG_TOKEN=no' })
    const r = externalArgs(a, o)
    expect(r.args).toEqual(['Start a new session.'])
    expect(r.env).toEqual({ A: '1', X_RULES: o.rulesFile })
  })
})

describe('chạy file .cmd', () => {
  it('cmdQuote: nháy khi cần, nhân đôi nháy bên trong', () => {
    expect(cmdQuote('--flag')).toBe('--flag')
    expect(cmdQuote('a b')).toBe('"a b"')
    expect(cmdQuote('say "hi"')).toBe('"say ""hi"""')
    expect(cmdQuote('a&b')).toBe('"a&b"')
  })

  it('spawnSpec: .exe chạy thẳng; .cmd qua cmd.exe với dòng lệnh thô', () => {
    expect(spawnSpec('C:/x/aider.exe', ['--a'])).toEqual({ command: 'C:/x/aider.exe', args: ['--a'] })
    expect(spawnSpec('C:/Program Files/x/aider.cmd', ['--read', 'C:/p q/r.md'], { ComSpec: 'C:/W/cmd.exe' })).toEqual({
      command: 'C:/W/cmd.exe',
      args: '/d /s /c ""C:/Program Files/x/aider.cmd" --read "C:/p q/r.md""'
    })
  })

  it('spawnSpec: tham số nhiều dòng với shim npm → chạy thẳng node + script (cmd.exe cắt ở xuống dòng)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag-shim-'))
    const shim = join(dir, 'claude.cmd')
    await fs.writeFile(
      shim,
      '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n'
    )
    expect(spawnSpec(shim, ['--append-system-prompt', 'a\nb'])).toEqual({
      command: 'node',
      args: [join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'), '--append-system-prompt', 'a\nb']
    })
    // Một dòng: vẫn qua cmd.exe như cũ.
    expect((spawnSpec(shim, ['-p'], { ComSpec: 'cmd.exe' }) as { command: string }).command).toBe('cmd.exe')
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('ExternalAdapterStore (thư mục cục bộ)', () => {
  let root: string
  let pkgDir: string
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'stag-ext-'))
    pkgDir = join(root, 'my-adapter')
    await fs.mkdir(join(pkgDir, 'bin'), { recursive: true })
    await fs.writeFile(join(pkgDir, 'bin', 'fake.exe'), '')
    await fs.writeFile(join(pkgDir, 'package.json'), JSON.stringify(pkg({ id: 'fake', label: 'Fake', command: '{pkg}/bin/fake.exe', modelFlag: '--model' })))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('cài, sửa, cài lại giữ cài đặt, gỡ (không xoá thư mục của người dùng)', async () => {
    let changes = 0
    const store = new ExternalAdapterStore(join(root, 'adapters'), () => changes++)
    const a = await store.install({ type: 'local', path: pkgDir })
    expect(a.manifest.id).toBe('fake')
    expect(await store.exe(a)).toBe(join(pkgDir, 'bin', 'fake.exe'))
    await store.update('fake', { enabled: false, model: 'm-1', extraArgs: '--x\n--y', env: 'A=1' })
    const again = await store.install({ type: 'local', path: pkgDir })
    expect(again).toMatchObject({ enabled: false, model: 'm-1', extraArgs: '--x --y', env: 'A=1' })

    const reloaded = new ExternalAdapterStore(join(root, 'adapters'))
    await reloaded.load()
    expect(reloaded.list().map((x) => x.manifest.id)).toEqual(['fake'])

    await store.remove('fake')
    expect(store.list()).toEqual([])
    expect(await fs.stat(pkgDir).then(() => true)).toBe(true)
    expect(changes).toBe(4)
  })

  it('trùng id từ nguồn khác → báo gỡ trước; thiếu stagAdapter → báo lỗi', async () => {
    const store = new ExternalAdapterStore(join(root, 'adapters'))
    await store.install({ type: 'local', path: pkgDir })
    const other = join(root, 'other')
    await fs.mkdir(other)
    await fs.writeFile(join(other, 'package.json'), JSON.stringify(pkg({ id: 'fake', label: 'Fake 2', command: 'x' })))
    await expect(store.install({ type: 'local', path: other })).rejects.toThrow(/Gỡ nó trước/)
    await fs.writeFile(join(other, 'package.json'), JSON.stringify({ name: 'plain' }))
    await expect(store.install({ type: 'local', path: other })).rejects.toThrow(/stagAdapter/)
    await expect(store.install({ type: 'local', path: join(root, 'nope') })).rejects.toThrow(/Không thấy thư mục/)
  })

  it('resolveCommand: đường dẫn phải tồn tại; tên trần tìm trong PATH', async () => {
    expect(await resolveCommand('{pkg}/bin/fake.exe', pkgDir)).toBe(join(pkgDir, 'bin', 'fake.exe'))
    expect(await resolveCommand('{pkg}/bin/none.exe', pkgDir)).toBeNull()
    expect(await resolveCommand('fake', pkgDir, { PATH: join(pkgDir, 'bin') })).toBe(join(pkgDir, 'bin', 'fake.exe'))
    expect(await resolveCommand('fake', pkgDir, { PATH: root })).toBeNull()
  })
})
