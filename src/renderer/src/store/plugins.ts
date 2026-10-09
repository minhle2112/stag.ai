import { create } from 'zustand'
import type { InstalledPlugin, PluginSlot } from '@shared/plugins'
import { pluginOn } from '@shared/settings'
import type { Settings } from '@shared/types'
import { useUi } from './ui'

/** Plugin đã cài + trạng thái worker (main báo lại mỗi khi đổi). */
export const usePlugins = create<{ items: InstalledPlugin[]; loaded: boolean; set: (l: InstalledPlugin[]) => void }>((set) => {
  window.stag.plugins.list().then((items) => set({ items, loaded: true }))
  window.stag.plugins.onChanged((items) => set({ items, loaded: true }))
  return { items: [], loaded: false, set: (items) => set({ items, loaded: true }) }
})

/** Lời nhắn ngắn từ plugin (kết quả bấm nút) hiện ở góc màn hình. */
export const usePluginToast = create<{ text: string | null; bad: boolean; show: (text: string, bad?: boolean) => void; hide: () => void }>((set) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    text: null,
    bad: false,
    show: (text, bad = false) => {
      if (timer) clearTimeout(timer)
      set({ text, bad })
      timer = setTimeout(() => set({ text: null }), 8000)
    },
    hide: () => set({ text: null })
  }
})

/** Slot một loại của các plugin đang chạy được và bật cho workspace / agent này. */
export function slotsOf(items: InstalledPlugin[], settings: Settings, type: PluginSlot['type'], workspaceId?: string, agentId?: string): Array<{ plugin: InstalledPlugin; slot: PluginSlot }> {
  const out: Array<{ plugin: InstalledPlugin; slot: PluginSlot }> = []
  for (const p of items) {
    if (p.status.state !== 'ready' || !pluginOn(settings, p.manifest.id, workspaceId, agentId)) continue
    for (const slot of p.manifest.ui.slots) if (slot.type === type) out.push({ plugin: p, slot })
  }
  return out
}

/** Bấm một slot: mở URL (trình duyệt trong app / trình duyệt mặc định) hoặc hiện lời nhắn của plugin. */
export async function runSlot(p: InstalledPlugin, slot: PluginSlot, workspaceId?: string, agentId?: string): Promise<void> {
  const toast = usePluginToast.getState()
  try {
    const r = await window.stag.plugins.runSlot(p.manifest.id, slot.id, workspaceId, agentId)
    if (r.openUrl) {
      if (r.target === 'browser' && workspaceId) {
        await window.stag.browser.newTab(workspaceId, r.openUrl)
        useUi.getState().setBrowserOpen(true)
      } else window.open(r.openUrl)
    }
    if (r.message) toast.show(`${p.manifest.displayName}: ${r.message}`)
  } catch (e) {
    toast.show(`${p.manifest.displayName}: ${String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, true)
  }
}
