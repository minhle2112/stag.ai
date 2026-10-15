import { useState } from 'react'
import { CHUNG, joinRoot, placeOf, projectNameProblem } from '@shared/projects'
import type { Project, Workspace } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { useUi } from '../../store/ui'
import { MenuItem } from '../AgentMenu'
import { Icon } from '../Icon'
import { Modal, Button } from '../Modal'
import { ProjectMark, projectColor } from './ProjectMark'
import { useT } from '../../i18n'

/**
 * Trên canvas khi workspace có project: dải tab (Chung đứng đầu, rồi từng project, + project mới) và thanh của tab đang
 * xem (thư mục, note vault, mục tiêu, + Agent, ⋯). Workspace chưa có project thì không hiện gì (app như cũ).
 */
export function ProjectTabs({ ws }: { ws: Workspace }): React.JSX.Element | null {
  const t = useT()
  const state = useAgents((s) => s.byWs[ws.id])
  const setPlace = useAgents((s) => s.setPlace)
  const statuses = useBoard((s) => s.byWs[ws.id]?.statuses)
  const setNewProject = useUi((s) => s.setNewProject)
  const projects = ws.projects ?? []
  if (!projects.length || !state) return null
  const place = state.place
  const tabs: Array<{ id: string; project: Project | null }> = [{ id: CHUNG, project: null }, ...projects.map((p) => ({ id: p.id, project: p }))]
  const agentsAt = (id: string) => state.agents.filter((a) => placeOf(ws, a) === id)
  const waitingAt = (id: string): number =>
    agentsAt(id).filter((a) => state.running[a.id] && statuses?.some((st) => st.agentId === a.id && st.activity === 'waiting')).length
  const current = projects.find((p) => p.id === place) ?? null

  return (
    <>
      <div className="flex h-[34px] shrink-0 items-stretch overflow-x-auto border-b border-line bg-bg0 pl-1" role="tablist" aria-label={t('common.project')}>
        {tabs.map((tab) => {
          const on = tab.id === place
          const n = agentsAt(tab.id).length
          const w = waitingAt(tab.id)
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPlace(ws.id, tab.id)}
              data-tip={tab.project ? `${tab.project.folder}${tab.project.goal ? `\n${tab.project.goal}` : ''}` : t('projects.tabs.rootTip')}
              className={`relative flex items-center gap-[7px] border-r border-line pr-2.5 pl-3 text-[12.5px] whitespace-nowrap ${
                on ? 'bg-bg font-semibold text-fg' : 'font-medium text-dim hover:bg-panel-2 hover:text-fg'
              }`}
            >
              {on && <span className="absolute top-0 right-0 left-0 h-0.5" style={{ background: tab.project ? projectColor(tab.project) : 'var(--color-accent)' }} />}
              <ProjectMark project={tab.project} size={9} />
              {tab.project ? tab.project.name : t('common.name.rootProject')}
              <span className="min-w-5 rounded-full bg-panel-3 px-1.5 text-center font-mono text-[11px] leading-4 font-normal text-dim">{n}</span>
              {w > 0 && <span className="rounded-full bg-wait px-1.5 font-mono text-[11px] leading-4 font-semibold text-wait-on">{w}</span>}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setNewProject({ wsId: ws.id })}
          data-tip={t('projects.tabs.newTip')}
          aria-label={t('projects.create.title')}
          className="grid w-[34px] shrink-0 place-items-center text-dim hover:bg-panel-2 hover:text-fg"
        >
          <Icon name="plus" size="s" />
        </button>
      </div>
      {current ? <ProjectBar ws={ws} project={current} /> : <ChungBar ws={ws} />}
    </>
  )
}

const SEP = <span className="h-3.5 w-px shrink-0 bg-line-2" />

function ChungBar({ ws }: { ws: Workspace }): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex h-8 shrink-0 items-center gap-2.5 overflow-hidden border-b border-line bg-bg pr-2 pl-3 text-[12px] whitespace-nowrap text-muted">
      <span className="flex max-w-[55%] min-w-0 shrink items-center gap-1.5">
        <ProjectMark project={null} size={10} />
        <span className="shrink-0">{t('projects.bar.root', { root: t('common.name.rootProject') })}</span>
        <button
          type="button"
          className="min-w-0 truncate font-mono text-[11.5px] text-fg hover:underline"
          style={{ direction: 'rtl', textAlign: 'left' }}
          data-tip={t('projects.bar.openFolder', { path: ws.path })}
          onClick={() => void window.stag.openFolder(ws.path)}
        >
          {/* rtl: cắt phần đầu đường dẫn dài, giữ tên thư mục cuối */}
          <bdi>{ws.path}</bdi>
        </button>
      </span>
      {SEP}
      <span className="min-w-0 flex-1 truncate text-dim">{t('projects.bar.rootNote')}</span>
      <AddAgentButton ws={ws} />
    </div>
  )
}

function AddAgentButton({ ws }: { ws: Workspace }): React.JSX.Element {
  const setNewAgent = useUi((s) => s.setNewAgent)
  return (
    <button
      type="button"
      onClick={() => setNewAgent({ wsId: ws.id })}
      className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md border border-line-2 px-2 text-[12px] text-fg hover:bg-panel-2"
    >
      <Icon name="plus" size="s" /> Agent
    </button>
  )
}

