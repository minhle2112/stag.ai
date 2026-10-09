import { useState } from 'react'
import { resolveHandoff } from '@shared/settings'
import { agentKind, HANDOFF_MAX, HANDOFF_MIN, type HandoffSettings } from '@shared/types'
import { formatTokens } from '../../status'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, Row, SectionTitle, Select, Stepper, Switch, useSaveError } from './controls'

/** Cấp đang sửa: 'app' hoặc `ws:<id>` hoặc `agent:<wsId>:<agentId>`. */
type LevelKey = string

export function HandoffSection(): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
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
  const parentName = lvl === 'agent' ? `workspace ${ws!.name}` : 'mặc định của app'
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

  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${settings.workspaces[w.id]?.handoff ? ' •' : ''}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${settings.agents[a.id]?.handoff ? ' •' : ''}` }))
    ])
  ]

  const overrideToggle = (key: keyof HandoffSettings): React.JSX.Element | null =>
    lvl === 'app' ? null : (
      <label className="mr-2 flex items-center gap-1.5 text-[12px] text-muted">
        <input type="checkbox" checked={key in own} onChange={(e) => setField(key, e.target.checked ? effective[key] : undefined)} />
        Riêng
      </label>
    )
  const inheritedNote = (key: keyof HandoffSettings): string | null => (lvl !== 'app' && !(key in own) ? `Đang theo ${parentName}.` : null)
  const [drag, setDrag] = useState<number | null>(null)
  const pct = drag ?? effective.handoffPercent
  const commitDrag = (): void => {
    if (drag !== null && drag !== effective.handoffPercent) setField('handoffPercent', drag)
    setDrag(null)
  }

  return (
    <>
      <SectionTitle
        title="Agent & bàn giao"
        desc="Khi context của một phiên agent đạt ngưỡng và agent đang chờ bạn (hết lượt, bạn không gõ phím vài giây), app nhờ agent ghi vault và viết bản bàn giao, rồi đóng phiên và mở phiên mới đọc tiếp từ bản bàn giao đó. Việc đang làm trên kanban vẫn giữ nguyên."
      />
      <ErrorBar error={error} />

      <Group title="Áp dụng cho">
        <Row label="Cấp" desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó. Dấu • = đang có giá trị riêng.">
          <Select label="Cấp cài đặt bàn giao" value={lvl === 'app' ? 'app' : level} onChange={setLevel} options={options} />
        </Row>
      </Group>

      <Group title="Bàn giao khi context gần đầy">
        <Row label="Tự động bàn giao" desc={inheritedNote('autoHandoff')} disabled={lvl !== 'app' && !('autoHandoff' in own)}>
          {overrideToggle('autoHandoff')}
          <Switch
            label="Tự động bàn giao"
            checked={effective.autoHandoff}
            disabled={lvl !== 'app' && !('autoHandoff' in own)}
            onChange={(v) => setField('autoHandoff', v)}
          />
        </Row>
        <Row
          label="Ngưỡng"
          desc={
            inheritedNote('handoffPercent') ??
            `= ${formatTokens((200_000 * pct) / 100)} token với cửa sổ 200k, ${formatTokens((1_000_000 * pct) / 100)} token với cửa sổ 1M. Claude Code tự compact ở khoảng 97% (cửa sổ 1M) nên tối đa là ${HANDOFF_MAX}%.`
          }
          disabled={(lvl !== 'app' && !('handoffPercent' in own)) || !effective.autoHandoff}
        >
          {overrideToggle('handoffPercent')}
          <input
            type="range"
            aria-label="Ngưỡng bàn giao (thanh trượt)"
            min={HANDOFF_MIN}
            max={HANDOFF_MAX}
            step={5}
            value={drag ?? pct}
            disabled={(lvl !== 'app' && !('handoffPercent' in own)) || !effective.autoHandoff}
            // Kéo thì chỉ đổi số trên màn hình, thả tay mới lưu (không ghi file mỗi bước kéo).
            onChange={(e) => setDrag(Number(e.target.value))}
            onPointerUp={commitDrag}
            onKeyUp={commitDrag}
            onBlur={commitDrag}
            className="w-40"
          />
          <Stepper
            label="Ngưỡng bàn giao"
            value={pct}
            min={HANDOFF_MIN}
            max={HANDOFF_MAX}
            step={5}
            suffix="%"
            disabled={(lvl !== 'app' && !('handoffPercent' in own)) || !effective.autoHandoff}
            onChange={(v) => setField('handoffPercent', v)}
          />
        </Row>
      </Group>

      <p className="text-[12px] leading-relaxed text-muted">
        Bàn giao tay bất cứ lúc nào: menu ⋯ của agent ở thanh bên → "Bàn giao sang phiên mới". App đọc % context qua statusLine của
        Claude Code; statusLine riêng của bạn (nếu có) vẫn chạy và hiện như cũ trong phiên agent.
      </p>
    </>
  )
}
