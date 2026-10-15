// Hiện note markdown của vault thành HTML (chỉ đọc), hiểu cú pháp Obsidian: wikilink, nhúng, frontmatter, việc cần làm.
// Không chèn HTML thô từ note (html: false); mọi thuộc tính do app thêm đều đã escape.
import MarkdownIt from 'markdown-it'
import type { StateCore, StateInline, Token } from 'markdown-it'
import { isAttachment, resolveNote, splitFrontmatter, splitWikilink, type NoteRef } from '@shared/wikilink'
import { t as tr } from '@shared/i18n'
import { ICONS } from '../icons'

export interface NoteRenderCtx {
  /** `rel` của note đang hiện, để phân giải link (cùng thư mục, `./`, `[[#heading]]`). */
  current: string
  /** Note trong vault; null = chưa có chỉ mục → chưa đánh dấu link "ma". */
  notes: readonly NoteRef[] | null
  /**
   * Cách hiện frontmatter. Bỏ trống = bảng phẳng (Artifacts, Skills). 'closed' / 'open' = hộp thu gọn kiểu
   * "Properties" của Obsidian (`<details>`; một dòng tóm tắt, mở ra mới thấy bảng) — Vault dùng.
   */
  propsBox?: 'closed' | 'open'
}

export interface NoteProp {
  key: string
  value: string
}

export interface RenderedNote {
  html: string
  /** Thuộc tính trong frontmatter, theo thứ tự trong file. */
  props: NoteProp[]
}

// `type` (không phải interface) để gán được cho `Env` của markdown-it.
type Env = {
  current: string
  notes: readonly NoteRef[] | null
  /** Số dòng frontmatter đứng trước phần thân, cộng vào `data-line`. */
  lineOffset: number
}

interface WikiMeta {
  target: string
  heading: string | null
  alias: string | null
  embed: boolean
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// Không tự biến "stag.ai" thành link: chỉ link có http(s):// hoặc email.
md.linkify.set({ fuzzyLink: false })
const esc = md.utils.escapeHtml

const EXTERNAL = /^(https?:|mailto:)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

function baseName(p: string): string {
  return p.slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1)
}

function noteName(target: string): string {
  return baseName(target).replace(/\.md$/i, '')
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Phân giải đích; `undefined` = chưa có chỉ mục (không biết có "ma" hay không). */
function lookup(target: string, env: Env): string | null | undefined {
  return env.notes ? resolveNote(target, env.current, env.notes) : undefined
}

function attrs(list: Array<[string, string | null | undefined]>): string {
  return list
    .filter((a): a is [string, string] => a[1] !== null && a[1] !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('')
}

/** Chip cho file đính kèm (ảnh, pdf…): chỉ hiện tên, chưa tải file. */
function fileChip(target: string, label?: string | null): string {
  return `<span${attrs([['class', 'md-embed md-file'], ['title', target]])}>${esc(label || baseName(target))}</span>`
}

function renderWiki(m: WikiMeta, env: Env): string {
  if (m.target && isAttachment(m.target)) return fileChip(m.target, m.embed ? null : m.alias)
  const rel = lookup(m.target, env)
  const ghost = rel === null
  const cls = (m.embed ? 'md-embed md-embed-note' : 'wikilink') + (ghost ? ' ghost' : '')
  const name = m.target ? (m.embed ? noteName(m.target) : m.target) : ''
  let label = m.alias ?? (name && m.heading ? `${name} > ${m.heading}` : name || m.heading || '')
  if (m.embed) label = `↪ ${label}`
  const title = ghost ? tr('vault.ghostTitle') : (rel ?? m.target)
  return `<a${attrs([['class', cls], ['data-target', m.target], ['data-heading', m.heading], ['title', title]])}>${esc(label)}</a>`
}

/** `[[đích#heading|bí danh]]` và `![[...]]` (bỏ qua trong `code` vì backticks đã ăn trước). */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
  const end = src.indexOf(']]', pos + 2)
  if (end === -1 || end + 2 > state.posMax) return false
  const inner = src.slice(pos + 2, end)
  if (!inner.trim() || /[[\]\n]/.test(inner)) return false
  if (!silent) {
    const tok = state.push('wikilink', '', 0)
    tok.meta = { ...splitWikilink(inner), embed } satisfies WikiMeta
    tok.content = inner
  }
  state.pos = end + 2
  return true
}

/** Chữ thuần của một dòng inline (để làm id heading). */
function inlineText(children: Token[] | null): string {
  return (children ?? [])
    .map((t) => {
      if (t.type === 'text' || t.type === 'code_inline') return t.content
      if (t.type === 'softbreak' || t.type === 'hardbreak') return ' '
      if (t.type === 'wikilink') {
        const m = t.meta as unknown as WikiMeta
        return m.alias ?? (m.target || m.heading || '')
      }
      return ''
    })
    .join('')
    .trim()
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'muc'
  )
}

