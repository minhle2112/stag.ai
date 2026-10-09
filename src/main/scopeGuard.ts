import { DEFAULT_SCOPE, type Agent, type AgentKind, type ScopeLockSettings, type Task, type Workspace } from '@shared/types'
import { covers, entryHas, isUnlocked, lockHolder, parseScope, projectRel, scopeLocks, unlocked, type ScopeEntry, type ScopeLock } from '@shared/scope'
import type { Board, HookPayload } from './board'

/** Tool sửa file của Claude Code: đường dẫn ở `tool_input.file_path` (NotebookEdit: `notebook_path`). */
const CLAUDE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Tool chạy lệnh shell: Claude Code (Bash, PowerShell) và Codex (lệnh shell / exec_command báo là `Bash`). */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/** Codex chờ người dùng trả lời trong app tối đa chừng này (hook PreToolUse của Codex đợi lâu hơn chút, xem codex.ts). */
export const SCOPE_ASK_MS = 280_000

/**
 * File một lần gọi tool sắp sửa / vừa sửa, hoặc null nếu tool không sửa file. Codex: `apply_patch` mang cả
 * bản vá trong `tool_input.command` (các dòng `*** Add/Update/Delete File:` và `*** Move to:`).
 * Lệnh shell xem `shellCommand`.
 */
export function editTargets(p: HookPayload): string[] | null {
  const input = p.tool_input ?? {}
  if (p.tool_name && CLAUDE_EDIT_TOOLS.has(p.tool_name)) {
    const f = input.file_path ?? input.notebook_path
    return typeof f === 'string' && f ? [f] : []
  }
  if (p.tool_name === 'apply_patch') {
    const patch = typeof input.command === 'string' ? input.command : typeof input.patch === 'string' ? input.patch : ''
    const files: string[] = []
    for (const m of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) files.push(m[1].trim())
    return files
  }
  return null
}

/** Lệnh shell của lần gọi tool, hoặc null nếu không phải tool shell. */
export function shellCommand(p: HookPayload): string | null {
  if (!p.tool_name || !SHELL_TOOLS.has(p.tool_name)) return null
  const cmd = p.tool_input?.command
  return typeof cmd === 'string' && cmd.trim() ? cmd : null
}

/**
 * Lệnh có dấu hiệu ghi / xoá / chuyển file (PowerShell, cmd, sh, git…). Chỉ là đoán: dùng cùng điều kiện
 * "lệnh nhắc tới đường dẫn đang bị khoá" nên báo thừa (vd. đọc file khoá rồi ghi ra file khác) chỉ tốn một câu hỏi.
 */
