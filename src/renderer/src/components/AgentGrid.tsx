import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { agentKind, type Agent, type AgentKind, type AgentStatus, type LayoutNode, type SplitDir, type Workspace } from '@shared/types'
import { cells, setRatio, widgetKey, widgets, type LayoutPath } from '../layout'
import { useAgents, type WorkspaceAgents } from '../store/agents'
import { useExternalAdapters } from '../store/externalAdapters'
import { useBoard } from '../store/board'
import { useChat } from '../store/chat'
import { parseWidgetId, usePlugins, widgetsOf } from '../store/plugins'
import { useHandoffFor, useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { contextView, statusView, type StatusMark } from '../status'
import { attachTerminal, fitTerminal, focusTerminal, terminalLastLine } from '../terminals'
import { AgentMenuPanel, MenuItem } from './AgentMenu'
import { IconButton } from './shell/IconButton'
import { Icon, type IconName } from './Icon'
import { MicButton, VoicePanel } from './VoicePanel'
import { ChatCell } from './chat/ChatCell'
import { Button } from './Modal'
import { PluginFrame } from './PluginFrame'
import { RenameAgentDialog } from './RenameAgentDialog'
import { SkillAvatar } from './settings/SkillsSection'
import { AdapterTile } from './ui/AdapterTile'
import { Seg } from './ui/Seg'

interface SplitTarget {
  /** Mã ô đích (id agent hoặc widgetKey). */
  agentId: string | null
  dir: SplitDir
  kind?: AgentKind
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

/** Màu chữ trạng thái ở tiêu đề ô theo dấu trạng thái. */
const MARK_TEXT: Record<StatusMark, string> = { ok: 'text-work', in: 'text-info', wa: 'text-wait', off: 'text-dim', tm: 'text-muted' }

export function AgentGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useAgents((s) => s.byWs[wsId])
  const { load, start } = useAgents()
  const setNewAgent = useUi((s) => s.setNewAgent)
  const focusKey = useUi((s) => s.focusCell[wsId] ?? null)
  const setFocusCell = useUi((s) => s.setFocusCell)
  const setTarget = (t: SplitTarget): void => setNewAgent({ wsId, ...t })

  const loadBoard = useBoard((s) => s.load)

  useEffect(() => {
    // Thanh bên có thể đã nạp agent của workspace này; nạp lại sẽ đè lên lưới vừa đổi.
    if (!useAgents.getState().byWs[wsId]) load(wsId)
    loadBoard(wsId)
  }, [wsId, load, loadBoard])

  // Chế độ tập trung: chỉ hiện ô được chọn; không còn ô đó (đã đóng) thì quay về lưới.
  const focused = focusKey && state?.layout && cells(state.layout).includes(focusKey) ? focusKey : null
  const layout: LayoutNode | null = focused ? cellNode(state!.layout!, focused) : (state?.layout ?? null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-line px-2.5">
        <Seg
          value={focused ? 'focus' : 'grid'}
          onChange={(v) => {
            if (v === 'grid') setFocusCell(wsId, null)
            else if (state?.focused && cells(state.layout).includes(state.focused)) setFocusCell(wsId, state.focused)
            else if (state?.layout) setFocusCell(wsId, cells(state.layout)[0] ?? null)
          }}
          options={[
            { value: 'grid', label: <Icon name="grid" size="s" />, tip: 'Lưới' },
            { value: 'focus', label: <Icon name="focus" size="s" />, tip: 'Tập trung vào một ô · Ctrl+Shift+F' }
          ]}
        />
        <div className="flex-1" />
        <IconButton icon="send" tip="Phát lệnh cho nhiều agent" onClick={() => useUi.getState().setBroadcast(wsId)} />
        <AddMenu wsId={wsId} focusedCell={state?.focused ?? null} onAdd={setTarget} />
      </div>

      <div className="relative min-h-0 flex-1">
        {layout ? (
          <LayoutView node={layout} path={[]} ws={workspace} state={state!} onSplit={setTarget} focusMode={!!focused} />
        ) : (
          state &&
          (state.agents.length ? (
            <EmptyGrid>
              <div>Không có ô nào đang mở.</div>
              <div className="text-[12px]">Bấm vào agent ở thanh bên trái để mở ô của nó. Phiên đang chạy vẫn chạy khi ô đóng.</div>
            </EmptyGrid>
          ) : (
            <EmptyGrid>
              <div>Workspace này chưa có agent.</div>
              <Button primary onClick={() => setTarget({ agentId: null, dir: 'row' })}>
                + Tạo agent đầu tiên
              </Button>
            </EmptyGrid>
          ))
        )}
      </div>

      {focused && state && <MiniStrip wsId={wsId} state={state} focusKey={focused} onPick={(k) => setFocusCell(wsId, k)} />}

      {/* Agent vừa tạo tự mở phiên khi ô của nó đã có kích thước thật — xem AgentCell. */}
      <AutoStarter wsId={wsId} state={state} start={start} />
    </div>
  )
}

/** Cây chỉ có ô `key` (để vẽ một ô toàn khung ở chế độ tập trung). */
function cellNode(root: LayoutNode, key: string): LayoutNode | null {
  if (root.type !== 'split') return cells(root)[0] === key ? root : null
  return cellNode(root.a, key) ?? cellNode(root.b, key)
}

function EmptyGrid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[repeating-linear-gradient(135deg,var(--color-bg)_0_8px,#0e1013_8px_16px)] px-6 text-center text-dim">
      <Icon name="grid" size={28} />
      {children}
    </div>
  )
}

/** Nút "+ Agent" kèm mũi tên mở menu: terminal, widget của plugin. */
function AddMenu({ wsId, focusedCell, onAdd }: { wsId: string; focusedCell: string | null; onAdd: (t: SplitTarget) => void }): React.JSX.Element {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const layout = useAgents((s) => s.byWs[wsId]?.layout ?? null)
  const openWidget = useAgents((s) => s.openWidget)
  const [open, setOpen] = useState(false)
  const list = widgetsOf(items, settings, wsId)
  const shown = widgets(layout)

  // Menu rơi xuống pane trình duyệt (view gốc nằm trên HTML) → ẩn view đó khi menu mở.
  useEffect(() => {
    if (!open) return
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [open])

  return (
    <div className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => onAdd({ agentId: focusedCell, dir: 'row' })}
        data-tip="Tạo agent · Ctrl+Alt+N"
        className="inline-flex h-[26px] items-center gap-1.5 rounded-l-md border border-accent bg-accent px-2.5 text-[12px] font-semibold text-accent-on hover:brightness-110"
      >
        <Icon name="plus" size="s" />
        Agent
      </button>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip="Thêm ô · terminal, widget"
        className="inline-grid h-[26px] w-[22px] place-items-center rounded-r-md border border-l-[rgba(3,32,26,.45)] border-accent bg-accent text-accent-on hover:brightness-110"
      >
        <Icon name="cd" size="s" />
      </button>
      {open && (
        <>
          {/* Phủ cả cửa sổ (kể cả khung widget) để bấm ra ngoài là đóng menu. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute top-full right-0 z-40 mt-1 w-64 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] shadow-[0_14px_40px_rgba(0,0,0,.6)]">
            <MenuItem
              label="Terminal"
              hint="shell trong dự án"
              onClick={() => {
                setOpen(false)
                onAdd({ agentId: focusedCell, dir: 'row', kind: 'terminal' })
              }}
            />
            {list.length > 0 && <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">WIDGET PLUGIN</div>}
            {list.map(({ id, plugin, slot }) => (
              <button
                key={id}
                role="menuitem"
                data-widget={id}
                onClick={() => {
                  setOpen(false)
                  openWidget(wsId, id)
                }}
                data-tip={shown.includes(id) ? 'Đã mở — bấm để chọn ô đó' : 'Mở cạnh ô đang chọn'}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-panel-3"
              >
                <SkillAvatar name={plugin.manifest.displayName} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  {plugin.manifest.displayName} · {slot.displayName}
                </span>
                {shown.includes(id) && <span className="shrink-0 text-[11px] text-dim">đang mở</span>}
              </button>
            ))}
          </div>
        </>
      )}
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
  onSplit,
  focusMode
}: {
  node: LayoutNode
  path: LayoutPath
  ws: Workspace
  state: WorkspaceAgents
  onSplit: (t: SplitTarget) => void
  focusMode: boolean
}): React.JSX.Element {
  const setLayout = useAgents((s) => s.setLayout)
  if (node.type === 'widget') return <WidgetCell key={widgetKey(node.widget)} ws={ws} widget={node.widget} state={state} onSplit={onSplit} />
  if (node.type === 'leaf') {
    const agent = state.agents.find((a) => a.id === node.agentId)
    // key theo agent: đổi chỗ ô thì mỗi ô gắn lại đúng terminal của mình (terminals.ts chỉ chuyển phần tử DOM).
    return agent ? <AgentCell key={agent.id} ws={ws} agent={agent} state={state} onSplit={onSplit} focusMode={focusMode} /> : <div />
  }
  return (
    <Split
      dir={node.dir}
      ratio={node.ratio}
      onRatio={(r, done) => state.layout && setLayout(ws.id, setRatio(state.layout, path, r), done)}
      a={<LayoutView node={node.a} path={[...path, 'a']} ws={ws} state={state} onSplit={onSplit} focusMode={focusMode} />}
      b={<LayoutView node={node.b} path={[...path, 'b']} ws={ws} state={state} onSplit={onSplit} focusMode={focusMode} />}
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
      {/* Vạch 1px như bản thiết kế; vùng bắt chuột rộng hơn nằm trong phần tử con. */}
      <div className={`relative z-10 shrink-0 bg-line-2 hover:bg-accent ${row ? 'w-px' : 'h-px'}`}>
        <div onMouseDown={drag} className={`absolute ${row ? '-inset-x-[3px] inset-y-0 cursor-col-resize' : '-inset-y-[3px] inset-x-0 cursor-row-resize'}`} />
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">{b}</div>
    </div>
  )
}

/** Nút nhỏ trên tiêu đề ô: chỉ hiện khi rê chuột vào ô (nút "⋯" luôn hiện mờ). */
function HeadBtn({
  icon,
  tip,
  onClick,
  keep,
  className = ''
}: {
  icon: IconName
  tip: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  keep?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <button
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

function AgentCell({
  ws,
  agent,
  state,
  onSplit,
  focusMode
}: {
  ws: Workspace
  agent: Agent
  state: WorkspaceAgents
  onSplit: (t: SplitTarget) => void
  focusMode: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const { start, focus } = useAgents()
  const setFocusCell = useUi((s) => s.setFocusCell)
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
  // Ô chat (Claude Code chạy stream-json, xem shared/chat.ts): hội thoại thay cho terminal.
  const chat = kind === 'claude' && agent.cell === 'chat'

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
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(CELL_MIME, agent.id)
          useCellDrag.getState().begin(agent.id)
        }}
        onDragEnd={() => useCellDrag.getState().end()}
        className={`flex h-[30px] shrink-0 cursor-grab items-center gap-2 border-b border-line pr-1 pl-1.5 text-[12px] active:cursor-grabbing ${
          view.waiting ? 'bg-gradient-to-r from-wait/15 via-wait/5 to-transparent' : focused ? 'bg-panel-3' : 'bg-panel'
        }`}
      >
        <span className="-mr-1 flex text-dim opacity-0 group-hover/cell:opacity-100" data-tip="Kéo để đổi chỗ">
          <Icon name="grip" size="s" />
        </span>
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
          <HeadBtn icon="focus" tip="Tập trung · Ctrl+Shift+F" onClick={() => setFocusCell(ws.id, focusMode ? null : agent.id)} />
          <CloseBtn wsId={ws.id} agentId={agent.id} running={running} />
          <span className="relative inline-flex">
            <HeadBtn icon="more" tip="Menu ô" keep onClick={() => setMenu(!menu)} />
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(false)} />
                <AgentMenuPanel
                  ws={ws}
                  agent={agent}
                  hideBrowser
                  onClose={() => setMenu(false)}
                  onRename={() => setRenaming(true)}
                  className="absolute top-full right-0 z-40 mt-1"
                  before={
                    <>
                      <MenuItem
                        label="Thêm agent bên phải"
                        onClick={() => {
                          setMenu(false)
                          onSplit({ agentId: agent.id, dir: 'row' })
                        }}
                      />
                      <MenuItem
                        label="Thêm agent bên dưới"
                        onClick={() => {
                          setMenu(false)
                          onSplit({ agentId: agent.id, dir: 'col' })
                        }}
                      />
                      <div className="my-1 border-t border-line-2" />
                    </>
                  }
                />
              </>
            )}
          </span>
        </span>
      </div>

      {chat ? (
        <div className="relative min-h-0 flex-1 bg-panel">
          <ChatCell ws={ws} agent={agent} running={running} starting={starting || pendingAuto} error={error} onStart={(resume) => start(ws.id, agent.id, resume)} />
          <VoicePanel agentId={agent.id} />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 bg-panel pt-1 pl-2" onClick={() => focusTerminal(agent.id)}>
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

      {/* Viền trong 1px: hổ phách khi agent chờ bạn, xám sáng khi là ô đang chọn (teal chỉ dành cho hành động chính). */}
      <div className={`pointer-events-none absolute inset-0 z-[3] border ${view.waiting ? 'border-wait/60' : focused ? 'border-line-3' : 'border-transparent'}`} />

      <DropOverlay wsId={ws.id} cell={agent.id} name={agent.name} />

      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
}

function CloseBtn({ wsId, agentId, running }: { wsId: string; agentId: string; running: boolean }): React.JSX.Element {
  const hide = useAgents((s) => s.hide)
  return <HeadBtn icon="x" tip={running ? 'Đóng ô · phiên vẫn chạy, mở lại ở thanh bên' : 'Đóng ô · mở lại ở thanh bên'} onClick={() => hide(wsId, agentId)} />
}

/** Dải ô nhỏ ở chế độ tập trung: tên + trạng thái + dòng cuối của các ô khác; bấm để chuyển tập trung. */
function MiniStrip({ wsId, state, focusKey, onPick }: { wsId: string; state: WorkspaceAgents; focusKey: string; onPick: (key: string) => void }): React.JSX.Element | null {
  const statuses = useBoard((s) => s.byWs[wsId]?.statuses)
  const [, bump] = useState(0)
  // Dòng cuối của terminal không có sự kiện riêng: làm tươi mỗi 2 giây khi dải đang hiện.
  useEffect(() => {
    const t = setInterval(() => bump((n) => n + 1), 2000)
    return () => clearInterval(t)
  }, [])
  const keys = cells(state.layout).filter((k) => k !== focusKey)
  if (!keys.length) return null
  return (
    <div className="flex h-[66px] shrink-0 gap-px border-t border-line bg-line">
      {keys.map((k) => {
        const agent = state.agents.find((a) => a.id === k)
        const view = agent
          ? statusView(!!state.running[agent.id], !!state.starting[agent.id], statuses?.find((x) => x.agentId === agent.id), agentKind(agent))
          : null
        const w = !agent && k.startsWith('widget:') ? parseWidgetId(k.slice('widget:'.length)) : null
        return (
          <button
            key={k}
            type="button"
            onClick={() => onPick(k)}
            data-tip="Tập trung vào ô này"
            className={`flex min-w-0 flex-1 flex-col gap-1 bg-panel px-2.5 py-2 text-left hover:bg-panel-2 ${view?.waiting ? 'shadow-[inset_0_2px_0_var(--color-wait)]' : ''}`}
          >
            <span className="flex items-center gap-1.5 text-[12px] whitespace-nowrap">
              {view && <span className={`sdot ${view.mark}`} />}
              <b className="font-semibold">{agent?.name ?? w?.slotId ?? 'Widget'}</b>
              {view && <span className={`truncate text-[11px] ${MARK_TEXT[view.mark]}`}>{view.label}</span>}
            </span>
            <span className="truncate font-mono text-[11px] text-dim">{agent ? cellLastLine(agent).slice(0, 90) : 'widget của plugin'}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Dòng cuối của ô (terminal: dòng cuối màn hình; ô chat: dòng cuối câu trả lời gần nhất của agent). */
function cellLastLine(agent: Agent): string {
  if (agent.cell !== 'chat') return terminalLastLine(agent.id)
  const items = useChat.getState().byAgent[agent.id]?.items ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== 'assistant') continue
    for (let j = it.blocks.length - 1; j >= 0; j--) {
      const b = it.blocks[j]
      if (b.type === 'text' && b.text.trim()) return b.text.trim().split(/\r?\n/).pop() ?? ''
      if (b.type === 'tool') return `${b.name}…`
    }
  }
  return ''
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
      className={`absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed ${over ? 'border-accent bg-accent/15' : 'border-line-2 bg-bg/40'}`}
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
      <span className="pointer-events-none rounded-md border border-line-2 bg-panel-2 px-3 py-1.5 text-[12px] text-fg shadow">
        Thả để đổi chỗ với <b>{name}</b>
      </span>
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
  const setFocusCell = useUi((s) => s.setFocusCell)
  const focusMode = useUi((s) => !!s.focusCell[ws.id])
  const items = usePlugins((s) => s.items)
  const pluginsLoaded = usePlugins((s) => s.loaded)
  const settings = useSettings((s) => s.value)
  const settingsLoaded = useSettings((s) => s.loaded)
  const [menu, setMenu] = useState(false)
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
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(CELL_MIME, key)
          useCellDrag.getState().begin(key)
        }}
        onDragEnd={() => useCellDrag.getState().end()}
        className={`flex h-[30px] shrink-0 cursor-grab items-center gap-2 border-b border-line pr-1 pl-1.5 text-[12px] active:cursor-grabbing ${focused ? 'bg-panel-3' : 'bg-panel'}`}
        data-tip={`Widget của plugin ${pluginName}: ${slotName}\nKéo thanh này thả lên ô khác để đổi chỗ`}
      >
        <span className="-mr-1 flex text-dim opacity-0 group-hover/cell:opacity-100">
          <Icon name="grip" size="s" />
        </span>
        <SkillAvatar name={pluginName} size={16} />
        <b className="min-w-0 truncate text-[13px] font-semibold">{pluginName}</b>
        <span className="min-w-0 truncate text-muted @max-[300px]/cell:hidden">{slotName}</span>
        <div className="flex-1" />
        <span className="flex shrink-0 items-center gap-px">
          <HeadBtn icon="focus" tip="Tập trung · Ctrl+Shift+F" onClick={() => setFocusCell(ws.id, focusMode ? null : key)} />
          <HeadBtn icon="x" tip="Đóng widget · thêm lại ở nút + Agent ▾" onClick={() => closeWidget(ws.id, widget)} />
          <span className="relative inline-flex">
            <HeadBtn icon="more" tip="Menu ô" keep onClick={() => setMenu(!menu)} />
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenu(false)} />
                <div className="absolute top-full right-0 z-40 mt-1 w-52 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] shadow-[0_14px_40px_rgba(0,0,0,.6)]">
                  <MenuItem
                    label="Thêm agent bên phải"
                    onClick={() => {
                      setMenu(false)
                      onSplit({ agentId: key, dir: 'row' })
                    }}
                  />
                  <MenuItem
                    label="Thêm agent bên dưới"
                    onClick={() => {
                      setMenu(false)
                      onSplit({ agentId: key, dir: 'col' })
                    }}
                  />
                </div>
              </>
            )}
          </span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1 bg-panel">
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

      <div className={`pointer-events-none absolute inset-0 z-[3] border ${focused ? 'border-line-3' : 'border-transparent'}`} />

      <DropOverlay wsId={ws.id} cell={key} name={`${pluginName} · ${slotName}`} />
    </div>
  )
}
