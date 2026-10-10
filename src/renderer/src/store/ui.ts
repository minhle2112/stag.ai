import { create } from 'zustand'
import type { AdapterId, SplitDir } from '@shared/types'

/** 'vault' không còn là tab chính: mở bằng nút Vault ở góc phải thanh trên. */
/** `plugin:<id>/<slot>` = trang riêng của plugin (slot page). */
export type MainTab = 'kanban' | 'agents' | 'artifacts' | 'vault' | `plugin:${string}`

/** Hộp thoại tạo agent: ô mới đặt cạnh ô `agentId` theo hướng `dir`. */
export interface NewAgentTarget {
  wsId: string
  agentId: string | null
  dir: SplitDir
}

/** Các mục của trang Settings, theo thứ tự trên menu trái. */
export type SettingsSection =
  | 'general'
  | 'adapters'
  | 'connectors'
  | 'skills'
  | 'plugins'
  | 'secrets'
  | 'handoff'
  | 'scope'
  | 'agentApi'
  | 'vault'
  | 'browser'
  | 'voice'
  | 'data'
  | 'about'

/** Mở Settings thẳng tới một adapter / một agent (vd. menu ⋯ của agent → Model & effort). */
export interface SettingsFocus {
  adapter?: AdapterId
  /** id adapter ngoài (mở trang chi tiết của nó). */
  external?: string
  agentId?: string
  /** id connector (mở trang chi tiết của nó). */
  connector?: string
  /** Mở thẳng mục Duyệt của Connector. */
  review?: boolean
  /** Tên skill trong thư viện (mở trang chi tiết của nó). */
  skill?: string
  /** id plugin (mở trang của nó). */
  plugin?: string
}

interface UiState {
  /** Trang Settings đang mở ở mục nào (null = đóng). */
  settings: SettingsSection | null
  settingsFocus: SettingsFocus | null
  openSettings: (section?: SettingsSection, focus?: SettingsFocus) => void
  closeSettings: () => void
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
  settings: null,
  settingsFocus: null,
  openSettings: (section = 'general', focus) => set({ settings: section, settingsFocus: focus ?? null }),
  closeSettings: () => set({ settings: null, settingsFocus: null }),
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
