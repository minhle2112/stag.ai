import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { app } from 'electron'
import { exists, writeIfMissing } from './fsutil'

/** Biến thay thế trong template: {{PROJECT}}, {{DATE}}, {{VAULT_DIR}}, {{VAULT_PATH}}, {{PROJECT_PATH}}, {{AUTO_MEMORY_PATH}}. */
export type TemplateVars = Record<'PROJECT' | 'DATE' | 'VAULT_DIR' | 'VAULT_PATH' | 'PROJECT_PATH' | 'AUTO_MEMORY_PATH', string>

/** Template gốc đi kèm app. */
function bundledTemplatesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'templates') : join(app.getAppPath(), 'resources', 'templates')
}

/** Bản template người dùng chỉnh được (userData/templates). */
export function userTemplatesDir(): string {
  return join(app.getPath('userData'), 'templates')
}

/** Chép template gốc sang userData lần đầu; file người dùng đã có thì giữ nguyên. */
export async function ensureUserTemplates(): Promise<void> {
  await copyTree(bundledTemplatesDir(), userTemplatesDir(), null)
}

export function fill(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => (key in vars ? vars[key as keyof TemplateVars] : m))
}

export async function readTemplate(name: string, vars: TemplateVars): Promise<string> {
  return fill(await fs.readFile(join(userTemplatesDir(), name), 'utf8'), vars)
}

/**
 * Chép cây thư mục template sang đích, thay biến trong cả tên file và nội dung.
 * File `.keep` chỉ để giữ thư mục rỗng, không chép. Không ghi đè file đã có.
 * `skipDated`: bỏ các file có tên chứa {{DATE}} (log/quyết định "khởi tạo vault") — dùng khi bổ sung vault có sẵn.
 * Trả về danh sách đường dẫn tương đối đã tạo.
 */
export async function copyTree(src: string, dest: string, vars: TemplateVars | null, skipDated = false): Promise<string[]> {
  const created: string[] = []
  async function walk(dir: string): Promise<void> {
    const rel = relative(src, dir)
    const target = join(dest, vars ? fill(rel, vars) : rel)
    if (rel && !(await exists(target))) created.push(`${vars ? fill(rel, vars) : rel}/`)
    await fs.mkdir(target, { recursive: true })
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(from)
      } else if ((entry.name !== '.keep' || !vars) && !(skipDated && entry.name.includes('{{DATE}}'))) {
        const name = vars ? fill(entry.name, vars) : entry.name
        const raw = await fs.readFile(from, 'utf8')
        if (await writeIfMissing(join(target, name), vars ? fill(raw, vars) : raw)) {
          created.push(join(vars ? fill(rel, vars) : rel, name))
        }
      }
    }
  }
  await walk(src)
  return created
}

export async function copyVaultTemplate(dest: string, vars: TemplateVars, skipDated = false): Promise<string[]> {
  return copyTree(join(userTemplatesDir(), 'vault'), dest, vars, skipDated)
}
