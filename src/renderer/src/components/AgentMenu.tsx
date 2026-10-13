import { useEffect } from 'react'
import { agentKind, type Agent, type Workspace } from '@shared/types'
import { CHUNG } from '@shared/projects'
import { leaves } from '../layout'
import { agentPlace, openAgent, useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { runSlot, slotsOf, usePlugins } from '../store/plugins'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { handoffNow } from './ContextBadge'
import { ProjectMark } from './projects/ProjectMark'

export function MenuItem({ label, onClick, danger, hint }: { label: string; onClick: () => void; danger?: boolean; hint?: string }): React.JSX.Element {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left whitespace-nowrap hover:bg-panel-3 ${danger ? 'text-danger' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[12px] text-dim">{hint}</span>}
    </button>
  )
}

/**
 * Menu thao tác của một agent (thanh bên và tiêu đề ô dùng chung): mở ô, phiên mới / tiếp tục, bàn giao, dừng, đóng ô,
 * đổi tên, Model & effort, Connector, Skill, mục menu của plugin, xoá. `before` = mục riêng của nơi gọi.
 * `hideBrowser`: menu có thể rơi lên pane trình duyệt (view gốc nằm trên HTML) → ẩn view đó khi menu mở.
 */
export function AgentMenuPanel({
  ws,
  agent,
  onClose,
  onRename,
  before,
  hideBrowser = false,
  className = ''
}: {
  ws: Workspace
  agent: Agent
  onClose: () => void
  onRename: () => void
  before?: React.ReactNode
  hideBrowser?: boolean
  className?: string
}): React.JSX.Element {
  const state = useAgents((s) => s.byWs[ws.id])
  const { start, stop, hide, remove, setCell, adopt } = useAgents()
  const openTask = useBoard((s) => s.byWs[ws.id]?.tasks.find((t) => t.agentId === agent.id && t.status === 'open'))
  const openSettings = useUi((s) => s.openSettings)
  const pluginItems = usePlugins((s) => s.items)
  const settingsValue = useSettings((s) => s.value)

  useEffect(() => {
    if (!hideBrowser) return
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [hideBrowser])

  const running = !!state?.running[agent.id]
  const starting = !!state?.starting[agent.id]
  const here = agentPlace(ws.id, agent)
  const shown = !!state && leaves(here === state.place ? state.layout : (state.layouts[here] ?? state.layout)).includes(agent.id)
  // Nhân bản sang chỗ khác (Chung / project khác): chỉ khi workspace có project.
  const projects = ws.projects ?? []
  const cloneTargets = projects.length ? [{ id: CHUNG, project: null }, ...projects.map((p) => ({ id: p.id, project: p }))].filter((t) => t.id !== here) : []
  const terminal = agentKind(agent) === 'terminal'
  const external = agentKind(agent) === 'external'

  /** Mở ô rồi mới mở phiên, để terminal đã có kích thước thật. */
  function openAndStart(resume: boolean): void {
    openAgent(ws.id, agent.id)
    requestAnimationFrame(() => requestAnimationFrame(() => start(ws.id, agent.id, resume)))
  }

  async function removeAgent(): Promise<void> {
    const msg = terminal
      ? `Xoá terminal "${agent.name}"? Terminal đang mở sẽ bị đóng.`
      : `Xoá agent "${agent.name}"?\n\n` +
        `• Dừng phiên nếu đang chạy\n` +
        `• Chuyển note 60 Agents/${agent.name}.md trong vault vào Thùng rác (khôi phục được)\n` +
        `• Bỏ việc đang dở của agent\n\n` +
        `Lịch sử việc đã xong được giữ.`
    if (!window.confirm(msg)) return
    try {
      await remove(ws.id, agent.id)
    } catch (e) {
      window.alert(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  async function cloneTo(projectId: string | null): Promise<void> {
    try {
      const made = await window.stag.agent.clone(agent.id, projectId)
      adopt(ws.id, [made], { show: true })
    } catch (e) {
      window.alert(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  async function closeTask(how: 'done' | 'drop'): Promise<void> {
    if (!openTask) return
    const ask =
      how === 'done'
        ? `Đánh dấu xong việc "${openTask.title}" của ${agent.name}?\n\nKhoá phạm vi của việc được nhả. Agent không được báo.`
        : `Bỏ việc "${openTask.title}" của ${agent.name}?\n\nKhoá phạm vi của việc được nhả, việc không ghi vào nhật ký. Agent không được báo.`
    if (!window.confirm(ask)) return
    if (how === 'done') await window.stag.board.completeTask(ws.id, openTask.id)
    else await window.stag.board.dropTask(ws.id, openTask.id)
  }

  const item = (label: string, fn: () => void, danger = false): React.JSX.Element => (
    <MenuItem
      label={label}
      danger={danger}
      onClick={() => {
        onClose()
        fn()
      }}
    />
  )

  return (
    <div className={`z-20 w-52 overflow-hidden rounded-lg border border-line-2 bg-pop p-1 text-[13px] shadow-pop ${className}`}>
      {before}
      {!shown && item('Mở ô', () => openAgent(ws.id, agent.id))}
      {!running && !starting && item(terminal ? 'Mở terminal' : 'Phiên mới', () => openAndStart(false))}
      {!terminal && !running && !starting && agent.lastSessionId && item('Tiếp tục phiên trước', () => openAndStart(true))}
      {!terminal && !external && running && item('Bàn giao sang phiên mới', () => void handoffNow(agent.id))}
      {running && item(terminal ? 'Đóng terminal' : 'Dừng phiên', () => stop(agent.id))}
      {shown && item('Đóng ô', () => hide(ws.id, agent.id))}
      {item('Đổi tên…', onRename)}
      {(agentKind(agent) === 'claude' || agentKind(agent) === 'codex') &&
        !running &&
        !starting &&
        item(agent.cell === 'chat' ? 'Đổi sang ô CLI (terminal)' : 'Đổi sang ô Chat', () => void setCell(ws.id, agent.id, agent.cell === 'chat' ? 'cli' : 'chat').catch((e) => window.alert(String((e as Error).message ?? e))))}
      {external
        ? item('Cài đặt adapter…', () => openSettings('adapters', { external: agent.adapterId }))
        : !terminal && item('Model & effort…', () => openSettings('adapters', { adapter: agentKind(agent) as 'claude' | 'codex', agentId: agent.id }))}
      {!terminal && item('Connector (MCP)…', () => openSettings('connectors', { agentId: agent.id }))}
      {!terminal && item('Skill…', () => openSettings('skills', { agentId: agent.id }))}
      {!terminal &&
        slotsOf(pluginItems, settingsValue, 'agentMenu', ws.id, agent.id).map(({ plugin, slot }) => (
          <span key={`${plugin.manifest.id}:${slot.id}`}>{item(slot.displayName, () => void runSlot(plugin, slot, ws.id, agent.id))}</span>
        ))}
      {openTask && (
        <>
          <div className="my-1 border-t border-line-2" />
          <div className="truncate px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-dim" title={openTask.title}>
            VIỆC ĐANG MỞ
          </div>
          {item('Đánh dấu việc xong…', () => void closeTask('done'))}
          {item('Bỏ việc…', () => void closeTask('drop'))}
        </>
      )}
      {!terminal && cloneTargets.length > 0 && (
        <>
          <div className="my-1 border-t border-line-2" />
          <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-dim">NHÂN BẢN SANG</div>
          {cloneTargets.map((t) => (
            <button
              key={t.id}
              onClick={(e) => {
                e.stopPropagation()
                onClose()
                void cloneTo(t.project ? t.project.id : null)
              }}
              data-tip="Agent mới cùng vai trò, model, skill, connector · phiên trống"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left whitespace-nowrap hover:bg-panel-3"
            >
              <ProjectMark project={t.project} />
              <span className="min-w-0 flex-1 truncate">{t.project ? t.project.name : 'Chung'}</span>
              <span className="shrink-0 font-mono text-[11px] text-dim">{t.project ? t.project.folder : 'gốc'}</span>
            </button>
          ))}
        </>
      )}
      <div className="my-1 border-t border-line-2" />
      {item(terminal ? 'Xoá terminal…' : 'Xoá agent…', () => void removeAgent(), true)}
    </div>
  )
}
