import { useState } from 'react'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import { useAgents } from '../store/agents'
import { Button, Modal } from './Modal'

/** Hộp thoại đổi tên agent: mở từ menu ⋯ ở thanh bên hoặc double-click tên trên đầu ô. */
export function RenameAgentDialog({ wsId, agentId, onClose }: { wsId: string; agentId: string; onClose: () => void }): React.JSX.Element | null {
  const state = useAgents((s) => s.byWs[wsId])
  const rename = useAgents((s) => s.rename)
  const agent = state?.agents.find((a) => a.id === agentId)
  const [name, setName] = useState(agent?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!state || !agent) return null

  const trimmed = name.trim()
  const unchanged = trimmed === agent.name
  const problem =
    agentNameProblem(trimmed) ??
    (state.agents.some((a) => a.id !== agent.id && sameAgentName(a.name, trimmed))
      ? `Đã có agent tên "${trimmed}" trong workspace này`
      : null)
  const live = !!state.running[agent.id] || !!state.starting[agent.id]

  async function submit(): Promise<void> {
    if (problem || unchanged) return
    setBusy(true)
    setError(null)
    try {
      await rename(wsId, agentId, trimmed)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Đổi tên agent "${agent.name}"`}
      width="w-[460px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={submit} disabled={busy || !!problem || unchanged}>
            {busy ? 'Đang đổi…' : 'Đổi tên'}
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
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Tên mới</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) onClose()
          }}
          className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        {problem && trimmed !== '' && <div className="mt-1.5 text-[12px] text-red-300">{problem}</div>}
        <p className="mt-3 text-[12px] text-muted">
          Note bộ nhớ <code>60 Agents/{agent.name}.md</code> trong vault sẽ đổi thành <code>60 Agents/{trimmed || '…'}.md</code>.
          Liên kết <code>[[{agent.name}]]</code> trong các note khác không tự sửa.
        </p>
        {live && (
          <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
            Phiên đang chạy vẫn mang tên cũ và vẫn nhớ đường dẫn note cũ cho tới phiên sau. Nên đổi tên lúc agent không chạy, hoặc mở phiên mới
            sau khi đổi.
          </div>
        )}
        {error && <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}
      </form>
    </Modal>
  )
}
