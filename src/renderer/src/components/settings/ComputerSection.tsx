import { useEffect, useState } from 'react'
import { COMPUTER_STOP_HOTKEY_IDS, COMPUTER_STOP_HOTKEYS, COMPUTER_TIERS, type ComputerSettings, type ComputerTier } from '@shared/computer'
import type { PlainKey } from '@shared/i18n'
import { computerToolsOn } from '@shared/settings'
import { useSettings } from '../../store/settings'
import { useComputer } from '../../store/computer'
import { ErrorBar, Group, INPUT_MONO, Row, SectionTitle, Select, SmallButton, Switch, useSaveError } from './controls'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { TierChip } from '../computer/ComputerAskBody'
import { useT } from '../../i18n'

/** Cài đặt → Máy tính: computer use (app.computer) + bật / tắt theo workspace / agent (SettingsOverrides.computer). */
export function ComputerSection(): React.JSX.Element {
  const t = useT()
  const cu = useSettings((s) => s.value.app.computer)
  const save = useSettings((s) => s.save)
  const state = useComputer((s) => s.state)
  const [error, run] = useSaveError()
  const [level, setLevel] = useState<LevelKey>('app')
  const set = (patch: Partial<ComputerSettings>): void => run(save({ computer: patch }))

  return (
    <>
      <SectionTitle title={t('computer.title')} desc={t('computer.desc')} right={<LevelBar level={level} setLevel={setLevel} has={(o) => o?.computer?.agentTools !== undefined} />} />
      <ErrorBar error={error} />
      {state && !state.available && <ErrorBar error={t('computer.unavailable', { error: state.error ?? '' })} />}

      <AgentToolsGroup run={run} level={level} />

      <Group title={t('computer.safetyGroup')}>
        <Row label={t('computer.stopHotkey')} desc={t('computer.stopHotkeyDesc')}>
          <Select
            label={t('computer.stopHotkey')}
            value={cu.stopHotkey}
            onChange={(stopHotkey: ComputerSettings['stopHotkey']) => set({ stopHotkey })}
            options={COMPUTER_STOP_HOTKEY_IDS.map((v) => ({ value: v, label: COMPUTER_STOP_HOTKEYS[v].label }))}
          />
        </Row>
        <Row label={t('computer.minimizeApp')} desc={t('computer.minimizeAppDesc')}>
          <Switch label={t('computer.minimizeApp')} checked={cu.minimizeApp} onChange={(minimizeApp) => set({ minimizeApp })} />
        </Row>
        <Row label={t('computer.pauseOnUser')} desc={t('computer.pauseOnUserDesc')}>
          <Switch label={t('computer.pauseOnUser')} checked={cu.pauseOnUser} onChange={(pauseOnUser) => set({ pauseOnUser })} />
        </Row>
        <Row label={t('computer.screenshotAfter')} desc={t('computer.screenshotAfterDesc')}>
          <Switch label={t('computer.screenshotAfter')} checked={cu.screenshotAfter} onChange={(screenshotAfter) => set({ screenshotAfter })} />
        </Row>
        <p className="px-3 py-2 text-[12px] text-muted">{t('computer.privacy')}</p>
      </Group>

      <TiersGroup tiers={cu.tiers} onSave={(tiers) => set({ tiers })} />
    </>
  )
}

