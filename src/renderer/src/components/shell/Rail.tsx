import { pageTab, slotsOf, usePlugins } from '../../store/plugins'
import { useSettings } from '../../store/settings'
import { useUi, type MainTab } from '../../store/ui'
import { useActiveWorkspace } from '../../store/workspaces'
import { Icon, type IconName } from '../Icon'
import { ICONS } from '../icons'
import { SkillAvatar } from '../settings/SkillsSection'
import { useT } from '../../i18n'
import type { PlainKey } from '@shared/i18n'

const VIEWS: Array<{ tab: MainTab; icon: IconName; tip: PlainKey }> = [
  { tab: 'agents', icon: 'grid', tip: 'shell.rail.agents' },
  { tab: 'artifacts', icon: 'fdiff', tip: 'shell.rail.artifacts' },
  { tab: 'vault', icon: 'vault', tip: 'shell.rail.vault' },
  { tab: 'log', icon: 'brain', tip: 'shell.rail.log' }
]

/** Thanh icon bên trái (rộng 48px): các màn hình chính, trang plugin dưới vạch ngăn, Cài đặt ở đáy. */
export function Rail(): React.JSX.Element {
  const t = useT()
  const tab = useUi((s) => s.tab)
  const settingsOpen = useUi((s) => s.settings !== null)
  const setTab = useUi((s) => s.setTab)
  const openSettings = useUi((s) => s.openSettings)
  const closeSettings = useUi((s) => s.closeSettings)
  const active = useActiveWorkspace()
  const pluginItems = usePlugins((s) => s.items)
  const settingsValue = useSettings((s) => s.value)
  const pages = slotsOf(pluginItems, settingsValue, 'page', active?.id)
  const current = settingsOpen ? null : tab

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-bg0 py-2">
      {VIEWS.map((v) => (
        <RailButton key={v.tab} on={current === v.tab} tip={t(v.tip)} onClick={() => setTab(v.tab)}>
          <Icon name={v.icon} size="l" />
        </RailButton>
      ))}
      {pages.length > 0 && <div className="my-0.5 h-px w-[18px] bg-line-2" />}
      {pages.map(({ plugin, slot }) => {
        const id = pageTab(plugin.manifest.id, slot.id)
        return (
          <RailButton key={id} on={current === id} tip={t('shell.rail.pluginPage', { page: slot.displayName, plugin: plugin.manifest.displayName })} onClick={() => setTab(id)}>
            {plugin.manifest.icon && plugin.manifest.icon in ICONS ? <Icon name={plugin.manifest.icon as IconName} size="l" /> : <SkillAvatar name={plugin.manifest.displayName} size={20} />}
          </RailButton>
        )
      })}
      <div className="flex-1" />
      <RailButton on={settingsOpen} tip={t('shell.rail.settings')} onClick={() => (settingsOpen ? closeSettings() : openSettings())}>
        <Icon name="gear" size="l" />
      </RailButton>
    </nav>
  )
}

function RailButton({ on, tip, onClick, children }: { on: boolean; tip: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={tip}
      data-tip-side="right"
      aria-label={tip}
      aria-current={on ? 'page' : undefined}
      className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-[7px] hover:bg-panel-2 hover:text-fg ${on ? 'text-fg' : 'text-dim'}`}
    >
      {on && <span className="absolute top-[9px] bottom-[9px] -left-1.5 w-0.5 rounded-sm bg-accent" />}
      {children}
    </button>
  )
}
