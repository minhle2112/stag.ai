import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import { autoFolder, folderClash, joinRoot, normFolder, PROJECT_COLORS, projectNameProblem, projectNoteRel, projectPair } from '@shared/projects'
import type { Agent, CreateProjectRequest, CreateProjectResult, Project, ProjectDeleteInfo, ProjectFolderChoice, Workspace, WorkspaceFolder } from '@shared/types'
import type { AgentService } from './agents'
import { exists, isDir, today, writeIfMissing } from './fsutil'
import type { SettingsStore } from './settings'
import type { WorkspaceStore } from './workspace'

const run = promisify(execFile)

/** Thư mục không bao giờ là thư mục code của project (dữ liệu app, git, thư viện). */
const SKIP_DIRS = new Set(['.git', '.stag', '.sessions', 'node_modules', '.claude', '.codex', '.vscode', '.idea'])

/** Đếm file tối đa chừng này (hộp xoá project chỉ cần biết "khoảng bao nhiêu"). */
const COUNT_LIMIT = 20_000

/**
 * Project trong workspace (mỗi project một đội agent, xem shared/projects.ts): tạo (thư mục code + note vault + đội),
 * đổi tên / mục tiêu, xoá (xoá luôn agent của nó; tuỳ chọn chuyển thư mục code vào Thùng rác).
 */
export class ProjectService {
  constructor(
    private workspaces: WorkspaceStore,
    private agents: AgentService,
    private settings: SettingsStore
  ) {
    // Tool project_* của Agent API (máy chủ MCP của AgentService) dùng chung logic tạo / đổi project này.
    agents.attachProjects?.(this)
  }

  private ws(id: string): Workspace {
    const w = this.workspaces.get(id)
    if (!w) throw new Error('Workspace không tồn tại')
    return w
  }

