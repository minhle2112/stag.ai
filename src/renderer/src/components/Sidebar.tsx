import { Fragment, useEffect, useState } from 'react'
import { CHUNG, monorepoCandidates, placeOf } from '@shared/projects'
import { agentKind, type Agent, type Project, type Workspace } from '@shared/types'
import { leaves } from '../layout'
import { agentPlace, openAgent, useAgents } from '../store/agents'
import { groupDropAt, moveIndex } from '../store/agentOrder'
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
import { ProjectMark } from './projects/ProjectMark'
import { t, tx, useT } from '../i18n'

/**
 * Thanh bên: mọi workspace xếp một cột, bấm tên để chuyển, mũi tên để mở / thu danh sách agent của nó
 * (giống BridgeMind). Mỗi agent chỉ có dấu trạng thái + tên + % context; chi tiết ở chú thích.
 */
export function Sidebar(): React.JSX.Element {
  useT()
  const { items, activeId, remove } = useWorkspaces()
  // Workspace đang xem luôn mở; workspace khác chỉ mở khi người dùng bấm mũi tên.
  const [opened, setOpened] = useState<string[]>([])
  useEffect(() => {
    if (activeId) setOpened((o) => (o.includes(activeId) ? o : [...o, activeId]))
  }, [activeId])

  async function removeWorkspace(id: string, name: string): Promise<void> {
    if (
      window.confirm(
        t('shell.side.removeAsk', { name })
      )
    ) {
      await remove(id)
    }
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-line bg-bg">
      <div className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-dim">
        {t('shell.side.workspaces')}
        <button
          onClick={() => void startNewWorkspace()}
          data-tip={t('shell.side.newWorkspace')}
          aria-label={t('shell.side.newWorkspace')}
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
            {t('shell.side.pickFolder')}
          </button>
        )}
      </div>
      <SidebarPluginLinks />
    </aside>
  )
}

/** Một workspace và danh sách agent của nó. */
function WorkspaceGroup({ ws, open, onToggle, onRemove }: { ws: Workspace; open: boolean; onToggle: () => void; onRemove: () => void }): React.JSX.Element {
  useT()
  const current = useWorkspaces((s) => s.activeId === ws.id)
  const setActive = useWorkspaces((s) => s.setActive)
  const state = useAgents((s) => s.byWs[ws.id])
  const statuses = useBoard((s) => s.byWs[ws.id]?.statuses)
  const loadAgents = useAgents((s) => s.load)
  const loadBoard = useBoard((s) => s.load)
  const moveAgent = useAgents((s) => s.moveAgent)
  const [menu, setMenu] = useState(false)
  /** Chỗ sẽ chèn agent đang kéo: trong nhóm `place`, trước dòng thứ `at` của nhóm (= số dòng của nhóm: cuối nhóm). */
  const [drop, setDrop] = useState<{ place: string; at: number } | null>(null)
  const count = state?.agents.length ?? 0
  const waiting = state && statuses ? statuses.filter((st) => st.activity === 'waiting' && state.running[st.agentId]).length : 0
  // Vạch thả chỉ vẽ trong nhóm đang thả (chỉ số trong mảng chung có thể rơi vào dòng của nhóm khác).
  const markFor = (place: string, j: number, n: number): 'before' | 'after' | null =>
    drop?.place !== place ? null : drop.at === j ? 'before' : drop.at === n && j === n - 1 ? 'after' : null

  // Nạp agent + trạng thái để thanh bên có dấu trạng thái cho mọi workspace, kể cả chưa mở.
  useEffect(() => {
    if (!useAgents.getState().byWs[ws.id]) loadAgents(ws.id)
    if (!useBoard.getState().byWs[ws.id]) loadBoard(ws.id)
  }, [ws.id, loadAgents, loadBoard])

  return (
    <div className={`mt-px ${open ? 'pb-1' : ''}`}>
      <div
        // Workspace đang xem: bấm để thu gọn / mở rộng. Workspace khác: chuyển sang (và mở rộng nếu đang thu gọn).
        onClick={() => {
          if (current) return onToggle()
          setActive(ws.id)
          if (!open) onToggle()
        }}
        data-tip={`${ws.path}\n${current ? (open ? t('shell.side.collapseTip') : t('shell.side.expandTip')) : t('shell.side.switchTip')}`}
        data-tip-side="right"
        className={`group relative mx-1.5 flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-[3px] pl-2.5 font-medium whitespace-nowrap hover:bg-panel-2 hover:text-fg ${
          current ? 'bg-panel-2 font-semibold text-fg' : 'text-muted'
        }`}
      >
        <span className="min-w-0 truncate">{ws.name}</span>
        <span className="flex-1" />
        {waiting > 0 && !open && (
          <span className="shrink-0 rounded-full bg-wait px-1.5 font-mono text-[11px] leading-4 font-semibold text-wait-on" data-tip={t('shell.side.waitingTip', { count: waiting })}>
            {waiting}
          </span>
        )}
        <span className="min-w-5 shrink-0 rounded-full bg-panel-3 px-1.5 text-center font-mono text-[11px] leading-4 text-dim">{count}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenu(!menu)
          }}
          data-tip={t('shell.side.actions')}
          className={`h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg ${menu ? 'grid' : 'hidden group-hover:grid'}`}
        >
          <Icon name="more" size="s" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          data-tip={open ? t('shell.side.collapse') : t('shell.side.expand')}
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
            <div className="absolute top-full right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-line-2 bg-pop p-1 text-[13px] font-normal text-fg shadow-pop">
              <MenuItem
                label={t('shell.side.newProject')}
                hint="Ctrl Shift P"
                onClick={() => {
                  setMenu(false)
                  useUi.getState().setNewProject({ wsId: ws.id })
                }}
              />
              <MenuItem
                label={t('shell.side.openFolder')}
                onClick={() => {
                  setMenu(false)
                  void window.stag.openFolder(ws.path)
                }}
              />
              <div className="my-1 border-t border-line-2" />
              <MenuItem
                label={t('shell.side.removeWorkspace')}
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
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
          }}
        >
          {groupsOf(ws, state.agents).map((g) => {
            const ids = g.agents.map((a) => a.id)
            return (
            <Fragment key={g.place}>
              {g.head && <PlaceRow ws={ws} project={g.project} agents={g.agents} />}
              {g.agents.map((a, j) => (
            <AgentRow
              key={a.id}
              ws={ws}
              agent={a}
              mark={markFor(g.place, j, ids.length)}
              onDragOverRow={(after) => {
                // Thả ngay tại chỗ cũ thì không đổi gì: không hiện vạch.
                const at = rowDrag ? groupDropAt(ids, rowDrag.agentId, j, after) : null
                setDrop(at === null ? null : { place: g.place, at })
              }}
              onDropRow={() => {
                const drag = rowDrag
                setDrop(null)
                if (!drag || drag.wsId !== ws.id || drop?.place !== g.place) return
                const index = moveIndex(state.agents.map((x) => x.id), ids, drag.agentId, drop.at)
                if (index >= 0) moveAgent(ws.id, drag.agentId, index)
              }}
              onDragDone={() => setDrop(null)}
            />
              ))}
              {g.head && !g.agents.length && <div className="mr-1.5 ml-7 px-2 py-0.5 text-[12px] text-dim">{t('shell.side.noAgents')}</div>}
            </Fragment>
            )
          })}
          {!state.agents.length && !ws.projects?.length && (
            <div className="mr-1.5 ml-3.5 px-2.5 py-1 text-[12px] text-dim">
              {t('shell.side.noAgentsHint')}
            </div>
          )}
          {!ws.projects?.length && !ws.projectHintOff && <MonorepoHint ws={ws} />}
        </div>
      )}
    </div>
  )
}

