import type { GeneralSettings, ThemePref } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useTheme } from '../../store/theme'
import { Icon, type IconName } from '../Icon'
import { ErrorBar, Group, Row, SectionTitle, Switch, useSaveError } from './controls'
import { LevelBar } from './levels'

/** Màu của ảnh xem trước (app thu nhỏ) cho từng chế độ: cố định, không theo theme đang dùng. */
const MINI = {
  dark: { bar: '#08090b', side: '#0c0e10', cell: '#101215', fg: '#99a0aa', accent: '#2de2c0', line: '#1e2227' },
  light: { bar: '#e8ebef', side: '#f3f5f7', cell: '#ffffff', fg: '#7a8390', accent: '#087a65', line: '#dde2e8' }
}

function MiniApp({ kind }: { kind: 'dark' | 'light' }): React.JSX.Element {
  const c = MINI[kind]
  const cell = (on: boolean): React.JSX.Element => (
    <i
      className="relative block rounded-[3px] after:absolute after:top-1.5 after:right-[30%] after:left-1 after:h-0.5 after:rounded-sm after:bg-current after:opacity-50 after:shadow-[0_5px_0_currentColor,0_10px_0_currentColor]"
      style={{ background: c.cell, color: c.fg, ...(on ? { outline: `1.5px solid ${c.accent}` } : { border: `1px solid ${c.line}` }) }}
    />
  )
  return (
    <div className="absolute inset-0 grid grid-cols-[14px_34px_1fr] grid-rows-[9px_1fr_6px]" style={{ background: c.side }}>
      <div className="col-span-full" style={{ background: c.bar, borderBottom: `1px solid ${c.line}` }} />
      <div style={{ background: c.bar, borderRight: `1px solid ${c.line}` }} />
      <div style={{ background: c.side, borderRight: `1px solid ${c.line}` }} />
      <div className="grid grid-cols-2 gap-1 p-[5px]">
        {cell(true)}
        {cell(false)}
        {cell(false)}
        {cell(false)}
      </div>
      <div className="col-span-full" style={{ background: c.bar, borderTop: `1px solid ${c.line}` }} />
    </div>
  )
}

const OPTIONS: { id: ThemePref; name: string; desc: string; icon: IconName }[] = [
  { id: 'dark', name: 'Tối', desc: 'Bảng màu “Xưởng”', icon: 'moon' },
  { id: 'light', name: 'Sáng', desc: 'Nền trắng, teal sẫm', icon: 'sun' },
  { id: 'system', name: 'Theo Windows', desc: 'Đổi theo Windows', icon: 'monitor' }
]

export function AppearanceSection(): React.JSX.Element {
  const g = useSettings((s) => s.value.app.general)
  const save = useSettings((s) => s.save)
  const windowsDark = useTheme((s) => s.windowsDark)
  const [error, run] = useSaveError()
  const set = (patch: Partial<GeneralSettings>): void => run(save({ general: patch }))

  return (
    <>
      <SectionTitle title="Giao diện" desc="Màu của app. Áp dụng ngay, không cần khởi động lại." right={<LevelBar appOnly />} />
      <ErrorBar error={error} />

      <Group title="Chế độ màu" flush>
        <div role="radiogroup" aria-label="Chế độ màu" className="grid grid-cols-3 gap-3 py-2">
          {OPTIONS.map((o) => {
            const on = g.theme === o.id
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ theme: o.id })}
                className={`rounded-[10px] border-[1.5px] bg-panel p-2 text-left ${on ? 'border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]' : 'border-line-2 hover:border-line-3'}`}
              >
                <div className="relative h-[84px] overflow-hidden rounded-md border border-line">
                  {o.id === 'system' ? (
                    <>
                      <MiniApp kind="dark" />
                      <div className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
                        <MiniApp kind="light" />
                      </div>
                    </>
                  ) : (
                    <MiniApp kind={o.id} />
                  )}
                </div>
                <div className="mt-2 flex items-center gap-1.5 font-medium">
                  <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border-[1.5px] ${on ? 'border-accent' : 'border-input-line'}`}>
                    {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </span>
                  <Icon name={o.icon} className="text-muted" />
                  {o.name}
                </div>
                <div className="mt-px pl-5 text-[11.5px] text-dim">{o.desc}</div>
              </button>
            )
          })}
        </div>
        {g.theme === 'system' && (
          <div className="mb-1 flex items-start gap-2 rounded-md bg-info/10 px-2.5 py-2 text-[12px] text-fg">
            <Icon name="info" className="mt-px shrink-0 text-info" />
            <span>
              Windows đang <b>{windowsDark ? 'tối' : 'sáng'}</b>. Đổi trong Windows → Cá nhân hoá → Màu, app đổi theo.
            </span>
          </div>
        )}
      </Group>

      <Group title="Terminal và agent">
        <Row label="Terminal theo giao diện app" desc="Tắt thì ô terminal luôn nền tối, kể cả khi app sáng.">
          <Switch label="Terminal theo giao diện app" checked={g.terminalFollowTheme} onChange={(terminalFollowTheme) => set({ terminalFollowTheme })} />
        </Row>
        <Row
          label="Đổi theme của Claude Code theo app"
          desc="Terminal sáng thì Claude Code dùng theme light-ansi (ghi vào ~/.claude.json, nên cũng đổi khi chạy ngoài app); tắt thì trả lại theme cũ. Agent đang chạy đổi màu khi mở lại phiên."
        >
          <Switch label="Đổi theme của Claude Code theo app" checked={g.claudeThemeSync} onChange={(claudeThemeSync) => set({ claudeThemeSync })} />
        </Row>
      </Group>

      <Group title="Phím tắt">
        <Row label="Đổi nhanh sáng / tối" desc="Cũng có ở nút mặt trời trên thanh tiêu đề và trong Ctrl+K.">
          {['Ctrl', 'Shift', 'L'].map((k) => (
            <kbd key={k} className="rounded border border-b-2 border-line-2 bg-panel-2 px-1.5 font-mono text-[11px] text-muted">
              {k}
            </kbd>
          ))}
        </Row>
      </Group>
    </>
  )
}
