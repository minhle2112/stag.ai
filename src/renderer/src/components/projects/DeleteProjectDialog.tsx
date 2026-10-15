import { useEffect, useState } from 'react'
import { joinRoot } from '@shared/projects'
import type { ProjectDeleteInfo } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Button, Modal } from '../Modal'
import { ProjectMark } from './ProjectMark'
import { tx, useT } from '../../i18n'

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Hộp "Xoá project": xoá luôn agent của nó; tick "Xoá cả thư mục code" thì thư mục vào Thùng rác. Note vault giữ nguyên. */
export function DeleteProjectDialog(): React.JSX.Element | null {
  const target = useUi((s) => s.deleteProject)
  if (!target) return null
  return <Dialog key={target.projectId} wsId={target.wsId} projectId={target.projectId} />
}

function Dialog({ wsId, projectId }: { wsId: string; projectId: string }): React.JSX.Element | null {
  const t = useT()
  const ws = useWorkspaces((s) => s.items.find((w) => w.id === wsId))
  const state = useAgents((s) => s.byWs[wsId])
  const statuses = useBoard((s) => s.byWs[wsId]?.statuses)
  const close = (): void => useUi.getState().setDeleteProject(null)
  const [delDir, setDelDir] = useState(false)
  const [info, setInfo] = useState<ProjectDeleteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const p = ws?.projects?.find((x) => x.id === projectId)

  useEffect(() => {
    let alive = true
    window.stag.project
      .deleteInfo(wsId, projectId)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [wsId, projectId])

  if (!ws || !p) return null
  const team = (state?.agents ?? []).filter((a) => a.projectId === p.id)
  const stateOf = (id: string): 'work' | 'wait' | 'idle' => {
    if (!state?.running[id]) return 'idle'
    return statuses?.find((s) => s.agentId === id)?.activity === 'waiting' ? 'wait' : 'work'
  }
  // Ô terminal không có việc: chạy shell không tính là "làm dở".
  const busyAgents = team.filter((a) => a.kind !== 'terminal' && stateOf(a.id) !== 'idle')

  async function confirm(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next = await window.stag.project.remove(wsId, projectId, delDir)
      useAgents.getState().dropProject(wsId, projectId)
      useWorkspaces.getState().replace(next)
      close()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  const label =
    team.length && delDir
      ? t('projects.delete.btnAll', { count: team.length })
      : team.length
        ? t('projects.delete.btnAgents', { count: team.length })
        : delDir
          ? t('projects.delete.btnFolder')
          : t('projects.delete.btn')

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <ProjectMark project={p} />
          {t('projects.delete.title', { name: p.name })}
        </span>
      }
      width="w-[520px]"
      onClose={busy ? undefined : close}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? t('projects.delete.deleting') : label}
          </Button>
        </>
      }
    >
      {team.length ? (
        <>
          <div className="text-[12.5px] text-muted">
            {tx('projects.delete.agentsIntro', { agents: <b className="text-fg">{t('projects.delete.agentCount', { count: team.length })}</b> })}
          </div>
          <div className="mt-2 rounded-lg border border-line-2 px-2.5 py-0.5">
            {team.map((a) => {
              const st = stateOf(a.id)
              return (
                <div key={a.id} className="flex h-[30px] items-center gap-2">
                  <span className={`sdot ${st === 'work' ? 'ok' : st === 'wait' ? 'wa' : 'off'}`} />
                  <b className="font-medium">{a.name}</b>
                  <span className={`ml-auto text-[12px] ${st === 'idle' ? 'text-dim' : 'text-wait-text'}`}>{st === 'work' ? t('projects.delete.running') : st === 'wait' ? t('projects.delete.waiting') : t('projects.delete.idle')}</span>
                </div>
              )
            })}
          </div>
          {busyAgents.length > 0 && (
            <div className="mt-2.5 rounded-md border border-wait/40 bg-wait/10 px-3 py-2 text-[12.5px] text-wait-text">
              <b>{t('projects.delete.busyTitle', { count: busyAgents.length })}</b> {t('projects.delete.busyNote')}
            </div>
          )}
        </>
      ) : (
        <div className="text-[12.5px] text-muted">{t('projects.delete.noAgents')}</div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-2 p-2.5 hover:bg-panel-2">
        <input type="checkbox" checked={delDir} onChange={(e) => setDelDir(e.target.checked)} className="mt-0.5" />
        <div className="min-w-0">
          <b className="font-semibold">
            {tx('projects.delete.folderCheck', { folder: <code>{p.folder}\</code> })}
          </b>
          <div className="mt-0.5 text-[12px] text-muted">
            {!delDir ? (
              t('projects.delete.keepFolder')
            ) : info && !info.exists ? (
              t('projects.delete.folderGone')
            ) : (
              <>
                {info?.files != null
                  ? tx('projects.delete.toTrashFiles', { count: info.files, more: info.more ? '+' : '', trash: <b className="text-fg">{t('projects.delete.trash')}</b> })
                  : tx('projects.delete.toTrash', { trash: <b className="text-fg">{t('projects.delete.trash')}</b> })}
                {info?.dirty ? <span className="text-danger-text"> {t('projects.delete.dirty', { count: info.dirty })}</span> : null}
              </>
            )}
          </div>
          {delDir && <div className="mt-0.5 truncate font-mono text-[11px] text-dim" title={joinRoot(ws.path, p.folder)}>{joinRoot(ws.path, p.folder)}</div>}
        </div>
      </label>

      <div className="mt-3 rounded-md bg-panel-2 px-3 py-2 text-[12px] text-muted">
        {tx('projects.delete.notesKept', { note: <code>{p.note}</code>, agents: <code>60 Agents/</code>, root: t('common.name.rootProject') })}
      </div>
      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
    </Modal>
  )
}
