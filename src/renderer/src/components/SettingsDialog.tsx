import { useState } from 'react'
import { HANDOFF_MAX, HANDOFF_MIN } from '@shared/types'
import { useSettings } from '../store/settings'
import { formatTokens } from '../status'
import { Button, Modal } from './Modal'

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { value, save } = useSettings()
  const [auto, setAuto] = useState(value.autoHandoff)
  const [percent, setPercent] = useState(value.handoffPercent)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const valid = Number.isFinite(percent) && percent >= HANDOFF_MIN && percent <= HANDOFF_MAX

  async function submit(): Promise<void> {
    setSaving(true)
    setError('')
    try {
      await save({ autoHandoff: auto, handoffPercent: Math.round(percent) })
      onClose()
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Cài đặt"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button primary disabled={!valid || saving} onClick={submit}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="text-[13px] font-semibold">Bàn giao khi context gần đầy</div>
      <p className="mt-1 text-[12px] text-muted">
        Khi context của một phiên agent đạt ngưỡng và agent đang chờ bạn (hết lượt, bạn không gõ phím vài giây), app nhờ agent
        ghi vault và viết bản bàn giao, rồi đóng phiên và mở phiên mới đọc tiếp từ bản bàn giao đó. Việc đang làm trên kanban
        vẫn giữ nguyên.
      </p>

      <label className="mt-3 flex items-center gap-2">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Tự động bàn giao</span>
      </label>

      <div className={`mt-3 flex items-center gap-3 ${auto ? '' : 'opacity-50'}`}>
        <span>Ngưỡng</span>
        <input
          type="range"
          min={HANDOFF_MIN}
          max={HANDOFF_MAX}
          step={5}
          value={valid ? percent : HANDOFF_MIN}
          disabled={!auto}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={HANDOFF_MIN}
          max={HANDOFF_MAX}
          value={Number.isFinite(percent) ? percent : ''}
          disabled={!auto}
          onChange={(e) => setPercent(e.target.value === '' ? NaN : Number(e.target.value))}
          className="w-16 rounded-md border border-line bg-bg px-2 py-1 text-right"
        />
        <span>%</span>
      </div>
      {valid ? (
        <p className="mt-2 text-[12px] text-muted">
          = {formatTokens((200_000 * percent) / 100)} token với cửa sổ 200k, {formatTokens((1_000_000 * percent) / 100)} token
          với cửa sổ 1M. Claude Code tự compact ở khoảng 97% (cửa sổ 1M) nên ngưỡng tối đa là {HANDOFF_MAX}%.
        </p>
      ) : (
        <p className="mt-2 text-[12px] text-red-300">
          Ngưỡng phải từ {HANDOFF_MIN} đến {HANDOFF_MAX}%.
        </p>
      )}
      <p className="mt-3 text-[12px] text-muted">
        Bàn giao tay bất cứ lúc nào: menu ⋯ của agent ở thanh bên → "Bàn giao sang phiên mới". App đọc % context qua statusLine
        của Claude Code; statusLine riêng của bạn (nếu có) vẫn chạy và hiện như cũ trong phiên agent.
      </p>
      {error && <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}
    </Modal>
  )
}
