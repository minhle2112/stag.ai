import { join } from 'node:path'
import { clipboard, shell } from 'electron'
import type { ObsidianOpenResult } from '@shared/types'
import { exists } from './fsutil'
import { findRegisteredId } from './vault'

function obsidianExe(): string | null {
  const local = process.env.LOCALAPPDATA
  return local ? join(local, 'Programs', 'Obsidian', 'Obsidian.exe') : null
}

/**
 * Mở vault trong Obsidian.
 * - Đã đăng ký: `obsidian://open?vault=<id>` (đã kiểm chứng 2026-10-08).
 * - Chưa đăng ký: `?path=` không dùng được (Obsidian báo không tìm thấy vault), nên mở Obsidian,
 *   chép đường dẫn vào clipboard và trả về 'needs-register' để giao diện hướng dẫn
 *   "Open folder as vault". App không ghi vào obsidian.json.
 */
export async function openInObsidian(vaultPath: string): Promise<ObsidianOpenResult> {
  const id = await findRegisteredId(vaultPath)
  if (id) {
    await shell.openExternal(`obsidian://open?vault=${encodeURIComponent(id)}`)
    return { status: 'opened' }
  }
  clipboard.writeText(vaultPath)
  const exe = obsidianExe()
  const installed = !!exe && (await exists(exe))
  if (installed) await shell.openPath(exe!)
  return { status: 'needs-register', vaultPath, obsidianInstalled: installed }
}