/** Agent đang được kéo ở thanh bên (dataTransfer không đọc được lúc dragover nên giữ ở đây). */
let rowDrag: { wsId: string; agentId: string; place: string } | null = null
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
  useT()
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
  const place = agentPlace(ws.id, agent)
  const shown = leaves(place === state.place ? state.layout : (state.layouts[place] ?? state.layout)).includes(agent.id)
  const task = useBoard((s) => s.byWs[ws.id]?.tasks.find((t) => t.agentId === agent.id && t.status === 'open'))
  const grouped = !!ws.projects?.length
  const terminal = agentKind(agent) === 'terminal'
  const external = agentKind(agent) === 'external'
  const view = statusView(running, starting, status, agentKind(agent))
  const ctx = running && !terminal ? contextView(status, handoff) : null

  const tip =
    `${agent.name}${agent.role ? ` · ${agent.role}` : ''}\n${view.label}${ctx ? ` · ctx ${ctx.text}` : ''}` +
    (terminal ? '' : task ? `\n${t('shell.side.working', { title: task.title })}${task.scope ? `\n${t('shell.side.lockedScope', { scope: task.scope })}` : ''}` : `\n${t('shell.side.noTask')}`) +
    `${shown ? '' : `\n${t('shell.side.cellClosed')}`}\n${t('shell.side.dragHint')}`

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        // Chỉ sắp xếp trong cùng workspace và cùng chỗ (agent không chuyển sang project khác).
        if (rowDrag?.wsId !== ws.id || rowDrag.place !== agentPlace(ws.id, agent)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const r = e.currentTarget.getBoundingClientRect()
        onDragOverRow(e.clientY > r.top + r.height / 2)
      }}
      onDrop={(e) => {
        if (rowDrag?.wsId !== ws.id || rowDrag.place !== agentPlace(ws.id, agent)) return
        e.preventDefault()
        onDropRow()
      }}
    >
      {mark && <div className={`pointer-events-none absolute right-1.5 left-3.5 z-10 h-0.5 rounded bg-accent ${mark === 'before' ? '-top-px' : '-bottom-px'}`} />}
      <div
        draggable
        onDragStart={(e) => {
          rowDrag = { wsId: ws.id, agentId: agent.id, place: agentPlace(ws.id, agent) }
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
        className={`group mr-1.5 ${grouped ? 'ml-6' : 'ml-3.5'} flex h-7 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2.5 hover:bg-panel-2 ${dragging ? 'opacity-40' : ''} ${
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
          data-tip={t('shell.side.actions')}
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

/** Nhóm dòng ở thanh bên: không có project → một nhóm không đầu; có → Chung rồi từng project, mỗi nhóm có dòng đầu. */
function groupsOf(ws: Workspace, agents: Agent[]): Array<{ place: string; project: Project | null; agents: Agent[]; head: boolean }> {
  const projects = ws.projects ?? []
  if (!projects.length) return [{ place: CHUNG, project: null, agents, head: false }]
  return [{ id: CHUNG, project: null as Project | null }, ...projects.map((p) => ({ id: p.id, project: p as Project | null }))].map((g) => ({
    place: g.id,
    project: g.project,
    agents: agents.filter((a) => placeOf(ws, a) === g.id),
    head: true
  }))
}

/** Dòng đầu nhóm (Chung / project): bấm để mở tab đó trên canvas. */
function PlaceRow({ ws, project, agents }: { ws: Workspace; project: Project | null; agents: Agent[] }): React.JSX.Element {
  useT()
  const id = project?.id ?? CHUNG
  const state = useAgents((s) => s.byWs[ws.id])
  const statuses = useBoard((s) => s.byWs[ws.id]?.statuses)
  const wsActive = useWorkspaces((s) => s.activeId === ws.id)
  const onAgentsTab = useUi((s) => s.tab === 'agents' && s.settings === null)
  const current = wsActive && onAgentsTab && state?.place === id
  const waiting = agents.filter((a) => state?.running[a.id] && statuses?.some((st) => st.agentId === a.id && st.activity === 'waiting')).length
  return (
    <div
      onClick={() => {
        useWorkspaces.getState().setActive(ws.id)
        useUi.getState().setTab('agents')
        useAgents.getState().setPlace(ws.id, id)
      }}
      data-tip={project ? `${project.folder}${project.goal ? `\n${project.goal}` : ''}` : t('shell.side.rootTip')}
      data-tip-side="right"
      className={`mt-1.5 mr-1.5 ml-3.5 flex h-6 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] font-semibold hover:bg-panel-2 ${current ? 'bg-panel-3 text-fg' : 'text-muted'}`}
    >
      <ProjectMark project={project} size={9} />
      <span className="min-w-0 flex-1 truncate">{project ? project.name : t('common.name.rootProject')}</span>
      {waiting > 0 && <span className="shrink-0 rounded-full bg-wait px-1.5 font-mono text-[11px] leading-4 font-semibold text-wait-on">{waiting}</span>}
      <span className="min-w-5 shrink-0 rounded-full bg-panel-3 px-1.5 text-center font-mono text-[11px] leading-4 font-normal text-dim">{agents.length}</span>
    </div>
  )
}

/** Thẻ gợi ý tách monorepo (`apps/*`, `packages/*` có package.json) thành project; "Để sau" = tắt luôn cho workspace này. */
function MonorepoHint({ ws }: { ws: Workspace }): React.JSX.Element | null {
  useT()
  const [found, setFound] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    window.stag.project
      .folders(ws.id)
      .then((f) => alive && setFound(monorepoCandidates(f)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [ws.id])
  if (found.length < 2) return null
  const shown = found.slice(0, 3)
  return (
    <div className="mx-2 mt-2.5 rounded-lg border border-dashed border-line-3 bg-panel p-2.5 text-[12px] text-muted">
      <div className="flex gap-1.5">
        <span className="mt-px flex shrink-0 text-accent">
          <Icon name="spark" size="s" />
        </span>
        <span>
          {tx('shell.side.monorepo', {
            folders: shown.map((f, i) => (
              <Fragment key={f}>
                {i > 0 && ', '}
                <b className="text-fg">{f}</b>
              </Fragment>
            )),
            more: found.length > shown.length ? t('shell.side.monorepoMore', { count: found.length - shown.length }) : ''
          })}
        </span>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => useUi.getState().setNewProject({ wsId: ws.id, folder: found[0] })}
          className="h-6 rounded-md border border-line-2 bg-panel-2 px-2 text-fg hover:bg-panel-3"
        >
          {t('shell.side.newProject')}
        </button>
        <button
          type="button"
          onClick={() => void window.stag.project.hideHint(ws.id).then((w) => useWorkspaces.getState().replace(w))}
          className="h-6 rounded-md px-2 hover:bg-panel-3 hover:text-fg"
        >
          {t('shell.side.later')}
        </button>
      </div>
    </div>
  )
}
