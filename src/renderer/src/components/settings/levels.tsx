import { connectorOn } from '@shared/connectors'
import { skillOn } from '@shared/skills'
import { pluginOn } from '@shared/settings'
import { agentKind, type Settings } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { Group, Row, Select, Switch, useSaveError } from './controls'

/**
 * Cấp áp dụng bật / tắt (Connector, Skill): mặc định cho mọi agent → workspace → agent.
 * Cấp app: công tắc; cấp dưới: theo cấp trên / bật / tắt.
 */

/** 'app' | `ws:<id>` | `agent:<wsId>:<agentId>` */
export type LevelKey = string
/** Mục cài đặt giữ map bật / tắt (SettingsOverrides.connectors / .skills). */
export type ToggleField = 'connectors' | 'skills' | 'plugins'

export interface Level {
  lvl: 'app' | 'ws' | 'agent'
  wsId?: string
  agentId?: string
  name: string
}

export function useLevel(level: LevelKey): Level {
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [kind, wsId, agentId] = level.split(':') as ['app' | 'ws' | 'agent', string?, string?]
  const ws = workspaces.find((w) => w.id === wsId)
  const agent = agentId ? byWs[wsId!]?.agents.find((a) => a.id === agentId) : undefined
  if (kind === 'agent' && ws && agent) return { lvl: 'agent', wsId: ws.id, agentId: agent.id, name: `agent ${agent.name}` }
  if (kind === 'ws' && ws) return { lvl: 'ws', wsId: ws.id, name: `workspace ${ws.name}` }
  return { lvl: 'app', name: 'mọi agent' }
}

/** Khoá cấp của một agent (mở từ menu ⋯ của agent). */
export function useAgentLevel(): (agentId?: string) => LevelKey {
  const byWs = useAgents((s) => s.byWs)
  return (agentId) => {
    if (!agentId) return 'app'
    for (const [wsId, w] of Object.entries(byWs)) if (w.agents.some((a) => a.id === agentId)) return `agent:${wsId}:${agentId}`
    return 'app'
  }
}

export function isOn(field: ToggleField, s: Settings, k: string, workspaceId?: string, agentId?: string): boolean {
  return field === 'connectors' ? connectorOn(s, k, workspaceId, agentId) : field === 'skills' ? skillOn(s, k, workspaceId, agentId) : pluginOn(s, k, workspaceId, agentId)
}

export function LevelPicker({ level, setLevel, field }: { level: LevelKey; setLevel: (l: LevelKey) => void; field: ToggleField }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const cur = useLevel(level)
  const has = (o?: { connectors?: Record<string, boolean>; skills?: Record<string, boolean>; plugins?: Record<string, boolean> }): string => (o?.[field] ? ' •' : '')
  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${has(settings.workspaces[w.id])}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${has(settings.agents[a.id])}` }))
    ])
  ]
  return (
    <Group title="Áp dụng cho">
      <Row
        label="Cấp"
        desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó. Dấu • = có bật / tắt riêng. Phiên đang chạy giữ nguyên, phiên mở sau mới nhận thay đổi."
      >
        <Select label={`Cấp áp dụng ${field === 'connectors' ? 'connector' : field === 'skills' ? 'skill' : 'plugin'}`} value={cur.lvl === 'app' ? 'app' : level} onChange={setLevel} options={options} />
      </Row>
    </Group>
  )
}

/** Công tắc bật / tắt một mục ở cấp đang chọn. `setApp` = cách lưu ở cấp app (connector của stag.ai lưu trong chính nó). */
export function LevelToggle({
  k,
  level,
  label,
  field,
  setApp
}: {
  k: string
  level: Level
  label: string
  field: ToggleField
  setApp: (on: boolean) => Promise<unknown>
}): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const [, run] = useSaveError()
  if (level.lvl === 'app') {
    const on = isOn(field, settings, k)
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Switch label={`${on ? 'Tắt' : 'Bật'} ${label} cho mọi agent`} checked={on} onChange={(v) => run(setApp(v))} />
      </span>
    )
  }
  const own = (level.lvl === 'ws' ? settings.workspaces[level.wsId!] : settings.agents[level.agentId!])?.[field] ?? {}
  const parent = level.lvl === 'agent' ? isOn(field, settings, k, level.wsId) : isOn(field, settings, k)
  const value = k in own ? (own[k] ? 'on' : 'off') : 'inherit'
  const set = (v: 'inherit' | 'on' | 'off'): void => {
    const next = { ...own }
    if (v === 'inherit') delete next[k]
    else next[k] = v === 'on'
    const empty = Object.keys(next).length === 0
    run(
      useSettings
        .getState()
        .saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, { [field]: empty ? null : next })
    )
  }
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Select
        label={`${label} cho ${level.name}`}
        value={value}
        onChange={set}
        options={[
          { value: 'inherit', label: `Theo cấp trên (${parent ? 'bật' : 'tắt'})` },
          { value: 'on', label: 'Bật' },
          { value: 'off', label: 'Tắt' }
        ]}
      />
    </span>
  )
}

/** Đặt bật / tắt ở cấp workspace / agent (giữ các khoá khác). */
export async function setAtLevel(level: Level, field: ToggleField, k: string, on: boolean): Promise<void> {
  if (level.lvl === 'app') return
  const st = useSettings.getState().value
  const own = (level.lvl === 'ws' ? st.workspaces[level.wsId!] : st.agents[level.agentId!])?.[field] ?? {}
  await useSettings
    .getState()
    .saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, { [field]: { ...own, [k]: on } })
}
