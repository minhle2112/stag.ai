import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, HANDOFF_MAX, HANDOFF_MIN, type AppSettings } from '@shared/types'
import { readText } from './fsutil'

/** Chuẩn hoá cài đặt đọc từ file / nhận từ giao diện: thiếu hoặc sai kiểu thì lấy mặc định, % kẹp trong khoảng cho phép. */
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AppSettings, unknown>>
  const pct = typeof r.handoffPercent === 'number' && Number.isFinite(r.handoffPercent) ? Math.round(r.handoffPercent) : DEFAULT_SETTINGS.handoffPercent
  return {
    autoHandoff: typeof r.autoHandoff === 'boolean' ? r.autoHandoff : DEFAULT_SETTINGS.autoHandoff,
    handoffPercent: Math.min(HANDOFF_MAX, Math.max(HANDOFF_MIN, pct))
  }
}

/** Cài đặt của app, lưu ở userData/settings.json. File hỏng thì dùng mặc định (lần lưu sau ghi đè). */
export class SettingsStore {
  private value: AppSettings = { ...DEFAULT_SETTINGS }

  constructor(
    private file: string,
    private onChange: (s: AppSettings) => void = () => {}
  ) {}

  async load(): Promise<void> {
    const raw = await readText(this.file)
    try {
      this.value = normalizeSettings(raw ? JSON.parse(raw) : {})
    } catch {
      this.value = { ...DEFAULT_SETTINGS }
    }
  }

  get(): AppSettings {
    return this.value
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.value = normalizeSettings({ ...this.value, ...patch })
    await fs.mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
    this.onChange(this.value)
    return this.value
  }
}
