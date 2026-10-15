import { normalizeConnector, validateConnector } from '@shared/connectors'
import { t } from '@shared/i18n'
import { normalizeSettings, patchApp, patchOverrides, resolveHandoff, resolveModel } from '@shared/settings'
import {
  DEFAULT_SETTINGS,
  type AppSettingsPatch,
  type CliAdapterId,
  type Connector,
  type GeneralSettings,
  type HandoffSettings,
  type ModelSettings,
  type OverrideLevel,
  type Settings,
  type SettingsOverrides,
  type SettingsOverridesPatch
} from '@shared/types'
import { isObject, JsonFile } from './jsonFile'

/**
 * Cài đặt của app, lưu ở userData/settings.json: cấp app + ghi đè theo workspace / agent.
 * File hỏng thì đọc bản `.bak` (không có thì mặc định, bản hỏng được cất riêng). File bản 1 được chuyển sang bản 2 khi đọc.
 */
export class SettingsStore {
  private value: Settings = DEFAULT_SETTINGS
  private json: JsonFile
  /** Lần đọc vừa rồi không có file cài đặt (bản cài mới, hoặc chưa từng lưu cài đặt). */
  fresh = false

  constructor(
    private file: string,
    private onChange: (s: Settings) => void = () => {}
  ) {
    this.json = new JsonFile(file)
  }

  async load(): Promise<void> {
    const { data } = await this.json.read(isObject)
    this.fresh = data == null
    try {
      this.value = normalizeSettings(data ?? { version: 2 })
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

  /**
   * Thêm / sửa một connector. `prevId` = id cũ khi đổi tên (ghi đè bật / tắt ở workspace / agent đi theo tên mới).
   * Lỗi cấu hình → ném lỗi tiếng Việt.
   */
  async saveConnector(raw: Connector, prevId?: string): Promise<Settings> {
    const c = normalizeConnector(raw)
    if (!c) throw new Error(t('app.error.serverNameRule'))
    const items = this.value.app.connectors.items
    const problem = validateConnector(c, items.filter((x) => x.id !== (prevId ?? c.id)).map((x) => x.id))
    if (problem) throw new Error(problem)
    const at = items.findIndex((x) => x.id === (prevId ?? c.id))
    const next = at >= 0 ? items.map((x, i) => (i === at ? c : x)) : [...items, c]
    const renamed = prevId && prevId !== c.id ? { from: prevId, to: c.id } : null
    return this.commit({
      ...this.value,
      app: { ...this.value.app, connectors: { ...this.value.app.connectors, items: next } },
      workspaces: renamed ? renameToggle(this.value.workspaces, 'connectors', renamed) : this.value.workspaces,
      agents: renamed ? renameToggle(this.value.agents, 'connectors', renamed) : this.value.agents
    })
  }

  /** Thêm nhiều connector (nhập JSON / chép máy chủ có sẵn) một lần ghi. */
  async addConnectors(list: Connector[]): Promise<Settings> {
    const items = [...this.value.app.connectors.items]
    for (const raw of list) {
      const c = normalizeConnector(raw)
      const problem = c ? validateConnector(c, items.map((x) => x.id)) : t('app.error.serverNameBad')
      if (problem || !c) throw new Error(`${raw.id}: ${problem}`)
      items.push(c)
    }
    return this.commit({ ...this.value, app: { ...this.value.app, connectors: { ...this.value.app.connectors, items } } })
  }

  /** Gỡ connector, cùng các ghi đè bật / tắt của nó. */
  async removeConnector(id: string): Promise<Settings> {
    const rm = { from: id, to: null }
    return this.commit({
      ...this.value,
      app: { ...this.value.app, connectors: { ...this.value.app.connectors, items: this.value.app.connectors.items.filter((c) => c.id !== id) } },
      workspaces: renameToggle(this.value.workspaces, 'connectors', rm),
      agents: renameToggle(this.value.agents, 'connectors', rm)
    })
  }

  /** Skill trong thư viện đổi tên (`to`) hoặc bị gỡ (`to: null`): bật / tắt ở mọi cấp đi theo. */
  async renameSkill(from: string, to: string | null): Promise<Settings> {
    const r = { from, to }
    const toggles = { ...this.value.app.skills.toggles }
    if (from in toggles) {
      const v = toggles[from]
      delete toggles[from]
      if (to) toggles[to] = v
    }
    return this.commit({
      ...this.value,
      app: { ...this.value.app, skills: { toggles } },
      workspaces: renameToggle(this.value.workspaces, 'skills', r),
      agents: renameToggle(this.value.agents, 'skills', r)
    })
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
    await this.json.write(next)
    this.onChange(this.value)
    return this.value
  }
}

/** Đổi khoá bật / tắt connector / skill trong các ghi đè (`to: null` = bỏ). Ghi đè rỗng thì bỏ hẳn. */
function renameToggle(
  map: Record<string, SettingsOverrides>,
  field: 'connectors' | 'skills',
  r: { from: string; to: string | null }
): Record<string, SettingsOverrides> {
  const out: Record<string, SettingsOverrides> = {}
  for (const [id, o] of Object.entries(map)) {
    const cur = o[field]
    if (!cur || !(r.from in cur)) {
      out[id] = o
      continue
    }
    const toggles = { ...cur }
    const v = toggles[r.from]
    delete toggles[r.from]
    if (r.to) toggles[r.to] = v
    const next: SettingsOverrides = { ...o, [field]: toggles }
    if (!Object.keys(toggles).length) delete next[field]
    if (Object.keys(next).length) out[id] = next
  }
  return out
}
