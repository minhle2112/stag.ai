import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { PermissionMode } from '@shared/types'
import { exists } from './fsutil'
import type { ContextSample } from './transcript'
import { t } from '@shared/i18n'

/**
 * Agent chạy Codex CLI (OpenAI, đã kiểm với 0.162.0). Khác Claude Code:
 * - Không đặt trước được id phiên: id (thread id) đến qua hook SessionStart, dùng cho `codex resume <id>`.
 * - Luật phiên qua `-c developer_instructions=…` (thêm một tin developer, không thay system prompt).
 * - Hook chỉ có kiểu lệnh (không có http), kế thừa môi trường của phiên → curl.exe gửi stdin về StatusHub
 *   (xem codexHookCommand). Cần `--dangerously-bypass-hook-trust` vì hook đến từ lớp cấu hình `-c` (chưa được
 *   người dùng tin cậy).
 * - % context: dòng `token_count` trong rollout `~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`.
 * Tham khảo: learn.chatgpt.com/docs/config-file/config-reference, /docs/hooks, mã nguồn openai/codex.
 */

/** Sự kiện hook Codex app cần (Codex không có Notification; Interrupt = người dùng bấm Esc). */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt']

/** Chuỗi TOML cơ bản: chuỗi JSON (escape `"`, `\`, xuống dòng, ký tự điều khiển) hợp lệ trong TOML. */
export const tomlString = (s: string): string => JSON.stringify(s)

/**
 * Lệnh hook: curl.exe (có sẵn trong Windows) gửi JSON từ stdin về StatusHub, không in gì ra stdout (Codex đọc
 * stdout của hook như một quyết định). Codex 0.162 chạy hook qua PowerShell (đã thử: `@-` không đặt trong
 * nháy → lỗi cú pháp, exit 1), nên lệnh phải chạy được trên mọi shell: không dùng `%VAR%` / `$env:VAR`, biến
 * môi trường đọc bằng `--variable %VAR` + `{{VAR}}` của curl (cần curl ≥ 8.3; Windows 11 có 8.x). Đã thử
 * trên PowerShell, cmd, Git Bash.
 */
export function codexHookCommand(hookUrl: string, reply = false): string {
  return (
    `curl.exe -s ${reply ? `-m ${CODEX_REPLY_SECONDS}` : '-m 5 -o NUL'} --variable %STAG_TOKEN --variable %STAG_AGENT_ID ` +
    '--expand-header "Authorization: Bearer {{STAG_TOKEN}}" --expand-header "X-Stag-Agent: {{STAG_AGENT_ID}}" ' +
    `-H "Content-Type: application/json" --data-binary "@-" ${hookUrl}`
  )
}

/**
 * PreToolUse: câu trả lời của app (khoá phạm vi, xem scopeGuard.ts) in ra stdout cho Codex đọc. App có thể
 * chờ người dùng trả lời tới SCOPE_ASK_MS (280 giây) nên curl và hook chờ lâu hơn chút.
 */
const CODEX_REPLY_EVENTS = new Set(['PreToolUse'])
const CODEX_REPLY_SECONDS = 300

/** Mức quyền của app → cờ của Codex. 'default' = theo ~/.codex/config.toml của người dùng. */
export function codexPermissionArgs(mode: PermissionMode): string[] {
  switch (mode) {
    case 'acceptEdits':
      return ['-s', 'workspace-write', '-a', 'on-request']
    case 'auto':
      return ['-s', 'workspace-write', '--approve-for-me']
    case 'plan':
      return ['-s', 'read-only', '-a', 'on-request']
    default:
      return []
  }
}

export interface CodexLaunch {
  /** Luật phiên của agent (agent/rules.md đã điền biến). */
  rules: string
  mcpUrl: string
  hookUrl: string
  permissionMode: PermissionMode
  /** Thread id Codex của phiên trước (tiếp tục phiên), hoặc undefined = phiên mới. */
  resumeId?: string
  /** Lời mở cho phiên mới. */
  prompt?: string
  /** Model, mức suy nghĩ, tham số thêm người dùng chọn (Cài đặt → Adapter → Codex). */
  userArgs?: string[]
}

/**
 * Cấu hình `-c` chung của phiên agent Codex (ô CLI và ô chat): file luật dự án, máy chủ MCP stag, hook về StatusHub.
 * Không gồm luật phiên (`developer_instructions`): ô CLI truyền qua `-c`, ô chat qua tham số `thread/start`.
 */
