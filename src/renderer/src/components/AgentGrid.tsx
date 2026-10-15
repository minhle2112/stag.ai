import { memo, useEffect, useRef, useState } from 'react'
import { agentKind, type Agent, type AgentStatus, type CanvasCell, type Workspace } from '@shared/types'
import { agentFolder, placeOf } from '@shared/projects'
import { findCell, widgetKey } from '../layout'
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
import { ProjectTabs } from './projects/ProjectTabs'
import { useT } from '../i18n'

/** Màu chữ trạng thái ở tiêu đề ô theo dấu trạng thái. */
const MARK_TEXT: Record<StatusMark, string> = { ok: 'text-work', in: 'text-info', wa: 'text-wait', off: 'text-dim', tm: 'text-muted' }

export function AgentGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const t = useT()
  const wsId = workspace.id
  const state = useAgents((s) => s.byWs[wsId])
  // Selector hẹp: useAgents() không selector làm component render lại mỗi khi bất kỳ workspace nào đổi.
  const load = useAgents((s) => s.load)
  const start = useAgents((s) => s.start)
  const loadBoard = useBoard((s) => s.load)

  useEffect(() => {
    // Thanh bên có thể đã nạp agent của workspace này; nạp lại sẽ đè lên canvas vừa đổi.
    if (!useAgents.getState().byWs[wsId]) load(wsId)
    loadBoard(wsId)
  }, [wsId, load, loadBoard])

  const renderCell = (c: CanvasCell): React.ReactNode => {
    if (!state) return null
    if (c.type === 'widget') return <WidgetCell ws={workspace} widget={c.widget} />
    const agent = state.agents.find((a) => a.id === c.agentId)
    // key theo agent: ô gắn lại đúng terminal của mình (terminals.ts chỉ chuyển phần tử DOM).
    return agent ? <AgentCell key={agent.id} ws={workspace} agent={agent} /> : null
  }

  // Workspace có project: mỗi tab (Chung / project) một canvas riêng, chỉ ô của agent thuộc tab đó.
  const projects = workspace.projects ?? []
  const project = state ? projects.find((p) => p.id === state.place) : undefined
  const here = state ? state.agents.filter((a) => placeOf(workspace, a) === state.place).length : 0

  return (
    <div className="flex h-full flex-col">
      <ProjectTabs ws={workspace} />
      <div className="relative min-h-0 flex-1">
        {state && (
          <CanvasBoard
            key={state.place}
            ws={workspace}
            layout={state.layout}
            hasAgents={here > 0}
            renderCell={renderCell}
            emptyTitle={
              project
                ? t('agents.grid.emptyTitle', { name: project.name })
                : projects.length
                  ? t('agents.grid.emptyTitle', { name: t('common.name.rootProject') })
                  : undefined
            }
            emptyHint={
              project ? t('agents.grid.emptyHintProject', { folder: project.folder }) : projects.length ? t('agents.grid.emptyHintRoot') : undefined
            }
          />
        )}
      </div>
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
      // Agent của tab khác (vd. agent khác tạo trong project khác): mở phiên khi người dùng mở tab đó, để terminal có
      // kích thước thật (mở sớm là chạy với 80×24 mặc định).
      if (!findCell(state.layout, id)) continue
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
  const t = useT()
  const frame = useFrame()
  return (
    <HeadBtn
      icon={frame.maximized ? 'unfocus' : 'focus'}
      tip={frame.maximized ? t('agents.grid.restoreTip') : t('agents.grid.maximizeTip')}
      keep
      className={frame.maximized ? '!opacity-100 text-fg' : ''}
      onClick={frame.toggleMax}
    />
  )
}

