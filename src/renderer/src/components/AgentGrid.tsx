import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { agentKind, type Agent, type LayoutNode, type SplitDir, type Workspace } from '@shared/types'
import { setRatio, widgetKey, widgets, type LayoutPath } from '../layout'
import { useAgents, type WorkspaceAgents } from '../store/agents'
import { useExternalAdapters } from '../store/externalAdapters'
import { useBoard } from '../store/board'
import { parseWidgetId, usePlugins, widgetsOf } from '../store/plugins'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { statusView } from '../status'
import { attachTerminal, fitTerminal, focusTerminal } from '../terminals'
import { ContextBadge } from './ContextBadge'
import { MicButton, VoicePanel } from './VoicePanel'
import { Button } from './Modal'
import { PluginFrame } from './PluginFrame'
import { RenameAgentDialog } from './RenameAgentDialog'
import { SkillAvatar } from './settings/SkillsSection'

interface SplitTarget {
  /** Mã ô đích (id agent hoặc widgetKey). */
  agentId: string | null
  dir: SplitDir
}

const CELL_MIME = 'application/x-stag-cell'

/** Ô đang được kéo (theo mã ô: id agent hoặc widgetKey): các ô khác hiện lớp phủ vùng thả. */
const useCellDrag = create<{ dragging: string | null; begin: (id: string) => void; end: () => void }>((set) => {
  let current: string | null = null
  return {
    dragging: null,
    begin(id) {
      current = id
      // Hiện vùng thả ở lượt sau: đổi DOM ngay trong dragstart có thể làm Chromium huỷ kéo.
      setTimeout(() => current === id && set({ dragging: id }), 0)
    },
    end() {
      current = null
      set({ dragging: null })
    }
  }
})

// Ô nguồn có thể đã gắn lại chỗ khác lúc thả nên dragend không tới nó: dọn ở cấp cửa sổ cho chắc.
window.addEventListener('dragend', () => useCellDrag.getState().end())

