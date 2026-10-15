// Tab "Sản phẩm": thứ agent tự nộp (tool artifact_publish), có phiên bản + góp ý theo mạch.
// Dữ liệu lưu ở `<dự án>/.stag/artifacts/index.json`, bản chụp mỗi lần nộp ở `.stag/artifacts/<id>/v<N>.<đuôi>`.
// File này: kiểu dữ liệu + logic thuần (tách khối tài liệu, giữ id khối giữa các bản, so sánh, neo góp ý, hộp
// "Cần bạn xem", gom việc theo ngày) — dùng chung cho main và renderer, test bằng vitest.

import { t } from './i18n'

/** Trạng thái một mạch góp ý.
 * - draft: người dùng viết, chưa gửi.
 * - queued: đã bấm gửi, chờ gõ vào phiên agent (agent đang làm / phiên đóng).
 * - sent: đã gõ vào phiên agent, chờ agent trả lời / sửa.
 * - you: agent trả lời (artifact_reply) → chờ người dùng.
 * - fixed: agent nộp bản mới kèm `fixes` → chờ người dùng xem lại.
 * - closed: người dùng đóng. */
export type CommentState = 'draft' | 'queued' | 'sent' | 'you' | 'fixed' | 'closed'

/** Góp ý gắn vào đâu trong sản phẩm. */
export type CommentAnchor =
  /** Tài liệu chữ: khối (id giữ qua các bản) + vị trí ký tự trong chữ hiển thị của khối + đoạn trích. */
  | { type: 'text'; block: string; off: number; quote: string }
  /** Ảnh / PDF: điểm ghim, toạ độ 0–1 theo khung (PDF: trang, từ 1). */
  | { type: 'pin'; x: number; y: number; page?: number }
  /** Video / audio: thời điểm (giây). */
  | { type: 'time'; t: number }
  /** Bảng (CSV / Excel): ô, vd. "B4", kèm giá trị lúc góp ý. */
  | { type: 'cell'; cell: string; sheet?: string; value: string }
  /** Cả sản phẩm. */
  | { type: 'general' }

export interface CommentMessage {
  by: 'user' | 'agent'
  /** Tên agent (by = agent). */
  name?: string
  text: string
  /** ISO. */
  at: string
  /** Agent hỏi lại kèm nút trả lời nhanh. */
  options?: string[]
}

export interface ArtifactComment {
  /** Duy nhất trong workspace (vd. "c12"); agent dùng trong artifact_reply / fixes. */
  id: string
  /** Bản người dùng đang xem khi góp ý. */
  v: number
  /** Số thứ tự trong sản phẩm (số trên ghim), cấp lúc tạo, không đổi. */
  no: number
  anchor: CommentAnchor
  state: CommentState
  /** Trạng thái trước khi người dùng gửi tin mới trong mạch (để "Huỷ gửi" trả về đúng chỗ). */
  prevState?: CommentState
  /** Agent báo đã sửa ở bản này. */
  fixedIn?: number
  thread: CommentMessage[]
  createdAt: string
  updatedAt: string
}

export interface ArtifactVersion {
  v: number
  /** ISO. */
  at: string
  /** Agent ghi gì cho lần nộp này ("Sửa theo 2 góp ý…"); bản đầu thường trống. */
  note: string
  /** Bản chụp, đường dẫn trong dự án ('/'), vd. ".stag/artifacts/a3/v2.md". */
  snapshot: string
  size: number
  sha256: string
  agentId: string
  agentName: string
  taskId: string | null
  /** Góp ý agent báo đã sửa ở bản này. */
  fixes?: string[]
  /** Tài liệu chữ: có danh sách khối ở `.stag/artifacts/<id>/v<N>.blocks.json`. */
  blocks?: boolean
}

export interface ArtifactRecord {
  /** Duy nhất trong workspace (vd. "a3"); cũng là tên thư mục bản chụp. */
  id: string
  /** File gốc trong dự án ('/'). */
  rel: string
  title: string
  description: string
  /** Agent nộp bản mới nhất. */
  agentId: string
  agentName: string
  /** Việc trên kanban của lần nộp mới nhất (null = không gắn việc). */
  taskId: string | null
  /** Tên việc lúc nộp (việc có thể đã bị xoá khỏi kanban). */
  taskTitle: string
  createdAt: string
  updatedAt: string
  versions: ArtifactVersion[]
  /** Bản mới nhất người dùng đã mở (0 = chưa mở). */
  seen: number
  comments: ArtifactComment[]
  /** Người dùng bấm "Gỡ khỏi danh sách" (file không bị xoá); nộp lại thì hiện lại. */
  hidden?: boolean
}

