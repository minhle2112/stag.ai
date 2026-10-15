import { useEffect, useState } from 'react'
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, type AppMeta, type GeneralSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { ErrorBar, Group, Row, SectionTitle, Select, SmallButton, Stepper, Switch, useSaveError } from './controls'
import { LevelBar } from './levels'
import { useT } from '../../i18n'

const ZOOMS = [70, 80, 90, 100, 110, 125, 150]

export function GeneralSection(): React.JSX.Element {
  const g = useSettings((s) => s.value.app.general)
  const save = useSettings((s) => s.save)
  const t = useT()
  const [error, run] = useSaveError()
  const openSettings = useUi((s) => s.openSettings)
  const [meta, setMeta] = useState<AppMeta | null>(null)
  const [tested, setTested] = useState(false)

  useEffect(() => {
    window.stag.settings.meta().then(setMeta)
  }, [])

  const set = (patch: Partial<GeneralSettings>): void => run(save({ general: patch }))

  async function pickProjectsDir(): Promise<void> {
    const dir = await window.stag.pickFolder(t('settings.general.projectsDirPick'), g.projectsDir || undefined)
    if (dir) set({ projectsDir: dir })
  }

  return (
    <>
      <SectionTitle title={t('settings.general.title')} desc={t('settings.general.desc')} right={<LevelBar appOnly />} />
      <ErrorBar error={error} />

      <Group title={t('settings.general.appearance')}>
        <Row label={t('settings.general.languageTheme')} desc={t('settings.general.languageThemeDesc')}>
          <SmallButton onClick={() => openSettings('appearance')}>{t('settings.general.openAppearance')}</SmallButton>
        </Row>
        <Row label={t('settings.general.zoom')} desc={t('settings.general.zoomDesc')}>
          <Select
            label={t('settings.general.zoom')}
            value={g.zoom}
            onChange={(zoom) => set({ zoom })}
            options={(ZOOMS.includes(g.zoom) ? ZOOMS : [...ZOOMS, g.zoom].sort((a, b) => a - b)).map((z) => ({ value: z, label: `${z}%` }))}
          />
        </Row>
        <Row
          label={t('settings.general.usage')}
          desc={t('settings.general.usageDesc')}
        >
          <Switch label={t('settings.general.usage')} checked={g.claudeUsage} onChange={(claudeUsage) => set({ claudeUsage })} />
        </Row>
      </Group>

      <Group title={t('settings.general.startup')}>
        <Row
          label={t('settings.general.openAtLogin')}
          desc={t('settings.general.openAtLoginDesc')}
          sub={meta && !meta.packaged ? t('settings.general.openAtLoginDev') : undefined}
        >
          <Switch label={t('settings.general.openAtLogin')} checked={g.openAtLogin} onChange={(openAtLogin) => set({ openAtLogin })} />
        </Row>
        <Row label={t('settings.general.reopen')} desc={t('settings.general.reopenDesc')}>
          <Switch label={t('settings.general.reopen')} checked={g.reopenLastWorkspace} onChange={(reopenLastWorkspace) => set({ reopenLastWorkspace })} />
        </Row>
      </Group>

      <Group title={t('settings.general.projects')}>
        <Row
          label={t('settings.general.projectsDir')}
          sub={
            g.projectsDir ? (
              <span className="break-all font-mono text-[11px]">{g.projectsDir}</span>
            ) : (
              t('settings.general.projectsDirUnset')
            )
          }
        >
          {g.projectsDir && <SmallButton onClick={() => set({ projectsDir: '' })}>{t('settings.general.projectsDirClear')}</SmallButton>}
          <SmallButton onClick={() => void pickProjectsDir()}>{t('common.browse')}</SmallButton>
        </Row>
      </Group>

      <Group title={t('settings.general.terminal')}>
        <Row label={t('settings.general.shell')} desc={t('settings.general.shellDesc')}>
          <SmallButton onClick={() => openSettings('adapters', { adapter: 'terminal' })}>{t('common.open')}</SmallButton>
        </Row>
        <Row label={t('settings.general.fontSize')} desc={t('settings.general.fontSizeDesc')}>
          <Stepper
            label={t('settings.general.fontSizeLabel')}
            value={g.terminalFontSize}
            min={TERMINAL_FONT_MIN}
            max={TERMINAL_FONT_MAX}
            onChange={(terminalFontSize) => set({ terminalFontSize })}
            suffix="px"
          />
        </Row>
      </Group>

      <Group title={t('settings.general.notifications')}>
        <Row label={t('settings.general.notifyWaiting')} desc={t('settings.general.notifyWaitingDesc')}>
          <Switch label={t('settings.general.notifyWaitingLabel')} checked={g.notifyWaiting} onChange={(notifyWaiting) => set({ notifyWaiting })} />
        </Row>
        <Row label={t('settings.general.notifyDone')} desc={t('settings.general.notifyDoneDesc')}>
          <Switch label={t('settings.general.notifyDoneLabel')} checked={g.notifyTaskDone} onChange={(notifyTaskDone) => set({ notifyTaskDone })} />
        </Row>
        <Row label={t('settings.general.sound')}>
          <Switch label={t('settings.general.soundLabel')} checked={g.notifySound} onChange={(notifySound) => set({ notifySound })} />
        </Row>
        <Row
          label={t('settings.general.notifyTest')}
          desc={t('settings.general.notifyTestDesc')}
          sub={tested ? t('settings.general.notifyTestSent') : undefined}
        >
          <SmallButton
            onClick={() => {
              setTested(true)
              void window.stag.settings.notifyTest()
            }}
          >
            {t('settings.general.notifyTestBtn')}
          </SmallButton>
        </Row>
      </Group>

      <Group title={t('settings.general.closeWindow')}>
        <Row label={t('settings.general.closeAction')} desc={t('settings.general.closeActionDesc')}>
          <Select
            label={t('settings.general.closeAction')}
            value={g.closeAction}
            onChange={(closeAction) => set({ closeAction })}
            options={[
              { value: 'quit', label: t('settings.general.closeQuit') },
              { value: 'tray', label: t('settings.general.closeTray') }
            ]}
          />
        </Row>
        <Row label={t('settings.general.confirmQuit')} desc={t('settings.general.confirmQuitDesc')}>
          <Switch label={t('settings.general.confirmQuit')} checked={g.confirmQuitRunning} onChange={(confirmQuitRunning) => set({ confirmQuitRunning })} />
        </Row>
      </Group>
    </>
  )
}
