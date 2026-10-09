import { delimiter, join } from 'node:path'
import type { ShellId, ShellInfo } from '@shared/types'
import { findGitBash } from './context'
import { exists } from './fsutil'

/** Tìm file chạy trong PATH (theo thứ tự PATH). */
async function onPath(exe: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    const p = join(dir, exe)
    if (await exists(p)) return p
  }
  return null
}

/** PowerShell 7 (pwsh): trong PATH, hoặc chỗ cài mặc định. */
async function findPwsh(env: NodeJS.ProcessEnv): Promise<string | null> {
  const found = await onPath('pwsh.exe', env)
  if (found) return found
  for (const root of [env.ProgramFiles, env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Microsoft', 'PowerShell')]) {
    if (!root) continue
    const p = join(root, 'PowerShell', '7', 'pwsh.exe')
    if (await exists(p)) return p
  }
  return null
}

/** Các shell có trên máy cho ô Terminal. Windows PowerShell luôn có (đứng đầu, là shell dự phòng). */
export async function detectShells(env: NodeJS.ProcessEnv = process.env): Promise<ShellInfo[]> {
  const out: ShellInfo[] = [{ id: 'powershell', label: 'Windows PowerShell', path: 'powershell.exe', args: ['-NoLogo'] }]
  const pwsh = await findPwsh(env)
  if (pwsh) out.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh, args: ['-NoLogo'] })
  const bash = await findGitBash(env)
  if (bash) out.push({ id: 'gitbash', label: 'Git Bash', path: bash, args: ['--login', '-i'] })
  out.push({ id: 'cmd', label: 'Command Prompt (cmd)', path: env.ComSpec || env.COMSPEC || 'cmd.exe', args: [] })
  return out
}

/** Shell người dùng chọn; không có trên máy thì Windows PowerShell. */
export async function resolveShell(id: ShellId, env: NodeJS.ProcessEnv = process.env): Promise<ShellInfo> {
  const all = await detectShells(env)
  return all.find((s) => s.id === id) ?? all[0]
}
