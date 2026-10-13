import { useEffect, useState } from 'react'
import { AgentGrid } from './components/AgentGrid'
import { ArtifactsView } from './components/ArtifactsView'
import { BrowserAskDialog, BrowserDock } from './components/BrowserPane'
import { agentKind, type AgentKind } from '@shared/types'
import { BroadcastDialog } from './components/BroadcastDialog'
import { CreateAgentDialog } from './components/CreateAgentDialog'
import { Kanban } from './components/Kanban'
import { LogView } from './components/LogView'
import { ScopeAskDialog } from './components/ScopeAskDialog'
import { AgentRequestDialog } from './components/AgentRequestDialog'
import { ApprovalToast } from './components/ApprovalToast'
import { PluginToast } from './components/PluginSlots'
import { PluginFrame } from './components/PluginFrame'
import { SettingsPage } from './components/settings/SettingsPage'
import { Sidebar } from './components/Sidebar'
import { VaultView } from './components/VaultView'
import { VoiceHotkeys } from './components/VoicePanel'
import { CommandPalette } from './components/shell/CommandPalette'
import { Rail } from './components/shell/Rail'
import { StatusBar } from './components/shell/StatusBar'
import { TitleBar } from './components/shell/TitleBar'
import { Tooltips } from './components/shell/Tooltips'
import { WorkspaceFlowDialogs } from './components/shell/WorkspaceFlowDialogs'
import { openAgent, useAgents } from './store/agents'
import { pageTab, slotsOf, usePlugins } from './store/plugins'
import { useSettings } from './store/settings'
import { startNewWorkspace } from './store/workspaceFlow'
import { setTerminalFontSize } from './terminals'
import { startThemeBus } from './store/theme'
import { useBrowserOpen, useSidebarOpen, useUi, type MainTab } from './store/ui'
import { useActiveWorkspace, useWorkspaces } from './store/workspaces'

/** Ctrl+1…5 → màn hình tương ứng ở thanh icon bên trái. */
const VIEW_KEYS: Record<string, MainTab> = { '1': 'agents', '2': 'kanban', '3': 'artifacts', '4': 'vault', '5': 'log' }

