import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { frontmatterKeys, noteName, outlineText, patchSection, readField, readSection, repointLinks, writeField, type PatchOp } from '@shared/noteSections'
import { isAttachment, resolveNote, splitFrontmatter } from '@shared/wikilink'
import { realPathInside } from './fsutil'
import { findSecrets } from './sessionLog'
import { fold, type Cached, type VaultIndexer } from './vaultIndex'
import type { NoteWriter } from './workLog'

// Tool memory_* của agent (MCP "stag"): đọc / tìm / sửa vault của workspace mà không cần Obsidian. Xem vault "Memory tools".

/** Nội dung trả về cho agent tối đa chừng này ký tự; dài hơn thì cắt và nhắc đọc theo heading. */
const MAX_READ_CHARS = 40_000
const MAX_LIST = 200
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export interface Touch {
  rel: string
  kind: 'read' | 'write'
}

export interface MemoryResult {
  text: string
  touched: Touch[]
}

export interface QueryFilter {
  type?: string
  tag?: string
  folder?: string
  links_to?: string
  linked_from?: string
  modified_since?: string
  /** `key` (có trường) hoặc `key=value` (giá trị khớp, không phân biệt hoa thường). */
  field?: string
  /** Có chữ này trong tên hoặc nội dung (không phân biệt dấu). */
  text?: string
  /** Gồm cả note mẫu (`_Template.md`, thư mục `Templates/`); mặc định bỏ qua. */
  include_templates?: boolean
  limit?: number
}

/** Note mẫu (không phải bộ nhớ thật): tên bắt đầu bằng `_Template`, hoặc nằm trong thư mục `Templates` / `_Templates`. */
export function isTemplate(rel: string): boolean {
  const segs = rel.toLowerCase().split('/')
  return segs[segs.length - 1].startsWith('_template') || segs.slice(0, -1).some((s) => s === 'templates' || s === '_templates')
}

/** Mã phiên bản nội dung note (để ghi không đè lên thay đổi của người khác). */
export function versionOf(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 10)
}

