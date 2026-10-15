import { useState } from 'react'
import { resolveAgentApi } from '@shared/settings'
import { type AgentApiSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Note, Row, SectionTitle, Switch, useSaveError } from './controls'
import type { PlainKey } from '@shared/i18n'
import { useT } from '../../i18n'

const ITEMS: Array<{ key: keyof AgentApiSettings; label: PlainKey; desc: PlainKey }> = [
  { key: 'manage', label: 'agentApi.manage', desc: 'agentApi.manageDesc' },
  { key: 'message', label: 'agentApi.message', desc: 'agentApi.messageDesc' },
  { key: 'read', label: 'agentApi.read', desc: 'agentApi.readDesc' },
  { key: 'confirmCreate', label: 'agentApi.confirmCreate', desc: 'agentApi.confirmCreateDesc' }
]

/**
 * Cài đặt → Agent API: agent làm thay bạn trên app (xem vault "Agent API"). Mặc định cho mọi agent → workspace → agent.
 * Đổi có tác dụng ngay với lần gọi tool sau; luật phiên (agent biết có tool nào) theo từ phiên sau.
 */
export function AgentApiSection(): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const [key, setKey] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const level = useLevel(key)
  const t = useT()

  const own: Partial<AgentApiSettings> =
    level.lvl === 'ws' ? (settings.workspaces[level.wsId!]?.agentApi ?? {}) : level.lvl === 'agent' ? (settings.agents[level.agentId!]?.agentApi ?? {}) : {}
  const parent = level.lvl === 'agent' ? resolveAgentApi(settings, level.wsId, null) : settings.app.agentApi

  function setOwn(k: keyof AgentApiSettings, v: boolean | undefined): void {
    const next = { ...own }
    if (v === undefined) delete next[k]
    else next[k] = v
    run(
      saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, {
        agentApi: Object.keys(next).length ? next : null
      })
    )
  }

  return (
    <>
      <SectionTitle
        title="Agent API"
        desc={t('agentApi.desc')}
        right={<LevelBar level={key} setLevel={setKey} has={(o) => !!o?.agentApi} />}
      />
      <ErrorBar error={error} />
      <Group>
        {ITEMS.map((it) => (
          <Row
            key={it.key}
            label={t(it.label)}
            desc={t(it.desc)}
            override={
              level.lvl === 'app' ? undefined : { on: own[it.key] !== undefined, onReset: () => setOwn(it.key, undefined), parent: parent[it.key] ? t('common.on').toLowerCase() : t('common.off').toLowerCase() }
            }
          >
            {level.lvl === 'app' ? (
              <Switch label={t(it.label)} checked={settings.app.agentApi[it.key]} onChange={(v) => run(save({ agentApi: { [it.key]: v } }))} />
            ) : (
              <Switch label={`${t(it.label)} — ${level.name}`} checked={own[it.key] ?? parent[it.key]} onChange={(v) => setOwn(it.key, v)} />
            )}
          </Row>
        ))}
      </Group>
      <Note>{t('agentApi.note')}</Note>
    </>
  )
}
