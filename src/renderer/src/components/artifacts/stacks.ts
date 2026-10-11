// Gom nhật ký output của agent thành "stack": mỗi file một chồng, gồm mọi lần tạo / sửa / xoá file đó.
import type { ArtifactEvent } from '@shared/types'
import { fold } from '../vault/highlight'

export type ArtifactCategory = 'image' | 'video' | 'document' | 'text' | 'file'

export const CATEGORIES: Array<{ id: ArtifactCategory | 'all'; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'image', label: 'Ảnh' },
  { id: 'video', label: 'Video' },
  { id: 'document', label: 'Tài liệu' },
  { id: 'text', label: 'Văn bản' },
  { id: 'file', label: 'Tệp khác' }
]

const BY_EXT: Record<ArtifactCategory, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi', 'wmv', 'flv'],
  document: ['pdf', 'doc', 'docx', 'docm', 'odt', 'rtf', 'xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'ppt', 'pptx', 'pptm', 'odp', 'html', 'htm', 'epub'],
  text: ['md', 'mdx', 'markdown', 'txt', 'log', 'rst', 'adoc'],
  file: []
}
const CATEGORY = new Map<string, ArtifactCategory>()
for (const [cat, exts] of Object.entries(BY_EXT)) for (const e of exts) CATEGORY.set(e, cat as ArtifactCategory)

/** Đuôi file, chữ thường, không dấu chấm ('' nếu không có). */
export function extOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function categoryOf(rel: string): ArtifactCategory {
  return CATEGORY.get(extOf(rel)) ?? 'file'
}

/**
 * Cách xem trước một file trong app:
 * - image / video / audio: thẻ HTML gốc (qua giao thức `stag-file`);
 * - pdf: pdf.js; docx: docx-preview; sheet (xlsx, xls, ods, csv, tsv): SheetJS; pptx: bộ vẽ slide riêng;
 * - html: trang tĩnh trong iframe sandbox (không chạy script); markdown: như note của Vault;
 * - zip: danh sách file bên trong; font: chữ mẫu; text: chữ thường / code;
 * - other: ảnh thu nhỏ của Windows + thông tin file.
 */
export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'sheet' | 'pptx' | 'html' | 'markdown' | 'zip' | 'font' | 'text' | 'other'

const PREVIEW = new Map<string, PreviewKind>()
const previewExts: Array<[PreviewKind, string[]]> = [
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg']],
  ['video', ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']],
  ['audio', ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']],
  ['pdf', ['pdf']],
  ['docx', ['docx', 'docm', 'dotx']],
  ['sheet', ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'csv', 'tsv', 'numbers']],
  ['pptx', ['pptx', 'pptm', 'potx', 'ppsx']],
  ['html', ['html', 'htm']],
  ['markdown', ['md', 'mdx', 'markdown']],
  ['zip', ['zip', 'jar', 'apk', 'nupkg', 'vsix', 'whl', 'epub']],
  ['font', ['ttf', 'otf', 'woff', 'woff2']],
  [
    'other',
    ['doc', 'ppt', 'odt', 'odp', 'rtf', 'avi', 'wmv', 'flv', 'exe', 'dll', 'msi', 'bin', 'dat', 'db', 'sqlite', 'psd', 'ai', 'sketch', 'fig', 'blend', 'fbx', 'obj', 'glb', 'gltf', 'stl', '7z', 'rar', 'gz', 'tgz', 'tar', 'iso', 'pyc', 'class', 'o', 'a', 'lib', 'so', 'node', 'wasm', 'tiff', 'tif', 'heic', 'raw', 'cr2', 'nef', 'eps', 'emf', 'wmf']
  ]
]
for (const [k, exts] of previewExts) for (const e of exts) PREVIEW.set(e, k)

/** Không có đuôi quen thuộc → đọc như chữ (main tự báo 'binary' nếu thật ra là file nhị phân). */
export function previewKind(rel: string): PreviewKind {
  return PREVIEW.get(extOf(rel)) ?? 'text'
}

export interface ArtifactStack {
  /** Khoá: đường dẫn chữ thường. */
  key: string
  /** Đường dẫn của lần ghi gần nhất (giữ hoa thường). */
  rel: string
  name: string
  dir: string
  category: ArtifactCategory
  /** Mới trước, cũ sau. */
  events: ArtifactEvent[]
  /** Agent đã đụng tới file, theo lần gần nhất (mới trước). */
  agents: Array<{ id: string; name: string }>
  /** ISO của lần gần nhất. */
  last: string
  /** Lần gần nhất là xoá. */
  deleted: boolean
}

export function buildStacks(events: readonly ArtifactEvent[]): ArtifactStack[] {
  const map = new Map<string, ArtifactStack>()
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    const key = e.rel.toLowerCase()
    let s = map.get(key)
    if (!s) {
      const slash = e.rel.lastIndexOf('/')
      s = {
        key,
        rel: e.rel,
        name: e.rel.slice(slash + 1),
        dir: slash < 0 ? '' : e.rel.slice(0, slash),
        category: categoryOf(e.rel),
        events: [],
        agents: [],
        last: e.at,
        deleted: e.kind === 'delete'
      }
      map.set(key, s)
    }
    s.events.push(e)
    if (!s.agents.some((a) => a.id === e.agentId)) s.agents.push({ id: e.agentId, name: e.agentName })
  }
  // Nhật ký xếp theo lúc ghi vào, nhưng lần gộp (MERGE_MS) có thể đẩy giờ lên: sắp lại cho chắc.
  const out = [...map.values()]
  for (const s of out) {
    s.events.sort((a, b) => b.at.localeCompare(a.at))
    s.last = s.events[0].at
    s.deleted = s.events[0].kind === 'delete'
  }
  return out.sort((a, b) => b.last.localeCompare(a.last))
}

