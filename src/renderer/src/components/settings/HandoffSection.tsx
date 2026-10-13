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

/** Cấp đang sửa: 'app' hoặc `ws:<id>` hoặc `agent:<wsId>:<agentId>`. */
type LevelKey = string

export function HandoffSection(): React.JSX.Element {
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
        title="Agent & bàn giao"
        desc="Khi context của một phiên agent đạt ngưỡng và agent đang chờ bạn (hết lượt, bạn không gõ phím vài giây), app nhờ agent ghi vault và viết bản bàn giao, rồi đóng phiên và mở phiên mới đọc tiếp từ bản bàn giao đó. Việc đang làm của agent vẫn giữ nguyên."
        right={<LevelBar level={level} setLevel={setLevel} has={(o) => !!o?.handoff} />}
      />
      <ErrorBar error={error} />

      <Group title="Bàn giao khi context gần đầy">
        <Row label="Tự động bàn giao" override={override('autoHandoff', (v) => (v ? 'bật' : 'tắt'))}>
          <Switch label="Tự động bàn giao" checked={effective.autoHandoff} onChange={(v) => setField('autoHandoff', v)} />
        </Row>
        <Row
          label="Ngưỡng"
          desc={`= ${formatTokens((200_000 * pct) / 100)} token với cửa sổ 200k, ${formatTokens((1_000_000 * pct) / 100)} token với cửa sổ 1M. Claude Code tự compact ở khoảng 97% (cửa sổ 1M) nên tối đa là ${HANDOFF_MAX}%.`}
          disabled={percentOff}
          override={override('handoffPercent', (v) => `${v}%`)}
        >
          <input
            type="range"
            aria-label="Ngưỡng bàn giao (thanh trượt)"
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
            label="Ngưỡng bàn giao"
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

      <Note>
        Bàn giao tay bất cứ lúc nào: menu ⋯ của agent ở thanh bên → "Bàn giao sang phiên mới". App đọc % context qua statusLine của Claude Code; statusLine
        riêng của bạn (nếu có) vẫn chạy và hiện như cũ trong phiên agent.
      </Note>
    </>
  )
}

/** Dải 0–100%: mỗi ô vuông là một agent ở đúng % context của nó, vạch đỏ = ngưỡng bàn giao (vùng sau vạch tô đỏ nhạt). */
function CtxStrip({ threshold, agents, muted }: { threshold: number; agents: Array<{ id: string; name: string; pct: number }>; muted?: boolean }): React.JSX.Element {
  return (
    <div className={`relative mt-3 mb-1 h-[50px] rounded-md border border-line bg-panel ${muted ? 'opacity-50' : ''}`}>
      <span className="absolute top-[9px] left-3 flex items-center gap-1.5 text-[12px] text-muted">
        Ctx hiện tại
        <InfoTip text="Mỗi ô vuông là một agent · vạch đỏ = ngưỡng bàn giao" />
      </span>
      <div className="absolute top-[17px] right-[22px] left-[120px] h-[3px] rounded-sm bg-panel-3">
        <div className="absolute inset-y-0 right-0 rounded-r-sm bg-danger/40" style={{ left: `${threshold}%` }} />
        {[0, 50, 100].map((v) => (
          <span key={v} className="absolute top-3 -translate-x-1/2 font-mono text-[11px] text-dim" style={{ left: `${v}%` }}>
            {v}%
          </span>
        ))}
        <span className="absolute -top-2 -ml-px h-[19px] w-0.5 rounded-sm bg-danger" style={{ left: `${threshold}%` }} data-tip={`Ngưỡng ${threshold}%`} />
        {agents.map((a) => (
          <span
            key={a.id}
            className="absolute -top-[7px] inline-flex -translate-x-1/2 rounded-[5px] shadow-[0_0_0_2px_var(--color-panel)]"
            style={{ left: `${a.pct}%` }}
            data-tip={`${a.name} · ctx ${Math.floor(a.pct)}%${a.pct >= threshold ? ' · sắp bàn giao' : ''}`}
          >
            <AgentAvatar name={a.name} size={16} />
          </span>
        ))}
      </div>
    </div>
  )
}
