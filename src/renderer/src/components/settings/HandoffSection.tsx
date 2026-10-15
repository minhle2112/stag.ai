import { useState } from 'react'
import { resolveHandoff } from '@shared/settings'
import { HANDOFF_MAX, HANDOFF_MIN, type HandoffSettings } from '@shared/types'
import { formatTokens } from '../../status'
import { useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { AgentAvatar } from '../ui/AgentAvatar'
import { ErrorBar, Group, InfoTip, Note, Row, SectionTitle, Stepper, Switch, useSaveError } from './controls'
import { LevelBar } from './levels'
import { useT } from '../../i18n'

/** Cấp đang sửa: 'app' hoặc `ws:<id>` hoặc `agent:<wsId>:<agentId>`. */
type LevelKey = string

export function HandoffSection(): React.JSX.Element {
  const t = useT()
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const activeWs = useWorkspaces((s) => s.activeId)
  const byWs = useAgents((s) => s.byWs)
  const [level, setLevel] = useState<LevelKey>('app')
  const [error, run] = useSaveError()

  const [kind, wsId, agentId] = level.split(':') as ['app' | 'ws' | 'agent', string?, string?]
  const ws = workspaces.find((w) => w.id === wsId)
  const agent = agentId ? byWs[wsId!]?.agents.find((a) => a.id === agentId) : undefined
  // Workspace / agent đã bị xoá trong lúc đang chọn → quay về cấp app.
  const lvl: 'app' | 'ws' | 'agent' = kind === 'ws' && ws ? 'ws' : kind === 'agent' && ws && agent ? 'agent' : 'app'

  const own: Partial<HandoffSettings> =
    lvl === 'ws' ? (settings.workspaces[ws!.id]?.handoff ?? {}) : lvl === 'agent' ? (settings.agents[agent!.id]?.handoff ?? {}) : settings.app.handoff
  const parent: HandoffSettings = lvl === 'agent' ? resolveHandoff(settings, ws!.id, null) : settings.app.handoff
  const effective: HandoffSettings = { ...parent, ...own }

  function setField<K extends keyof HandoffSettings>(key: K, value: HandoffSettings[K] | undefined): void {
    if (lvl === 'app') {
      if (value !== undefined) run(save({ handoff: { [key]: value } }))
      return
    }
    const next = { ...own }
    if (value === undefined) delete next[key]
    else next[key] = value
    const empty = Object.keys(next).length === 0
    run(saveOverrides(lvl === 'ws' ? 'workspace' : 'agent', lvl === 'ws' ? ws!.id : agent!.id, { handoff: empty ? null : next }))
  }

  /** Dòng đang ghi đè ở cấp workspace / agent: chấm teal, bấm để theo cấp trên. */
  const override = (key: keyof HandoffSettings, fmt: (v: HandoffSettings[keyof HandoffSettings]) => string): { on: boolean; onReset: () => void; parent: string } | undefined =>
    lvl === 'app' ? undefined : { on: key in own, onReset: () => setField(key, undefined), parent: fmt(parent[key]) }

  const [drag, setDrag] = useState<number | null>(null)
  const pct = drag ?? effective.handoffPercent
  const commitDrag = (): void => {
    if (drag !== null && drag !== effective.handoffPercent) setField('handoffPercent', drag)
    setDrag(null)
  }
  const percentOff = !effective.autoHandoff

  // Dải context: agent đang chạy của workspace đang xem (hoặc workspace đang mở) đã biết % cửa sổ.
  const stripWs = lvl !== 'app' ? ws!.id : (activeWs ?? undefined)
  const statuses = useBoard((s) => (stripWs ? s.byWs[stripWs]?.statuses : undefined))
  const strip = (byWs[stripWs ?? '']?.agents ?? []).flatMap((a) => {
    const c = statuses?.find((x) => x.agentId === a.id)?.context
    return c?.size ? [{ id: a.id, name: a.name, pct: Math.min(100, (c.used / c.size) * 100) }] : []
  })

  return (
    <>
      <SectionTitle
        title={t('handoff.title')}
        desc={t('handoff.desc')}
        right={<LevelBar level={level} setLevel={setLevel} has={(o) => !!o?.handoff} />}
      />
      <ErrorBar error={error} />

      <Group title={t('handoff.group')}>
        <Row label={t('handoff.auto')} override={override('autoHandoff', (v) => (v ? t('common.on').toLowerCase() : t('common.off').toLowerCase()))}>
          <Switch label={t('handoff.auto')} checked={effective.autoHandoff} onChange={(v) => setField('autoHandoff', v)} />
        </Row>
        <Row
          label={t('handoff.threshold')}
          desc={t('handoff.thresholdDesc', {
            t200: formatTokens((200_000 * pct) / 100),
            t1m: formatTokens((1_000_000 * pct) / 100),
            max: HANDOFF_MAX
          })}
          disabled={percentOff}
          override={override('handoffPercent', (v) => `${v}%`)}
        >
          <input
            type="range"
            aria-label={t('handoff.sliderLabel')}
            min={HANDOFF_MIN}
            max={HANDOFF_MAX}
            step={5}
            value={drag ?? pct}
            disabled={percentOff}
            // Kéo thì chỉ đổi số trên màn hình, thả tay mới lưu (không ghi file mỗi bước kéo).
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={commitDrag}
            onKeyUp={commitDrag}
            onBlur={commitDrag}
            className="w-40 accent-accent"
          />
          <Stepper
            label={t('handoff.thresholdLabel')}
            value={pct}
            min={HANDOFF_MIN}
            max={HANDOFF_MAX}
            step={5}
            suffix="%"
            disabled={percentOff}
            onChange={(v) => setField('handoffPercent', v)}
          />
        </Row>
      </Group>

      <CtxStrip threshold={pct} agents={strip} muted={percentOff} />

      <Note>{t('handoff.note')}</Note>
    </>
  )
}

/** Dải 0–100%: mỗi ô vuông là một agent ở đúng % context của nó, vạch đỏ = ngưỡng bàn giao (vùng sau vạch tô đỏ nhạt). */
function CtxStrip({ threshold, agents, muted }: { threshold: number; agents: Array<{ id: string; name: string; pct: number }>; muted?: boolean }): React.JSX.Element {
  const t = useT()
  return (
    <div className={`relative mt-3 mb-1 h-[50px] rounded-md border border-line bg-panel ${muted ? 'opacity-50' : ''}`}>
      <span className="absolute top-[9px] left-3 flex items-center gap-1.5 text-[12px] text-muted">
        {t('handoff.strip')}
        <InfoTip text={t('handoff.stripTip')} />
      </span>
      <div className="absolute top-[17px] right-[22px] left-[120px] h-[3px] rounded-sm bg-panel-3">
        <div className="absolute inset-y-0 right-0 rounded-r-sm bg-danger/40" style={{ left: `${threshold}%` }} />
        {[0, 50, 100].map((v) => (
          <span key={v} className="absolute top-3 -translate-x-1/2 font-mono text-[11px] text-dim" style={{ left: `${v}%` }}>
            {v}%
          </span>
        ))}
        <span className="absolute -top-2 -ml-px h-[19px] w-0.5 rounded-sm bg-danger" style={{ left: `${threshold}%` }} data-tip={t('handoff.thresholdTip', { pct: threshold })} />
        {agents.map((a) => (
          <span
            key={a.id}
            className="absolute -top-[7px] inline-flex -translate-x-1/2 rounded-[5px] shadow-[0_0_0_2px_var(--color-panel)]"
            style={{ left: `${a.pct}%` }}
            data-tip={`${a.name} · ctx ${Math.floor(a.pct)}%${a.pct >= threshold ? t('handoff.soon') : ''}`}
          >
            <AgentAvatar name={a.name} size={16} />
          </span>
        ))}
      </div>
    </div>
  )
}
