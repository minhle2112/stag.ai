import { connectorOn } from '@shared/connectors'
import { skillOn } from '@shared/skills'
import { pluginOn } from '@shared/settings'
import { agentKind, type Agent, type Settings, type SettingsOverrides } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { Seg } from '../ui/Seg'
import { OverrideSwitch, Select, Switch, useSaveError } from './controls'
import { t } from '../../i18n'

/**
 * Cấp áp dụng bật / tắt (Connector, Skill, Plugin…): mặc định cho mọi agent → workspace → agent.
 * Cấp app: công tắc; cấp dưới: công tắc hiện giá trị đang có hiệu lực, chấm teal = đã ghi đè ở cấp đó (bấm để theo cấp trên).
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
  if (kind === 'agent' && ws && agent) return { lvl: 'agent', wsId: ws.id, agentId: agent.id, name: t('settings.level.agentName', { name: agent.name }) }
  if (kind === 'ws' && ws) return { lvl: 'ws', wsId: ws.id, name: t('settings.level.workspaceName', { name: ws.name }) }
  return { lvl: 'app', name: t('settings.level.allAgents') }
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

const levelOptions = (): Array<{ value: 'app' | 'ws' | 'agent'; label: string; tip: string }> => [
  { value: 'app', label: 'App', tip: t('settings.level.appTip') },
  { value: 'ws', label: 'Workspace', tip: t('settings.level.wsTip') },
  { value: 'agent', label: 'Agent', tip: t('settings.level.agentTip') }
]

/**
 * Công tắc cấp ở bên phải tiêu đề trang: [● ghi đè] [ô chọn workspace / agent] [App | Workspace | Agent].
 * Ô chọn luôn giữ chỗ (ẩn ở cấp App) nên bố cục không nhảy. `appOnly` = mục chỉ đặt ở cấp App (công tắc mờ, không bấm được).
 */
export function LevelBar({
  level = 'app',
  setLevel,
  field,
  has,
  agentFilter,
  appOnly
}: {
  level?: LevelKey
  setLevel?: (l: LevelKey) => void
  /** Mục bật / tắt (dùng để đánh dấu • ở workspace / agent đang có ghi đè). */
  field?: ToggleField
  /** Cách khác để biết workspace / agent có ghi đè mục này không. */
  has?: (o: SettingsOverrides | undefined) => boolean
  /** Chỉ cho chọn một số agent (vd. chỉ agent Claude Code khi sửa model của Claude). */
  agentFilter?: (a: Agent) => boolean
  appOnly?: boolean
}): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const workspaces = useWorkspaces((s) => s.items)
  const activeWs = useWorkspaces((s) => s.activeId)
  const byWs = useAgents((s) => s.byWs)
  const cur = useLevel(level)

  if (appOnly || !setLevel) {
    return (
      <span data-tip={t('settings.level.appOnlyTip')} className="inline-flex shrink-0">
        <Seg className="pointer-events-none opacity-45" value="app" onChange={() => {}} options={levelOptions().map(({ value, label }) => ({ value, label }))} />
      </span>
    )
  }

  const marked = (o?: SettingsOverrides): boolean => (has ? has(o) : field ? !!o?.[field] : false)
  const agentsOf = (wsId: string): Agent[] => (byWs[wsId]?.agents ?? []).filter((a) => agentKind(a) !== 'terminal' && (!agentFilter || agentFilter(a)))
  const multi = workspaces.length > 1
  const wsOptions = workspaces.map((w) => ({ value: `ws:${w.id}`, label: `${w.name}${marked(settings.workspaces[w.id]) ? ' •' : ''}` }))
  const agentOptions = workspaces.flatMap((w) =>
    agentsOf(w.id).map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `${a.name}${multi ? ` · ${w.name}` : ''}${marked(settings.agents[a.id]) ? ' •' : ''}` }))
  )

  const pick = (k: 'app' | 'ws' | 'agent'): void => {
    if (k === 'app') return setLevel('app')
    const wsId = cur.wsId ?? (workspaces.some((w) => w.id === activeWs) ? activeWs! : workspaces[0]?.id)
    if (!wsId) return
    if (k === 'ws') return setLevel(`ws:${wsId}`)
    const here = agentsOf(wsId)
    const a = here.find((x) => x.id === cur.agentId) ?? here[0]
    if (a) return setLevel(`agent:${wsId}:${a.id}`)
    const other = workspaces.flatMap((w) => agentsOf(w.id).map((x) => [w.id, x.id] as const))[0]
    if (other) setLevel(`agent:${other[0]}:${other[1]}`)
  }

  const value = cur.lvl === 'ws' ? `ws:${cur.wsId}` : cur.lvl === 'agent' ? `agent:${cur.wsId}:${cur.agentId}` : ''
  return (
    <span className="flex shrink-0 items-center gap-2 text-[12px] font-normal">
      <span
        data-tip={t('settings.level.overriddenTip')}
        className={`inline-flex cursor-help items-center gap-1 text-[11px] text-dim ${cur.lvl === 'app' ? 'invisible' : ''}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        {t('settings.level.overridden')}
      </span>
      <span className={cur.lvl === 'app' ? 'invisible' : ''}>
        <Select
          compact
          className="w-36"
          label={cur.lvl === 'agent' ? t('settings.level.pickAgent') : t('settings.level.pickWorkspace')}
          value={value}
          onChange={setLevel}
          options={cur.lvl === 'agent' ? agentOptions : wsOptions}
        />
      </span>
      <span data-tip={t('settings.level.cascadeTip')}>
        <Seg value={cur.lvl} onChange={pick} options={levelOptions()} />
      </span>
    </span>
  )
}

/** Giữ tên cũ: chọn cấp áp dụng cho một mục bật / tắt. Đặt vào `right` của SectionTitle. */
export function LevelPicker({ level, setLevel, field }: { level: LevelKey; setLevel: (l: LevelKey) => void; field: ToggleField }): React.JSX.Element {
  return <LevelBar level={level} setLevel={setLevel} field={field} />
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
        <Switch label={t(on ? 'settings.level.toggleOffAll' : 'settings.level.toggleOnAll', { label })} checked={on} onChange={(v) => run(setApp(v))} />
      </span>
    )
  }
  const own = (level.lvl === 'ws' ? settings.workspaces[level.wsId!] : settings.agents[level.agentId!])?.[field] ?? {}
  const parent = level.lvl === 'agent' ? isOn(field, settings, k, level.wsId) : isOn(field, settings, k)
  const set = (v: boolean | undefined): void => {
    const next = { ...own }
    if (v === undefined) delete next[k]
    else next[k] = v
    const empty = Object.keys(next).length === 0
    run(
      useSettings
        .getState()
        .saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, { [field]: empty ? null : next })
    )
  }
  return <OverrideSwitch own={k in own ? own[k] : undefined} inherited={parent} onChange={set} label={`${label} cho ${level.name}`} />
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