/** Lọc theo loại, agent và chữ tìm (tên file, thư mục, tên agent; không phân biệt hoa thường / dấu). */
export function filterStacks(stacks: readonly ArtifactStack[], category: ArtifactCategory | 'all', query: string, agentId: string | null = null): ArtifactStack[] {
  const q = fold(query.trim())
  return stacks.filter(
    (s) =>
      (category === 'all' || s.category === category) &&
      (!agentId || s.agents.some((a) => a.id === agentId)) &&
      (!q || fold(s.rel).includes(q) || s.agents.some((a) => fold(a.name).includes(q)))
  )
}

/** Cách gom danh sách bên trái: theo thư mục, theo agent, theo giờ của lần tạo / sửa gần nhất. */
export type ArtifactGroupMode = 'dir' | 'agent' | 'time'

/** Một dòng của danh sách: cả file (đã gom) hoặc một lần tạo / sửa (`event`). */
export interface ArtifactRow {
  stack: ArtifactStack
  event?: ArtifactEvent
}

export interface ArtifactGroup {
  key: string
  label: string
  /** Chỉ có khi gom theo agent. */
  agent?: { id: string; name: string }
  rows: ArtifactRow[]
}

/** Nhóm giờ của một mốc ISO theo giờ địa phương: "Hôm nay · 14:00 – 15:00". */
export function timeBucket(iso: string, now: Date = new Date()): { key: string; label: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { key: 'unknown', label: '(không rõ giờ)' }
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  const dayLabel = diff === 0 ? 'Hôm nay' : diff === 1 ? 'Hôm qua' : `${p(d.getDate())}/${p(d.getMonth() + 1)}`
  const h = d.getHours()
  return { key: `${day.getTime()}-${p(h)}`, label: `${dayLabel} · ${p(h)}:00 – ${p((h + 1) % 24)}:00` }
}

/**
 * Gom các dòng thành nhóm, giữ thứ tự xuất hiện (dòng đầu vào đã xếp mới → cũ nên nhóm mới nhất đứng đầu).
 * Gom theo agent: file nhiều agent cùng đụng tới nằm trong nhóm của từng agent; `onlyAgent` giữ lại một agent.
 */
export function groupRows(rows: readonly ArtifactRow[], mode: ArtifactGroupMode, opts: { now?: Date; onlyAgent?: string | null } = {}): ArtifactGroup[] {
  const out = new Map<string, ArtifactGroup>()
  const add = (key: string, label: string, row: ArtifactRow, agent?: { id: string; name: string }): void => {
    let g = out.get(key)
    if (!g) {
      g = { key, label, agent, rows: [] }
      out.set(key, g)
    }
    g.rows.push(row)
  }
  for (const row of rows) {
    const { stack, event } = row
    if (mode === 'dir') add(stack.dir.toLowerCase(), stack.dir ? `${stack.dir}/` : '(thư mục gốc)', row)
    else if (mode === 'agent') {
      const who = event ? [{ id: event.agentId, name: event.agentName }] : stack.agents
      for (const a of who) if (!opts.onlyAgent || a.id === opts.onlyAgent) add(a.id, a.name, row, a)
    } else {
      const b = timeBucket(event?.at ?? stack.last, opts.now)
      add(b.key, b.label, row)
    }
  }
  return [...out.values()]
}

/**
 * Dấu đầu dòng: `+` tạo mới (lần đầu agent ghi cả file), `~` đã sửa, `-` đã xoá.
 * `agentId`: nhìn từ một agent (nhóm theo agent) — chỉ tính các lần agent đó đụng tới file.
 */
export function markerOf(row: ArtifactRow, agentId?: string): 'add' | 'mod' | 'del' {
  const { stack, event } = row
  if (event) return event.kind === 'delete' ? 'del' : event.kind === 'write' ? 'add' : 'mod'
  if (stack.deleted) return 'del'
  const mine = agentId ? stack.events.filter((e) => e.agentId === agentId) : stack.events
  const list = mine.length ? mine : stack.events
  // `events` xếp mới → cũ: phần tử cuối là lần đầu tiên.
  return list[list.length - 1].kind === 'write' ? 'add' : 'mod'
}

/** Mốc ISO hiện ở cuối dòng: lần tạo / sửa của dòng, hoặc (nhìn từ một agent) lần gần nhất của agent đó. */
export function rowTime(row: ArtifactRow, agentId?: string): string {
  const { stack, event } = row
  if (event) return event.at
  return (agentId ? stack.events.find((e) => e.agentId === agentId)?.at : undefined) ?? stack.last
}

export function kindLabel(kind: ArtifactEvent['kind']): string {
  return kind === 'write' ? 'tạo / ghi' : kind === 'edit' ? 'sửa' : 'xoá'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** URL giao thức `stag-file` của file trong dự án (`v` để trình duyệt tải lại khi file đổi). */
export function fileUrl(workspaceId: string, rel: string, v?: string): string {
  const path = rel.split('/').map(encodeURIComponent).join('/')
  return `stag-file://${workspaceId}/${path}${v ? `?v=${encodeURIComponent(v)}` : ''}`
}
