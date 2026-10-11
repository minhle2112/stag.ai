import { useEffect, useState } from 'react'
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, type AppMeta, type GeneralSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { ErrorBar, Group, Row, SectionTitle, Select, SmallButton, Stepper, Switch, useSaveError } from './controls'
import { LevelBar } from './levels'

const ZOOMS = [70, 80, 90, 100, 110, 125, 150]

export function GeneralSection(): React.JSX.Element {
  const g = useSettings((s) => s.value.app.general)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const openSettings = useUi((s) => s.openSettings)
  const [meta, setMeta] = useState<AppMeta | null>(null)
  const [tested, setTested] = useState(false)

  useEffect(() => {
    window.stag.settings.meta().then(setMeta)
  }, [])

  const set = (patch: Partial<GeneralSettings>): void => run(save({ general: patch }))

  async function pickProjectsDir(): Promise<void> {
    const dir = await window.stag.pickFolder('Chọn thư mục chứa các dự án', g.projectsDir || undefined)
    if (dir) set({ projectsDir: dir })
  }

  return (
    <>
      <SectionTitle title="Chung" desc="Các cài đặt áp dụng cho cả app. Thay đổi được lưu ngay." right={<LevelBar appOnly />} />
      <ErrorBar error={error} />

      <Group title="Giao diện">
        <Row label="Ngôn ngữ" desc="Giao diện hiện chỉ có tiếng Việt. Agent vẫn trả lời theo ngôn ngữ bạn dùng.">
          <Select
            label="Ngôn ngữ"
            value="vi"
            onChange={() => {}}
            options={[
              { value: 'vi', label: 'Tiếng Việt' },
              { value: 'en', label: 'English (sắp có)', disabled: true }
            ]}
          />
        </Row>
        <Row label="Chủ đề" desc="Giao diện sáng sẽ có khi bạn chọn hướng thiết kế (Graphite / Paper / Nocturne).">
          <Select
            label="Chủ đề"
            value="dark"
            onChange={() => {}}
            options={[
              { value: 'dark', label: 'Tối' },
              { value: 'light', label: 'Sáng (sắp có)', disabled: true },
              { value: 'system', label: 'Theo Windows (sắp có)', disabled: true }
            ]}
          />
        </Row>
        <Row label="Thu phóng" desc="Phóng to / thu nhỏ toàn bộ giao diện app (không đổi cỡ chữ terminal).">
          <Select
            label="Thu phóng"
            value={g.zoom}
            onChange={(zoom) => set({ zoom })}
            options={(ZOOMS.includes(g.zoom) ? ZOOMS : [...ZOOMS, g.zoom].sort((a, b) => a - b)).map((z) => ({ value: z, label: `${z}%` }))}
          />
        </Row>
      </Group>

      <Group title="Khởi động">
        <Row
          label="Chạy cùng Windows"
          desc="Mở stag.ai khi đăng nhập Windows."
          sub={meta && !meta.packaged ? 'Chỉ có tác dụng ở bản cài đặt (bạn đang chạy bản dev).' : undefined}
        >
          <Switch label="Chạy cùng Windows" checked={g.openAtLogin} onChange={(openAtLogin) => set({ openAtLogin })} />
        </Row>
        <Row label="Mở lại workspace lần trước" desc="Tắt thì app luôn mở workspace đầu tiên trong danh sách.">
          <Switch label="Mở lại workspace lần trước" checked={g.reopenLastWorkspace} onChange={(reopenLastWorkspace) => set({ reopenLastWorkspace })} />
        </Row>
      </Group>

      <Group title="Dự án">
        <Row
          label="Thư mục mặc định"
          sub={
            g.projectsDir ? (
              <span className="break-all font-mono text-[11px]">{g.projectsDir}</span>
            ) : (
              'Chưa đặt: hộp thoại chọn thư mục mở ở chỗ Windows tự chọn.'
            )
          }
        >
          {g.projectsDir && <SmallButton onClick={() => set({ projectsDir: '' })}>Bỏ</SmallButton>}
          <SmallButton onClick={() => void pickProjectsDir()}>Chọn…</SmallButton>
        </Row>
      </Group>

      <Group title="Terminal">
        <Row label="Shell cho ô Terminal" desc="Đã chuyển sang Adapter → Terminal.">
          <SmallButton onClick={() => openSettings('adapters', { adapter: 'terminal' })}>Mở</SmallButton>
        </Row>
        <Row label="Cỡ chữ" desc="Cho mọi terminal: ô agent và ô Terminal. Áp dụng ngay.">
          <Stepper
            label="Cỡ chữ terminal"
            value={g.terminalFontSize}
            min={TERMINAL_FONT_MIN}
            max={TERMINAL_FONT_MAX}
            onChange={(terminalFontSize) => set({ terminalFontSize })}
            suffix="px"
          />
        </Row>
      </Group>

      <Group title="Thông báo">
        <Row label="Khi agent chờ bạn" desc="Agent hết lượt, hỏi bạn, hoặc xin quyền. Chỉ báo khi bạn không ở cửa sổ stag.ai.">
          <Switch label="Báo khi agent chờ bạn" checked={g.notifyWaiting} onChange={(notifyWaiting) => set({ notifyWaiting })} />
        </Row>
        <Row label="Khi agent xong việc" desc="Agent đánh dấu xong một việc trên kanban.">
          <Switch label="Báo khi agent xong việc" checked={g.notifyTaskDone} onChange={(notifyTaskDone) => set({ notifyTaskDone })} />
        </Row>
        <Row label="Âm thanh">
          <Switch label="Âm thanh thông báo" checked={g.notifySound} onChange={(notifySound) => set({ notifySound })} />
        </Row>
        <Row
          label="Thử thông báo"
          desc="Bấm thông báo của agent sẽ mở đúng agent đó."
          sub={tested ? 'Đã gửi. Không thấy thì kiểm tra Cài đặt Windows → Hệ thống → Thông báo.' : undefined}
        >
          <SmallButton
            onClick={() => {
              setTested(true)
              void window.stag.settings.notifyTest()
            }}
          >
            Gửi thử
          </SmallButton>
        </Row>
      </Group>

      <Group title="Đóng cửa sổ">
        <Row label="Khi bấm ×" desc="Thu xuống khay: agent vẫn chạy, mở lại bằng icon stag.ai ở khay hệ thống (góc phải thanh tác vụ).">
          <Select
            label="Khi bấm ×"
            value={g.closeAction}
            onChange={(closeAction) => set({ closeAction })}
            options={[
              { value: 'quit', label: 'Thoát hẳn' },
              { value: 'tray', label: 'Thu xuống khay' }
            ]}
          />
        </Row>
        <Row label="Hỏi trước khi thoát" desc="Nếu còn agent / terminal đang chạy (thoát sẽ dừng các phiên đó).">
          <Switch label="Hỏi trước khi thoát" checked={g.confirmQuitRunning} onChange={(confirmQuitRunning) => set({ confirmQuitRunning })} />
        </Row>
      </Group>
    </>
  )
}
