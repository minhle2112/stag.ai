// Đọc / sửa từng phần của một note (heading, trường frontmatter) và sửa link khi đổi tên note — cho tool memory_* của
// agent (xem vault "Memory tools"). Chỉ hiểu phần markdown / YAML đơn giản mà vault dùng, giống wikilink.ts.

import { extractLinks, resolveNote, splitFrontmatter, splitWikilink, type NoteRef } from './wikilink'

export interface Heading {
  level: number
  text: string
  /** Dòng (tính từ 0, kể cả frontmatter) của heading. */
  line: number
}

/** Mọi heading `#` của note, bỏ qua frontmatter và khối code. */
export function headings(md: string): Heading[] {
  const lines = md.split(/\r?\n/)
  const { bodyLine } = splitFrontmatter(md)
  const out: Heading[] = []
  let fence: string | null = null
  for (let i = bodyLine - 1; i < lines.length; i++) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i])
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    // Dấu `#` đóng chỉ tính khi có khoảng trắng trước (CommonMark): `## C#` là "C#", `## Tên ##` là "Tên".
    const m = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(lines[i])
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i })
  }
  return out
}

/** Cây heading dạng thụt lề, cho memory_outline. */
export function outlineText(md: string): string {
  return headings(md)
    .map((h) => `${'  '.repeat(h.level - 1)}${'#'.repeat(h.level)} ${h.text}`)
    .join('\n')
}

