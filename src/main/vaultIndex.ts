import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import type { WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import type { VaultIndex, VaultLink, VaultNoteInfo, VaultSearchHit } from '@shared/types'
import { extractLinks, extractTags, isAttachment, parseNoteMeta, resolveNote, splitFrontmatter, type NoteMeta, type ParsedLink } from '@shared/wikilink'

/** Note lớn hơn mức này vẫn có trong cây/graph nhưng không đọc link và không tìm trong nội dung. */
const MAX_NOTE_BYTES = 5 * 1024 * 1024
const READ_BATCH = 32
const SEARCH_MAX_NOTES = 50
const SEARCH_MAX_LINES = 5
const SNIPPET = 160

export interface Cached {
  mtime: number
  size: number
  meta: NoteMeta
  links: ParsedLink[]
  text: string
}

function vaultKey(vaultPath: string): string {
  return resolve(vaultPath).toLowerCase()
}

/** Bỏ dấu tiếng Việt + chữ thường để tìm "ke hoach" ra "Kế hoạch". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase() // i18n-ignore: bỏ dấu tiếng Việt khi tìm
}

/** Tag của note = tag trong frontmatter + `#tag` trong thân (như Obsidian), không trùng (không phân biệt hoa thường). */
function withInlineTags(meta: NoteMeta, text: string): NoteMeta {
  const have = new Set(meta.tags.map((t) => t.toLowerCase()))
  const extra = extractTags(text).filter((t) => !have.has(t.toLowerCase()))
  return extra.length ? { ...meta, tags: [...meta.tags, ...extra] } : meta
}

/**
 * Thư mục gói / môi trường không bao giờ là note (vault đặt ngay thư mục dự án thì có `node_modules` hàng chục nghìn
 * file .md). Chỉ tên chắc chắn không phải thư mục note của người dùng.
 */
const SKIP_DIRS = new Set(['node_modules', '__pycache__', 'venv', 'bower_components'])

/** Mọi file .md trong vault (bỏ file/thư mục bắt đầu bằng `.`, như `.obsidian`, `.trash`, và SKIP_DIRS). */
async function listNotes(vaultPath: string): Promise<Array<{ rel: string; full: string; mtime: number; size: number }>> {
  const out: Array<{ rel: string; full: string; mtime: number; size: number }> = []
  async function walk(dir: string, relDir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, rel)
      }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        try {
          const st = await fs.stat(full)
          out.push({ rel, full, mtime: st.mtimeMs, size: st.size })
        } catch {
          // file vừa bị xoá giữa lúc quét
        }
      }
    }
  }
  await walk(resolve(vaultPath), '')
  return out
}

/**
 * Chỉ mục vault cho Vault Viewer: note, link (đã phân giải như Obsidian), tìm kiếm toàn văn.
 * Giữ nội dung đã đọc theo từng vault; lần quét sau chỉ đọc lại file có mtime/kích thước đổi.
 */
export class VaultIndexer {
  private caches = new Map<string, Map<string, Cached>>()

  private async scan(vaultPath: string): Promise<Map<string, Cached>> {
    const key = vaultKey(vaultPath)
    const old = this.caches.get(key) ?? new Map<string, Cached>()
    const files = await listNotes(vaultPath)
    const next = new Map<string, Cached>()
    const toRead: typeof files = []
    for (const f of files) {
      const c = old.get(f.rel)
      if (c && c.mtime === f.mtime && c.size === f.size) next.set(f.rel, c)
      else toRead.push(f)
    }
    for (let i = 0; i < toRead.length; i += READ_BATCH) {
      await Promise.all(
        toRead.slice(i, i + READ_BATCH).map(async (f) => {
          let text = ''
          if (f.size <= MAX_NOTE_BYTES) {
            try {
              text = await fs.readFile(f.full, 'utf8')
            } catch {
              return
            }
          }
          const { frontmatter } = splitFrontmatter(text)
          next.set(f.rel, { mtime: f.mtime, size: f.size, meta: withInlineTags(parseNoteMeta(frontmatter), text), links: extractLinks(text), text })
        })
      )
    }
    this.caches.set(key, next)
    return next
  }

