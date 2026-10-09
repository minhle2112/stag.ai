import { usePlugins, usePluginToast, runSlot, slotsOf } from '../store/plugins'
import { useSettings } from '../store/settings'
import { useActiveWorkspace } from '../store/workspaces'

/** Mục plugin ở thanh bên (slot `sidebar`), theo workspace đang xem. */
export function SidebarPluginLinks(): React.JSX.Element | null {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const ws = useActiveWorkspace()
  const slots = slotsOf(items, settings, 'sidebar', ws?.id)
  if (!slots.length) return null
  return (
    <div className="border-t border-line px-2 pt-2">
      <div className="px-2 pb-1 text-[11px] uppercase tracking-wider text-muted">Plugin</div>
      {slots.map(({ plugin, slot }) => (
        <button
          key={`${plugin.manifest.id}:${slot.id}`}
          onClick={() => void runSlot(plugin, slot, ws?.id)}
          title={`${plugin.manifest.displayName} (plugin)`}
          className="w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-panel-2 hover:text-fg"
        >
          {slot.displayName}
        </button>
      ))}
    </div>
  )
}

/** Nút plugin trên thanh trên cùng (slot `globalToolbarButton`). */
export function ToolbarPluginButtons(): React.JSX.Element {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const ws = useActiveWorkspace()
  return (
    <>
      {slotsOf(items, settings, 'globalToolbarButton', ws?.id).map(({ plugin, slot }) => (
        <button
          key={`${plugin.manifest.id}:${slot.id}`}
          onClick={() => void runSlot(plugin, slot, ws?.id)}
          title={`${plugin.manifest.displayName} (plugin)`}
          className="whitespace-nowrap rounded-md px-3 py-1 text-muted hover:text-fg"
        >
          {slot.displayName}
        </button>
      ))}
    </>
  )
}

/** Lời nhắn của plugin ở góc dưới bên trái (kết quả bấm nút). */
export function PluginToast(): React.JSX.Element | null {
  const { text, bad, hide } = usePluginToast()
  if (!text) return null
  return (
    <div
      role="status"
      className={`fixed bottom-9 left-64 z-30 max-w-md rounded-lg border px-4 py-2.5 text-[12.5px] shadow-xl ${bad ? 'border-red-500/40 bg-[#2a1416] text-red-200' : 'border-line bg-panel text-fg'}`}
    >
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{text}</span>
        <button onClick={hide} className="shrink-0 text-muted hover:text-fg" aria-label="Đóng">
          ×
        </button>
      </div>
    </div>
  )
}