function ProjectBar({ ws, project: p }: { ws: Workspace; project: Project }): React.JSX.Element {
  const t = useT()
  const openInVault = useUi((s) => s.openInVault)
  const setDeleteProject = useUi((s) => s.setDeleteProject)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const [menu, setMenu] = useState(false)
  const [edit, setEdit] = useState<'name' | 'goal' | null>(null)
  const dir = joinRoot(ws.path, p.folder)

  return (
    <div className="relative flex h-8 shrink-0 items-center gap-2.5 border-b border-line bg-bg pr-2 pl-3 text-[12px] whitespace-nowrap text-muted">
      <button type="button" className="flex shrink-0 items-center gap-1.5 hover:text-fg" data-tip={t('projects.bar.openFolder', { path: dir })} onClick={() => void window.stag.openFolder(dir)}>
        <Icon name="folder" size="s" />
        <span className="font-mono text-[11.5px] text-fg">{p.folder}</span>
      </button>
      {SEP}
      <button type="button" className="flex shrink-0 items-center gap-1.5 text-accent-text hover:underline" data-tip={t('projects.bar.openNote')} onClick={() => openInVault(ws.id, p.note)}>
        <Icon name="file" size="s" />
        <span>{p.note.replace(/\/[^/]*$/, '')}</span>
      </button>
      {SEP}
      <button type="button" className="min-w-0 flex-1 truncate text-left text-dim hover:text-fg" data-tip={t('projects.bar.editGoal')} onClick={() => setEdit('goal')}>
        {p.goal || t('projects.bar.noGoal')}
      </button>
      <button
        type="button"
        onClick={() => setNewAgent({ wsId: ws.id })}
        className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-line-2 px-2 text-[12px] text-fg hover:bg-panel-2"
      >
        <Icon name="plus" size="s" /> Agent
      </button>
      <button
        type="button"
        onClick={() => setMenu(!menu)}
        data-tip={t('projects.bar.actions')}
        aria-label={t('projects.bar.actions')}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
      >
        <Icon name="more" size="s" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="absolute top-full right-2 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-line-2 bg-pop p-1 text-[13px] text-fg shadow-pop">
            <div className="truncate px-2.5 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-dim">{p.name.toUpperCase()}</div>
            {(
              [
                [t('projects.menu.addAgent'), () => setNewAgent({ wsId: ws.id })],
                [t('projects.bar.openNote'), () => openInVault(ws.id, p.note)],
                [t('projects.bar.openFolder', { path: p.folder }), () => void window.stag.openFolder(dir)],
                [t('projects.menu.rename'), () => setEdit('name')],
                [t('projects.menu.editGoal'), () => setEdit('goal')]
              ] as Array<[string, () => void]>
            ).map(([label, fn]) => (
              <MenuItem
                key={label}
                label={label}
                onClick={() => {
                  setMenu(false)
                  fn()
                }}
              />
            ))}
            <div className="my-1 border-t border-line-2" />
            <MenuItem
              label={t('projects.menu.delete')}
              danger
              onClick={() => {
                setMenu(false)
                setDeleteProject({ wsId: ws.id, projectId: p.id })
              }}
            />
          </div>
        </>
      )}
      {edit && <EditProjectDialog ws={ws} project={p} field={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

/** Đổi tên / mục tiêu project (thư mục code không đổi được: phiên agent giữ thư mục lúc mở). */
function EditProjectDialog({ ws, project, field, onClose }: { ws: Workspace; project: Project; field: 'name' | 'goal'; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [value, setValue] = useState(field === 'name' ? project.name : project.goal)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(): Promise<void> {
    // Tên: kiểm trước bằng ngôn ngữ đang chọn (lỗi từ main viết tiếng Anh cho agent).
    const problem = field === 'name' ? projectNameProblem(value, ws.projects ?? [], project.id) : null
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      await window.stag.project.update(ws.id, project.id, { [field]: value })
      onClose()
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={field === 'name' ? t('projects.edit.renameTitle', { name: project.name }) : t('projects.edit.goalTitle', { name: project.name })}
      width="w-[460px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary onClick={() => void save()} disabled={busy || (field === 'name' && !value.trim())}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          // Enter trong ô tên: cùng điều kiện với nút Lưu (không gửi tên rỗng, không gửi hai lần khi đang lưu).
          if (busy || (field === 'name' && !value.trim())) return
          void save()
        }}
      >
        {field === 'name' ? (
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent" />
        ) : (
          <textarea autoFocus rows={3} value={value} onChange={(e) => setValue(e.target.value)} className="w-full resize-none rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent" />
        )}
        {field === 'name' && <div className="mt-1.5 text-[12px] text-muted">{t('projects.edit.nameNote', { note: project.note })}</div>}
        {field === 'goal' && <div className="mt-1.5 text-[12px] text-muted">{t('projects.edit.goalNote')}</div>}
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
      </form>
    </Modal>
  )
}
