import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Ghi file chỉ khi chưa tồn tại. Trả về true nếu đã ghi. Không bao giờ ghi đè. */
export async function writeIfMissing(p: string, content: string): Promise<boolean> {
  await fs.mkdir(dirname(p), { recursive: true })
  try {
    await fs.writeFile(p, content, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}

/** Ngày địa phương dạng YYYY-MM-DD. */
export function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function normPath(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\$/, '').toLowerCase()
}

/** So sánh đường dẫn Windows không phân biệt hoa thường / kiểu dấu gạch, bỏ dấu phân cách cuối. */
export function samePath(a: string, b: string): boolean {
  return normPath(a) === normPath(b)
}

const NAME_CHAR = /[\p{L}\p{M}\p{N}_-]/u

/** Vị trí `i` là chỗ kết thúc tên thư mục: hết văn bản, `\`, khoảng trắng, dấu câu; dấu chấm chỉ tính khi sau nó không còn chữ. */
function endsName(s: string, i: number): boolean {
  const c = s[i]
  if (c === undefined) return true
  if (c === '.') return !NAME_CHAR.test(s[i + 1] ?? '')
  return !NAME_CHAR.test(c)
}

/**
 * Văn bản có nhắc tới đường dẫn này không (không phân biệt hoa thường / kiểu dấu gạch).
 * Chỉ tính khi đường dẫn kết thúc đúng ranh giới tên thư mục: `C:\a\bc` không phải là nhắc `C:\a\b`,
 * còn `C:\a\b\_INDEX.md` thì có. Hạn chế: tên có khoảng trắng thì `C:\a\b old` vẫn tính là nhắc `C:\a\b`.
 */
export function mentionsPath(text: string, p: string): boolean {
  const hay = text.replace(/[\\/]+/g, '\\').toLowerCase()
  const needle = normPath(p)
  if (!needle) return false
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    if (endsName(hay, i + needle.length)) return true
  }
  return false
}
