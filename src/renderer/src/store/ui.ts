import { create } from 'zustand'
import type { Point } from '@shared/canvas'
import type { AdapterId, AgentKind } from '@shared/types'

/** Màn hình chính, chọn ở thanh icon bên trái. `plugin:<id>/<slot>` = trang riêng của plugin (slot page). */
export type MainTab = 'agents' | 'artifacts' | 'vault' | 'log' | `plugin:${string}`

/**
 * Thanh bên và pane trình duyệt nhớ bật / tắt riêng cho hai nhóm màn hình: "main" (Agent: cần thấy agent)
 * và "other" (Artifacts, Vault, Nhật ký, Cài đặt…: ưu tiên chỗ cho nội dung).
 */
export type ViewClass = 'main' | 'other'
export const viewClassOf = (tab: MainTab, settingsOpen: boolean): ViewClass => (!settingsOpen && tab === 'agents' ? 'main' : 'other')

const PANES_KEY = 'stag.panes'
interface PanePrefs {
  sidebar: Record<ViewClass, boolean>
  browser: Record<ViewClass, boolean>
}
const PANES_DEFAULT: PanePrefs = { sidebar: { main: true, other: false }, browser: { main: false, other: false } }

function readPanes(): PanePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null') as Partial<PanePrefs> | null
    return {
      sidebar: { ...PANES_DEFAULT.sidebar, ...(v?.sidebar ?? {}) },
      browser: { ...PANES_DEFAULT.browser, ...(v?.browser ?? {}) }
    }
  } catch {
    return PANES_DEFAULT
  }
}

function writePanes(p: PanePrefs): void {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(p))
  } catch {
    // Không lưu được thì lần sau về mặc định.
  }
}

/** Hộp thoại tạo agent: ô mới đặt tại điểm `at` của canvas (chỗ chuột phải); không có → giữa vùng đang nhìn. */
export interface NewAgentTarget {
  wsId: string
  at?: Point
  /** Chọn sẵn loại ô trong hộp thoại (vd. 'terminal' từ menu chuột phải "Terminal mới"). */
  kind?: AgentKind
}

/** Hộp thoại tạo project (`folder` = chọn sẵn thư mục có sẵn, vd. từ thẻ gợi ý monorepo). */
export interface NewProjectTarget {
  wsId: string
  folder?: string
}

/** Các mục của trang Settings, theo thứ tự trên menu trái. */
export type SettingsSection =
  | 'general'
  | 'appearance'
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
  /** Bật / tắt thanh bên và pane trình duyệt theo nhóm màn hình đang xem. */
  panes: PanePrefs
  /** Bảng lệnh (Ctrl+K). */
  palette: boolean
  setPalette: (open: boolean) => void
  /** Ô đang phóng to toàn khung trên canvas, theo workspace (null = đang xem bản đồ). */
  maxCell: Record<string, string | null>
  setMaxCell: (wsId: string, key: string | null) => void
  /** Note vault cần mở khi màn Vault hiện ra (từ Nhật ký, bảng lệnh…); Vault đọc xong thì xoá. */
  vaultTarget: { wsId: string; rel: string } | null
  openInVault: (wsId: string, rel: string) => void
  clearVaultTarget: () => void
  /** Hộp thoại Phát lệnh: id workspace đang phát (null = đóng). */
  broadcast: string | null
  setBroadcast: (wsId: string | null) => void
  /** Số hộp thoại đang mở. Browser là view gốc nằm trên HTML nên phải ẩn khi có hộp thoại. */
  modals: number
  newAgent: NewAgentTarget | null
  setNewAgent: (target: NewAgentTarget | null) => void
  newProject: NewProjectTarget | null
  setNewProject: (target: NewProjectTarget | null) => void
  /** Hộp thoại xoá project. */
  deleteProject: { wsId: string; projectId: string } | null
  setDeleteProject: (target: { wsId: string; projectId: string } | null) => void
  setTab: (tab: MainTab) => void
  toggleSidebar: () => void
  toggleBrowser: () => void
  /** Mở / đóng pane trình duyệt ở nhóm màn hình đang xem. */
  setBrowserOpen: (open: boolean) => void
  modalOpened: () => void
  modalClosed: () => void
}

export const useUi = create<UiState>((set, get) => ({
  settings: null,
  settingsFocus: null,
  openSettings: (section = 'general', focus) => set({ settings: section, settingsFocus: focus ?? null }),
  closeSettings: () => set({ settings: null, settingsFocus: null }),
  tab: 'agents',
  panes: readPanes(),
  palette: false,
  setPalette: (palette) => set({ palette }),
  maxCell: {},
  setMaxCell: (wsId, key) => set((s) => ({ maxCell: { ...s.maxCell, [wsId]: key } })),
  vaultTarget: null,
  openInVault: (wsId, rel) => set({ tab: 'vault', settings: null, settingsFocus: null, vaultTarget: { wsId, rel } }),
  clearVaultTarget: () => set({ vaultTarget: null }),
  broadcast: null,
  setBroadcast: (broadcast) => set({ broadcast }),
  modals: 0,
  newAgent: null,
  setNewAgent: (newAgent) => set({ newAgent }),
  newProject: null,
  setNewProject: (newProject) => set({ newProject }),
  deleteProject: null,
  setDeleteProject: (deleteProject) => set({ deleteProject }),
  // Chọn màn hình thì đóng trang Cài đặt (Cài đặt là một màn hình trong vùng chính).
  setTab: (tab) => set({ tab, settings: null, settingsFocus: null }),
  toggleSidebar: () => {
    const { tab, settings, panes } = get()
    const k = viewClassOf(tab, settings !== null)
    const next = { ...panes, sidebar: { ...panes.sidebar, [k]: !panes.sidebar[k] } }
    writePanes(next)
    set({ panes: next })
  },
  toggleBrowser: () => {
    const { tab, settings, panes } = get()
    get().setBrowserOpen(!panes.browser[viewClassOf(tab, settings !== null)])
  },
  setBrowserOpen: (open) => {
    const { tab, settings, panes } = get()
    const k = viewClassOf(tab, settings !== null)
    const next = { ...panes, browser: { ...panes.browser, [k]: open } }
    writePanes(next)
    set({ panes: next })
  },
  modalOpened: () => set((s) => ({ modals: s.modals + 1 })),
  modalClosed: () => set((s) => ({ modals: Math.max(0, s.modals - 1) }))
}))

/** Thanh bên đang bật ở màn hình hiện tại? */
export function useSidebarOpen(): boolean {
  return useUi((s) => s.panes.sidebar[viewClassOf(s.tab, s.settings !== null)])
}

/** Pane trình duyệt đang bật ở màn hình hiện tại? */
export function useBrowserOpen(): boolean {
  return useUi((s) => s.panes.browser[viewClassOf(s.tab, s.settings !== null)])
}
