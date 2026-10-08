import { useState } from 'react'
import type { CreateWorkspaceResult, WorkspaceInspection } from '@shared/types'
import { useWorkspaces } from '../store/workspaces'
import { CreateReport, CreateWorkspaceDialog } from './CreateWorkspaceDialog'

export function Sidebar(): React.JSX.Element {
  const { items, activeId, setActive, add, remove } = useWorkspaces()
  const [inspection, setInspection] = useState<WorkspaceInspection | null>(null)
  const [report, setReport] = useState<CreateWorkspaceResult | null>(null)

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
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-4 py-3 text-[15px] font-semibold tracking-tight">stag.ai</div>
      <div className="px-4 pb-1 text-[11px] uppercase tracking-wider text-muted">Workspaces</div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {items.map((w) => (
          <div
            key={w.id}
            onClick={() => setActive(w.id)}
            title={w.path}
            className={`group flex cursor-pointer items-center rounded-md px-2 py-1.5 ${
              w.id === activeId ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeWorkspace(w.id, w.name)
              }}
              className="hidden px-1 text-muted hover:text-fg group-hover:block"
              title="Bỏ khỏi app"
            >
              ×
            </button>
          </div>
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
