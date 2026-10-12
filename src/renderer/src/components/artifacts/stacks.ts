// Loại file → cách xem trước trong tab Sản phẩm, URL giao thức `stag-file`, cỡ file dễ đọc.

/** Đuôi file, chữ thường, không dấu chấm ('' nếu không có). */
export function extOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
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
