import { useEffect, useState } from 'react'
import type { Agent, AgentStatus, Task, Workspace } from '@shared/types'
import { openAgent, useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { ago, localDay, statusView } from '../status'

type ColumnId = 'asking' | 'doing' | 'waiting' | 'done'

const COLUMNS: Array<{ id: ColumnId; label: string; hint: string }> = [
  { id: 'asking', label: 'Đang hỏi việc', hint: 'Agent đang chạy, chưa nhận việc' },
  { id: 'doing', label: 'Đang làm', hint: 'Agent đang làm việc đã nhận' },
  { id: 'waiting', label: 'Chờ bạn', hint: 'Agent cần bạn trả lời, duyệt quyền, hoặc phiên đã dừng giữa chừng' },
  { id: 'done', label: 'Xong', hint: 'Việc agent đã báo xong' }
]

interface AgentCardData {
  agent: Agent
  task?: Task
  status?: AgentStatus
  running: boolean
  starting: boolean
}

/** Thẻ của agent nằm ở cột nào; null = không chạy và không có việc dở → không lên bảng. */
function columnOf(c: AgentCardData): ColumnId | null {
  if (!c.running && !c.starting) return c.task ? 'waiting' : null
  if (!c.task) return 'asking'
  return c.status?.activity === 'waiting' ? 'waiting' : 'doing'
}

export function Kanban({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const board = useBoard((s) => s.byWs[wsId])
  const agentsState = useAgents((s) => s.byWs[wsId])
  const loadBoard = useBoard((s) => s.load)
  const loadAgents = useAgents((s) => s.load)
  const [showOld, setShowOld] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    loadBoard(wsId)
    if (!useAgents.getState().byWs[wsId]) loadAgents(wsId)
  }, [wsId, loadBoard, loadAgents])

  // Cập nhật "5 phút trước"…
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!board || !agentsState) return <div className="absolute inset-0 flex items-center justify-center text-muted">…</div>

  const open = board.tasks.filter((t) => t.status === 'open')
  const cards: Record<ColumnId, AgentCardData[]> = { asking: [], doing: [], waiting: [], done: [] }
  const idle: Agent[] = []
  for (const agent of agentsState.agents) {
    const c: AgentCardData = {
      agent,
      task: open.find((t) => t.agentId === agent.id),
      status: board.statuses.find((s) => s.agentId === agent.id),
      running: !!agentsState.running[agent.id],
      starting: !!agentsState.starting[agent.id]
    }
    const col = columnOf(c)
    if (col) cards[col].push(c)
    else idle.push(agent)
  }

  const today = localDay(new Date(now))
  const done = board.tasks
    .filter((t) => t.status === 'done' && t.doneAt)
    .sort((a, b) => b.doneAt!.localeCompare(a.doneAt!))
  const doneToday = done.filter((t) => localDay(t.doneAt!) === today)
  const doneShown = showOld ? done : doneToday

  function jump(agentId: string): void {
    if (agentsState.agents.some((a) => a.id === agentId)) openAgent(wsId, agentId)
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {COLUMNS.map((col) => {
          const count = col.id === 'done' ? doneToday.length : cards[col.id].length
          return (
            <section key={col.id} className="flex min-w-[240px] flex-1 flex-col rounded-lg border border-line bg-panel">
              <header className="flex items-center gap-2 border-b border-line px-3 py-2" title={col.hint}>
                <span className="font-medium">{col.label}</span>
                <span className={`rounded px-1.5 text-[12px] ${col.id === 'waiting' && count ? 'bg-amber-400/15 text-amber-300' : 'bg-panel-2 text-muted'}`}>
                  {count}
                </span>
                {col.id === 'done' && <span className="text-[12px] text-muted">{showOld ? 'tất cả' : 'hôm nay'}</span>}
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {col.id === 'done' ? (
                  <>
                    {doneShown.map((t) => (
                      <DoneCard key={t.id} task={t} now={now} showDay={showOld && localDay(t.doneAt!) !== today} onClick={() => jump(t.agentId)} />
                    ))}
                    {!doneShown.length && <Empty text={showOld ? 'Chưa có việc nào xong.' : 'Hôm nay chưa có việc nào xong.'} />}
                    {done.length > doneToday.length && (
                      <button onClick={() => setShowOld(!showOld)} className="w-full rounded-md py-1 text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
                        {showOld ? 'Chỉ hiện hôm nay' : `Xem cũ hơn (${done.length - doneToday.length})`}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {cards[col.id].map((c) => (
                      <AgentCard key={c.agent.id} wsId={wsId} data={c} now={now} onClick={() => jump(c.agent.id)} />
                    ))}
                    {!cards[col.id].length && <Empty text={emptyText(col.id, agentsState.agents.length)} />}
                  </>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {idle.length > 0 && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
          <span>Không chạy:</span>
          {idle.map((a) => (
            <button key={a.id} onClick={() => jump(a.id)} className="rounded-md bg-panel-2 px-2 py-0.5 hover:text-fg" title="Mở ô của agent">
              {a.name}
            </button>
          ))}
        </footer>
      )}
    </div>
  )
}

function emptyText(col: ColumnId, agentCount: number): string {
  if (!agentCount) return col === 'asking' ? 'Chưa có agent. Tạo agent ở tab Agents.' : ''
  return { asking: 'Không agent nào đang chờ giao việc.', doing: 'Không agent nào đang làm.', waiting: 'Không có gì chờ bạn.', done: '' }[col]
}

function Empty({ text }: { text: string }): React.JSX.Element | null {
  return text ? <div className="px-1 py-2 text-[12px] text-muted">{text}</div> : null
}

function AgentCard({ wsId, data, now, onClick }: { wsId: string; data: AgentCardData; now: number; onClick: () => void }): React.JSX.Element {
  const { agent, task, status, running, starting } = data
  const view = statusView(running, starting, status)
  const stopped = !running && !starting
  const [menu, setMenu] = useState(false)
  const { completeTask, dropTask } = useBoard()

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-md border bg-panel-2 px-3 py-2 hover:border-accent/50 ${
        view.waiting ? 'border-amber-400/40' : 'border-line'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${view.dot}`} />
        <span className="truncate font-medium">{agent.name}</span>
        {agent.role && <span className="truncate text-[12px] text-muted">{agent.role}</span>}
        <div className="flex-1" />
        {task && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenu(!menu)
            }}
            className="rounded px-1 text-muted opacity-0 hover:bg-line hover:text-fg group-hover:opacity-100"
            title="Thao tác"
          >
            ⋯
          </button>
        )}
      </div>

      {task ? (
        <>
          <div className="mt-1 text-fg">{task.title}</div>
          {task.scope && <div className="mt-0.5 truncate font-mono text-[11px] text-muted" title={task.scope}>{task.scope}</div>}
        </>
      ) : (
        <div className="mt-1 text-[12px] text-muted">Chưa nhận việc</div>
      )}

      <div className={`mt-1.5 flex items-center gap-1 text-[12px] ${view.waiting ? 'text-amber-300' : 'text-muted'}`}>
        {stopped ? (
          <span className="rounded bg-line px-1.5 text-fg/80">Phiên đã dừng</span>
        ) : (
          <span className="truncate">{view.label}</span>
        )}
        {status && !stopped && <span className="text-muted">· {ago(status.since, now)}</span>}
      </div>

      {menu && task && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setMenu(false)}
          className="absolute right-2 top-7 z-10 w-40 overflow-hidden rounded-md border border-line bg-panel shadow-lg"
        >
          <MenuItem
            onClick={() => {
              setMenu(false)
              completeTask(wsId, task.id)
            }}
          >
            Đánh dấu xong
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenu(false)
              if (window.confirm(`Bỏ thẻ "${task.title}"? Thẻ không vào cột Xong.`)) dropTask(wsId, task.id)
            }}
          >
            Bỏ thẻ
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-panel-2">
      {children}
    </button>
  )
}

function DoneCard({ task, now, showDay, onClick }: { task: Task; now: number; showDay: boolean; onClick: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div onClick={onClick} className="cursor-pointer rounded-md border border-line bg-panel-2 px-3 py-2 hover:border-accent/50">
      <div className="text-fg">{task.title}</div>
      <div className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
        <span className="truncate">{task.agentName}</span>
        <span>· {showDay ? localDay(task.doneAt!) : ago(task.doneAt!, now)}</span>
        {task.manual && <span className="rounded bg-line px-1">đánh dấu tay</span>}
      </div>
      {task.summary && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          className={`mt-1 whitespace-pre-wrap text-[12px] text-fg/75 ${open ? '' : 'line-clamp-3'}`}
          title={open ? 'Thu gọn' : 'Xem đủ'}
        >
          {task.summary}
        </div>
      )}
    </div>
  )
}