export function codexConfigArgs(o: Pick<CodexLaunch, 'mcpUrl' | 'hookUrl'>): string[] {
  return [
    // Dự án tạo bởi stag.ai có CLAUDE.md (luật dùng vault), không có AGENTS.md.
    '-c',
    'project_doc_fallback_filenames=["CLAUDE.md"]',
    '-c',
    `mcp_servers.stag.url=${tomlString(o.mcpUrl)}`,
    '-c',
    'mcp_servers.stag.bearer_token_env_var="STAG_TOKEN"',
    '-c',
    'mcp_servers.stag.env_http_headers={"X-Stag-Agent"="STAG_AGENT_ID"}',
    '-c',
    'mcp_servers.stag.default_tools_approval_mode="approve"',
    // Mặc định Codex chỉ chờ tool 60 s; agent_create chờ người dùng xác nhận trong app tới AGENT_REQUEST_MS (280 s).
    '-c',
    'mcp_servers.stag.tool_timeout_sec=330',
    ...codexHookArgs(o.hookUrl)
  ]
}

/** Hook của app (`-c hooks.<Sự kiện>=…`). */
export function codexHookArgs(hookUrl: string): string[] {
  const args: string[] = []
  // Codex hạ thời hạn hook Interrupt xuống 3 giây (và hiện cảnh báo nếu đặt cao hơn).
  for (const ev of CODEX_HOOK_EVENTS) {
    const reply = CODEX_REPLY_EVENTS.has(ev)
    const hook = codexHookCommand(hookUrl, reply)
    args.push('-c', `hooks.${ev}=[{hooks=[{type="command",command=${tomlString(hook)},timeout=${reply ? CODEX_REPLY_SECONDS + 10 : ev === 'Interrupt' ? 3 : 10}}]}]`)
  }
  return args
}

/** Tham số cho codex.exe (truyền thẳng qua CreateProcess, không qua cmd.exe: luật phiên dài, nhiều dòng). */
export function codexArgs(o: CodexLaunch): string[] {
  const args = o.resumeId ? ['resume', o.resumeId] : []
  args.push(
    // Không gắn vào daemon app-server dùng chung: daemon không mang biến môi trường / cấu hình của phiên này.
    '--no-daemon',
    '--dangerously-bypass-hook-trust',
    '-c',
    `developer_instructions=${tomlString(o.rules)}`,
    ...codexConfigArgs(o)
  )
  args.push(...codexPermissionArgs(o.permissionMode), ...(o.userArgs ?? []))
  if (!o.resumeId && o.prompt) args.push(o.prompt)
  return args
}

// ---- ô chat: `codex app-server` (JSON-RPC qua stdio, xem chat/codexSession.ts) ----

/**
 * Hook trong lớp cấu hình `-c` bị app-server coi là chưa tin cậy (không chạy), và `--dangerously-bypass-hook-trust`
 * chỉ có ở TUI. App đánh dấu tin cậy đúng các hook của chính nó (nguồn "sessionFlags"): `hooks.state."<key>".trusted_hash`,
 * key / hash lấy qua `hooks/list` của một app-server chạy thử (xem chat/codexSession.ts). Viết dạng bảng inline vì khoá
 * có dấu chấm: `-c hooks.state."<key>".trusted_hash=…` không ăn (đã thử với 0.162.0).
 */
export function codexHookTrustArgs(trusted: Array<{ key: string; hash: string }>): string[] {
  if (!trusted.length) return []
  return ['-c', `hooks.state={${trusted.map((t) => `${tomlString(t.key)}={trusted_hash=${tomlString(t.hash)}}`).join(',')}}`]
}

/**
 * Tham số người dùng (Cài đặt → Adapter → Codex: model, mức suy nghĩ, tham số thêm) cho app-server: app-server chỉ
 * nhận `-c` / `--enable` / `--disable`; cờ của TUI có khoá cấu hình tương đương thì đổi sang `-c`, không có thì bỏ.
 */
export function codexAppServerUserArgs(args: string[]): { args: string[]; dropped: string[] } {
  const toml: Record<string, string> = {
    '-m': 'model',
    '--model': 'model',
    '-s': 'sandbox_mode',
    '--sandbox': 'sandbox_mode',
    '-a': 'approval_policy',
    '--ask-for-approval': 'approval_policy',
    '-p': 'profile',
    '--profile': 'profile'
  }
  const out: string[] = []
  const dropped: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    const flag = eq > 0 ? a.slice(0, eq) : a
    const value = (): string | undefined => (eq > 0 ? a.slice(eq + 1) : args[++i])
    if (flag === '-c' || flag === '--config' || flag === '--enable' || flag === '--disable') {
      const v = value()
      if (v !== undefined) out.push(flag === '--config' ? '-c' : flag, v)
    } else if (flag === '--strict-config') out.push(flag)
    else if (toml[flag]) {
      const v = value()
      if (v !== undefined) out.push('-c', `${toml[flag]}=${tomlString(v)}`)
    } else dropped.push(a)
  }
  return { args: out, dropped }
}

