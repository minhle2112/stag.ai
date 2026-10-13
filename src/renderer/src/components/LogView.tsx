import { useEffect, useMemo, useState } from 'react'
import { resolveMemory } from '@shared/settings'
import { CHUNG, filterWorkLog, placeOf } from '@shared/projects'
import { agentKind, type Agent, type Project, type Workspace } from '@shared/types'
import { localDay } from '../status'
import { useAgents } from '../store/agents'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { useVaultIndex } from '../vaultIndex'
import { Icon } from './Icon'
import { AgentAvatar } from './ui/AgentAvatar'
import { Seg } from './ui/Seg'
import { renderNote } from './vault/markdown'
import { ProjectMark } from './projects/ProjectMark'

/** Một note đọc từ vault: `text` null = chưa có (agent chưa ghi gì). */
interface Doc {
  rel: string
  text: string | null
}

const utf8 = (s: string): number => new TextEncoder().encode(s).length

/**
 * "Nhật ký & bộ nhớ": nhật ký việc của hôm nay (`40 Log/<ngày>.md`, app tự ghi khi agent xong việc) hoặc note bộ nhớ của
 * từng agent (`60 Agents/<tên>.md`), kèm thanh dung lượng note từng agent so với hạn mức (Cài đặt → Vault & bộ nhớ).
 */
