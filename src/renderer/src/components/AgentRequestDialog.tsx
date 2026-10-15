import type { ReactNode } from 'react'
import { permissionAbove, type AgentCreateDraft, type AgentRequest, type ProjectCreateDraft } from '@shared/agentApi'
import { CHUNG, joinRoot, placeOf } from '@shared/projects'
import type { AgentKind } from '@shared/types'
import { useAgentRequests } from '../store/agentRequests'
import { useAgents } from '../store/agents'
import { useWorkspaces } from '../store/workspaces'
import { permissionModes } from '../permissionModes'
import { Button, Modal } from './Modal'
import { ProjectMark } from './projects/ProjectMark'
import { t, tx, useT } from '../i18n'
import { ComputerAskBody } from './computer/ComputerAskBody'
import { useComputer } from '../store/computer'

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <>
      <div className="text-dim">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </>
  )
}

function Grid({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mt-3 grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 rounded-md border border-line bg-bg p-2.5 text-[12px]">{children}</div>
}

function Permission({ kind, mode }: { kind: AgentKind; mode: string }): React.JSX.Element {
  useT()
  const perm = permissionModes(kind).find((p) => p.id === mode)
  return (
    <>
      <span className={mode === 'auto' ? 'font-semibold text-wait' : ''}>{perm?.label ?? mode}</span>
      {perm && <div className="text-[12px] text-muted">{perm.hint}</div>}
    </>
  )
}

function CreateBody({ d, fromName, fromPlace }: { d: AgentCreateDraft; fromName: string; fromPlace: string }): React.JSX.Element {
  const t = useT()
  const cli = d.kind === 'claude' || d.kind === 'codex'
  return (
    <Grid>
      <Row label={t('agents.req.name')}>
        <b>{d.name}</b>
      </Row>
      <Row label={t('agents.req.kind')}>{d.kindLabel}</Row>
      {d.project !== undefined && (
        <Row label={t('common.project')}>
          {d.project ? (
            <span className="inline-flex items-center gap-1.5">
              <ProjectMark project={d.project} size={9} />
              <b>{d.project.name}</b>
            </span>
          ) : (
            <span>{t('agents.req.rootProject')}</span>
          )}
        </Row>
      )}
      {cli && <Row label={t('agents.req.model')}>{d.model ?? <span className="text-muted">{t('agents.req.default')}</span>}</Row>}
      {cli && <Row label={t('agents.req.effort')}>{d.effort ?? <span className="text-muted">{t('agents.req.default')}</span>}</Row>}
      {cli && (
        <Row label={t('agents.req.permission')}>
          <Permission kind={d.kind} mode={d.permissionMode} />
        </Row>
      )}
      {d.kind !== 'terminal' && <Row label={t('agents.req.role')}>{d.role || <span className="text-muted">{t('agents.req.none')}</span>}</Row>}
      {d.kind !== 'terminal' && (
        <Row label={t('agents.req.firstTask')}>
          {d.task ? (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{d.task}</div>
          ) : (
            <span className="text-muted">{t('agents.req.firstTaskNone')}</span>
          )}
        </Row>
      )}
      <Row label={t('agents.req.openNow')}>
        {!d.open
          ? t('agents.req.openNo')
          : d.project !== undefined && (d.project?.id ?? CHUNG) !== fromPlace
            ? d.project
              ? t('agents.req.openTabProject', { name: d.project.name })
              : t('agents.req.openTabRoot')
            : t('agents.req.openHere', { name: fromName })}
      </Row>
    </Grid>
  )
}

function ProjectBody({ d, wsPath, fromName }: { d: ProjectCreateDraft; wsPath: string | undefined; fromName: string }): React.JSX.Element {
  const t = useT()
  const full = wsPath ? joinRoot(wsPath, d.folder) : d.folder
  return (
    <Grid>
      <Row label={t('agents.req.name')}>
        <b>{d.name}</b>
      </Row>
      <Row label={t('agents.req.folder')}>
        <code className="break-all">{full}</code>
        <div className="text-[12px] text-muted">{d.createFolder ? t('agents.req.folderNew') : t('agents.req.folderExisting')}</div>
      </Row>
      <Row label={t('agents.req.goal')}>{d.goal || <span className="text-muted">{t('agents.req.notYet')}</span>}</Row>
      <Row label={t('agents.req.team')}>
        {d.team.length ? (
          <ul className="space-y-0.5">
            {d.team.map((m) => (
              <li key={m.name}>
                <b>{m.name}</b> <span className="text-muted">· {m.kindLabel}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted">{t('agents.req.teamNone')}</span>
        )}
        {d.team.length > 0 && <div className="text-[12px] text-muted">{t('agents.req.teamListOnly')}</div>}
      </Row>
      {d.team.length > 0 && (
        <Row label={t('agents.req.teamPermission')}>
          <Permission kind="claude" mode={d.teamPermission} />
          {permissionAbove(d.teamPermission, d.callerPermission) && (
            <div className="text-[12px] font-semibold text-wait">{t('agents.req.aboveCaller', { name: fromName, mode: d.callerPermission })}</div>
          )}
        </Row>
      )}
      <Row label={t('agents.req.note')}>
        <code className="break-all">{d.note}</code>
      </Row>
    </Grid>
  )
}

/** Tiêu đề, câu hỏi, nút đồng ý theo loại yêu cầu. */
function view(req: AgentRequest, kindOf: (id: string) => AgentKind, wsPath: string | undefined, fromPlace: string): { title: string; lead: ReactNode; body: ReactNode; ok: string } {
  const from = <b>{req.fromName}</b>
  switch (req.action) {
    case 'create':
      return {
        title: t('agents.req.create.title'),
        lead: tx(req.create.kind === 'terminal' ? 'agents.req.create.leadTerminal' : 'agents.req.create.leadAgent', { from }),
        body: <CreateBody d={req.create} fromName={req.fromName} fromPlace={fromPlace} />,
        ok: t('agents.req.create.ok')
      }
    case 'project':
      return {
        title: t('agents.req.project.title'),
        lead: tx('agents.req.project.lead', { from, name: <b>{req.project.name}</b> }),
        body: <ProjectBody d={req.project} wsPath={wsPath} fromName={req.fromName} />,
        ok: t('agents.req.project.ok')
      }
    case 'stop':
      return {
        title: t('agents.req.stop.title'),
        lead: tx('agents.req.stop.lead', { from, name: <b>{req.target.name}</b>, kind: req.target.kindLabel }),
        body: <p className="mt-3 text-[13px]">{t('agents.req.stop.body', { name: req.target.name })}</p>,
        ok: t('agents.req.stop.ok')
      }
    case 'delete':
      return {
        title: t('agents.req.delete.title'),
        lead: tx('agents.req.delete.lead', { from, name: <b>{req.target.name}</b>, kind: req.target.kindLabel }),
        body: (
          <p className="mt-3 text-[13px]">
            {t(req.target.running ? 'agents.req.delete.bodyRunning' : 'agents.req.delete.body', { name: req.target.name })}
          </p>
        ),
        ok: t('agents.req.delete.ok')
      }
    case 'permission':
      return {
        title: t('agents.req.permission.title'),
        lead: tx('agents.req.permission.lead', { from, name: <b>{req.target.name}</b>, kind: req.target.kindLabel }),
        body: (
          <Grid>
            <Row label={t('agents.req.permission.current')}>
              <Permission kind={kindOf(req.target.id)} mode={req.from} />
            </Row>
            <Row label={t('agents.req.permission.to')}>
              <Permission kind={kindOf(req.target.id)} mode={req.to} />
            </Row>
            <Row label={t('agents.req.permission.effect')}>
              {req.target.running ? t('agents.req.permission.effectNext') : t('agents.req.permission.effectNew')}
            </Row>
          </Grid>
        ),
        ok: t('agents.req.permission.ok')
      }
    case 'devserver':
      return {
        title: t('agents.req.dev.title'),
        lead: tx('agents.req.dev.lead', { from, name: <b>{req.dev.name}</b> }),
        body: (
          <Grid>
            <Row label={t('agents.req.dev.command')}>
              <code className="whitespace-pre-wrap">{req.dev.command}</code>
            </Row>
            <Row label={t('agents.req.dev.port')}>{req.dev.port}</Row>
            <Row label={t('agents.req.dev.source')}>
              {req.dev.source === 'agent'
                ? t('agents.req.dev.sourceAgent')
                : req.dev.source === 'saved'
                  ? t('agents.req.dev.sourceSaved')
                  : t('agents.req.dev.sourceGuess')}
            </Row>
            <Row label={t('agents.req.dev.note')}>{t('agents.req.dev.noteText')}</Row>
          </Grid>
        ),
        ok: t('agents.req.dev.ok')
      }
    case 'drive':
      return {
        title: t('agents.req.drive.title'),
        lead: tx(req.tool === 'send' ? 'agents.req.drive.leadSend' : req.tool === 'open' ? 'agents.req.drive.leadOpen' : 'agents.req.drive.leadHandoff', {
          from,
          name: <b>{req.target.name}</b>,
          kind: req.target.kindLabel
        }),
        body: (
          <Grid>
            <Row label={t('agents.req.drive.permOf', { name: req.fromName })}>
              <Permission kind={kindOf(req.fromAgentId)} mode={req.from} />
            </Row>
            <Row label={t('agents.req.drive.permOf', { name: req.target.name })}>
              <Permission kind={kindOf(req.target.id)} mode={req.to} />
            </Row>
            <Row label={t('agents.req.content')}>
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{req.text}</div>
            </Row>
          </Grid>
        ),
        ok: req.tool === 'send' ? t('common.send') : req.tool === 'open' ? t('agents.req.drive.okOpen') : t('agents.req.drive.okHandoff')
      }
    case 'cross': {
      const chip = (name: string, p: { name: string; color: number }): React.JSX.Element => (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5">
          <b className="font-semibold">{name}</b>
          <span className="text-dim">·</span>
          <ProjectMark project={p} size={9} />
          {p.name}
        </span>
      )
      return {
        title: t('agents.req.cross.title'),
        lead: tx(req.tool === 'send' ? 'agents.req.cross.leadSend' : req.tool === 'open' ? 'agents.req.cross.leadOpen' : 'agents.req.cross.leadHandoff', {
          from,
          fromProject: <b>{req.fromProject.name}</b>,
          name: <b>{req.target.name}</b>,
          toProject: <b>{req.toProject.name}</b>
        }),
        body: (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
              {chip(req.fromName, req.fromProject)}→{chip(req.target.name, req.toProject)}
            </div>
            <Grid>
              <Row label={t('agents.req.content')}>
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{req.text}</div>
              </Row>
            </Grid>
          </>
        ),
        ok: t('agents.req.cross.ok')
      }
    }
    case 'credential': {
      const c = req.credential
      return {
        title: t('agents.req.cred.title', { name: req.fromName }),
        lead: tx(c.step === 'totp' ? 'agents.req.cred.leadTotp' : 'agents.req.cred.leadPassword', { from, name: <b>{c.name}</b> }),
        body: (
          <>
            <Grid>
              <Row label={t('agents.req.cred.item')}>
                <b>{c.name}</b>
              </Row>
              <Row label={t('agents.req.cred.page')}>
                <code>{c.host}</code>
              </Row>
              <Row label={t('agents.req.cred.account')}>
                {c.username || <span className="text-muted">{t('agents.req.cred.noUsername')}</span>}
                {c.hasTotp ? t('agents.req.cred.hasTotp') : ''}
              </Row>
            </Grid>
            <p className="mt-2 text-[12px] text-muted">{t('agents.req.cred.footnote')}</p>
          </>
        ),
        ok: t('agents.req.cred.ok')
      }
    }
    case 'computer':
      return {
        title: t('computer.req.title', { name: req.fromName }),
        lead: tx('computer.req.lead', { from }),
        body: <ComputerAskBody ask={req.computer} />,
        ok: t('computer.req.ok')
      }
  }
}

/** Dòng cuối thẻ hỏi computer use: ảnh gửi đi đâu, phím dừng. */
function ComputerFootnote(): React.JSX.Element {
  const t = useT()
  const hotkey = useComputer((s) => s.state?.hotkey ?? 'Ctrl+Alt+Q')
  return <>{t('computer.req.footnote', { hotkey })}</>
}

/**
 * Agent xin làm thay bạn một việc trên app (Agent API: tạo / dừng / xoá agent, đổi quyền): hỏi bạn trước (hộp thoại
 * đầu hàng đợi). Agent đang chờ câu trả lời; hết hạn thì main tự từ chối.
 */
export function AgentRequestDialog(): React.JSX.Element | null {
  const t = useT()
  const req = useAgentRequests((s) => s.list[0])
  const answer = useAgentRequests((s) => s.answer)
  const ws = useWorkspaces((s) => s.items.find((w) => w.id === req?.workspaceId))
  const agents = useAgents((s) => (req ? s.byWs[req.workspaceId]?.agents : undefined))
  if (!req) return null
  const wsName = ws?.name
  const kindOf = (id: string): AgentKind => agents?.find((a) => a.id === id)?.kind ?? 'claude'
  const from = agents?.find((a) => a.id === req.fromAgentId)
  const v = view(req, kindOf, ws?.path, from ? placeOf(ws, from) : CHUNG)
  const minutes = Math.max(1, Math.round((Date.parse(req.until) - Date.now()) / 60_000))
  const allBlocked = req.action === 'computer' && req.computer.apps.every((a) => a.tier === 'blocked')
  return (
    <Modal
      title={v.title}
      icon={req.action === 'credential' ? 'key' : req.action === 'computer' ? 'monitor' : 'code'}
      tone="accent"
      width="w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(req.id, false)}>
            {req.action === 'cross' ? t('common.no') : t('common.deny')}
          </Button>
          {req.action === 'cross' && <Button onClick={() => answer(req.id, 'always')}>{t('agents.req.cross.always')}</Button>}
          {req.action === 'credential' && req.credential.canAlways && <Button onClick={() => answer(req.id, 'always')}>{t('agents.req.cred.always')}</Button>}
          {req.action === 'computer' && !allBlocked && <Button onClick={() => answer(req.id, 'always')}>{t('computer.req.always')}</Button>}
          <Button primary disabled={allBlocked} onClick={() => answer(req.id, true)}>
            {v.ok}
          </Button>
        </>
      }
    >
      <p>
        {v.lead}
        {wsName ? tx('agents.req.inWorkspace', { name: <b>{wsName}</b> }) : null}
        :
      </p>
      {v.body}
      <p className="mt-3 text-[12px] text-muted">
        {req.action === 'computer' ? <ComputerFootnote /> : req.action === 'credential' ? t('agents.req.onlyIfCred', { name: req.fromName }) : t('agents.req.onlyIf', { name: req.fromName })}{' '}
        {t('agents.req.waiting', { name: req.fromName, count: minutes })}
      </p>
    </Modal>
  )
}
