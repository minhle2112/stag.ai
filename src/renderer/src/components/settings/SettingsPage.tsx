import { useEffect, useState } from 'react'
import type { AppMeta } from '@shared/types'
import { useUi, type SettingsSection } from '../../store/ui'
import { useApprovals } from '../../store/approvals'
import { Icon, type IconName } from '../Icon'
import { Group, Row, SectionTitle, SmallButton } from './controls'
import { AdaptersSection } from './AdaptersSection'
import { ConnectorsSection } from './ConnectorsSection'
import { SecretsSection } from './SecretsSection'
import { SkillsSection } from './SkillsSection'
import { PluginsSection } from './PluginsSection'
import { GeneralSection } from './GeneralSection'
import { AppearanceSection } from './AppearanceSection'
import { HandoffSection } from './HandoffSection'
import { ScopeSection } from './ScopeSection'
import { AgentApiSection } from './AgentApiSection'
import { BrowserSection } from './BrowserSection'
import { VoiceSection } from './VoiceSection'
import { VaultSection } from './VaultSection'

interface NavItem {
  id: SettingsSection
  label: string
  icon: IconName
  /** Chưa làm: hiện nhãn "sắp có" và trang mô tả. */
  soon?: string
}

/** Menu trái theo thứ tự đã chốt: Chung đầu tiên (xem vault: Settings). Mỗi mảng là một nhóm. */
const NAV: NavItem[][] = [
  [
    { id: 'general', label: 'Chung', icon: 'gear' },
    { id: 'appearance', label: 'Giao diện', icon: 'palette' },
    { id: 'voice', label: 'Giọng nói', icon: 'mic' }
  ],
  [
    { id: 'adapters', label: 'Adapter', icon: 'term' },
    { id: 'connectors', label: 'Connector (MCP)', icon: 'conn' },
    { id: 'skills', label: 'Skill', icon: 'book' },
    { id: 'plugins', label: 'Plugin', icon: 'plug' },
    { id: 'secrets', label: 'Kho bí mật', icon: 'key' }
  ],
  [
    { id: 'handoff', label: 'Agent & bàn giao', icon: 'bot' },
    { id: 'vault', label: 'Vault & bộ nhớ', icon: 'vault' },
    { id: 'scope', label: 'Khoá phạm vi', icon: 'lock' },
    { id: 'agentApi', label: 'Agent API', icon: 'code' },
    { id: 'browser', label: 'Trình duyệt', icon: 'globe' }
  ],
  [
    { id: 'data', label: 'Dữ liệu', icon: 'folder' },
    { id: 'about', label: 'Giới thiệu', icon: 'info' }
  ]
]

/** Mô tả các mục chưa làm (theo kế hoạch Settings đã chốt 2026-10-09). */
/** Mục chưa làm (nav có `soon`): tiêu đề + các ý dự kiến. */
const SOON: Partial<Record<SettingsSection, { title: string; points: string[] }>> = {}

export function SettingsPage(): React.JSX.Element {
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
    <div className="absolute inset-0 z-10 flex bg-bg" role="region" aria-label="Cài đặt">
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
                  <span className="flex-1">{item.label}</span>
                  {item.soon && <span className="rounded bg-line/60 px-1.5 text-[11px] text-muted">sắp có</span>}
                  {item.id === 'connectors' && pending > 0 && (
                    <span className="rounded-full bg-wait px-1.5 text-[11px] font-semibold text-wait-on" data-tip="Đang chờ bạn duyệt">
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
          className={`mx-auto ${section === 'connectors' || section === 'skills' || section === 'plugins' ? 'max-w-[1000px]' : 'max-w-[760px]'} select-text px-8 pt-[18px] pb-10`}
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
    case 'handoff':
      return <HandoffSection />
    case 'scope':
      return <ScopeSection />
    case 'agentApi':
      return <AgentApiSection />
    case 'browser':
      return <BrowserSection />
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
  const info = SOON[id]
  const stage = NAV.flat().find((n) => n.id === id)?.soon
  return (
    <>
      <SectionTitle title={info?.title ?? id} desc={`Sắp có (đợt ${stage}).`} />
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
  const meta = useMeta()
  return (
    <>
      <SectionTitle title="Dữ liệu" desc="Danh sách workspace, agent, cài đặt và mẫu của app nằm ở thư mục dữ liệu. Code và vault nằm trong thư mục dự án." />
      <Group title="Thư mục dữ liệu">
        <Row label="Vị trí" sub={<span className="break-all font-mono text-[11px]">{meta ? meta.userData : '…'}</span>}>
          <SmallButton disabled={!meta} onClick={() => meta && void window.stag.openFolder(meta.userData)}>
            Mở
          </SmallButton>
        </Row>
        <Row label="Xuất / nhập cấu hình, sao lưu" sub="Sắp có." disabled />
      </Group>
    </>
  )
}

function AboutSection(): React.JSX.Element {
  const meta = useMeta()
  const line = (label: string, value: string | undefined): React.JSX.Element => (
    <Row label={label}>
      <span className="select-text font-mono text-[12px] text-muted">{value ?? '…'}</span>
    </Row>
  )
  return (
    <>
      <SectionTitle title="Giới thiệu" desc="stag.ai: điều hành một đội agent AI viết code, mỗi workspace có một vault (note markdown) làm bộ nhớ, agent đọc / sửa qua app." />
      <Group title="Phiên bản">
        {line('stag.ai', meta ? `${meta.version}${meta.packaged ? '' : ' (dev)'}` : undefined)}
        {line('Electron', meta?.electron)}
        {line('Chromium', meta?.chrome)}
        {line('Node.js', meta?.node)}
      </Group>
      <Group title="Cập nhật">
        <Row label="Tự kiểm tra bản mới" desc="Chưa có: cần nơi phát hành bản cài (máy chủ cập nhật) trước." sub="Sắp có." disabled />
      </Group>
    </>
  )
}