/** So khớp heading kiểu Obsidian: không phân biệt hoa thường, bỏ dấu câu. */
export function headingKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** `- [ ] việc` / `- [x] việc` → checkbox chỉ đọc. */
function taskLists(state: StateCore): void {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue
    const m = /^\[([ xX])\](?:[ \t]|$)/.exec(inline.content)
    const first = inline.children?.[0]
    if (!m || !first || first.type !== 'text' || !first.content.startsWith(m[0])) continue
    first.content = first.content.slice(m[0].length)
    const box = new state.Token('task_box', 'input', 0)
    box.meta = { checked: m[1] !== ' ' }
    inline.children!.unshift(box)
    const item = tokens[i - 2]
    item.attrJoin('class', 'task')
    for (let j = i - 3; j >= 0; j--) {
      const t = tokens[j]
      if (t.nesting === 1 && t.level === item.level - 1 && /_list_open$/.test(t.type)) {
        if (!t.attrGet('class')) t.attrSet('class', 'task-list')
        break
      }
    }
  }
}

/** Heading có `id` (để nhảy tới) và `data-heading` (chữ gốc, để so khớp `[[note#heading]]`). */
function headingIds(state: StateCore): void {
  const used = new Map<string, number>()
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue
    const text = inlineText(tokens[i + 1]?.children ?? null)
    const base = slug(text)
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    tokens[i].attrSet('id', n ? `${base}-${n}` : base)
    tokens[i].attrSet('data-heading', text)
  }
}

/** Mỗi khối gắn `data-line` = dòng nguồn (từ 1, tính cả frontmatter). */
function dataLines(state: StateCore): void {
  const off = (state.env as Env).lineOffset ?? 0
  for (const t of state.tokens) {
    if (t.map && t.block && t.nesting !== -1 && t.type !== 'inline') t.attrSet('data-line', String(t.map[0] + 1 + off))
  }
}

md.inline.ruler.before('link', 'wikilink', wikilinkRule)
md.core.ruler.push('task_lists', taskLists)
md.core.ruler.push('heading_ids', headingIds)
md.core.ruler.push('data_lines', dataLines)

md.renderer.rules.wikilink = (tokens, idx, _o, env) => renderWiki(tokens[idx].meta as unknown as WikiMeta, env as Env)
md.renderer.rules.task_box = (tokens, idx) =>
  `<input type="checkbox" class="md-task" disabled${(tokens[idx].meta as { checked: boolean }).checked ? ' checked' : ''}> `

// Link markdown: không để trình duyệt tự điều hướng (bỏ href); app đọc `data-*` khi bấm.
md.renderer.rules.link_open = (tokens, idx, opts, envAny, self) => {
  const t = tokens[idx]
  const env = envAny as Env
  const href = String(t.attrGet('href') ?? '')
  t.attrs = (t.attrs ?? []).filter(([k]) => k !== 'href')
  if (EXTERNAL.test(href)) {
    t.attrSet('class', 'md-ext')
    t.attrSet('data-href', href)
    t.attrSet('title', href)
  } else if (!SCHEME.test(href)) {
    const raw = decode(href)
    const hash = raw.indexOf('#')
    const target = (hash === -1 ? raw : raw.slice(0, hash)).trim()
    const heading = hash === -1 ? null : raw.slice(hash + 1).trim() || null
    const rel = target && isAttachment(target) ? null : lookup(target, env)
    if (rel || rel === undefined || /\.md$/i.test(target)) {
      t.attrSet('class', rel === null ? 'wikilink ghost' : 'wikilink')
      t.attrSet('data-target', target)
      if (heading) t.attrSet('data-heading', heading)
      t.attrSet('title', rel === null ? tr('vault.ghostTitle') : (rel ?? target))
    } else t.attrSet('class', 'md-link-other')
  } else t.attrSet('class', 'md-link-other')
  return self.renderToken(tokens, idx, opts)
}

