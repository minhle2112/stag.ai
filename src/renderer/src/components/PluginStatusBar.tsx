import { useEffect, useState } from 'react'
import type { InstalledPlugin, PluginSlot, PluginStatusText } from '@shared/plugins'
import { pluginErr, runSlot, slotsOf, usePlugins } from '../store/plugins'
import { useSettings } from '../store/settings'
import { useActiveWorkspace } from '../store/workspaces'
import { errorLogOnce, loadStatusText, statusSlotClickable, STATUS_BAR_CHANNEL, STATUS_BAR_REFRESH_MS, STATUS_TONE } from './pluginStatus'

const errors = errorLogOnce()

/**
 * Các mục plugin của thanh trạng thái (`StatusBar`): mỗi slot `statusBarItem` của plugin đang chạy và bật cho
 * workspace đang xem là một mục. Không có mục nào thì không hiện gì.
 */
export function PluginStatusItems(): React.JSX.Element | null {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const ws = useActiveWorkspace()
  const slots = slotsOf(items, settings, 'statusBarItem', ws?.id)
  if (!slots.length) return null
  return (
    <>
      {slots.map(({ plugin, slot }) => (
        <StatusItem key={`${plugin.manifest.id}:${slot.id}`} plugin={plugin} slot={slot} workspaceId={ws?.id} />
      ))}
    </>
  )
}

/** Một mục: chữ = displayName hoặc getData(dataKey) của worker; lỗi / rỗng → ẩn (lỗi ghi console một lần). */
function StatusItem({ plugin, slot, workspaceId }: { plugin: InstalledPlugin; slot: PluginSlot; workspaceId?: string }): React.JSX.Element | null {
  const [value, setValue] = useState<PluginStatusText | null>(null)
  const id = plugin.manifest.id
  const name = plugin.manifest.displayName
  // Worker khởi động lại (đọc lại gói, duyệt quyền mới…) → đọc lại chữ.
  const startedAt = plugin.status.startedAt

  // Đọc khi mở, khi đổi workspace, mỗi 60 s và khi worker phát kênh "statusBar".
  useEffect(() => {
    const key = `${id}:${slot.id}`
    let alive = true
    let seq = 0
    const load = async (): Promise<void> => {
      const n = ++seq
      try {
        const v = await loadStatusText(slot, (dataKey) => window.stag.plugins.bridge(id, 'data.get', { key: dataKey }, workspaceId))
        if (!alive || n !== seq) return
        setValue(v)
        errors.ok(key)
      } catch (e) {
        if (!alive || n !== seq) return
        setValue(null)
        errors.fail(key, pluginErr(e))
      }
    }
    void load()
    if (!slot.dataKey) return () => void (alive = false)
    const timer = setInterval(() => void load(), STATUS_BAR_REFRESH_MS)
    const off = window.stag.plugins.onStream((pid, channel) => {
      if (pid === id && channel === STATUS_BAR_CHANNEL) void load()
    })
    return () => {
      alive = false
      clearInterval(timer)
      off()
    }
  }, [id, slot.id, slot.dataKey, slot.displayName, workspaceId, startedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!value) return null
  const tone = STATUS_TONE[value.tone]
  const title = [value.tooltip, `${name} (plugin)`].filter(Boolean).join('\n')
  const body = (
    <>
      {tone.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />}
      <span className="truncate">{value.text}</span>
    </>
  )
  const cls = `flex h-[22px] max-w-[280px] items-center gap-1.5 rounded px-2 ${tone.text}`
  if (!statusSlotClickable(slot))
    return (
      <span className={`${cls} cursor-default`} title={title}>
        {body}
      </span>
    )
  return (
    <button onClick={() => void runSlot(plugin, slot, workspaceId)} title={title} className={`${cls} hover:bg-panel-2 hover:text-fg`}>
      {body}
    </button>
  )
}