/** Một lần agent nộp không thành (báo ở trang việc, không ồn ào). */
export interface PublishFailure {
  at: string
  agentId: string
  agentName: string
  taskId: string | null
  file: string
  error: string
}

export interface ArtifactsSnapshot {
  artifacts: ArtifactRecord[]
  failures: PublishFailure[]
}

/** Một khối của tài liệu chữ (đoạn, tiêu đề, mục danh sách, khối code, bảng…). */
export interface DocBlock {
  id: string
  /** Nguồn markdown / chữ của khối. */
  text: string
}

// ---------- loại file ----------

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown'])
const TEXT_EXTS = new Set([
  'txt', 'text', 'log', 'rst', 'adoc', 'org', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php',
  'swift', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'sql', 'css', 'scss', 'less', 'vue', 'svelte', 'lua', 'r', 'dart', 'prisma', 'graphql'
])

export function extOfPath(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isMarkdownFile(rel: string): boolean {
  return MARKDOWN_EXTS.has(extOfPath(rel))
}

/** Tài liệu chữ: tách khối, so sánh tới từng chữ, góp ý bằng bôi chọn. */
export function isDocFile(rel: string): boolean {
  const e = extOfPath(rel)
  return MARKDOWN_EXTS.has(e) || TEXT_EXTS.has(e)
}

// ---------- tách khối ----------

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const HEADING = /^\s{0,3}#{1,6}(\s|$)/
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+/
const QUOTE = /^\s{0,3}>/
const TABLE = /^\s*\|/

/** Tách tài liệu thành khối. Markdown: tiêu đề, đoạn, từng mục danh sách, khối code, bảng, trích dẫn, vạch ngang;
 * chữ thường / code: đoạn cách nhau bởi dòng trống. */
export function splitBlocks(text: string, markdown: boolean): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  if (!markdown) {
    let cur: string[] = []
    for (const l of lines) {
      if (l.trim()) cur.push(l)
      else if (cur.length) {
        out.push(cur.join('\n'))
        cur = []
      }
    }
    if (cur.length) out.push(cur.join('\n'))
    return out
  }
  let i = 0
  // Frontmatter YAML ở đầu file.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---')
    if (end > 0) {
      out.push(lines.slice(0, end + 1).join('\n'))
      i = end + 1
    }
  }
  const startsBlock = (l: string): boolean => FENCE.test(l) || HEADING.test(l) || HR.test(l) || LIST.test(l) || QUOTE.test(l) || TABLE.test(l)
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(l)
    if (fence) {
      const mark = fence[1]
      let j = i + 1
      while (j < lines.length && !(lines[j].trim().startsWith(mark[0].repeat(mark.length)) && lines[j].trim().replace(/[`~]/g, '') === '')) j++
      out.push(lines.slice(i, Math.min(j + 1, lines.length)).join('\n'))
      i = j + 1
      continue
    }
    if (HEADING.test(l) || HR.test(l)) {
      out.push(l)
      i++
      continue
    }
    if (TABLE.test(l) || QUOTE.test(l)) {
      const re = TABLE.test(l) ? TABLE : QUOTE
      let j = i + 1
      while (j < lines.length && lines[j].trim() && re.test(lines[j])) j++
      out.push(lines.slice(i, j).join('\n'))
      i = j
      continue
    }
    if (LIST.test(l)) {
      // Một mục: dòng đầu + các dòng tiếp theo (không phải mục mới, không phải khối khác). Mục con là khối riêng.
      let j = i + 1
      while (j < lines.length) {
        const n = lines[j]
        if (!n.trim() || startsBlock(n)) break
        j++
      }
      out.push(lines.slice(i, j).join('\n'))
      i = j
      continue
    }
    let j = i + 1
    while (j < lines.length && lines[j].trim() && !startsBlock(lines[j])) j++
    out.push(lines.slice(i, j).join('\n'))
    i = j
  }
  return out
}

/** Loại khối (chỉ ghép id giữa hai khối cùng loại). */
export function blockKind(text: string): 'heading' | 'list' | 'code' | 'table' | 'quote' | 'hr' | 'meta' | 'para' {
  if (text.startsWith('---\n')) return 'meta'
  if (FENCE.test(text)) return 'code'
  if (HEADING.test(text)) return 'heading'
  if (HR.test(text)) return 'hr'
  if (LIST.test(text)) return 'list'
  if (TABLE.test(text)) return 'table'
  if (QUOTE.test(text)) return 'quote'
  return 'para'
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []

/** Độ giống nhau 0–1 của hai đoạn chữ (Dice trên tập từ). */
export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.length && !y.length) return a.trim() === b.trim() ? 1 : 0
  if (!x.length || !y.length) return 0
  const count = new Map<string, number>()
  for (const w of x) count.set(w, (count.get(w) ?? 0) + 1)
  let both = 0
  for (const w of y) {
    const n = count.get(w) ?? 0
    if (n > 0) {
      both++
      count.set(w, n - 1)
    }
  }
  return (2 * both) / (x.length + y.length)
}

/** Cặp chỉ số (i trong a, j trong b) của dãy con chung dài nhất theo `eq`. Dãy quá dài → chỉ ghép chữ giống hệt duy nhất. */
function lcsPairs<T, U>(a: readonly T[], b: readonly U[], eq: (x: T, y: U) => boolean, limit = 4_000_000): Array<[number, number]> {
  const n = a.length
  const m = b.length
  if (!n || !m) return []
  if (n * m > limit) {
    const pairs: Array<[number, number]> = []
    let j0 = 0
    for (let i = 0; i < n; i++)
      for (let j = j0; j < m; j++)
        if (eq(a[i], b[j])) {
          pairs.push([i, j])
          j0 = j + 1
          break
        }
    return pairs
  }
  const w = m + 1
  const L = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i * w + j] = eq(a[i], b[j]) ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1])
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      pairs.push([i, j])
      i++
      j++
    } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++
    else j++
  }
  return pairs
}

/** Ngưỡng giống nhau để coi một khối là "khối cũ đã sửa" (giữ id) thay vì khối mới. */
export const SAME_BLOCK = 0.4

/**
 * Gắn id cho các khối của bản mới: khối giống hệt bản trước giữ id (theo thứ tự), khối đã sửa (cùng loại, đủ giống, nằm
 * giữa hai khối giữ nguyên) cũng giữ id, còn lại là khối mới.
 */
export function assignBlockIds(prev: readonly DocBlock[], texts: readonly string[], newId: () => string): DocBlock[] {
  const ids: Array<string | null> = texts.map(() => null)
  const pairs = lcsPairs(prev, texts, (p, t) => p.text === t)
  for (const [i, j] of pairs) ids[j] = prev[i].id
  // Khoảng giữa hai cặp khớp: ghép khối đã sửa theo độ giống, giữ thứ tự.
  const bounds: Array<[number, number]> = [[-1, -1], ...pairs, [prev.length, texts.length]]
  for (let k = 0; k + 1 < bounds.length; k++) {
    const [pi, pj] = bounds[k]
    const [ni, nj] = bounds[k + 1]
    let p = pi + 1
    for (let j = pj + 1; j < nj; j++) {
      let best = -1
      let score = SAME_BLOCK
      for (let i = p; i < ni; i++) {
        if (blockKind(prev[i].text) !== blockKind(texts[j])) continue
        const s = similarity(prev[i].text, texts[j])
        if (s >= score) {
          score = s
          best = i
        }
      }
      if (best >= 0) {
        ids[j] = prev[best].id
        p = best + 1
      }
    }
  }
  return texts.map((text, j) => ({ id: ids[j] ?? newId(), text }))
}

// ---------- so sánh ----------

export type WordOp = { op: 'eq' | 'ins' | 'del'; text: string }

const tokens = (s: string): string[] => s.split(/(\s+|[.,;:!?()"'[\]{}<>/\\|`*_~=+-])/u).filter(Boolean)

/** So sánh tới từng chữ (để tô <ins>/<del> trong một khối đã sửa). */
export function wordDiff(a: string, b: string): WordOp[] {
  const x = tokens(a)
  const y = tokens(b)
  if (x.length * y.length > 250_000) return [...(a ? [{ op: 'del' as const, text: a }] : []), ...(b ? [{ op: 'ins' as const, text: b }] : [])]
  const pairs = lcsPairs(x, y, (p, q) => p === q)
  const out: WordOp[] = []
  const push = (op: WordOp['op'], text: string): void => {
    const last = out[out.length - 1]
    if (last?.op === op) last.text += text
    else out.push({ op, text })
  }
  let i = 0
  let j = 0
  for (const [pi, pj] of [...pairs, [x.length, y.length] as [number, number]]) {
    while (i < pi) push('del', x[i++])
    while (j < pj) push('ins', y[j++])
    if (pi < x.length) {
      push('eq', x[pi])
      i = pi + 1
      j = pj + 1
    }
  }
  return out
}

export type BlockDiffRow =
  | { kind: 'eq'; block: DocBlock }
  | { kind: 'ins'; block: DocBlock }
  | { kind: 'del'; block: DocBlock }
  | { kind: 'chg'; block: DocBlock; old: DocBlock }

/** So hai bản theo id khối: khối bị bỏ hiện đúng chỗ cũ (sau khối còn giữ đứng trước nó). */
export function blockDiff(old: readonly DocBlock[], cur: readonly DocBlock[]): BlockDiffRow[] {
  const curIds = new Set(cur.map((b) => b.id))
  const oldById = new Map(old.map((b) => [b.id, b]))
  const after = new Map<string, DocBlock[]>()
  let last = '^'
  for (const b of old) {
    if (curIds.has(b.id)) last = b.id
    else after.set(last, [...(after.get(last) ?? []), b])
  }
  const out: BlockDiffRow[] = []
  for (const b of after.get('^') ?? []) out.push({ kind: 'del', block: b })
  for (const b of cur) {
    const o = oldById.get(b.id)
    if (!o) out.push({ kind: 'ins', block: b })
    else if (o.text !== b.text) out.push({ kind: 'chg', block: b, old: o })
    else out.push({ kind: 'eq', block: b })
    for (const d of after.get(b.id) ?? []) out.push({ kind: 'del', block: d })
  }
  return out
}

export function diffStats(rows: readonly BlockDiffRow[]): { add: number; chg: number; del: number } {
  let add = 0
  let chg = 0
  let del = 0
  for (const r of rows) {
    if (r.kind === 'ins') add++
    else if (r.kind === 'chg') chg++
    else if (r.kind === 'del') del++
  }
  return { add, chg, del }
}

// ---------- neo góp ý ----------

export type Located = { mode: 'exact' | 'fuzzy'; s: number; e: number } | { mode: 'whole' }

/**
 * Tìm đoạn trích trong chữ của khối (bản đang xem): đúng chỗ cũ → chỗ gần chỗ cũ nhất → gần đúng (phần đầu hoặc phần
 * cuối đoạn trích, ít nhất nửa số từ) → cả khối.
 */
export function locateQuote(text: string, anchor: { off: number; quote: string }): Located {
  const q = anchor.quote
  if (!q) return { mode: 'whole' }
  if (text.substr(anchor.off, q.length) === q) return { mode: 'exact', s: anchor.off, e: anchor.off + q.length }
  let best = -1
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) if (best < 0 || Math.abs(i - anchor.off) < Math.abs(best - anchor.off)) best = i
  if (best >= 0) return { mode: 'exact', s: best, e: best + q.length }
  const w = q.split(/\s+/).filter(Boolean)
  for (let n = w.length - 1; n >= Math.max(1, Math.ceil(w.length / 2)); n--) {
    const head = w.slice(0, n).join(' ')
    const i = nearest(text, head, anchor.off)
    if (i >= 0 && head.length >= 3) return { mode: 'fuzzy', s: i, e: i + head.length }
    const tail = w.slice(w.length - n).join(' ')
    const k = nearest(text, tail, anchor.off)
    if (k >= 0 && tail.length >= 3) return { mode: 'fuzzy', s: k, e: k + tail.length }
  }
  return { mode: 'whole' }
}

function nearest(text: string, q: string, off: number): number {
  let best = -1
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) if (best < 0 || Math.abs(i - off) < Math.abs(best - off)) best = i
  return best
}

