import { useState } from 'react'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import { useAgents } from '../store/agents'
import { Button, Modal } from './Modal'
import { tx, useT } from '../i18n'

/** Hộp thoại đổi tên agent: mở từ menu ⋯ ở thanh bên hoặc double-click tên trên đầu ô. */
export function RenameAgentDialog({ wsId, agentId, onClose }: { wsId: string; agentId: string; onClose: () => void }): React.JSX.Element | null {
  const t = useT()
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
    (state.agents.some((a) => a.id !== agent.id && sameAgentName(a.name, trimmed)) ? t('agents.name.taken', { name: trimmed }) : null)
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
      title={t('agents.rename.title', { name: agent.name })}
      width="w-[460px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary onClick={submit} disabled={busy || !!problem || unchanged}>
            {busy ? t('agents.rename.busy') : t('agents.rename.ok')}
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
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">{t('agents.rename.newName')}</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) onClose()
          }}
          className="w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        {problem && trimmed !== '' && <div className="mt-1.5 text-[12px] text-danger">{problem}</div>}
        <p className="mt-3 text-[12px] text-muted">
          {tx('agents.rename.note', {
            from: <code>60 Agents/{agent.name}.md</code>,
            to: <code>60 Agents/{trimmed || '…'}.md</code>,
            link: <code>[[{agent.name}]]</code>
          })}
        </p>
        {live && <div className="mt-3 rounded-md border border-wait/40 bg-wait/10 px-3 py-2 text-[12px] text-wait">{t('agents.rename.live')}</div>}
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
      </form>
    </Modal>
  )
}