  /** Thư mục ở gốc workspace + `apps/*`, `packages/*` (gợi ý monorepo), bỏ vault và thư mục của app. */
  async folders(workspaceId: string): Promise<WorkspaceFolder[]> {
    const ws = this.ws(workspaceId)
    const vault = relative(ws.path, ws.vaultPath).replace(/\\/g, '/').toLowerCase()
    const out: WorkspaceFolder[] = []
    const list = async (rel: string): Promise<string[]> => {
      const entries = await fs.readdir(joinRoot(ws.path, rel), { withFileTypes: true }).catch(() => [])
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase()))
        .map((e) => (rel ? `${rel}/${e.name}` : e.name))
        .filter((p) => p.toLowerCase() !== vault)
        .sort((a, b) => a.localeCompare(b))
    }
    for (const top of await list('')) {
      out.push({ path: top, pkg: await exists(join(joinRoot(ws.path, top), 'package.json')) })
      if (/^(apps|packages)$/i.test(top))
        for (const sub of await list(top)) out.push({ path: sub, pkg: await exists(join(joinRoot(ws.path, sub), 'package.json')) })
    }
    return out
  }

  /**
   * Thư mục agent đưa cho tool project_create → lựa chọn như ở hộp tạo project: trống = thư mục mới đặt theo tên,
   * thư mục đã có = dùng thư mục có sẵn, chưa có = tạo mới với tên đó.
   */
  async folderChoice(workspaceId: string, raw: string | undefined): Promise<ProjectFolderChoice> {
    const ws = this.ws(workspaceId)
    const typed = (raw ?? '').trim()
    if (!typed) return { mode: 'new', name: '' }
    const f = normFolder(typed)
    if (!f) throw new Error(`Invalid folder "${typed}": ${folderReason(typed, ws.path)}`)
    const full = joinRoot(ws.path, f)
    if (await isDir(full)) return { mode: 'existing', path: f }
    if (await exists(full)) throw new Error(`Invalid folder "${typed}": ${f} is a file, not a folder. Pick another folder name.`)
    return { mode: 'new', name: f }
  }

  /**
   * Kiểm tra yêu cầu tạo project (tên, đội, thư mục) và chọn thư mục code, chưa ghi gì: dùng cho create và cho thẻ
   * hỏi người dùng của tool project_create. Lỗi (tiếng Việt) thì ném ra.
   */
  async plan(req: CreateProjectRequest): Promise<{ name: string; folder: string; created: boolean; note: string }> {
    const ws = this.ws(req.workspaceId)
    const projects = ws.projects ?? []
    const name = req.name.trim()
    const same = projects.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (same) throw new Error(`Đã có project tên "${same.name}"`)
    const nameProblem = projectNameProblem(name, projects)
    if (nameProblem) throw new Error(nameProblem)

    // Đội: tên hợp lệ, không trùng agent nào trong workspace, không trùng nhau.
    const existing = this.agents.snapshot(ws.id).agents
    const seen: string[] = []
    for (const m of req.team) {
      const n = m.name.trim()
      const problem = agentNameProblem(n)
      if (problem) throw new Error(`${n || '(trống)'}: ${problem}`)
      if (existing.some((a) => sameAgentName(a.name, n)) || seen.some((x) => sameAgentName(x, n))) throw new Error(`Đã có agent tên "${n}" trong workspace`)
      seen.push(n)
    }

    // Thư mục code.
    let folder: string
    const created = req.folder.mode === 'new'
    if (req.folder.mode === 'new') {
      const typed = req.folder.name.trim()
      if (typed) {
        const f = normFolder(typed)
        if (!f) throw new Error('Tên thư mục không hợp lệ (đường dẫn tương đối trong workspace, không có .. hay ký tự cấm).')
        if (await exists(joinRoot(ws.path, f))) throw new Error(`Đã có thư mục ${f}. Đặt tên khác, hoặc chọn "Dùng thư mục có sẵn".`)
        folder = f
      } else {
        const names = new Set((await fs.readdir(ws.path).catch(() => [] as string[])).map((n) => n.toLowerCase()))
        folder = autoFolder(name, (f) => names.has(f.toLowerCase()) || projects.some((p) => p.folder.toLowerCase() === f.toLowerCase()))
      }
    } else {
      const f = normFolder(req.folder.path)
      if (!f) throw new Error('Thư mục không hợp lệ.')
      if (!(await isDir(joinRoot(ws.path, f)))) throw new Error(`Không thấy thư mục ${f} trong workspace.`)
      folder = f
    }
    const clash = folderClash(projects, folder)
    if (clash) throw new Error(clash)
    const vault = relative(ws.path, ws.vaultPath).replace(/\\/g, '/').toLowerCase()
    const f = folder.toLowerCase()
    if (vault && !vault.startsWith('..') && (vault === f || vault.startsWith(`${f}/`) || f.startsWith(`${vault}/`)))
      throw new Error('Thư mục code không được trùng hay chứa vault.')
    return { name, folder, created, note: uniqueNote(name, projects) }
  }

  async create(req: CreateProjectRequest): Promise<CreateProjectResult> {
    const { name, folder, created, note } = await this.plan(req)
    const ws = this.ws(req.workspaceId)
    const projects = ws.projects ?? []
    if (created) await fs.mkdir(joinRoot(ws.path, folder), { recursive: true })

    const used = new Set(projects.map((p) => p.color))
    const color = [...Array(PROJECT_COLORS).keys()].find((c) => !used.has(c)) ?? projects.length % PROJECT_COLORS
    const project: Project = { id: randomUUID(), name, folder, goal: req.goal.trim(), color, note, createdAt: new Date().toISOString() }
    const updated = await this.workspaces.update(ws.id, (w) => ({ ...w, projects: [...(w.projects ?? []), project], projectHintOff: true }))

    // Đội.
    const agents: Agent[] = []
    for (const m of req.team) {
      const agent = m.cloneOf
        ? await this.agents.clone(m.cloneOf, project.id, m.name.trim())
        : await this.agents.create({
            workspaceId: ws.id,
            kind: m.kind,
            name: m.name.trim(),
            role: m.role.trim(),
            permissionMode: this.settings.get().app.adapters[m.kind].defaultPermission,
            projectId: project.id,
            ...(m.model ? { model: m.model } : {})
          })
      agents.push(agent)
    }

    await this.writeNote(updated, project, agents).catch((e) => console.error('[projects] note', e))
    return { workspace: updated, project, agents, createdFolder: created }
  }

  /** Note `70 Projects/<tên>/<tên>.md` (chỉ tạo khi chưa có). */
  private async writeNote(ws: Workspace, p: Project, team: Agent[]): Promise<void> {
    const structured = await exists(join(ws.vaultPath, '_INDEX.md'))
    const lines = [
      '---',
      'type: project',
      `folder: ${p.folder}`,
      `created: ${today()}`,
      '---',
      `# ${p.name}`,
      '',
      ...(structured ? ['Back to: [[_INDEX]]', ''] : []),
      '## Goal',
      p.goal || '_(not set yet)_',
      '',
      '## Code folder',
      `\`${p.folder}\` (${joinRoot(ws.path, p.folder)}). The project's agents open their sessions here; scope paths are relative to it.`,
      '',
      '## Team',
      ...(team.length ? team.map((a) => `- [[${a.name}]]${a.role ? ` (${a.role})` : ''}`) : ['_(no agents yet)_']),
      '',
      '## Notes',
      ''
    ]
    await writeIfMissing(join(ws.vaultPath, ...p.note.split('/')), lines.join('\n'))
  }

  /** Đổi tên / mục tiêu (thư mục code không đổi: agent đang chạy giữ thư mục của phiên). */
  async update(workspaceId: string, projectId: string, patch: { name?: string; goal?: string }): Promise<Workspace> {
    const ws = this.ws(workspaceId)
    const projects = ws.projects ?? []
    if (!projects.some((p) => p.id === projectId)) throw new Error('Project không còn')
    if (patch.name !== undefined) {
      const problem = projectNameProblem(patch.name, projects, projectId)
      if (problem) throw new Error(problem)
    }
    return this.workspaces.update(ws.id, (w) => ({
      ...w,
      projects: (w.projects ?? []).map((p) =>
        p.id === projectId ? { ...p, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}) } : p
      )
    }))
  }

  /** Số file và số file chưa commit của thư mục code (hộp xoá project). */
  async deleteInfo(workspaceId: string, projectId: string): Promise<ProjectDeleteInfo> {
    const ws = this.ws(workspaceId)
    const p = ws.projects?.find((x) => x.id === projectId)
    if (!p) throw new Error('Project không còn')
    const dir = joinRoot(ws.path, p.folder)
    if (!(await isDir(dir))) return { files: 0, dirty: null, exists: false }
    let files = 0
    let more = false
    const walk = async (d: string): Promise<void> => {
      if (more) return
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (files >= COUNT_LIMIT) {
          more = true
          return
        }
        if (e.isDirectory()) await walk(join(d, e.name))
        else files++
      }
    }
    await walk(dir)
    let dirty: number | null = null
    try {
      // -uall: đếm từng file chưa track (không thì cả thư mục mới chỉ là một dòng).
      const { stdout } = await run('git', ['status', '--porcelain', '-uall', '--', '.'], { cwd: dir, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
      dirty = stdout.split('\n').filter((l) => l.trim()).length
    } catch {
      dirty = null
    }
    return { files, ...(more ? { more } : {}), dirty, exists: true }
  }

  /**
   * Xoá project: dừng và xoá mọi agent của nó (note agent và note project giữ nguyên), bỏ canvas của nó; `deleteFolder`
   * → thư mục code vào Thùng rác của Windows. Sản phẩm / nhật ký cũ gắn project này hiện là "Chung".
   */
  async remove(workspaceId: string, projectId: string, deleteFolder: boolean): Promise<Workspace> {
    const ws = this.ws(workspaceId)
    const p = ws.projects?.find((x) => x.id === projectId)
    if (!p) throw new Error('Project không còn')
    // Thư mục trước: không chuyển được vào Thùng rác (file đang mở…) thì chưa xoá gì.
    if (deleteFolder) {
      const dir = joinRoot(ws.path, p.folder)
      if (await exists(dir)) {
        try {
          await shell.trashItem(dir)
        } catch (e) {
          throw new Error(`Không chuyển được thư mục ${dir} vào Thùng rác: ${(e as Error).message}. Chưa xoá gì cả (đóng chương trình đang mở file trong đó rồi thử lại).`)
        }
      }
    }
    const team = this.agents.projectAgents(ws.id, p.id)
    for (const a of team) await this.agents.remove(a.id, { keepNote: true })
    await this.settings.forget(
      'agent',
      team.map((a) => a.id)
    )
    const next = await this.workspaces.update(ws.id, (w) => ({
      ...w,
      projects: (w.projects ?? []).filter((x) => x.id !== p.id),
      projectLinks: (w.projectLinks ?? []).filter((k) => !k.split('|').includes(p.id))
    }))
    // Sau khi project đã ra khỏi workspace: lần lưu canvas muộn của tab này bị saveLayout bỏ qua, không ghi lại khoá.
    await this.agents.forgetProject(ws.id, p.id)
    return next
  }

  /** Thẻ gợi ý tách monorepo: "Để sau" = không hiện lại ở workspace này. */
  async hideHint(workspaceId: string): Promise<Workspace> {
    return this.workspaces.update(this.ws(workspaceId).id, (w) => ({ ...w, projectHintOff: true }))
  }

  /** "Luôn cho giữa 2 project này" (thẻ hỏi gửi việc khác project). */
  async allowLink(workspaceId: string, a: string, b: string): Promise<Workspace> {
    const key = projectPair(a, b)
    return this.workspaces.update(this.ws(workspaceId).id, (w) => ({ ...w, projectLinks: [...new Set([...(w.projectLinks ?? []), key])] }))
  }
}

