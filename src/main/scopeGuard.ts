import { DEFAULT_SCOPE, type Agent, type AgentKind, type ScopeLockSettings, type Task, type Workspace } from '@shared/types'
import { covers, entryHas, isUnlocked, lockHolder, parseScope, projectRel, scopeLocks, taskBase, unlocked, type ScopeEntry, type ScopeLock } from '@shared/scope'
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

/**
 * Bỏ thân heredoc chỉ là dữ liệu (`cat > note.md <<'EOF' … EOF`, `tee`): chữ trong đó (vd. nội dung một note nhắc tới
 * file đang bị khoá) không phải đường dẫn lệnh sẽ sửa. Heredoc đưa vào trình thông dịch (bash, node, python…) hoặc đi
 * tiếp qua ống `|` thì giữ: đó là code.
 */
export function withoutDataHeredocs(cmd: string): string {
  const lines = cmd.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    const m = /<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(line)
    if (!m) continue
    const segment = line.slice(0, m.index).split(/&&|\|\||[;|]/).pop()!.trim()
    const word = (segment.split(/\s+/)[0] ?? '').replace(/^.*[\\/]/, '')
    if (!/^(?:cat|tee)(?:\.exe)?$/i.test(word) || line.slice(m.index + m[0].length).includes('|')) continue
    const end = (l: string): string => (m[1] ? l.replace(/^\t+/, '') : l).replace(/\r$/, '')
    let j = i + 1
    while (j < lines.length && end(lines[j]) !== m[3]) j++
    if (j < lines.length) out.push(lines[j])
    i = j
  }
  return out.join('\n')
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Thư mục làm việc mà các phần của lệnh có thể chạy trong đó: thư mục của phiên + mỗi lần `cd` / `pushd` /
 * `Set-Location` trong lệnh (`cd src && rm auth/x.ts` sửa `src/auth/x.ts`). Thà xét thừa còn hơn bỏ sót.
 */