// ---------- trạng thái cho giao diện ----------

/** Góp ý đang chờ người dùng (agent trả lời / báo đã sửa). */
export const needsYou = (c: ArtifactComment): boolean => c.state === 'you' || c.state === 'fixed'

export const latestVersion = (a: ArtifactRecord): ArtifactVersion => a.versions[a.versions.length - 1]

/** Số bản mới người dùng chưa mở. */
export const unseenVersions = (a: ArtifactRecord): number => Math.max(0, latestVersion(a).v - a.seen)

export interface InboxItem {
  artifactId: string
  /** Số bản mới chưa xem (0 = không có). */
  newVersions: number
  asks: number
  fixed: number
  /** Mở sản phẩm thì nhảy tới góp ý này (agent hỏi lại → góp ý đó; chỉ có "đã sửa" và không có bản mới → góp ý đó). */
  focus: string | null
  /** Câu phụ: lời agent mới nhất / ghi chú bản mới / "Kiểm tra ở vN". */
  sub: string
  updatedAt: string
}

/** Mục "Cần bạn xem": mỗi sản phẩm một dòng (bản mới, agent hỏi bạn, đã sửa chờ bạn xem). Mới nhất trước. */
export function inboxOf(arts: readonly ArtifactRecord[]): InboxItem[] {
  const out: InboxItem[] = []
  for (const a of arts) {
    if (a.hidden || !a.versions.length) continue
    const nv = unseenVersions(a)
    const asks = a.comments.filter((c) => c.state === 'you')
    const fixed = a.comments.filter((c) => c.state === 'fixed')
    if (!nv && !asks.length && !fixed.length) continue
    const lastAgent = asks[0] && [...asks[0].thread].reverse().find((m) => m.by === 'agent')
    const sub = lastAgent
      ? `${a.agentName}: ${lastAgent.text}`
      : nv
        ? latestVersion(a).note || t('artifacts.inbox.newVersion', { v: latestVersion(a).v })
        : t('artifacts.inbox.checkIn', { v: fixed[0].fixedIn ?? latestVersion(a).v })
    const focus = asks[0]?.id ?? (!nv && fixed[0] ? fixed[0].id : null)
    const times = [a.updatedAt, ...asks.map((c) => c.updatedAt), ...fixed.map((c) => c.updatedAt)]
    out.push({ artifactId: a.id, newVersions: nv, asks: asks.length, fixed: fixed.length, focus, sub, updatedAt: times.sort().at(-1)! })
  }
  return out.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
}

