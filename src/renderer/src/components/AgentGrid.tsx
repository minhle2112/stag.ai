import { useEffect, useRef, useState } from 'react'
import { agentKind, type Agent, type AgentStatus, type CanvasCell, type Workspace } from '@shared/types'
import { widgetKey } from '../layout'
import { useAgents, type WorkspaceAgents } from '../store/agents'
import { useExternalAdapters } from '../store/externalAdapters'
import { useBoard } from '../store/board'
import { parseWidgetId, usePlugins, widgetsOf } from '../store/plugins'
import { useHandoffFor, useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { contextView, statusView, type StatusMark } from '../status'
import { attachTerminal, fitTerminal, focusTerminal } from '../terminals'
import { AgentMenuPanel } from './AgentMenu'
import { Icon, type IconName } from './Icon'
import { MicButton, VoicePanel } from './VoicePanel'
import { ChatCell } from './chat/ChatCell'
import { Button } from './Modal'
import { PluginFrame } from './PluginFrame'
import { RenameAgentDialog } from './RenameAgentDialog'
import { SkillAvatar } from './settings/SkillsSection'
import { AdapterTile } from './ui/AdapterTile'
import { CanvasBoard } from './canvas/CanvasBoard'
import { Popover, useFrame } from './canvas/frame'

/** Màu chữ trạng thái ở tiêu đề ô theo dấu trạng thái. */
const MARK_TEXT: Record<StatusMark, string> = { ok: 'text-work', in: 'text-info', wa: 'text-wait', off: 'text-dim', tm: 'text-muted' }

export function AgentGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useAgents((s) => s.byWs[wsId])
  const { load, start } = useAgents()
  const loadBoard = useBoard((s) => s.load)

  useEffect(() => {
    // Thanh bên có thể đã nạp agent của workspace này; nạp lại sẽ đè lên canvas vừa đổi.
    if (!useAgents.getState().byWs[wsId]) load(wsId)
    loadBoard(wsId)
  }, [wsId, load, loadBoard])

  const renderCell = (c: CanvasCell): React.ReactNode => {
    if (!state) return null
    if (c.type === 'widget') return <WidgetCell ws={workspace} widget={c.widget} state={state} />
    const agent = state.agents.find((a) => a.id === c.agentId)
    // key theo agent: ô gắn lại đúng terminal của mình (terminals.ts chỉ chuyển phần tử DOM).
    return agent ? <AgentCell key={agent.id} ws={workspace} agent={agent} state={state} /> : null
  }

  return (
    <div className="relative h-full">
      {state && <CanvasBoard ws={workspace} layout={state.layout} hasAgents={state.agents.length > 0} renderCell={renderCell} />}
      {/* Agent vừa tạo tự mở phiên khi ô của nó đã có kích thước thật — xem AgentCell. */}
      <AutoStarter wsId={wsId} state={state} start={start} />
    </div>
  )
}

/** Mở phiên cho agent vừa tạo sau khi ô đã gắn terminal (để biết số cột/dòng). */
function AutoStarter({
  wsId,
  state,
  start
}: {
  wsId: string
  state: WorkspaceAgents | undefined
  start: (wsId: string, agentId: string, resume: boolean) => Promise<void>
}): null {
  useEffect(() => {
    if (!state) return
    for (const id of Object.keys(state.autoStart)) {
      requestAnimationFrame(() => start(wsId, id, false))
    }
  }, [wsId, state, start])
  return null
}

/** Nút nhỏ trên tiêu đề ô: chỉ hiện khi rê chuột vào ô (`keep` = luôn hiện, mờ khi không rê). */
function HeadBtn({
  icon,
  tip,
  onClick,
  keep,
  className = '',
  btnRef
}: {
  icon: IconName
  tip: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  keep?: boolean
  className?: string
  btnRef?: React.Ref<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <button
      ref={btnRef}
      type="button"
      data-tip={tip}
      aria-label={tip}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={`h-[22px] w-[22px] place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg ${
        keep ? 'inline-grid opacity-60 group-hover/cell:opacity-100' : 'hidden group-hover/cell:inline-grid'
      } ${className}`}
    >
      <Icon name={icon} size="s" />
    </button>
  )
}

