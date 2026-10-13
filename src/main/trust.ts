import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { claudeJsonPath } from './context'

/**
 * Claude Code đã được người dùng xác nhận tin cậy thư mục này chưa (hộp thoại "Do you trust the files in this folder?")?
 * Trạng thái nằm ở `projects[<đường dẫn>].hasTrustDialogAccepted` trong ~/.claude.json (hoặc
 * `<CLAUDE_CONFIG_DIR>/.claude.json`, `env` = biến môi trường của phiên Claude); thư mục con được tin theo thư
 * mục cha đã tin.
 *
 * Cần cho ô chat: `claude -p` bỏ qua hộp thoại này, nên nếu không kiểm trước thì mã trong `.claude/` của một repo lạ
 * (hook, MCP, settings) chạy mà người dùng chưa từng đồng ý.
 */
export async function isClaudeFolderTrusted(dir: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  let data: unknown
  try {
    data = JSON.parse(await fs.readFile(claudeJsonPath(env, home), 'utf8'))
  } catch {
    return false
  }
  const projects = typeof data === 'object' && data !== null ? (data as { projects?: unknown }).projects : undefined
  if (typeof projects !== 'object' || projects === null) return false
  // Windows: Claude Code ghi đường dẫn bằng dấu / và không phân biệt hoa thường khi so sánh.
  const norm = (p: string): string => {
    const n = resolve(p).replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? n.toLowerCase() : n
  }
  const trusted = new Set<string>()
  for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && (value as { hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted === true) trusted.add(norm(key))
  }
  let cur = norm(dir)
  for (;;) {
    if (trusted.has(cur)) return true
    const parent = cur.replace(/\/[^/]*$/, '')
    if (!parent || parent === cur) return false
    cur = parent
  }
}
