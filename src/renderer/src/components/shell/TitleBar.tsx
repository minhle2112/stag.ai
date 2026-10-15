import { useEffect, useState } from 'react'
import { useBrowser } from '../../store/browser'
import { useInspect } from '../../store/inspect'
import { needsYou } from '@shared/inspect'
import { useBrowserOpen, useSidebarOpen, useUi } from '../../store/ui'
import { useActiveWorkspace, useWorkspaces } from '../../store/workspaces'
import { openAgent } from '../../store/agents'
import { statusReason } from '../../status'
import { Icon } from '../Icon'
import { ToolbarPluginButtons } from '../PluginSlots'
import { IconButton } from './IconButton'
import { useWaitingAgents } from './useWaiting'
import { useTheme } from '../../store/theme'
import { useT } from '../../i18n'
import { useComputer } from '../../store/computer'

/**
 * Thanh tiêu đề tự vẽ (cao 36px): logo, đường dẫn workspace, ô "Tìm hoặc chạy lệnh", chuông, bật / tắt thanh bên và
 * trình duyệt. Nút thu nhỏ / phóng to / đóng cũng tự vẽ ở mép phải (lớp phủ gốc của Windows gần như không đổi màu khi rê chuột).
 */
export function TitleBar(): React.JSX.Element {
  const t = useT()
  const active = useActiveWorkspace()
  const sidebarOpen = useSidebarOpen()
  const browserOpen = useBrowserOpen()
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const toggleBrowser = useUi((s) => s.toggleBrowser)
  const toggleComputer = useUi((s) => s.toggleComputer)
  const dock = useUi((s) => s.dock)
  const cuHolder = useComputer((s) => s.state?.holder ?? null)
  const setPalette = useUi((s) => s.setPalette)
  const waiting = useWaitingAgents()
  const agentDrives = useBrowser((s) => !!active && !!s.byWs[active.id]?.tabs.some((t) => t.owner.kind === 'agent'))
  const [bell, setBell] = useState(false)
  const theme = useTheme((s) => s.theme)
  // Bình luận chế độ Soi có trả lời mới của agent (bạn chưa xem): chỉ ghi trong tooltip nút Trình duyệt, không hiện badge.
  const loadInspect = useInspect((s) => s.load)
  const inspectWaiting = useInspect((s) => (active ? (s.byWs[active.id]?.pins.filter((p) => needsYou(p.state)).length ?? 0) : 0))
  useEffect(() => {
    if (active) void loadInspect(active.id).catch(() => {})
  }, [active, loadInspect])

  return (
    <header
      className="drag relative flex h-9 shrink-0 items-center gap-3 border-b border-line bg-bg0 pl-3"
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
        <span className="truncate">{t('shell.title.search')}</span>
        <kbd className="ml-auto rounded border border-line-2 border-b-2 bg-panel-2 px-1 font-mono text-[11px] text-muted">Ctrl K</kbd>
      </button>

      <div className="relative ml-auto flex h-full items-center gap-0.5">
        <ToolbarPluginButtons />
        <IconButton
          icon="bell"
          tip={waiting.length ? t('shell.title.waiting', { count: waiting.length }) : t('shell.title.noneWaiting')}
          badge={waiting.length}
          onClick={() => setBell((v) => !v)}
          on={bell}
          className="mr-2"
        />
        <IconButton
          icon={theme === 'dark' ? 'sun' : 'moon'}
          tip={theme === 'dark' ? t('shell.title.toLight') : t('shell.title.toDark')}
          onClick={() => void window.stag.theme.toggle()}
        />
        <IconButton icon="side" tip={t('shell.title.sidebar')} on={sidebarOpen} onClick={toggleSidebar} />
        <IconButton
          icon="globe"
          tip={
            (browserOpen ? t('shell.title.hideBrowser') : `${t('shell.title.browser')}${agentDrives ? t('shell.title.agentUsing') : ''}`) +
            (inspectWaiting ? `\n${t('shell.title.inspectReplies', { count: inspectWaiting })}` : '')
          }
          on={browserOpen && dock === 'browser'}
          dot={agentDrives && !(browserOpen && dock === 'browser')}
          onClick={toggleBrowser}
        />
        <IconButton
          icon="monitor"
          tip={
            browserOpen && dock === 'computer'
              ? t('computer.title.hide')
              : `${t('computer.title.tip')}${cuHolder ? `
${t('computer.title.driving', { name: cuHolder.agentName })}` : ''}`
          }
          on={browserOpen && dock === 'computer'}
          dot={!!cuHolder && !(browserOpen && dock === 'computer')}
          onClick={toggleComputer}
        />
        {bell && <WaitingMenu onClose={() => setBell(false)} />}
      </div>
      <WindowControls />
    </header>
  )
}

/** Ba nút cửa sổ kiểu Windows 11: rê chuột thì nền sáng lên, nút đóng chuyển đỏ. */
function WindowControls(): React.JSX.Element {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void window.stag.win.isMaximized().then(setMaximized)
    return window.stag.win.onMaximized(setMaximized)
  }, [])
  const base = 'no-drag grid h-full w-[46px] place-items-center text-muted transition-colors duration-100'
  return (
    <div className="flex h-full shrink-0 self-stretch">
      <button type="button" aria-label={t('shell.title.minimize')} data-tip={t('shell.title.minimize')} onClick={() => window.stag.win.minimize()} className={`${base} hover:bg-line-2 hover:text-fg active:bg-line-3`}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? t('shell.title.restore') : t('shell.title.maximize')}
        data-tip={maximized ? t('shell.title.restore') : t('shell.title.maximize')}
        onClick={() => window.stag.win.toggleMaximize()}
        className={`${base} hover:bg-line-2 hover:text-fg active:bg-line-3`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          {maximized ? (
            <>
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" />
              <path d="M2.5 2.5v-2h7v7h-2" stroke="currentColor" />
            </>
          ) : (
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
          )}
        </svg>
      </button>
      <button type="button" aria-label={t('shell.title.close')} data-tip={t('shell.title.close')} onClick={() => window.stag.win.close()} className={`${base} hover:bg-close-hover hover:text-white active:bg-close-hover/85`}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )
}

/** Danh sách agent đang chờ bạn (từ chuông): bấm một dòng để mở đúng ô của agent đó. */
function WaitingMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const waiting = useWaitingAgents()
  const setActive = useWorkspaces((s) => s.setActive)
  return (
    <>
      <div className="no-drag fixed inset-0 z-40" onMouseDown={onClose} />
      <div className="no-drag absolute top-full right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-line-2 bg-pop p-1 shadow-pop">
        {waiting.length === 0 && <div className="px-3 py-3 text-[12px] text-dim">{t('shell.title.noneWaitingMenu')}</div>}
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