export type DayBucket = 'run' | 'today' | 'yday' | 'week' | 'older'

/** Nhóm của một việc ở cột trái: đang làm, rồi theo ngày xong (theo giờ máy). "Tuần này" = tuần lịch, từ thứ Hai. */
export function dayBucket(task: { status: string; doneAt?: string; createdAt: string }, now: Date = new Date()): DayBucket {
  if (task.status === 'open') return 'run'
  const t = new Date(task.doneAt ?? task.createdAt).getTime()
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  if (t >= new Date(y, m, d).getTime()) return 'today'
  if (t >= new Date(y, m, d - 1).getTime()) return 'yday'
  if (t >= new Date(y, m, d - ((now.getDay() + 6) % 7)).getTime()) return 'week'
  return 'older'
}

/** Lý do nộp không thành, nói với người dùng (lỗi gốc viết cho agent bằng tiếng Anh, xem main/artifactStore.ts). */
export function failureReason(error: string): string {
  if (/call task_start/i.test(error)) return t('artifacts.fail.noTask')
  if (/does not exist/i.test(error)) return t('artifacts.fail.missing')
  if (/outside the project/i.test(error)) return t('artifacts.fail.outside')
  if (/cannot be published/i.test(error)) return t('artifacts.fail.blocked')
  if (/too large/i.test(error)) return t('artifacts.fail.tooLarge')
  if (/is not a file/i.test(error)) return t('artifacts.fail.notFile')
  if (/title is empty/i.test(error)) return t('artifacts.fail.noTitle')
  if (/file is empty/i.test(error)) return t('artifacts.fail.noPath')
  return t('artifacts.fail.other')
}

