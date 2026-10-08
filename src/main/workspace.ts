import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { CreateWorkspaceRequest, CreateWorkspaceResult, Workspace, WorkspaceInspection } from '@shared/types'
import { exists, isDir, mentionsPath, readText, samePath, today, writeIfMissing } from './fsutil'
import { copyVaultTemplate, readTemplate, type TemplateVars } from './templates'
import { defaultProjectName, detectVaults, vaultDirName } from './vault'

const run = promisify(execFile)

/** Thư mục auto memory của Claude Code: mọi ký tự ngoài [A-Za-z0-9] thành '-' (đã kiểm chứng). */
export function autoMemoryDir(projectDir: string): string {
  return join(homedir(), '.claude', 'projects', resolve(projectDir).replace(/[^A-Za-z0-9]/g, '-'), 'memory')
}

/** Ký tự không hợp lệ trong tên file Windows. */
function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim()
}

export class WorkspaceStore {
  private file = join(app.getPath('userData'), 'workspaces.json')
  private items: Workspace[] = []

  async load(): Promise<void> {
    const raw = await readText(this.file)
    this.items = raw ? (JSON.parse(raw) as Workspace[]) : []
  }

  list(): Workspace[] {
    return this.items
  }

  private async save(): Promise<void> {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(this.items, null, 2), 'utf8')
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

  async create(input: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> {
    const req = { ...input, path: resolve(input.path) }
    if (req.vault.mode === 'existing') req.vault = { ...req.vault, path: resolve(req.vault.path) }
    if (!(await isDir(req.path))) throw new Error(`Không tìm thấy thư mục: ${req.path}`)
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
      AUTO_MEMORY_PATH: autoMemoryDir(req.path)
    }

    // 1. Vault
    if (req.vault.mode === 'new') {
      if (await exists(vaultPath)) throw new Error(`Đã có thư mục "${vars.VAULT_DIR}". Hãy chọn "dùng vault có sẵn".`)
      const created = await copyVaultTemplate(vaultPath, vars)
      await fs.mkdir(join(vaultPath, '.obsidian'), { recursive: true })
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
    let isGit = await exists(join(req.path, '.git'))
    if (!isGit && req.gitInit) {
      await run('git', ['init', '-b', 'main'], { cwd: req.path })
      isGit = true
      report.push('Khởi tạo git (nhánh main)')
    }
    if (isGit) report.push(await this.ensureGitignore(req.path, vaultPath))

    // 3. CLAUDE.md + cache auto memory. Vault không có _INDEX.md (vault Obsidian khác mẫu, giữ nguyên)
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
    const file = join(projectDir, '.gitignore')
    const current = (await readText(file)) ?? ''
    const have = new Set(current.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '')))
    const wanted = [`${rel}/`, '.obsidian/'].filter((l) => !have.has(l))
    if (!wanted.length) return '.gitignore: đã loại trừ vault, giữ nguyên'
    const block = `${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}# Vault Obsidian (dữ liệu cá nhân, không lên git)\n${wanted.join('\n')}\n`
    await fs.appendFile(file, block, 'utf8')
    return `.gitignore: thêm ${wanted.join(', ')}`
  }

  private async ensureClaudeMd(projectDir: string, vars: TemplateVars, structured: boolean): Promise<string> {
    const file = join(projectDir, 'CLAUDE.md')
    const full = await readTemplate('CLAUDE.md', vars)
    const cut = full.search(/^## Memory/m)
    const section = structured ? full.slice(cut) : await readTemplate('CLAUDE.memory-plain.md', vars)
    if (await writeIfMissing(file, `${full.slice(0, cut)}${section}`)) return 'Tạo CLAUDE.md có quy tắc recall vault'
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
