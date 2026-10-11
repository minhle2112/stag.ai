import { useState } from 'react'
import { resolveAgentApi } from '@shared/settings'
import { type AgentApiSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Note, Row, SectionTitle, Switch, useSaveError } from './controls'

const ITEMS: Array<{ key: keyof AgentApiSettings; label: string; desc: string }> = [
  {
    key: 'manage',
    label: 'Cho agent quản lý agent khác',
    desc: 'Bạn nhắn agent "tạo agent tên…, dùng model…, làm việc…" là nó làm được: tạo, đổi tên / vai trò / model / quyền, mở, dừng, xoá agent (agent_create, agent_update, agent_open, agent_stop, agent_delete). Dừng, xoá, đổi quyền luôn hỏi bạn trước.'
  },
  {
    key: 'message',
    label: 'Cho agent nhắn agent khác',
    desc: 'agent_send: app gõ tin vào ô của agent nhận khi nó rảnh và bạn không đang gõ ở đó; tin ghi rõ là từ agent, không phải từ bạn. Có giới hạn số tin để hai agent không nhắn qua lại mãi. Gồm cả agent_handoff: giao việc đang làm cho agent khác (thẻ việc + phạm vi chuyển sang agent nhận, bản bàn giao gõ vào ô của nó; agent nhận chưa chạy thì mở phiên mới, việc này cần thêm quyền quản lý agent).'
  },
  {
    key: 'read',
    label: 'Cho agent đọc trạng thái và nhật ký phiên của agent khác',
    desc: 'agent_status: agent kia đang làm gì, % context, việc đang mở, việc xong gần nhất. agent_log: các lượt mới nhất trong phiên của agent kia (lời bạn, lời agent, lỗi, tuỳ chọn cả tool đã gọi), đã che key / token; không đọc đầu ra thô của terminal. Chỉ trong cùng workspace.'
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
  const [key, setKey] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const level = useLevel(key)

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
        desc="Agent dùng app thay bạn qua các tool agent_* của máy chủ MCP stag. Agent luôn xem được danh sách agent và các loại / model có trên máy (agent_list, adapter_models). Chỉ nên đồng ý những gì chính bạn đã nhờ agent làm."
        right={<LevelBar level={key} setLevel={setKey} has={(o) => !!o?.agentApi} />}
      />
      <ErrorBar error={error} />
      <Group>
        {ITEMS.map((it) => (
          <Row
            key={it.key}
            label={it.label}
            desc={it.desc}
            override={
              level.lvl === 'app' ? undefined : { on: own[it.key] !== undefined, onReset: () => setOwn(it.key, undefined), parent: parent[it.key] ? 'bật' : 'tắt' }
            }
          >
            {level.lvl === 'app' ? (
              <Switch label={it.label} checked={settings.app.agentApi[it.key]} onChange={(v) => run(save({ agentApi: { [it.key]: v } }))} />
            ) : (
              <Switch label={`${it.label} — ${level.name}`} checked={own[it.key] ?? parent[it.key]} onChange={(v) => setOwn(it.key, v)} />
            )}
          </Row>
        ))}
      </Group>
      <Note>
        Tắt một nhóm: phiên mở sau không thấy các tool đó; phiên đang chạy gọi tới thì bị từ chối ngay. Agent biết có các tool này qua luật phiên, cập nhật từ
        phiên mới tiếp theo.
      </Note>
    </>
  )
}
