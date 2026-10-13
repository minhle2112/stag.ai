import { useEffect, useMemo, useState } from 'react'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import { autoFolder, copyTeam, folderClash, normFolder, projectNameProblem, projectNoteRel, projectOf, teamPreset, type TeamPreset } from '@shared/projects'
import type { Agent, ProjectTeamMember, WorkspaceFolder } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Icon } from '../Icon'
import { Button, Modal } from '../Modal'

const NO_AGENTS: Agent[] = []

const FIELD = 'w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent'

const PRESETS: Array<{ id: TeamPreset; title: string; sub: string }> = [
  { id: 'none', title: 'Để trống', sub: 'Tạo agent sau' },
  { id: 'solo', title: 'Solo', sub: 'Dev' },
  { id: 'duo', title: 'Đôi', sub: 'Dev + Tester' },
  { id: 'team', title: 'Đội', sub: 'Lead + Dev + Tester' },
  { id: 'copy', title: 'Chép đội', sub: 'từ project khác' }
]

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Hộp "Project mới" (Ctrl+Shift+P, ⋯ của workspace, Ctrl+K, thẻ gợi ý monorepo). */
export function CreateProjectDialog(): React.JSX.Element | null {
  const target = useUi((s) => s.newProject)
  if (!target) return null
  return <Dialog key={`${target.wsId}:${target.folder ?? ''}`} wsId={target.wsId} folder={target.folder} />
}

