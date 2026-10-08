import { promises as fs } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import type { VaultCandidate, VaultNode } from '@shared/types'
import { exists, isDir, readText, samePath } from './fsutil'

/** Thư mục không bao giờ quét khi tìm vault. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.sessions', '.stag', 'out', 'dist', 'build', '.venv', 'venv', 'target', '.next'])
const SCAN_DEPTH = 2

/** Danh sách vault Obsidian đã đăng ký: `%APPDATA%\obsidian\obsidian.json` (chỉ đọc). */
export async function readObsidianRegistry(): Promise<Array<{ id: string; path: string }>> {
  const appData = process.env.APPDATA
  if (!appData) return []
  const raw = await readText(join(appData, 'obsidian', 'obsidian.json'))
  if (!raw) return []
  try {
    const vaults = (JSON.parse(raw) as { vaults?: Record<string, { path?: string }> }).vaults ?? {}
    return Object.entries(vaults)
      .filter(([, v]) => typeof v.path === 'string')
      .map(([id, v]) => ({ id, path: v.path! }))
  } catch {
    return []
  }
}

export async function findRegisteredId(vaultPath: string): Promise<string | undefined> {
  return (await readObsidianRegistry()).find((v) => samePath(v.path, vaultPath))?.id
}

/** `_INDEX.md` có frontmatter `type: index` → vault đúng mẫu stag.ai. */
async function isStagVault(dir: string): Promise<boolean> {
  const index = await readText(join(dir, '_INDEX.md'))
  if (!index) return false
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(index)
  return !!fm && /^type:\s*index\s*$/m.test(fm[1])
}

/** Quét thư mục dự án (nông, tối đa 2 cấp) để tìm vault có sẵn. */
export async function detectVaults(projectDir: string): Promise<VaultCandidate[]> {
  const registry = await readObsidianRegistry()
  const found: VaultCandidate[] = []

  async function visit(dir: string, depth: number): Promise<void> {
    const stag = await isStagVault(dir)
    const obsidian = await isDir(join(dir, '.obsidian'))
    if (stag || obsidian) {
      found.push({
        path: dir,
        relPath: relative(projectDir, dir),
        kind: stag ? 'stag' : 'obsidian',
        registered: registry.some((v) => samePath(v.path, dir))
      })
      return // không tìm vault lồng trong vault
    }
    if (depth >= SCAN_DEPTH) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) await visit(join(dir, e.name), depth + 1)
    }
  }

  await visit(projectDir, 0)
  // Vault đúng mẫu lên trước.
  return found.sort((a, b) => (a.kind === b.kind ? a.relPath.localeCompare(b.relPath) : a.kind === 'stag' ? -1 : 1))
}

/** Cây note của vault (thư mục + file .md), bỏ thư mục/tệp ẩn. */
export async function vaultTree(vaultPath: string): Promise<VaultNode[]> {
  async function walk(dir: string, relDir: string): Promise<VaultNode[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const nodes: VaultNode[] = []
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        nodes.push({ name: e.name, rel, dir: true, children: await walk(join(dir, e.name), rel) })
      } else if (e.name.toLowerCase().endsWith('.md')) {
        nodes.push({ name: e.name.slice(0, -3), rel, dir: false })
      }
    }
    return nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'vi', { numeric: true }) : a.dir ? -1 : 1))
  }
  if (!(await exists(vaultPath))) return []
  return walk(vaultPath, '')
}

/** Đọc một note; chặn đường dẫn thoát ra ngoài vault. */
export async function readNote(vaultPath: string, rel: string): Promise<string> {
  const root = resolve(vaultPath)
  const full = resolve(root, rel)
  if (!full.startsWith(root + sep)) throw new Error('Đường dẫn nằm ngoài vault')
  return fs.readFile(full, 'utf8')
}

export function vaultDirName(projectName: string): string {
  return `${projectName} memory`
}

export function defaultProjectName(projectDir: string): string {
  return basename(projectDir)
}
