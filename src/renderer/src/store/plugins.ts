import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { InstalledPlugin, PluginSlot } from '@shared/plugins'
import { pluginOn } from '@shared/settings'
import type { Settings } from '@shared/types'
import { fetchThenListen } from './sync'
import { useUi } from './ui'

/** Plugin đã cài + trạng thái worker (main báo lại mỗi khi đổi). */
export const usePlugins = create<{ items: InstalledPlugin[]; loaded: boolean; set: (l: InstalledPlugin[]) => void }>((set) => {
  fetchThenListen(window.stag.plugins.list, window.stag.plugins.onChanged, (items) => set({ items, loaded: true }))
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

/** Lỗi IPC gọn lại (bỏ tiền tố "Error invoking remote method …"). */
export function pluginErr(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Mở địa chỉ http(s) plugin đưa: trình duyệt trong app (cần workspace) hoặc trình duyệt mặc định. */
export async function openPluginUrl(url: string, target: 'browser' | 'external' | undefined, workspaceId?: string): Promise<void> {
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(t('plugins.err.badUrlShort', { url }))
  if (target !== 'external' && workspaceId) {
    await window.stag.browser.newTab(workspaceId, url)
    useUi.getState().setBrowserOpen(true)
  } else window.open(url)
}

/** Bấm một slot: mở URL (trình duyệt trong app / trình duyệt mặc định) hoặc hiện lời nhắn của plugin. */
export async function runSlot(p: InstalledPlugin, slot: PluginSlot, workspaceId?: string, agentId?: string): Promise<void> {
  const toast = usePluginToast.getState()
  try {
    const r = await window.stag.plugins.runSlot(p.manifest.id, slot.id, workspaceId, agentId)
    if (r.openUrl) await openPluginUrl(r.openUrl, r.target, workspaceId)
    if (r.message) toast.show(`${p.manifest.displayName}: ${r.message}`)
  } catch (e) {
    toast.show(`${p.manifest.displayName}: ${pluginErr(e)}`, true)
  }
}

/** Mã tab chính của trang plugin (slot page). */
export const pageTab = (pluginId: string, slotId: string): `plugin:${string}` => `plugin:${pluginId}/${slotId}`

/** Mã widget trong lưới agent (LayoutNode type 'widget'): "<id plugin>/<id slot dashboardWidget>". */
export const widgetId = (pluginId: string, slotId: string): string => `${pluginId}/${slotId}`

/** Tách mã widget; id plugin và id slot không chứa "/". */
export function parseWidgetId(widget: string): { pluginId: string; slotId: string } {
  const i = widget.indexOf('/')
  return i === -1 ? { pluginId: widget, slotId: '' } : { pluginId: widget.slice(0, i), slotId: widget.slice(i + 1) }
}

/** Widget (slot dashboardWidget) thêm được vào lưới agent của workspace: plugin đang chạy và bật cho workspace đó. */
export function widgetsOf(items: InstalledPlugin[], settings: Settings, workspaceId: string): Array<{ id: string; plugin: InstalledPlugin; slot: PluginSlot }> {
  return slotsOf(items, settings, 'dashboardWidget', workspaceId).map((x) => ({ id: widgetId(x.plugin.manifest.id, x.slot.id), ...x }))
}