/** Thanh tiêu đề ô: kéo để di chuyển ô trên canvas (trừ khi ô đang phóng to). */
function CellHeader({ className, tip, children }: { className: string; tip?: string; children: React.ReactNode }): React.JSX.Element {
  const t = useT()
  const frame = useFrame()
  return (
    <div
      onMouseDown={frame.startMove}
      data-tip={tip}
      className={`flex h-[30px] shrink-0 items-center gap-2 border-b border-line pr-1 pl-1.5 text-[12px] ${frame.maximized ? '' : 'cursor-grab active:cursor-grabbing'} ${className}`}
    >
      {!frame.maximized && (
        <span className="-mr-1 flex text-dim opacity-0 group-hover/cell:opacity-100" data-tip={t('agents.grid.dragTip')}>
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

/** memo + selector theo agent: ô chỉ render lại khi phần của chính agent đó đổi, không theo cả workspace. */
const AgentCell = memo(function AgentCell({ ws, agent }: { ws: Workspace; agent: Agent }): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const start = useAgents((s) => s.start)
  const focus = useAgents((s) => s.focus)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const running = useAgents((s) => !!s.byWs[ws.id]?.running[agent.id])
  const starting = useAgents((s) => !!s.byWs[ws.id]?.starting[agent.id])
  const pendingAuto = useAgents((s) => !!s.byWs[ws.id]?.autoStart[agent.id])
  const error = useAgents((s) => s.byWs[ws.id]?.errors[agent.id])
  const focused = useAgents((s) => s.byWs[ws.id]?.focused === agent.id)
  const status = useBoard((s) => s.byWs[ws.id]?.statuses.find((x) => x.agentId === agent.id))
  const kind = agentKind(agent)
  const terminal = kind === 'terminal'
  // Agent của adapter ngoài: hiện tên adapter (vd. Aider) trên ô nhận diện.
  const extLabel = useExternalAdapters((s) => (kind === 'external' ? (s.items.find((x) => x.manifest.id === agent.adapterId)?.manifest.label ?? t('agents.grid.adapterRemoved', { id: agent.adapterId ?? '' })) : null))
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
          data-tip={`${agent.name}${agent.role ? ` · ${agent.role}` : ''}\n${t('agents.grid.renameTip')}`}
          onDoubleClick={() => setRenaming(true)}
        >
          {agent.name}
        </b>
        <span className="flex shrink-0 @max-[200px]/cell:hidden">
          <AdapterTile
            kind={kind}
            label={extLabel ?? undefined}
            tip={kind === 'claude' ? 'Claude Code' : kind === 'codex' ? 'Codex' : kind === 'terminal' ? 'Terminal' : (extLabel ?? t('agents.grid.externalAdapter'))}
          />
        </span>
        {!terminal && <span className={`min-w-0 truncate ${MARK_TEXT[view.mark]} @max-[300px]/cell:hidden`}>{view.label}</span>}
        <div className="flex-1" />
        {running && !terminal && <CtxMeter agentId={agent.id} status={status} />}
        <span className="flex shrink-0 items-center gap-px">
          {running && !terminal && <MicButton wsId={ws.id} agentId={agent.id} />}
          <CloseBtn wsId={ws.id} agentId={agent.id} running={running} />
          <MaxBtn />
          <HeadBtn icon="more" tip={t('agents.grid.menuTip')} keep btnRef={menuBtn} onClick={() => setMenu(!menu)} />
        </span>
      </CellHeader>
      {menu && (
        <Popover anchor={menuBtn.current} onClose={() => setMenu(false)}>
          <AgentMenuPanel ws={ws} agent={agent} hideBrowser onClose={() => setMenu(false)} onRename={() => setRenaming(true)} />
        </Popover>
      )}
      {!terminal && <DoingLine ws={ws} agent={agent} />}

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
                <div className="text-dim">{terminal ? t('agents.grid.terminalClosed') : t('agents.grid.sessionStopped')}</div>
              )}
              <div className="flex gap-2">
                <Button primary onClick={() => start(ws.id, agent.id, false)}>
                  {terminal ? t('agents.menu.openTerminal') : t('agents.menu.newSession')}
                </Button>
                {agent.lastSessionId && <Button onClick={() => start(ws.id, agent.id, true)}>{t('agents.menu.resume')}</Button>}
              </div>
            </div>
          )}
        </div>
      )}

      <CellBorder focused={focused} />

      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
})