// Ảnh `![chữ](đường/dẫn)`: chưa tải ảnh, chỉ hiện chip; nhúng note bằng link markdown thì như `![[note]]`.
md.renderer.rules.image = (tokens, idx, _o, envAny) => {
  const t = tokens[idx]
  const env = envAny as Env
  const src = decode(String(t.attrGet('src') ?? ''))
  if (!SCHEME.test(src) && !isAttachment(src)) {
    const hash = src.indexOf('#')
    const target = hash === -1 ? src : src.slice(0, hash)
    if (target && lookup(target, env) !== null)
      return renderWiki({ target, heading: hash === -1 ? null : src.slice(hash + 1) || null, alias: null, embed: true }, env)
  }
  return fileChip(src, t.content)
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1)
  return t
}

/** Thuộc tính frontmatter (YAML đơn giản): `key: value`, `key: [a, b]`, danh sách `- a`; dòng thụt lề khác gộp vào khoá trước. */
export function parseProps(frontmatter: string | null): NoteProp[] {
  if (!frontmatter) return []
  const props: NoteProp[] = []
  const parts: string[][] = []
  for (const line of frontmatter.split(/\r?\n/)) {
    const m = /^([^\s#:-][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(line)
    if (m) {
      props.push({ key: m[1].trim(), value: '' })
      parts.push(m[2]?.trim() ? [m[2].trim()] : [])
      continue
    }
    if (!props.length || !line.trim() || line.trim().startsWith('#')) continue
    parts[parts.length - 1].push(line.trim().replace(/^-\s+/, ''))
  }
  props.forEach((p, i) => {
    const vals = parts[i]
    if (vals.length === 1 && vals[0].startsWith('[') && vals[0].endsWith(']') && !vals[0].startsWith('[['))
      p.value = vals[0].slice(1, -1).split(',').map(unquote).filter(Boolean).join(', ')
    else p.value = vals.map(unquote).join(', ')
  })
  return props
}

/** Giá trị thuộc tính để xem lướt: `[[Note|bí danh]]` → chữ hiện, bỏ ngoặc. */
function plainValue(v: string): string {
  return v.replace(/\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
    const w = splitWikilink(inner)
    return w.alias ?? (w.target || w.heading || inner)
  })
}

/** Hộp thuộc tính thu gọn: một dòng "› Thuộc tính  type: index · updated: …", bấm để mở bảng. */
function propsBox(props: NoteProp[], rows: string, open: boolean): string {
  const peek = props.map((p) => (p.value ? `${p.key}: ${plainValue(p.value)}` : p.key)).join(' · ')
  const chevron = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ic shrink-0 transition-transform group-open:rotate-90">${ICONS.cr}</svg>`
  return (
    `<details class="md-propsbox group mb-4 rounded-md border border-line font-mono text-[12px] text-muted" data-line="1"${open ? ' open' : ''}>` +
    `<summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-dim select-none hover:text-muted [&::-webkit-details-marker]:hidden">` +
    `${chevron}<span class="shrink-0 font-sans">${esc(tr('vault.properties'))}</span>` +
    `<span class="min-w-0 flex-1 truncate group-open:invisible">${esc(peek)}</span></summary>` +
    `<div class="px-2.5"><table class="md-props"><tbody>${rows}</tbody></table></div></details>\n`
  )
}

/** Hiện note thành HTML: bảng thuộc tính (frontmatter) rồi phần thân. */
export function renderNote(source: string, ctx: NoteRenderCtx): RenderedNote {
  const { frontmatter, body, bodyLine } = splitFrontmatter(source)
  const env: Env = { ...ctx, lineOffset: bodyLine - 1 }
  const props = parseProps(frontmatter)
  let html = ''
  if (props.length) {
    const rows = props
      .map((p) => `<tr><th>${esc(p.key)}</th><td>${p.value ? md.renderInline(p.value, env) : ''}</td></tr>`)
      .join('')
    html += ctx.propsBox
      ? propsBox(props, rows, ctx.propsBox === 'open')
      : `<table class="md-props" data-line="1"><tbody>${rows}</tbody></table>\n`
  }
  html += md.render(body, env)
  return { html, props }
}
