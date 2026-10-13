import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Bỏ BOM UTF-8 ở đầu (file người dùng sửa bằng Notepad…): JSON.parse không nhận nó. */
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

export const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** File JSON hỏng gặp khi đọc (để app báo người dùng một lần lúc mở). */
export const jsonRecoveries: Array<{ file: string; fromBackup: boolean }> = []

/**
 * Ghi một file JSON an toàn: các lần ghi xếp hàng lần lượt (hai lần ghi sát nhau không chồng lên nhau, bản ngắn không
 * để lại đuôi của bản dài), mỗi lần ghi file tạm rồi đổi tên (tắt máy giữa chừng không để lại file nửa vời), và giữ bản
 * tốt trước đó ở `<file>.bak` để đọc lại khi file chính hỏng.
 */
export class JsonFile {
  private chain: Promise<void> = Promise.resolve()

  constructor(readonly file: string) {}

  /** Ghi `data` (chụp nội dung ngay lúc gọi). Lỗi của lần ghi này ném về người gọi, không chặn các lần ghi sau. */
  write(data: unknown): Promise<void> {
    const text = JSON.stringify(data, null, 2)
    const p = this.chain.then(() => this.put(text))
    this.chain = p.catch(() => {})
    return p
  }

  private async put(text: string): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, text, 'utf8')
    // Bản hiện có → .bak, chỉ khi nó là JSON đọc được: file rỗng / hỏng không được đè lên bản sao tốt.
    if (await isJson(this.file)) await fs.copyFile(this.file, `${this.file}.bak`).catch(() => {})
    await renameRetry(tmp, this.file)
  }

  /**
   * Đọc file. File chính hỏng (rỗng, không phải JSON, hoặc `valid` từ chối) → chuyển nó sang `<file>.broken-<thời điểm>`
   * (một lần: lần mở sau không sinh thêm bản) rồi đọc `<file>.bak`. Không có file chính nhưng có `.bak` tốt (lần trước
   * file chính hỏng đã bị cất đi, chưa kịp ghi lại) → đọc `.bak`. Không có gì → `data: null`.
   */
  async read<T>(valid: (x: unknown) => x is T): Promise<{ data: T | null; broken: boolean; fromBackup: boolean }> {
    /** undefined = không có file; null = có nhưng rỗng / hỏng. */
    const parse = async (f: string): Promise<T | null | undefined> => {
      let raw: string
      try {
        raw = await fs.readFile(f, 'utf8')
      } catch {
        return undefined
      }
      if (!raw.trim()) return null
      try {
        const x: unknown = JSON.parse(stripBom(raw))
        return valid(x) ? x : null
      } catch {
        return null
      }
    }
    const main = await parse(this.file)
    if (main) return { data: main, broken: false, fromBackup: false }
    const broken = main === null
    if (broken) await fs.rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => {})
    const bak = await parse(`${this.file}.bak`)
    if (broken) {
      jsonRecoveries.push({ file: this.file, fromBackup: !!bak })
      console.error(`[json] ${this.file} hỏng: ${bak ? 'đọc bản .bak' : 'không có bản .bak, dùng mặc định'}`)
    }
    return { data: bak ?? null, broken, fromBackup: !!bak }
  }
}

/** Đổi tên đè; Windows: có thể vướng tạm (trình diệt virus, trình đọc file đang mở) → thử lại vài lần. */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
      await sleep(40 * (i + 1))
    }
  }
}

/** File có và là JSON đọc được (không rỗng). */
async function isJson(file: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    if (!raw.trim()) return false
    JSON.parse(stripBom(raw))
    return true
  } catch {
    return false
  }
}
