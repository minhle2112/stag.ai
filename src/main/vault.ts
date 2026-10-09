import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { NoteWriteResult, VaultCandidate, VaultNode } from '@shared/types'
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

/** Đường dẫn tuyệt đối của note `rel`; chặn đường dẫn thoát ra ngoài vault. */
function notePath(vaultPath: string, rel: string): string {
  const root = resolve(vaultPath)
  const full = resolve(root, rel)
  if (!full.startsWith(root + sep)) throw new Error('Đường dẫn nằm ngoài vault')
  return full
}

/** Đọc một note; chặn đường dẫn thoát ra ngoài vault. */
export async function readNote(vaultPath: string, rel: string): Promise<string> {
  return fs.readFile(notePath(vaultPath, rel), 'utf8')
}

/**
 * Ghi note người dùng sửa trong app. `base` = nội dung lúc bắt đầu sửa (lần đọc / lưu gần nhất): file trên
 * đĩa đã khác `base` nghĩa là Obsidian hoặc agent vừa sửa → không ghi, trả về bản trên đĩa để người dùng chọn.
 * Ghi thẳng vào file (không qua file tạm + đổi tên) để Obsidian thấy như một lần sửa bình thường.
 */
export async function writeNote(vaultPath: string, rel: string, text: string, base: string | null): Promise<NoteWriteResult> {
  const full = notePath(vaultPath, rel)
  if (!rel.toLowerCase().endsWith('.md')) throw new Error('Chỉ sửa được note .md')
  if (base !== null) {
    let disk: string | null
    try {
      disk = await fs.readFile(full, 'utf8')
    } catch {
      disk = null
    }
    if (disk !== base) return { status: 'conflict', disk }
  }
  await fs.writeFile(full, text, 'utf8')
  return { status: 'saved' }
}

/** Ghi đè / tạo note, tạo luôn thư mục cha (plugin ghi vault qua ctx.vault.write). Chặn đường dẫn ra ngoài vault. */
export async function putNote(vaultPath: string, rel: string, text: string): Promise<void> {
  const full = notePath(vaultPath, rel)
  if (!rel.toLowerCase().endsWith('.md')) throw new Error('Chỉ ghi được note .md')
  await fs.mkdir(dirname(full), { recursive: true })
  await fs.writeFile(full, text, 'utf8')
}

/**
 * Tạo note mới `<folder>/<name>.md` với tiêu đề; trả về `rel`. Tên trùng thì báo lỗi (không ghi đè).
 * Tên không được có ký tự Windows cấm hay ký tự Obsidian dùng trong link (`[ ] # ^ |`).
 */
export async function createNote(vaultPath: string, folder: string, name: string): Promise<string> {
  const clean = name.trim().replace(/\.md$/i, '').trim()
  if (!clean) throw new Error('Chưa nhập tên note')
  if (/[\\/:*?"<>|[\]#^]/.test(clean) || /^\.|\.$/.test(clean)) throw new Error('Tên note không được có \\ / : * ? " < > | [ ] # ^ và không bắt đầu / kết thúc bằng dấu chấm')
  const rel = folder ? `${folder.replace(/\/+$/, '')}/${clean}.md` : `${clean}.md`
  const full = notePath(vaultPath, rel)
  await fs.mkdir(resolve(full, '..'), { recursive: true })
  try {
    await fs.writeFile(full, `# ${clean}\n\n`, { encoding: 'utf8', flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Đã có note "${rel}"`)
    throw e
  }
  return rel
}

export function vaultDirName(projectName: string): string {
  return `${projectName} memory`
}

export function defaultProjectName(projectDir: string): string {
  return basename(projectDir)
}
