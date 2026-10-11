import { useEffect } from 'react'
import { agentKind, type Agent, type Workspace } from '@shared/types'
import { leaves } from '../layout'
import { openAgent, useAgents } from '../store/agents'
import { runSlot, slotsOf, usePlugins } from '../store/plugins'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { handoffNow } from './ContextBadge'

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
 * đổi tên, Model & effort, Connector, Skill, mục menu của plugin, xoá. `before` = mục riêng của nơi gọi (vd. chia ô).
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
  const { start, stop, hide, remove, setCell } = useAgents()
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
  const shown = leaves(state?.layout ?? null).includes(agent.id)
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
    <div className={`z-20 w-52 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] shadow-[0_14px_40px_rgba(0,0,0,.6)] ${className}`}>
      {before}
      {!shown && item('Mở ô', () => openAgent(ws.id, agent.id))}
      {!running && !starting && item(terminal ? 'Mở terminal' : 'Phiên mới', () => openAndStart(false))}
      {!terminal && !running && !starting && agent.lastSessionId && item('Tiếp tục phiên trước', () => openAndStart(true))}
      {!terminal && !external && running && item('Bàn giao sang phiên mới', () => void handoffNow(agent.id))}
      {running && item(terminal ? 'Đóng terminal' : 'Dừng phiên', () => stop(agent.id))}
      {shown && item('Đóng ô', () => hide(ws.id, agent.id))}
      {item('Đổi tên…', onRename)}
      {agentKind(agent) === 'claude' &&
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
      <div className="my-1 border-t border-line-2" />
      {item(terminal ? 'Xoá terminal…' : 'Xoá agent…', () => void removeAgent(), true)}
    </div>
  )
}