/** Mức quyền của app → tham số `thread/start` / `thread/resume` của app-server ({} = theo ~/.codex/config.toml). */
export function codexThreadPermission(mode: PermissionMode): { sandbox?: string; approvalPolicy?: string; approvalsReviewer?: string } {
  switch (mode) {
    case 'acceptEdits':
      return { sandbox: 'workspace-write', approvalPolicy: 'on-request' }
    case 'auto':
      // Như `--approve-for-me` của TUI: agent duyệt của Codex tự trả lời các yêu cầu.
      return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
    case 'plan':
      return { sandbox: 'read-only', approvalPolicy: 'on-request' }
    default:
      return {}
  }
}

/**
 * codex.exe thật: gói npm @openai/codex chạy `vendor/<triple>/bin/codex.exe` trong gói phụ
 * @openai/codex-win32-x64 (hoặc -arm64). Gọi thẳng exe, không qua codex.cmd (cmd.exe giới hạn 8191 ký tự,
 * làm hỏng `%`, `^`, `&` và xuống dòng trong luật phiên).
 */
export async function resolveCodex(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const triples = [
    ['codex-win32-x64', 'x86_64-pc-windows-msvc'],
    ['codex-win32-arm64', 'aarch64-pc-windows-msvc']
  ]
  for (const dir of dirs) {
    if (!(await exists(join(dir, 'codex.cmd'))) && !(await exists(join(dir, 'codex')))) continue
    const root = join(dir, 'node_modules', '@openai', 'codex')
    for (const [pkg, triple] of triples) {
      for (const base of [join(root, 'node_modules', '@openai', pkg), join(dir, 'node_modules', '@openai', pkg), root]) {
        const exe = join(base, 'vendor', triple, 'bin', 'codex.exe')
        if (await exists(exe)) return exe
      }
    }
  }
  for (const dir of dirs) if (await exists(join(dir, 'codex.exe'))) return join(dir, 'codex.exe')
  throw new Error(t('adapters.error.codexMissing'))
}

/** Thư mục dữ liệu của Codex (đổi được bằng CODEX_HOME). */
export function codexHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CODEX_HOME || join(home, '.codex')
}

/**
 * Rollout của một thread: `sessions/YYYY/MM/DD/rollout-<giờ địa phương>-<id>.jsonl` (có thể đã nén `.zst`
 * nếu cũ). Tìm trong `days` ngày gần nhất trước; `deep` thì không thấy sẽ quét mọi ngày (mới trước) — thread được
 * tiếp tục từ lâu vẫn nằm ở ngày tạo. File chỉ được tạo khi Codex ghi lần đầu, chưa có thì null.
 */
export async function findCodexRollout(threadId: string, now = new Date(), home = codexHome(), days = 3, deep = true): Promise<string | null> {
  const match = (n: string): boolean => n.startsWith('rollout-') && n.endsWith(`-${threadId}.jsonl`)
  for (let d = 0; d < days; d++) {
    const t = new Date(now.getTime() - d * 86_400_000)
    const dir = join(home, 'sessions', String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'))
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    const hit = names.find(match)
    if (hit) return join(dir, hit)
  }
  if (!deep) return null
  const root = join(home, 'sessions')
  const sub = async (p: string): Promise<string[]> =>
    (await fs.readdir(p).catch(() => [] as string[])).filter((n) => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a))
  for (const y of await sub(root))
    for (const m of await sub(join(root, y)))
      for (const d of await sub(join(root, y, m))) {
        const dir = join(root, y, m, d)
        const hit = (await fs.readdir(dir).catch(() => [] as string[])).find(match)
        if (hit) return join(dir, hit)
      }
  return null
}

interface CodexLine {
  timestamp?: unknown
  type?: unknown
  payload?: {
    type?: unknown
    info?: { last_token_usage?: { total_tokens?: unknown; input_tokens?: unknown }; model_context_window?: unknown } | null
  }
}

/**
 * Độ dài context từ một dòng rollout `event_msg`/`token_count`. Giống thanh trạng thái của Codex:
 * dùng `last_token_usage.total_tokens` của lượt gần nhất trên `model_context_window`.
 */
export function parseCodexContext(line: string, now = (): string => new Date().toISOString()): ContextSample | null {
  if (!line.includes('token_count')) return null
  let e: CodexLine
  try {
    e = JSON.parse(line) as CodexLine
  } catch {
    return null
  }
  if (e?.type !== 'event_msg' || e.payload?.type !== 'token_count') return null
  const info = e.payload.info
  const used = info?.last_token_usage?.total_tokens
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return null
  const size = info?.model_context_window
  return {
    used,
    model: null,
    at: typeof e.timestamp === 'string' ? e.timestamp : now(),
    size: typeof size === 'number' && size > 0 ? size : undefined
  }
}

/** Biến môi trường Codex đặt cho lệnh con: mở app từ trong một phiên Codex thì bỏ đi (phiên agent là độc lập). */
export function isCodexSessionVar(key: string): boolean {
  return /^CODEX_(THREAD_ID|SESSION_ID|TOOL_CALL_ID|SANDBOX|MANAGED_|PERMISSION_PROFILE|VERSION|APPLY_PATCH_)/.test(key)
}
