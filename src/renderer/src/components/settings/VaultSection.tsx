import { useState } from 'react'
import { resolveMemory } from '@shared/settings'
import {
  INDEX_BUDGET_MAX,
  INDEX_BUDGET_MIN,
  INDEX_KEEP_DAYS_MAX,
  INDEX_KEEP_DAYS_MIN,
  KEEP_WORK_DONE_MAX,
  KEEP_WORK_DONE_MIN,
  NOTE_BUDGET_MAX,
  NOTE_BUDGET_MIN,
  type MemorySettings,
  type MemoryToolsMode
} from '@shared/types'
import { useSettings } from '../../store/settings'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Note, Row, Select, SectionTitle, SmallButton, Stepper, Switch, useSaveError } from './controls'

const TOOL_MODES: Record<MemoryToolsMode, { label: string; desc: string }> = {
  full: { label: 'Đọc và ghi', desc: 'Agent đọc, tìm, sửa, đổi tên note qua app (memory_read, memory_search, memory_patch, memory_move…). App chặn ghi bí mật và không cho ghi đè thay đổi của người khác.' },
  read: { label: 'Chỉ đọc', desc: 'Agent đọc và tìm qua app; muốn ghi thì agent tự sửa file note như trước.' },
  off: { label: 'Tắt', desc: 'Không có tool memory_*: agent tự đọc / sửa file trong vault bằng công cụ file của nó.' }
}

/**
 * Cài đặt → Vault & bộ nhớ: bộ mẫu vault + app tự ghi nhật ký việc / note agent (xem vault "Memory and work log").
 * Mặc định cho mọi agent → workspace → agent (theo agent làm việc đó). Áp dụng từ việc đóng tiếp theo / phiên mở sau.
 */
