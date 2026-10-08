// Gom nhật ký output của agent thành "stack": mỗi file một chồng, gồm mọi lần tạo / sửa / xoá file đó.
import type { ArtifactEvent } from '@shared/types'
import { fold } from '../vault/highlight'

export type ArtifactCategory = 'image' | 'video' | 'document' | 'text' | 'file'

export const CATEGORIES: Array<{ id: ArtifactCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'document', label: 'Documents' },
  { id: 'text', label: 'Text' },
  { id: 'file', label: 'Files' }
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
