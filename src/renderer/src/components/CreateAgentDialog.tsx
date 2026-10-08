import { useState } from 'react'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import type { AgentKind, PermissionMode } from '@shared/types'
import { Button, Modal } from './Modal'

const ROLES = ['Lead', 'Dev', 'QA', 'Docs']

/** Mức quyền theo CLI của agent (main đổi sang cờ của từng CLI, xem agents.ts / codex.ts). */
function modes(kind: AgentKind): Array<{ id: PermissionMode; label: string; hint: string }> {
  if (kind === 'codex')
    return [
      { id: 'default', label: 'Theo cài đặt Codex', hint: 'Như khi bạn tự chạy codex (~/.codex/config.toml).' },
      { id: 'acceptEdits', label: 'Tự sửa file', hint: 'Sửa trong thư mục dự án không cần hỏi; ra ngoài sandbox thì hỏi.' },
      { id: 'auto', label: 'Tự động', hint: 'Codex tự duyệt (approve-for-me), vẫn trong sandbox.' },
      { id: 'plan', label: 'Chỉ đọc', hint: 'Sandbox chỉ đọc: đọc và đề xuất, không sửa gì.' }
    ]
  return [
    { id: 'default', label: 'Theo cài đặt Claude Code', hint: 'Hỏi bạn như khi bạn tự chạy claude.' },
    { id: 'acceptEdits', label: 'Tự sửa file', hint: 'Sửa file không cần hỏi; chạy lệnh vẫn hỏi.' },
    { id: 'auto', label: 'Tự động', hint: 'Claude tự quyết, vẫn chặn việc rủi ro.' },
    { id: 'plan', label: 'Chỉ lập kế hoạch', hint: 'Đọc và đề xuất, không sửa gì.' }
  ]
}

/** Loại ô. `ready: false` = chưa tích hợp xong, hiện để biết là sắp có. */
const KINDS: Array<{ id: AgentKind; label: string; hint: string; ready: boolean }> = [
  { id: 'claude', label: 'Claude Code', hint: 'Agent có vai trò, bộ nhớ riêng, lên kanban.', ready: true },
  { id: 'codex', label: 'Codex', hint: 'Agent chạy Codex CLI, cũng có vai trò, bộ nhớ, kanban.', ready: true },
  { id: 'gemini', label: 'Gemini CLI', hint: 'Agent chạy Gemini CLI.', ready: false },
  { id: 'terminal', label: 'Terminal', hint: 'PowerShell trong thư mục dự án, không có bộ nhớ.', ready: true }
]

interface Props {
  /** Tên gợi ý theo loại ô ("Agent 3", "Terminal 1"). */
  suggestName: (kind: AgentKind) => string
  /** Tên các agent đã có trong workspace, để báo trùng ngay khi gõ. */
  takenNames: string[]
  onCancel: () => void
  onSubmit: (v: { kind: AgentKind; name: string; role: string; permissionMode: PermissionMode }) => Promise<void>
}

export function CreateAgentDialog({ suggestName, takenNames, onCancel, onSubmit }: Props): React.JSX.Element {
  const [kind, setKind] = useState<AgentKind>('claude')
  const [name, setName] = useState(suggestName('claude'))
  const terminal = kind === 'terminal'
  const [role, setRole] = useState('')
  const [mode, setMode] = useState<PermissionMode>('default')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const problem =
    agentNameProblem(trimmed) ??
    (takenNames.some((n) => sameAgentName(n, trimmed)) ? `Đã có agent tên "${trimmed}" trong workspace này` : null)

  async function submit(): Promise<void> {
    if (problem) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ kind, name: trimmed, role: role.trim(), permissionMode: mode })
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={terminal ? 'Thêm terminal' : 'Thêm agent'}
      width="w-[460px]"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={submit} disabled={busy || !!problem}>
            {busy ? 'Đang tạo…' : terminal ? 'Tạo và mở terminal' : 'Tạo và mở phiên'}
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
        <Label text="Loại">
          <div className="grid grid-cols-2 gap-1.5">
            {KINDS.map((k) => (
              <button
                type="button"
                key={k.id}
                disabled={!k.ready}
                title={k.ready ? k.hint : `${k.hint} Sắp có.`}
                onClick={() => {
                  // Tên còn là tên gợi ý của loại cũ thì đổi theo loại mới.
                  if (name === suggestName(kind)) setName(suggestName(k.id))
                  setKind(k.id)
                }}
                className={`rounded-md border px-2 py-1.5 text-left disabled:opacity-40 ${
                  kind === k.id ? 'border-accent bg-accent/10' : 'border-line bg-panel-2 hover:border-accent/50'
                }`}
              >
                <div>{k.label}</div>
                <div className="text-[11px] text-muted">{k.ready ? k.hint : 'Sắp có'}</div>
              </button>
            ))}
          </div>
        </Label>
        <Label text={terminal ? 'Tên terminal' : 'Tên agent'}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
          />
          {problem && trimmed !== '' && <div className="mt-1.5 text-[12px] text-red-300">{problem}</div>}
        </Label>
        {!terminal && (
          <>
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
                {modes(kind).map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-panel-2">
                    <input type="radio" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5" />
                    <span>
                      {m.label} <span className="text-[12px] text-muted">— {m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Label>
          </>
        )}
        {terminal ? (
          <p className="text-[12px] text-muted">
            Terminal mở PowerShell trong thư mục dự án. Đóng ô thì terminal vẫn chạy, mở lại ở thanh bên.
          </p>
        ) : (
          <p className="text-[12px] text-muted">
            Khi mở, agent sẽ đọc vault rồi hỏi bạn muốn nó giúp gì trong workspace này. Bộ nhớ riêng của agent nằm ở{' '}
            <code>60 Agents/{trimmed || '…'}.md</code> trong vault.
          </p>
        )}
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
