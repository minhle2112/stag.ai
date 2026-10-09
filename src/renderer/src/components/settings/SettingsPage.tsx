import { useEffect, useState } from 'react'
import type { AppMeta } from '@shared/types'
import { useUi, type SettingsSection } from '../../store/ui'
import { useApprovals } from '../../store/approvals'
import { Group, Row, SectionTitle, SmallButton } from './controls'
import { AdaptersSection } from './AdaptersSection'
import { ConnectorsSection } from './ConnectorsSection'
import { SecretsSection } from './SecretsSection'
import { SkillsSection } from './SkillsSection'
import { PluginsSection } from './PluginsSection'
import { GeneralSection } from './GeneralSection'
import { HandoffSection } from './HandoffSection'

interface NavItem {
  id: SettingsSection
  label: string
  /** Chưa làm: hiện nhãn "sắp có" và trang mô tả. */
  soon?: string
}

/** Menu trái theo thứ tự đã chốt: Chung đầu tiên (xem vault: Settings). Mỗi mảng là một nhóm. */
const NAV: NavItem[][] = [
  [{ id: 'general', label: 'Chung' }],
  [
    { id: 'adapters', label: 'Adapter' },
    { id: 'connectors', label: 'Connector' },
    { id: 'skills', label: 'Skill' },
    { id: 'plugins', label: 'Plugin' },
    { id: 'secrets', label: 'Secrets' }
  ],
  [
    { id: 'handoff', label: 'Agent & bàn giao' },
    { id: 'scope', label: 'Khoá phạm vi', soon: 'S5' },
    { id: 'vault', label: 'Vault & mẫu' },
    { id: 'browser', label: 'Trình duyệt', soon: 'S5' }
  ],
  [
    { id: 'data', label: 'Dữ liệu' },
    { id: 'about', label: 'Giới thiệu' }
  ]
]

/** Mô tả các mục chưa làm (theo kế hoạch Settings đã chốt 2026-10-09). */
const SOON: Partial<Record<SettingsSection, { title: string; points: string[] }>> = {
  scope: {
    title: 'Khoá phạm vi',
    points: ['Khi agent sửa vào vùng của agent khác: hỏi bạn / chặn / chỉ cảnh báo.', 'Hiện tại app luôn hỏi bạn.']
  },
  browser: {
    title: 'Trình duyệt',
    points: ['Trang mở mặc định của tab mới.', 'Cho agent dùng trình duyệt trong app hay không.']
  }
}

export function SettingsPage(): React.JSX.Element {
  const section = useUi((s) => s.settings) ?? 'general'
  const open = useUi((s) => s.openSettings)
  const close = useUi((s) => s.closeSettings)
  const pending = useApprovals((s) => s.items.length)

  // Trình duyệt trong app là view gốc nằm trên HTML: phải ẩn khi trang Settings phủ lên (giống hộp thoại).
  useEffect(() => {
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Hộp thoại khác đang mở phía trên (modals > 1 vì trang này cũng tính là một) thì để nó xử lý Esc.
      if (e.key === 'Escape' && useUi.getState().modals <= 1) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="fixed inset-0 z-40 flex bg-bg" role="dialog" aria-label="Cài đặt">
      <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
        <button onClick={close} className="mx-2 mt-3 rounded-md px-2 py-1.5 text-left text-muted hover:bg-panel-2 hover:text-fg" title="Esc">
          ← Quay lại app
        </button>
        <div className="px-4 pb-2 pt-3 text-[15px] font-semibold tracking-tight">Cài đặt</div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {NAV.map((group, i) => (
            <div key={i} className={i ? 'mt-2 border-t border-line pt-2' : ''}>
              {group.map((item) => (
                <button
                  key={item.id}
                  onClick={() => open(item.id)}
                  className={`flex w-full items-center rounded-md px-2 py-1.5 text-left ${
                    section === item.id ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'
                  }`}
                >
                  <span className="flex-1">{item.label}</span>
                  {item.soon && <span className="rounded bg-line/60 px-1.5 text-[10.5px] text-muted">sắp có</span>}
                  {item.id === 'connectors' && pending > 0 && (
                    <span className="rounded-full bg-amber-400 px-1.5 text-[10.5px] font-semibold text-black" title="Đang chờ bạn duyệt">
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
        <div className={`mx-auto ${section === 'connectors' || section === 'skills' || section === 'plugins' ? 'max-w-5xl' : 'max-w-3xl'} select-text px-8 py-8`}>
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
      <div className="rounded-lg border border-dashed border-line px-5 py-4">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
          {info?.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

function VaultSection(): React.JSX.Element {
  return (
    <>
      <SectionTitle title="Vault & mẫu" desc="Mỗi workspace có một vault Obsidian làm bộ nhớ, tạo từ bộ mẫu dưới đây." />
      <Group title="Mẫu">
        <Row
          label="Template vault"
          desc="Cấu trúc vault, CLAUDE.md, luật phiên của agent. Sửa bản trong thư mục này sẽ thay bản có sẵn của app (theo từng file)."
        >
          <SmallButton onClick={() => void window.stag.openTemplates()}>Mở thư mục mẫu</SmallButton>
        </Row>
      </Group>
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
        <Row label="Vị trí" desc={meta ? <span className="select-text break-all font-mono text-[11.5px]">{meta.userData}</span> : '…'}>
          <SmallButton disabled={!meta} onClick={() => meta && void window.stag.openFolder(meta.userData)}>
            Mở
          </SmallButton>
        </Row>
        <Row label="Xuất / nhập cấu hình, sao lưu" desc="Sắp có." disabled />
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
      <SectionTitle title="Giới thiệu" desc="stag.ai: điều hành một đội agent AI viết code, mỗi workspace có vault Obsidian làm bộ nhớ." />
      <Group title="Phiên bản">
        {line('stag.ai', meta ? `${meta.version}${meta.packaged ? '' : ' (dev)'}` : undefined)}
        {line('Electron', meta?.electron)}
        {line('Chromium', meta?.chrome)}
        {line('Node.js', meta?.node)}
      </Group>
      <Group title="Cập nhật">
        <Row label="Tự kiểm tra bản mới" desc="Chưa có: cần nơi phát hành bản cài (máy chủ cập nhật) trước." disabled />
      </Group>
    </>
  )
}
