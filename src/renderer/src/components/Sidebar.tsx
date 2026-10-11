import { useEffect, useState } from 'react'
import { agentKind, type Agent, type Workspace } from '@shared/types'
import { leaves } from '../layout'
import { openAgent, useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useUi } from '../store/ui'
import { useWorkspaces } from '../store/workspaces'
import { startNewWorkspace } from '../store/workspaceFlow'
import { useHandoffFor } from '../store/settings'
import { contextView, statusView } from '../status'
import { AgentMenuPanel, MenuItem } from './AgentMenu'
import { Icon } from './Icon'
import { SidebarPluginLinks } from './PluginSlots'
import { RenameAgentDialog } from './RenameAgentDialog'

/**
 * Thanh bên: mọi workspace xếp một cột, bấm tên để chuyển, mũi tên để mở / thu danh sách agent của nó
 * (giống BridgeMind). Mỗi agent chỉ có dấu trạng thái + tên + % context; chi tiết ở chú thích.
 */
export function Sidebar(): React.JSX.Element {
  const { items, activeId, remove } = useWorkspaces()
  // Workspace đang xem luôn mở; workspace khác chỉ mở khi người dùng bấm mũi tên.
  const [opened, setOpened] = useState<string[]>([])
  useEffect(() => {
    if (activeId) setOpened((o) => (o.includes(activeId) ? o : [...o, activeId]))
  }, [activeId])

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
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-line bg-bg">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-dim">
        WORKSPACE
        <button
          onClick={() => void startNewWorkspace()}
          data-tip="Workspace mới"
          aria-label="Workspace mới"
          className="-mr-1 ml-auto grid h-5 w-5 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
        >
          <Icon name="plus" size="s" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {items.map((w) => (
          <WorkspaceGroup
            key={w.id}
            ws={w}
            open={opened.includes(w.id)}
            onToggle={() => setOpened((o) => (o.includes(w.id) ? o.filter((x) => x !== w.id) : [...o, w.id]))}
            onRemove={() => void removeWorkspace(w.id, w.name)}
          />
        ))}
        {items.length === 0 && (
          <button
            onClick={() => void startNewWorkspace()}
            className="mx-3 mt-2 w-[calc(100%-1.5rem)] rounded-md border border-dashed border-line-2 px-3 py-3 text-left text-[12px] text-muted hover:border-line-3 hover:text-fg"
          >
            + Chọn thư mục dự án để tạo workspace
          </button>
        )}
      </div>
      <SidebarPluginLinks />
    </aside>
  )
}

