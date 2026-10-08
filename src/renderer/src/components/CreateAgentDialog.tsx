import { useState } from 'react'
import type { PermissionMode } from '@shared/types'
import { Button, Modal } from './Modal'

const ROLES = ['Lead', 'Dev', 'QA', 'Docs']

const MODES: Array<{ id: PermissionMode; label: string; hint: string }> = [
  { id: 'default', label: 'Theo cài đặt Claude Code', hint: 'Hỏi bạn như khi bạn tự chạy claude.' },
  { id: 'acceptEdits', label: 'Tự sửa file', hint: 'Sửa file không cần hỏi; chạy lệnh vẫn hỏi.' },
  { id: 'auto', label: 'Tự động', hint: 'Claude tự quyết, vẫn chặn việc rủi ro.' },
  { id: 'plan', label: 'Chỉ lập kế hoạch', hint: 'Đọc và đề xuất, không sửa gì.' }
]

interface Props {
  defaultName: string
  onCancel: () => void
  onSubmit: (v: { name: string; role: string; permissionMode: PermissionMode }) => Promise<void>
}

export function CreateAgentDialog({ defaultName, onCancel, onSubmit }: Props): React.JSX.Element {
  const [name, setName] = useState(defaultName)
  const [role, setRole] = useState('')
  const [mode, setMode] = useState<PermissionMode>('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), role: role.trim(), permissionMode: mode })
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Thêm agent"
      width="w-[460px]"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Đang tạo…' : 'Tạo và mở phiên'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Label text="Tên agent">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          />
        </Label>
        <Label text="Vai trò (tuỳ chọn)">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="vd. Dev frontend"
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex gap-1.5">
            {ROLES.map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRole(r)}
                className="rounded bg-panel-2 px-2 py-0.5 text-[12px] text-muted hover:text-fg"
              >
                {r}
              </button>
            ))}
          </div>
        </Label>
        <Label text="Quyền">
          <div className="space-y-1">
            {MODES.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-panel-2">
                <input type="radio" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5" />
                <span>
                  {m.label} <span className="text-[12px] text-muted">— {m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Label>
        <p className="text-[12px] text-muted">
          Khi mở, agent sẽ đọc vault rồi hỏi bạn muốn nó giúp gì trong workspace này. Bộ nhớ riêng của agent nằm ở{' '}
          <code>60 Agents/{name.trim() || '…'}.md</code> trong vault.
        </p>
        {error && <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}
      </form>
    </Modal>
  )
}

function Label({ text, children }: { text: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">{text}</div>
      {children}
    </div>
  )
}
