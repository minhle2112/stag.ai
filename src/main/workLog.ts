import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { MemorySettings, Task, Workspace } from '@shared/types'
import { exists, readText } from './fsutil'
import { renameRetry } from './jsonFile'

/**
 * Bộ nhớ trong vault do app tự ghi (xem vault "Memory and work log"):
 * - việc xong → một dòng trong `40 Log/<ngày>.md`, mục "Agent work (auto)" (nhật ký chung của workspace);
 * - việc xong → một dòng trong mục "Work done" của note agent `60 Agents/<tên>.md`;
 * - note agent quá hạn mức → cất các dòng "Work done" cũ sang `60 Agents/<tên> archive.md`; vẫn quá thì luật phiên
 *   sau nhắc agent tự viết gọn.
 * Agent cũng sửa các note này: app chỉ chèn dòng, đọc lại và so thời điểm sửa file ngay trước khi ghi (đổi thì làm lại),
 * không bao giờ ghi đè cả file bằng bản cũ.
 */

export const LOG_SECTION = 'Agent work (auto)'
export const WORK_DONE_SECTION = 'Work done'

/** Một việc vừa đóng. */
export interface ClosedTask {
  task: Task
  /** done = agent gọi task_done; handoff = agent_handoff sang agent khác; manual = người dùng đánh dấu xong (menu agent). */
  how: 'done' | 'handoff' | 'manual'
  /** Tên agent nhận (how = handoff). */
  to?: string
  /** Project của việc: tên note project trong vault (`[[…]]`, giữ nguyên khi đổi tên project). Vắng = Chung. */
  project?: string
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Ngày địa phương YYYY-MM-DD của một thời điểm ISO. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function localTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Một dòng gọn: bỏ xuống dòng, khoảng trắng thừa, cắt độ dài. */
export function oneLine(s: string | undefined, max: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Dòng tóm tắt việc cho nhật ký: `log` của agent; bàn giao thì dòng đầu bản bàn giao. */
function noteOf(c: ClosedTask): string {
  if (c.task.log) return oneLine(c.task.log, 300)
  if (c.how === 'handoff') {
    const body = (c.task.summary ?? '').replace(/^Handed off to [^:\n]*:\s*/, '')
    return oneLine(body.split(/\r?\n/).find((l) => l.trim()), 160)
  }
  return ''
}

/** Dòng trong `40 Log/<ngày>.md`. Tên việc giữ nguyên văn (có thể không phải tiếng Anh) trong ngoặc kép. */
export function logLine(c: ClosedTask): string {
  const t = c.task
  const at = localTime(t.doneAt ?? new Date().toISOString())
  const status =
    c.how === 'handoff' ? `handed off to [[${c.to ?? '?'}]] ${at}` : c.how === 'manual' ? `marked done by the user ${at}` : `done ${at}`
  const note = noteOf(c)
  const files = t.files?.length ? ` + ${t.files.slice(0, 3).join(', ')}${t.files.length > 3 ? ` (+${t.files.length - 3})` : ''}` : ''
  const scope = t.scope ? ` · scope: ${oneLine(t.scope, 120)}${files}` : files ? ` · files:${files.slice(2)}` : ''
  const project = c.project ? ` · project: [[${c.project}]]` : ''
  return `- [x] "${oneLine(t.title, 120)}" — [[${t.agentName}]] — ${status}${note ? ` — ${note}` : ''}${project}${scope}`
}

/** Dòng trong mục "Work done" của note agent. */
export function workDoneLine(c: ClosedTask): string {
  const t = c.task
  const what = c.how === 'handoff' ? `handed off to [[${c.to ?? '?'}]]` : c.how === 'manual' ? 'marked done by the user' : ''
  const note = noteOf(c)
  return `- ${localDate(t.doneAt ?? new Date().toISOString())} — "${oneLine(t.title, 120)}"${[what, note].filter(Boolean).map((x) => ` — ${x}`).join('')}`
}

/** Dấu `#` đóng chỉ tính khi có khoảng trắng trước (CommonMark): `## C#` là "C#". */
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/

/**
 * Chèn `lines` vào cuối mục `## <section>` (sau dòng không trống cuối cùng của mục, trước tiêu đề cùng cấp / cấp cao hơn
 * kế tiếp). Chưa có mục thì thêm mục ở cuối file. Giữ kiểu xuống dòng của file.
 */
export function insertInSection(text: string, section: string, lines: string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const all = text.split(/\r?\n/)
  const start = all.findIndex((l) => {
    const m = HEADING_RE.exec(l)
    return !!m && m[1].length === 2 && m[2].toLowerCase() === section.toLowerCase()
  })
  if (start < 0) {
    while (all.length && all[all.length - 1].trim() === '') all.pop()
    const head = all.length ? [...all, ''] : []
    return [...head, `## ${section}`, ...lines, ''].join(eol)
  }
  let end = all.length
  for (let i = start + 1; i < all.length; i++) {
    const m = HEADING_RE.exec(all[i])
    if (m && m[1].length <= 2) {
      end = i
      break
    }
  }
  let at = end
  while (at > start + 1 && all[at - 1].trim() === '') at--
  all.splice(at, 0, ...lines)
  return all.join(eol)
}

/** Note nhật ký ngày mới (theo mẫu `40 Log/<ngày>.md` của vault stag.ai). */
export function newDailyLog(date: string, lines: string[]): string {
  return ['---', 'type: log', `date: ${date}`, '---', `# Log ${date}`, '', 'Back to: [[_INDEX]]', '', `## ${LOG_SECTION}`, ...lines, ''].join('\n')
}

/** Đổi `updated:` trong frontmatter (nếu có). */
export function touchUpdated(text: string, date: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---/.exec(text)?.[0]
  if (!fm || !/^updated:/m.test(fm)) return text
  return fm.replace(/^updated:.*$/m, `updated: ${date}`) + text.slice(fm.length)
}

/** Tên note cất của agent (không đuôi .md). */
export const archiveName = (agent: string): string => `${agent} archive`

interface Section {
  /** Chỉ số dòng tiêu đề và dòng đầu sau mục. */
  start: number
  end: number
}

function findSection(all: string[], section: string): Section | null {
  const start = all.findIndex((l) => {
    const m = HEADING_RE.exec(l)
    return !!m && m[1].length === 2 && m[2].toLowerCase() === section.toLowerCase()
  })
  if (start < 0) return null
  let end = all.length
  for (let i = start + 1; i < all.length; i++) {
    const m = HEADING_RE.exec(all[i])
    if (m && m[1].length <= 2) {
      end = i
      break
    }
  }
  return { start, end }
}

/** Bỏ `\r` của CRLF: mục cất luôn nối bằng `\n`, so trùng trên chữ đã chuẩn hoá (note và note cất có thể khác kiểu xuống dòng). */
const lf = (s: string): string => s.replace(/\r\n/g, '\n')

/** Note `text` đã có mục `item` (nhiều dòng) nguyên vẹn, đúng ranh giới dòng (`- [x] A` không trùng với `- [x] A2`). */
function hasItem(text: string, item: string): boolean {
  return `\n${lf(text)}\n`.includes(`\n${lf(item)}\n`)
}

/**
 * Cất các dòng "Work done" cũ: giữ `keep` mục mới nhất (mục = dòng `- ` ở đầu dòng cùng các dòng tiếp theo thụt vào),
 * trả về note mới + các mục đã lấy ra (cũ trước, nối bằng `\n`). Chỉ rút mục đã cất ra; heading con, đoạn văn, mục giữ
 * lại ở nguyên chỗ. Thêm một dòng trỏ tới note cất ngay dưới tiêu đề nếu chưa có.
 */
export function splitWorkDone(text: string, keep: number, archive: string): { note: string; moved: string[] } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const all = text.split(/\r?\n/)
  const sec = findSection(all, WORK_DONE_SECTION)
  if (!sec) return { note: text, moved: [] }
  // Khối: mục (dòng `- ` + dòng con thụt vào, kể cả sau dòng trống) hoặc một dòng khác.
  const blocks: Array<{ lines: string[]; item: boolean }> = []
  for (const l of all.slice(sec.start + 1, sec.end)) {
    if (/^[-*] /.test(l)) {
      blocks.push({ lines: [l], item: true })
      continue
    }
    if (l.trim() && /^\s/.test(l)) {
      // Dòng con sau vài dòng trống vẫn thuộc mục ngay trước.
      let i = blocks.length - 1
      while (i >= 0 && !blocks[i].item && !blocks[i].lines[0].trim()) i--
      if (i >= 0 && blocks[i].item) {
        blocks[i].lines.push(...blocks.splice(i + 1).flatMap((b) => b.lines), l)
        continue
      }
    }
    blocks.push({ lines: [l], item: false })
  }
  const items = blocks.filter((b) => b.item)
  if (items.length <= keep) return { note: text, moved: [] }
  const moved = new Set(items.slice(0, items.length - keep))
  const kept = blocks.filter((b) => !moved.has(b)).flatMap((b) => b.lines)
  // Dòng trống liền nhau (chỗ mục vừa rút đi) gộp lại một; bỏ dòng trống ở đầu / cuối mục.
  const body = kept.filter((l, i) => l.trim() || (i > 0 && kept[i - 1].trim()))
  while (body.length && !body[body.length - 1].trim()) body.pop()
  if (!body.some((l) => l.includes(`[[${archive}]]`))) body.unshift(`Older items: [[${archive}]]`)
  const tail = all.slice(sec.end)
  const out = [...all.slice(0, sec.start + 1), ...body, '', ...tail]
  // Mục ở cuối file: file chỉ kết thúc bằng một lần xuống dòng như cũ.
  if (!tail.length && all[all.length - 1] !== '') out.pop()
  return { note: out.join(eol), moved: [...moved].map((m) => m.lines.join('\n')) }
}

/** Note cất mới của agent. */
export function newArchive(agent: string, date: string): string {
  return [
    '---',
    'type: agent',
    `updated: ${date}`,
    '---',
    `# ${archiveName(agent)}`,
    '',
    `Back to: [[${agent}]]`,
    '',
    `Older "${WORK_DONE_SECTION}" items of agent ${agent}, moved here by stag.ai when its memory note grew past its budget (oldest first).`,
    '',
    `## ${WORK_DONE_SECTION}`,
    ''
  ].join('\n')
}

// ---- `_INDEX.md`: dời mục đã xong cũ sang `_INDEX archive` ----

export const INDEX_OPEN_SECTION = 'Open items'
export const INDEX_ARCHIVE = '_INDEX archive'
/** Nhóm trong note cất cho mục không có ngày nào. */
export const UNDATED = 'Undated'

/** Một mục đã dời: ngày mới nhất ghi trong mục (YYYY-MM-DD) hoặc null, và chữ của mục (cả dòng con). */
export interface MovedIndexItem {
  date: string | null
  text: string
}

/** Lùi `days` ngày từ một ngày YYYY-MM-DD (theo lịch, không lệch múi giờ). */
function daysBefore(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d - days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * Dời mục đã xong (`- [x]` ở đầu dòng, kèm các dòng con thụt vào) trong mục `## Open items` của `_INDEX.md` khi mục
 * cũ hơn `keepDays` ngày. Ngày của mục = ngày YYYY-MM-DD mới nhất viết trong mục (mục được sửa gần đây thì ở lại);
 * không có ngày nào thì coi là cũ. Mục `- [ ]` và mọi dòng khác giữ nguyên. Thêm dòng trỏ tới note cất ở đầu mục.
 */
export function splitIndexDone(text: string, keepDays: number, today: string, archive = INDEX_ARCHIVE): { note: string; moved: MovedIndexItem[] } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const all = text.split(/\r?\n/)
  const sec = findSection(all, INDEX_OPEN_SECTION)
  if (!sec) return { note: text, moved: [] }
  const cutoff = daysBefore(today, keepDays)
  // Khối: mục checklist (dòng đầu + dòng con thụt vào) hoặc một dòng khác.
  const blocks: Array<{ lines: string[]; item: boolean }> = []
  for (const l of all.slice(sec.start + 1, sec.end)) {
    const last = blocks[blocks.length - 1]
    if (/^[-*] \[[ xX]\]/.test(l)) blocks.push({ lines: [l], item: true })
    else if (last?.item && l.trim() && /^\s/.test(l)) last.lines.push(l)
    else blocks.push({ lines: [l], item: false })
  }
  const moved: MovedIndexItem[] = []
  const kept: string[] = []
  for (const b of blocks) {
    if (b.item && /^[-*] \[[xX]\]/.test(b.lines[0])) {
      const dates = b.lines.join(' ').match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []
      const date = dates.length ? dates.reduce((a, c) => (c > a ? c : a)) : null
      if (date === null || date < cutoff) {
        moved.push({ date, text: b.lines.join('\n') })
        continue
      }
    }
    kept.push(...b.lines)
  }
  if (!moved.length) return { note: text, moved }
  // Dòng trống liền nhau (chỗ mục vừa dời đi) gộp lại một.
  const body = kept.filter((l, i) => l.trim() || i === 0 || kept[i - 1].trim())
  if (!body.some((l) => l.includes(`[[${archive}]]`))) {
    const pointer = `Older done items: [[${archive}]]`
    if (body.length && !body[0].trim()) body.splice(1, 0, pointer, '')
    else body.unshift(pointer, '')
  }
  const tail = all.slice(sec.end)
  while (body.length && !body[body.length - 1].trim()) body.pop()
  const out = [...all.slice(0, sec.start + 1), ...body, ...(tail.length ? [''] : []), ...tail]
  if (!tail.length && all[all.length - 1] === '') out.push('')
  return { note: out.join(eol), moved }
}

/** Note cất mới của `_INDEX.md`. */
export function newIndexArchive(date: string): string {
  return [
    '---',
    'type: archive',
    `updated: ${date}`,
    '---',
    `# ${INDEX_ARCHIVE}`,
    '',
    'Back to: [[_INDEX]]',
    '',
    `Done items moved here by stag.ai from "${INDEX_OPEN_SECTION}" of [[_INDEX]] when it grew past its budget, grouped by the latest date written in the item (oldest group first).`,
    ''
  ].join('\n')
}

/**
 * Thêm mục vào note cất theo nhóm ngày (`## YYYY-MM-DD`, cũ trước; `## Undated` đầu tiên); bỏ mục đã có (so cả chữ,
 * không tính kiểu xuống dòng). Trả về null nếu không có gì mới.
 */
export function addToIndexArchive(text: string, items: MovedIndexItem[], today: string): string | null {
  let out = text
  let added = false
  for (const it of items) {
    if (hasItem(out, it.text)) continue
    added = true
    const group = it.date ?? UNDATED
    const eol = out.includes('\r\n') ? '\r\n' : '\n'
    const all = out.split(/\r?\n/)
    if (findSection(all, group)) {
      out = insertInSection(out, group, it.text.split(/\r?\n/))
      continue
    }
    // Nhóm mới: chèn trước nhóm đầu tiên "lớn hơn" (Undated < mọi ngày), không có thì cuối file.
    const rank = (g: string): string => (g === UNDATED ? '' : g)
    const next = all.findIndex((l) => {
      const m = HEADING_RE.exec(l)
      return !!m && m[1].length === 2 && rank(m[2]) > rank(group)
    })
    if (next < 0) out = insertInSection(out, group, it.text.split(/\r?\n/))
    else out = [...all.slice(0, next), `## ${group}`, ...it.text.split(/\r?\n/), '', ...all.slice(next)].join(eol)
  }
  return added ? touchUpdated(out, today) : null
}

/** Độ dài note tính bằng KB (UTF-8), một chữ số thập phân. */
export const sizeKb = (text: string): number => Math.round((Buffer.byteLength(text, 'utf8') / 1024) * 10) / 10

/**
 * Câu trong luật phiên (mục MEMORY): app tự ghi gì, hạn mức note, và — khi note vẫn quá hạn mức sau khi đã cất —
 * nhờ agent viết gọn.
 */
export function memoryRules(cfg: MemorySettings, note: { kb: number; archive: string } | null): string {
  const lines: string[] = []
  const auto = [
    cfg.workLog ? 'a line in the vault work log (`40 Log/<date>.md`, section "Agent work (auto)")' : '',
    cfg.agentWorkDone ? `a line in the "${WORK_DONE_SECTION}" list of your memory note` : ''
  ].filter(Boolean)
  if (auto.length)
    lines.push(
      `- When your task closes (task_done, agent_handoff, or the user marks it done), stag.ai itself writes ${auto.join(' and ')}. Do not write those lines yourself; record only non-obvious things (decisions, gotchas, learnings) per the Memory Protocol. Give task_done a one-line English \`log\` for that entry.`
    )
  lines.push(
    `- Keep your memory note under ${cfg.noteBudgetKb} KB. stag.ai moves old "${WORK_DONE_SECTION}" items to [[${note?.archive ?? 'archive'}]] when it grows past that.`
  )
  if (note && note.kb > cfg.noteBudgetKb)
    lines.push(
      `- Your memory note is ${note.kb} KB now, over its ${cfg.noteBudgetKb} KB budget even after archiving. Early in this session (after you greet the user, before starting work), condense it yourself: merge duplicates, drop stale or finished items, keep only what a future session of yours needs. Do not touch the "${WORK_DONE_SECTION}" list (stag.ai archives it).`
    )
  return lines.join('\n')
}

/**
 * Đọc → sửa → ghi một note, không đè lên thay đổi của người khác: ngay trước khi ghi, file mà đã đổi (thời điểm sửa /
 * kích thước khác lúc đọc) thì đọc và làm lại (tối đa vài lần). `edit` trả null = không ghi. Ghi tuần tự theo file.
 */
export class NoteWriter {
  private chains = new Map<string, Promise<unknown>>()

