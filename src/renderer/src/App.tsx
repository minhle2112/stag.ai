import { useEffect, useState } from 'react'
import { AgentGrid } from './components/AgentGrid'
import { ArtifactsView } from './components/ArtifactsView'
import { BrowserAskDialog, BrowserDock } from './components/BrowserPane'
import { agentKind, type AgentKind } from '@shared/types'
import { CreateAgentDialog } from './components/CreateAgentDialog'
import { Kanban } from './components/Kanban'
import { ScopeAskDialog } from './components/ScopeAskDialog'
import { SettingsPage } from './components/settings/SettingsPage'
import { Sidebar } from './components/Sidebar'
import { VaultView } from './components/VaultView'
import { openAgent, useAgents } from './store/agents'
import { useBoard } from './store/board'
import { useSettings } from './store/settings'
import { setTerminalFontSize } from './terminals'
import { useUi, type MainTab } from './store/ui'
import { useActiveWorkspace, useWorkspaces } from './store/workspaces'

const tabs: Array<{ id: MainTab; label: string }> = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'agents', label: 'Agents' },
  { id: 'artifacts', label: 'Artifacts' }
]

export function App(): React.JSX.Element {
  const { tab, setTab, browserOpen, toggleBrowser } = useUi()
  const { items, loaded, load } = useWorkspaces()
  const active = useActiveWorkspace()
  // Lưới agent của workspace đã mở được giữ sống khi chuyển workspace/tab.
  const [visited, setVisited] = useState<string[]>([])
  const waiting = useWaitingCount(active?.id)
  const settingsOpen = useUi((s) => s.settings !== null)
  const terminalFontSize = useSettings((s) => s.value.app.general.terminalFontSize)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => setTerminalFontSize(terminalFontSize), [terminalFontSize])

  // Bấm thông báo Windows của một agent → mở đúng agent đó.
  useEffect(
    () =>
      window.stag.onRevealAgent((wsId, agentId) => {
        useUi.getState().closeSettings()
        openAgent(wsId, agentId)
      }),
    []
  )

  // Ctrl+, mở / đóng Cài đặt (như VS Code). Bắt ở pha capture để terminal đang focus không nuốt mất.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === ',') {
        e.preventDefault()
        e.stopPropagation()
        const ui = useUi.getState()
        if (ui.settings) ui.closeSettings()
        else ui.openSettings()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (active && !visited.includes(active.id)) setVisited([...visited, active.id])
  }, [active, visited])

  return (
    <div className="flex h-full">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1 ${tab === t.id ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t.label}
              {t.id === 'kanban' && waiting > 0 && (
                <span className="ml-1.5 rounded bg-amber-400/15 px-1.5 text-[12px] text-amber-300" title="Agent đang chờ bạn">
                  {waiting}
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          {active && <span className="mr-2 truncate text-[12px] text-muted">{active.path}</span>}
          <button
            onClick={() => setTab(tab === 'vault' ? 'agents' : 'vault')}
            title="Vault Obsidian của workspace (bộ nhớ của agent)"
            className={`rounded-md px-3 py-1 ${tab === 'vault' ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            Vault
          </button>
          <button
            onClick={toggleBrowser}
            className={`rounded-md px-3 py-1 ${browserOpen ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            Browser
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="relative min-w-0 flex-1">
            {loaded && !active && <Placeholder text="Chưa có workspace. Bấm “+ Workspace” ở thanh bên trái để chọn thư mục dự án." />}

            {items
              .filter((w) => visited.includes(w.id))
              .map((w) => (
                <div key={w.id} className={`absolute inset-0 ${tab === 'agents' && w.id === active?.id ? '' : 'invisible'}`}>
                  <AgentGrid workspace={w} />
                </div>
              ))}

            {active && tab === 'vault' && (
              <div className="absolute inset-0">
                <VaultView key={active.id} workspace={active} />
              </div>
            )}
            {active && tab === 'artifacts' && (
              <div className="absolute inset-0">
                <ArtifactsView key={active.id} workspace={active} />
              </div>
            )}
            {active && tab === 'kanban' && <Kanban key={active.id} workspace={active} />}
          </section>
          {browserOpen && active && <BrowserDock workspace={active} />}
        </div>
      </main>
      <BrowserAskDialog />
      <ScopeAskDialog />
      <NewAgentDialog />
      {settingsOpen && <SettingsPage />}
    </div>
  )
}

/** Hộp thoại tạo agent, mở từ lưới (◫ ⬓ + Agent) hoặc từ thanh bên. */
function NewAgentDialog(): React.JSX.Element | null {
  const target = useUi((s) => s.newAgent)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const agents = useAgents((s) => (target ? s.byWs[target.wsId]?.agents : undefined))
  const create = useAgents((s) => s.create)
  if (!target) return null
  const taken = new Set((agents ?? []).map((a) => a.name.toLowerCase()))
  const suggestName = (kind: AgentKind): string => {
    const base = kind === 'terminal' ? 'Terminal' : 'Agent'
    let n = (agents ?? []).filter((a) => (agentKind(a) === 'terminal') === (kind === 'terminal')).length + 1
    while (taken.has(`${base.toLowerCase()} ${n}`)) n++
    return `${base} ${n}`
  }
  return (
    <CreateAgentDialog
      suggestName={suggestName}
      takenNames={(agents ?? []).map((a) => a.name)}
      onCancel={() => setNewAgent(null)}
      onSubmit={async (v) => {
        await create({ workspaceId: target.wsId, ...v }, { agentId: target.agentId, dir: target.dir })
        setNewAgent(null)
      }}
    />
  )
}

/** Số agent đang chạy và đang chờ người dùng trong workspace. */
function useWaitingCount(wsId: string | undefined): number {
  const statuses = useBoard((s) => (wsId ? s.byWs[wsId]?.statuses : undefined))
  const running = useAgents((s) => (wsId ? s.byWs[wsId]?.running : undefined))
  if (!statuses || !running) return 0
  return statuses.filter((st) => st.activity === 'waiting' && running[st.agentId]).length
}

function Placeholder({ text }: { text: string }): React.JSX.Element {
  return <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-muted">{text}</div>
}
