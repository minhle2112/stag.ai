import { create } from 'zustand'

export type MainTab = 'kanban' | 'agents' | 'vault'

interface UiState {
  tab: MainTab
  browserOpen: boolean
  /** Số hộp thoại đang mở. Browser là view gốc nằm trên HTML nên phải ẩn khi có hộp thoại. */
  modals: number
  setTab: (tab: MainTab) => void
  toggleBrowser: () => void
  setBrowserOpen: (open: boolean) => void
  modalOpened: () => void
  modalClosed: () => void
}

export const useUi = create<UiState>((set) => ({
  tab: 'agents',
  browserOpen: false,
  modals: 0,
  setTab: (tab) => set({ tab }),
  toggleBrowser: () => set((s) => ({ browserOpen: !s.browserOpen })),
  setBrowserOpen: (browserOpen) => set({ browserOpen }),
  modalOpened: () => set((s) => ({ modals: s.modals + 1 })),
  modalClosed: () => set((s) => ({ modals: Math.max(0, s.modals - 1) }))
}))
