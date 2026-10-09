import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

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

/** `p` nằm trong (hoặc chính là) thư mục `root` — cả hai là đường dẫn tuyệt đối đã chuẩn hoá. Windows: không phân biệt hoa thường. */
export function isInside(root: string, p: string): boolean {
  const win = process.platform === 'win32'
  const r = win ? root.toLowerCase() : root
  const x = win ? p.toLowerCase() : p
  return x === r || x.startsWith(r.endsWith(sep) ? r : r + sep)
}

/**
 * Đường dẫn thật (đã giải symlink / junction) của `rel` trong thư mục `root`. Chặn đường dẫn tuyệt đối, `..`, và
 * symlink trỏ ra ngoài `root`. `rel` rỗng = chính `root`. File không có → ném lỗi ENOENT của fs.
 */
export async function realPathInside(root: string, rel: string): Promise<string> {
  const outside = (): Error => Object.assign(new Error('Đường dẫn phải nằm trong thư mục dự án'), { code: 'OUTSIDE' })
  if (rel.includes('\0') || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || /^[\\/]/.test(rel)) throw outside()
  const parts = rel.split(/[\\/]+/).filter((s) => s && s !== '.')
  if (parts.includes('..')) throw outside()
  const realRoot = await fs.realpath(resolve(root))
  const real = await fs.realpath(resolve(realRoot, ...parts))
  if (!isInside(realRoot, real)) throw outside()
  return real
}

/** Đường dẫn tương đối dạng "a/b.txt" của `p` so với `root` (p nằm trong root). */
export function relSlash(root: string, p: string): string {
  return relative(root, p).split(sep).join('/')
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
