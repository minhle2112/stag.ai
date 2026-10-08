import { useEffect, useState } from 'react'
import type { Agent, CreateWorkspaceResult, Workspace, WorkspaceInspection } from '@shared/types'
import { leaves } from '../layout'
import { openAgent, useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useUi } from '../store/ui'
import { useWorkspaces } from '../store/workspaces'
import { statusView } from '../status'
import { CreateReport, CreateWorkspaceDialog } from './CreateWorkspaceDialog'
import { ContextBadge, handoffNow } from './ContextBadge'
import { RenameAgentDialog } from './RenameAgentDialog'
import { SettingsDialog } from './SettingsDialog'

export function Sidebar(): React.JSX.Element {
  const { items, setActive, add, remove } = useWorkspaces()
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null)
  const [report, setReport] = useState<CreateWorkspaceResult | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [settings, setSettings] = useState(false)

  async function newWorkspace(): Promise<void> {
    const path = await window.stag.workspace.pick()
    if (!path) return
    const info = await window.stag.workspace.inspect(path)
    if (info.existing) {
      setActive(info.existing.id)
      return
    }
    setInspection(info)
  }

  async function removeWorkspace(id: string, name: string): Promise<void> {
    if (
      window.confirm(
        `Bỏ workspace "${name}" khỏi app?\n\nCác agent của workspace này sẽ bị dừng và bỏ khỏi app. Không xoá file nào trên đĩa (code, vault, note agent vẫn giữ nguyên).`
      )
    ) {
      await remove(id)
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-4 py-3 text-[15px] font-semibold tracking-tight">stag.ai</div>
      <div className="px-4 pb-1 text-[11px] uppercase tracking-wider text-muted">Workspaces</div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items.map((w) => (
          <WorkspaceGroup
            key={w.id}
            ws={w}
            open={!collapsed.includes(w.id)}
            onToggle={() => setCollapsed((c) => (c.includes(w.id) ? c.filter((x) => x !== w.id) : [...c, w.id]))}
            onRemove={() => removeWorkspace(w.id, w.name)}
          />
        ))}
        <button onClick={newWorkspace} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-muted hover:bg-panel-2 hover:text-fg">
          + Workspace
        </button>
      </div>

      <button
        onClick={() => window.stag.openTemplates()}
        className="m-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-fg"
        title="Mở thư mục template vault để chỉnh mẫu"
      >
        Chỉnh template vault…
      </button>
      <button
        onClick={() => setSettings(true)}
        className="mx-2 mb-2 -mt-1 rounded-md px-2 py-1.5 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-fg"
      >
        Cài đặt…
      </button>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}

      {inspection && (
        <CreateWorkspaceDialog
          inspection={inspection}
          onClose={() => setInspection(null)}
          onCreated={(r) => {
            add(r.workspace)
            setInspection(null)
            setReport(r)
          }}
        />
      )}
      {report && <CreateReport result={report} onClose={() => setReport(null)} />}
    </aside>
  )
}

