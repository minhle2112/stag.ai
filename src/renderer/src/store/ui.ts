import { create } from 'zustand'

export type MainTab = 'kanban' | 'agents' | 'vault'

interface UiState {
  tab: MainTab
  browserOpen: boolean
  setTab: (tab: MainTab) => void
  toggleBrowser: () => void
}

export const useUi = create<UiState>((set) => ({
  tab: 'agents',
  browserOpen: false,
  setTab: (tab) => set({ tab }),
  toggleBrowser: () => set((s) => ({ browserOpen: !s.browserOpen }))
}))
