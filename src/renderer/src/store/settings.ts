import { create } from 'zustand'
import { resolveHandoff } from '@shared/settings'
import { DEFAULT_SETTINGS, type AppSettingsPatch, type HandoffSettings, type OverrideLevel, type Settings, type SettingsOverridesPatch } from '@shared/types'
import { useAgents } from './agents'
import { fetchThenListen } from './sync'
import { getLocale, onLocaleChange, setLocale } from '@shared/i18n'

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
  // Bản main đẩy tới trước phản hồi get() thì bỏ phản hồi đó (không mới hơn).
  fetchThenListen(window.stag.settings.get, window.stag.settings.onChanged, (value) => set({ value, loaded: true }))
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

// Đổi ngôn ngữ trong Cài đặt → áp dụng ngay (component dùng useT() vẽ lại). Trước khi nhận cài đặt thật thì giữ
// ngôn ngữ main.tsx đã đặt lúc mở trang.
useSettings.subscribe((s) => {
  if (s.loaded) setLocale(s.value.app.general.language)
})
onLocaleChange(() => {
  document.documentElement.lang = getLocale()
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
