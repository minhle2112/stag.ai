import { create } from 'zustand'
import type { Workspace } from '@shared/types'

const ACTIVE_KEY = 'stag.activeWorkspace'

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function writeActive(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Không lưu được thì thôi, chỉ là tiện ích.
  }
}

interface WorkspaceState {
  items: Workspace[]
  activeId: string | null
  loaded: boolean
  load: () => Promise<void>
  setActive: (id: string) => void
  add: (ws: Workspace) => void
  /** Bản mới của một workspace (main đổi project…). */
  replace: (ws: Workspace) => void
  remove: (id: string) => Promise<void>
}

export const useWorkspaces = create<WorkspaceState>((set, get) => ({
  replace(ws) {
    set((s) => ({ items: s.items.map((w) => (w.id === ws.id ? ws : w)) }))
  },
  items: [],
  activeId: null,
  loaded: false,
  async load() {
    const [items, settings] = await Promise.all([window.stag.workspace.list(), window.stag.settings.get()])
    // Settings → Chung: tắt "mở lại workspace lần trước" thì luôn vào workspace đầu danh sách.
    const saved = settings.app.general.reopenLastWorkspace ? readActive() : null
    const activeId = items.some((w) => w.id === saved) ? saved : (items[0]?.id ?? null)
    set({ items, activeId, loaded: true })
  },
  setActive(id) {
    writeActive(id)
    set({ activeId: id })
  },
  add(ws) {
    writeActive(ws.id)
    set((s) => ({ items: [...s.items, ws], activeId: ws.id }))
  },
  async remove(id) {
    await window.stag.workspace.remove(id)
    const items = get().items.filter((w) => w.id !== id)
    const activeId = get().activeId === id ? (items[0]?.id ?? null) : get().activeId
    writeActive(activeId)
    set({ items, activeId })
  }
}))

export function useActiveWorkspace(): Workspace | undefined {
  return useWorkspaces((s) => s.items.find((w) => w.id === s.activeId))
}

// Main đổi workspace (tạo / xoá project, "Luôn cho" giữa 2 project…): cập nhật bản trong store.
window.stag.workspace.onChanged((ws) => useWorkspaces.getState().replace(ws))
