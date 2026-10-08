import { create } from 'zustand'
import type { SplitDir } from '@shared/types'

export type MainTab = 'kanban' | 'agents' | 'vault'

/** Hộp thoại tạo agent: ô mới đặt cạnh ô `agentId` theo hướng `dir`. */
export interface NewAgentTarget {
  wsId: string
  agentId: string | null
  dir: SplitDir
}

interface UiState {
  tab: MainTab
  browserOpen: boolean
  /** Số hộp thoại đang mở. Browser là view gốc nằm trên HTML nên phải ẩn khi có hộp thoại. */
  modals: number
  newAgent: NewAgentTarget | null
  setNewAgent: (target: NewAgentTarget | null) => void
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
  newAgent: null,
  setNewAgent: (newAgent) => set({ newAgent }),
  setTab: (tab) => set({ tab }),
  toggleBrowser: () => set((s) => ({ browserOpen: !s.browserOpen })),
  setBrowserOpen: (browserOpen) => set({ browserOpen }),
  modalOpened: () => set((s) => ({ modals: s.modals + 1 })),
  modalClosed: () => set((s) => ({ modals: Math.max(0, s.modals - 1) }))
}))