  update(file: string, edit: (text: string | null) => string | null): Promise<boolean> {
    const key = file.toLowerCase()
    const prev = this.chains.get(key) ?? Promise.resolve()
    const next = prev.then(() => this.run(file, edit))
    this.chains.set(
      key,
      next.catch(() => {})
    )
    return next
  }

  /**
   * Chạy `fn` (đổi tên / xoá file) khi mọi lần ghi đang chờ của các file này đã xong; lần ghi sau vào các file đó chờ
   * `fn` xong (không ghi lại vào chỗ cũ giữa lúc đang chuyển).
   */
  exclusive<T>(files: string[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(files.map((f) => f.toLowerCase()))]
    const next = Promise.all(keys.map((k) => this.chains.get(k) ?? Promise.resolve())).then(fn)
    for (const k of keys) this.chains.set(k, next.catch(() => {}))
    return next
  }

  private async run(file: string, edit: (text: string | null) => string | null): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await stamp(file)
      const text = before ? await fs.readFile(file, 'utf8') : null
      const out = edit(text)
      if (out === null || out === text) return false
      const now = await stamp(file)
      if ((before?.key ?? null) !== (now?.key ?? null)) continue
      await writeAtomic(file, out)
      return true
    }
    throw new Error(`${file} keeps changing; skipped this update.`)
  }
}