export function AgentGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useAgents((s) => s.byWs[wsId])
  const { load, start } = useAgents()
  const setNewAgent = useUi((s) => s.setNewAgent)
  const setTarget = (t: SplitTarget): void => setNewAgent({ wsId, ...t })

  const loadBoard = useBoard((s) => s.load)

  useEffect(() => {
    // Thanh bên có thể đã nạp agent của workspace này; nạp lại sẽ đè lên lưới vừa đổi.
    if (!useAgents.getState().byWs[wsId]) load(wsId)
    loadBoard(wsId)
  }, [wsId, load, loadBoard])

  const runningCount = state ? Object.keys(state.running).length : 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <button
          onClick={() => setTarget({ agentId: state?.focused ?? null, dir: 'row' })}
          className="rounded-md bg-panel-2 px-2.5 py-1 hover:bg-line"
        >
          + Agent
        </button>
        <WidgetMenu wsId={wsId} />
        <span className="text-[12px] text-muted">
          {state ? `${state.agents.length} agent · ${runningCount} đang chạy` : '…'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {state?.layout ? (
          <LayoutView node={state.layout} path={[]} ws={workspace} state={state} onSplit={setTarget} />
        ) : (
          state &&
          (state.agents.length ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted">
              <div>Không có ô nào đang mở.</div>
              <div className="text-[12px]">Bấm vào agent ở thanh bên trái để mở lại ô của nó. Phiên đang chạy vẫn chạy khi ô đóng.</div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
              <div>Workspace này chưa có agent.</div>
              <Button primary onClick={() => setTarget({ agentId: null, dir: 'row' })}>
                + Tạo agent đầu tiên
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Agent vừa tạo tự mở phiên khi ô của nó đã có kích thước — xem AgentCell. */}
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

function LayoutView({
  node,
  path,
  ws,
  state,
  onSplit
}: {
  node: LayoutNode
  path: LayoutPath
  ws: Workspace
  state: WorkspaceAgents
  onSplit: (t: SplitTarget) => void
}): React.JSX.Element {
  const setLayout = useAgents((s) => s.setLayout)
  if (node.type === 'widget') return <WidgetCell key={widgetKey(node.widget)} ws={ws} widget={node.widget} state={state} onSplit={onSplit} />
  if (node.type === 'leaf') {
    const agent = state.agents.find((a) => a.id === node.agentId)
    // key theo agent: đổi chỗ ô thì mỗi ô gắn lại đúng terminal của mình (terminals.ts chỉ chuyển phần tử DOM).
    return agent ? <AgentCell key={agent.id} ws={ws} agent={agent} state={state} onSplit={onSplit} /> : <div />
  }
  return (
    <Split
      dir={node.dir}
      ratio={node.ratio}
      onRatio={(r, done) => state.layout && setLayout(ws.id, setRatio(state.layout, path, r), done)}
      a={<LayoutView node={node.a} path={[...path, 'a']} ws={ws} state={state} onSplit={onSplit} />}
      b={<LayoutView node={node.b} path={[...path, 'b']} ws={ws} state={state} onSplit={onSplit} />}
    />
  )
}

function Split({
  dir,
  ratio,
  onRatio,
  a,
  b
}: {
  dir: SplitDir
  ratio: number
  onRatio: (ratio: number, done: boolean) => void
  a: React.ReactNode
  b: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const row = dir === 'row'

  function drag(e: React.MouseEvent): void {
    e.preventDefault()
    const rect = ref.current!.getBoundingClientRect()
    let last = ratio
    // Lớp phủ cả cửa sổ khi kéo: chuột đi qua khung widget (iframe) thì sự kiện chuột vào iframe, không tới đây.
    const shield = document.createElement('div')
    shield.style.cssText = `position:fixed;inset:0;z-index:60;cursor:${row ? 'col-resize' : 'row-resize'}`
    document.body.append(shield)
    const move = (ev: MouseEvent): void => {
      const r = row ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
      last = Math.min(0.85, Math.max(0.15, r))
      onRatio(last, false)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      shield.remove()
      document.body.style.cursor = ''
      onRatio(last, true)
    }
    document.body.style.cursor = row ? 'col-resize' : 'row-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div ref={ref} className={`absolute inset-0 flex ${row ? 'flex-row' : 'flex-col'}`}>
      <div className="relative min-h-0 min-w-0" style={{ flexBasis: `${ratio * 100}%` }}>
        {a}
      </div>
      <div
        onMouseDown={drag}
        className={`shrink-0 bg-line hover:bg-accent ${row ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}`}
      />
      <div className="relative min-h-0 min-w-0 flex-1">{b}</div>
    </div>
  )
}

function AgentCell({
  ws,
  agent,
  state,
  onSplit
}: {
  ws: Workspace
  agent: Agent
  state: WorkspaceAgents
  onSplit: (t: SplitTarget) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const { start, stop, hide, focus } = useAgents()
  const [renaming, setRenaming] = useState(false)
  const running = !!state.running[agent.id]
  const starting = !!state.starting[agent.id]
  const pendingAuto = !!state.autoStart[agent.id]
  const error = state.errors[agent.id]
  const focused = state.focused === agent.id
  const status = useBoard((s) => s.byWs[ws.id]?.statuses.find((x) => x.agentId === agent.id))
  const terminal = agentKind(agent) === 'terminal'
  // Agent của adapter ngoài: hiện tên adapter (vd. Aider) cạnh vai trò.
  const extLabel = useExternalAdapters((s) =>
    agentKind(agent) === 'external' ? (s.items.find((x) => x.manifest.id === agent.adapterId)?.manifest.label ?? `${agent.adapterId} (đã gỡ)`) : null
  )
  const view = statusView(running, starting, status, agentKind(agent))

  useEffect(() => {
    const host = hostRef.current!
    const detach = attachTerminal(agent.id, host)
    const ro = new ResizeObserver(() => fitTerminal(agent.id))
    ro.observe(host)
    return () => {
      ro.disconnect()
      detach()
    }
  }, [agent.id])

  return (
    <div
      className={`absolute inset-0 flex flex-col border ${focused ? 'border-accent/50' : 'border-transparent'}`}
      onMouseDown={() => focus(ws.id, agent.id)}
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(CELL_MIME, agent.id)
          useCellDrag.getState().begin(agent.id)
        }}
        onDragEnd={() => useCellDrag.getState().end()}
        title="Kéo thanh này thả lên ô khác để đổi chỗ"
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-line bg-panel px-2 active:cursor-grabbing"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${view.dot}`} title={view.label} />
        <span className="truncate font-medium" title="Double-click để đổi tên" onDoubleClick={() => setRenaming(true)}>
          {agent.name}
        </span>
        {terminal ? (
          <span className="font-mono text-[11px] text-muted">&gt;_ terminal</span>
        ) : (
          agent.role && <span className="truncate text-[12px] text-muted">{agent.role}</span>
        )}
        {extLabel && <span className="shrink-0 rounded bg-line/60 px-1.5 text-[10.5px] text-muted">{extLabel}</span>}
        {view.waiting && <span className="truncate text-[12px] text-amber-300">{view.label}</span>}
        {status?.handoff && status.handoff !== 'failed' && <span className="truncate text-[12px] text-sky-300">{view.label}</span>}
        <div className="flex-1" />
        {running && <ContextBadge status={status} className="mr-1" />}
        {running && <MicButton wsId={ws.id} agentId={agent.id} />}
        <IconBtn title="Thêm agent bên phải" onClick={() => onSplit({ agentId: agent.id, dir: 'row' })}>
          ◫
        </IconBtn>
        <IconBtn title="Thêm agent bên dưới" onClick={() => onSplit({ agentId: agent.id, dir: 'col' })}>
          ⬓
        </IconBtn>
        {running ? (
          <IconBtn title="Dừng phiên" onClick={() => stop(agent.id)}>
            ■
          </IconBtn>
        ) : (
          <IconBtn title="Mở phiên mới" onClick={() => start(ws.id, agent.id, false)}>
            ▶
          </IconBtn>
        )}
        <IconBtn title={running ? 'Đóng ô (phiên vẫn chạy, mở lại ở thanh bên)' : 'Đóng ô (mở lại ở thanh bên)'} onClick={() => hide(ws.id, agent.id)}>
          ×
        </IconBtn>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg pt-1 pl-2" onClick={() => focusTerminal(agent.id)}>
        <div ref={hostRef} className="h-full w-full overflow-hidden" />
        <VoicePanel agentId={agent.id} />
        {!running && !starting && !pendingAuto && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/80">
            {error ? (
              <div className="max-w-md rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-red-300">{error}</div>
            ) : (
              <div className="text-muted">{terminal ? 'Terminal chưa mở.' : 'Agent chưa chạy.'}</div>
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

      <DropOverlay wsId={ws.id} cell={agent.id} name={agent.name} />

      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
}

/** Lớp phủ vùng thả khi đang kéo một ô khác (đổi chỗ); ô đang bị kéo thì mờ đi. */
function DropOverlay({ wsId, cell, name }: { wsId: string; cell: string; name: string }): React.JSX.Element | null {
  const dragging = useCellDrag((s) => s.dragging)
  const swapCells = useAgents((s) => s.swapCells)
  const [over, setOver] = useState(false)
  useEffect(() => {
    if (!dragging) setOver(false)
  }, [dragging])
  if (!dragging) return null
  if (dragging === cell) return <div className="pointer-events-none absolute inset-0 z-20 bg-bg/50" />
  // Phủ cả ô: không có lớp này thì xterm / khung widget nuốt sự kiện thả.
  return (
    <div
      data-cell-drop={cell}
      className={`absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed ${over ? 'border-accent bg-accent/15' : 'border-line bg-bg/40'}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const from = e.dataTransfer.getData(CELL_MIME) || dragging
        useCellDrag.getState().end()
        swapCells(wsId, from, cell)
      }}
    >
      <span className="pointer-events-none rounded-md bg-panel px-3 py-1.5 text-[12px] text-fg shadow">
        Thả để đổi chỗ với <b>{name}</b>
      </span>
    </div>
  )
}

/** Nút "+ Widget": chỉ hiện khi có widget (slot dashboardWidget) của plugin đang chạy và bật cho workspace này. */
function WidgetMenu({ wsId }: { wsId: string }): React.JSX.Element | null {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const layout = useAgents((s) => s.byWs[wsId]?.layout ?? null)
  const openWidget = useAgents((s) => s.openWidget)
  const [open, setOpen] = useState(false)
  const list = widgetsOf(items, settings, wsId)
  if (!list.length) return null
  const shown = widgets(layout)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Thêm ô widget của plugin vào lưới"
        className="rounded-md bg-panel-2 px-2.5 py-1 hover:bg-line"
      >
        + Widget
      </button>
      {open && (
        <>
          {/* Phủ cả cửa sổ (kể cả khung widget) để bấm ra ngoài là đóng menu. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute top-full left-0 z-40 mt-1 w-72 overflow-hidden rounded-md border border-line bg-panel py-0.5 shadow-lg">
            {list.map(({ id, plugin, slot }) => (
              <button
                key={id}
                role="menuitem"
                data-widget={id}
                onClick={() => {
                  setOpen(false)
                  openWidget(wsId, id)
                }}
                title={shown.includes(id) ? 'Đã mở — bấm để chọn ô đó' : 'Mở cạnh ô đang chọn'}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-panel-2"
              >
                <SkillAvatar name={plugin.manifest.displayName} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {plugin.manifest.displayName} · {slot.displayName}
                </span>
                {shown.includes(id) && <span className="shrink-0 text-[11px] text-muted">đang mở</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Ô widget của plugin (slot dashboardWidget) trong lưới: thanh trên như ô agent (kéo để đổi chỗ, × chỉ bỏ ô), thân là
 * trang của plugin trong khung cách ly theo workspace này. Plugin đã gỡ / tắt / không chạy → ô vẫn giữ chỗ, hiện lời nhắc.
 */
function WidgetCell({
  ws,
  widget,
  state,
  onSplit
}: {
  ws: Workspace
  widget: string
  state: WorkspaceAgents
  onSplit: (t: SplitTarget) => void
}): React.JSX.Element {
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
    <div
      ref={boxRef}
      data-widget-cell={widget}
      className={`absolute inset-0 flex flex-col border ${focused ? 'border-accent/50' : 'border-transparent'}`}
      onMouseDown={() => focus(ws.id, key)}
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(CELL_MIME, key)
          useCellDrag.getState().begin(key)
        }}
        onDragEnd={() => useCellDrag.getState().end()}
        title={`Widget của plugin ${pluginName}: ${slotName}\nKéo thanh này thả lên ô khác để đổi chỗ`}
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-line bg-panel px-2 active:cursor-grabbing"
      >
        <SkillAvatar name={pluginName} size={16} />
        <span className="min-w-0 truncate font-medium">{pluginName}</span>
        <span className="min-w-0 truncate text-[12px] text-muted">{slotName}</span>
        <div className="flex-1" />
        <IconBtn title="Thêm agent bên phải" onClick={() => onSplit({ agentId: key, dir: 'row' })}>
          ◫
        </IconBtn>
        <IconBtn title="Thêm agent bên dưới" onClick={() => onSplit({ agentId: key, dir: 'col' })}>
          ⬓
        </IconBtn>
        <IconBtn title="Đóng widget (thêm lại ở nút + Widget)" onClick={() => closeWidget(ws.id, widget)}>
          ×
        </IconBtn>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg">
        {live ? (
          <PluginFrame plugin={live.plugin} slot={live.slot} workspace={ws} />
        ) : (
          pluginsLoaded &&
          settingsLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted">
              <div>Widget này không còn chạy — xem Cài đặt → Plugin.</div>
              <div className="flex gap-2">
                <Button onClick={() => useUi.getState().openSettings('plugins', installed ? { plugin: pluginId } : undefined)}>Mở Cài đặt → Plugin</Button>
                <Button onClick={() => closeWidget(ws.id, widget)}>× Đóng ô</Button>
              </div>
            </div>
          )
        )}
      </div>

      <DropOverlay wsId={ws.id} cell={key} name={`${pluginName} · ${slotName}`} />
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded px-1.5 py-0.5 text-muted hover:bg-panel-2 hover:text-fg"
    >
      {children}
    </button>
  )
}