/** Nút phóng to ô ra toàn khung canvas / thu về bản đồ (luôn hiện trên tiêu đề ô). */
function MaxBtn(): React.JSX.Element {
  const frame = useFrame()
  return (
    <HeadBtn
      icon={frame.maximized ? 'unfocus' : 'focus'}
      tip={frame.maximized ? 'Thu về bản đồ · Esc / Ctrl+Shift+F' : 'Phóng to toàn khung · Ctrl+Shift+F'}
      keep
      className={frame.maximized ? '!opacity-100 text-fg' : ''}
      onClick={frame.toggleMax}
    />
  )
}

/** Thanh tiêu đề ô: kéo để di chuyển ô trên canvas (trừ khi ô đang phóng to). */
function CellHeader({ className, tip, children }: { className: string; tip?: string; children: React.ReactNode }): React.JSX.Element {
  const frame = useFrame()
  return (
    <div
      onMouseDown={frame.startMove}
      data-tip={tip}
      className={`flex h-[30px] shrink-0 items-center gap-2 border-b border-line pr-1 pl-1.5 text-[12px] ${frame.maximized ? '' : 'cursor-grab active:cursor-grabbing'} ${className}`}
    >
      {!frame.maximized && (
        <span className="-mr-1 flex text-dim opacity-0 group-hover/cell:opacity-100" data-tip="Kéo để di chuyển ô">
          <Icon name="grip" size="s" />
        </span>
      )}
      {children}
    </div>
  )
}

/** Viền trong của ô (bo theo khung): màu nhấn chỉ khi là ô đang chọn. Trạng thái agent (chờ bạn…) chỉ thể hiện ở chấm trước tên. */
function CellBorder({ focused }: { focused: boolean }): React.JSX.Element {
  const frame = useFrame()
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[3] border ${frame.maximized ? '' : 'rounded-[10px]'} ${
        focused ? 'border-accent/70' : 'border-line-2'
      }`}
    />
  )
}

/** Thanh ngữ cảnh ở tiêu đề ô: thanh 40×3px (đỏ khi tới ngưỡng bàn giao), số chính xác nằm trong chú thích. */
function CtxMeter({ agentId, status }: { agentId: string; status: AgentStatus | undefined }): React.JSX.Element | null {
  const handoff = useHandoffFor(agentId)
  const v = contextView(status, handoff)
  if (!v) return null
  const c = status?.context
  const pct = c?.size ? Math.min(100, (c.used / c.size) * 100) : null
  const hot = v.tone === 'full'
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] ${hot ? 'text-danger' : 'text-muted'}`} data-tip={v.title}>
      {pct !== null && (
        <span className="h-[3px] w-10 overflow-hidden rounded-sm bg-panel-3 @max-[340px]/cell:hidden">
          <i className={`block h-full ${hot ? 'bg-danger' : v.tone === 'warn' ? 'bg-wait' : 'bg-neutral'}`} style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="@max-[200px]/cell:hidden">{v.text}</span>
      {v.failed && <span className="text-danger">!</span>}
    </span>
  )
}