/**
 * Ghi file tạm cùng thư mục rồi đổi tên đè lên: tắt máy / lỗi giữa chừng không để lại note cụt. File tạm ẩn (`.`) và
 * không có đuôi `.md` nên chỉ mục vault không thấy. Note là symlink thì ghi vào file thật nó trỏ tới (giữ symlink).
 */
async function writeAtomic(file: string, text: string): Promise<void> {
  const target = await fs.realpath(file).catch(() => file)
  await fs.mkdir(dirname(target), { recursive: true })
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, text, 'utf8')
    await renameRetry(tmp, target)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Một chuỗi ghi chung cho mọi chỗ ghi note trong app (nhật ký việc, tool memory_*, trình sửa note, plugin). */
export const noteWriter = new NoteWriter()

async function stamp(file: string): Promise<{ key: string } | null> {
  try {
    const s = await fs.stat(file)
    return { key: `${s.mtimeMs}:${s.size}` }
  } catch {
    return null
  }
}

/** Ghi nhật ký việc + note agent của các workspace. */
export class MemoryKeeper {
  readonly writer = noteWriter

  /** `agentId` null = cài đặt của workspace (dùng cho `_INDEX.md`). */
  constructor(private cfg: (ws: Workspace, agentId: string | null) => MemorySettings) {}

