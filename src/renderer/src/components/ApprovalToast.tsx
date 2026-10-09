import { useApprovals } from '../store/approvals'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'

/** Góc dưới màn hình chính: có lần gọi tool connector đang chờ duyệt → nút mở Cài đặt → Connector → Duyệt. */
export function ApprovalToast(): React.JSX.Element | null {
  const items = useApprovals((s) => s.items)
  const settings = useUi((s) => s.settings)
  const open = useUi((s) => s.openSettings)
  const connectors = useSettings((s) => s.value.app.connectors.items)
  if (!items.length || settings === 'connectors') return null
  const first = items[0]
  return (
    <button
      type="button"
      onClick={() => open('connectors', { review: true })}
      className="fixed bottom-9 right-4 z-30 flex max-w-sm items-center gap-3 rounded-xl border border-amber-400/50 bg-panel px-4 py-3 text-left shadow-2xl hover:bg-panel-2"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-bold text-black">{items.length}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">Đang chờ bạn duyệt</span>
        <span className="block truncate text-[12px] text-muted">
          {first.agentName} muốn dùng {connectors.find((c) => c.id === first.connectorId)?.label || first.connectorId} · {first.tool}
          {items.length > 1 ? ` (+${items.length - 1})` : ''}
        </span>
      </span>
      <span className="text-[12px] text-accent">Mở →</span>
    </button>
  )
}