export function App(): React.JSX.Element {
  const tab = useUi((s) => s.tab)
  const { items, loaded, load } = useWorkspaces()
  const active = useActiveWorkspace()
  // Lưới agent của workspace đã mở được giữ sống khi chuyển workspace/tab.
  const [visited, setVisited] = useState<string[]>([])
  const settingsOpen = useUi((s) => s.settings !== null)
  const sidebarOpen = useSidebarOpen()
  const browserOpen = useBrowserOpen()
  const terminalFontSize = useSettings((s) => s.value.app.general.terminalFontSize)
  const settingsValue = useSettings((s) => s.value)
  const pluginItems = usePlugins((s) => s.items)
  // Trang riêng của plugin (slot page) đang chạy và bật cho workspace này: một mục ở thanh icon bên trái.
  const pages = slotsOf(pluginItems, settingsValue, 'page', active?.id)
  const page = tab.startsWith('plugin:') ? pages.find((x) => pageTab(x.plugin.manifest.id, x.slot.id) === tab) : undefined

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => startThemeBus(), [])

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

  // Phím tắt toàn app. Bắt ở pha capture để terminal đang focus không nuốt mất; Ctrl+K / Ctrl+B là phím của
  // readline (xoá tới cuối dòng / lùi một ký tự) nên khi con trỏ đang ở terminal thì để terminal dùng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      const ui = useUi.getState()
      const inTerminal = !!(document.activeElement as HTMLElement | null)?.closest?.('.xterm')
      const key = e.key.toLowerCase()
      let handled = true
      if (e.shiftKey && key === 'n') {
        // Ctrl+Shift+N: tạo agent mới ở workspace đang xem.
        const wsId = useWorkspaces.getState().activeId
        if (!wsId) handled = false
        else {
          ui.closeSettings()
          ui.setTab('agents')
          ui.setNewAgent({ wsId })
        }
      } else if (e.shiftKey && key === 'w') {
        // Ctrl+Shift+W (như Windows Terminal): đóng ô agent đang chọn (phiên vẫn chạy, mở lại ở thanh bên) — kể cả khi con
        // trỏ đang ở terminal. Ctrl+W để lại cho CLI (readline: xoá một từ về trước). Luôn nuốt phím.
        const wsId = useWorkspaces.getState().activeId
        const w = wsId ? useAgents.getState().byWs[wsId] : undefined
        const sel = w?.focused
        if (wsId && sel && !ui.settings && ui.tab === 'agents' && w.agents.some((a) => a.id === sel)) {
          if (ui.maxCell[wsId] === sel) ui.setMaxCell(wsId, null)
          useAgents.getState().hide(wsId, sel)
        }
      } else if (!e.shiftKey && e.key === ',') {
        if (ui.settings) ui.closeSettings()
        else ui.openSettings()
      } else if (!e.shiftKey && VIEW_KEYS[e.key]) ui.setTab(VIEW_KEYS[e.key])
      else if (e.shiftKey && key === 'b') ui.toggleBrowser()
      else if (e.shiftKey && key === 'f') {
        // Phóng to ô đang chọn của workspace đang xem ra toàn khung (bấm lần nữa để về bản đồ).
        const wsId = useWorkspaces.getState().activeId
        const sel = wsId ? useAgents.getState().byWs[wsId]?.focused : null
        if (!wsId || ui.settings || ui.tab !== 'agents') handled = false
        else ui.setMaxCell(wsId, ui.maxCell[wsId] ? null : (sel ?? null))
      }
      else if (e.shiftKey && key === 'l') void window.stag.theme.toggle()
      else if (e.shiftKey && key === 'p') ui.setPalette(true)
      else if (!e.shiftKey && key === 'k' && !inTerminal) ui.setPalette(!ui.palette)
      else if (!e.shiftKey && key === 'b' && !inTerminal) ui.toggleSidebar()
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (active && !visited.includes(active.id)) setVisited([...visited, active.id])
  }, [active, visited])

  const main = settingsOpen ? null : tab

  return (
    <div className="flex h-full flex-col">
      <TitleBar />

      <div className="relative flex min-h-0 flex-1">
        <Rail />
        {sidebarOpen && <Sidebar />}

        <main className="relative min-w-0 flex-1 bg-bg">
          {loaded && !active && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-muted">
              <div>Chưa có workspace nào.</div>
              <button
                onClick={() => void startNewWorkspace()}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-on hover:brightness-110"
              >
                + Workspace mới
              </button>
            </div>
          )}

          {items
            .filter((w) => visited.includes(w.id))
            .map((w) => (
              <div key={w.id} className={`absolute inset-0 ${main === 'agents' && w.id === active?.id ? '' : 'view-hidden'}`}>
                <AgentGrid workspace={w} />
              </div>
            ))}

          {active && main === 'vault' && (
            <div className="absolute inset-0">
              <VaultView key={active.id} workspace={active} />
            </div>
          )}
          {active && main === 'artifacts' && (
            <div className="absolute inset-0">
              <ArtifactsView key={active.id} workspace={active} />
            </div>
          )}
          {active && main === 'kanban' && <Kanban key={active.id} workspace={active} />}
          {active && main === 'log' && <LogView key={active.id} workspace={active} />}
          {active && main?.startsWith('plugin:') && (
            <div className="absolute inset-0">
              {page ? (
                <PluginFrame plugin={page.plugin} slot={page.slot} workspace={active} />
              ) : (
                <Placeholder text="Trang này của plugin không còn mở được (plugin đã gỡ, đang tắt hoặc chưa chạy). Xem Cài đặt → Plugin." />
              )}
            </div>
          )}
          {settingsOpen && <SettingsPage />}
        </main>

        {browserOpen && active && <BrowserDock workspace={active} />}
      </div>

      <StatusBar />

      <BrowserAskDialog />
      <ScopeAskDialog />
      <AgentRequestDialog />
      <ApprovalToast />
      <PluginToast />
      <NewAgentDialog />
      <BroadcastDialog />
      <WorkspaceFlowDialogs />
      <CommandPalette />
      <VoiceHotkeys />
      <Tooltips />
    </div>
  )
}

/** Hộp thoại tạo agent, mở từ menu chuột phải của canvas, Ctrl+K hoặc Ctrl+Shift+N. */
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
      initialKind={target.kind}
      suggestName={suggestName}
      takenNames={(agents ?? []).map((a) => a.name)}
      onCancel={() => setNewAgent(null)}
      onSubmit={async (v) => {
        await create({ workspaceId: target.wsId, ...v }, target.at ? { at: target.at } : {})
        setNewAgent(null)
      }}
    />
  )
}

function Placeholder({ text }: { text: string }): React.JSX.Element {
  return <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-muted">{text}</div>
}
