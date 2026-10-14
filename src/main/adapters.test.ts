import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeLogin, codexConfigModel, codexLogin, codexModels, independentSessionEnv, modelArgs, runCli } from './adapters'
import { codexArgs } from './codex'

describe('modelArgs', () => {
  it('trống → không thêm cờ', () => {
    expect(modelArgs('claude', { model: '', effort: '' })).toEqual([])
    expect(modelArgs('codex', { model: '', effort: '' })).toEqual([])
  })

  it('Claude: --model / --effort; Codex: -m / model_reasoning_effort (chuỗi TOML)', () => {
    expect(modelArgs('claude', { model: 'opus', effort: 'high' })).toEqual(['--model', 'opus', '--effort', 'high'])
    expect(modelArgs('codex', { model: 'gpt-5.6-terra', effort: 'xhigh' })).toEqual(['-m', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="xhigh"'])
  })
})

describe('codexArgs + tham số người dùng', () => {
  const base = { rules: 'r', mcpUrl: 'http://x/mcp', hookUrl: 'http://x/hook', permissionMode: 'default' as const }

  it('đứng trước lời mở (lời mở phải là tham số cuối)', () => {
    const args = codexArgs({ ...base, prompt: 'Start', userArgs: ['-m', 'gpt-5.6-terra'] })
    expect(args.slice(-3)).toEqual(['-m', 'gpt-5.6-terra', 'Start'])
  })

  it('resume: vẫn có tham số người dùng, không có lời mở', () => {
    const args = codexArgs({ ...base, resumeId: 'abc', prompt: 'Start', userArgs: ['--foo'] })
    expect(args.slice(0, 2)).toEqual(['resume', 'abc'])
    expect(args.at(-1)).toBe('--foo')
  })
})

describe('trạng thái đăng nhập', () => {
  it('claude auth status --json', () => {
    expect(claudeLogin('{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"a@b.c"}')).toEqual({
      state: 'in',
      detail: 'claude.ai · gói max · a@b.c'
    })
    expect(claudeLogin('{"loggedIn":false}')).toEqual({ state: 'out', detail: 'Chưa đăng nhập' })
    expect(claudeLogin('error: unknown command').state).toBe('unknown')
  })

  it('codex login status', () => {
    expect(codexLogin('Logged in using ChatGPT\n')).toEqual({ state: 'in', detail: 'ChatGPT' })
    expect(codexLogin('Logged in using an API key - sk-***\n')).toEqual({ state: 'in', detail: 'an API key - sk-***' })
    expect(codexLogin('\nNot logged in\n')).toEqual({ state: 'out', detail: 'Chưa đăng nhập' })
    expect(codexLogin('boom').state).toBe('unknown')
  })
})

describe('cấu hình Codex của người dùng', () => {
  it('model ở đầu config.toml, bỏ qua model trong bảng con', () => {
    expect(codexConfigModel('model = "gpt-5.6-terra"\n[profiles.x]\nmodel = "o3"')).toBe('gpt-5.6-terra')
    expect(codexConfigModel('[windows]\nsandbox = "x"\n[profiles.x]\nmodel = "o3"')).toBeNull()
    expect(codexConfigModel('')).toBeNull()
  })

  it('models_cache.json: chỉ model hiện trong danh sách, kèm mức suy nghĩ', () => {
    const json = JSON.stringify({
      models: [
        { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }] },
        { slug: 'gpt-reserve', display_name: 'Reserve', visibility: 'hide', supported_reasoning_levels: [] },
        { slug: 'x-mini', display_name: 'X Mini', visibility: 'list' }
      ]
    })
    expect(codexModels(json)).toEqual([
      { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'max'] },
      { id: 'x-mini', label: 'X Mini (x-mini)', efforts: [] }
    ])
    expect(codexModels('not json')).toEqual([])
  })
})

describe('independentSessionEnv', () => {
  it('bỏ dấu phiên con, giữ cấu hình người dùng', () => {
    const env = independentSessionEnv({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_CODE_USE_BEDROCK: '1', PATH: 'p' })
    expect(env).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1', PATH: 'p' })
  })
})

describe('runCli (nút Kiểm tra)', () => {
  it.runIf(process.platform === 'win32')('đường dẫn .cmd chạy được qua cmd.exe (không còn spawn EINVAL)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag cli '))
    const cmd = join(dir, 'fake cli.cmd')
    await fs.writeFile(cmd, '@echo fake 1.2.3 %*\r\n')
    const r = await runCli(cmd, ['--version'], process.env)
    expect(r.ok).toBe(true)
    expect(r.out.trim()).toBe('fake 1.2.3 "--version"')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
