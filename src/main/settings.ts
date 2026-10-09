import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeSettings, patchApp, patchOverrides, resolveHandoff, resolveModel } from '@shared/settings'
import {
  DEFAULT_SETTINGS,
  type AppSettingsPatch,
  type CliAdapterId,
  type GeneralSettings,
  type HandoffSettings,
  type ModelSettings,
  type OverrideLevel,
  type Settings,
  type SettingsOverridesPatch
} from '@shared/types'
import { readText } from './fsutil'

/**
 * Cài đặt của app, lưu ở userData/settings.json: cấp app + ghi đè theo workspace / agent.
 * File hỏng thì dùng mặc định (lần lưu sau ghi đè). File bản 1 được chuyển sang bản 2 khi đọc.
 */
export class SettingsStore {
  private value: Settings = DEFAULT_SETTINGS
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private file: string,
    private onChange: (s: Settings) => void = () => {}
  ) {}

  async load(): Promise<void> {
    const raw = await readText(this.file)
    try {
      this.value = normalizeSettings(raw ? JSON.parse(raw) : { version: 2 })
    } catch {
      this.value = DEFAULT_SETTINGS
    }
  }

  get(): Settings {
    return this.value
  }

  general(): GeneralSettings {
    return this.value.app.general
  }

  /** Cài đặt bàn giao thực tế của agent (app → workspace → agent). */
  handoffFor(agent: { id: string; workspaceId: string }): HandoffSettings {
    return resolveHandoff(this.value, agent.workspaceId, agent.id)
  }

  async setApp(patch: AppSettingsPatch): Promise<Settings> {
    return this.commit({ ...this.value, app: patchApp(this.value.app, patch) })
  }

  /** Model / mức suy nghĩ thực tế của một CLI cho agent (app → workspace → agent). */
  modelFor(id: CliAdapterId, agent: { id: string; workspaceId: string }): ModelSettings {
    return resolveModel(this.value, id, agent.workspaceId, agent.id)
  }

  /**
   * Sửa ghi đè của một workspace / agent theo từng mục (handoff, models): mục có mặt thay cả mục,
   * `null` = bỏ mục đó (theo cấp trên), mục vắng mặt giữ nguyên.
   */
  async setOverrides(level: OverrideLevel, id: string, patch: SettingsOverridesPatch): Promise<Settings> {
    const key = level === 'workspace' ? 'workspaces' : 'agents'
    const map = { ...this.value[key] }
    const o = patchOverrides(map[id], patch ?? {})
    if (o) map[id] = o
    else delete map[id]
    return this.commit({ ...this.value, [key]: map })
  }

  /** Workspace / agent bị xoá: bỏ ghi đè của nó (không có thì không ghi file). */
  async forget(level: OverrideLevel, ids: string[]): Promise<void> {
    const key = level === 'workspace' ? 'workspaces' : 'agents'
    if (!ids.some((id) => id in this.value[key])) return
    const map = { ...this.value[key] }
    for (const id of ids) delete map[id]
    await this.commit({ ...this.value, [key]: map })
  }

  private async commit(next: Settings): Promise<Settings> {
    this.value = next
    // Ghi lần lượt: hai lần lưu sát nhau không giẫm lên file tạm của nhau.
    const write = this.writing.then(async () => {
      await fs.mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8')
      await fs.rename(tmp, this.file)
    })
    this.writing = write.catch(() => {})
    await write
    this.onChange(this.value)
    return this.value
  }
}
