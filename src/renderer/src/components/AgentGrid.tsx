import { useEffect, useRef, useState } from 'react'
import type { Agent, LayoutNode, SplitDir, Workspace } from '@shared/types'
import { setRatio, type LayoutPath } from '../layout'
import { useAgents, type WorkspaceAgents } from '../store/agents'
import { attachTerminal, fitTerminal, focusTerminal } from '../terminals'
import { CreateAgentDialog } from './CreateAgentDialog'
import { Button } from './Modal'

interface NewAgentTarget {
  agentId: string | null
  dir: SplitDir
}

export function AgentGrid({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useAgents((s) => s.byWs[wsId])
  const { load, create, start } = useAgents()
  const [target, setTarget] = useState<NewAgentTarget | null>(null)

  useEffect(() => {
    load(wsId)
  }, [wsId, load])

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
          state && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
              <div>Workspace này chưa có agent.</div>
              <Button primary onClick={() => setTarget({ agentId: null, dir: 'row' })}>
                + Tạo agent đầu tiên
              </Button>
            </div>
          )
        )}
      </div>

      {target && (
        <CreateAgentDialog
          defaultName={`Agent ${(state?.agents.length ?? 0) + 1}`}
          onCancel={() => setTarget(null)}
          onSubmit={async (v) => {
            await create({ workspaceId: wsId, ...v }, target)
            setTarget(null)
          }}
        />
      )}
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
  onSplit: (t: NewAgentTarget) => void
}): React.JSX.Element {
  const setLayout = useAgents((s) => s.setLayout)
  if (node.type === 'leaf') {
    const agent = state.agents.find((a) => a.id === node.agentId)
    return agent ? <AgentCell ws={ws} agent={agent} state={state} onSplit={onSplit} /> : <div />
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
  onSplit: (t: NewAgentTarget) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const { start, stop, remove, focus } = useAgents()
  const running = !!state.running[agent.id]
  const starting = !!state.starting[agent.id]
  const pendingAuto = !!state.autoStart[agent.id]
  const error = state.errors[agent.id]
  const focused = state.focused === agent.id

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

  async function removeAgent(): Promise<void> {
    const msg = `Xoá agent "${agent.name}" khỏi workspace?\n\nPhiên đang chạy sẽ bị dừng. Note bộ nhớ 60 Agents/${agent.name}.md trong vault vẫn được giữ.`
    if (window.confirm(msg)) await remove(ws.id, agent.id)
  }

  return (
    <div
      className={`absolute inset-0 flex flex-col border ${focused ? 'border-accent/50' : 'border-transparent'}`}
      onMouseDown={() => focus(ws.id, agent.id)}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-emerald-400' : starting ? 'bg-amber-400' : 'bg-muted/50'}`}
          title={running ? 'Đang chạy' : starting ? 'Đang mở' : 'Đã dừng'}
        />
        <span className="truncate font-medium">{agent.name}</span>
        {agent.role && <span className="truncate text-[12px] text-muted">{agent.role}</span>}
        <div className="flex-1" />
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
        <IconBtn title="Xoá agent" onClick={removeAgent}>
          ✕
        </IconBtn>
      </div>

      <div className="relative min-h-0 flex-1 bg-bg pt-1 pl-2" onClick={() => focusTerminal(agent.id)}>
        <div ref={hostRef} className="h-full w-full overflow-hidden" />
        {!running && !starting && !pendingAuto && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/80">
            {error ? (
              <div className="max-w-md rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-red-300">{error}</div>
            ) : (
              <div className="text-muted">Agent chưa chạy.</div>
            )}
            <div className="flex gap-2">
              <Button primary onClick={() => start(ws.id, agent.id, false)}>
                Phiên mới
              </Button>
              {agent.lastSessionId && <Button onClick={() => start(ws.id, agent.id, true)}>Tiếp tục phiên trước</Button>}
            </div>
          </div>
        )}
      </div>
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
