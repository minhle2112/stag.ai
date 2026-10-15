// Project trong workspace (mỗi project một đội agent). Dùng chung main (quyết định cuối) và renderer (báo lỗi khi gõ).
// "Chung" = thư mục gốc của workspace, chỗ của agent không thuộc project nào (Agent.projectId vắng).

import { LOCALES, t, translate } from './i18n'
import type { Agent, Project, ProjectTeamMember, Workspace } from './types'

/** Số màu nhận diện project (CSS `--p1` … `--p4` trong styles.css), xoay vòng. */
export const PROJECT_COLORS = 4

/** Mã chỗ của tab Chung (canvas, bộ lọc). Project dùng id của nó. */
export const CHUNG = 'chung'

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const NAME_MAX = 60

/** Tên project thành chữ thường không dấu, nối bằng '-' (tên thư mục tự đặt). */
export function projectSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd') // i18n-ignore: bỏ dấu chữ đ khi đặt tên thư mục
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Lý do tên project không dùng được (tên cũng là tên thư mục note trong vault), null = được. Giao diện: theo ngôn ngữ
 * đang chọn; `forAgent` (main: tool project_create / project_update của agent) → tiếng Anh.
 */
export function projectNameProblem(name: string, projects: readonly Project[], exceptId?: string, forAgent = false): string | null {
  const n = name.trim()
  if (!n) return forAgent ? 'The project needs a name' : t('projects.name.required')
  if (INVALID_CHARS.test(n)) return forAgent ? 'The name cannot contain < > : " / \\ | ? *' : t('projects.name.invalidChars')
  if (n.endsWith('.')) return forAgent ? 'The name cannot end with a dot' : t('projects.name.trailingDot')
  if (RESERVED.test(n)) return forAgent ? `"${n}" is a reserved Windows name` : t('projects.name.reserved', { name: n })
  if (n.length > NAME_MAX) return forAgent ? `The name is longer than ${NAME_MAX} characters` : t('projects.name.tooLong', { max: NAME_MAX })
  // Tên thư mục gốc ở mọi ngôn ngữ giao diện ("Chung" / "Shared"): project trùng tên sẽ trông như tab gốc.
  if (LOCALES.some((l) => translate(l, 'common.name.rootProject').toLowerCase() === n.toLowerCase()))
    return forAgent ? `"${n}" is the name of the workspace root; pick another name` : t('projects.name.chung', { name: n })
  if (projects.some((p) => p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase()))
    return forAgent ? 'A project with this name already exists' : t('projects.name.taken')
  return null
}

/**
 * Chữ người dùng gõ cho thư mục code → đường dẫn tương đối chuẩn ('/' , bỏ '/' đầu cuối, gộp '//'). null = không hợp lệ
 * (trống, tuyệt đối, có `..` / `.`, ký tự cấm, thư mục dữ liệu của app).
 */
