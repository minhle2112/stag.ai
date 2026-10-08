import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

interface SettingsState {
  value: AppSettings
  /** Lưu (main chuẩn hoá rồi báo lại qua onChanged). Lỗi thì ném ra để hộp thoại hiện. */
  save: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set) => {
  window.stag.settings.get().then((value) => set({ value }))
  window.stag.settings.onChanged((value) => set({ value }))
  return {
    value: DEFAULT_SETTINGS,
    async save(patch) {
      set({ value: await window.stag.settings.set(patch) })
    }
  }
})
