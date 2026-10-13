import { useEffect, useState } from 'react'
import { overlapsOf, scopeLocks, unlocked, type ScopeOverlap } from '@shared/scope'
import { resolveScope } from '@shared/settings'
import { agentKind, type Agent, type AgentStatus, type Task, type Workspace } from '@shared/types'
import { openAgent, useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { ago, localDay, statusView } from '../status'
import { ContextBadge } from './ContextBadge'
import { Icon, type IconName } from './Icon'
import { AgentAvatar } from './ui/AgentAvatar'
import { Seg } from './ui/Seg'

type ColumnId = 'asking' | 'doing' | 'waiting' | 'done'

const COLUMNS: Array<{ id: ColumnId; label: string; hint: string; dot: string }> = [
  { id: 'asking', label: 'Đang hỏi việc', hint: 'Agent đang chạy, chưa nhận việc', dot: 'bg-neutral' },
  { id: 'doing', label: 'Đang làm', hint: 'Agent đang làm việc đã nhận', dot: 'bg-work' },
  { id: 'waiting', label: 'Chờ bạn', hint: 'Agent cần bạn trả lời, duyệt quyền, hoặc phiên đã dừng giữa chừng', dot: 'bg-wait' },
  { id: 'done', label: 'Xong', hint: 'Việc agent đã báo xong', dot: 'bg-line-3' }
]

interface AgentCardData {
  agent: Agent
  task?: Task
  status?: AgentStatus
  running: boolean
  starting: boolean
  /** Phạm vi việc này đè lên việc đang mở của agent khác (khoá phạm vi, xem shared/scope.ts). */
  overlaps: ScopeOverlap[]
  /** Câu cuối chú thích ⚠ theo chế độ khoá phạm vi. */
  overlapNote: string
}

/** Câu cuối trong chú thích dấu ⚠: app làm gì khi agent sửa vào phạm vi của agent kia (Cài đặt → Khoá phạm vi, cấp workspace). */
const OVERLAP_NOTE = {
  ask: 'Agent sửa file trong phạm vi của agent kia thì app hỏi bạn trước.',
  block: 'Agent sửa file trong phạm vi của agent kia sẽ bị chặn.',
  warn: 'App không chặn khi agent sửa file trong phạm vi của agent kia (chỉ cảnh báo).',
  off: ''
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
  const settings = useSettings((s) => s.value)
  const [showOld, setShowOld] = useState(false)
  const [onlyWaiting, setOnlyWaiting] = useState(false)
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
  const locks = scopeLocks(board.tasks, workspace.path)
  // Khoá phạm vi tắt ở cấp workspace → không hiện ⚠ trùng phạm vi (cấp agent không tính: thẻ nói về cả hai bên).
  const scopeCfg = resolveScope(settings, wsId, null)
  const free = unlocked(workspace.path, workspace.vaultPath, scopeCfg.exempt)
  const cards: Record<ColumnId, AgentCardData[]> = { asking: [], doing: [], waiting: [], done: [] }
  const idle: Agent[] = []
  // Terminal thường không nhận việc, không có trạng thái: không lên kanban.
  const aiAgents = agentsState.agents.filter((a) => agentKind(a) !== 'terminal')
  for (const agent of aiAgents) {
    const task = open.find((t) => t.agentId === agent.id)
    const c: AgentCardData = {
      agent,
      task,
      overlaps: task && scopeCfg.mode !== 'off' ? overlapsOf(task, locks, workspace.path, free) : [],
      overlapNote: OVERLAP_NOTE[scopeCfg.mode],
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

  const waitingCount = cards.waiting.length

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-line px-2.5">
        <Seg
          value={onlyWaiting ? 'wait' : 'all'}
          onChange={(v) => setOnlyWaiting(v === 'wait')}
          options={[
            { value: 'all', label: 'Tất cả' },
            {
              value: 'wait',
              label: (
                <>
                  Chờ bạn
                  {waitingCount > 0 && <span className="font-mono text-[11px] text-wait">{waitingCount}</span>}
                </>
              ),
              tip: 'Làm mờ các cột khác, chỉ giữ việc đang chờ bạn'
            }
          ]}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 gap-2.5 overflow-x-auto p-3">
        {COLUMNS.map((col) => {
          const count = col.id === 'done' ? doneToday.length : cards[col.id].length
          const dim = onlyWaiting && col.id !== 'waiting'
          return (
            <section
              key={col.id}
              className={`flex min-h-0 min-w-[220px] flex-col rounded-lg border border-line bg-panel transition-opacity ${dim ? 'opacity-35' : ''}`}
            >
              <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5 font-semibold" data-tip={col.hint}>
                <span className={`h-[7px] w-[7px] rounded-full ${col.dot}`} />
                {col.label}
                <span className={`font-mono text-[11px] font-normal ${col.id === 'waiting' && count ? 'text-wait' : 'text-dim'}`}>{count}</span>
                {col.id === 'done' && <span className="ml-auto text-[11px] font-normal text-dim">{showOld ? 'tất cả' : 'hôm nay'}</span>}
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
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
                    {!cards[col.id].length && <Empty text={emptyText(col.id, aiAgents.length)} />}
                  </>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {idle.length > 0 && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-dim">
          <span>Không chạy:</span>
          {idle.map((a) => (
            <button
              key={a.id}
              onClick={() => jump(a.id)}
              className="inline-flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-0.5 text-muted hover:text-fg"
              data-tip="Mở ô của agent"
            >
              <AgentAvatar agent={a} size={14} />
              {a.name}
            </button>
          ))}
        </footer>
      )}
    </div>
  )
}

function emptyText(col: ColumnId, agentCount: number): string {
  if (!agentCount) return col === 'asking' ? 'Chưa có agent. Tạo agent ở màn Agent.' : ''
  return { asking: 'Không agent nào đang chờ giao việc.', doing: 'Không agent nào đang làm.', waiting: 'Không có gì chờ bạn.', done: '' }[col]
}

function Empty({ text }: { text: string }): React.JSX.Element | null {
  return text ? <div className="px-1 py-2 text-[12px] text-dim">{text}</div> : null
}

/** Biểu tượng + chữ của dòng "đang chờ gì" trên thẻ. */
function stateLine(data: AgentCardData, label: string): { icon: IconName; tone: string; text: string } | null {
  const { status, running, starting } = data
  if (!running && !starting) return { icon: 'stop', tone: 'text-dim', text: 'Phiên đã dừng' }
  if (status?.handoff === 'asking' || status?.handoff === 'restarting') return { icon: 'handoff', tone: 'text-info', text: label }
  if (status?.activity === 'waiting') return { icon: status.reason === 'permission' ? 'shield' : 'ask', tone: 'text-wait', text: label }
  return label ? { icon: 'spark', tone: 'text-muted', text: label } : null
}

function AgentCard({ wsId, data, now, onClick }: { wsId: string; data: AgentCardData; now: number; onClick: () => void }): React.JSX.Element {
  const { agent, task, status, running, starting, overlaps, overlapNote } = data
  const view = statusView(running, starting, status)
  const stopped = !running && !starting
  const [menu, setMenu] = useState(false)
  const { completeTask, dropTask } = useBoard()
  const line = stateLine(data, view.label)
  const since = status && !stopped ? ago(status.since, now) : null

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-lg border bg-panel-2 p-2.5 hover:border-line-3 ${view.waiting ? 'border-wait/40' : 'border-line-2'}`}
    >
      <div className="mb-2 flex items-baseline gap-2 leading-snug font-medium">
        <span className={`min-w-0 flex-1 ${task ? '' : 'font-normal text-dim'}`}>{task ? task.title : 'Chưa nhận việc'}</span>
        {task && !view.waiting && since && <time className="shrink-0 font-mono text-[11px] font-normal text-dim">{since}</time>}
      </div>

      <div className="flex items-center gap-2.5 text-[12px] text-muted">
        <span className="flex max-w-[45%] shrink-0 items-center gap-1.5">
          <AgentAvatar agent={agent} size={16} />
          <span className="truncate">{agent.name}</span>
        </span>
        {task?.scope && (
          <code className="min-w-0 truncate rounded bg-panel-3 px-1 font-mono text-[11px]" data-tip={task.scope}>
            {task.scope}
          </code>
        )}
        {!!task?.files?.length && (
          <span className="shrink-0" data-tip={`File đã sửa (cũng bị khoá cho agent khác):\n${task.files.join('\n')}`}>
            {task.files.length} tệp
          </span>
        )}
        <span className="flex-1" />
        {!stopped && <ContextBadge status={status} />}
        {task && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenu(!menu)
            }}
            className="hidden h-5 w-5 shrink-0 place-items-center rounded text-dim group-hover:grid hover:bg-panel-3 hover:text-fg"
            data-tip="Thao tác"
          >
            <Icon name="more" size="s" />
          </button>
        )}
      </div>

      {overlaps.map((o) => (
        <div
          key={o.other.id}
          className="mt-2 flex items-start gap-1.5 rounded bg-wait/10 px-1.5 py-1 text-[11px] text-wait"
          data-tip={`Việc "${o.other.title}" của ${o.other.agentName} (phạm vi: ${o.other.scope}). ${overlapNote}`}
        >
          <Icon name="lock" size="s" className="mt-px" />
          <span className="min-w-0">
            Trùng phạm vi với {o.other.agentName}: <span className="font-mono">{o.labels.join(', ')}</span>
          </span>
        </div>
      ))}

      {line && (
        <div className={`mt-2 flex min-h-[22px] items-center gap-1.5 text-[12px] ${line.tone}`}>
          <Icon name={line.icon} size="s" />
          <span className="min-w-0 flex-1 truncate">{line.text}</span>
        </div>
      )}

      {view.waiting && (
        <div className="mt-1.5 box-content flex h-[22px] items-center gap-1.5 border-t border-line-2 pt-1.5">
          <time className="font-mono text-[11px] text-dim" data-tip={since ? `Đã chờ bạn ${since}` : undefined}>
            chờ {since ?? '…'}
          </time>
          <span className="flex-1" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
            className="inline-flex h-[22px] items-center rounded-md border border-line-2 bg-panel-3 px-2 text-[12px] font-medium hover:border-line-3"
            data-tip="Mở ô của agent trong lưới"
          >
            Mở ô
          </button>
        </div>
      )}

      {menu && task && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setMenu(false)}
          className="absolute top-8 right-2 z-10 w-40 overflow-hidden rounded-lg border border-line-2 bg-pop p-1 shadow-pop"
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
    <button onClick={onClick} className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-panel-3">
      {children}
    </button>
  )
}

function DoneCard({ task, now, showDay, onClick }: { task: Task; now: number; showDay: boolean; onClick: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div onClick={onClick} className="cursor-pointer rounded-lg border border-line-2 bg-panel-2 p-2.5 hover:border-line-3">
      <div className="mb-2 flex items-baseline gap-2 leading-snug font-medium">
        <span className="min-w-0 flex-1">{task.title}</span>
        <time className="shrink-0 font-mono text-[11px] font-normal text-dim">{showDay ? localDay(task.doneAt!) : ago(task.doneAt!, now)}</time>
      </div>
      <div className="flex items-center gap-2.5 text-[12px] text-muted">
        <span className="flex max-w-[45%] shrink-0 items-center gap-1.5">
          <AgentAvatar name={task.agentName} size={16} />
          <span className="truncate">{task.agentName}</span>
        </span>
        {task.scope && (
          <code className="min-w-0 truncate rounded bg-panel-3 px-1 font-mono text-[11px]" data-tip={task.scope}>
            {task.scope}
          </code>
        )}
        {!!task.files?.length && <span className="shrink-0">{task.files.length} tệp</span>}
        {task.manual && (
          <span className="shrink-0 rounded bg-panel-3 px-1 text-[11px]" data-tip="Bạn đánh dấu xong bằng tay">
            tay
          </span>
        )}
      </div>
      {task.summary && (
        <div
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
          className={`mt-2 text-[12px] whitespace-pre-wrap text-muted ${open ? '' : 'line-clamp-3'}`}
          data-tip={open ? 'Thu gọn' : 'Xem đủ'}
        >
          {task.summary}
        </div>
      )}
    </div>
  )
}