  async index(vaultPath: string): Promise<VaultIndex> {
    const cache = await this.scan(vaultPath)
    const rels = [...cache.keys()].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
    const refs = rels.map((rel) => ({ rel }))
    const notes: VaultNoteInfo[] = []
    const links: VaultLink[] = []
    for (const rel of rels) {
      const c = cache.get(rel)!
      notes.push({
        rel,
        name: rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, ''),
        type: c.meta.type,
        aliases: c.meta.aliases,
        tags: c.meta.tags,
        mtime: c.mtime
      })
      for (const l of c.links) {
        if (!l.target || isAttachment(l.target)) continue // `[[#heading]]` trong cùng note, ảnh, pdf…
        links.push({ from: rel, to: resolveNote(l.target, rel, refs), target: l.target, embed: l.embed, line: l.line })
      }
    }
    return { vaultPath, notes, links }
  }

  /** Tìm không phân biệt hoa thường và dấu; mọi từ phải có trong tên hoặc nội dung note. */
  async search(vaultPath: string, query: string): Promise<VaultSearchHit[]> {
    const terms = fold(query).split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const cache = await this.scan(vaultPath)
    const hits: Array<VaultSearchHit & { mtime: number }> = []
    for (const [rel, c] of cache) {
      const name = fold(rel.slice(rel.lastIndexOf('/') + 1).replace(/\.md$/i, ''))
      const body = fold(c.text)
      if (!terms.every((t) => name.includes(t) || body.includes(t))) continue
      const matches: VaultSearchHit['matches'] = []
      const lines = c.text.split(/\r?\n/)
      for (let i = 0; i < lines.length && matches.length < SEARCH_MAX_LINES; i++) {
        const folded = fold(lines[i])
        const at = Math.min(...terms.map((t) => folded.indexOf(t)).filter((p) => p !== -1))
        if (!Number.isFinite(at)) continue
        matches.push({ line: i + 1, text: snippet(lines[i], folded.length === lines[i].length ? at : 0) })
      }
      hits.push({ rel, titleMatch: terms.every((t) => name.includes(t)), matches, mtime: c.mtime })
    }
    hits.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.matches.length - a.matches.length || b.mtime - a.mtime)
    return hits.slice(0, SEARCH_MAX_NOTES).map(({ mtime: _m, ...h }) => h)
  }

  /** Mọi note đã quét (rel → nội dung + meta + link), đọc lại file đã đổi; cho tool memory_* của agent. */
  async notes(vaultPath: string): Promise<ReadonlyMap<string, Cached>> {
    return this.scan(vaultPath)
  }

  forget(vaultPath: string): void {
    this.caches.delete(vaultKey(vaultPath))
  }
}

/** Cắt dòng dài quanh chỗ khớp. */
function snippet(line: string, at: number): string {
  const t = line.trim()
  if (t.length <= SNIPPET) return t
  const offset = line.length - line.trimStart().length
  const start = Math.max(0, Math.min(at - offset - 40, t.length - SNIPPET))
  return (start > 0 ? '…' : '') + t.slice(start, start + SNIPPET) + (start + SNIPPET < t.length ? '…' : '')
}

/** Phần đường dẫn (do fs.watch báo) nằm trong thư mục/tệp ẩn như `.obsidian` → bỏ qua (Obsidian ghi workspace.json liên tục). */
export function isHiddenChange(filename: string | null): boolean {
  if (!filename) return false
  return filename.split(/[\\/]/).some((seg) => seg.startsWith('.') || SKIP_DIRS.has(seg.toLowerCase()))
}

const CHANGE_DEBOUNCE_MS = 300

interface Sub {
  /** `vaultPath` đúng như cửa sổ gửi lên (để renderer so khớp). */
  path: string
  /** Số lần cửa sổ này đăng ký (vài chỗ cùng theo dõi một vault, hoặc StrictMode gọi effect hai lần). */
  count: number
  onDestroyed: () => void
}

interface WatchEntry {
  watcher: FSWatcher
  subs: Map<WebContents, Sub>
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Theo dõi file trong vault (fs.watch đệ quy, có sẵn trên Windows) và báo renderer `vault:changed`
 * khi Obsidian, agent hoặc người dùng sửa note. Gộp các thay đổi liên tiếp trong 300ms thành một lần báo.
 */
export class VaultWatchers {
  private entries = new Map<string, WatchEntry>()

  watch(vaultPath: string, wc: WebContents): void {
    const key = vaultKey(vaultPath)
    let entry = this.entries.get(key)
    if (!entry) {
      let watcher: FSWatcher
      try {
        watcher = watch(resolve(vaultPath), { recursive: true }, (_ev, filename) => {
          if (!isHiddenChange(filename)) this.changed(key)
        })
      } catch {
        return // vault không tồn tại: không có gì để theo dõi
      }
      const created: WatchEntry = { watcher, subs: new Map(), timer: null }
      watcher.on('error', () => this.close(key))
      this.entries.set(key, created)
      entry = created
    }
    const sub = entry.subs.get(wc)
    if (sub) {
      sub.count++
      return
    }
    const onDestroyed = (): void => this.drop(key, wc)
    wc.once('destroyed', onDestroyed)
    entry.subs.set(wc, { path: vaultPath, count: 1, onDestroyed })
  }

  unwatch(vaultPath: string, wc: WebContents): void {
    const key = vaultKey(vaultPath)
    const sub = this.entries.get(key)?.subs.get(wc)
    if (!sub) return
    if (--sub.count > 0) return
    wc.removeListener('destroyed', sub.onDestroyed)
    this.drop(key, wc)
  }

  /** Bỏ hẳn cửa sổ khỏi danh sách theo dõi vault; không còn ai thì đóng watcher. */
  private drop(key: string, wc: WebContents): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.subs.delete(wc)
    if (!entry.subs.size) this.close(key)
  }

  private changed(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      for (const [wc, sub] of entry.subs) if (!wc.isDestroyed()) wc.send(IPC.vaultChanged, sub.path)
    }, CHANGE_DEBOUNCE_MS)
  }

  private close(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    this.entries.delete(key)
  }

  dispose(): void {
    for (const key of [...this.entries.keys()]) this.close(key)
  }
}