export function looksLikeWrite(cmd: string): boolean {
  return (
    /(?:^|[^<>=!\-0-9&])>{1,2}(?![=&])/.test(cmd) ||
    /\b(?:Add-Content|Set-Content|Out-File|Clear-Content|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|Tee-Object|rm|rmdir|del|erase|mv|cp|move|copy|ren|rename|tee|truncate|touch|unlink|patch)\b/i.test(cmd) ||
    /\b(?:sed|perl)\b[^|;&\n]*\s-[a-z]*i/i.test(cmd) ||
    /\bgit\s+(?:checkout|restore|reset|rm|mv|apply|stash|clean|am)\b/i.test(cmd) ||
    /\b(?:WriteAll(?:Text|Lines|Bytes)|AppendAll(?:Text|Lines)|writeFile(?:Sync)?|appendFile(?:Sync)?|write_text|write_bytes)\b/i.test(cmd) ||
    /\bopen\([^)]*,\s*['"][wax]/i.test(cmd)
  )
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Các chữ trong lệnh (tách theo khoảng trắng, dấu ngoặc, toán tử shell) đổi được thành đường dẫn trong dự án. */
function cmdPaths(cmd: string, root: string, cwd: string): string[] {
  return cmd
    .split(/[\s'"`;|&()<>,]+/)
    .filter(Boolean)
    .map((t) => projectRel(t, root, cwd))
    .filter((rel): rel is string => rel !== null && rel !== '')
}

/** Mọi đường dẫn trong lệnh rơi vào mục `e` đều nằm trong chỗ không khoá (và có ít nhất một). */
function onlyUnlocked(cmd: string, e: ScopeEntry, free: ScopeEntry[], root: string, cwd: string): boolean {
  const inside = cmdPaths(cmd, root, cwd).filter((rel) => entryHas(e, rel))
  return inside.length > 0 && inside.every((rel) => isUnlocked(rel, free))
}

/** Lệnh nhắc tới mục khoá này (theo ranh giới đường dẫn, '/' hay '\' đều được). `cwdRel` = thư mục của phiên so với dự án. */
function mentions(cmd: string, e: ScopeEntry, root: string, cwd: string): boolean {
  if (e.glob) return cmdPaths(cmd, root, cwd).some((rel) => e.glob!.test(rel))
  if (!e.key) return false
  const cwdRel = projectRel(cwd, root) ?? ''
  const forms = [e.key]
  if (cwdRel && e.key.startsWith(`${cwdRel}/`)) forms.push(e.key.slice(cwdRel.length + 1))
  return forms.some((f) => {
    const body = f.split('/').map(escapeRe).join('[\\\\/]+')
    return new RegExp(`(?:^|[\\s'"\`=(:\\\\/])${body}(?=$|[\\s'"\`);|&,:\\\\/])`, 'i').test(cmd)
  })
}

/** Trả lời hook PreToolUse (cùng dạng cho Claude Code và Codex). */
export interface PreToolUseReply {
  hookSpecificOutput: { hookEventName: 'PreToolUse'; permissionDecision: 'allow' | 'ask' | 'deny'; permissionDecisionReason: string }
}

export const reply = (permissionDecision: 'allow' | 'ask' | 'deny', reason: string): PreToolUseReply => ({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason }
})

/**
 * Agent định sửa trong vùng khoá của việc đang mở của agent khác. `decision`: 'ask' = Claude Code hỏi trong terminal
 * (chưa biết kết quả), 'allowed' / 'denied' = người dùng trả lời trong app (Codex), 'blocked' = chặn luôn
 * (chế độ chặn), 'warned' = cho sửa, chỉ ghi nhận (chế độ chỉ cảnh báo; mỗi chỗ một lần mỗi phiên).
 */
export interface ScopeConflict {
  ws: Workspace
  agent: Agent
  /** Các chỗ đụng (file tương đối, hoặc mục khoá mà lệnh shell nhắc tới). */
  hits: string[]
  /** Việc đang mở giữ vùng khoá (chỗ đụng đầu tiên). */
  owner: Task
  entry: string
  command?: string
  decision: 'ask' | 'allowed' | 'denied' | 'blocked' | 'warned'
}

/** Cài đặt khoá phạm vi thực tế cho agent đang sửa (app → workspace → agent, đọc lại mỗi lần gọi tool). */
export type ScopeSettingsFor = (ws: Workspace, agent: Agent) => ScopeLockSettings

/** Một chỗ đụng: `grant` = khoá ghi nhớ khi người dùng cho qua, `label` = chữ hiện cho người dùng. */
interface Hit {
  grant: string
  label: string
  task: Task
  entry: string
}

/**
 * Khoá phạm vi (M7) ở hook: agent sắp sửa file trong vùng khoá của việc đang mở của agent khác → hỏi người
 * dùng. Claude Code: hook trả 'ask' (hộp xin quyền trong terminal, kèm lý do). Codex chưa hỗ trợ 'ask' → app
 * hỏi trong cửa sổ app, hook chờ câu trả lời rồi cho qua hoặc trả 'deny'.
 * Tool sửa file (Edit/Write…, apply_patch) biết chắc file; lệnh shell thì đoán: có dấu hiệu ghi và nhắc tới
 * đường dẫn đang bị khoá. Người dùng đã cho qua chỗ nào thì không hỏi lại chỗ đó trong phiên này.
 * Cài đặt (Settings S5, đọc lại mỗi lần gọi tool nên đổi là có tác dụng ngay): `mode` ask (như trên) / block (chặn
 * luôn, không hỏi) / warn (cho qua, chỉ ghi nhận) / off (không xét); `guessShell` tắt = bỏ qua lệnh shell;
 * `exempt` = mẫu đường dẫn không bao giờ khoá (cộng vault / .git / .sessions / .stag).
 */
export class ScopeGuard {
  /** agentId → chỗ người dùng đã cho qua trong phiên hiện tại (file tương đối chữ thường, hoặc `sh:<mục khoá>`). */
  private grants = new Map<string, Set<string>>()
  /** agentId → chỗ đã báo ở chế độ chỉ cảnh báo trong phiên này (báo mỗi chỗ một lần, không tính là cho qua). */
  private warned = new Map<string, Set<string>>()

  /** Báo mỗi lần đụng vùng khoá (hỏi / chặn / chỉ cảnh báo) (plugin: sự kiện scope.conflict). */
  onConflict?: (c: ScopeConflict) => void

  constructor(
    private board: Board,
    private settingsFor: ScopeSettingsFor = () => DEFAULT_SCOPE
  ) {}

  async preToolUse(ws: Workspace, agent: Agent, kind: AgentKind, p: HookPayload): Promise<PreToolUseReply | undefined> {
    const cfg = this.settingsFor(ws, agent)
    if (cfg.mode === 'off') return undefined
    const cmd = cfg.guessShell ? shellCommand(p) : null
    const files = editTargets(p)
    if (!files?.length && !cmd) return undefined
    // Chặn thì chặn cả chỗ đã cho qua trước đó (khi còn ở chế độ hỏi).
    let hits = await this.hits(ws, agent, p, cfg)
    if (cfg.mode !== 'block') hits = hits.filter((h) => !this.grants.get(agent.id)?.has(h.grant))
    if (cfg.mode === 'warn') hits = hits.filter((h) => !this.warned.get(agent.id)?.has(h.grant))
    if (!hits.length) return undefined
    const [first] = hits
    const what = hits.length > 1 ? `${first.label} (+${hits.length - 1} chỗ khác)` : first.label
    const shortCmd = cmd && (cmd.length > 160 ? `${cmd.slice(0, 157)}…` : cmd)
    const conflict = (decision: ScopeConflict['decision']): void => {
      try {
        this.onConflict?.({ ws, agent, hits: hits.map((h) => h.label), owner: first.task, entry: first.entry, command: shortCmd ?? undefined, decision })
      } catch (e) {
        console.error('[scope]', e)
      }
    }
    const target = hits.map((h) => h.label).join(', ')
    const owner = `agent "${first.task.agentName}"'s open task "${first.task.title}"`
    if (cfg.mode === 'warn') {
      for (const h of hits) mark(this.warned, agent.id, h.grant)
      conflict('warned')
      return undefined
    }
    if (cfg.mode === 'block') {
      conflict('blocked')
      return reply(
        'deny',
        `stag.ai scope lock: you may not ${cmd ? `run this command, which may modify ${target}` : `edit ${target}`} — it is in the scope of ${owner}, and stag.ai is set to block edits in another agent's scope. Do not change it in any other way. Tell the user, or check task_list and agree on who edits what (the other agent can narrow its scope with task_update or finish its task).`
      )
    }
    if (kind !== 'codex') {
      conflict('ask')
      const action = cmd ? `Lệnh này có thể sửa ${what}` : `${what}`
      return reply(
        'ask',
        `stag.ai: ${action} — thuộc phạm vi việc "${first.task.title}" của agent ${first.task.agentName} (đang mở, mục "${first.entry}"). Cho ${agent.name} ${cmd ? 'chạy' : 'sửa'}?`
      )
    }
    const allow = await this.board.askScope(
      ws,
      agent,
      { file: what, command: shortCmd ?? undefined, holder: { agentName: first.task.agentName, title: first.task.title, entry: first.entry } },
      SCOPE_ASK_MS
    )
    conflict(allow ? 'allowed' : 'denied')
    if (allow) {
      for (const h of hits) mark(this.grants, agent.id, h.grant)
      return undefined
    }
    return reply(
      'deny',
      `stag.ai scope lock: the user did not allow you to ${cmd ? `run this command, which may modify ${target}` : `edit ${target}`} — it is in the scope of ${owner}. Do not change it in any other way. Tell the user, or check task_list and agree on who edits what.`
    )
  }

  /** Tool đã chạy xong: ghi file vừa sửa vào việc đang mở của agent (thành vùng khoá), ghi nhớ chỗ người dùng đã cho qua. */
  async postToolUse(ws: Workspace, agent: Agent, p: HookPayload): Promise<void> {
    const cfg = this.settingsFor(ws, agent)
    const files = editTargets(p)
    const cmd = cfg.guessShell ? shellCommand(p) : null
    if (!files?.length && !cmd) return
    // Hook PreToolUse đã hỏi (Claude Code) mà tool vẫn chạy → người dùng đồng ý.
    if (cfg.mode === 'ask') for (const h of await this.hits(ws, agent, p, cfg)) mark(this.grants, agent.id, h.grant)
    // File đã sửa vẫn ghi vào việc ở mọi chế độ (cả khi tắt): bật lại khoá thì vùng khoá đã đủ.
    if (!files?.length) return
    const free = unlocked(ws.path, ws.vaultPath, cfg.exempt)
    const own = await this.board.openTask(ws, agent.id)
    if (!own) return
    const declared = parseScope(own.scope, ws.path)
    const record: string[] = []
    for (const f of files) {
      const rel = projectRel(f, ws.path, p.cwd ?? ws.path)
      if (!rel || isUnlocked(rel, free)) continue
      if (!declared.some((e) => entryHas(e, rel))) record.push(displayRel(f, ws.path, p.cwd))
    }
    if (record.length) await this.board.touch(ws, agent.id, record)
  }

  /** Phiên của agent đóng: quên quyền đã cho, huỷ câu hỏi đang chờ. */
  endSession(agentId: string): void {
    this.grants.delete(agentId)
    this.warned.delete(agentId)
    this.board.cancelScopeAsks(agentId)
  }

  /** Các chỗ lần gọi tool này đụng vào vùng khoá của agent khác. */
  private async hits(ws: Workspace, agent: Agent, p: HookPayload, cfg: ScopeLockSettings): Promise<Hit[]> {
    const { tasks } = await this.board.snapshot(ws)
    const locks = scopeLocks(tasks, ws.path).filter((l) => l.task.agentId !== agent.id)
    if (!locks.length) return []
    const free = unlocked(ws.path, ws.vaultPath, cfg.exempt)
    const cwd = p.cwd ?? ws.path
    const hits: Hit[] = []
    for (const f of editTargets(p) ?? []) {
      const rel = projectRel(f, ws.path, cwd)
      if (rel === null) continue
      const h = lockHolder(locks, agent.id, rel, free)
      if (h) hits.push({ grant: rel, label: displayRel(f, ws.path, cwd), task: h.lock.task, entry: h.entry.label })
    }
    const cmd = cfg.guessShell ? shellCommand(p) : null
    if (cmd && looksLikeWrite(cmd)) hits.push(...shellHits(cmd, locks, free, ws.path, cwd))
    return hits
  }
}

function mark(map: Map<string, Set<string>>, agentId: string, key: string): void {
  const set = map.get(agentId) ?? new Set<string>()
  set.add(key)
  map.set(agentId, set)
}

/**
 * Mục khoá mà lệnh shell nhắc tới (bỏ mục "cả dự án" và mục nằm hẳn trong chỗ không khoá: lệnh nào cũng đụng thì
 * hỏi hoài). Mẫu miễn khoá chỉ phủ một phần mục (vd. `**\/*.md` trong `src/`): bỏ qua khi mọi đường dẫn trong lệnh
 * rơi vào mục đều được miễn.
 */
function shellHits(cmd: string, locks: ScopeLock[], free: ScopeEntry[], root: string, cwd: string): Hit[] {
  const hits: Hit[] = []
  for (const lock of locks) {
    for (const e of lock.entries) {
      if ((!e.key && !e.glob) || free.some((s) => covers(s, e))) continue
      if (!mentions(cmd, e, root, cwd) || onlyUnlocked(cmd, e, free, root, cwd)) continue
      if (!hits.some((h) => h.grant === `sh:${e.key}`)) hits.push({ grant: `sh:${e.key}`, label: e.label, task: lock.task, entry: e.label })
    }
  }
  return hits
}

/** Đường dẫn tương đối giữ nguyên hoa thường để hiện cho người dùng. */
function displayRel(file: string, root: string, cwd?: string): string {
  const rel = projectRel(file, root, cwd ?? root)
  if (rel === null) return file
  const p = file.replace(/\\/g, '/')
  return p.length >= rel.length && p.slice(-rel.length).toLowerCase() === rel ? p.slice(-rel.length) : rel
}
