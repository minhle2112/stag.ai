import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateWorkspaceRequest, CreateWorkspaceResult, Workspace, WorkspaceInspection } from '@shared/types'
import { claudeConfigDir } from './context'
import { exists, isDir, mentionsPath, readText, samePath, today, writeIfMissing } from './fsutil'
import { JsonFile } from './jsonFile'
import { copyVaultTemplate, readTemplate, type TemplateVars } from './templates'
import { defaultProjectName, detectVaults, vaultDirName } from './vault'

const run = promisify(execFile)

/** Thư mục auto memory của Claude Code: mọi ký tự ngoài [A-Za-z0-9] thành '-' (đã kiểm chứng). */
export function autoMemoryDir(projectDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeConfigDir(env), 'projects', resolve(projectDir).replace(/[^A-Za-z0-9]/g, '-'), 'memory')
}

/** Ký tự không hợp lệ trong tên file Windows. */
export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim()
}

export class WorkspaceStore {
  private file = new JsonFile(join(app.getPath('userData'), 'workspaces.json'))
  private items: Workspace[] = []

  async load(): Promise<void> {
    // File hỏng (tắt máy giữa lúc ghi…): JsonFile cất bản hỏng cạnh đó và đọc bản .bak; không có thì danh sách trống.
    const { data } = await this.file.read((x): x is unknown[] => Array.isArray(x))
    this.items = (data ?? []).filter((w): w is Workspace => !!w && typeof w === 'object' && typeof (w as Workspace).id === 'string' && typeof (w as Workspace).path === 'string')
  }

  list(): Workspace[] {
    return this.items
  }

  get(id: string): Workspace | undefined {
    return this.items.find((w) => w.id === id)
  }

  /** Ghi nối đuôi nhau, file tạm rồi đổi tên, giữ bản .bak (xem JsonFile). */
  private save(): Promise<void> {
    return this.file.write(this.items)
  }

  /** Đổi một workspace (project, gợi ý monorepo…) rồi lưu; trả về bản mới. */
  async update(id: string, fn: (w: Workspace) => Workspace): Promise<Workspace> {
    const cur = this.items.find((w) => w.id === id)
    if (!cur) throw new Error('Workspace không tồn tại')
    const next = fn(cur)
    this.items = this.items.map((w) => (w.id === id ? next : w))
    await this.save()
    this.announce(next)
    return next
  }

