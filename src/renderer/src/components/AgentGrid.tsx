import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { agentKind, type Agent, type LayoutNode, type SplitDir, type Workspace } from '@shared/types'
import { setRatio, type LayoutPath } from '../layout'
import { useAgents, type WorkspaceAgents } from '../store/agents'
import { useExternalAdapters } from '../store/externalAdapters'
import { useBoard } from '../store/board'
import { useUi } from '../store/ui'
import { statusView } from '../status'
import { attachTerminal, fitTerminal, focusTerminal } from '../terminals'
import { ContextBadge } from './ContextBadge'
import { Button } from './Modal'
import { RenameAgentDialog } from './RenameAgentDialog'

interface SplitTarget {
  agentId: string | null
  dir: SplitDir
}

const CELL_MIME = 'application/x-stag-cell'

/** Ô đang được kéo (theo agent): các ô khác hiện lớp phủ vùng thả. */
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
    const move = (ev: MouseEvent): void => {
      const r = row ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height
      last = Math.min(0.85, Math.max(0.15, r))
      onRatio(last, false)
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
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
  const { start, stop, hide, focus, swapCells } = useAgents()
  const dragging = useCellDrag((s) => s.dragging)
  const [dropOver, setDropOver] = useState(false)
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

      {/* Phủ cả ô khi đang kéo một ô khác: không có lớp này thì xterm nuốt sự kiện thả. */}
      {dragging && dragging !== agent.id && (
        <div
          data-cell-drop={agent.id}
          className={`absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed ${
            dropOver ? 'border-accent bg-accent/15' : 'border-line bg-bg/40'
          }`}
          onDragEnter={(e) => {
            e.preventDefault()
            setDropOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropOver(false)
            const from = e.dataTransfer.getData(CELL_MIME) || dragging
            useCellDrag.getState().end()
            swapCells(ws.id, from, agent.id)
          }}
        >
          <span className="pointer-events-none rounded-md bg-panel px-3 py-1.5 text-[12px] text-fg shadow">
            Thả để đổi chỗ với <b>{agent.name}</b>
          </span>
        </div>
      )}
      {dragging === agent.id && <div className="pointer-events-none absolute inset-0 z-20 bg-bg/50" />}

      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
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
