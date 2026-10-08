import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import { nativeImage } from 'electron'
import JSZip from 'jszip'

/** File Office (zip OOXML / OpenDocument) có thể mang sẵn ảnh thu nhỏ trang đầu. */
const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp'])
const EMBEDDED = ['docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png', 'Thumbnails/thumbnail.png']
/** Không mở zip quá lớn chỉ để lấy ảnh thu nhỏ. */
const MAX_ZIP = 60 * 1024 * 1024
const SIZE = { width: 480, height: 360 }

const cache = new Map<string, string | null>()

/**
 * Ảnh thu nhỏ (data URL) cho thẻ artifact không tự hiện được: ảnh nhúng trong file Office, không có thì nhờ
 * Windows (trình tạo thumbnail của Explorer: PDF, video lạ, file có app hỗ trợ…). null = không có.
 */
export async function artifactThumb(full: string): Promise<string | null> {
  let mtime: number
  let size: number
  try {
    const st = await fs.stat(full)
    mtime = st.mtimeMs
    size = st.size
  } catch {
    return null
  }
  const key = `${full}|${mtime}`
  if (cache.has(key)) return cache.get(key)!
  const url = (await embedded(full, size)) ?? (await fromShell(full))
  if (cache.size > 500) cache.clear()
  cache.set(key, url)
  return url
}

async function embedded(full: string, size: number): Promise<string | null> {
  if (!OFFICE.has(extname(full).slice(1).toLowerCase()) || size > MAX_ZIP) return null
  try {
    const zip = await JSZip.loadAsync(await fs.readFile(full))
    for (const name of EMBEDDED) {
      const f = zip.file(name)
      if (f) return `data:image/${name.endsWith('.png') ? 'png' : 'jpeg'};base64,${await f.async('base64')}`
    }
  } catch {
    // Không phải zip hợp lệ: thử cách khác.
  }
  return null
}

async function fromShell(full: string): Promise<string | null> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null
  try {
    const img = await nativeImage.createThumbnailFromPath(full, SIZE)
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}