const BAD_NAME = /[\\:*?"<>|[\]#^]/

/**
 * Đường dẫn note agent đưa vào → `rel` chuẩn trong vault ('/', có `.md`). Nhận `[[Tên]]`, đường dẫn tuyệt đối trong
 * vault, thiếu đuôi `.md`. Chặn ra ngoài vault, thư mục ẩn (`.obsidian`, `.trash`), ký tự Obsidian không cho trong tên.
 */
export function toRel(vaultPath: string, note: string): string {
  let t = note.trim().replace(/^\[\[|\]\]$/g, '').trim()
  const bar = t.indexOf('|')
  if (bar !== -1) t = t.slice(0, bar)
  if (!t) throw new Error('Missing note name')
  if (isAbsolute(t)) {
    const r = relative(resolve(vaultPath), resolve(t))
    if (r.startsWith('..') || isAbsolute(r)) throw new Error(`"${note}" is outside the vault`)
    t = r
  }
  t = t.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (!/\.md$/i.test(t)) {
    if (/\.[a-z0-9]{1,5}$/i.test(t) && isAttachment(t)) throw new Error('Only .md notes can be read or written with memory tools')
    t += '.md'
  }
  const segs = t.split('/')
  for (const s of segs) {
    if (!s || s === '.' || s === '..') throw new Error(`Bad note path "${note}"`)
    if (s.startsWith('.')) throw new Error(`"${note}" is in a hidden folder; memory tools only use normal notes`)
  }
  const name = segs[segs.length - 1].replace(/\.md$/i, '')
  if (!name.trim() || BAD_NAME.test(segs.join('/').replace(/\//g, '')) || /\.$|\s$/.test(name))
    throw new Error(`Bad note name "${note}": no \\ : * ? " < > | [ ] # ^ and no trailing dot / space`)
  return segs.join('/')
}

/**
 * Đường dẫn đầy đủ của note trong vault. Kiểm tra theo đường dẫn thật (junction / symlink trỏ ra ngoài vault bị chặn;
 * note chưa có thì theo thư mục cha gần nhất), nhưng trả đường dẫn thường để khoá ghi của NoteWriter trùng với nơi khác.
 */
async function fullPath(vaultPath: string, rel: string): Promise<string> {
  const root = resolve(vaultPath)
  const full = resolve(root, rel)
  if (!full.startsWith(root + sep)) throw new Error('Path is outside the vault')
  try {
    await realPathInside(root, rel, true)
  } catch (e) {
    if ((e as { code?: string }).code === 'OUTSIDE') throw new Error(`${rel} is outside the vault (link / junction)`)
    throw e
  }
  return full
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Giờ địa phương kèm múi giờ, vd `2026-10-14 01:35 +02:00`. */
export function localStamp(ms: number): string {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const a = Math.abs(off)
  const zone = `${off < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`
}

/** Mốc `modified_since`: `YYYY-MM-DD` = nửa đêm giờ địa phương (như ngày hiện trong kết quả); dạng khác theo Date.parse. */
export function parseSince(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : Date.parse(s)
}

/** Đọc / tìm / sửa note của một vault cho agent. Dùng chung chỉ mục với Vault Viewer và bộ ghi với nhật ký việc. */
export class MemoryService {
  constructor(
    private indexer: VaultIndexer,
    private writer: NoteWriter,
    /** Giá trị trong kho bí mật của app: không cho agent ghi vào vault. */
    private knownSecrets: () => string[] = () => []
  ) {}

  private async notes(vaultPath: string): Promise<ReadonlyMap<string, Cached>> {
    return this.indexer.notes(vaultPath)
  }

  /** Note có sẵn theo tên / đường dẫn / bí danh; không có → lỗi kèm gợi ý. */
  async resolve(vaultPath: string, note: string): Promise<string> {
    const cache = await this.notes(vaultPath)
    const rels = [...cache.keys()]
    const raw = note.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim()
    let wanted: string | null = null
    try {
      wanted = toRel(vaultPath, raw)
    } catch {
      // không phải đường dẫn hợp lệ: thử theo tên / bí danh bên dưới
    }
    if (wanted) {
      const exact = rels.find((r) => r.toLowerCase() === wanted!.toLowerCase())
      if (exact) return exact
    }
    const byLink = resolveNote(raw.replace(/\\/g, '/'), '', rels.map((rel) => ({ rel })))
    if (byLink) return byLink
    const f = fold(raw)
    const alias = rels.find((r) => cache.get(r)!.meta.aliases.some((a) => fold(a) === f))
    if (alias) return alias
    const near = rels.filter((r) => fold(noteName(r)).includes(f) || f.includes(fold(noteName(r)))).slice(0, 5)
    throw new Error(`No note "${note}" in the vault.${near.length ? ` Did you mean: ${near.join(', ')}?` : ' Use memory_search or memory_list to find it.'}`)
  }

  /** Link ra / vào / chưa có note của một note. */
  private async linkInfo(vaultPath: string, rel: string): Promise<{ links: string[]; backlinks: string[]; unresolved: string[] }> {
    const cache = await this.notes(vaultPath)
    const refs = [...cache.keys()].map((r) => ({ rel: r }))
    const links = new Set<string>()
    const unresolved = new Set<string>()
    for (const l of cache.get(rel)?.links ?? []) {
      if (!l.target || isAttachment(l.target)) continue
      const to = resolveNote(l.target, rel, refs)
      if (to) {
        if (to !== rel) links.add(to)
      } else unresolved.add(l.target)
    }
    const backlinks = new Set<string>()
    for (const [from, c] of cache) {
      if (from === rel) continue
      if (c.links.some((l) => l.target && !isAttachment(l.target) && resolveNote(l.target, from, refs) === rel)) backlinks.add(from)
    }
    return { links: [...links], backlinks: [...backlinks], unresolved: [...unresolved] }
  }

  async read(vaultPath: string, note: string, o: { heading?: string; field?: string } = {}): Promise<MemoryResult> {
    const rel = await this.resolve(vaultPath, note)
    const text = await fs.readFile(await fullPath(vaultPath, rel), 'utf8')
    const touched: Touch[] = [{ rel, kind: 'read' }]
    if (o.field) {
      const v = readField(text, o.field)
      if (v === null) throw new Error(`${rel} has no frontmatter field "${o.field}". Fields: ${frontmatterKeys(text).join(', ') || '(none)'}`)
      return { text: v, touched }
    }
    if (o.heading) {
      const v = readSection(text, o.heading)
      if (v === null) throw new Error(`${rel} has no heading "${o.heading}". Headings:\n${outlineText(text) || '(none)'}`)
      return { text: `${rel} > ${o.heading} · version ${versionOf(text)}\n\n${cut(v)}`, touched }
    }
    const c = (await this.notes(vaultPath)).get(rel)
    const info = await this.linkInfo(vaultPath, rel)
    const st = await fs.stat(await fullPath(vaultPath, rel))
    const head = [
      `path: ${rel}`,
      `version: ${versionOf(text)} · modified ${localStamp(st.mtimeMs)} · ${Math.round(st.size / 102.4) / 10} KB`,
      c?.meta.tags.length ? `tags: ${c.meta.tags.join(', ')}` : '',
      `links: ${info.links.join(', ') || '(none)'}`,
      `backlinks: ${info.backlinks.join(', ') || '(none)'}`,
      info.unresolved.length ? `unresolved links: ${info.unresolved.join(', ')}` : ''
    ].filter(Boolean)
    return { text: `${head.join('\n')}\n---\n${cut(text, true)}`, touched }
  }

  async outline(vaultPath: string, note: string): Promise<MemoryResult> {
    const rel = await this.resolve(vaultPath, note)
    const text = await fs.readFile(await fullPath(vaultPath, rel), 'utf8')
    const keys = frontmatterKeys(text)
    return {
      text: `path: ${rel} · version ${versionOf(text)} · ${text.length} chars\nfrontmatter: ${keys.join(', ') || '(none)'}\n\n${outlineText(text) || '(no headings)'}`,
      touched: [{ rel, kind: 'read' }]
    }
  }

  /** `prefer` = thư mục được xếp lên đầu (agent của project: thư mục note của project), thứ tự còn lại giữ nguyên. */
  async search(vaultPath: string, query: string, o: { folder?: string; limit?: number; prefer?: string } = {}): Promise<MemoryResult> {
    const folder = normFolder(o.folder)
    const prefer = normFolder(o.prefer)
    const found = (await this.indexer.search(vaultPath, query)).filter((h) => !folder || h.rel.toLowerCase().startsWith(folder))
    const mine = (rel: string): boolean => !!prefer && rel.toLowerCase().startsWith(prefer)
    const hits = prefer ? [...found.filter((h) => mine(h.rel)), ...found.filter((h) => !mine(h.rel))] : found
    const limit = clampLimit(o.limit)
    if (!hits.length) return { text: `No notes match "${query}".`, touched: [] }
    const lines = hits.slice(0, limit).flatMap((h) => [h.rel, ...h.matches.map((m) => `  L${m.line}: ${m.text}`)])
    const more = hits.length > limit ? `\n(${hits.length - limit} more; narrow the query or raise limit)` : ''
    return { text: lines.join('\n') + more, touched: [] }
  }

  async query(vaultPath: string, f: QueryFilter): Promise<MemoryResult> {
    const cache = await this.notes(vaultPath)
    const refs = [...cache.keys()].map((rel) => ({ rel }))
    const folder = normFolder(f.folder)
    const linksTo = f.links_to ? await this.resolve(vaultPath, f.links_to) : null
    const linkedFrom = f.linked_from ? await this.resolve(vaultPath, f.linked_from) : null
    let since: number | null = null
    if (f.modified_since) {
      since = parseSince(f.modified_since)
      if (Number.isNaN(since)) throw new Error(`Bad date "${f.modified_since}" (use YYYY-MM-DD)`)
    }
    const [fieldKey, fieldVal] = f.field ? splitField(f.field) : [null, null]
    const text = f.text ? fold(f.text) : null
    const outLinks = linkedFrom ? new Set(cache.get(linkedFrom)!.links.map((l) => (l.target ? resolveNote(l.target, linkedFrom, refs) : null))) : null
    const rows: Array<{ rel: string; c: Cached }> = []
    for (const [rel, c] of cache) {
      if (folder && !rel.toLowerCase().startsWith(folder)) continue
      if (!f.include_templates && isTemplate(rel)) continue
      if (f.type && (c.meta.type ?? '').toLowerCase() !== f.type.toLowerCase()) continue
      if (f.tag && !c.meta.tags.some((t) => t.toLowerCase() === f.tag!.replace(/^#/, '').toLowerCase())) continue
      if (since !== null && c.mtime < since) continue
      if (outLinks && !outLinks.has(rel)) continue
      if (linksTo && !c.links.some((l) => l.target && resolveNote(l.target, rel, refs) === linksTo)) continue
      if (fieldKey) {
        const v = readField(c.text, fieldKey)
        if (v === null) continue
        if (fieldVal !== null && unquote(v).toLowerCase() !== fieldVal.toLowerCase()) continue
      }
      if (text && !fold(rel).includes(text) && !fold(c.text).includes(text)) continue
      rows.push({ rel, c })
    }
    rows.sort((a, b) => b.c.mtime - a.c.mtime)
    const limit = clampLimit(f.limit)
    if (!rows.length) return { text: 'No notes match.', touched: [] }
    const lines = rows.slice(0, limit).map(({ rel, c }) => `${rel} · ${c.meta.type ?? '-'} · ${localStamp(c.mtime)}${c.meta.tags.length ? ` · #${c.meta.tags.join(' #')}` : ''}`)
    return { text: lines.join('\n') + (rows.length > limit ? `\n(${rows.length - limit} more)` : ''), touched: [] }
  }

  async list(vaultPath: string, folder?: string): Promise<MemoryResult> {
    const base = normFolder(folder)
    const rels = [...(await this.notes(vaultPath)).keys()].filter((r) => !base || r.toLowerCase().startsWith(base))
    if (!rels.length) return { text: base ? `No notes in "${folder}".` : 'The vault has no notes yet.', touched: [] }
    const dirs = new Map<string, number>()
    const files: string[] = []
    for (const r of rels) {
      const rest = r.slice(base.length)
      const i = rest.indexOf('/')
      if (i === -1) files.push(rest)
      else dirs.set(rest.slice(0, i), (dirs.get(rest.slice(0, i)) ?? 0) + 1)
    }
    const coll = (a: string, b: string): number => a.localeCompare(b, 'vi', { numeric: true })
    const lines = [...[...dirs].sort((a, b) => coll(a[0], b[0])).map(([d, n]) => `${d}/ (${n} notes)`), ...files.sort(coll)]
    return { text: lines.slice(0, MAX_LIST).join('\n') + (lines.length > MAX_LIST ? `\n(${lines.length - MAX_LIST} more)` : ''), touched: [] }
  }

  async tags(vaultPath: string): Promise<MemoryResult> {
    const counts = new Map<string, number>()
    for (const [rel, c] of await this.notes(vaultPath)) {
      if (isTemplate(rel)) continue
      for (const t of c.meta.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    if (!counts.size) return { text: 'No tags (frontmatter `tags:` or #tag in the text) in the vault.', touched: [] }
    return { text: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => `${t} (${n})`).join('\n'), touched: [] }
  }

  // ---- Ghi ----

  private guard(content: string): void {
    const found = findSecrets(content, this.knownSecrets())
    if (found.length)
      throw new Error(`Refused: the content looks like it contains a secret (${found.join(', ')}). Never store passwords / API keys / tokens in the vault.`)
  }

  /** Đọc → sửa → ghi qua NoteWriter (tuần tự theo file, không đè lên lần ghi xen giữa). `edit` nhận null nếu chưa có file. */
  private async edit(vaultPath: string, rel: string, edit: (text: string | null) => string | null): Promise<string | null> {
    let result: string | null = null
    await this.writer.update(await fullPath(vaultPath, rel), (text) => {
      result = edit(text)
      return result
    })
    return result
  }

  /** Tạo hoặc ghi đè cả note. Ghi đè note có sẵn cần `ifVersion` (đã đọc bản mới nhất). */
  async write(vaultPath: string, note: string, content: string, ifVersion?: string): Promise<MemoryResult> {
    this.guard(content)
    const rel = await this.existingOr(vaultPath, note)
    let created = false
    const out = await this.edit(vaultPath, rel, (text) => {
      if (text === null) {
        created = true
        return normalizeEnd(content)
      }
      if (!ifVersion) throw new Error(`${rel} already exists (version ${versionOf(text)}). Read it first, then pass if_version to overwrite it, or use memory_patch / memory_append to change part of it.`)
      checkVersion(rel, text, ifVersion)
      return normalizeEnd(content)
    })
    return { text: `${created ? 'Created' : 'Saved'} ${rel} · version ${versionOf(out ?? content)}${created ? frontmatterHint(content) : ''}`, touched: [{ rel, kind: 'write' }] }
  }

  /** Thêm vào cuối note (tạo note nếu chưa có), hoặc cuối phần dưới một heading (tạo heading nếu chưa có). */
  async append(vaultPath: string, note: string, content: string, heading?: string): Promise<MemoryResult> {
    this.guard(content)
    const rel = await this.existingOr(vaultPath, note)
    const out = await this.edit(vaultPath, rel, (text) => {
      if (heading) return patchSection(text ?? '', heading, 'append', content, true)
      const base = (text ?? '').replace(/\s+$/, '')
      return `${base}${base ? '\n' : ''}${content.replace(/\s+$/, '')}\n`
    })
    return { text: `Appended to ${rel}${heading ? ` > ${heading}` : ''} · version ${versionOf(out ?? '')}`, touched: [{ rel, kind: 'write' }] }
  }

  /** Sửa phần dưới một heading, hoặc một trường frontmatter (`value` YAML một dòng, null = xoá). */
  async patch(
    vaultPath: string,
    note: string,
    o: { heading?: string; field?: string; op?: PatchOp; content?: string; ifVersion?: string; create?: boolean }
  ): Promise<MemoryResult> {
    if (!o.heading === !o.field) throw new Error('Pass exactly one of heading or field')
    if (o.content) this.guard(o.content)
    const rel = await this.resolve(vaultPath, note)
    const out = await this.edit(vaultPath, rel, (text) => {
      if (text === null) throw new Error(`${rel} no longer exists`)
      if (o.ifVersion) checkVersion(rel, text, o.ifVersion)
      if (o.field) return writeField(text, o.field, o.content === undefined || o.content === '' ? null : o.content)
      if (o.content === undefined) throw new Error('content is required when patching a heading')
      return patchSection(text, o.heading!, o.op ?? 'replace', o.content, !!o.create)
    })
    const what = o.field ? `field "${o.field}"` : `"${o.heading}" (${o.op ?? 'replace'})`
    return { text: `Patched ${rel} ${what} · version ${versionOf(out ?? '')}`, touched: [{ rel, kind: 'write' }] }
  }

  /** Đổi tên / chuyển note, sửa mọi link trỏ tới nó trong các note khác. `to` không có '/' = đổi tên trong cùng thư mục. */
  async move(vaultPath: string, note: string, to: string): Promise<MemoryResult> {
    const from = await this.resolve(vaultPath, note)
    const dest = toRel(vaultPath, to.includes('/') || to.includes('\\') ? to : `${from.slice(0, from.lastIndexOf('/') + 1)}${to}`)
    if (dest === from) return { text: `${from} is already there.`, touched: [] }
    const cache = await this.notes(vaultPath)
    const taken = [...cache.keys()].some((r) => r.toLowerCase() === dest.toLowerCase() && r.toLowerCase() !== from.toLowerCase())
    const src = await fullPath(vaultPath, from)
    const dst = await fullPath(vaultPath, dest)
    // Cả file trên đĩa mà chỉ mục chưa thấy (vừa tạo, thư mục chỉ mục bỏ qua, thư mục tên `.md`): rename sẽ đè lên nó.
    if (taken || (await occupied(src, dst))) throw new Error(`${dest} already exists`)
    const before = [...cache.keys()].map((rel) => ({ rel }))
    const moved = (rel: string): string => (rel === from ? dest : rel)
    const after = before.map((n) => ({ rel: moved(n.rel) }))
    const touched: Touch[] = []
    // Link trong chính note (tới nó `[[Tên#mục]]`, link tương đối khi đổi thư mục) sửa trước khi chuyển.
    await this.edit(vaultPath, from, (text) => (text === null ? null : repointLinks(text, from, dest, before, after, moved).text))
    // Trong chuỗi ghi của hai file: lần ghi đang chờ vào note cũ xong trước, không ai ghi lại chỗ cũ giữa lúc chuyển.
    await this.writer.exclusive([src, dst], async () => {
      if (await occupied(src, dst)) throw new Error(`${dest} already exists`)
      await fs.mkdir(dirname(dst), { recursive: true })
      await fs.rename(src, dst)
    })
    touched.push({ rel: dest, kind: 'write' })
    let fixed = 0
    const changed: string[] = []
    for (const rel of before.map((n) => n.rel)) {
      if (rel === from) continue
      const c = cache.get(rel)
      // Link tới note bị chuyển, hoặc link bằng tên tới note khác trùng tên mới (sau khi chuyển sẽ trỏ nhầm).
      const stale = (t: string): boolean => {
        const old = resolveNote(t, rel, before)
        return !!old && resolveNote(t, rel, after) !== moved(old)
      }
      if (!c?.links.some((l) => l.target && stale(l.target))) continue
      let n = 0
      await this.edit(vaultPath, rel, (text) => {
        if (text === null) return null
        const r = repointLinks(text, rel, rel, before, after, moved)
        n = r.count
        return r.text
      })
      if (n) {
        fixed += n
        changed.push(rel)
        touched.push({ rel, kind: 'write' })
      }
    }
    return { text: `Moved ${from} → ${dest}. Updated ${fixed} link(s) in ${changed.length} note(s)${changed.length ? `: ${changed.join(', ')}` : ''}.`, touched }
  }

  /** Không xoá hẳn: chuyển vào `.trash/` của vault (như Obsidian). Báo các note còn link tới nó. */
  async remove(vaultPath: string, note: string): Promise<MemoryResult> {
    const rel = await this.resolve(vaultPath, note)
    const { backlinks } = await this.linkInfo(vaultPath, rel)
    let trashRel = `.trash/${rel}`
    for (let i = 2; await exists(join(resolve(vaultPath), trashRel)); i++) trashRel = `.trash/${rel.replace(/\.md$/i, '')} (${i}).md`
    const src = await fullPath(vaultPath, rel)
    const dst = await fullPath(vaultPath, trashRel)
    await this.writer.exclusive([src, dst], async () => {
      await fs.mkdir(dirname(dst), { recursive: true })
      await fs.rename(src, dst)
    })
    return {
      text: `Moved ${rel} to the vault trash (${trashRel}).${backlinks.length ? ` These notes still link to it: ${backlinks.join(', ')}.` : ''}`,
      touched: [{ rel, kind: 'write' }]
    }
  }

  /** Note có sẵn (theo tên / đường dẫn) hoặc đường dẫn mới hợp lệ. */
  private async existingOr(vaultPath: string, note: string): Promise<string> {
    try {
      return await this.resolve(vaultPath, note)
    } catch {
      return toRel(vaultPath, note)
    }
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** `dst` đã có trên đĩa và không phải chính `src` (đổi hoa thường tên trên Windows thì là cùng một file). */
async function occupied(src: string, dst: string): Promise<boolean> {
  const id = (p: string): Promise<string | null> =>
    fs.lstat(p, { bigint: true }).then(
      // ino 0 (ổ FAT…): không phân biệt được file → so đường dẫn.
      (s) => (s.ino ? `${s.dev}:${s.ino}` : p.toLowerCase()),
      () => null
    )
  const d = await id(dst)
  return d !== null && d !== (await id(src))
}

function checkVersion(rel: string, text: string, want: string): void {
  const now = versionOf(text)
  if (now !== want.trim()) throw new Error(`${rel} changed since you read it (now version ${now}, you passed ${want}). Read it again, then retry.`)
}

function frontmatterHint(content: string): string {
  const { frontmatter } = splitFrontmatter(content)
  return frontmatter && /^type\s*:/m.test(frontmatter) ? '' : '. Note: it has no frontmatter `type:`; the Memory Protocol asks for one (memory_patch with field "type").'
}

const normalizeEnd = (s: string): string => s.replace(/\s+$/, '') + '\n'

function cut(text: string, whole = false): string {
  if (text.length <= MAX_READ_CHARS) return text
  return `${text.slice(0, MAX_READ_CHARS)}\n\n[… cut at ${MAX_READ_CHARS} of ${text.length} chars.${whole ? ' Call memory_outline, then memory_read with a heading.' : ''}]`
}

function normFolder(folder?: string): string {
  const f = (folder ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return f ? `${f.toLowerCase()}/` : ''
}

const clampLimit = (n?: number): number => Math.max(1, Math.min(MAX_LIMIT, Math.floor(n ?? DEFAULT_LIMIT)))

function splitField(f: string): [string, string | null] {
  const i = f.indexOf('=')
  return i === -1 ? [f.trim(), null] : [f.slice(0, i).trim(), unquote(f.slice(i + 1))]
}

function unquote(s: string): string {
  const t = s.trim()
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.endsWith(t[0]) ? t.slice(1, -1) : t
}

/** Dòng MEMORY TOOLS trong luật phiên của agent, theo Cài đặt → Vault & bộ nhớ ('off' = không có tool, rỗng). */
export function memoryToolRules(mode: 'full' | 'read' | 'off'): string {
  if (mode === 'off') return ''
  const lines = [
    '- Use the memory_* tools of "stag" for the vault instead of opening its files with your file tools: memory_read(note, heading?, field?) (also lists links and backlinks), memory_outline(note), memory_search(query, folder?), memory_query(type?, tag?, folder?, links_to?, modified_since?, field?…), memory_list(folder?), memory_tags(). `note` can be a name ("Kanban"), a path in the vault or a [[link]].'
  ]
  if (mode === 'full')
    lines.push(
      '- To write: memory_append(note, content, heading?) to add a line or item; memory_patch(note, heading | field, op, content, if_version?) to change one section or frontmatter field; memory_write(note, content) for a new note (overwriting a whole note needs if_version from memory_read); memory_move(note, to) to rename (fixes every link); memory_delete(note) moves it to the vault trash.',
      '- Fall back to direct file access only if a memory tool fails.'
    )
  else lines.push('- Memory tools are read-only for you: write vault notes with your normal file tools.')
  return lines.join('\n')
}
