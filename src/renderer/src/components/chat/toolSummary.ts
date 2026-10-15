// Tóm tắt tool của Claude Code cho thẻ tool và thẻ xin quyền: tên thân thiện, một dòng tóm tắt tham số, và dữ liệu
// có cấu trúc để vẽ phần mở rộng (lệnh, diff, checklist…). Thuần logic → test được trong Node.
import type { IconName } from '../icons'
import { t as tr, type PlainKey } from '@shared/i18n'

// ---------- tiện ích ----------

type Rec = Record<string, unknown>

function rec(v: unknown): Rec {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Rec
  return {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Cắt chuỗi ở `max` ký tự (thêm …). */
export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s
}

/** Dòng đầu có chữ, bỏ khoảng trắng đầu / cuối. */
export function firstLine(s: string): string {
  for (const l of s.split(/\r?\n/)) {
    const t = l.trim()
    if (t) return t
  }
  return ''
}

/**
 * Đường dẫn gọn cho một dòng: đổi `\` thành `/`, bỏ thư mục dự án (`root`) ở đầu, và nếu vẫn dài thì giữ phần cuối
 * (…/components/chat/ChatCell.tsx). Tên file luôn được giữ nguyên trừ khi chính nó đã dài hơn `max`.
 */
export function shortenPath(p: string, root?: string, max = 56): string {
  let s = p.replace(/\\/g, '/')
  if (root) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (r && s.toLowerCase().startsWith(`${r.toLowerCase()}/`)) s = s.slice(r.length + 1)
  }
  if (s.length <= max) return s
  const parts = s.split('/')
  let out = parts[parts.length - 1]
  if (out.length >= max) return `…${out.slice(out.length - (max - 1))}`
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`
    if (next.length + 2 > max) break
    out = next
  }
  return `…/${out}`
}

/** Tách tối đa `max` dòng đầu; `hidden` = số dòng bị giấu. */
export function clipLines(text: string, max: number): { head: string; hidden: number; total: number } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (lines.length <= max) return { head: lines.join('\n'), hidden: 0, total: lines.length }
  return { head: lines.slice(0, max).join('\n'), hidden: lines.length - max, total: lines.length }
}

/** Số dòng của một đoạn chữ (rỗng = 0). */
export function countLines(text: string): number {
  if (!text) return 0
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length
}

// ---------- diff ----------

export interface DiffRow {
  /** ' ' = giữ nguyên, '+' thêm, '-' bớt, '~' = chỗ ngăn giữa hai đoạn sửa (MultiEdit). */
  t: ' ' | '+' | '-' | '~'
  s: string
}

/** Trên ngần này ô (n × m) thì bỏ LCS, hiện cả khối cũ rồi cả khối mới. */
const LCS_LIMIT = 160_000

/**
 * Diff theo dòng giữa `old` và `next`: bỏ phần đầu / cuối giống nhau rồi LCS cho phần giữa (nếu không quá lớn).
 * Dòng giống nhau giữ lại làm ngữ cảnh (' ').
 */
export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText === '' ? [] : oldText.replace(/\r\n/g, '\n').split('\n')
  const b = newText === '' ? [] : newText.replace(/\r\n/g, '\n').split('\n')
  let lo = 0
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++
  let ea = a.length
  let eb = b.length
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) {
    ea--
    eb--
  }
  const head: DiffRow[] = a.slice(0, lo).map((s) => ({ t: ' ', s }))
  const tail: DiffRow[] = a.slice(ea).map((s) => ({ t: ' ', s }))
  const am = a.slice(lo, ea)
  const bm = b.slice(lo, eb)
  let mid: DiffRow[]
  if (!am.length || !bm.length || am.length * bm.length > LCS_LIMIT) {
    mid = [...am.map((s): DiffRow => ({ t: '-', s })), ...bm.map((s): DiffRow => ({ t: '+', s }))]
  } else {
    // DP độ dài LCS của hậu tố, rồi đi xuôi dựng diff.
    const n = am.length
    const m = bm.length
    const w = m + 1
    const dp = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      }
    }
    mid = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        mid.push({ t: ' ', s: am[i] })
        i++
        j++
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        mid.push({ t: '-', s: am[i++] })
      } else {
        mid.push({ t: '+', s: bm[j++] })
      }
    }
    while (i < n) mid.push({ t: '-', s: am[i++] })
    while (j < m) mid.push({ t: '+', s: bm[j++] })
  }
  return [...head, ...mid, ...tail]
}

/**
 * Một thay đổi file của Codex (fileChange: add / delete / update) → dòng diff. `update` mang unified diff
 * (`@@ -1,2 +1,3 @@`, dòng `+` / `-` / ` `); add / delete mang nội dung file mới / cũ.
 */
export function patchRows(kind: string, diff: string): DiffRow[] {
  const lines = diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (!diff) return []
  if (kind === 'add') return lines.map((s) => ({ t: '+', s }))
  if (kind === 'delete') return lines.map((s) => ({ t: '-', s }))
  if (!lines.some((l) => l.startsWith('@@'))) return lines.map((s) => ({ t: ' ', s }))
  const rows: DiffRow[] = []
  let hunks = 0
  for (const l of lines) {
    if (l.startsWith('@@')) {
      if (hunks++ > 0) rows.push({ t: '~', s: '' })
    } else if (hunks === 0 || l.startsWith('\\')) {
      // Đầu diff (diff --git / index / --- / +++) và "\ No newline at end of file".
      continue
    } else if (l.startsWith('+')) rows.push({ t: '+', s: l.slice(1) })
    else if (l.startsWith('-')) rows.push({ t: '-', s: l.slice(1) })
    else rows.push({ t: ' ', s: l.startsWith(' ') ? l.slice(1) : l })
  }
  return rows
}

export function diffStats(rows: DiffRow[]): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const r of rows) {
    if (r.t === '+') add++
    else if (r.t === '-') del++
  }
  return { add, del }
}

// ---------- AskUserQuestion / ExitPlanMode ----------

/** Một câu hỏi của tool AskUserQuestion (Claude hỏi người dùng chọn đáp án). */
export interface AskQuestion {
  question: string
  header: string
  multiSelect: boolean
  options: Array<{ label: string; description: string }>
}

/** `input.questions` → danh sách câu hỏi (bỏ câu không có chữ, lựa chọn không có nhãn). */
export function parseQuestions(input: unknown): AskQuestion[] {
  const qs = rec(input).questions
  if (!Array.isArray(qs)) return []
  return qs
    .map((q): AskQuestion => {
      const r = rec(q)
      const options = Array.isArray(r.options) ? r.options : []
      return {
        question: str(r.question),
        header: str(r.header),
        multiSelect: r.multiSelect === true,
        options: options
          .map((o) => (typeof o === 'string' ? { label: o, description: '' } : { label: str(rec(o).label), description: str(rec(o).description) }))
          .filter((o) => o.label)
      }
    })
    .filter((q) => q.question)
}

/** Kế hoạch (markdown) của ExitPlanMode. */
export function planOf(input: unknown): string {
  return str(rec(input).plan)
}

/** `input.answers` đã có (sau khi trả lời): { "<câu hỏi>": "<nhãn>" }. */
export function answersOf(input: unknown): Record<string, string> {
  const a = rec(rec(input).answers)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a)) if (typeof v === 'string') out[k] = v
  return out
}

/** Tham số mới trả cho Claude: giữ nguyên `input` và thêm `answers` (nhiều nhãn nối bằng ", "). */
export function answersInput(input: unknown, picked: Record<string, string[]>): Rec {
  const answers: Record<string, string> = {}
  for (const [q, labels] of Object.entries(picked)) if (labels.length) answers[q] = labels.join(', ')
  return { ...rec(input), answers }
}

// ---------- mô tả tool ----------

export interface TodoItem {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Phần mở rộng của thẻ tool, theo từng loại. */
export type ToolDetail =
  | { kind: 'bash'; command: string; description: string }
  | { kind: 'read'; path: string; range: string }
  | { kind: 'edit'; path: string; rows: DiffRow[]; replaceAll: boolean; edits: number }
  | { kind: 'write'; path: string; content: string; lines: number }
  | { kind: 'search'; pattern: string; path: string; extra: string }
  | { kind: 'web'; target: string; prompt: string; isQuery: boolean }
  | { kind: 'agent'; description: string; prompt: string; subagent: string }
  | { kind: 'todo'; items: TodoItem[] }
  | { kind: 'questions'; questions: AskQuestion[]; answers: Record<string, string> }
  | { kind: 'plan'; plan: string }
  | { kind: 'text'; text: string }
  | { kind: 'json'; json: string }

export interface ToolView {
  icon: IconName
  /** Tên thân thiện ("Chạy lệnh"). */
  label: string
  /** Một dòng tóm tắt tham số (đã rút gọn). */
  summary: string
  /** "+3 −1" cho Edit / Write… (null = không có). */
  stats: { add: number; del: number } | null
  detail: ToolDetail
}

/** "mcp__stag__task_start" → { server: 'stag', tool: 'task_start' }. */
export function parseMcpName(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

/** Tên tool để hiện: "Bash", "stag · task_done". */
export function toolDisplayName(name: string): string {
  const m = parseMcpName(name)
  return m ? `${m.server} · ${m.tool}` : name
}

const LABEL: Record<string, { icon: IconName; label: PlainKey }> = {
  Bash: { icon: 'term', label: 'chat.tool.label.bash' },
  BashOutput: { icon: 'term', label: 'chat.tool.label.bashOutput' },
  KillShell: { icon: 'term', label: 'chat.tool.label.killShell' },
  Read: { icon: 'file', label: 'chat.tool.label.read' },
  Edit: { icon: 'fdiff', label: 'chat.tool.label.edit' },
  MultiEdit: { icon: 'fdiff', label: 'chat.tool.label.edit' },
  ApplyPatch: { icon: 'fdiff', label: 'chat.tool.label.edit' },
  Permissions: { icon: 'shield', label: 'chat.tool.label.permissions' },
  MCP: { icon: 'conn', label: 'chat.tool.label.mcp' },
  Write: { icon: 'pen', label: 'chat.tool.label.write' },
  NotebookEdit: { icon: 'fdiff', label: 'chat.tool.label.notebook' },
  Glob: { icon: 'search', label: 'chat.tool.label.glob' },
  Grep: { icon: 'search', label: 'chat.tool.label.grep' },
  WebFetch: { icon: 'globe', label: 'chat.tool.label.webFetch' },
  WebSearch: { icon: 'globe', label: 'chat.tool.label.webSearch' },
  Task: { icon: 'bot', label: 'chat.tool.label.subagent' },
  Agent: { icon: 'bot', label: 'chat.tool.label.subagent' },
  TodoWrite: { icon: 'kanban', label: 'chat.tool.label.todo' },
  ExitPlanMode: { icon: 'kanban', label: 'chat.tool.label.plan' }
}

/** Nhãn tool theo ngôn ngữ giao diện (gọi lúc dùng, không lúc nạp module). */
const lbl = (name: string): string => tr(LABEL[name].label)

const STAG_LABEL: Record<string, { icon: IconName; label: PlainKey; verb: PlainKey }> = {
  task_start: { icon: 'kanban', label: 'chat.tool.stag.taskStart', verb: 'chat.tool.stag.taskStart' },
  task_update: { icon: 'kanban', label: 'chat.tool.stag.taskUpdate', verb: 'chat.tool.stag.taskUpdate' },
  task_done: { icon: 'kanban', label: 'chat.tool.stag.taskDone', verb: 'chat.tool.stag.taskDone' },
  task_list: { icon: 'kanban', label: 'chat.tool.stag.taskList', verb: 'chat.tool.stag.taskListVerb' },
  session_handoff: { icon: 'handoff', label: 'chat.tool.stag.handoff', verb: 'chat.tool.stag.handoffVerb' }
}

function todoItems(v: unknown): TodoItem[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => {
    const r = rec(x)
    const status = str(r.status)
    return {
      text: str(r.content) || str(r.activeForm) || str(r.text) || tr('chat.tool.empty'),
      status: status === 'completed' || status === 'in_progress' ? status : 'pending'
    }
  })
}

function jsonOf(v: unknown): string {
  try {
    const s = JSON.stringify(v, null, 2)
    return s === undefined ? '' : s
  } catch {
    return String(v)
  }
}

/** JSON một dòng rút gọn (tóm tắt tool lạ). */
function compactJson(v: unknown, max: number): string {
  try {
    const s = JSON.stringify(v)
    if (!s || s === '{}' || s === 'null') return ''
    return clip(s, max)
  } catch {
    return ''
  }
}

/** Số dòng đầu đoạn [offset, offset+limit) của tool Read: "L12–61", "từ L12", "200 dòng đầu". */
export function readRange(offset: number | null, limit: number | null): string {
  if (offset !== null && limit !== null) return `L${offset}–${offset + limit - 1}`
  if (offset !== null) return tr('chat.tool.fromLine', { line: `L${offset}` })
  if (limit !== null) return tr('chat.tool.firstLines', { count: limit })
  return ''
}

const SUMMARY_MAX = 140

export interface DescribeOpts {
  /** Thư mục dự án: bỏ khỏi đầu đường dẫn. */
  root?: string
}

/** Mô tả một lần gọi tool. `input` có thể còn dang dở khi đang stream ({}), nên mọi trường đều tuỳ chọn. */
export function describeTool(name: string, input: unknown, opts: DescribeOpts = {}): ToolView {
  const i = rec(input)
  const p = (v: unknown): string => shortenPath(str(v), opts.root)

  switch (name) {
    case 'Bash': {
      const command = str(i.command)
      const description = str(i.description)
      return {
        icon: 'term',
        label: lbl('Bash'),
        summary: clip(firstLine(command) || description, SUMMARY_MAX),
        stats: null,
        detail: { kind: 'bash', command, description }
      }
    }
    case 'Read': {
      const path = str(i.file_path) || str(i.path)
      const range = readRange(num(i.offset), num(i.limit))
      return {
        icon: 'file',
        label: lbl('Read'),
        summary: [shortenPath(path, opts.root), range].filter(Boolean).join(' · '),
        stats: null,
        detail: { kind: 'read', path, range }
      }
    }
    case 'ApplyPatch': {
      // Codex (fileChange): một hoặc nhiều file, mỗi file một unified diff.
      const changes = Array.isArray(i.changes) ? i.changes.map(rec) : []
      const paths = changes.map((c) => str(c.path))
      let rows: DiffRow[] = []
      changes.forEach((c, k) => {
        if (k > 0) rows.push({ t: '~', s: '' })
        rows = rows.concat(patchRows(str(c.kind), str(c.diff)))
      })
      const added = changes.length === 1 && str(changes[0].kind) === 'add'
      const removed = changes.length === 1 && str(changes[0].kind) === 'delete'
      const summary = paths.length > 1 ? `${paths.length} file: ${paths.map((x) => shortenPath(x, opts.root, 40)).join(', ')}` : shortenPath(paths[0] ?? '', opts.root)
      return {
        icon: added ? 'pen' : 'fdiff',
        label: added ? tr('chat.tool.label.create') : removed ? tr('chat.tool.label.delete') : lbl('ApplyPatch'),
        summary: clip(summary, SUMMARY_MAX),
        stats: rows.length ? diffStats(rows) : null,
        detail: { kind: 'edit', path: paths.join(', '), rows, replaceAll: false, edits: changes.length > 1 ? changes.length : 1 }
      }
    }
    case 'Permissions': {
      const perms = rec(i.permissions)
      const fsPerm = rec(perms.fileSystem)
      const net = rec(perms.network)
      const lines = [
        ...['read', 'write'].flatMap((k) => (Array.isArray(fsPerm[k]) ? (fsPerm[k] as unknown[]).map((p) => tr(k === 'read' ? 'chat.tool.perm.read' : 'chat.tool.perm.write', { path: String(p) })) : [])),
        net.enabled === true ? tr('chat.tool.perm.network') : ''
      ].filter(Boolean)
      return {
        icon: 'shield',
        label: lbl('Permissions'),
        summary: clip(lines[0] ?? compactJson(perms, SUMMARY_MAX), SUMMARY_MAX),
        stats: null,
        detail: lines.length ? { kind: 'text', text: lines.join('\n') } : { kind: 'json', json: jsonOf(perms) }
      }
    }
    case 'MCP': {
      const url = str(i.url)
      return {
        icon: 'conn',
        label: tr('chat.tool.mcpServer', { name: str(i.server) }).trim(),
        summary: clip(firstLine(str(i.message)) || url, SUMMARY_MAX),
        stats: null,
        detail: { kind: 'text', text: [str(i.message), url ? tr('chat.tool.openUrl', { url }) : ''].filter(Boolean).join('\n\n') }
      }
    }
    case 'Edit':
    case 'MultiEdit': {
      const path = str(i.file_path)
      const list = Array.isArray(i.edits) ? i.edits.map(rec) : [i]
      let rows: DiffRow[] = []
      list.forEach((e, k) => {
        if (k > 0) rows.push({ t: '~', s: '' })
        rows = rows.concat(lineDiff(str(e.old_string), str(e.new_string)))
      })
      const stats = diffStats(rows)
      return {
        icon: 'fdiff',
        label: lbl(name),
        summary: shortenPath(path, opts.root),
        stats,
        detail: { kind: 'edit', path, rows, replaceAll: list.some((e) => e.replace_all === true), edits: list.length }
      }
    }
    case 'Write': {
      const path = str(i.file_path)
      const content = str(i.content)
      const lines = countLines(content)
      return {
        icon: 'pen',
        label: lbl('Write'),
        summary: [shortenPath(path, opts.root), content ? tr('chat.tool.lines', { count: lines }) : ''].filter(Boolean).join(' · '),
        stats: lines ? { add: lines, del: 0 } : null,
        detail: { kind: 'write', path, content, lines }
      }
    }
    case 'NotebookEdit': {
      const path = str(i.notebook_path)
      return {
        icon: 'fdiff',
        label: lbl('NotebookEdit'),
        summary: shortenPath(path, opts.root),
        stats: null,
        detail: { kind: 'write', path, content: str(i.new_source), lines: countLines(str(i.new_source)) }
      }
    }
    case 'Glob':
    case 'Grep': {
      const pattern = str(i.pattern)
      const path = str(i.path)
      const extra = [str(i.glob), str(i.type), str(i.output_mode)].filter(Boolean).join(' · ')
      return {
        icon: 'search',
        label: lbl(name),
        summary: clip([pattern, path ? `trong ${shortenPath(path, opts.root)}` : ''].filter(Boolean).join(' '), SUMMARY_MAX),
        stats: null,
        detail: { kind: 'search', pattern, path, extra }
      }
    }
    case 'WebFetch': {
      const url = str(i.url)
      return {
        icon: 'globe',
        label: lbl('WebFetch'),
        summary: clip(url.replace(/^https?:\/\//i, ''), SUMMARY_MAX),
        stats: null,
        detail: { kind: 'web', target: url, prompt: str(i.prompt), isQuery: false }
      }
    }
    case 'WebSearch': {
      const q = str(i.query)
      return { icon: 'globe', label: lbl('WebSearch'), summary: clip(q, SUMMARY_MAX), stats: null, detail: { kind: 'web', target: q, prompt: '', isQuery: true } }
    }
    case 'Task':
    case 'Agent': {
      const description = str(i.description)
      const prompt = str(i.prompt)
      return {
        icon: 'bot',
        label: lbl(name),
        summary: clip(description || firstLine(prompt), SUMMARY_MAX),
        stats: null,
        detail: { kind: 'agent', description, prompt, subagent: str(i.subagent_type) }
      }
    }
    case 'AskUserQuestion': {
      const questions = parseQuestions(i)
      return {
        icon: 'ask',
        label: tr('chat.tool.label.question'),
        summary: clip(questions[0]?.question ?? '', SUMMARY_MAX),
        stats: null,
        detail: { kind: 'questions', questions, answers: answersOf(i) }
      }
    }
    case 'ExitPlanMode': {
      const plan = str(i.plan)
      return {
        icon: 'kanban',
        label: lbl('ExitPlanMode'),
        summary: clip(firstLine(plan).replace(/^#+\s*/, ''), SUMMARY_MAX),
        stats: null,
        detail: { kind: 'plan', plan }
      }
    }
    case 'TodoWrite': {
      const items = todoItems(i.todos)
      const done = items.filter((t) => t.status === 'completed').length
      const active = items.find((t) => t.status === 'in_progress')
      return {
        icon: 'kanban',
        label: lbl('TodoWrite'),
        summary: items.length ? `${done}/${items.length}${active ? ` · ${clip(active.text, 80)}` : ''}` : '',
        stats: null,
        detail: { kind: 'todo', items }
      }
    }
  }

  const mcp = parseMcpName(name)
  if (mcp?.server === 'stag' && STAG_LABEL[mcp.tool]) {
    const meta = STAG_LABEL[mcp.tool]
    const title = str(i.title)
    const summaryText = firstLine(str(i.summary))
    const body = mcp.tool === 'task_done' ? summaryText : title
    const text = body ? `${tr(meta.verb)}: ${clip(body, 110)}` : tr(meta.verb)
    return {
      icon: meta.icon,
      label: tr(meta.label),
      summary: body ? clip(body, SUMMARY_MAX) : '',
      stats: null,
      detail: { kind: 'text', text: [text, str(i.scope) ? tr('chat.tool.scope', { scope: str(i.scope) }) : '', str(i.log) ? tr('chat.tool.log', { log: str(i.log) }) : ''].filter(Boolean).join('\n') }
    }
  }
  if (mcp) {
    const lead = Object.values(i).find((v): v is string => typeof v === 'string' && v.length > 0)
    return {
      icon: mcp.server === 'stag' && mcp.tool.startsWith('agent_') ? 'bot' : 'conn',
      label: toolDisplayName(name),
      summary: clip(lead ? firstLine(lead) : compactJson(input, SUMMARY_MAX), SUMMARY_MAX),
      stats: null,
      detail: { kind: 'json', json: jsonOf(input) }
    }
  }
  return {
    icon: 'code',
    label: name,
    summary: compactJson(input, SUMMARY_MAX),
    stats: null,
    detail: { kind: 'json', json: jsonOf(input) }
  }
}

// ---------- giao diện "Hội thoại" ----------

/** Tên ngắn cho một dòng bước / chip: "Bash", "task_done" (bỏ tiền tố mcp__server__). */
export function stepName(name: string): string {
  return parseMcpName(name)?.tool ?? name
}

/** Kết quả ngắn bên phải một dòng bước: "214 dòng", "4 kết quả", "✓" / "✗"; null = để biểu tượng trạng thái lo. */
export function stepResult(name: string, state: string, output?: string): { text: string; tone: 'ok' | 'err' | 'dim' } | null {
  if (state === 'running') return null
  if (state === 'error' || state === 'denied') return { text: state === 'denied' ? tr('chat.tool.denied') : '✗', tone: 'err' }
  const out = (output ?? '').trim()
  if (name === 'Read' && out) return { text: tr('chat.tool.lines', { count: countLines(out) }), tone: 'dim' }
  if (name === 'Grep' || name === 'Glob') {
    if (!out || /^no (matches|files) found/i.test(out)) return { text: tr('chat.tool.results', { count: 0 }), tone: 'dim' }
    const head = /^Found (\d+) (files?|matches?|lines?)/i.exec(out)
    return { text: tr('chat.tool.results', { count: head ? Number(head[1]) : countLines(out) }), tone: 'dim' }
  }
  return { text: '✓', tone: 'ok' }
}

/** File một tool đã sửa / ghi: mỗi file một danh sách dòng diff. Tool không ghi file → []. */
export function fileChanges(name: string, input: unknown): Array<{ path: string; rows: DiffRow[] }> {
  const i = rec(input)
  switch (name) {
    case 'Edit':
    case 'MultiEdit': {
      const path = str(i.file_path)
      if (!path) return []
      const list = Array.isArray(i.edits) ? i.edits.map(rec) : [i]
      let rows: DiffRow[] = []
      list.forEach((e, k) => {
        if (k > 0) rows.push({ t: '~', s: '' })
        rows = rows.concat(lineDiff(str(e.old_string), str(e.new_string)))
      })
      return [{ path, rows }]
    }
    case 'Write': {
      const path = str(i.file_path)
      const content = str(i.content)
      if (!path) return []
      return [{ path, rows: content ? content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((s): DiffRow => ({ t: '+', s })) : [] }]
    }
    case 'NotebookEdit': {
      const path = str(i.notebook_path)
      return path ? [{ path, rows: countLines(str(i.new_source)) ? str(i.new_source).split(/\r?\n/).map((s): DiffRow => ({ t: '+', s })) : [] }] : []
    }
    case 'ApplyPatch':
      return (Array.isArray(i.changes) ? i.changes.map(rec) : [])
        .filter((c) => str(c.path))
        .map((c) => ({ path: str(c.path), rows: patchRows(str(c.kind), str(c.diff)) }))
  }
  return []
}

/** Gộp thay đổi theo file (cùng đường dẫn, không phân biệt `\` / `/` và hoa thường), giữ thứ tự lần đầu gặp. */
export function mergeFileChanges(changes: Array<{ path: string; rows: DiffRow[] }>): Array<{ path: string; rows: DiffRow[]; add: number; del: number }> {
  const byKey = new Map<string, { path: string; rows: DiffRow[] }>()
  for (const c of changes) {
    const key = c.path.replace(/\\/g, '/').toLowerCase()
    const cur = byKey.get(key)
    if (!cur) byKey.set(key, { path: c.path, rows: c.rows.slice() })
    else cur.rows = cur.rows.length && c.rows.length ? [...cur.rows, { t: '~', s: '' }, ...c.rows] : [...cur.rows, ...c.rows]
  }
  return [...byKey.values()].map((f) => ({ ...f, ...diffStats(f.rows) }))
}

/** Tiêu đề thẻ xin quyền: "Tester muốn chạy lệnh", "Tester muốn dùng stag · task_done". */
export function askHeadline(agent: string, name: string): string {
  if (name === 'AskUserQuestion') return tr('chat.ask.headQuestion', { agent })
  if (name === 'ExitPlanMode') return tr('chat.ask.headPlan', { agent })
  if (LABEL[name]) {
    const label = lbl(name)
    return tr('chat.ask.headTool', { agent, action: `${label.charAt(0).toLowerCase()}${label.slice(1)}` })
  }
  return tr('chat.ask.headUse', { agent, tool: toolDisplayName(name) })
}

/** Nhãn nút "Luôn cho phép": Bash kèm lệnh (rút gọn), còn lại theo tên tool. */
export function rememberLabel(name: string, input: unknown): string {
  if (name === 'Bash') {
    const cmd = firstLine(str(rec(input).command))
    if (cmd) return tr('chat.ask.alwaysCmd', { cmd: clip(cmd, 32) })
  }
  return tr('chat.ask.alwaysSession')
}