/** Một workspace và danh sách agent của nó. */
function WorkspaceGroup({ ws, open, onToggle, onRemove }: { ws: Workspace; open: boolean; onToggle: () => void; onRemove: () => void }): React.JSX.Element {
  const current = useWorkspaces((s) => s.activeId === ws.id)
  const setActive = useWorkspaces((s) => s.setActive)
  const state = useAgents((s) => s.byWs[ws.id])
  const statuses = useBoard((s) => s.byWs[ws.id]?.statuses)
  const loadAgents = useAgents((s) => s.load)
  const loadBoard = useBoard((s) => s.load)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const setTab = useUi((s) => s.setTab)
  const moveAgent = useAgents((s) => s.moveAgent)
  const [menu, setMenu] = useState(false)
  /** Chỗ sẽ chèn agent đang kéo: trước dòng thứ `dropAt` (= số dòng: cuối danh sách). */
  const [dropAt, setDropAt] = useState<number | null>(null)
  const count = state?.agents.length ?? 0
  const waiting = state && statuses ? statuses.filter((st) => st.activity === 'waiting' && state.running[st.agentId]).length : 0
  const markFor = (i: number): 'before' | 'after' | null => (dropAt === i ? 'before' : dropAt === count && i === count - 1 ? 'after' : null)

  // Nạp agent + trạng thái để thanh bên có dấu trạng thái cho mọi workspace, kể cả chưa mở.
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
    <div className={`mt-px ${open ? 'pb-1' : ''}`}>
      <div
        onClick={() => {
          setActive(ws.id)
          if (!open) onToggle()
        }}
        data-tip={`${ws.path}${current ? '' : '\nBấm để chuyển sang workspace này'}`}
        data-tip-side="right"
        className={`group relative mx-1.5 flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-[3px] pl-2.5 font-medium whitespace-nowrap hover:bg-panel-2 hover:text-fg ${
          current ? 'bg-panel-2 font-semibold text-fg' : 'text-muted'
        }`}
      >
        <span className="min-w-0 truncate">{ws.name}</span>
        <span className="flex-1" />
        {waiting > 0 && !open && (
          <span className="shrink-0 rounded-full bg-wait px-1.5 font-mono text-[11px] leading-4 font-semibold text-[#1a1300]" data-tip={`${waiting} agent chờ bạn`}>
            {waiting}
          </span>
        )}
        <span className="min-w-5 shrink-0 rounded-full bg-panel-3 px-1.5 text-center font-mono text-[11px] leading-4 text-dim">{count}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
          data-tip="Thao tác"
          className={`h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg ${menu ? 'grid' : 'hidden group-hover:grid'}`}
        >
          <Icon name="more" size="s" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          data-tip={open ? 'Thu gọn' : 'Mở rộng'}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg"
        >
          <Icon name="cd" size="s" className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        {menu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={(e) => {
                e.stopPropagation()
                setMenu(false)
              }}
            />
            <div className="absolute top-full right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] font-normal text-fg shadow-[0_14px_40px_rgba(0,0,0,.6)]">
              <MenuItem
                label="Thêm agent"
                onClick={() => {
                  setMenu(false)
                  newAgent()
                }}
              />
              <MenuItem
                label="Mở thư mục dự án"
                onClick={() => {
                  setMenu(false)
                  void window.stag.openFolder(ws.path)
                }}
              />
              <div className="my-1 border-t border-line-2" />
              <MenuItem
                label="Bỏ workspace khỏi app…"
                danger
                onClick={() => {
                  setMenu(false)
                  onRemove()
                }}
              />
            </div>
          </>
        )}
      </div>

      {open && state && (
        <div
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
            <button onClick={newAgent} className="mr-1.5 ml-3.5 block w-[calc(100%-1.25rem)] rounded-md px-2.5 py-1 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
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
  const status = useBoard((s) => s.byWs[ws.id]?.statuses.find((x) => x.agentId === agent.id))
  const wsActive = useWorkspaces((s) => s.activeId === ws.id)
  const onAgentsTab = useUi((s) => s.tab === 'agents' && s.settings === null)
  const selected = wsActive && onAgentsTab && state.focused === agent.id
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const handoff = useHandoffFor(agent.id)
  const [dragging, setDragging] = useState(false)

  const running = !!state.running[agent.id]
  const starting = !!state.starting[agent.id]
  const shown = leaves(state.layout).includes(agent.id)
  const terminal = agentKind(agent) === 'terminal'
  const external = agentKind(agent) === 'external'
  const view = statusView(running, starting, status, agentKind(agent))
  const ctx = running && !terminal ? contextView(status, handoff) : null

  const tip =
    `${agent.name}${agent.role ? ` · ${agent.role}` : ''}\n${view.label}${ctx ? ` · ctx ${ctx.text}` : ''}` +
    `${shown ? '' : '\nÔ đang đóng · bấm để mở'}\nKéo để sắp xếp · bấm đúp để đổi tên`

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
      {mark && <div className={`pointer-events-none absolute right-1.5 left-3.5 z-10 h-0.5 rounded bg-accent ${mark === 'before' ? '-top-px' : '-bottom-px'}`} />}
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
        data-tip={tip}
        data-tip-side="right"
        className={`group mr-1.5 ml-3.5 flex h-7 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2.5 hover:bg-panel-2 ${dragging ? 'opacity-40' : ''} ${
          selected ? 'bg-panel-3' : ''
        }`}
      >
        <span className={`sdot ${view.mark}`} />
        <span className={`min-w-0 flex-1 truncate font-medium ${shown || running ? '' : 'text-dim'}`}>{agent.name}</span>
        {ctx && (
          <span className={`shrink-0 font-mono text-[11px] tabular-nums group-hover:hidden ${ctx.tone === 'full' ? 'text-danger' : 'text-dim'}`}>{ctx.text}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
          data-tip="Thao tác"
          className={`h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg ${menu ? 'grid' : 'hidden group-hover:grid'}`}
        >
          <Icon name="more" size="s" />
        </button>
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <AgentMenuPanel ws={ws} agent={agent} onClose={() => setMenu(false)} onRename={() => setRenaming(true)} className="absolute top-full right-1.5" />
        </>
      )}
      {renaming && <RenameAgentDialog wsId={ws.id} agentId={agent.id} onClose={() => setRenaming(false)} />}
    </div>
  )
}
