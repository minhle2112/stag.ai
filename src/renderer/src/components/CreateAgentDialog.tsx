import { useState } from 'react'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import type { AgentKind, PermissionMode } from '@shared/types'
import { permissionModes } from '../permissionModes'
import { useExternalAdapters } from '../store/externalAdapters'
import { useSettings } from '../store/settings'
import { Button, Modal } from './Modal'

const ROLES = ['Lead', 'Dev', 'QA', 'Docs']

/** Một lựa chọn "Loại": adapter có sẵn, hoặc adapter ngoài (key `ext:<id>`). */
interface KindOption {
  key: string
  kind: AgentKind
  adapterId?: string
  label: string
  hint: string
}

const KINDS: KindOption[] = [
  { key: 'claude', kind: 'claude', label: 'Claude Code', hint: 'Agent có vai trò, bộ nhớ riêng, lên kanban.' },
  { key: 'codex', kind: 'codex', label: 'Codex', hint: 'Agent chạy Codex CLI, cũng có vai trò, bộ nhớ, kanban.' },
  { key: 'terminal', kind: 'terminal', label: 'Terminal', hint: 'Shell trong thư mục dự án, không có bộ nhớ.' }
]

interface Props {
  /** Tên gợi ý theo loại ô ("Agent 3", "Terminal 1"). */
  suggestName: (kind: AgentKind) => string
  /** Tên các agent đã có trong workspace, để báo trùng ngay khi gõ. */
  takenNames: string[]
  onCancel: () => void
  onSubmit: (v: { kind: AgentKind; adapterId?: string; name: string; role: string; permissionMode: PermissionMode }) => Promise<void>
}

export function CreateAgentDialog({ suggestName, takenNames, onCancel, onSubmit }: Props): React.JSX.Element {
  const adapters = useSettings((s) => s.value.app.adapters)
  const external = useExternalAdapters((s) => s.items)
  // Adapter tắt ở Cài đặt → Adapter không hiện ở đây. Tắt hết thì vẫn hiện đủ (không để hộp này cụt).
  const all: KindOption[] = [
    ...KINDS.filter((k) => adapters[k.kind as 'claude' | 'codex' | 'terminal'].enabled),
    ...external
      .filter((a) => a.enabled)
      .map((a) => ({
        key: `ext:${a.manifest.id}`,
        kind: 'external' as const,
        adapterId: a.manifest.id,
        label: a.manifest.label,
        hint: a.manifest.description || 'Adapter ngoài (alpha).'
      }))
  ]
  const kinds = all.length ? all : KINDS
  const [key, setKey] = useState(kinds[0].key)
  const opt = kinds.find((k) => k.key === key) ?? kinds[0]
  const kind = opt.kind
  const [name, setName] = useState(suggestName(kinds[0].kind))
  const terminal = kind === 'terminal'
  const [role, setRole] = useState('')
  const defaultMode = (k: AgentKind): PermissionMode => (k === 'claude' || k === 'codex' ? adapters[k].defaultPermission : 'default')
  const [mode, setMode] = useState<PermissionMode>(defaultMode(kinds[0].kind))
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
      await onSubmit({ kind, adapterId: opt.adapterId, name: trimmed, role: role.trim(), permissionMode: mode })
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
          <div className={`grid gap-1.5 ${kinds.length === 1 ? 'grid-cols-1' : kinds.length === 2 || kinds.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {kinds.map((k) => (
              <button
                type="button"
                key={k.key}
                title={k.hint}
                onClick={() => {
                  // Tên còn là tên gợi ý của loại cũ thì đổi theo loại mới.
                  if (name === suggestName(kind)) setName(suggestName(k.kind))
                  if (k.key !== key) setMode(defaultMode(k.kind))
                  setKey(k.key)
                }}
                className={`rounded-md border px-2 py-1.5 text-left ${
                  key === k.key ? 'border-accent bg-accent/10' : 'border-line bg-panel-2 hover:border-accent/50'
                }`}
              >
                <div>{k.label}</div>
                <div className="text-[11px] text-muted">{k.hint}</div>
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
            {kind !== 'external' && (
            <Label text="Quyền">
              <div className="space-y-1">
                {permissionModes(kind).map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-panel-2">
                    <input type="radio" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5" />
                    <span>
                      {m.label} <span className="text-[12px] text-muted">— {m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Label>
            )}
          </>
        )}
        {terminal ? (
          <p className="text-[12px] text-muted">
            Terminal mở shell chọn ở Cài đặt → Adapter → Terminal, trong thư mục dự án. Đóng ô thì terminal vẫn chạy, mở lại ở thanh bên.
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
