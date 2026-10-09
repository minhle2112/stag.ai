import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { AgentStatus, ContextUsage, HandoffSettings } from '@shared/types'
import { exists, readText } from './fsutil'

/**
 * Độ dài context của phiên agent. Hai nguồn:
 * - statusLine của Claude Code (hub.ts): có cả kích thước cửa sổ (200k / 1M). Chạy lúc mở phiên, sau mỗi
 *   tin nhắn của assistant và sau /compact. `current_usage` là null trước lượt đầu và ngay sau /compact.
 * - transcript JSONL (transcript.ts): chỉ có số token. Để có số ngay khi tiếp tục phiên cũ, và khi
 *   statusLine của app không chạy (statusLine cấp managed, máy không phải Windows).
 * Tài liệu: https://code.claude.com/docs/en/statusline (JSON schema, "used_percentage … input tokens only").
 */

export interface StatusLineInfo {
  sessionId: string | null
  /** null = Claude Code chưa có số (trước lượt đầu / ngay sau /compact). */
  used: number | null
  size: number | null
}

const posNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** Đọc phần cần dùng trong JSON statusLine Claude Code gửi qua stdin. */
export function parseStatusLine(body: unknown): StatusLineInfo {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const cw = (b.context_window && typeof b.context_window === 'object' ? b.context_window : {}) as Record<string, unknown>
  const cu = cw.current_usage && typeof cw.current_usage === 'object' ? (cw.current_usage as Record<string, unknown>) : null
  const size = posNum(cw.context_window_size)
  let used: number | null = null
  if (cu) {
    used = (posNum(cu.input_tokens) ?? 0) + (posNum(cu.cache_creation_input_tokens) ?? 0) + (posNum(cu.cache_read_input_tokens) ?? 0)
  }
  return { sessionId: typeof b.session_id === 'string' ? b.session_id : null, used, size: size && size > 0 ? size : null }
}

/**
 * Gộp số đo mới vào số hiện có. `used` chỉ nhận số đo mới hơn (statusLine và transcript tới lệch nhau),
 * `size` giữ lại khi nguồn mới không có.
 */
export function mergeContext(
  cur: ContextUsage | undefined,
  next: { used?: number | null; size?: number | null; at: string }
): ContextUsage | undefined {
  const size = next.size ?? cur?.size ?? null
  const newer = next.used != null && (!cur || Date.parse(next.at) >= Date.parse(cur.at))
  if (newer) return { used: next.used!, size, at: next.at }
  if (!cur) return undefined
  return size === cur.size ? cur : { ...cur, size }
}

/** % cửa sổ context đã dùng (0–100), null nếu chưa biết kích thước. */
export function contextPercent(c: ContextUsage | undefined): number | null {
  if (!c || !c.size) return null
  return Math.min(100, (c.used / c.size) * 100)
}

/** Thư mục cấu hình người dùng của Claude Code (đổi được bằng CLAUDE_CONFIG_DIR). */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude')
}

/**
 * Lệnh statusLine người dùng tự đặt (cấp local > dự án > user, theo thứ tự ưu tiên của Claude Code), null nếu
 * không có. `--settings` của app thắng cả ba, nên script statusLine của app chạy tiếp lệnh này với cùng stdin
 * và in ra kết quả của nó: statusLine của người dùng vẫn hiện như cũ trong phiên agent.
 * (statusLine cấp managed thì thắng `--settings`: app không nhận được số, chỉ còn nguồn transcript.)
 */
export async function userStatusLine(projectDir: string, configDir = claudeConfigDir()): Promise<string | null> {
  const files = [
    join(projectDir, '.claude', 'settings.local.json'),
    join(projectDir, '.claude', 'settings.json'),
    join(configDir, 'settings.json')
  ]
  for (const f of files) {
    const raw = await readText(f)
    if (!raw) continue
    try {
      const s = JSON.parse(raw) as { statusLine?: { type?: unknown; command?: unknown } }
      const sl = s?.statusLine
      if (sl && typeof sl === 'object') return sl.type === 'command' && typeof sl.command === 'string' && sl.command.trim() ? sl.command : null
    } catch {
      // File hỏng: Claude Code cũng không đọc được statusLine trong đó.
    }
  }
  return null
}

/**
 * Git Bash mà Claude Code dùng để chạy lệnh statusLine (không có thì Claude Code dùng PowerShell):
 * CLAUDE_CODE_GIT_BASH_PATH, rồi bash.exe cạnh git.exe trong PATH, rồi chỗ cài mặc định.
 */
export async function findGitBash(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const candidates: string[] = []
  if (env.CLAUDE_CODE_GIT_BASH_PATH) candidates.push(env.CLAUDE_CODE_GIT_BASH_PATH)
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    if (await exists(join(dir, 'git.exe'))) candidates.push(join(dir, '..', 'bin', 'bash.exe'), join(dir, '..', '..', 'bin', 'bash.exe'))
  }
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')])
    if (root) candidates.push(join(root, 'Git', 'bin', 'bash.exe'))
  for (const c of candidates) if (await exists(c)) return c
  return null
}

/** Agent vừa hết lượt bao lâu thì mới nhờ bàn giao (người dùng có thể đang đọc rồi gõ tiếp). */
export const HANDOFF_SETTLE_MS = 3000
/** Người dùng gõ phím vào terminal gần đây thì chưa chen vào. */
export const HANDOFF_TYPING_MS = 8000

/**
 * Đã tới lúc tự nhờ agent bàn giao chưa: bật tự động, biết kích thước cửa sổ, vượt ngưỡng, agent đang chờ
 * vì hết lượt (không phải đang hỏi / xin quyền / bị ngắt), chờ đủ lâu, người dùng không đang gõ,
 * và chưa bàn giao (hoặc đã hỏng) trong phiên này.
 */
export function handoffDue(
  settings: HandoffSettings,
  status: AgentStatus | undefined,
  lastInputAt: number,
  now: number
): boolean {
  if (!settings.autoHandoff || !status || status.handoff) return false
  const pct = contextPercent(status.context)
  if (pct == null || pct < settings.handoffPercent) return false
  if (status.activity !== 'waiting' || (status.reason !== 'turn' && status.reason !== 'idle')) return false
  if (now - Date.parse(status.since) < HANDOFF_SETTLE_MS) return false
  return now - lastInputAt >= HANDOFF_TYPING_MS
}

/** Lời app gõ vào terminal để nhờ agent bàn giao (một dòng: xuống dòng sẽ bị coi là dán nhiều dòng). */
export function handoffPrompt(percent: number | null, threshold: number | null): string {
  const why =
    percent != null && threshold != null
      ? `your context window is ${Math.round(percent)}% full (handoff threshold ${threshold}%)`
      : 'the user asked to continue in a fresh session'
  return (
    `[stag.ai] Handoff: ${why}. Stop the current work at a safe point, update the vault per its Memory Protocol, ` +
    `then call the stag tool session_handoff with a complete handoff for your next session ` +
    `(goal, what is done, what is left, key files and decisions, next step). ` +
    `stag.ai will then close this session and open a new one that continues from your handoff. Do not ask the user anything.`
  )
}