  private agentsDir(ws: Workspace): string {
    return join(ws.vaultPath, '60 Agents')
  }

  /** Vault có cấu trúc của stag.ai (để không tạo `40 Log/` trong vault tự do của người dùng). */
  private async structured(ws: Workspace): Promise<boolean> {
    return (await exists(join(ws.vaultPath, '_INDEX.md'))) || (await exists(join(ws.vaultPath, '40 Log')))
  }

  /** Việc vừa đóng: dòng nhật ký + dòng "Work done" (theo cài đặt của agent làm việc đó), rồi cất bớt nếu note quá hạn mức. */
  async taskClosed(ws: Workspace, c: ClosedTask): Promise<void> {
    const cfg = this.cfg(ws, c.task.agentId)
    const date = localDate(c.task.doneAt ?? new Date().toISOString())
    if (cfg.workLog && (await this.structured(ws))) {
      const line = logLine(c)
      await this.writer.update(join(ws.vaultPath, '40 Log', `${date}.md`), (text) =>
        text === null ? newDailyLog(date, [line]) : text.includes(line) ? null : insertInSection(text, LOG_SECTION, [line])
      )
    }
    if (cfg.agentWorkDone) {
      const line = workDoneLine(c)
      const file = join(this.agentsDir(ws), `${c.task.agentName}.md`)
      // Note agent chưa có (agent chưa từng mở phiên / đã xoá note): không tạo mới ở đây.
      await this.writer.update(file, (text) =>
        text === null || text.includes(line) ? null : touchUpdated(insertInSection(text, WORK_DONE_SECTION, [line]), date)
      )
    }
    await this.compact(ws, c.task.agentName, cfg)
    await this.compactIndex(ws, this.cfg(ws, null)).catch((e) => console.error('[memory] _INDEX', e))
  }

