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

/** Văn bản có nhắc tới đường dẫn này không (không phân biệt hoa thường / kiểu dấu gạch). */
export function mentionsPath(text: string, p: string): boolean {
  return text.replace(/[\\/]+/g, '\\').toLowerCase().includes(normPath(p))
}
