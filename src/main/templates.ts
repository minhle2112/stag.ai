import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { app } from 'electron'
import { exists, writeIfMissing } from './fsutil'

/** Biến thay thế trong template vault: {{PROJECT}}, {{DATE}}, {{VAULT_DIR}}, {{VAULT_PATH}}, {{PROJECT_PATH}}, {{AUTO_MEMORY_PATH}}. */
export type TemplateVars = Record<'PROJECT' | 'DATE' | 'VAULT_DIR' | 'VAULT_PATH' | 'PROJECT_PATH' | 'AUTO_MEMORY_PATH', string>

/** Template gốc đi kèm app. */
function bundledTemplatesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), 'resources', 'templates')
}

/**
 * Template người dùng tự chỉnh (userData/templates). File ở đây **đè** lên file cùng đường dẫn của
 * template gốc, nhưng chỉ khi người dùng đã sửa nó: bản chép ra mà chưa sửa thì vẫn dùng bản gốc,
 * nên bản cập nhật của app vẫn tới được.
 */
export function userTemplatesDir(): string {
  return join(app.getPath('userData'), 'templates')
}

/** Ghi lại hash của từng file lúc chép từ bản gốc sang userData, để biết người dùng đã sửa file nào. */
const MANIFEST = '.copied.json'
type Manifest = Record<string, string>

const key = (rel: string): string => rel.replace(/\\/g, '/')
const hash = (text: string): string => createHash('sha256').update(text).digest('hex')

async function readManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(join(userTemplatesDir(), MANIFEST), 'utf8')) as Manifest
  } catch {
    return {}
  }
}

/** File của người dùng vẫn y như lúc chép từ bản gốc (chưa sửa). File không có trong manifest coi như đã sửa. */
async function untouched(rel: string, manifest: Manifest): Promise<boolean> {
  const h = manifest[key(rel)]
  if (!h) return false
  try {
    return hash(await fs.readFile(join(userTemplatesDir(), rel), 'utf8')) === h
  } catch {
    return false
  }
}

/**
 * Mở để chỉnh: chép template gốc sang userData. File người dùng đã sửa thì giữ nguyên; file chưa sửa
 * thì cập nhật theo bản gốc mới, hoặc xoá nếu bản gốc đã bỏ/đổi tên file đó.
 */
export async function prepareUserTemplates(): Promise<string> {
  const bundled = bundledTemplatesDir()
  const own = userTemplatesDir()
  const manifest = await readManifest()
  const bundledFiles = await listFiles(bundled)
  const inBundle = new Set(bundledFiles.map(key))
  for (const rel of await listFiles(own)) {
    if (key(rel) === MANIFEST || inBundle.has(key(rel))) continue
    if (await untouched(rel, manifest)) {
      await fs.rm(join(own, rel), { force: true })
      delete manifest[key(rel)]
    }
  }
  for (const rel of bundledFiles) {
    const dst = join(own, rel)
    if ((await exists(dst)) && !(await untouched(rel, manifest))) continue
    const text = await fs.readFile(join(bundled, rel), 'utf8')
    await fs.mkdir(dirname(dst), { recursive: true })
    await fs.writeFile(dst, text, 'utf8')
    manifest[key(rel)] = hash(text)
  }
  await fs.writeFile(join(own, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8')
  return own
}

/** File template: bản người dùng đã sửa nếu có, không thì bản gốc. */
async function templatePath(rel: string): Promise<string> {
  const own = join(userTemplatesDir(), rel)
  return (await exists(own)) && !(await untouched(rel, await readManifest())) ? own : join(bundledTemplatesDir(), rel)
}

export function fill(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => vars[key] ?? m)
}

export async function readTemplate(name: string, vars: Readonly<Record<string, string>>): Promise<string> {
  return fill(await fs.readFile(await templatePath(name), 'utf8'), vars)
}

/** Mọi file (đường dẫn tương đối) trong một thư mục, kể cả thư mục con. */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else out.push(relative(root, full))
    }
  }
  await walk(root)
  return out
}

/**
 * Chép cây thư mục sang đích, thay biến (nếu có) trong cả tên file và nội dung.
 * File `.keep` chỉ để giữ thư mục rỗng, không chép khi có biến. Không ghi đè file đã có.
 * `skipDated`: bỏ file có {{DATE}} trong tên (log/quyết định "khởi tạo vault") — dùng khi bổ sung vault có sẵn.
 * Trả về các đường dẫn tương đối đã tạo (thư mục mới kết thúc bằng '/').
 */
async function copyFiles(
  files: Array<{ rel: string; src: string }>,
  dest: string,
  vars: TemplateVars | null,
  skipDated: boolean
): Promise<string[]> {
  const created: string[] = []
  const name = (p: string): string => (vars ? fill(p, vars) : p)
  for (const { rel, src } of files.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const base = rel.split(/[\\/]/).pop()!
    if (skipDated && base.includes('{{DATE}}')) continue
    const dir = rel.slice(0, rel.length - base.length).replace(/[\\/]$/, '')
    if (dir && !(await exists(join(dest, name(dir))))) created.push(`${name(dir)}/`)
    await fs.mkdir(join(dest, name(dir)), { recursive: true })
    if (base === '.keep' && vars) continue
    const raw = await fs.readFile(src, 'utf8')
    if (await writeIfMissing(join(dest, name(rel)), vars ? fill(raw, vars) : raw)) created.push(name(rel))
  }
  return created
}

/** Tạo/bổ sung vault từ template (bản người dùng đã sửa đè bản gốc theo từng file). */
export async function copyVaultTemplate(dest: string, vars: TemplateVars, skipDated = false): Promise<string[]> {
  const bundled = join(bundledTemplatesDir(), 'vault')
  const own = join(userTemplatesDir(), 'vault')
  const byRel = new Map<string, string>()
  for (const rel of await listFiles(bundled)) byRel.set(rel, join(bundled, rel))
  const manifest = await readManifest()
  for (const rel of await listFiles(own)) {
    if (!(await untouched(join('vault', rel), manifest))) byRel.set(rel, join(own, rel))
  }
  return copyFiles([...byRel].map(([rel, src]) => ({ rel, src })), dest, vars, skipDated)
}