export function shellCwds(cmd: string, cwd: string): string[] {
  const out = [cwd]
  let cur = cwd
  for (const m of cmd.matchAll(/(?:^|[;&|\n(]\s*)(?:cd|pushd|chdir|set-location|sl)\s+(?:-\w+\s+)?("[^"]+"|'[^']+'|[^\s;&|)]+)/gi)) {
    const target = m[1].replace(/^["']|["']$/g, '')
    if (target === '-' || target === '~') continue
    const abs = /^[a-z]:[\\/]/i.test(target) || /^[\\/]/.test(target)
    cur = abs ? target : `${cur.replace(/[\\/]+$/, '')}/${target}`
    out.push(cur)
  }
  return out
}

/** Các chữ trong lệnh (tách theo khoảng trắng, dấu ngoặc, toán tử shell) đổi được thành đường dẫn trong dự án. */
function cmdPaths(cmd: string, root: string, cwds: string[]): string[] {
  const tokens = cmd
    .split(/[\s'"`;|&()<>,]+/)
    .filter(Boolean)
  const out = new Set<string>()
  for (const cwd of cwds) for (const t of tokens) {
    const rel = projectRel(t, root, cwd)
    if (rel) out.add(rel)
  }
  return [...out]
}

/** Mọi đường dẫn trong lệnh rơi vào mục `e` đều nằm trong chỗ không khoá (và có ít nhất một). */
function onlyUnlocked(cmd: string, e: ScopeEntry, free: ScopeEntry[], root: string, cwds: string[]): boolean {
  const inside = cmdPaths(cmd, root, cwds).filter((rel) => entryHas(e, rel))
  return inside.length > 0 && inside.every((rel) => isUnlocked(rel, free))
}

/** Lệnh nhắc tới mục khoá này (theo ranh giới đường dẫn, '/' hay '\' đều được). `cwdRel` = thư mục của phiên so với dự án. */
function mentions(cmd: string, e: ScopeEntry, root: string, cwds: string[]): boolean {
  if (e.glob) return cmdPaths(cmd, root, cwds).some((rel) => e.glob!.test(rel))
  if (!e.key) return false
  const forms = [e.key]
  for (const cwd of cwds) {
    const cwdRel = projectRel(cwd, root, root) ?? ''
    if (cwdRel && e.key.startsWith(`${cwdRel}/`)) forms.push(e.key.slice(cwdRel.length + 1))
  }
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

/**
 * Một chỗ đụng: `grant` = khoá ghi nhớ khi người dùng cho qua (gắn với việc đang giữ khoá: việc đó xong và agent khác
 * khoá lại chỗ này thì phải hỏi lại), `label` = chữ hiện cho người dùng.
 */
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
  /** agentId → chỗ người dùng đã cho qua trong phiên hiện tại (`<id việc giữ khoá>|<file tương đối chữ thường>`, hoặc `<id việc>|sh:<mục khoá>`). */
  private grants = new Map<string, Set<string>>()
  /** agentId → chỗ đã báo ở chế độ chỉ cảnh báo trong phiên này (báo mỗi chỗ một lần, không tính là cho qua). */
  private warned = new Map<string, Set<string>>()
  /**
   * agentId → lần gọi tool (askKey) mà PreToolUse đã trả 'ask' → các chỗ sẽ cho qua nếu tool chạy. Chỉ PostToolUse của
   * đúng lần gọi đó mới cấp quyền: agent không tự gửi một PostToolUse giả (bằng token của nó) để mở khoá được.
   */
  private asked = new Map<string, Map<string, string[]>>()

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
    let hits: Hit[]
    try {
      hits = await this.hits(ws, agent, p, cfg)
    } catch (e) {
      // Không đọc được bảng việc (.stag/tasks.json hỏng / bị khoá): đừng lặng lẽ cho qua một lần sửa file. Chế độ chặn
      // → từ chối (không kéo người dùng vào); chỉ cảnh báo → cho qua. Chế độ hỏi: Claude Code hỏi người dùng trong
      // terminal; Codex không có 'ask' (hỏi trong app cũng cần bảng việc) → cho qua, ghi log.
      console.error('[scope]', e)
      const writes = !!files?.length || (!!cmd && looksLikeWrite(withoutDataHeredocs(cmd)))
      if (cfg.mode === 'warn' || !writes) return undefined
      if (cfg.mode === 'block')
        return reply(
          'deny',
          `stag.ai scope lock: could not read the task board to check the scope lock (${(e as Error).message}), and stag.ai is set to block edits in another agent's scope, so this ${cmd ? 'command' : 'edit'} is refused for now. Do not change it in any other way and do not ask the user: retry in a moment, and meanwhile work on another part of your task. If it keeps failing, mention it in your final reply.`
        )
      if (kind === 'codex') return undefined
      return reply('ask', `stag.ai: không đọc được bảng việc để kiểm khoá phạm vi (${(e as Error).message}). Cho ${agent.name} ${cmd ? 'chạy lệnh này' : 'sửa file này'}?`)
    }
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
        `stag.ai scope lock: you may not ${cmd ? `run this command, which may modify ${target}` : `edit ${target}`} — it is in the scope of ${owner}, and stag.ai is set to block edits in another agent's scope. ` +
          `Do not change it in any other way, and do not ask the user: sort it out with that agent yourself. Call agent_status("${first.task.agentName}") to see what it is doing; if you need this file, ask it with agent_send to narrow its scope (task_update) or to tell you when its task is done. ` +
          'Meanwhile work on other parts of your own task, and retry once its scope no longer covers the file (task_list shows the scopes).'
      )
    }
    if (kind !== 'codex') {
      conflict('ask')
      const pend = this.asked.get(agent.id) ?? new Map<string, string[]>()
      pend.delete(askKey(p))
      pend.set(askKey(p), hits.map((h) => h.grant))
      // Người dùng từ chối thì không có PostToolUse: giữ có hạn để không phình mãi.
      while (pend.size > MAX_PENDING_ASKS) pend.delete(pend.keys().next().value as string)
      this.asked.set(agent.id, pend)
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
    // Hook PreToolUse đã hỏi (Claude Code) mà đúng lần gọi đó vẫn chạy → người dùng đồng ý.
    const pend = this.asked.get(agent.id)
    const granted = pend?.get(askKey(p))
    if (granted) {
      pend!.delete(askKey(p))
      if (cfg.mode === 'ask') for (const g of granted) mark(this.grants, agent.id, g)
    }
    // File đã sửa vẫn ghi vào việc ở mọi chế độ (cả khi tắt): bật lại khoá thì vùng khoá đã đủ.
    if (!files?.length) return
    const free = unlocked(ws.path, ws.vaultPath, cfg.exempt)
    const own = await this.board.openTask(ws, agent.id)
    if (!own) return
    const declared = parseScope(own.scope, ws.path, taskBase(own, ws.path))
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
    this.asked.delete(agentId)
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
      if (h) hits.push({ grant: `${h.lock.task.id}|${rel}`, label: displayRel(f, ws.path, cwd), task: h.lock.task, entry: h.entry.label })
    }
    const raw = cfg.guessShell ? shellCommand(p) : null
    const cmd = raw && withoutDataHeredocs(raw)
    if (cmd && looksLikeWrite(cmd)) hits.push(...shellHits(cmd, locks, free, ws.path, shellCwds(cmd, cwd)))
    return hits
  }
}

/** Số lần hỏi chưa có kết quả nhớ cho mỗi agent. */
const MAX_PENDING_ASKS = 50

/** Khoá một lần gọi tool: tool_use_id (Claude Code gửi ở cả Pre và PostToolUse), không có thì tên tool + tham số. */
function askKey(p: HookPayload): string {
  return p.tool_use_id || JSON.stringify([p.tool_name ?? '', p.tool_input ?? {}])
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
function shellHits(cmd: string, locks: ScopeLock[], free: ScopeEntry[], root: string, cwds: string[]): Hit[] {
  const hits: Hit[] = []
  for (const lock of locks) {
    for (const e of lock.entries) {
      if ((!e.key && !e.glob) || free.some((s) => covers(s, e))) continue
      if (!mentions(cmd, e, root, cwds) || onlyUnlocked(cmd, e, free, root, cwds)) continue
      // Khoá cấp quyền theo cả mẫu glob: `src/*.ts` và `src/*.md` (cùng key `src`) là hai chỗ khác nhau.
      const grant = `${lock.task.id}|sh:${e.key}|${e.glob?.source ?? ''}`
      if (!hits.some((h) => h.grant === grant)) hits.push({ grant, label: e.label, task: lock.task, entry: e.label })
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
