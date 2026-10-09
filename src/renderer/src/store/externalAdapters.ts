import { create } from 'zustand'
import type { InstalledAdapter } from '@shared/types'

interface ExternalAdaptersState {
  items: InstalledAdapter[]
  loaded: boolean
}

/** Adapter ngoài đã cài (alpha). Main báo lại mỗi khi cài / gỡ / sửa. */
export const useExternalAdapters = create<ExternalAdaptersState>((set) => {
  window.stag.externalAdapters.list().then((items) => set({ items, loaded: true }))
  window.stag.externalAdapters.onChanged((items) => set({ items, loaded: true }))
  return { items: [], loaded: false }
})