  /** Note cất của `_INDEX.md`: trong `00 Meta/` nếu vault có thư mục đó, không thì cạnh `_INDEX.md`. */
  async indexArchiveFile(ws: Workspace): Promise<string> {
    const meta = join(ws.vaultPath, '00 Meta')
    return join((await exists(meta)) ? meta : ws.vaultPath, `${INDEX_ARCHIVE}.md`)
  }

  /**
   * `_INDEX.md` quá hạn mức → dời mục đã xong cũ hơn `indexKeepDays` ngày sang `_INDEX archive` (xem splitIndexDone).
   * Ghi note cất TRƯỚC rồi mới thu gọn `_INDEX` (hỏng giữa chừng thì mục nằm hai nơi chứ không mất). Trả về số mục đã dời.
   * `force` (nút "Dọn ngay" trong Cài đặt) = dọn cả khi `_INDEX` chưa quá hạn mức; quy tắc số ngày vẫn giữ.
   */
  async compactIndex(ws: Workspace, cfg: MemorySettings, now = new Date(), force = false): Promise<number> {
    if (!cfg.indexArchive && !force) return 0
    const over = (text: string): boolean => force || sizeKb(text) > cfg.indexBudgetKb
    const file = join(ws.vaultPath, '_INDEX.md')
    const today = localDate(now.toISOString())
    const archiveFile = await this.indexArchiveFile(ws)
    const saved = new Set<string>()
    let count = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readText(file)
      if (cur === null || !over(cur)) return count
      const plan = splitIndexDone(cur, cfg.indexKeepDays, today)
      if (!plan.moved.length) return count
      const fresh = plan.moved.filter((m) => !saved.has(m.text))
      await this.writer.update(archiveFile, (text) => {
        for (const m of fresh) saved.add(m.text)
        return addToIndexArchive(text ?? newIndexArchive(today), fresh, today)
      })
      let retry = false
      await this.writer.update(file, (text) => {
        if (text === null || !over(text)) return null
        const r = splitIndexDone(text, cfg.indexKeepDays, today)
        if (!r.moved.length) return null
        // `_INDEX` đổi giữa lúc đọc và lúc ghi: còn mục chưa cất thì cất rồi thử lại.
        if (r.moved.some((m) => !saved.has(m.text))) {
          retry = true
          return null
        }
        count = r.moved.length
        return r.note
      })
      if (!retry) break
    }
    return count
  }

  /**
   * Note agent quá hạn mức → cất mục "Work done" cũ (giữ `keepWorkDone` mục mới nhất) sang note cất.
   * Trả về độ dài note sau khi cất (null = chưa có note).
   */
  async compact(ws: Workspace, agentName: string, cfg: MemorySettings): Promise<{ kb: number; archive: string } | null> {
    const file = join(this.agentsDir(ws), `${agentName}.md`)
    const archive = archiveName(agentName)
    const archiveFile = join(this.agentsDir(ws), `${archive}.md`)
    const date = localDate(new Date().toISOString())
    /** Mục đã nằm trong note cất (chỉ những mục này mới được bỏ khỏi note agent). */
    const saved = new Set<string>()
    const toArchive = async (items: string[]): Promise<void> => {
      await this.writer.update(archiveFile, (text) => {
        const fresh = items.filter((i) => text === null || !hasItem(text, i))
        for (const i of items) saved.add(i)
        return fresh.length ? touchUpdated(insertInSection(text ?? newArchive(agentName, date), WORK_DONE_SECTION, fresh), date) : null
      })
    }
    // Ghi note cất TRƯỚC rồi mới rút gọn note agent: ghi hỏng giữa chừng thì mục bị chép hai nơi chứ không mất.
    let result: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readText(file)
      if (cur === null || sizeKb(cur) <= cfg.noteBudgetKb) return cur === null ? null : { kb: sizeKb(cur), archive }
      const plan = splitWorkDone(cur, cfg.keepWorkDone, archive)
      if (!plan.moved.length) return { kb: sizeKb(cur), archive }
      await toArchive(plan.moved.filter((i) => !saved.has(i)))
      let retry = false
      await this.writer.update(file, (text) => {
        result = text
        if (text === null || sizeKb(text) <= cfg.noteBudgetKb) return null
        const r = splitWorkDone(text, cfg.keepWorkDone, archive)
        if (!r.moved.length) return null
        // Note đổi giữa lúc đọc và lúc ghi: có mục chưa cất thì cất rồi thử lại.
        if (r.moved.some((i) => !saved.has(i))) {
          retry = true
          return null
        }
        result = r.note
        return r.note
      })
      if (!retry) break
    }
    const text = result as string | null
    return text === null ? null : { kb: sizeKb(text), archive }
  }

  /** Agent đổi tên: đổi tên note cất và các liên kết giữa note agent ↔ note cất (note agent đã được đổi tên trước đó). */
  async renameAgent(ws: Workspace, from: string, to: string): Promise<void> {
    const dir = this.agentsDir(ws)
    const oldFile = join(dir, `${archiveName(from)}.md`)
    const newFile = join(dir, `${archiveName(to)}.md`)
    if ((await exists(oldFile)) && !(await exists(newFile))) {
      await fs.rename(oldFile, newFile)
      await this.writer.update(newFile, (text) =>
        text === null
          ? null
          : text
              .split(`[[${from}]]`)
              .join(`[[${to}]]`)
              .replace(new RegExp(`^# ${escapeRegExp(archiveName(from))}$`, 'm'), () => `# ${archiveName(to)}`)
      )
    }
    await this.writer.update(join(dir, `${to}.md`), (text) => (text === null ? null : text.split(`[[${archiveName(from)}]]`).join(`[[${archiveName(to)}]]`)))
  }

  /** Đường dẫn note cất (để chuyển vào Thùng rác khi xoá agent). */
  archiveFile(ws: Workspace, agentName: string): string {
    return join(this.agentsDir(ws), `${archiveName(agentName)}.md`)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