function AgentCell({ ws, agent, state }: { ws: Workspace; agent: Agent; state: WorkspaceAgents }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const { start, focus } = useAgents()
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const running = !!state.running[agent.id]
  const starting = !!state.starting[agent.id]
  const pendingAuto = !!state.autoStart[agent.id]
  const error = state.errors[agent.id]
  const focused = state.focused === agent.id
  const status = useBoard((s) => s.byWs[ws.id]?.statuses.find((x) => x.agentId === agent.id))
  const kind = agentKind(agent)
  const terminal = kind === 'terminal'
  // Agent của adapter ngoài: hiện tên adapter (vd. Aider) trên ô nhận diện.
  const extLabel = useExternalAdapters((s) => (kind === 'external' ? (s.items.find((x) => x.manifest.id === agent.adapterId)?.manifest.label ?? `${agent.adapterId} (đã gỡ)`) : null))
  const view = statusView(running, starting, status, kind)
  // Ô chat (Claude Code stream-json / Codex app-server, xem shared/chat.ts): hội thoại thay cho terminal.
  const chat = (kind === 'claude' || kind === 'codex') && agent.cell === 'chat'

  useEffect(() => {
    if (chat) return
    const host = hostRef.current!
    const detach = attachTerminal(agent.id, host)
    const ro = new ResizeObserver(() => fitTerminal(agent.id))
    ro.observe(host)
    return () => {
      ro.disconnect()
      detach()
    }
  }, [agent.id, chat])

  return (
    <div className="group/cell @container/cell absolute inset-0 flex flex-col bg-panel" data-cell={agent.id} onMouseDown={() => focus(ws.id, agent.id)}>
      <CellHeader className={focused ? 'bg-panel-3' : 'bg-panel'}>
        <span className={`sdot ${view.mark}`} data-tip={view.label} />
        <b
          className="min-w-0 truncate text-[13px] font-semibold whitespace-nowrap"
          data-tip={`${agent.name}${agent.role ? ` · ${agent.role}` : ''}\nBấm đúp để đổi tên`}
          onDoubleClick={() => setRenaming(true)}
        >
          {agent.name}
        </b>
        <span className="flex shrink-0 @max-[200px]/cell:hidden">
          <AdapterTile
            kind={kind}
            label={extLabel ?? undefined}
            tip={kind === 'claude' ? 'Claude Code' : kind === 'codex' ? 'Codex' : kind === 'terminal' ? 'Terminal' : (extLabel ?? 'Adapter ngoài')}
          />
        </span>
        {!terminal && <span className={`min-w-0 truncate ${MARK_TEXT[view.mark]} @max-[300px]/cell:hidden`}>{view.label}</span>}
        <div className="flex-1" />
        {running && !terminal && <CtxMeter agentId={agent.id} status={status} />}
        <span className="flex shrink-0 items-center gap-px">
          {running && !terminal && <MicButton wsId={ws.id} agentId={agent.id} />}
          <CloseBtn wsId={ws.id} agentId={agent.id} running={running} />
          <MaxBtn />
          <HeadBtn icon="more" tip="Menu ô" keep btnRef={menuBtn} onClick={() => setMenu(!menu)} />
        </span>
      </CellHeader>
      {menu && (
        <Popover anchor={menuBtn.current} onClose={() => setMenu(false)}>
          <AgentMenuPanel ws={ws} agent={agent} hideBrowser onClose={() => setMenu(false)} onRename={() => setRenaming(true)} />
        </Popover>
      )}

      {chat ? (
        <div className="relative min-h-0 flex-1 bg-panel" data-cell-body>
          <ChatCell ws={ws} agent={agent} running={running} starting={starting || pendingAuto} error={error} onStart={(resume) => start(ws.id, agent.id, resume)} />
          <VoicePanel agentId={agent.id} />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-t-bg pt-1 pl-2" data-cell-body onClick={() => focusTerminal(agent.id)}>
          <div ref={hostRef} className="h-full w-full overflow-hidden" />
          <VoicePanel agentId={agent.id} />
          {!running && !starting && !pendingAuto && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-panel/95">
              {error ? (
                <div className="max-w-md rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-center text-danger">{error}</div>
              ) : (
                <div className="text-dim">{terminal ? 'Terminal chưa mở.' : 'Phiên đã dừng.'}</div>
              )}
              <div className="flex gap-2">
                <Button primary onClick={() => start(ws.id, agent.id, false)}>
                  {terminal ? 'Mở terminal' : 'Phiên mới'}
                </Button>
                {agent.lastSessionId && <Button onClick={() => start(ws.id, agent.id, true)}>Tiếp tục phiên trước</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      <CellBorder focused={focused} />

      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
}

function CloseBtn({ wsId, agentId, running }: { wsId: string; agentId: string; running: boolean }): React.JSX.Element {
  const hide = useAgents((s) => s.hide)
  return <HeadBtn icon="x" tip={running ? 'Đóng ô · phiên vẫn chạy, mở lại ở thanh bên' : 'Đóng ô · mở lại ở thanh bên'} onClick={() => hide(wsId, agentId)} />
}

/**
 * Ô widget của plugin (slot dashboardWidget) trên canvas: thanh trên như ô agent (kéo để di chuyển, × chỉ bỏ ô), thân
 * là trang của plugin trong khung cách ly theo workspace này. Plugin đã gỡ / tắt / không chạy → ô vẫn giữ chỗ, hiện
 * lời nhắc.
 */
function WidgetCell({ ws, widget, state }: { ws: Workspace; widget: string; state: WorkspaceAgents }): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const focus = useAgents((s) => s.focus)
  const closeWidget = useAgents((s) => s.closeWidget)
  const items = usePlugins((s) => s.items)
  const pluginsLoaded = usePlugins((s) => s.loaded)
  const settings = useSettings((s) => s.value)
  const settingsLoaded = useSettings((s) => s.loaded)
  const key = widgetKey(widget)
  const focused = state.focused === key
  const { pluginId, slotId } = parseWidgetId(widget)
  const live = widgetsOf(items, settings, ws.id).find((x) => x.id === widget)
  const installed = items.find((p) => p.manifest.id === pluginId)
  const pluginName = installed?.manifest.displayName ?? pluginId
  const slotName = installed?.manifest.ui.slots.find((x) => x.id === slotId && x.type === 'dashboardWidget')?.displayName ?? slotId

  // Bấm vào trong khung widget không tới onMouseDown của ô (iframe khác tiến trình): trang app mất focus và iframe
  // thành activeElement → chọn ô này.
  useEffect(() => {
    const onBlur = (): void => {
      setTimeout(() => {
        const el = document.activeElement
        if (el && el !== document.body && boxRef.current?.contains(el)) focus(ws.id, key)
      }, 0)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [ws.id, key, focus])

  return (
    <div ref={boxRef} data-widget-cell={widget} className="group/cell @container/cell absolute inset-0 flex flex-col bg-panel" onMouseDown={() => focus(ws.id, key)}>
      <CellHeader className={focused ? 'bg-panel-3' : 'bg-panel'} tip={`Widget của plugin ${pluginName}: ${slotName}\nKéo thanh này để di chuyển ô`}>
        <SkillAvatar name={pluginName} size={16} />
        <b className="min-w-0 truncate text-[13px] font-semibold">{pluginName}</b>
        <span className="min-w-0 truncate text-muted @max-[300px]/cell:hidden">{slotName}</span>
        <div className="flex-1" />
        <span className="flex shrink-0 items-center gap-px">
          <HeadBtn icon="x" tip="Đóng widget · mở lại bằng chuột phải lên canvas → Widget" onClick={() => closeWidget(ws.id, widget)} />
          <MaxBtn />
        </span>
      </CellHeader>

      <div className="relative min-h-0 flex-1 bg-panel" data-cell-body>
        {live ? (
          <PluginFrame plugin={live.plugin} slot={live.slot} workspace={ws} />
        ) : (
          pluginsLoaded &&
          settingsLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-dim">
              <div>Widget này không còn chạy — xem Cài đặt → Plugin.</div>
              <div className="flex gap-2">
                <Button onClick={() => useUi.getState().openSettings('plugins', installed ? { plugin: pluginId } : undefined)}>Mở Cài đặt → Plugin</Button>
                <Button onClick={() => closeWidget(ws.id, widget)}>Đóng ô</Button>
              </div>
            </div>
          )
        )}
      </div>

      <CellBorder focused={focused} />
    </div>
  )
}
