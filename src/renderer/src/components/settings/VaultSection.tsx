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
import type { PlainKey } from '@shared/i18n'
import { useSettings } from '../../store/settings'
import { useT } from '../../i18n'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Note, Row, Select, SectionTitle, SmallButton, Stepper, Switch, useSaveError } from './controls'

const TOOL_MODES: Record<MemoryToolsMode, { label: PlainKey; desc: PlainKey }> = {
  full: { label: 'memory.tools.full', desc: 'memory.tools.fullDesc' },
  read: { label: 'memory.tools.read', desc: 'memory.tools.readDesc' },
  off: { label: 'memory.tools.off', desc: 'memory.tools.offDesc' }
}

/**
 * Cài đặt → Vault & bộ nhớ: bộ mẫu vault + app tự ghi nhật ký việc / note agent (xem vault "Memory and work log").
 * Mặc định cho mọi agent → workspace → agent (theo agent làm việc đó). Áp dụng từ việc đóng tiếp theo / phiên mở sau.
 */
export function VaultSection(): React.JSX.Element {
  const t = useT()
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
  const onOff = (v: unknown): string => (v ? t('memory.on') : t('memory.off'))
  const kb = (v: unknown): string => t('memory.kb', { n: String(v) })

  // Nút "Dọn ngay" của _INDEX.md: kết quả hiện ngay dưới nút (đổi cấp thì xoá).
  const [cleaning, setCleaning] = useState(false)
  const [cleanMsg, setCleanMsg] = useState('')
  const [cleanFor, setCleanFor] = useState(key)
  if (cleanFor !== key) {
    setCleanFor(key)
    setCleanMsg('')
  }
  function cleanNow(): void {
    setCleaning(true)
    setCleanMsg('')
    window.stag.vault
      .cleanIndex(level.lvl === 'ws' ? level.wsId! : null)
      .then((list) => {
        const line = (r: (typeof list)[number]): string =>
          r.skipped
            ? t('memory.index.skipped', { name: r.name, reason: r.skipped })
            : r.moved
              ? t('memory.index.moved', { name: r.name, count: r.moved, kb: String(r.kb) })
              : t('memory.index.nothing', { name: r.name, kb: String(r.kb) })
        setCleanMsg(list.length ? list.map(line).join(' · ') : t('memory.index.noWorkspaces'))
      })
      .catch((e: unknown) => setCleanMsg(t('common.errorWith', { message: e instanceof Error ? e.message : String(e) })))
      .finally(() => setCleaning(false))
  }

  return (
    <>
      <SectionTitle
        title={t('memory.title')}
        desc={t('memory.desc')}
        right={<LevelBar level={key} setLevel={setKey} has={(o) => !!o?.memory} />}
      />
      <ErrorBar error={error} />
      <Group title={t('memory.tpl.group')}>
        <Row label={t('memory.tpl.label')} desc={t('memory.tpl.desc')}>
          <SmallButton icon="folder" onClick={() => void window.stag.openTemplates()}>
            {t('memory.tpl.open')}
          </SmallButton>
        </Row>
      </Group>

      <Group title={t('memory.agentTools.group')}>
        <Row
          label={t('memory.agentTools.label')}
          desc={t(TOOL_MODES[effective.agentTools].desc)}
          override={override('agentTools', (v) => t(TOOL_MODES[v as MemoryToolsMode].label))}
        >
          <Select
            label={t('memory.agentTools.label')}
            value={effective.agentTools}
            onChange={(v: MemoryToolsMode) => setField('agentTools', v)}
            options={(Object.keys(TOOL_MODES) as MemoryToolsMode[]).map((v) => ({ value: v, label: t(TOOL_MODES[v].label) }))}
          />
        </Row>
      </Group>

      <Group title={t('memory.workLog.group')}>
        <Row label={t('memory.workLog.label')} desc={t('memory.workLog.desc')} override={override('workLog', onOff)}>
          <Switch label={t('memory.workLog.label')} checked={effective.workLog} onChange={(v) => setField('workLog', v)} />
        </Row>
        <Row label={t('memory.workDone.label')} desc={t('memory.workDone.desc')} override={override('agentWorkDone', onOff)}>
          <Switch label={t('memory.workDone.label')} checked={effective.agentWorkDone} onChange={(v) => setField('agentWorkDone', v)} />
        </Row>
      </Group>

      <Group title={t('memory.note.group')}>
        <Row label={t('memory.note.budget')} desc={t('memory.note.budgetDesc')} override={override('noteBudgetKb', kb)}>
          <Stepper
            label={t('memory.note.budget')}
            value={effective.noteBudgetKb}
            min={NOTE_BUDGET_MIN}
            max={NOTE_BUDGET_MAX}
            suffix="KB"
            onChange={(v) => setField('noteBudgetKb', v)}
          />
        </Row>
        <Row label={t('memory.note.keep')} desc={t('memory.note.keepDesc')} override={override('keepWorkDone', (v) => String(v))}>
          <Stepper
            label={t('memory.note.keepLabel')}
            value={effective.keepWorkDone}
            min={KEEP_WORK_DONE_MIN}
            max={KEEP_WORK_DONE_MAX}
            onChange={(v) => setField('keepWorkDone', v)}
          />
        </Row>
      </Group>

      {level.lvl !== 'agent' && (
        <Group title={t('memory.index.group')}>
          <Row label={t('memory.index.archive')} desc={t('memory.index.archiveDesc')} override={override('indexArchive', onOff)}>
            <Switch label={t('memory.index.archive')} checked={effective.indexArchive} onChange={(v) => setField('indexArchive', v)} />
          </Row>
          {effective.indexArchive && (
            <>
              <Row label={t('memory.index.budget')} desc={t('memory.index.budgetDesc')} override={override('indexBudgetKb', kb)}>
                <Stepper
                  label={t('memory.index.budget')}
                  value={effective.indexBudgetKb}
                  min={INDEX_BUDGET_MIN}
                  max={INDEX_BUDGET_MAX}
                  suffix="KB"
                  onChange={(v) => setField('indexBudgetKb', v)}
                />
              </Row>
              <Row
                label={t('memory.index.keepDays')}
                desc={t('memory.index.keepDaysDesc')}
                override={override('indexKeepDays', (v) => t('memory.days', { count: Number(v) }))}
              >
                <Stepper
                  label={t('memory.index.keepDays')}
                  value={effective.indexKeepDays}
                  min={INDEX_KEEP_DAYS_MIN}
                  max={INDEX_KEEP_DAYS_MAX}
                  suffix={t('memory.daysSuffix')}
                  onChange={(v) => setField('indexKeepDays', v)}
                />
              </Row>
              <Row
                label={t('memory.index.clean')}
                desc={level.lvl === 'ws' ? t('memory.index.cleanDescWs') : t('memory.index.cleanDescAll')}
                sub={cleanMsg || undefined}
              >
                <SmallButton onClick={cleanNow} disabled={cleaning}>
                  {cleaning ? t('memory.index.cleaning') : level.lvl === 'ws' ? t('memory.index.clean') : t('memory.index.cleanAll')}
                </SmallButton>
              </Row>
            </>
          )}
        </Group>
      )}
      <Note>{t('memory.note')}</Note>
    </>
  )
}
