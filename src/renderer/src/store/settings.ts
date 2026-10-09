import { create } from 'zustand'
import { resolveHandoff } from '@shared/settings'
import { DEFAULT_SETTINGS, type AppSettingsPatch, type HandoffSettings, type OverrideLevel, type Settings, type SettingsOverridesPatch } from '@shared/types'
import { useAgents } from './agents'

interface SettingsState {
  value: Settings
  /** Đã nhận cài đặt thật từ main (trước đó là mặc định). */
  loaded: boolean
  /** Sửa cấp app (main chuẩn hoá rồi báo lại qua onChanged). Lỗi thì ném ra để giao diện hiện. */
  save: (patch: AppSettingsPatch) => Promise<void>
  /** Sửa ghi đè của một workspace / agent theo mục (handoff, models); mục = null → theo cấp trên. */
  saveOverrides: (level: OverrideLevel, id: string, patch: SettingsOverridesPatch) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => {
  window.stag.settings.get().then((value) => set({ value, loaded: true }))
  window.stag.settings.onChanged((value) => set({ value, loaded: true }))
  return {
    value: DEFAULT_SETTINGS,
    loaded: false,
    async save(patch) {
      set({ value: await window.stag.settings.set(patch) })
    },
    async saveOverrides(level, id, patch) {
      set({ value: await window.stag.settings.setOverrides(level, id, patch) })
    }
  }
})

/** Cài đặt bàn giao thực tế của một agent (app → workspace → agent). */
export function useHandoffFor(agentId: string | undefined): HandoffSettings {
  const settings = useSettings((s) => s.value)
  const wsId = useAgents((s) => {
    if (!agentId) return undefined
    for (const [id, w] of Object.entries(s.byWs)) if (w.agents.some((a) => a.id === agentId)) return id
    return undefined
  })
  return resolveHandoff(settings, wsId, agentId)
}
