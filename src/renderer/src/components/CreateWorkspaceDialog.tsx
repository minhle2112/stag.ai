import { useState } from 'react'
import type { CreateWorkspaceResult, VaultCandidate, WorkspaceInspection } from '@shared/types'
import { Button, Modal } from './Modal'

interface Props {
  inspection: WorkspaceInspection
  onClose: () => void
  onCreated: (result: CreateWorkspaceResult) => void
}

const NEW = '__new__'

function candidateLabel(c: VaultCandidate): string {
  return c.relPath || '(chính thư mục dự án)'
}

export function CreateWorkspaceDialog({ inspection, onClose, onCreated }: Props): React.JSX.Element {
  const { candidates } = inspection
  const [name, setName] = useState(inspection.suggestedName)
  const [choice, setChoice] = useState<string>(candidates[0]?.path ?? NEW)
  const chosen = candidates.find((c) => c.path === choice)
  // Mặc định: vault đúng mẫu → bổ sung phần còn thiếu; vault Obsidian khác mẫu → giữ nguyên.
  const [augment, setAugment] = useState<Record<string, boolean>>(
    Object.fromEntries(candidates.map((c) => [c.path, c.kind === 'stag']))
  )
  const [gitInit, setGitInit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      title="Tạo workspace"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Đang tạo…' : 'Tạo workspace'}
          </Button>
        </>
      }
    >
      <Field label="Thư mục dự án">
        <div className="truncate rounded-md bg-panel-2 px-2 py-1.5 text-muted" title={inspection.path}>
          {inspection.path}
        </div>
      </Field>

      <Field label="Tên dự án">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
      </Field>

      <Field label="Vault (bộ nhớ)">
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <label key={c.path} className="flex cursor-pointer gap-2 rounded-md border border-line p-2 hover:bg-panel-2">
              <input type="radio" checked={choice === c.path} onChange={() => setChoice(c.path)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div>
                  Dùng vault có sẵn: <b>{candidateLabel(c)}</b>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                  <Tag tone={c.kind === 'stag' ? 'ok' : 'warn'}>{c.kind === 'stag' ? 'đúng mẫu stag.ai' : 'vault Obsidian khác mẫu'}</Tag>
                  <Tag tone={c.registered ? 'ok' : 'muted'}>{c.registered ? 'đã đăng ký trong Obsidian' : 'chưa đăng ký trong Obsidian'}</Tag>
                </div>
                {choice === c.path && (
                  <label className="mt-2 flex items-center gap-2 text-muted">
                    <input
                      type="checkbox"
                      checked={!!augment[c.path]}
                      onChange={(e) => setAugment({ ...augment, [c.path]: e.target.checked })}
                    />
                    Bổ sung thư mục/note còn thiếu theo template (chỉ thêm, không sửa hay xoá)
                  </label>
                )}
              </div>
            </label>
          ))}
          <label className="flex cursor-pointer gap-2 rounded-md border border-line p-2 hover:bg-panel-2">
            <input type="radio" checked={choice === NEW} onChange={() => setChoice(NEW)} className="mt-0.5" />
            <div>
              Tạo vault mới: <b>{(name.trim() || inspection.suggestedName) + ' memory'}/</b>
              {candidates.length === 0 && <div className="text-[11px] text-muted">Không tìm thấy vault nào trong thư mục này.</div>}
            </div>
          </label>
        </div>
      </Field>

      <Field label="Git">
        {inspection.isGitRepo ? (
          <div className="text-muted">Thư mục là repo git: app sẽ thêm vault và .obsidian/ vào .gitignore.</div>
        ) : (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} />
            Khởi tạo git cho thư mục này
          </label>
        )}
      </Field>

      <div className="text-[12px] text-muted">
        App cũng đảm bảo có CLAUDE.md (quy tắc recall vault) và cache auto memory của Claude Code. File đã có sẽ không bị ghi đè.
      </div>

      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
    </Modal>
  )
}

export function CreateReport({ result, onClose }: { result: CreateWorkspaceResult; onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={`Đã tạo workspace "${result.workspace.name}"`} onClose={onClose} footer={<Button primary onClick={onClose}>Xong</Button>}>
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