/** Dòng "Đang làm" dưới tiêu đề ô: việc đang mở của agent (task_start) + phạm vi đang khoá (thay cho thẻ Kanban cũ). */
function DoingLine({ ws, agent }: { ws: Workspace; agent: Agent }): React.JSX.Element {
  const t = useT()
  const task = useBoard((s) => s.byWs[ws.id]?.tasks.find((x) => x.agentId === agent.id && x.status === 'open'))
  if (!task)
    return (
      <div className="flex h-6 shrink-0 items-center border-b border-line px-2.5 text-[12px] text-dim @max-[220px]/cell:hidden">{t('agents.grid.noTask')}</div>
    )
  const base = task.base ?? agentFolder(ws, agent)
  const files = task.files?.length ? `\n${t('agents.grid.doingFilesTip', { count: task.files.length, files: task.files.slice(-8).join(', ') })}` : ''
  const scope = task.scope ? `\n${t('agents.grid.doingScopeTip', { scope: task.scope, base: base || t('agents.grid.rootFolder') })}` : ''
  return (
    <div
      className="flex h-6 shrink-0 items-center gap-1.5 overflow-hidden border-b border-line bg-panel-2 px-2.5 text-[12px] whitespace-nowrap text-muted"
      data-tip={`${t('agents.grid.doingTip', { title: task.title })}${scope}${files}`}
    >
      <span className="flex shrink-0 text-work">
        <Icon name="check" size="s" />
      </span>
      <span className="shrink-0 @max-[260px]/cell:hidden">{t('agents.grid.doing')}</span>
      <b className="min-w-0 truncate font-medium text-fg">{task.title}</b>
      {task.scope && (
        <span className="ml-auto flex min-w-0 shrink items-center gap-1 font-mono text-[11px] text-dim @max-[340px]/cell:hidden">
          <Icon name="lock" size={11} />
          <span className="truncate">{task.scope}</span>
        </span>
      )}
    </div>
  )
}

function CloseBtn({ wsId, agentId, running }: { wsId: string; agentId: string; running: boolean }): React.JSX.Element {
  const t = useT()
  const hide = useAgents((s) => s.hide)
  return <HeadBtn icon="x" tip={running ? t('agents.grid.closeTipRunning') : t('agents.grid.closeTip')} onClick={() => hide(wsId, agentId)} />
}

/**
 * Ô widget của plugin (slot dashboardWidget) trên canvas: thanh trên như ô agent (kéo để di chuyển, × chỉ bỏ ô), thân
 * là trang của plugin trong khung cách ly theo workspace này. Plugin đã gỡ / tắt / không chạy → ô vẫn giữ chỗ, hiện
 * lời nhắc.
 */
const WidgetCell = memo(function WidgetCell({ ws, widget }: { ws: Workspace; widget: string }): React.JSX.Element {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const focus = useAgents((s) => s.focus)
  const closeWidget = useAgents((s) => s.closeWidget)
  const items = usePlugins((s) => s.items)
  const pluginsLoaded = usePlugins((s) => s.loaded)
  const settings = useSettings((s) => s.value)
  const settingsLoaded = useSettings((s) => s.loaded)
  const key = widgetKey(widget)
  const focused = useAgents((s) => s.byWs[ws.id]?.focused === key)
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
      <CellHeader className={focused ? 'bg-panel-3' : 'bg-panel'} tip={`${t('agents.grid.widgetTip', { plugin: pluginName, slot: slotName })}\n${t('agents.grid.widgetDragTip')}`}>
        <SkillAvatar name={pluginName} size={16} />
        <b className="min-w-0 truncate text-[13px] font-semibold">{pluginName}</b>
        <span className="min-w-0 truncate text-muted @max-[300px]/cell:hidden">{slotName}</span>
        <div className="flex-1" />
        <span className="flex shrink-0 items-center gap-px">
          <HeadBtn icon="x" tip={t('agents.grid.widgetCloseTip')} onClick={() => closeWidget(ws.id, widget)} />
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
              <div>{t('agents.grid.widgetDead')}</div>
              <div className="flex gap-2">
                <Button onClick={() => useUi.getState().openSettings('plugins', installed ? { plugin: pluginId } : undefined)}>
                  {t('agents.grid.widgetOpenSettings')}
                </Button>
                <Button onClick={() => closeWidget(ws.id, widget)}>{t('agents.menu.closeCell')}</Button>
              </div>
            </div>
          )
        )}
      </div>

      <CellBorder focused={focused} />
    </div>
  )
})