const norm = (s: string): string => s.replace(/^#+\s*/, '').trim().toLowerCase()

export interface Section {
  heading: Heading
  /** Dòng đầu tiên của phần thân (ngay sau heading). */
  bodyStart: number
  /** Dòng ngay sau phần cuối (heading cùng cấp hoặc cao hơn tiếp theo, hoặc hết note). */
  end: number
}

/**
 * Tìm phần dưới một heading. `path` = tên heading (không phân biệt hoa thường, bỏ `#` ở đầu) hoặc đường dẫn
 * `Cha > Con` khi tên trùng. Không có → null; nhiều phần cùng tên mà không chỉ rõ → báo lỗi.
 */
export function findSection(md: string, path: string): Section | null {
  const all = headings(md)
  const parts = path.split('>').map(norm).filter(Boolean)
  if (!parts.length) return null
  const want = parts[parts.length - 1]
  const matches = all.filter((h, idx) => {
    if (norm(h.text) !== want) return false
    // Kiểm các cấp cha (đi ngược lên, mỗi cha có cấp nhỏ hơn).
    let level = h.level
    let p = parts.length - 2
    for (let j = idx - 1; j >= 0 && p >= 0; j--) {
      if (all[j].level >= level) continue
      level = all[j].level
      if (norm(all[j].text) === parts[p]) p--
    }
    return p < 0
  })
  if (!matches.length) return null
  if (matches.length > 1) throw new Error(`Several headings are named "${path}". Use the parent path, e.g. "Parent > ${matches[0].text}".`)
  const h = matches[0]
  const next = all.find((x) => x.line > h.line && x.level <= h.level)
  const total = md.split(/\r?\n/).length
  return { heading: h, bodyStart: h.line + 1, end: next ? next.line : total }
}

/** Nội dung dưới heading (không gồm dòng heading), bỏ dòng trống ở hai đầu. */
export function readSection(md: string, path: string): string | null {
  const s = findSection(md, path)
  if (!s) return null
  return md.split(/\r?\n/).slice(s.bodyStart, s.end).join('\n').replace(/^\s*\n/, '').trimEnd()
}

export type PatchOp = 'replace' | 'append' | 'prepend'

const eol = (md: string): string => (md.includes('\r\n') ? '\r\n' : '\n')

/** Thay / thêm cuối / thêm đầu phần dưới một heading. Không có heading → lỗi (hoặc tạo cuối note nếu `create`). */
export function patchSection(md: string, path: string, op: PatchOp, content: string, create = false): string {
  const nl = eol(md)
  const lines = md.split(/\r?\n/)
  const body = content.replace(/\r?\n/g, nl).replace(/\s+$/, '')
  const s = findSection(md, path)
  if (!s) {
    if (!create) throw new Error(`No heading "${path}" in this note. Call memory_outline to see its headings.`)
    const name = path.split('>').pop()!.trim().replace(/^#+\s*/, '')
    const base = md.replace(/\s+$/, '')
    return `${base}${base ? nl + nl : ''}## ${name}${nl}${nl}${body}${nl}`
  }
  const old = lines.slice(s.bodyStart, s.end)
  // Giữ một dòng trống trước heading tiếp theo.
  const trail = s.end < lines.length ? [''] : []
  const trimmed = trimBlank(old)
  let next: string[]
  if (op === 'replace') next = ['', ...body.split(nl), ...trail]
  else if (op === 'append') next = ['', ...(trimmed.length ? [...trimmed, ''] : []), ...body.split(nl), ...trail]
  else next = ['', ...body.split(nl), ...(trimmed.length ? ['', ...trimmed] : []), ...trail]
  const out = [...lines.slice(0, s.bodyStart), ...next, ...lines.slice(s.end)].join(nl)
  return s.end < lines.length ? out : out.replace(/\s*$/, nl)
}

function trimBlank(lines: string[]): string[] {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

/** Tên các khoá cấp cao nhất trong frontmatter. */
export function frontmatterKeys(md: string): string[] {
  const { frontmatter } = splitFrontmatter(md)
  if (!frontmatter) return []
  return frontmatter
    .split(/\r?\n/)
    .map((l) => /^([A-Za-z_][\w-]*)\s*:/.exec(l)?.[1])
    .filter((k): k is string => !!k)
}

/** Vị trí một khoá trong frontmatter: dòng của khoá + các dòng danh sách `- x` / thụt lề ngay sau. */
function fieldRange(fmLines: string[], key: string): { start: number; end: number } | null {
  const k = key.trim().toLowerCase()
  for (let i = 0; i < fmLines.length; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*:/.exec(fmLines[i])
    if (!m || m[1].toLowerCase() !== k) continue
    let j = i + 1
    while (j < fmLines.length && /^(\s+\S|\s*-\s)/.test(fmLines[j])) j++
    return { start: i, end: j }
  }
  return null
}

/** Giá trị thô (YAML) của một trường frontmatter; không có → null. */
export function readField(md: string, key: string): string | null {
  const { frontmatter } = splitFrontmatter(md)
  if (!frontmatter) return null
  const lines = frontmatter.split(/\r?\n/)
  const r = fieldRange(lines, key)
  if (!r) return null
  const first = lines[r.start].replace(/^[^:]*:\s*/, '')
  const rest = lines.slice(r.start + 1, r.end)
  return [first, ...rest].filter((l, i) => i > 0 || l.trim()).join('\n').trim()
}

/**
 * Giá trị YAML một dòng hợp lệ: `[…]` / `{…}` / chuỗi đã có ngoặc kép giữ nguyên; chữ thường mà YAML sẽ đọc sai
 * (`a: b`, `#x`, `- x`, `@x`, `x #y`…) thì đặt trong ngoặc kép.
 */
export function yamlValue(v: string): string {
  const t = v.replace(/\r?\n/g, ' ').trim()
  if (/^\[.*\]$/.test(t) || /^\{.*\}$/.test(t) || /^"(?:[^"\\]|\\.)*"$/.test(t) || /^'(?:[^']|'')*'$/.test(t)) return t
  const plain = t !== '' && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(t) && !/:(\s|$)/.test(t) && !/\s#/.test(t)
  const dash = /^-[^\s-]/.test(t) // số âm / chữ bắt đầu bằng '-' liền chữ vẫn là chữ thường hợp lệ
  return plain || dash ? t : `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Ghi một trường frontmatter (`value` là YAML một dòng, vd `done` hoặc `[a, b]`); null = xoá trường. Chưa có frontmatter thì tạo. */
export function writeField(md: string, key: string, value: string | null): string {
  if (!/^[A-Za-z_][\w-]*$/.test(key.trim())) throw new Error(`Bad frontmatter key "${key}"`)
  const nl = eol(md)
  const line = value === null ? null : `${key.trim()}: ${yamlValue(value)}`
  const { frontmatter, body } = splitFrontmatter(md)
  if (frontmatter === null) {
    if (line === null) return md
    return `---${nl}${line}${nl}---${nl}${md}`
  }
  const lines = frontmatter.split(/\r?\n/)
  const r = fieldRange(lines, key)
  if (r) lines.splice(r.start, r.end - r.start, ...(line === null ? [] : [line]))
  else if (line !== null) lines.push(line)
  return `---${nl}${lines.join(nl)}${nl}---${nl}${body}`
}

/** Tên hiển thị của note (tên file bỏ `.md`). */
export const noteName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/**
 * Sửa link trong `md` (note `fromRel`) đang trỏ tới `oldRel` thành trỏ tới `newRel` (sau khi đổi tên / chuyển note).
 * `notes` = danh sách note TRƯỚC khi đổi. `fromRel === oldRel` = chính note bị chuyển. Xem `repointLinks`.
 */
export function rewriteLinks(md: string, fromRel: string, oldRel: string, newRel: string, notes: readonly NoteRef[]): { text: string; count: number } {
  const moved = (rel: string): string => (rel === oldRel ? newRel : rel)
  return repointLinks(md, fromRel, moved(fromRel), notes, notes.map((n) => ({ rel: moved(n.rel) })), moved)
}

/**
 * Sau khi đổi tên / chuyển note: mỗi link trong `md` (note ở `srcBefore`, giờ ở `srcAfter`) trước trỏ tới note X
 * (phân giải theo `before`) thì sau vẫn phải trỏ tới `moved(X)` (phân giải theo `after`); link nào lệch thì viết lại.
 * Sửa được cả link tới note bị chuyển, link bằng tên tới một note khác trùng tên mới (không bị "cướp" sang note bị
 * chuyển), và link tương đối trong chính note bị chuyển. Link vẫn đúng thì giữ nguyên chữ.
 * Giữ `#heading`, `|bí danh`, `!` nhúng; bỏ qua code. Link wiki viết bằng tên → tên (đường dẫn đầy đủ nếu tên trùng
 * note khác); link markdown → đường dẫn tương đối từ thư mục mới của note nguồn. Trả về chuỗi mới và số link đã sửa.
 */
export function repointLinks(
  md: string,
  srcBefore: string,
  srcAfter: string,
  before: readonly NoteRef[],
  after: readonly NoteRef[],
  moved: (rel: string) => string
): { text: string; count: number } {
  /** Note mà link phải trỏ tới sau khi chuyển; null = link không cần sửa. */
  const fix = (target: string): string | null => {
    const old = resolveNote(target, srcBefore, before)
    if (!old) return null
    const want = moved(old)
    return resolveNote(target, srcAfter, after) === want ? null : want
  }
  if (!extractLinks(md).some((l) => l.target && fix(l.target))) return { text: md, count: 0 }
  const unique = (rel: string): boolean => after.filter((n) => noteName(n.rel).toLowerCase() === noteName(rel).toLowerCase()).length === 1
  const lines = md.split(/(\r?\n)/)
  let count = 0
  let fence: string | null = null
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i]
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    // Không sửa trong `code`.
    const code: Array<[number, number]> = []
    for (const m of line.matchAll(/(`+)[^`]*?\1/g)) code.push([m.index!, m.index! + m[0].length])
    const inCode = (at: number): boolean => code.some(([a, b]) => at >= a && at < b)
    let out = line.replace(/(!?)\[\[([^[\]\n]+?)\]\]/g, (all, bang: string, inner: string, at: number) => {
      if (inCode(at)) return all
      const { target, heading, alias } = splitWikilink(inner)
      const want = target ? fix(target) : null
      if (!want) return all
      count++
      const t = target.includes('/') || !unique(want) ? want.replace(/\.md$/i, '') : noteName(want)
      return `${bang}[[${t}${heading ? `#${heading}` : ''}${alias ? `|${alias}` : ''}]]`
    })
    out = out.replace(/(!?\[[^\]\n]*\]\(\s*<?)([^)\s>]+)(>?(?:\s+["'][^"'\n]*["'])?\s*\))/g, (all, pre: string, href: string, post: string, at: number) => {
      if (inCode(at) || /^[a-z][a-z0-9+.-]*:/i.test(href)) return all
      let decoded = href
      try {
        decoded = decodeURI(href)
      } catch {
        // giữ nguyên
      }
      const hash = decoded.indexOf('#')
      const target = (hash === -1 ? decoded : decoded.slice(0, hash)).trim()
      const want = target ? fix(target) : null
      if (!want) return all
      count++
      const frag = hash === -1 ? '' : decoded.slice(hash)
      return `${pre}${encodeURI(relativePath(srcAfter, want) + frag)}${post}`
    })
    lines[i] = out
  }
  return { text: lines.join(''), count }
}

/** Đường dẫn từ thư mục của `fromRel` tới `toRel` (cả hai tương đối trong vault). */
function relativePath(fromRel: string, toRel: string): string {
  const from = fromRel.split('/').slice(0, -1)
  const to = toRel.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i].toLowerCase() === to[i].toLowerCase()) i++
  return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/')
}
