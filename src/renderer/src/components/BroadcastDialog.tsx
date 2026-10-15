import { useEffect, useMemo, useRef, useState } from 'react'
import { agentKind, type BroadcastResult } from '@shared/types'
import { MESSAGE_MAX } from '@shared/agentApi'
import { statusView } from '../status'
import { useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useUi } from '../store/ui'
import { useWorkspaces } from '../store/workspaces'
import { Button, Modal } from './Modal'
import { AgentAvatar } from './ui/AgentAvatar'
import { useT } from '../i18n'
import type { PlainKey } from '@shared/i18n'

const RESULT_LABEL: Record<BroadcastResult['results'][number]['status'], PlainKey> = {
  sent: 'agents.broadcast.sent',
  queued: 'agents.broadcast.queued',
  'not-running': 'agents.broadcast.notRunning',
  invalid: 'agents.broadcast.invalid'
}

/** Phát một tin cho nhiều agent trong workspace (gõ như người dùng gõ vào từng ô, đi qua hàng chờ tin của app). */
export function BroadcastDialog(): React.JSX.Element | null {
  const t = useT()
  const wsId = useUi((s) => s.broadcast)
  const setBroadcast = useUi((s) => s.setBroadcast)
  const workspace = useWorkspaces((s) => s.items.find((w) => w.id === wsId))
  const state = useAgents((s) => (wsId ? s.byWs[wsId] : undefined))
  const statuses = useBoard((s) => (wsId ? s.byWs[wsId]?.statuses : undefined))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BroadcastResult | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  const rows = useMemo(
    () =>
      (state?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => {
          const running = !!state?.running[a.id]
          const v = statusView(running, !!state?.starting[a.id], statuses?.find((x) => x.agentId === a.id), agentKind(a))
          return { agent: a, running, view: v }
        }),
    [state, statuses]
  )

  // Mở hộp: chọn sẵn mọi agent đang chạy.
  useEffect(() => {
    if (!wsId) return
    setPicked(new Set(rows.filter((r) => r.running).map((r) => r.agent.id)))
    setText('')
    setError(null)
    setResult(null)
    requestAnimationFrame(() => area.current?.focus())
    // Chỉ chạy lúc mở (đổi workspace), không chạy lại khi trạng thái agent đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId])

  if (!wsId || !workspace) return null
  const targets = rows.filter((r) => picked.has(r.agent.id) && r.running)
  const trimmed = text.trim()
  const tooLong = trimmed.length > MESSAGE_MAX

  const toggle = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function send(): Promise<void> {
    if (!trimmed || tooLong || !targets.length || busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.stag.agent.broadcast({ workspaceId: wsId!, agentIds: targets.map((r) => r.agent.id), text: trimmed }))
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  const running = rows.filter((r) => r.running)
  const idle = running.filter((r) => !r.view.waiting && r.view.mark === 'ok' && r.view.label !== t('status.session.running'))

  return (
    <Modal
      title={t('agents.broadcast.title', { name: workspace.name })}
      icon="send"
      width="w-[520px]"
      onClose={() => setBroadcast(null)}
      footer={
        result ? (
          <Button primary onClick={() => setBroadcast(null)}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <span className="mr-auto text-[12px] text-muted">
              {targets.length ? t('agents.broadcast.sendTo', { count: targets.length }) : t('agents.broadcast.pickOne')}
            </span>
            <Button onClick={() => setBroadcast(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button primary onClick={send} disabled={busy || !trimmed || tooLong || !targets.length}>
              {busy ? t('agents.broadcast.sending') : t('common.send')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ul className="space-y-1.5">
          {result.results.map((r) => (
            <li key={r.agentId} className="flex items-center gap-2">
              <AgentAvatar name={r.name || '?'} size={18} />
              <span className="min-w-0 flex-1 truncate">{r.name || t('agents.broadcast.deleted')}</span>
              <span className={r.status === 'sent' ? 'text-work' : r.status === 'queued' ? 'text-muted' : 'text-dim'}>{t(RESULT_LABEL[r.status])}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="mb-1.5 flex items-center gap-2 text-[11px] tracking-wider text-muted uppercase">
            <span className="flex-1">{t('agents.broadcast.to')}</span>
            <button type="button" className="normal-case hover:text-fg" onClick={() => setPicked(new Set(running.map((r) => r.agent.id)))}>
              {t('agents.broadcast.allRunning')}
            </button>
            {idle.length > 0 && (
              <button type="button" className="normal-case hover:text-fg" onClick={() => setPicked(new Set(idle.map((r) => r.agent.id)))}>
                {t('agents.broadcast.idleOnly')}
              </button>
            )}
            <button type="button" className="normal-case hover:text-fg" onClick={() => setPicked(new Set())}>
              {t('agents.broadcast.clear')}
            </button>
          </div>
          <div className="mb-4 max-h-52 overflow-y-auto rounded-md border border-line bg-bg">
            {rows.length === 0 && <div className="px-3 py-3 text-dim">{t('agents.broadcast.noAgents')}</div>}
            {rows.map((r) => (
              <label
                key={r.agent.id}
                className={`flex items-center gap-2.5 px-2.5 py-1.5 ${r.running ? 'cursor-pointer hover:bg-panel-2' : 'cursor-not-allowed opacity-50'}`}
              >
                <input type="checkbox" disabled={!r.running} checked={picked.has(r.agent.id) && r.running} onChange={() => toggle(r.agent.id)} />
                <AgentAvatar agent={r.agent} size={18} />
                <span className="min-w-0 flex-1 truncate">{r.agent.name}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                  <span className={`sdot ${r.view.mark}`} />
                  {r.view.label}
                </span>
              </label>
            ))}
          </div>
          <div className="mb-1.5 text-[11px] tracking-wider text-muted uppercase">{t('agents.broadcast.message')}</div>
          <textarea
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            rows={4}
            placeholder={t('agents.broadcast.placeholder')}
            className="w-full resize-none rounded-md border border-line-2 bg-bg px-2.5 py-2 outline-none focus:border-accent"
          />
          <div className="mt-1.5 flex gap-3 text-[12px] text-muted">
            <span className="flex-1">{t('agents.broadcast.hint')}</span>
            {tooLong && <span className="text-danger">{t('agents.broadcast.tooLong', { count: MESSAGE_MAX })}</span>}
          </div>
          {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
        </>
      )}
    </Modal>
  )
}