/** "Cho agent điều khiển máy tính" theo cấp: mặc định → workspace → agent. */
function AgentToolsGroup({ run, level: key }: { run: (p: Promise<unknown>) => void; level: LevelKey }): React.JSX.Element {
  const t = useT()
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const level = useLevel(key)
  const own = level.lvl === 'ws' ? settings.workspaces[level.wsId!]?.computer?.agentTools : level.lvl === 'agent' ? settings.agents[level.agentId!]?.computer?.agentTools : undefined
  const parent = level.lvl === 'agent' ? computerToolsOn(settings, level.wsId, null) : settings.app.computer.agentTools
  const setOwn = (v: boolean | undefined): void =>
    run(
      saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, {
        computer: v === undefined ? null : { agentTools: v }
      })
    )
  return (
    <Group title={t('computer.agentGroup')}>
      <Row
        label={t('computer.agentTools')}
        desc={t('computer.agentToolsDesc')}
        override={level.lvl === 'app' ? undefined : { on: own !== undefined, onReset: () => setOwn(undefined), parent: parent ? t('computer.on') : t('computer.off') }}
      >
        {level.lvl === 'app' ? (
          <Switch label={t('computer.agentToolsAll')} checked={settings.app.computer.agentTools} onChange={(agentTools) => run(save({ computer: { agentTools } }))} />
        ) : (
          <Switch label={t('computer.agentToolsFor', { name: level.name })} checked={own ?? parent} onChange={(v) => setOwn(v)} />
        )}
      </Row>
    </Group>
  )
}

const EXE_RE = /^[^\\/:*?"<>|]{1,120}\.exe$/i

/** Bảng mức app người dùng đặt riêng (khoá = tên exe). */
function TiersGroup({ tiers, onSave }: { tiers: Record<string, ComputerTier>; onSave: (v: Record<string, ComputerTier>) => void }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [tier, setTier] = useState<ComputerTier>('full')
  const [bad, setBad] = useState(false)
  const [defaults, setDefaults] = useState<Record<string, { tier: ComputerTier; reason: string }>>({})
  const keys = Object.keys(tiers).sort()

  // Mức mặc định (không tính cài đặt) của các exe đang đặt riêng, để hiện "mặc định: …".
  useEffect(() => {
    let alive = true
    void Promise.all(keys.map(async (k) => [k, await window.stag.computer.tierFor(k).catch(() => null)] as const)).then((rows) => {
      if (!alive) return
      const out: Record<string, { tier: ComputerTier; reason: string }> = {}
      for (const [k, v] of rows) if (v) out[k] = v
      setDefaults(out)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo danh sách khoá
  }, [keys.join('|')])

  const add = (): void => {
    const k = text.trim().toLowerCase()
    if (!EXE_RE.test(k)) return setBad(true)
    setBad(false)
    setText('')
    onSave({ ...tiers, [k]: tier })
  }
  const options = COMPUTER_TIERS.map((v) => ({ value: v, label: t(`computer.tier.${v}` as PlainKey) }))
  return (
    <Group title={t('computer.tiersGroup')}>
      <Row label={t('computer.tierExe')} desc={t('computer.tiersDesc')} sub={bad ? <span className="text-danger">{t('computer.tierExeBad')}</span> : undefined}>
        <input
          aria-label={t('computer.tierExe')}
          value={text}
          placeholder={t('computer.tierPlaceholder')}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setBad(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className={`w-44 ${INPUT_MONO} ${bad ? 'border-danger/60!' : ''}`}
        />
        <Select label={t('computer.tiersGroup')} value={tier} onChange={(v: ComputerTier) => setTier(v)} options={options} />
        <SmallButton icon="plus" onClick={add} disabled={!text.trim()}>
          {t('computer.tierAdd')}
        </SmallButton>
      </Row>
      {keys.map((k) => (
        <Row
          key={k}
          label={<span className="font-mono text-[12px]">{k}</span>}
          sub={defaults[k] ? t('computer.tierDefault', { tier: t(`computer.tier.${defaults[k].tier}` as PlainKey) }) : undefined}
        >
          <TierChip tier={tiers[k]} />
          <Select label={k} value={tiers[k]} onChange={(v: ComputerTier) => onSave({ ...tiers, [k]: v })} options={options} />
          <SmallButton
            onClick={() => {
              const next = { ...tiers }
              delete next[k]
              onSave(next)
            }}
          >
            {t('computer.tierRemove')}
          </SmallButton>
        </Row>
      ))}
    </Group>
  )
}