export function LogView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { vaultPath } = workspace
  const agentsState = useAgents((s) => s.byWs[workspace.id])
  const loadAgents = useAgents((s) => s.load)
  const settings = useSettings((s) => s.value)
  const openInVault = useUi((s) => s.openInVault)
  const { tick } = useVaultIndex(vaultPath)
  const [mode, setMode] = useState<'today' | 'agent'>('today')
  const [pick, setPick] = useState<string | null>(null)
  const [today, setToday] = useState<Doc | null>(null)
  const [notes, setNotes] = useState<Record<string, Doc>>({})
  // Workspace có project: lọc nhật ký và danh sách agent theo project (mặc định: tab đang mở ở màn Agent).
  const projects = workspace.projects ?? []
  const [projF, setProjF] = useState<string>(() => (projects.length ? (useAgents.getState().byWs[workspace.id]?.place ?? 'all') : 'all'))
  const filtering = projects.length > 0 && projF !== 'all'

  useEffect(() => {
    if (!useAgents.getState().byWs[workspace.id]) loadAgents(workspace.id)
  }, [workspace.id, loadAgents])

  const agents = useMemo<Agent[]>(
    () => (agentsState?.agents ?? []).filter((a) => agentKind(a) !== 'terminal' && (!filtering || placeOf(workspace, a) === projF)),
    [agentsState, filtering, projF, workspace]
  )
  const names = agents.map((a) => a.name).join('\n')
  const date = localDay(new Date())
  const logRel = `40 Log/${date}.md`

  // Đọc lại khi vault đổi (agent vừa ghi) hoặc danh sách agent đổi.
  useEffect(() => {
    let alive = true
    const read = async (rel: string): Promise<Doc> => {
      try {
        return { rel, text: await window.stag.vault.read(vaultPath, rel) }
      } catch {
        return { rel, text: null }
      }
    }
    void (async () => {
      const [log, ...rest] = await Promise.all([read(logRel), ...names.split('\n').filter(Boolean).map((n) => read(`60 Agents/${n}.md`))])
      if (!alive) return
      setToday(log)
      setNotes(Object.fromEntries(rest.map((d) => [d.rel, d])))
    })()
    return () => {
      alive = false
    }
  }, [vaultPath, logRel, names, tick])

  const shownAgent = agents.find((a) => a.id === pick) ?? agents[0]
  const todayShown = useMemo(() => (today && today.text != null && filtering ? { ...today, text: filterWorkLog(today.text, projF, projects) } : today), [today, filtering, projF, projects])
  const doc = mode === 'today' ? todayShown : shownAgent ? (notes[`60 Agents/${shownAgent.name}.md`] ?? null) : null
  const html = useMemo(() => (doc?.text != null ? renderNote(doc.text, { current: doc.rel, notes: null }).html : ''), [doc])

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-line px-2.5">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'today', label: 'Hôm nay' },
            { value: 'agent', label: 'Theo agent' }
          ]}
        />
        {projects.length > 0 && (
          <div className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Lọc theo project">
            {[{ id: 'all', label: 'Tất cả', p: undefined as Project | null | undefined }, { id: CHUNG, label: 'Chung', p: null }, ...projects.map((p) => ({ id: p.id, label: p.name, p }))].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setProjF(o.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] ${projF === o.id ? 'border-line-3 bg-panel-2 text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              >
                {o.p !== undefined && <ProjectMark project={o.p} size={8} />}
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openInVault(workspace.id, doc?.rel ?? logRel)}
          data-tip={`Mở ${doc?.rel ?? logRel} trong Vault`}
          aria-label="Mở trong Vault"
          className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
        >
          <Icon name="vault" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px]">
        <section className="flex min-h-0 min-w-0 flex-col bg-panel">
          {mode === 'agent' && (
            <div className="mx-auto flex w-full max-w-[800px] shrink-0 flex-wrap gap-1.5 px-10 pt-4">
              {agents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setPick(a.id)}
                  className={`inline-flex h-6 items-center gap-1.5 rounded-xl border pr-2.5 pl-1 text-[12px] ${
                    a.id === shownAgent?.id ? 'border-accent bg-accent/10 text-fg' : 'border-line-2 text-muted hover:border-line-3 hover:text-fg'
                  }`}
                >
                  <AgentAvatar agent={a} size={16} />
                  {a.name}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[800px] px-10 pt-5 pb-14 select-text">
              <div className="mb-3 font-mono text-[12px] text-dim">{doc?.rel ?? (mode === 'today' ? logRel : '')}</div>
              {doc?.text != null ? (
                <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div className="py-10 text-center text-dim">
                  {mode === 'today'
                    ? 'Hôm nay chưa có việc nào xong. Khi agent báo xong việc, app tự ghi một dòng vào đây.'
                    : agents.length
                      ? 'Agent này chưa có note bộ nhớ.'
                      : 'Workspace chưa có agent.'}
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-line bg-bg py-1.5">
          <h4 className="flex min-h-[30px] items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">
            BỘ NHỚ AGENT
            <span
              className="inline-flex cursor-help"
              data-tip="Mỗi agent có hạn mức dung lượng note (vạch trên thanh). Việc xong → ghi vào 40 Log/<ngày>.md và mục Work done; vượt hạn mức → mục cũ chuyển sang archive. Chỉnh ở Cài đặt → Vault & bộ nhớ."
            >
              <Icon name="info" size="s" />
            </span>
          </h4>
          {agents.length === 0 && <div className="px-3 py-2 text-[12px] text-dim">Chưa có agent.</div>}
          {agents.map((a) => {
            const text = notes[`60 Agents/${a.name}.md`]?.text
            const kb = text != null ? utf8(text) / 1024 : 0
            const budget = resolveMemory(settings, workspace.id, a.id).noteBudgetKb
            const high = kb > budget * 0.875
            const scale = Math.max(budget * 1.17, kb)
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setPick(a.id)
                  setMode('agent')
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-panel-2"
                data-tip={text == null ? 'Chưa có note' : high ? `Sắp chạm ${budget} KB: mục Work done cũ sẽ được cất sang archive` : undefined}
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px]">
                  <AgentAvatar agent={a} size={16} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className={`font-mono text-[11px] ${high ? 'text-danger' : 'text-dim'}`}>
                    {kb.toFixed(1)} / {budget} KB
                  </span>
                </div>
                <div className="relative flex h-1.5 overflow-hidden rounded-[3px] bg-panel-3">
                  <i className={`block h-full ${high ? 'bg-danger' : 'bg-neutral'}`} style={{ width: `${Math.min(100, (kb / scale) * 100)}%` }} />
                  <b className="absolute top-0 bottom-0 -ml-px w-0.5 bg-muted" style={{ left: `${(budget / scale) * 100}%` }} />
                </div>
              </button>
            )
          })}
        </aside>
      </div>
    </div>
  )
}
