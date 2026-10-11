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
      className="fixed right-3.5 bottom-9 z-30 flex w-[350px] max-w-[92vw] items-center gap-3 rounded-lg border border-l-[3px] border-line-2 border-l-wait bg-panel-2 px-3 py-2.5 text-left shadow-[0_12px_40px_rgba(0,0,0,.55)] hover:bg-panel-3"
    >
      <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-wait px-1 text-[12px] font-bold text-[#1a1300]">{items.length}</span>
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
