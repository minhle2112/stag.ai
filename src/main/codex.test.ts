import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CODEX_HOOK_EVENTS,
  codexAppServerUserArgs,
  codexArgs,
  codexConfigArgs,
  codexHookTrustArgs,
  codexHookCommand,
  codexPermissionArgs,
  codexThreadPermission,
  findCodexRollout,
  isCodexSessionVar,
  parseCodexContext,
  tomlString
} from './codex'

const base = { rules: 'R', hookUrl: 'http://127.0.0.1:9/hook', mcpUrl: 'http://127.0.0.1:9/mcp', permissionMode: 'default' as const }
/** Giá trị các cặp `-c key=value`. */
const configs = (args: string[]): string[] => args.flatMap((a, i) => (args[i - 1] === '-c' ? [a] : []))

describe('codexArgs', () => {
  it('phiên mới: lời mở ở cuối, luật phiên + MCP + hook qua -c', () => {
    const args = codexArgs({ ...base, prompt: 'Start a new session.' })
    expect(args[0]).toBe('--no-daemon')
    expect(args.at(-1)).toBe('Start a new session.')
    expect(args).toContain('--dangerously-bypass-hook-trust')
    const c = configs(args)
    expect(c).toContain('developer_instructions="R"')
    expect(c).toContain('project_doc_fallback_filenames=["CLAUDE.md"]')
    expect(c).toContain('mcp_servers.stag.url="http://127.0.0.1:9/mcp"')
    expect(c).toContain('mcp_servers.stag.default_tools_approval_mode="approve"')
    expect(c.filter((x) => x.startsWith('hooks.'))).toHaveLength(CODEX_HOOK_EVENTS.length)
  })

  it('tiếp tục phiên: `resume <id>` đứng đầu, không có lời mở', () => {
    const args = codexArgs({ ...base, resumeId: 'th-1', prompt: 'Start a new session.' })
    expect(args.slice(0, 2)).toEqual(['resume', 'th-1'])
    expect(args).not.toContain('Start a new session.')
  })

  it('luật phiên nhiều dòng, có dấu nháy / dấu \\ → chuỗi TOML hợp lệ', () => {
    const rules = 'a "b"\nc:\\d\ttiếng Việt'
    const c = configs(codexArgs({ ...base, rules }))
    expect(c).toContain(`developer_instructions=${tomlString(rules)}`)
    expect(JSON.parse(tomlString(rules))).toBe(rules)
  })

  it('hook: lệnh curl gửi stdin, token lấy từ biến môi trường của phiên', () => {
    const cmd = codexHookCommand('http://127.0.0.1:9/hook')
    // Chạy được trên mọi shell: không có %VAR% (cmd) hay $env: (PowerShell), `@-` trong nháy.
    expect(cmd).not.toMatch(/%\w+%|\$env:/)
    expect(cmd).toContain('--variable %STAG_TOKEN')
    expect(cmd).toContain('"Authorization: Bearer {{STAG_TOKEN}}"')
    expect(cmd).toContain('--data-binary "@-"')
    expect(cmd).toContain('-o NUL')
    const hook = configs(codexArgs(base)).find((x) => x.startsWith('hooks.Stop='))!
    expect(hook).toBe(`hooks.Stop=[{hooks=[{type="command",command=${tomlString(cmd)},timeout=10}]}]`)
  })

  it('PreToolUse: in câu trả lời của app ra stdout (khoá phạm vi), chờ lâu được', () => {
    const cmd = codexHookCommand('http://127.0.0.1:9/hook', true)
    expect(cmd).not.toContain('-o NUL')
    expect(cmd).toContain('-m 300')
    const hook = configs(codexArgs(base)).find((x) => x.startsWith('hooks.PreToolUse='))!
    expect(hook).toBe(`hooks.PreToolUse=[{hooks=[{type="command",command=${tomlString(cmd)},timeout=310}]}]`)
  })

  it('mức quyền', () => {
    expect(codexPermissionArgs('default')).toEqual([])
    expect(codexPermissionArgs('plan')).toEqual(['-s', 'read-only', '-a', 'on-request'])
    expect(codexArgs({ ...base, permissionMode: 'auto' })).toContain('--approve-for-me')
  })
})