export function normFolder(input: string): string | null {
  const t = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '')
  if (!t || /^[a-z]:/i.test(t)) return null
  const segs = t.split('/')
  for (const s of segs) {
    if (!s.trim() || s === '.' || s === '..' || /[<>:"|?*\x00-\x1f]/.test(s) || s.endsWith('.') || RESERVED.test(s)) return null
  }
  if (['.git', '.stag', '.sessions', 'node_modules'].includes(segs[0].toLowerCase())) return null
  return segs.join('/')
}

const lower = (s: string): string => s.toLowerCase()

/**
 * Hai project không được trùng hay lồng thư mục. Trả lời lỗi hoặc null. `folder` đã chuẩn hoá. Giao diện: theo ngôn ngữ
 * đang chọn; `forAgent` → tiếng Anh.
 */
export function folderClash(projects: readonly Project[], folder: string, exceptId?: string, forAgent = false): string | null {
  const f = lower(folder)
  for (const p of projects) {
    if (p.id === exceptId) continue
    const o = lower(p.folder)
    const x = { name: p.name, folder: p.folder }
    if (o === f) return forAgent ? `It is already the folder of project "${p.name}".` : t('projects.folder.same', x)
    if (f.startsWith(`${o}/`)) return forAgent ? `It is inside the folder of "${p.name}" (${p.folder}). Projects cannot be nested.` : t('projects.folder.inside', x)
    if (o.startsWith(`${f}/`)) return forAgent ? `It contains the folder of "${p.name}" (${p.folder}). Projects cannot be nested.` : t('projects.folder.contains', x)
  }
  return null
}

/** Tên thư mục tự đặt theo tên project: slug, trùng thư mục có sẵn / của project khác thì thêm -2, -3… */
export function autoFolder(name: string, taken: (folder: string) => boolean): string {
  const base = projectSlug(name) || 'new-project'
  let x = base
  for (let i = 2; taken(x); i++) x = `${base}-${i}`
  return x
}

/** Note của project trong vault (tương đối so với vault). */
export function projectNoteRel(name: string): string {
  const n = name.trim()
  return `70 Projects/${n}/${n}.md`
}

export function projectOf(ws: Pick<Workspace, 'projects'> | undefined, agent: Pick<Agent, 'projectId'>): Project | undefined {
  return agent.projectId ? ws?.projects?.find((p) => p.id === agent.projectId) : undefined
}

/** Thư mục làm việc của agent, tương đối so với gốc workspace ('' = gốc, tức Chung hoặc project không còn). */
export function agentFolder(ws: Pick<Workspace, 'projects'> | undefined, agent: Pick<Agent, 'projectId'>): string {
  return projectOf(ws, agent)?.folder ?? ''
}

/** Chỗ của agent: id project, hoặc CHUNG. Project đã bị xoá → CHUNG. */
export function placeOf(ws: Pick<Workspace, 'projects'> | undefined, agent: Pick<Agent, 'projectId'>): string {
  return projectOf(ws, agent)?.id ?? CHUNG
}

/** Ghép thư mục gốc (tuyệt đối) với đường dẫn tương đối '/' theo kiểu của gốc (Windows giữ '\'). */
export function joinRoot(root: string, rel: string): string {
  if (!rel) return root
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

/** Khoá cặp project cho "Luôn cho giữa 2 project này" (không phân biệt chiều). */
export function projectPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Gửi việc từ agent `from` sang agent `to` có cần hỏi người dùng không: chỉ khi hai agent ở hai project KHÁC nhau
 * (từ Chung đi đâu cũng tự do; vào Chung cũng tự do) và cặp đó chưa được "Luôn cho".
 */
export function crossProjectAsk(ws: Pick<Workspace, 'projects' | 'projectLinks'> | undefined, from: Pick<Agent, 'projectId'>, to: Pick<Agent, 'projectId'>): { from: Project; to: Project } | null {
  const a = projectOf(ws, from)
  const b = projectOf(ws, to)
  if (!a || !b || a.id === b.id) return null
  if (ws?.projectLinks?.includes(projectPair(a.id, b.id))) return null
  return { from: a, to: b }
}

/** Tên agent không trùng trong cả workspace: thêm " 2", " 3"… */
export function uniqueAgentName(name: string, taken: (n: string) => boolean): string {
  let x = name
  for (let i = 2; taken(x); i++) x = `${name} ${i}`
  return x
}

export type TeamPreset = 'none' | 'solo' | 'duo' | 'team' | 'copy'

/** Đội mẫu khi tạo project: tên kiểu `Dev · <project>` (tên agent không trùng trong workspace vì MCP gọi theo tên). */
export function teamPreset(preset: Exclude<TeamPreset, 'copy'>, projectName: string): ProjectTeamMember[] {
  const sfx = projectName.trim() ? ` · ${projectName.trim()}` : ''
  const roles = { none: [], solo: ['Dev'], duo: ['Dev', 'Tester'], team: ['Lead', 'Dev', 'Tester'] }[preset]
  return roles.map((role) => ({ role, name: `${role}${sfx}`, kind: 'claude' as const }))
}

/** "Chép đội": agent (không phải terminal) của project nguồn → đội mới cùng vai trò, đặt tên theo project mới. */
export function copyTeam(source: ReadonlyArray<Pick<Agent, 'id' | 'name' | 'role' | 'kind'>>, projectName: string): ProjectTeamMember[] {
  const sfx = projectName.trim() ? ` · ${projectName.trim()}` : ''
  return source
    .filter((a) => a.kind === 'claude' || a.kind === 'codex' || a.kind === undefined)
    .map((a) => ({ role: a.role, name: `${a.role || a.name.split(' · ')[0]}${sfx}`, kind: (a.kind ?? 'claude') as 'claude' | 'codex', cloneOf: a.id }))
}

/** Tên note của project (`70 Projects/<tên>/<tên>.md` → `<tên>`), dùng làm thẻ `project: [[…]]` trong nhật ký. */
export function projectNoteName(p: Pick<Project, 'note'>): string {
  return p.note.replace(/^.*\//, '').replace(/\.md$/i, '')
}

/**
 * Lọc nhật ký việc (`40 Log/<ngày>.md`) theo chỗ: chỉ giữ dòng việc `- [x] …` của chỗ đó; dòng khác giữ nguyên. Dòng có
 * `· project: [[X]]` thuộc project có note X; không có thẻ, hoặc project đã bị xoá → Chung. `place` = id project / CHUNG.
 */
export function filterWorkLog(text: string, place: string, projects: readonly Project[]): string {
  const byNote = new Map(projects.map((p) => [projectNoteName(p).toLowerCase(), p.id]))
  return text
    .split(/\r?\n/)
    .filter((line) => {
      if (!/^\s*- \[x\] /.test(line)) return true
      const m = / · project: \[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(line)
      const owner = (m && byNote.get(m[1].trim().toLowerCase())) || CHUNG
      return owner === place
    })
    .join('\n')
}

/** Thư mục gốc có `package.json` dưới `apps/*` / `packages/*`: gợi ý tách monorepo thành project. */
export function monorepoCandidates(folders: ReadonlyArray<{ path: string; pkg: boolean }>): string[] {
  return folders.filter((f) => f.pkg && /^(apps|packages)\/[^/]+$/i.test(f.path)).map((f) => f.path)
}

/**
 * Mục PROJECT trong luật phiên: agent của project biết tên, thư mục, note vault; agent ở Chung biết các project đang có.
 * Workspace chưa có project → trống (luật phiên như cũ).
 */
export function projectSection(ws: Pick<Workspace, 'projects' | 'path' | 'vaultPath'>, agent: Pick<Agent, 'projectId'>, cwd: string): string {
  const list = ws.projects ?? []
  if (!list.length) return ''
  const p = projectOf(ws, agent)
  const others = list.filter((x) => x.id !== p?.id).map((x) => `"${x.name}" (${x.folder})`)
  const note = (n: string): string => joinRoot(ws.vaultPath, n)
  if (p)
    return [
      'PROJECT',
      `- You belong to project "${p.name}" of this workspace and work in its code folder ${cwd} (workspace root: ${ws.path}). Scope paths in task_start / task_update are relative to ${cwd}.`,
      `- Project note in the vault: ${note(p.note)} (goal, team, decisions). Read it at the start and keep it current.`,
      p.goal ? `- Goal: ${p.goal}` : '',
      others.length ? `- Other projects in this workspace (other teams): ${others.join(', ')}. Sending work to an agent of another project asks the user first.` : ''
    ]
      .filter(Boolean)
      .join('\n') + '\n\n'
  // Cuối mục có một dòng trống: template ghép thẳng trước mục kế tiếp ("{{PROJECT_SECTION}}TASK LIST").
  return `PROJECTS\n- This workspace has projects, each with its own agent team: ${others.join(', ')}. You are at the workspace root ("Chung") and may work on and assign work to any of them.\n\n`
}
