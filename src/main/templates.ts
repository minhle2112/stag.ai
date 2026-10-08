import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
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
 * template gốc; file nào người dùng chưa chỉnh thì dùng bản gốc, nên bản cập nhật của app vẫn tới được.
 */
export function userTemplatesDir(): string {
  return join(app.getPath('userData'), 'templates')
}

/** Mở để chỉnh: lần đầu chép template gốc sang userData (không ghi đè file người dùng đã có). */
export async function prepareUserTemplates(): Promise<string> {
  await copyTree(bundledTemplatesDir(), userTemplatesDir(), null)
  return userTemplatesDir()
}

/** File template: bản của người dùng nếu có, không thì bản gốc. */
async function templatePath(rel: string): Promise<string> {
  const own = join(userTemplatesDir(), rel)
  return (await exists(own)) ? own : join(bundledTemplatesDir(), rel)
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

async function copyTree(src: string, dest: string, vars: TemplateVars | null): Promise<string[]> {
  const files = (await listFiles(src)).map((rel) => ({ rel, src: join(src, rel) }))
  return copyFiles(files, dest, vars, false)
}

/** Tạo/bổ sung vault từ template (bản người dùng đè bản gốc theo từng file). */
export async function copyVaultTemplate(dest: string, vars: TemplateVars, skipDated = false): Promise<string[]> {
  const bundled = join(bundledTemplatesDir(), 'vault')
  const own = join(userTemplatesDir(), 'vault')
  const byRel = new Map<string, string>()
  for (const rel of await listFiles(bundled)) byRel.set(rel, join(bundled, rel))
  for (const rel of await listFiles(own)) byRel.set(rel, join(own, rel))
  return copyFiles([...byRel].map(([rel, src]) => ({ rel, src })), dest, vars, skipDated)
}
