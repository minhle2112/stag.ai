import { create } from 'zustand'
import type { InstalledAdapter } from '@shared/types'
import { fetchThenListen } from './sync'

interface ExternalAdaptersState {
  items: InstalledAdapter[]
  loaded: boolean
}

/** Adapter ngoài đã cài (alpha). Main báo lại mỗi khi cài / gỡ / sửa. */
export const useExternalAdapters = create<ExternalAdaptersState>((set) => {
  fetchThenListen(window.stag.externalAdapters.list, window.stag.externalAdapters.onChanged, (items) => set({ items, loaded: true }))
  return { items: [], loaded: false }
})