/** Một workspace và danh sách agent của nó (giống danh sách phiên của Claude Code). */
function WorkspaceGroup({
  ws,
  open,
  onToggle,
  onRemove
}: {
  ws: Workspace
  open: boolean
  onToggle: () => void
  onRemove: () => void
}): React.JSX.Element {
  const active = useWorkspaces((s) => s.activeId === ws.id)
  const setActive = useWorkspaces((s) => s.setActive)
  const state = useAgents((s) => s.byWs[ws.id])
  const loadAgents = useAgents((s) => s.load)
  const loadBoard = useBoard((s) => s.load)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const setTab = useUi((s) => s.setTab)
  const moveAgent = useAgents((s) => s.moveAgent)
  /** Chỗ sẽ chèn agent đang kéo: trước dòng thứ `dropAt` (= số dòng: cuối danh sách). */
  const [dropAt, setDropAt] = useState<number | null>(null)
  const count = state?.agents.length ?? 0
  const markFor = (i: number): 'before' | 'after' | null =>
    dropAt === i ? 'before' : dropAt === count && i === count - 1 ? 'after' : null

  // Nạp agent + trạng thái để thanh bên có chấm trạng thái cho mọi workspace, kể cả chưa mở.
  useEffect(() => {
    if (!useAgents.getState().byWs[ws.id]) loadAgents(ws.id)
    if (!useBoard.getState().byWs[ws.id]) loadBoard(ws.id)
  }, [ws.id, loadAgents, loadBoard])

  function newAgent(): void {
    setActive(ws.id)
    setTab('agents')
    setNewAgent({ wsId: ws.id, agentId: state?.focused ?? null, dir: 'row' })
  }

  return (
    <div className="mb-1">
      <div
        onClick={() => {
          setActive(ws.id)
          if (!open) onToggle()
        }}
        title={ws.path}
        className={`group flex cursor-pointer items-center gap-1 rounded-md py-1.5 pr-1 pl-1 ${
          active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="w-4 shrink-0 text-[10px] text-muted hover:text-fg"
          title={open ? 'Thu gọn' : 'Mở rộng'}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="min-w-0 flex-1 truncate font-medium">{ws.name}</span>
        <HoverBtn title="Thêm agent" onClick={newAgent}>
          +
        </HoverBtn>
        <HoverBtn title="Bỏ workspace khỏi app" onClick={onRemove}>
          ×
        </HoverBtn>
      </div>

      {open && state && (
        <div
          className="mt-0.5 ml-3 border-l border-line pl-1.5"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
          }}
        >
          {state.agents.map((a, i) => (
            <AgentRow
              key={a.id}
              ws={ws}
              agent={a}
              mark={markFor(i)}
              onDragOverRow={(after) => {
                const from = state.agents.findIndex((x) => x.id === rowDrag?.agentId)
                const at = i + (after ? 1 : 0)
                // Thả ngay tại chỗ cũ thì không đổi gì: không hiện vạch.
                setDropAt(at === from || at === from + 1 ? null : at)
              }}
              onDropRow={() => {
                const drag = rowDrag
                setDropAt(null)
                if (!drag || drag.wsId !== ws.id || dropAt === null) return
                const from = state.agents.findIndex((x) => x.id === drag.agentId)
                moveAgent(ws.id, drag.agentId, from < dropAt ? dropAt - 1 : dropAt)
              }}
              onDragDone={() => setDropAt(null)}
            />
          ))}
          {!state.agents.length && (
            <button onClick={newAgent} className="w-full rounded-md px-2 py-1 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
              + Tạo agent
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Agent đang được kéo ở thanh bên (dataTransfer không đọc được lúc dragover nên giữ ở đây). */
let rowDrag: { wsId: string; agentId: string } | null = null
const ROW_MIME = 'application/x-stag-agent-row'

function AgentRow({
  ws,
  agent,
  mark,
  onDragOverRow,
  onDropRow,
  onDragDone
}: {
  ws: Workspace
  agent: Agent
  /** Vạch báo chỗ thả: trên hay dưới dòng này. */
  mark: 'before' | 'after' | null
  onDragOverRow: (after: boolean) => void
  onDropRow: () => void
  onDragDone: () => void
}): React.JSX.Element {
  const state = useAgents((s) => s.byWs[ws.id])!
  const { start, stop, hide, remove } = useAgents()
  const status = useBoard((s) => s.byWs[ws.id]?.statuses.find((x) => x.agentId === agent.id))
  const wsActive = useWorkspaces((s) => s.activeId === ws.id)
  const onAgentsTab = useUi((s) => s.tab === 'agents')
  const selected = wsActive && onAgentsTab && state.focused === agent.id
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [dragging, setDragging] = useState(false)

  const running = !!state.running[agent.id]
  const starting = !!state.starting[agent.id]
  const shown = leaves(state.layout).includes(agent.id)
  const view = statusView(running, starting, status)

  /** Mở ô rồi mới mở phiên, để terminal đã có kích thước thật. */
  function openAndStart(resume: boolean): void {
    openAgent(ws.id, agent.id)
    requestAnimationFrame(() => requestAnimationFrame(() => start(ws.id, agent.id, resume)))
  }

  async function removeAgent(): Promise<void> {
    const msg =
      `Xoá agent "${agent.name}"?\n\n` +
      `• Dừng phiên nếu đang chạy\n` +
      `• Chuyển note 60 Agents/${agent.name}.md trong vault vào Thùng rác (khôi phục được)\n` +
      `• Bỏ thẻ việc đang dở trên kanban\n\n` +
      `Lịch sử việc đã xong trên kanban được giữ.`
    if (!window.confirm(msg)) return
    try {
      await remove(ws.id, agent.id)
    } catch (e) {
      window.alert(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const item = (label: string, fn: () => void, danger = false): React.JSX.Element => (
    <button
      onClick={(e) => {
        e.stopPropagation()
        setMenu(false)
        fn()
      }}
      className={`block w-full px-3 py-1.5 text-left hover:bg-panel-2 ${danger ? 'text-red-300' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (rowDrag?.wsId !== ws.id) return // chỉ sắp xếp trong cùng workspace
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const r = e.currentTarget.getBoundingClientRect()
        onDragOverRow(e.clientY > r.top + r.height / 2)
      }}
      onDrop={(e) => {
        if (rowDrag?.wsId !== ws.id) return
        e.preventDefault()
        onDropRow()
      }}
    >
      {mark && <div className={`pointer-events-none absolute right-1 left-0 z-10 h-0.5 rounded bg-accent ${mark === 'before' ? '-top-px' : '-bottom-px'}`} />}
      <div
        draggable
        onDragStart={(e) => {
          rowDrag = { wsId: ws.id, agentId: agent.id }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData(ROW_MIME, agent.id)
          setMenu(false)
          setDragging(true)
        }}
        onDragEnd={() => {
          rowDrag = null
          setDragging(false)
          onDragDone()
        }}
        onClick={() => openAgent(ws.id, agent.id)}
        onDoubleClick={() => setRenaming(true)}
        title={`${agent.name}${agent.role ? ` · ${agent.role}` : ''} — ${view.label}${shown ? '' : ' (ô đang đóng)'}\nKéo để sắp xếp · double-click để đổi tên`}
        className={`group flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1 pl-2 ${dragging ? 'opacity-40' : ''} ${
          selected ? 'bg-panel-2 text-fg' : shown || running ? 'text-fg/85 hover:bg-panel-2/60' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
        }`}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${view.dot}`} />
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        {view.waiting && <span className="shrink-0 text-[11px] text-amber-300 group-hover:hidden">chờ bạn</span>}
        {running && !view.waiting && <ContextBadge status={status} className="group-hover:hidden" />}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
          className={`shrink-0 rounded px-1 text-muted hover:bg-line hover:text-fg ${menu ? '' : 'hidden group-hover:block'}`}
          title="Thao tác"
        >
          ⋯
        </button>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute top-full right-1 z-20 w-48 overflow-hidden rounded-md border border-line bg-panel py-0.5 shadow-lg">
            {!shown && item('Mở ô', () => openAgent(ws.id, agent.id))}
            {!running && !starting && item('Phiên mới', () => openAndStart(false))}
            {!running && !starting && agent.lastSessionId && item('Tiếp tục phiên trước', () => openAndStart(true))}
            {running && item('Bàn giao sang phiên mới', () => void handoffNow(agent.id))}
            {running && item('Dừng phiên', () => stop(agent.id))}
            {shown && item('Đóng ô', () => hide(ws.id, agent.id))}
            {item('Đổi tên…', () => setRenaming(true))}
            <div className="my-0.5 border-t border-line" />
            {item('Xoá agent…', removeAgent, true)}
          </div>
        </>
      )}
      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
}

function HoverBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="hidden shrink-0 rounded px-1 text-muted hover:bg-line hover:text-fg group-hover:block"
      title={title}
    >
      {children}
    </button>
  )
}
