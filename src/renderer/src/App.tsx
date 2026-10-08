import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TerminalPane } from './components/TerminalPane'
import { VaultView } from './components/VaultView'
import { useUi, type MainTab } from './store/ui'
import { useActiveWorkspace, useWorkspaces } from './store/workspaces'

const tabs: Array<{ id: MainTab; label: string }> = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'agents', label: 'Agents' },
  { id: 'vault', label: 'Vault' }
]

export function App(): React.JSX.Element {
  const { tab, setTab, browserOpen, toggleBrowser } = useUi()
  const { items, loaded, load } = useWorkspaces()
  const active = useActiveWorkspace()
  // Terminal của workspace đã mở được giữ sống khi chuyển workspace.
  const [visited, setVisited] = useState<string[]>([])

  useEffect(() => {
    load()
  }, [load])

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
            </button>
          ))}
          <div className="flex-1" />
          {active && <span className="mr-2 truncate text-[12px] text-muted">{active.path}</span>}
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
                  <TerminalPane cwd={w.path} />
                </div>
              ))}

            {active && tab === 'vault' && (
              <div className="absolute inset-0">
                <VaultView key={active.id} workspace={active} />
              </div>
            )}
            {active && tab === 'kanban' && <Placeholder text="Kanban — làm ở mốc M3" />}
          </section>
          {browserOpen && (
            <aside className="w-[40%] shrink-0 border-l border-line bg-panel">
              <Placeholder text="Browser — làm ở mốc M4" />
            </aside>
          )}
        </div>
      </main>
    </div>
  )
}

function Placeholder({ text }: { text: string }): React.JSX.Element {
  return <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-muted">{text}</div>
}
