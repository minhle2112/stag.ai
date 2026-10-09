import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { SECRET_NAME_RE } from '@shared/connectors'
import type { SecretsList } from '@shared/types'
import { readText } from './fsutil'

/** Mã hoá / giải mã (Electron safeStorage: DPAPI của Windows, gắn với tài khoản Windows đang đăng nhập). */
export interface Cipher {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface Entry {
  /** base64 của bản mã. */
  data: string
  updatedAt: string
}

const MAX_VALUE = 16_000

/**
 * Bí mật (token, API key) cho connector: userData/secrets.json, mỗi giá trị mã hoá riêng.
 * Giá trị chỉ ra khỏi lớp này khi mở phiên agent / thử kết nối (biến môi trường của tiến trình con);
 * giao diện chỉ thấy tên. Không bao giờ ghi vào vault, settings.json hay dòng lệnh.
 */
export class SecretStore {
  private items: Record<string, Entry> = {}
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private file: string,
    private cipher: Cipher,
    private onChange: (list: SecretsList) => void = () => {}
  ) {}

  async load(): Promise<void> {
    const raw = await readText(this.file)
    try {
      const j = raw ? JSON.parse(raw) : {}
      const items = j && typeof j === 'object' && j.items && typeof j.items === 'object' ? j.items : {}
      this.items = {}
      for (const [k, v] of Object.entries(items as Record<string, Entry>))
        if (SECRET_NAME_RE.test(k) && typeof v?.data === 'string') this.items[k] = { data: v.data, updatedAt: String(v.updatedAt ?? '') }
    } catch {
      this.items = {}
    }
  }

  list(): SecretsList {
    return {
      available: this.cipher.available(),
      items: Object.entries(this.items)
        .map(([name, e]) => ({ name, updatedAt: e.updatedAt }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  has(name: string): boolean {
    return name in this.items
  }

  /** Giá trị thật; undefined = chưa có hoặc không giải mã được (vd. chép file sang tài khoản Windows khác). */
  get(name: string): string | undefined {
    const e = this.items[name]
    if (!e) return undefined
    try {
      return this.cipher.decrypt(Buffer.from(e.data, 'base64'))
    } catch {
      return undefined
    }
  }

  async set(name: string, value: string): Promise<SecretsList> {
    return (await this.setMany([{ name, value }])).list
  }

  /** Lưu nhiều bí mật một lần ghi file. */
  async setMany(list: Array<{ name: string; value: string }>): Promise<{ list: SecretsList }> {
    if (!this.cipher.available()) throw new Error('Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu bí mật được.')
    const next = { ...this.items }
    const now = new Date().toISOString()
    for (const { name, value } of list) {
      if (!SECRET_NAME_RE.test(name)) throw new Error(`Tên bí mật "${name}" không hợp lệ: chỉ chữ, số và "_", không bắt đầu bằng số.`)
      if (!value) throw new Error(`Bí mật ${name} đang trống.`)
      if (value.length > MAX_VALUE) throw new Error(`Bí mật ${name} dài quá ${MAX_VALUE} ký tự.`)
      next[name] = { data: this.cipher.encrypt(value).toString('base64'), updatedAt: now }
    }
    await this.commit(next)
    return { list: this.list() }
  }

  async remove(name: string): Promise<SecretsList> {
    if (!(name in this.items)) return this.list()
    const next = { ...this.items }
    delete next[name]
    await this.commit(next)
    return this.list()
  }

  private async commit(next: Record<string, Entry>): Promise<void> {
    this.items = next
    const write = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf8')
      await fs.rename(tmp, this.file)
    })
    this.writing = write.catch(() => {})
    await write
    this.onChange(this.list())
  }
}
