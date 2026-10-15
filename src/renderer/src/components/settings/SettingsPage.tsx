import { useEffect, useState } from 'react'
import type { AppMeta } from '@shared/types'
import { useUi, type SettingsSection } from '../../store/ui'
import { useApprovals } from '../../store/approvals'
import { Icon, type IconName } from '../Icon'
import { Group, Row, SectionTitle, SmallButton } from './controls'
import { AdaptersSection } from './AdaptersSection'
import { ConnectorsSection } from './ConnectorsSection'
import { SecretsSection } from './SecretsSection'
import { PasswordsSection } from './PasswordsSection'
import { SkillsSection } from './SkillsSection'
import { PluginsSection } from './PluginsSection'
import { GeneralSection } from './GeneralSection'
import { AppearanceSection } from './AppearanceSection'
import { HandoffSection } from './HandoffSection'
import { ScopeSection } from './ScopeSection'
import { AgentApiSection } from './AgentApiSection'
import { BrowserSection } from './BrowserSection'
import { ComputerSection } from './ComputerSection'
import { VoiceSection } from './VoiceSection'
import { VaultSection } from './VaultSection'
import { useT } from '../../i18n'
import type { PlainKey } from '@shared/i18n'

interface NavItem {
  id: SettingsSection
  label: PlainKey
  icon: IconName
  /** Chưa làm: hiện nhãn "sắp có" và trang mô tả. */
  soon?: string
}

/** Menu trái theo thứ tự đã chốt: Chung đầu tiên (xem vault: Settings). Mỗi mảng là một nhóm. */
const NAV: NavItem[][] = [
  [
    { id: 'general', label: 'settings.nav.general', icon: 'gear' },
    { id: 'appearance', label: 'settings.nav.appearance', icon: 'palette' },
    { id: 'voice', label: 'settings.nav.voice', icon: 'mic' }
  ],
  [
    { id: 'adapters', label: 'settings.nav.adapters', icon: 'term' },
    { id: 'connectors', label: 'settings.nav.connectors', icon: 'conn' },
    { id: 'skills', label: 'settings.nav.skills', icon: 'book' },
    { id: 'plugins', label: 'settings.nav.plugins', icon: 'plug' },
    { id: 'secrets', label: 'settings.nav.secrets', icon: 'key' },
    { id: 'passwords', label: 'settings.nav.passwords', icon: 'shield' }
  ],
  [
    { id: 'handoff', label: 'settings.nav.handoff', icon: 'bot' },
    { id: 'vault', label: 'settings.nav.vault', icon: 'vault' },
    { id: 'scope', label: 'settings.nav.scope', icon: 'lock' },
    { id: 'agentApi', label: 'settings.nav.agentApi', icon: 'code' },
    { id: 'browser', label: 'settings.nav.browser', icon: 'globe' },
    { id: 'computer', label: 'settings.nav.computer', icon: 'monitor' }
  ],
  [
    { id: 'data', label: 'settings.nav.data', icon: 'folder' },
    { id: 'about', label: 'settings.nav.about', icon: 'info' }
  ]
]

/** Mô tả các mục chưa làm (theo kế hoạch Settings đã chốt 2026-10-09). */
/** Mục chưa làm (nav có `soon`): tiêu đề + các ý dự kiến. */
const SOON: Partial<Record<SettingsSection, { title: string; points: string[] }>> = {}