describe('parseCodexContext', () => {
  // Theo protocol.rs của openai/codex (dòng event_msg / token_count trong rollout).
  const line = (info: unknown): string =>
    JSON.stringify({ timestamp: '2026-10-09T01:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info, rate_limits: null } })

  it('dùng last_token_usage.total_tokens trên model_context_window', () => {
    const info = {
      total_token_usage: { input_tokens: 90000, total_tokens: 99000 },
      last_token_usage: { input_tokens: 30000, cached_input_tokens: 20000, output_tokens: 500, total_tokens: 30500 },
      model_context_window: 258400
    }
    expect(parseCodexContext(line(info))).toEqual({ used: 30500, size: 258400, model: null, at: '2026-10-09T01:00:00.000Z' })
  })

  it('info null / dòng khác / không phải JSON → null', () => {
    expect(parseCodexContext(line(null))).toBeNull()
    expect(parseCodexContext(JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'token_count' } }))).toBeNull()
    expect(parseCodexContext('{"token_count"')).toBeNull()
  })
})

describe('findCodexRollout', () => {
  let home: string
  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'stag-codex-'))
  })
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true })
  })

  it('tìm theo thread id trong thư mục ngày (cả hôm trước), chưa có thì null', async () => {
    const now = new Date(2026, 9, 9, 0, 30)
    expect(await findCodexRollout('abc', now, home)).toBeNull()
    const dir = join(home, 'sessions', '2026', '10', '08')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'rollout-2026-10-08T23-59-00-zzz.jsonl'), '')
    await fs.writeFile(join(dir, 'rollout-2026-10-08T23-59-01-abc.jsonl'), '')
    expect(await findCodexRollout('abc', now, home)).toBe(join(dir, 'rollout-2026-10-08T23-59-01-abc.jsonl'))
  })

  it('thread cũ hơn khoảng ngày: quét sâu mới thấy (tắt deep thì không)', async () => {
    const now = new Date(2026, 9, 9, 12, 0)
    const dir = join(home, 'sessions', '2025', '12', '31')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'rollout-2025-12-31T10-00-00-old.jsonl'), '')
    expect(await findCodexRollout('old', now, home, 3, false)).toBeNull()
    expect(await findCodexRollout('old', now, home)).toBe(join(dir, 'rollout-2025-12-31T10-00-00-old.jsonl'))
  })
})

describe('isCodexSessionVar', () => {
  it('biến phiên Codex, không phải cấu hình người dùng', () => {
    for (const k of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_MANAGED_BY_NPM'])
      expect(isCodexSessionVar(k)).toBe(true)
    for (const k of ['CODEX_HOME', 'OPENAI_API_KEY', 'PATH']) expect(isCodexSessionVar(k)).toBe(false)
  })
})

describe('ô chat (app-server)', () => {
  it('cấu hình chung: MCP stag + hook, không có luật phiên / cờ TUI', () => {
    const args = codexConfigArgs(base)
    expect(args.filter((a) => a !== '-c')).toEqual(configs(args))
    expect(configs(args).some((x) => x.startsWith('developer_instructions='))).toBe(false)
    expect(configs(args).filter((x) => x.startsWith('hooks.')).length).toBe(CODEX_HOOK_EVENTS.length)
    // Ô CLI dùng đúng phần cấu hình đó.
    expect(codexArgs(base).join('\n')).toContain(args.join('\n'))
  })

  it('tin cậy hook: bảng inline, khoá có dấu chấm / dấu \\ được đặt trong nháy', () => {
    expect(codexHookTrustArgs([])).toEqual([])
    const [flag, value] = codexHookTrustArgs([
      { key: 'C:\\<session-flags>\\config.toml:pre_tool_use:0:0', hash: 'sha256:aa' },
      { key: 'C:\\<session-flags>\\config.toml:stop:0:0', hash: 'sha256:bb' }
    ])
    expect(flag).toBe('-c')
    expect(value).toBe(
      'hooks.state={"C:\\\\<session-flags>\\\\config.toml:pre_tool_use:0:0"={trusted_hash="sha256:aa"},"C:\\\\<session-flags>\\\\config.toml:stop:0:0"={trusted_hash="sha256:bb"}}'
    )
  })

  it('tham số người dùng: -m → model, giữ -c / --enable, bỏ cờ chỉ có ở TUI', () => {
    expect(codexAppServerUserArgs(['-m', 'gpt-6', '-c', 'model_reasoning_effort="high"', '--enable', 'x', '--search', '--model=o9', '--no-alt-screen'])).toEqual({
      args: ['-c', 'model="gpt-6"', '-c', 'model_reasoning_effort="high"', '--enable', 'x', '-c', 'model="o9"'],
      dropped: ['--search', '--no-alt-screen']
    })
  })

  it('mức quyền → tham số thread/start', () => {
    expect(codexThreadPermission('default')).toEqual({})
    expect(codexThreadPermission('plan')).toEqual({ sandbox: 'read-only', approvalPolicy: 'on-request' })
    expect(codexThreadPermission('acceptEdits')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'on-request' })
    expect(codexThreadPermission('auto')).toMatchObject({ approvalsReviewer: 'auto_review' })
  })
})
