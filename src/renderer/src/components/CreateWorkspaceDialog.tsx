import { useState } from 'react'
import type { CreateWorkspaceResult, VaultCandidate, WorkspaceInspection } from '@shared/types'
import { Button, Modal } from './Modal'
import { t as tt, tx, useT } from '../i18n'

interface Props {
  inspection: WorkspaceInspection
  onClose: () => void
  onCreated: (result: CreateWorkspaceResult) => void
}

const NEW = '__new__'

function candidateLabel(c: VaultCandidate): string {
  return c.relPath || tt('workspace.create.projectItself')
}

const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

export function CreateWorkspaceDialog({ inspection, onClose, onCreated }: Props): React.JSX.Element {
  const t = useT()
  const [name, setName] = useState(inspection.suggestedName)
  /** Thư mục vault người dùng tự chọn ("Chọn thư mục vault khác…"), ở đâu cũng được. */
  const [custom, setCustom] = useState<VaultCandidate | null>(null)
  const candidates = custom && !inspection.candidates.some((c) => samePath(c.path, custom.path)) ? [...inspection.candidates, custom] : inspection.candidates
  const [choice, setChoice] = useState<string>(inspection.candidates[0]?.path ?? NEW)
  const chosen = candidates.find((c) => c.path === choice)
  // Mặc định: vault đúng mẫu hoặc thư mục trống → bổ sung phần còn thiếu; vault khác mẫu → giữ nguyên.
  const [augment, setAugment] = useState<Record<string, boolean>>(
    Object.fromEntries(inspection.candidates.map((c) => [c.path, c.kind === 'stag']))
  )
  const [gitInit, setGitInit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pickVault(): Promise<void> {
    setError(null)
    try {
      const c = await window.stag.vault.pick(inspection.path)
      if (!c) return
      const known = inspection.candidates.find((x) => samePath(x.path, c.path))
      if (known) {
        setChoice(known.path)
        return
      }
      setCustom(c)
      setChoice(c.path)
      setAugment((a) => ({ ...a, [c.path]: c.kind === 'stag' || !!c.empty }))
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const result = await window.stag.workspace.create({
        path: inspection.path,
        name: name.trim(),
        vault: chosen ? { mode: 'existing', path: chosen.path, augment: !!augment[chosen.path] } : { mode: 'new' },
        gitInit
      })
      onCreated(result)
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('workspace.create.title')}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary onClick={submit} disabled={busy || !name.trim()}>
            {busy ? t('workspace.create.creating') : t('workspace.create.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('workspace.create.projectFolder')}>
        <div className="truncate rounded-md bg-panel-2 px-2 py-1.5 text-muted" title={inspection.path}>
          {inspection.path}
        </div>
      </Field>

      <Field label={t('workspace.create.projectName')}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
      </Field>

      <Field label={t('workspace.create.vault')}>
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <label key={c.path} className="flex cursor-pointer gap-2 rounded-md border border-line p-2 hover:bg-panel-2">
              <input type="radio" checked={choice === c.path} onChange={() => setChoice(c.path)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div>{tx('workspace.create.useExisting', { name: <b>{candidateLabel(c)}</b> })}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                  {c.empty ? (
                    <Tag tone="muted">{t('workspace.tag.empty')}</Tag>
                  ) : (
                    <Tag tone={c.kind === 'stag' ? 'ok' : 'warn'}>{c.kind === 'stag' ? t('workspace.tag.stag') : t('workspace.tag.other')}</Tag>
                  )}
                  {c === custom && <Tag tone="muted">{t('workspace.tag.custom')}</Tag>}
                  {c.outside && <Tag tone="muted">{t('workspace.tag.outside')}</Tag>}
                </div>
                {choice === c.path && (
                  <label className="mt-2 flex items-center gap-2 text-muted">
                    <input
                      type="checkbox"
                      checked={!!augment[c.path]}
                      onChange={(e) => setAugment({ ...augment, [c.path]: e.target.checked })}
                    />
                    {t('workspace.create.augment')}
                  </label>
                )}
              </div>
            </label>
          ))}
          <label className="flex cursor-pointer gap-2 rounded-md border border-line p-2 hover:bg-panel-2">
            <input type="radio" checked={choice === NEW} onChange={() => setChoice(NEW)} className="mt-0.5" />
            <div>
              {tx('workspace.create.newVault', { name: <b>{(name.trim() || inspection.suggestedName) + ' memory'}/</b> })}
              {candidates.length === 0 && <div className="text-[11px] text-muted">{t('workspace.create.noVaults')}</div>}
            </div>
          </label>
          <button
            type="button"
            onClick={() => void pickVault()}
            disabled={busy}
            className="w-full rounded-md border border-dashed border-line-2 p-2 text-left text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-50"
          >
            {custom ? t('workspace.create.pickOther') : t('workspace.create.pickOtherLong')}
          </button>
        </div>
      </Field>

      <Field label="Git">
        {inspection.isGitRepo ? (
          <div className="text-muted">
            {chosen?.outside ? t('workspace.create.gitRepoOutside') : t('workspace.create.gitRepo')}
          </div>
        ) : (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
            {t('workspace.create.gitInit')}
          </label>
        )}
      </Field>

      <div className="text-[12px] text-muted">
        {t('workspace.create.claudeNote')}
      </div>

      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
    </Modal>
  )
}

export function CreateReport({ result, onClose }: { result: CreateWorkspaceResult; onClose: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <Modal title={t('workspace.report.title', { name: result.workspace.name })} onClose={onClose} footer={<Button primary onClick={onClose}>{t('common.done')}</Button>}>
      <ul className="space-y-1.5">
        {result.report.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent">•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">{label}</div>
      {children}
    </div>
  )
}

function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }): React.JSX.Element {
  const cls = { ok: 'bg-work/15 text-work', warn: 'bg-wait/15 text-wait', muted: 'bg-panel-2 text-muted' }[tone]
  return <span className={`rounded px-1.5 py-0.5 ${cls}`}>{children}</span>
}