/**
 * Note của project mới. Đổi tên project giữ nguyên note cũ, nên tên mới có thể trùng note của một project đang có
 * (vd. "shop-web" đổi thành "shop", rồi tạo "shop-web" mới) → thêm " 2", " 3"… để hai project không dùng chung note.
 * Note của project đã xoá thì dùng lại (chủ ý: note giữ nguyên khi xoá).
 */
export function uniqueNote(name: string, projects: readonly Project[]): string {
  const used = new Set(projects.map((p) => p.note.toLowerCase()))
  const n = name.trim()
  let note = projectNoteRel(n)
  for (let i = 2; used.has(note.toLowerCase()); i++) note = projectNoteRel(`${n} ${i}`)
  return note
}

/** Vì sao `normFolder` từ chối thư mục agent đưa (tool project_create), bằng tiếng Anh cho agent. */
export function folderReason(typed: string, root: string): string {
  const t = typed.trim().replace(/\\/g, '/')
  const segs = t.split('/').filter(Boolean)
  if (/^[a-z]:/i.test(t) || t.startsWith('/')) return `use a path relative to the workspace root (${root}), not an absolute path.`
  if (segs.some((s) => s === '.' || s === '..')) return `use a path inside the workspace root (${root}), without "." or "..".`
  if (['.git', '.stag', '.sessions', 'node_modules'].includes((segs[0] ?? '').toLowerCase()))
    return `"${segs[0]}" is used by git / stag.ai / npm and cannot be a code folder.`
  if (segs.some((s) => /[<>:"|?*\x00-\x1f]/.test(s))) return 'folder names cannot contain < > : " | ? * or control characters.'
  if (segs.some((s) => s.endsWith('.'))) return 'folder names cannot end with a dot.'
  const reserved = segs.find((s) => /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s))
  if (reserved) return `"${reserved}" is a reserved Windows name.`
  return `use a path relative to the workspace root (${root}).`
}