function Dialog({ wsId, folder: hintFolder }: { wsId: string; folder?: string }): React.JSX.Element | null {
  const ws = useWorkspaces((s) => s.items.find((w) => w.id === wsId))
  const agents = useAgents((s) => s.byWs[wsId]?.agents) ?? NO_AGENTS
  const setNewProject = useUi((s) => s.setNewProject)
  const projects = ws?.projects ?? []
  const [folders, setFolders] = useState<WorkspaceFolder[] | null>(null)
  const [name, setName] = useState(hintFolder ? hintFolder.split('/').pop()! : '')
  const [mode, setMode] = useState<'new' | 'existing'>(hintFolder ? 'existing' : 'new')
  const [newFolder, setNewFolder] = useState('')
  const [picked, setPicked] = useState(hintFolder ?? '')
  const [other, setOther] = useState('')
  const [goal, setGoal] = useState('')
  const [preset, setPreset] = useState<TeamPreset>('duo')
  const [copyFrom, setCopyFrom] = useState(projects[0]?.id ?? '')
  const [team, setTeam] = useState<ProjectTeamMember[]>(() => teamPreset('duo', name))
  /** Tên agent người dùng đã sửa tay (không đổi theo tên project nữa). */
  const [edited, setEdited] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.stag.project
      .folders(wsId)
      .then((f) => alive && setFolders(f))
      .catch(() => alive && setFolders([]))
    return () => {
      alive = false
    }
  }, [wsId])

  /** Đội theo mẫu đang chọn, đặt tên theo tên project (giữ tên đã sửa tay nếu vẫn cùng mẫu). */
  function teamFor(p: TeamPreset, projectName: string, from = copyFrom): ProjectTeamMember[] {
    if (p === 'copy') return copyTeam(agents.filter((a) => projectOf(ws, a)?.id === from), projectName)
    return teamPreset(p, projectName)
  }

  function changeName(v: string): void {
    setName(v)
    setTeam((cur) => teamFor(preset, v).map((t, i) => (edited[i] && cur[i] ? { ...t, name: cur[i].name } : t)))
  }

  function choosePreset(p: TeamPreset, from = copyFrom): void {
    setPreset(p)
    setEdited({})
    setTeam(teamFor(p, name, from))
  }

  const rootNames = useMemo(() => new Set((folders ?? []).filter((f) => !f.path.includes('/')).map((f) => f.path.toLowerCase())), [folders])
  const auto = autoFolder(name, (f) => rootNames.has(f.toLowerCase()) || projects.some((p) => p.folder.toLowerCase() === f.toLowerCase()))
  const folder = mode === 'new' ? (newFolder.trim() ? normFolder(newFolder) : auto) : picked === '__other' ? normFolder(other) : picked || null

  const nameError = name.trim() ? projectNameProblem(name, projects) : ''
  let folderError: string | null = null
  if (!folder) folderError = mode === 'new' ? 'Tên thư mục không hợp lệ.' : picked === '__other' && other.trim() ? 'Đường dẫn không hợp lệ (tương đối trong workspace).' : 'Chọn một thư mục.'
  else if (mode === 'new' && newFolder.trim() && (folders ?? []).some((f) => f.path.toLowerCase() === folder.toLowerCase()))
    folderError = `Đã có thư mục ${folder}. Đặt tên khác, hoặc chọn "Dùng thư mục có sẵn".`
  else folderError = folderClash(projects, folder)
  const teamErrors = team.map((t, i) => {
    const n = t.name.trim()
    if (!n) return 'Cần tên'
    const p = agentNameProblem(n)
    if (p) return p
    if (agents.some((a) => sameAgentName(a.name, n)) || team.some((o, j) => j < i && sameAgentName(o.name, n))) return 'Trùng tên agent khác trong workspace'
    return null
  })
  const ok = !nameError && name.trim() && !folderError && teamErrors.every((e) => !e) && !(preset === 'copy' && !projects.length)

  async function submit(): Promise<void> {
    if (!ok || !folder || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.stag.project.create({
        workspaceId: wsId,
        name: name.trim(),
        goal,
        folder: mode === 'new' ? { mode: 'new', name: newFolder.trim() ? folder : '' } : { mode: 'existing', path: folder },
        team
      })
      useWorkspaces.getState().replace(res.workspace)
      const store = useAgents.getState()
      store.setPlace(wsId, res.project.id)
      if (res.agents.length) store.adopt(wsId, res.agents, { show: true })
      useUi.getState().setTab('agents')
      setNewProject(null)
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  if (!ws) return null
  const note = projectNoteRel(name.trim() || '<tên>')

  return (
    <Modal
      title={
        <span className="flex items-baseline gap-2">
          Project mới <span className="text-[12px] font-normal text-dim">trong {ws.name}</span>
        </span>
      }
      width="w-[600px]"
      onClose={busy ? undefined : () => setNewProject(null)}
      footer={
        <>
          <span className="mr-auto text-[12px] text-dim">Agent đang có giữ nguyên ở chỗ cũ.</span>
          <Button onClick={() => setNewProject(null)} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={() => void submit()} disabled={busy || !ok}>
            {busy ? 'Đang tạo…' : 'Tạo project'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Label text="Tên">
          <input autoFocus={!hintFolder} value={name} onChange={(e) => changeName(e.target.value)} placeholder="vd. web-shop" className={FIELD} />
          {nameError && <div className="mt-1 text-[12px] text-danger">{nameError}</div>}
        </Label>

        <Label text="Thư mục code">
          <div className="mb-2 inline-flex overflow-hidden rounded-md border border-line-2">
            {(
              [
                ['new', 'plus', 'Tạo thư mục mới'],
                ['existing', 'folder', 'Dùng thư mục có sẵn']
              ] as const
            ).map(([m, icon, label], i) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex h-[26px] items-center gap-1.5 px-2.5 text-[12px] ${i ? 'border-l border-line-2' : ''} ${mode === m ? 'bg-panel-3 font-semibold text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
              >
                <Icon name={icon} size="s" />
                {label}
              </button>
            ))}
          </div>
          {mode === 'new' ? (
            <>
              <div className="flex items-center overflow-hidden rounded-md border border-line-2 bg-bg focus-within:border-accent">
                <span className="max-w-[55%] shrink-0 truncate border-r border-line-2 bg-panel-2 px-2 py-1.5 font-mono text-[12px] text-dim" title={ws.path}>
                  {ws.path.replace(/[\\/]+$/, '')}\
                </span>
                <input
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  placeholder={auto}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-[12px] outline-none"
                />
              </div>
              <div className="mt-1 text-[12px] text-muted">
                {newFolder.trim() ? (
                  <>
                    App tạo thư mục <code>{folder ?? newFolder.trim()}\</code> khi bấm "Tạo project".
                  </>
                ) : (
                  <>
                    Bỏ trống thì app tự tạo <code>{auto}\</code> theo tên project.
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto">
              {folders === null && <div className="text-[12px] text-dim">Đang đọc thư mục…</div>}
              {folders?.length === 0 && <div className="col-span-2 text-[12px] text-dim">Workspace chưa có thư mục con nào. Chọn "Tạo thư mục mới".</div>}
              {folders?.map((f) => {
                const clash = folderClash(projects, f.path)
                const owner = projects.find((p) => p.folder.toLowerCase() === f.path.toLowerCase())
                return (
                  <button
                    key={f.path}
                    type="button"
                    disabled={!!clash}
                    onClick={() => {
                      setPicked(f.path)
                      if (!name.trim()) changeName(f.path.split('/').pop()!)
                    }}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-left font-mono text-[12px] ${
                      picked === f.path ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-panel-2 hover:border-accent/50'
                    } ${clash ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <Icon name="folder" size="s" />
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className={`shrink-0 font-sans text-[11px] ${!clash && f.pkg ? 'text-accent-text' : 'text-dim'}`}>
                      {owner ? `thuộc ${owner.name}` : clash ? 'lồng với project khác' : f.pkg ? 'có package.json' : ''}
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setPicked('__other')}
                className={`col-span-2 flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-left text-[12px] ${
                  picked === '__other' ? 'border-accent text-fg' : 'border-line-2 text-muted hover:text-fg'
                }`}
              >
                <Icon name="folder" size="s" /> Thư mục khác trong workspace…
              </button>
              {picked === '__other' && (
                <input
                  autoFocus
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  placeholder="vd. services/api"
                  className={`${FIELD} col-span-2 font-mono text-[12px]`}
                />
              )}
            </div>
          )}
          {folderError && (folder || (mode === 'new' && newFolder.trim()) || (picked === '__other' && other.trim())) && <div className="mt-1 text-[12px] text-danger">{folderError}</div>}
          <div className="mt-1 text-[12px] text-muted">Agent của project mở phiên trong thư mục này; khoá phạm vi tính đường dẫn từ đây.</div>
        </Label>

        <Label text="Mục tiêu (không bắt buộc)">
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="vd. Website bán hàng: giỏ hàng, thanh toán, trang sản phẩm" className={`${FIELD} resize-none`} />
        </Label>

        <Label text="Đội agent">
          <div className="grid grid-cols-5 gap-1.5">
            {PRESETS.map((p) => {
              const disabled = p.id === 'copy' && !projects.length
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => choosePreset(p.id)}
                  className={`rounded-md border px-2 py-1.5 text-left ${preset === p.id ? 'border-accent bg-accent/10' : 'border-line bg-panel-2 hover:border-accent/50'} ${
                    disabled ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  <div className="text-[12.5px] font-semibold">{p.title}</div>
                  <div className="text-[11px] text-muted">{disabled ? 'chưa có project nào' : p.sub}</div>
                </button>
              )
            })}
          </div>
          {preset === 'copy' && projects.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
              Chép từ
              <select
                value={copyFrom}
                onChange={(e) => {
                  setCopyFrom(e.target.value)
                  choosePreset('copy', e.target.value)
                }}
                className="rounded-md border border-line-2 bg-bg px-1.5 py-1 text-fg"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="text-dim">(cùng vai trò, model, skill, connector)</span>
            </div>
          )}
          <div className="mt-2 space-y-1.5">
            {!team.length && (
              <div className="rounded-md border border-dashed border-line-2 px-3 py-2 text-[12px] text-dim">
                {preset === 'copy' ? 'Project nguồn chưa có agent nào để chép.' : 'Không tạo agent. Thêm sau bằng nút "+ Agent" trên thanh project.'}
              </div>
            )}
            {team.map((t, i) => (
              <div key={i} className="grid grid-cols-[72px_1fr_140px] items-start gap-2">
                <span className="truncate pt-1.5 text-[12px] text-muted">{t.role || '—'}</span>
                <div>
                  <input
                    value={t.name}
                    onChange={(e) => {
                      const v = e.target.value
                      setEdited((x) => ({ ...x, [i]: true }))
                      setTeam((cur) => cur.map((m, j) => (j === i ? { ...m, name: v } : m)))
                    }}
                    className={`${FIELD} ${teamErrors[i] ? 'border-danger/60' : ''}`}
                  />
                  {teamErrors[i] && <div className="mt-0.5 text-[12px] text-danger">{teamErrors[i]}</div>}
                </div>
                {t.cloneOf ? (
                  <span className="pt-1.5 text-[12px] text-dim">{t.kind === 'codex' ? 'Codex' : 'Claude Code'} · như bản gốc</span>
                ) : (
                  <select
                    value={t.kind}
                    onChange={(e) => {
                      const kind = e.target.value as 'claude' | 'codex'
                      setTeam((cur) => cur.map((m, j) => (j === i ? { ...m, kind } : m)))
                    }}
                    className="rounded-md border border-line-2 bg-bg px-1.5 py-1.5 text-[12px]"
                  >
                    <option value="claude">Claude Code</option>
                    <option value="codex">Codex</option>
                  </select>
                )}
              </div>
            ))}
          </div>
          {team.length > 0 && <div className="mt-1.5 text-[12px] text-dim">Model theo cài đặt mặc định (đổi sau ở menu ⋯ của agent → Model & effort). Agent chưa mở phiên cho tới khi bạn bấm.</div>}
        </Label>

        <div className="flex gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-[12px] text-muted">
          <Icon name="file" size="s" />
          <div>
            Tạo note <code>{note}</code> trong vault (mục tiêu, thư mục, đội). Agent của project được báo tên project, thư mục và note này khi mở phiên.
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
      </form>
    </Modal>
  )
}

function Label({ text, children }: { text: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] tracking-wider text-muted uppercase">{text}</div>
      {children}
    </div>
  )
}
