// Đọc link trong note theo cách Obsidian hiểu, dùng chung cho main (chỉ mục vault) và renderer (bấm link).
// Chỉ đọc, không sửa note: vault vẫn mở song song được bằng Obsidian thật.

/** Một link tìm thấy trong note. */
export interface ParsedLink {
  /** Phần trỏ tới note/file, đã bỏ `|bí danh` và `#heading`; rỗng = chính note này (`[[#heading]]`). */
  target: string
  heading: string | null
  alias: string | null
  /** `![[...]]` hoặc `![](...)`. */
  embed: boolean
  /** `wiki` = `[[...]]`, `md` = `[chữ](đường/dẫn.md)`. */
  kind: 'wiki' | 'md'
  /** Dòng (tính từ 1, kể cả frontmatter) chứa link. */
  line: number
}

/** Thuộc tính đọc từ frontmatter mà app dùng. */
export interface NoteMeta {
  type: string | null
  aliases: string[]
  tags: string[]
}

/** Đuôi file đính kèm (ảnh, pdf…): link tới chúng không phải link tới note. */
const ATTACHMENT_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico|pdf|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|canvas|base|excalidraw)$/i

/** Link tới file đính kèm (ảnh, pdf…) chứ không phải note. */
export function isAttachment(target: string): boolean {
  return ATTACHMENT_EXT.test(target.trim())
}

/** Tách frontmatter `---` ở đầu note. `bodyLine` là số dòng (từ 1) nơi phần thân bắt đầu. */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string; bodyLine: number } {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md)
  if (!m) return { frontmatter: null, body: md, bodyLine: 1 }
  const consumed = m[0]
  return { frontmatter: m[1], body: md.slice(consumed.length), bodyLine: (consumed.match(/\n/g)?.length ?? 0) + 1 }
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

/** Giá trị một dòng YAML thành danh sách: `[a, b]`, `a, b` (tags) hoặc một giá trị. */
function inlineList(v: string): string[] {
  const t = v.trim()
  if (!t) return []
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t
  return inner
    .split(',')
    .map(unquote)
    .filter(Boolean)
}

/**
 * Đọc `type`, `aliases` (`alias`), `tags` (`tag`) trong frontmatter. Chỉ hiểu phần YAML đơn giản
 * mà vault dùng: `key: value`, `key: [a, b]` và danh sách `- a` ở các dòng sau.
 */
export function parseNoteMeta(frontmatter: string | null): NoteMeta {
  const meta: NoteMeta = { type: null, aliases: [], tags: [] }
  if (!frontmatter) return meta
  const lines = frontmatter.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const key = m[1].toLowerCase()
    let values = inlineList(m[2])
    if (!m[2].trim()) {
      values = []
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) values.push(unquote(lines[++i].replace(/^\s*-\s+/, '')))
    }
    if (key === 'type') meta.type = values.length ? unquote(m[2]) || null : null
    else if (key === 'aliases' || key === 'alias') meta.aliases.push(...values)
    else if (key === 'tags' || key === 'tag') meta.tags.push(...values.map((t) => t.replace(/^#/, '')))
  }
  return meta
}

/** Tách phần trong `[[...]]` thành đích, heading, bí danh. `\|` (trong bảng) được coi là `|`. */
export function splitWikilink(inner: string): { target: string; heading: string | null; alias: string | null } {
  const raw = inner.replace(/\\\|/g, '|')
  const bar = raw.indexOf('|')
  const left = bar === -1 ? raw : raw.slice(0, bar)
  const alias = bar === -1 ? null : raw.slice(bar + 1).trim() || null
  const hash = left.indexOf('#')
  const target = (hash === -1 ? left : left.slice(0, hash)).trim()
  const heading = hash === -1 ? null : left.slice(hash + 1).trim() || null
  return { target, heading, alias }
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g
const MD_LINK = /(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Mọi link trong note (cả frontmatter, như Obsidian), bỏ qua link trong khối code và `code`.
 * Link markdown chỉ lấy khi trỏ tới file trong vault (không có `http:` …).
 */
export function extractLinks(md: string): ParsedLink[] {
  const links: ParsedLink[] = []
  const lines = md.split(/\r?\n/)
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
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
    // Bỏ `code` trong dòng (thay bằng khoảng trắng để không lệch gì khác).
    const text = line.replace(/(`+)[^`]*?\1/g, (s) => ' '.repeat(s.length))
    for (const m of text.matchAll(WIKI)) {
      const { target, heading, alias } = splitWikilink(m[2])
      links.push({ target, heading, alias, embed: m[1] === '!', kind: 'wiki', line: i + 1 })
    }
    for (const m of text.matchAll(MD_LINK)) {
      let href = m[2]
      if (SCHEME.test(href)) continue
      try {
        href = decodeURI(href)
      } catch {
        // giữ nguyên nếu không giải mã được
      }
      const hash = href.indexOf('#')
      const target = (hash === -1 ? href : href.slice(0, hash)).trim()
      const heading = hash === -1 ? null : href.slice(hash + 1).trim() || null
      links.push({ target, heading, alias: null, embed: m[1] === '!', kind: 'md', line: i + 1 })
    }
  }
  return links
}

/** Thông tin tối thiểu về một note để phân giải link. */
export interface NoteRef {
  /** Đường dẫn tương đối trong vault, phân cách '/', có đuôi `.md`. */
  rel: string
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

function stripMd(p: string): string {
  return p.replace(/\.md$/i, '')
}

/** Ghép đường dẫn tương đối `./` `../` với thư mục của note nguồn. */
function joinRel(dir: string, target: string): string | null {
  const parts = dir ? dir.split('/') : []
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * Phân giải đích link thành `rel` của note trong vault (null = chưa có note đó → node "ma").
 * Giống Obsidian:
 * - `[[Tên]]`: theo tên file, không phân biệt hoa thường; trùng tên thì ưu tiên note cùng thư mục, rồi đường dẫn ngắn nhất.
 * - `[[thư mục/Tên]]`: khớp đường dẫn đầy đủ, hoặc phần cuối đường dẫn.
 * - `./`, `../` (thường gặp ở link markdown): tính từ thư mục của note nguồn.
 * - `target` rỗng (`[[#heading]]`) = chính note nguồn.
 */
export function resolveNote(target: string, fromRel: string, notes: readonly NoteRef[]): string | null {
  const t = target.trim().replace(/\\/g, '/')
  if (!t) return fromRel
  if (isAttachment(t)) return null
  const fromDir = dirOf(fromRel)
  let want = stripMd(t).toLowerCase()
  if (want.startsWith('./') || want.startsWith('../')) {
    const joined = joinRel(fromDir.toLowerCase(), want)
    if (joined === null) return null
    want = joined
  }
  want = want.replace(/^\/+/, '')
  const keyed = notes.map((n) => ({ rel: n.rel, key: stripMd(n.rel).toLowerCase() }))

  let candidates: typeof keyed
  if (want.includes('/')) {
    const exact = keyed.find((n) => n.key === want)
    if (exact) return exact.rel
    candidates = keyed.filter((n) => n.key.endsWith('/' + want))
  } else {
    candidates = keyed.filter((n) => n.key.slice(n.key.lastIndexOf('/') + 1) === want)
  }
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0].rel
  const sameDir = candidates.find((n) => dirOf(n.rel).toLowerCase() === fromDir.toLowerCase())
  if (sameDir) return sameDir.rel
  return [...candidates].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || a.rel.localeCompare(b.rel))[0].rel
}
