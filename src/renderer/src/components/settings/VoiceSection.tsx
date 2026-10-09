import { useEffect, useState } from 'react'
import { formatMb, VOICE_HOTKEYS, VOICE_MODEL, type VoiceHotkey } from '@shared/voice'
import type { VoiceSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useVoice } from '../../store/voice'
import { ErrorBar, Group, Row, SectionTitle, Select, SmallButton, Switch, useSaveError } from './controls'

const UNLOAD: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Sau 1 phút không dùng' },
  { value: 5, label: 'Sau 5 phút không dùng' },
  { value: 15, label: 'Sau 15 phút không dùng' },
  { value: 30, label: 'Sau 30 phút không dùng' },
  { value: 60, label: 'Sau 1 giờ không dùng' },
  { value: 0, label: 'Giữ tới khi tắt app' }
]

/** Cài đặt → Giọng nói (V1): model nhận dạng, phím tắt, micro, từ gợi ý, giải phóng RAM. */
export function VoiceSection(): React.JSX.Element {
  const v = useSettings((s) => s.value.app.voice)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const set = (patch: Partial<VoiceSettings>): void => run(save({ voice: patch }))
  const unload = UNLOAD.some((o) => o.value === v.unloadMinutes) ? UNLOAD : [...UNLOAD, { value: v.unloadMinutes, label: `Sau ${v.unloadMinutes} phút không dùng` }]

  return (
    <>
      <SectionTitle
        title="Giọng nói"
        desc={`Giữ ${VOICE_HOTKEYS[v.hotkey]} trong một ô agent để nói tiếng Việt (lẫn từ tiếng Anh), thả ra để chuyển thành chữ. Nhận dạng chạy hoàn toàn trên máy bạn, âm thanh không gửi đi đâu và không lưu lại.`}
      />
      <ErrorBar error={error} />

      <ModelGroup />

      <Group title="Cách dùng">
        <Row label="Bật gõ bằng giọng nói" desc="Phím tắt và nút micro trên thanh của ô agent.">
          <Switch label="Bật gõ bằng giọng nói" checked={v.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label="Phím tắt" desc="Giữ để nói, thả để dừng. Đang nói bấm Esc để huỷ. Nút micro trên ô: bấm để nói, bấm lần nữa để dừng.">
          <Select
            label="Phím tắt"
            value={v.hotkey}
            onChange={(hotkey: VoiceHotkey) => set({ hotkey })}
            options={(Object.keys(VOICE_HOTKEYS) as VoiceHotkey[]).map((k) => ({ value: k, label: VOICE_HOTKEYS[k] }))}
          />
        </Row>
        <Row
          label="Xem trước rồi mới chèn"
          desc="Hiện chữ nhận được để sửa, Enter mới chèn vào ô. Tắt = chèn thẳng. Cả hai cách đều không tự gửi: bạn vẫn tự nhấn Enter trong ô."
        >
          <Switch label="Xem trước rồi mới chèn" checked={v.preview} onChange={(preview) => set({ preview })} />
        </Row>
      </Group>

      <MicGroup micId={v.micId} onChange={(micId) => set({ micId })} />

      <HotwordsGroup value={v.hotwords} onSave={(hotwords) => set({ hotwords })} />

      <Group title="Bộ nhớ (RAM)">
        <Row
          label="Giải phóng model"
          desc="Tiến trình nhận dạng chỉ chạy khi bạn nói (khoảng 1,2–1,4 GB RAM). Không dùng một lúc thì tắt để trả RAM; lần nói sau nạp lại mất khoảng 2–3 giây, phần lớn trùng lúc bạn đang nói."
        >
          <Select label="Giải phóng model" value={v.unloadMinutes} onChange={(unloadMinutes: number) => set({ unloadMinutes })} options={unload} />
        </Row>
        <EngineRow />
      </Group>
    </>
  )
}

function ModelGroup(): React.JSX.Element {
  const status = useVoice((s) => s.status)
  const pct = status.total ? Math.min(100, Math.round(((status.received ?? 0) * 100) / status.total)) : 0
  let desc: React.ReactNode
  let action: React.ReactNode
  switch (status.model) {
    case 'ready':
      desc = 'Đã tải, sẵn sàng dùng (khoảng 1 GB trên đĩa).'
      action = <SmallButton onClick={() => void window.stag.voice.remove()}>Xoá model</SmallButton>
      break
    case 'downloading':
      desc = (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-40 overflow-hidden rounded bg-line">
            <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
          </span>
          {formatMb(status.received ?? 0)} / {formatMb(status.total ?? VOICE_MODEL.bytes)} ({pct}%)
        </span>
      )
      action = <SmallButton onClick={() => void window.stag.voice.cancel()}>Huỷ</SmallButton>
      break
    case 'verifying':
      desc = 'Đang kiểm tra file tải về…'
      break
    case 'extracting':
      desc = 'Đang giải nén (khoảng một phút)…'
      break
    case 'error':
      desc = <span className="text-red-300">{status.error}</span>
      action = <SmallButton onClick={() => void window.stag.voice.download()}>Thử lại</SmallButton>
      break
    default:
      desc = `Cần tải một lần ${formatMb(VOICE_MODEL.bytes)} từ GitHub (k2-fsa/sherpa-onnx). App kiểm tra mã SHA-256 trước khi dùng.`
      action = <SmallButton onClick={() => void window.stag.voice.download()}>Tải model</SmallButton>
  }
  return (
    <Group title="Model nhận dạng">
      <Row label={VOICE_MODEL.label} desc={desc}>
        {action}
      </Row>
    </Group>
  )
}

function EngineRow(): React.JSX.Element {
  const status = useVoice((s) => s.status)
  const text =
    status.engine === 'ready'
      ? 'Đang nạp trong RAM, nói là nhận dạng ngay.'
      : status.engine === 'loading'
        ? 'Đang nạp model…'
        : 'Không chạy, không tốn RAM.'
  return (
    <Row label="Tiến trình nhận dạng" desc={status.error && status.model === 'ready' ? <span className="text-red-300">{status.error}</span> : text}>
      {status.engine !== 'off' && <SmallButton onClick={() => void window.stag.voice.unload()}>Giải phóng ngay</SmallButton>}
    </Row>
  )
}

/** Chọn micro. Tên micro chỉ hiện sau khi app được dùng micro một lần (Chromium giấu tên trước đó). */
function MicGroup({ micId, onChange }: { micId: string; onChange: (id: string) => void }): React.JSX.Element {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [err, setErr] = useState('')
  const list = (): void => {
    navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications')))
      .catch(() => setMics([]))
  }
  useEffect(() => {
    list()
    navigator.mediaDevices.addEventListener('devicechange', list)
    return () => navigator.mediaDevices.removeEventListener('devicechange', list)
  }, [])
  const named = mics.some((m) => m.label)
  const allow = async (): Promise<void> => {
    setErr('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      list()
    } catch (e) {
      setErr(`Không mở được micro: ${(e as Error).message}. Kiểm tra Windows Settings → Privacy → Microphone.`)
    }
  }
  const options = [{ value: '', label: 'Micro mặc định của Windows' }, ...mics.map((m, i) => ({ value: m.deviceId, label: m.label || `Micro ${i + 1}` }))]
  if (micId && !mics.some((m) => m.deviceId === micId)) options.push({ value: micId, label: 'Micro đã chọn (đang không cắm)' })
  return (
    <Group title="Micro">
      <Row label="Micro" desc={err ? <span className="text-red-300">{err}</span> : named ? undefined : 'Bấm "Hiện tên micro" để thấy tên từng micro.'}>
        {!named && mics.length > 0 && <SmallButton onClick={() => void allow()}>Hiện tên micro</SmallButton>}
        <Select label="Micro" value={micId} onChange={onChange} options={options} />
      </Row>
    </Group>
  )
}

/** Từ gợi ý: mỗi dòng một mục, lưu khi rời ô. */
function HotwordsGroup({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }): React.JSX.Element {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => setText(value.join('\n')), [value])
  const commit = (): void => {
    const next = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (next.join('\n') !== value.join('\n')) onSave(next)
  }
  return (
    <Group title="Từ gợi ý">
      <div className="px-4 py-3">
        <p className="mb-2 text-[12px] leading-relaxed text-muted">
          Tên riêng, tên hàm, thư viện bạn hay nói (vd. <span className="font-mono">handleClick</span>, <span className="font-mono">zustand</span>) — mỗi dòng một
          mục, viết đúng chính tả muốn ra. Tên agent trong workspace được thêm tự động. Nên giữ danh sách ngắn (dưới 40 mục): quá dài thì nhận dạng chậm và
          dễ lẫn.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={6}
          spellCheck={false}
          aria-label="Từ gợi ý"
          placeholder={'handleClick\nzustand\nnpm install'}
          className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent"
        />
      </div>
    </Group>
  )
}