export function SettingsPage(): React.JSX.Element {
  const t = useT()
  const section = useUi((s) => s.settings) ?? 'general'
  const open = useUi((s) => s.openSettings)
  const close = useUi((s) => s.closeSettings)
  const pending = useApprovals((s) => s.items.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hộp thoại khác đang mở phía trên thì để nó xử lý Esc.
      if (e.key === 'Escape' && useUi.getState().modals === 0 && !useUi.getState().palette) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="absolute inset-0 z-10 flex bg-bg" role="region" aria-label={t('settings.page.aria')}>
      <nav className="flex w-[200px] shrink-0 flex-col border-r border-line bg-bg">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {NAV.map((group, i) => (
            <div key={i} className={i ? 'mt-2 border-t border-line pt-2' : ''}>
              {group.map((item) => (
                <button
                  key={item.id}
                  onClick={() => open(item.id)}
                  className={`flex w-full items-center gap-2 rounded-[5px] px-2.5 py-[5px] text-left ${
                    section === item.id ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'
                  }`}
                >
                  <Icon name={item.icon} className={section === item.id ? 'text-fg' : 'text-dim'} />
                  <span className="flex-1">{t(item.label)}</span>
                  {item.soon && <span className="rounded bg-line/60 px-1.5 text-[11px] text-muted">{t('settings.page.soon')}</span>}
                  {item.id === 'connectors' && pending > 0 && (
                    <span className="rounded-full bg-wait px-1.5 text-[11px] font-semibold text-wait-on" data-tip={t('settings.page.pendingTip')}>
                      {pending}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto ${section === 'connectors' || section === 'skills' || section === 'plugins' || section === 'passwords' ? 'max-w-[1000px]' : 'max-w-[760px]'} select-text px-8 pt-[18px] pb-10`}
        >
          <Section id={section} />
        </div>
      </main>
    </div>
  )
}

function Section({ id }: { id: SettingsSection }): React.JSX.Element {
  switch (id) {
    case 'general':
      return <GeneralSection />
    case 'appearance':
      return <AppearanceSection />
    case 'adapters':
      return <AdaptersSection />
    case 'connectors':
      return <ConnectorsSection />
    case 'skills':
      return <SkillsSection />
    case 'plugins':
      return <PluginsSection />
    case 'secrets':
      return <SecretsSection />
    case 'passwords':
      return <PasswordsSection />
    case 'handoff':
      return <HandoffSection />
    case 'scope':
      return <ScopeSection />
    case 'agentApi':
      return <AgentApiSection />
    case 'browser':
      return <BrowserSection />
    case 'computer':
      return <ComputerSection />
    case 'voice':
      return <VoiceSection />
    case 'vault':
      return <VaultSection />
    case 'data':
      return <DataSection />
    case 'about':
      return <AboutSection />
    default:
      return <SoonSection id={id} />
  }
}

function SoonSection({ id }: { id: SettingsSection }): React.JSX.Element {
  const t = useT()
  const info = SOON[id]
  const stage = NAV.flat().find((n) => n.id === id)?.soon
  return (
    <>
      <SectionTitle title={info?.title ?? id} desc={t('settings.page.soonDesc', { stage: stage ?? '' })} />
      <div className="rounded-lg border border-dashed border-line-2 px-5 py-4">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
          {info?.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

function useMeta(): AppMeta | null {
  const [meta, setMeta] = useState<AppMeta | null>(null)
  useEffect(() => {
    window.stag.settings.meta().then(setMeta)
  }, [])
  return meta
}

function DataSection(): React.JSX.Element {
  const t = useT()
  const meta = useMeta()
  return (
    <>
      <SectionTitle title={t('settings.nav.data')} desc={t('settings.data.desc')} />
      <Group title={t('settings.data.folder')}>
        <Row label={t('settings.data.location')} sub={<span className="break-all font-mono text-[11px]">{meta ? meta.userData : '…'}</span>}>
          <SmallButton disabled={!meta} onClick={() => meta && void window.stag.openFolder(meta.userData)}>
            {t('common.open')}
          </SmallButton>
        </Row>
        <Row label={t('settings.data.backup')} sub={t('settings.data.soon')} disabled />
      </Group>
    </>
  )
}

function AboutSection(): React.JSX.Element {
  const t = useT()
  const meta = useMeta()
  const line = (label: string, value: string | undefined): React.JSX.Element => (
    <Row label={label}>
      <span className="select-text font-mono text-[12px] text-muted">{value ?? '…'}</span>
    </Row>
  )
  return (
    <>
      <SectionTitle title={t('settings.nav.about')} desc={t('settings.about.desc')} />
      <Group title={t('settings.about.version')}>
        {line('stag.ai', meta ? `${meta.version}${meta.packaged ? '' : ' (dev)'}` : undefined)}
        {line('Electron', meta?.electron)}
        {line('Chromium', meta?.chrome)}
        {line('Node.js', meta?.node)}
      </Group>
      <Group title={t('settings.about.updates')}>
        <Row label={t('settings.about.autoUpdate')} desc={t('settings.about.autoUpdateDesc')} sub={t('settings.data.soon')} disabled />
      </Group>
    </>
  )
}