/** Nhãn chữ tắt của agent (2 ký tự): "Dev Thực Chiến" → "DT", "Tester" → "TE". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Chữ hiển thị (bỏ ký hiệu markdown đầu dòng) của một khối, để so sánh từng chữ trong khối đã sửa. */
export function plainBlock(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, ''))
    .join('\n')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

/** Nhãn ngắn cho chỗ neo của góp ý (trong tin gửi agent / danh sách). */
export function anchorLabel(a: CommentAnchor, cut = 80): string {
  const clip = (s: string): string => {
    const t = s.replace(/\s+/g, ' ').trim()
    if (t.length <= cut) return t
    const sp = t.lastIndexOf(' ', cut)
    return `${t.slice(0, sp > cut * 0.6 ? sp : cut)}…`
  }
  switch (a.type) {
    case 'text':
      return `"${clip(a.quote)}"`
    case 'pin':
      return `pin at ${Math.round(a.x * 100)}% from left, ${Math.round(a.y * 100)}% from top${a.page ? ` of page ${a.page}` : ''}`
    case 'time':
      return `at ${formatTime(a.t)}`
    case 'cell':
      return `cell ${a.sheet ? `${a.sheet}!` : ''}${a.cell} ("${clip(a.value)}")`
    default:
      return 'the whole artifact'
  }
}

export function formatTime(t: number): string {
  const s = Math.max(0, Math.round(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