export function VaultSection(): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const [key, setKey] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const level = useLevel(key)

  const own: Partial<MemorySettings> =
    level.lvl === 'ws' ? (settings.workspaces[level.wsId!]?.memory ?? {}) : level.lvl === 'agent' ? (settings.agents[level.agentId!]?.memory ?? {}) : settings.app.memory
  const parent = level.lvl === 'agent' ? resolveMemory(settings, level.wsId, null) : settings.app.memory
  const effective: MemorySettings = { ...parent, ...own }

  function setField<K extends keyof MemorySettings>(k: K, v: MemorySettings[K] | undefined): void {
    if (level.lvl === 'app') {
      if (v !== undefined) run(save({ memory: { [k]: v } }))
      return
    }
    const next = { ...own }
    if (v === undefined) delete next[k]
    else next[k] = v
    run(
      saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, {
        memory: Object.keys(next).length ? next : null
      })
    )
  }

  /** Dòng đang ghi đè ở cấp workspace / agent: chấm teal, bấm để theo cấp trên. */
  const override = (k: keyof MemorySettings, fmt: (v: MemorySettings[keyof MemorySettings]) => string): { on: boolean; onReset: () => void; parent: string } | undefined =>
    level.lvl === 'app' ? undefined : { on: k in own, onReset: () => setField(k, undefined), parent: fmt(parent[k]) }
  const onOff = (v: unknown): string => (v ? 'bật' : 'tắt')

  return (
    <>
      <SectionTitle
        title="Vault & bộ nhớ"
        desc="Mỗi workspace có một vault (thư mục note markdown) làm bộ nhớ, tạo từ bộ mẫu dưới đây. Agent đọc / sửa vault qua tool của app; app tự ghi việc agent làm xong vào vault, và giữ note riêng của từng agent gọn trong hạn mức."
        right={<LevelBar level={key} setLevel={setKey} has={(o) => !!o?.memory} />}
      />
      <ErrorBar error={error} />
      <Group title="Mẫu">
        <Row label="Template vault" desc="Cấu trúc vault, CLAUDE.md, luật phiên của agent. Sửa bản trong thư mục này sẽ thay bản có sẵn của app (theo từng file).">
          <SmallButton icon="folder" onClick={() => void window.stag.openTemplates()}>
            Mở thư mục mẫu
          </SmallButton>
        </Row>
      </Group>

      <Group title="Tool bộ nhớ cho agent">
        <Row label="Agent dùng vault qua app" desc={TOOL_MODES[effective.agentTools].desc} override={override('agentTools', (v) => TOOL_MODES[v as MemoryToolsMode].label)}>
          <Select
            label="Agent dùng vault qua app"
            value={effective.agentTools}
            onChange={(v: MemoryToolsMode) => setField('agentTools', v)}
            options={(Object.keys(TOOL_MODES) as MemoryToolsMode[]).map((v) => ({ value: v, label: TOOL_MODES[v].label }))}
          />
        </Row>
      </Group>

      <Group title="Nhật ký việc">
        <Row
          label="Ghi việc xong vào nhật ký ngày"
          desc={`Mỗi việc agent làm xong (task_done), giao cho agent khác (agent_handoff) hoặc bạn đánh dấu xong trên kanban → một dòng trong 40 Log/<ngày>.md của vault, mục "Agent work (auto)": tên việc, agent, giờ, một dòng tiếng Anh agent viết, phạm vi. Chỉ ghi vào vault có cấu trúc của stag.ai.`}
          override={override('workLog', onOff)}
        >
          <Switch label="Ghi việc xong vào nhật ký ngày" checked={effective.workLog} onChange={(v) => setField('workLog', v)} />
        </Row>
        <Row
          label='Ghi vào mục "Work done" của note agent'
          desc={`Cùng lúc đó thêm một dòng vào mục "Work done" trong 60 Agents/<tên agent>.md, để agent nhớ mình đã làm gì.`}
          override={override('agentWorkDone', onOff)}
        >
          <Switch label='Ghi vào mục "Work done" của note agent' checked={effective.agentWorkDone} onChange={(v) => setField('agentWorkDone', v)} />
        </Row>
      </Group>

      <Group title="Note bộ nhớ của agent">
        <Row
          label="Hạn mức note"
          desc={`Note quá hạn mức → app chuyển các dòng "Work done" cũ sang 60 Agents/<tên> archive.md (không tốn quota). Vẫn quá thì phiên sau agent được nhờ tự viết gọn phần còn lại.`}
          override={override('noteBudgetKb', (v) => `${v} KB`)}
        >
          <Stepper
            label="Hạn mức note"
            value={effective.noteBudgetKb}
            min={NOTE_BUDGET_MIN}
            max={NOTE_BUDGET_MAX}
            suffix="KB"
            onChange={(v) => setField('noteBudgetKb', v)}
          />
        </Row>
        <Row
          label='Giữ lại bao nhiêu dòng "Work done"'
          desc="Khi cất, giữ lại chừng này dòng mới nhất trong note."
          override={override('keepWorkDone', (v) => String(v))}
        >
          <Stepper
            label='Số dòng "Work done" giữ lại'
            value={effective.keepWorkDone}
            min={KEEP_WORK_DONE_MIN}
            max={KEEP_WORK_DONE_MAX}
            onChange={(v) => setField('keepWorkDone', v)}
          />
        </Row>
      </Group>

      {level.lvl !== 'agent' && (
        <Group title="_INDEX.md của vault">
          <Row
            label="Dời mục đã xong cũ ra khỏi _INDEX"
            desc={`_INDEX.md được mọi phiên agent đọc đầu tiên. Khi nó quá hạn mức, app chuyển các mục đã xong ("- [x]") cũ trong mục "Open items" sang _INDEX archive.md (trong 00 Meta/), nhóm theo ngày. Mục chưa xong ("- [ ]") luôn ở lại. Theo app → workspace.`}
            override={override('indexArchive', onOff)}
          >
            <Switch label="Dời mục đã xong cũ ra khỏi _INDEX" checked={effective.indexArchive} onChange={(v) => setField('indexArchive', v)} />
          </Row>
          {effective.indexArchive && (
            <>
              <Row label="Hạn mức _INDEX" desc="Chỉ dời khi _INDEX.md lớn hơn chừng này." override={override('indexBudgetKb', (v) => `${v} KB`)}>
                <Stepper
                  label="Hạn mức _INDEX"
                  value={effective.indexBudgetKb}
                  min={INDEX_BUDGET_MIN}
                  max={INDEX_BUDGET_MAX}
                  suffix="KB"
                  onChange={(v) => setField('indexBudgetKb', v)}
                />
              </Row>
              <Row
                label="Giữ mục đã xong (ngày)"
                desc="Mục đã xong có ngày (YYYY-MM-DD) mới nhất ghi trong mục nằm trong chừng này ngày thì vẫn giữ trong _INDEX. Mục không ghi ngày nào coi là cũ."
                override={override('indexKeepDays', (v) => `${v} ngày`)}
              >
                <Stepper
                  label="Giữ mục đã xong (ngày)"
                  value={effective.indexKeepDays}
                  min={INDEX_KEEP_DAYS_MIN}
                  max={INDEX_KEEP_DAYS_MAX}
                  suffix="ngày"
                  onChange={(v) => setField('indexKeepDays', v)}
                />
              </Row>
            </>
          )}
        </Group>
      )}
      <Note>
        Agent không tự ghi lại dòng &quot;xong việc&quot; nữa, chỉ ghi điều đáng nhớ (quyết định, lỗi gặp, bài học). Hạn mức note được kiểm khi phiên agent mở và sau
        mỗi việc xong. Đổi chế độ tool bộ nhớ có tác dụng từ phiên agent mở sau (phiên đang chạy gọi tool đã tắt thì nhận lỗi).
      </Note>
    </>
  )
}
