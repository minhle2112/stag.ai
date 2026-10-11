import { useState } from 'react'
import { useBrowser } from '../../store/browser'
import { useBrowserOpen, useSidebarOpen, useUi } from '../../store/ui'
import { useActiveWorkspace, useWorkspaces } from '../../store/workspaces'
import { openAgent } from '../../store/agents'
import { statusReason } from '../../status'
import { Icon } from '../Icon'
import { ToolbarPluginButtons } from '../PluginSlots'
import { IconButton } from './IconButton'
import { useWaitingAgents } from './useWaiting'

/**
 * Thanh tiêu đề tự vẽ (cao 36px): logo, đường dẫn workspace, ô "Tìm hoặc chạy lệnh", chuông, bật / tắt thanh bên và
 * trình duyệt. Nút thu nhỏ / phóng to / đóng là lớp phủ gốc của Windows (titleBarOverlay) nằm ở mép phải.
 */
export function TitleBar(): React.JSX.Element {
  const active = useActiveWorkspace()
  const sidebarOpen = useSidebarOpen()
  const browserOpen = useBrowserOpen()
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const toggleBrowser = useUi((s) => s.toggleBrowser)
  const setPalette = useUi((s) => s.setPalette)
  const waiting = useWaitingAgents()
  const agentDrives = useBrowser((s) => !!active && !!s.byWs[active.id]?.tabs.some((t) => t.owner.kind === 'agent'))
  const [bell, setBell] = useState(false)

  return (
    <header
      className="drag relative flex h-9 shrink-0 items-center gap-3 border-b border-line bg-bg0 pl-3"
      // Chừa chỗ cho nút cửa sổ gốc của Windows ở mép phải.
      style={{ paddingRight: 'calc(100% - env(titlebar-area-width, 100%))' }}
    >
      <div className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] bg-accent text-[12px] leading-none font-bold text-accent-on">S</div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-dim">
        <span>stag.ai</span>
        {active && (
          <>
            <span>/</span>
            <b className="truncate font-semibold text-fg" data-tip={active.path}>
              {active.name}
            </b>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setPalette(true)}
        className="no-drag absolute left-1/2 flex h-6 w-[min(440px,36vw)] -translate-x-1/2 items-center gap-2 rounded-md border border-line-2 bg-panel pr-1.5 pl-2 text-[12px] text-dim hover:border-line-3 hover:text-muted"
      >
        <Icon name="search" size="s" />
        <span className="truncate">Tìm hoặc chạy lệnh…</span>
        <kbd className="ml-auto rounded border border-line-2 border-b-2 bg-panel-2 px-1 font-mono text-[11px] text-muted">Ctrl K</kbd>
      </button>

      <div className="relative ml-auto flex h-full items-center gap-0.5">
        <ToolbarPluginButtons />
        <IconButton
          icon="bell"
          tip={waiting.length ? `${waiting.length} agent đang chờ bạn` : 'Không có agent nào chờ bạn'}
          badge={waiting.length}
          onClick={() => setBell((v) => !v)}
          on={bell}
          className="mr-2"
        />
        <IconButton icon="side" tip="Thanh bên · Ctrl+B" on={sidebarOpen} onClick={toggleSidebar} />
        <IconButton
          icon="globe"
          tip={browserOpen ? 'Ẩn trình duyệt · Ctrl+Shift+B' : `Trình duyệt · Ctrl+Shift+B${agentDrives ? ' · agent đang dùng' : ''}`}
          on={browserOpen}
          dot={agentDrives && !browserOpen}
          onClick={toggleBrowser}
        />
        {bell && <WaitingMenu onClose={() => setBell(false)} />}
      </div>
    </header>
  )
}

/** Danh sách agent đang chờ bạn (từ chuông): bấm một dòng để mở đúng ô của agent đó. */
function WaitingMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const waiting = useWaitingAgents()
  const setActive = useWorkspaces((s) => s.setActive)
  return (
    <>
      <div className="no-drag fixed inset-0 z-40" onMouseDown={onClose} />
      <div className="no-drag absolute top-full right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 shadow-[0_14px_40px_rgba(0,0,0,.6)]">
        {waiting.length === 0 && <div className="px-3 py-3 text-[12px] text-dim">Không có agent nào đang chờ bạn.</div>}
        {waiting.map((w) => (
          <button
            key={`${w.wsId}:${w.agentId}`}
            type="button"
            onClick={() => {
              onClose()
              setActive(w.wsId)
              openAgent(w.wsId, w.agentId)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-panel-3"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-wait" />
            <span className="min-w-0 flex-1 truncate font-medium">{w.agentName}</span>
            <span className="shrink-0 text-[11px] text-dim">{w.wsName}</span>
            <span className="shrink-0 text-[12px] text-wait">{statusReason(w.reason)}</span>
          </button>
        ))}
      </div>
    </>
  )
}
