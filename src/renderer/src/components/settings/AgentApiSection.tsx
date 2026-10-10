import { useState } from 'react'
import { resolveAgentApi } from '@shared/settings'
import { agentKind, type AgentApiSettings } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Row, SectionTitle, Select, Switch, useSaveError } from './controls'

const ITEMS: Array<{ key: keyof AgentApiSettings; label: string; desc: string }> = [
  {
    key: 'manage',
    label: 'Cho agent quản lý agent khác',
    desc: 'Bạn nhắn agent "tạo agent tên…, dùng model…, làm việc…" là nó làm được: tạo, đổi tên / vai trò / model / quyền, mở, dừng, xoá agent (agent_create, agent_update, agent_open, agent_stop, agent_delete). Dừng, xoá, đổi quyền luôn hỏi bạn trước.'
  },
  {
    key: 'message',
    label: 'Cho agent nhắn agent khác',
    desc: 'agent_send: app gõ tin vào ô của agent nhận khi nó rảnh và bạn không đang gõ ở đó; tin ghi rõ là từ agent, không phải từ bạn. Có giới hạn số tin để hai agent không nhắn qua lại mãi.'
  },
  {
    key: 'confirmCreate',
    label: 'Hỏi bạn trước khi agent tạo agent mới',
    desc: 'Hiện thẻ xác nhận (tên, loại, model, quyền, việc đầu tiên). Tắt thì agent tạo luôn, trừ khi agent mới được quyền cao hơn agent tạo nó — lúc đó vẫn hỏi.'
  }
]

/**
 * Cài đặt → Agent API: agent làm thay bạn trên app (xem vault "Agent API"). Mặc định cho mọi agent → workspace → agent.
 * Đổi có tác dụng ngay với lần gọi tool sau; luật phiên (agent biết có tool nào) theo từ phiên sau.
 */
export function AgentApiSection(): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [key, setKey] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const level = useLevel(key)

  const mark = (o?: { agentApi?: Partial<AgentApiSettings> }): string => (o?.agentApi ? ' •' : '')
  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${mark(settings.workspaces[w.id])}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${mark(settings.agents[a.id])}` }))
    ])
  ]

  const own: Partial<AgentApiSettings> =
    level.lvl === 'ws' ? (settings.workspaces[level.wsId!]?.agentApi ?? {}) : level.lvl === 'agent' ? (settings.agents[level.agentId!]?.agentApi ?? {}) : {}
  const parent = level.lvl === 'agent' ? resolveAgentApi(settings, level.wsId, null) : settings.app.agentApi

  function setOwn(k: keyof AgentApiSettings, v: 'inherit' | 'on' | 'off'): void {
    const next = { ...own }
    if (v === 'inherit') delete next[k]
    else next[k] = v === 'on'
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
        desc="Agent dùng app thay bạn qua các tool agent_* của máy chủ MCP stag. Agent luôn xem được danh sách agent và các loại / model có trên máy (agent_list, adapter_models). Chỉ nên đồng ý những gì chính bạn đã nhờ agent làm."
      />
      <ErrorBar error={error} />
      <Group title="Áp dụng cho">
        <Row label="Cấp" desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó (theo agent đang gọi tool). Dấu • = có cài đặt riêng.">
          <Select label="Cấp cài đặt Agent API" value={level.lvl === 'app' ? 'app' : key} onChange={setKey} options={options} />
        </Row>
      </Group>
      <Group title="Agent được làm gì">
        {ITEMS.map((it) => (
          <Row key={it.key} label={it.label} desc={it.desc}>
            {level.lvl === 'app' ? (
              <Switch label={it.label} checked={settings.app.agentApi[it.key]} onChange={(v) => run(save({ agentApi: { [it.key]: v } }))} />
            ) : (
              <Select
                label={`${it.label} — ${level.name}`}
                value={own[it.key] === undefined ? 'inherit' : own[it.key] ? 'on' : 'off'}
                onChange={(v) => setOwn(it.key, v)}
                options={[
                  { value: 'inherit', label: `Theo cấp trên (${parent[it.key] ? 'bật' : 'tắt'})` },
                  { value: 'on', label: 'Bật' },
                  { value: 'off', label: 'Tắt' }
                ]}
              />
            )}
          </Row>
        ))}
      </Group>
      <p className="mt-3 px-1 text-[12px] leading-relaxed text-muted">
        Tắt một nhóm: phiên mở sau không thấy các tool đó; phiên đang chạy gọi tới thì bị từ chối ngay. Agent biết có các tool này qua luật phiên, cập nhật từ
        phiên mới tiếp theo.
      </p>
    </>
  )
}