  /** Báo cửa sổ app workspace vừa đổi (không có cửa sổ, vd. khi chạy test, thì thôi). */
  private announce(ws: Workspace): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(IPC.wsChanged, ws)
    } catch {
      // Chưa có / không có cửa sổ.
    }
  }

  /** Bỏ workspace khỏi app. Không xoá file nào trên đĩa. */
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((w) => w.id !== id)
    await this.save()
  }

  async inspect(dir: string): Promise<WorkspaceInspection> {
    const path = resolve(dir)
    return {
      path,
      suggestedName: defaultProjectName(path),
      isGitRepo: await exists(join(path, '.git')),
      candidates: await detectVaults(path),
      existing: this.items.find((w) => samePath(w.path, path))
    }
  }

  /** `claudeEnv`: biến môi trường của phiên Claude (CLAUDE_CONFIG_DIR đặt ở Cài đặt → Adapter đổi chỗ auto memory). */
  async create(input: CreateWorkspaceRequest, claudeEnv: NodeJS.ProcessEnv = process.env): Promise<CreateWorkspaceResult> {
    // Bấm tạo hai lần liền (hoặc hai lần gọi song song): lần sau đợi lần trước xong rồi mới xét trùng.
    const key = resolve(input.path).toLowerCase()
    if (this.creating.has(key)) throw new Error('Đang tạo workspace cho thư mục này')
    this.creating.add(key)
    try {
      return await this.createNow(input, claudeEnv)
    } finally {
      this.creating.delete(key)
    }
  }

  private creating = new Set<string>()

  private async createNow(input: CreateWorkspaceRequest, claudeEnv: NodeJS.ProcessEnv): Promise<CreateWorkspaceResult> {
    const req = { ...input, path: resolve(input.path) }
    if (req.vault.mode === 'existing') req.vault = { ...req.vault, path: resolve(req.vault.path) }
    if (!(await isDir(req.path))) throw new Error(`Không tìm thấy thư mục: ${req.path}`)
    if (req.vault.mode === 'existing' && !(await isDir(req.vault.path))) throw new Error(`Không tìm thấy thư mục vault: ${req.vault.path}`)
    if (this.items.some((w) => samePath(w.path, req.path))) throw new Error('Thư mục này đã là một workspace trong app')

    const name = safeName(req.name) || defaultProjectName(req.path)
    const report: string[] = []
    const vaultPath = req.vault.mode === 'new' ? join(req.path, vaultDirName(name)) : req.vault.path
    const vars: TemplateVars = {
      PROJECT: name,
      DATE: today(),
      VAULT_DIR: relative(req.path, vaultPath) || '.',
      VAULT_PATH: vaultPath,
      PROJECT_PATH: req.path,
      AUTO_MEMORY_PATH: autoMemoryDir(req.path, claudeEnv)
    }

    // Kiểm tra trước khi ghi gì: lỗi giữa chừng (vd. không có git) không được để lại vault dở dang chặn lần thử lại.
    if (req.vault.mode === 'new' && (await exists(vaultPath))) throw new Error(`Đã có thư mục "${vars.VAULT_DIR}". Hãy chọn "dùng vault có sẵn".`)
    // Thư mục con của một repo git: đã có git (không `git init` lồng repo trong repo), .gitignore ghi ngay trong thư mục này.
    let isGit = await insideGit(req.path)
    if (!isGit && req.gitInit) {
      await run('git', ['init', '-b', 'main'], { cwd: req.path })
      isGit = true
      report.push('Khởi tạo git (nhánh main)')
    }

    // 1. Vault
    if (req.vault.mode === 'new') {
      const created = await copyVaultTemplate(vaultPath, vars)
      report.push(`Tạo vault mới "${vars.VAULT_DIR}" (${created.filter((c) => c.endsWith('.md')).length} note)`)
    } else if (req.vault.augment) {
      const created = await copyVaultTemplate(vaultPath, vars, true)
      report.push(
        created.length
          ? `Bổ sung vào vault có sẵn (không ghi đè): ${created.join(', ')}`
          : 'Vault có sẵn đã đủ cấu trúc, không thêm gì'
      )
    } else {
      report.push(`Dùng vault có sẵn "${vars.VAULT_DIR}", giữ nguyên`)
    }

    // 2. Git
    if (isGit) report.push(await this.ensureGitignore(req.path, vaultPath))

    // 3. CLAUDE.md + cache auto memory. Vault không có _INDEX.md (vault có sẵn khác mẫu, giữ nguyên)
    //    thì dùng biến thể "plain", để không chỉ agent tới những note không tồn tại.
    const structured = await exists(join(vaultPath, '_INDEX.md'))
    report.push(await this.ensureClaudeMd(req.path, vars, structured))
    report.push(await this.ensureAutoMemory(vars, structured))

    const workspace: Workspace = { id: randomUUID(), name, path: req.path, vaultPath, createdAt: new Date().toISOString() }
    this.items.push(workspace)
    await this.save()
    return { workspace, report }
  }

  private async ensureGitignore(projectDir: string, vaultPath: string): Promise<string> {
    const rel = relative(projectDir, vaultPath).replace(/\\/g, '/')
    if (!rel) return '.gitignore: vault chính là thư mục dự án, không thêm được vào .gitignore'
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
      const added = await ensureIgnored(projectDir, ['.sessions/'], 'stag.ai agent sessions (personal data, keep out of git)')
      return `.gitignore: vault nằm ngoài thư mục dự án, không cần loại trừ${added.length ? `; thêm ${added.join(', ')}` : ''}`
    }
    const added = await ensureIgnored(projectDir, [`${gitignoreEscape(rel)}/`, '.sessions/'], 'stag.ai vault + agent sessions (personal data, keep out of git)')
    return added.length ? `.gitignore: thêm ${added.join(', ')}` : '.gitignore: đã loại trừ vault và .sessions/, giữ nguyên'
  }

  private async ensureClaudeMd(projectDir: string, vars: TemplateVars, structured: boolean): Promise<string> {
    const file = join(projectDir, 'CLAUDE.md')
    const full = await readTemplate('CLAUDE.md', vars)
    // Mẫu người dùng tự sửa có thể không còn tiêu đề "## Memory": coi cả mẫu là mục Memory.
    const at = full.search(/^## Memory/m)
    const cut = at < 0 ? 0 : at
    const plain = structured ? '' : await readTemplate('CLAUDE.memory-plain.md', vars)
    const section = structured ? full.slice(cut) : plain
    const head = at < 0 ? (structured ? '' : `${full.trimEnd()}\n\n`) : full.slice(0, cut)
    if (await writeIfMissing(file, `${head}${section}`)) return 'Tạo CLAUDE.md có quy tắc recall vault'
    const current = (await readText(file)) ?? ''
    if (mentionsPath(current, vars.VAULT_PATH) || /^##\s+Memory\b/m.test(current)) return 'CLAUDE.md đã có mục Memory, giữ nguyên'
    await fs.appendFile(file, `${current.endsWith('\n') ? '' : '\n'}\n${section}`, 'utf8')
    return 'CLAUDE.md có sẵn: thêm mục Memory vào cuối file'
  }

  private async ensureAutoMemory(vars: TemplateVars, structured: boolean): Promise<string> {
    const file = join(vars.AUTO_MEMORY_PATH, 'MEMORY.md')
    const line = await readTemplate(structured ? 'MEMORY.md' : 'MEMORY.plain.md', vars)
    if (await writeIfMissing(file, line)) return 'Tạo cache auto memory trỏ về vault'
    const current = (await readText(file)) ?? ''
    if (mentionsPath(current, vars.VAULT_PATH)) return 'Cache auto memory đã trỏ về vault, giữ nguyên'
    await fs.appendFile(file, `${current.endsWith('\n') ? '' : '\n'}${line}`, 'utf8')
    return 'Cache auto memory có sẵn: thêm dòng trỏ về vault'
  }
}

/** Thêm các dòng còn thiếu vào .gitignore (chỉ khi thư mục là repo git). Trả về các dòng đã thêm. */
/**
 * Đường dẫn → mẫu .gitignore khớp đúng chữ đó: thoát `\ * ? [`, `#` / `!` ở đầu và dấu cách ở cuối (tên vault như
 * "#notes" hay "a [b]" không thành chú thích / mẫu glob).
 */
export function gitignoreEscape(path: string): string {
  return path
    .replace(/[\\*?[]/g, '\\$&')
    .replace(/^([#!])/, '\\$1')
    .replace(/ $/, '\\ ')
}

/** Thư mục nằm trong một repo git (có `.git` ở chính nó hoặc một thư mục cha; `.git` là file với worktree / submodule). */
export async function insideGit(dir: string): Promise<boolean> {
  for (let cur = resolve(dir); ; ) {
    if (await exists(join(cur, '.git'))) return true
    const parent = dirname(cur)
    if (parent === cur) return false
    cur = parent
  }
}

export async function ensureIgnored(projectDir: string, entries: string[], header: string): Promise<string[]> {
  // .gitignore trong thư mục con cũng có hiệu lực (đường dẫn tính từ thư mục đó): workspace là thư mục con của repo vẫn ghi ở đây.
  if (!(await insideGit(projectDir))) return []
  const file = join(projectDir, '.gitignore')
  const current = (await readText(file)) ?? ''
  const have = new Set(current.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')))
  const wanted = entries.filter((l) => !have.has(l))
  if (!wanted.length) return []
  const block = `${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}# ${header}\n${wanted.join('\n')}\n`
  await fs.appendFile(file, block, 'utf8')
  return wanted
}

