import { useEffect, useState } from 'react'
import { formatMb, SONIOX_SECRET, SONIOX_USD_PER_HOUR, VOICE_HOTKEYS, VOICE_MODEL, type VoiceCloudInfo, type VoiceHotkey } from '@shared/voice'
import { formatReplacements, parseReplacements } from '@shared/voiceVocab'
import type { VoiceEngine, VoiceReplacement, VoiceSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useVoice } from '../../store/voice'
import { useWorkspaces } from '../../store/workspaces'
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
        desc={`Giữ ${VOICE_HOTKEYS[v.hotkey]} trong một ô agent để nói tiếng Việt (lẫn từ tiếng Anh), thả ra để chuyển thành chữ. ${v.engine === 'soniox' ? 'Đang dùng máy đám mây Soniox: âm thanh được gửi tới Soniox để nhận dạng, app không lưu lại.' : 'Nhận dạng chạy hoàn toàn trên máy bạn, âm thanh không gửi đi đâu và không lưu lại.'}`}
      />
      <ErrorBar error={error} />

      <Group title="Máy nhận dạng">
        <Row
          label="Dùng máy nào"
          desc={
            v.engine === 'soniox'
              ? 'Soniox: chữ hiện dần ngay khi bạn nói, thường chính xác hơn với từ tiếng Anh. Âm thanh và danh sách từ gợi ý (tên file, tên hàm) được gửi tới Soniox; chữ trong terminal thì không.'
              : 'Qwen3-ASR chạy hoàn toàn trên máy bạn: miễn phí, không cần mạng, âm thanh không gửi đi đâu.'
          }
        >
          <Select
            label="Máy nhận dạng"
            value={v.engine}
            onChange={(engine: VoiceEngine) => set({ engine })}
            options={[
              { value: 'local', label: 'Trên máy (Qwen3-ASR)' },
              { value: 'soniox', label: 'Đám mây (Soniox)' }
            ]}
          />
        </Row>
        {v.engine === 'soniox' && <CloudRows />}
      </Group>

      <ModelGroup cloud={v.engine === 'soniox'} />

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

      <HotwordsGroup value={v.hotwords} onSave={(hotwords) => set({ hotwords })} auto={v.workspaceVocab} onAuto={(workspaceVocab) => set({ workspaceVocab })} />

      <FixGroup rules={v.replacements} onRules={(replacements) => set({ replacements })} commands={v.commands} onCommands={(commands) => set({ commands })} />

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

/** API key Soniox (lưu trong kho bí mật, app không hiện lại key) + kiểm tra + chi phí tháng này. */
function CloudRows(): React.JSX.Element {
  const [info, setInfo] = useState<VoiceCloudInfo | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = (): void => void window.stag.voice.cloudInfo().then(setInfo, () => {})
  useEffect(refresh, [])
  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const save = (): Promise<void> =>
    act(async () => {
      await window.stag.secrets.set(SONIOX_SECRET, key.trim())
      setKey('')
      await window.stag.voice.cloudTest()
    }, 'Đã lưu và thử key: dùng được.')
  const minutes = (info?.monthSeconds ?? 0) / 60
  const input = 'w-56 rounded-md border border-line bg-bg px-2 py-1 font-mono text-[12px] outline-none focus:border-accent'
  return (
    <>
      <Row
        label="API key Soniox"
        desc={
          msg ? (
            <span className={msg.ok ? 'text-emerald-300' : 'text-red-300'}>{msg.text}</span>
          ) : info?.hasKey ? (
            `Đã lưu (mã hoá trong bí mật ${SONIOX_SECRET}, app không hiện lại). Dán key mới để thay.`
          ) : (
            'Tạo key tại console.soniox.com → API keys rồi dán vào đây. Key được mã hoá bằng tài khoản Windows của bạn.'
          )
        }
      >
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
          placeholder={info?.hasKey ? '•••••••• (đã lưu)' : 'Dán API key'}
          aria-label="API key Soniox"
          className={input}
        />
        <SmallButton onClick={() => void save()} disabled={!key.trim() || busy}>
          Lưu
        </SmallButton>
        {info?.hasKey && (
          <>
            <SmallButton onClick={() => void act(() => window.stag.voice.cloudTest(), 'Key dùng được.')} disabled={busy}>
              {busy ? 'Đang thử…' : 'Kiểm tra'}
            </SmallButton>
            <SmallButton onClick={() => void act(() => window.stag.secrets.remove(SONIOX_SECRET), 'Đã xoá key.')} disabled={busy}>
              Xoá key
            </SmallButton>
          </>
        )}
      </Row>
      <Row
        label="Chi phí"
        desc={`Soniox tính khoảng ${SONIOX_USD_PER_HOUR} USD mỗi giờ âm thanh (thời gian bạn giữ phím). Tháng này: ${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} phút ≈ ${((minutes / 60) * SONIOX_USD_PER_HOUR).toFixed(2)} USD (app tự đếm, hoá đơn thật xem ở console.soniox.com).`}
      />
    </>
  )
}

function ModelGroup({ cloud }: { cloud: boolean }): React.JSX.Element {
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
    <Group title={cloud ? "Model trên máy (dự phòng, không bắt buộc)" : "Model nhận dạng"}>
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

/** Ô nhập nhiều dòng, lưu khi rời ô (chỉ khi khác giá trị đã lưu). */
function useDraft(saved: string): [string, (t: string) => void] {
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved])
  return [text, setText]
}

/** Từ gợi ý: tự lấy từ workspace + danh sách tự thêm (mỗi dòng một mục, lưu khi rời ô). */
function HotwordsGroup({
  value,
  onSave,
  auto,
  onAuto
}: {
  value: string[]
  onSave: (v: string[]) => void
  auto: boolean
  onAuto: (v: boolean) => void
}): React.JSX.Element {
  const [text, setText] = useDraft(value.join('\n'))
  const commit = (): void => {
    const next = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    if (next.join('\n') !== value.join('\n')) onSave(next)
  }
  return (
    <Group title="Từ gợi ý">
      <Row
        label="Tự gợi ý từ trong workspace"
        desc="Tên file, hàm, class, thư viện của dự án, từ code đang hiện trong ô agent và từ hay dùng (commit, push, npm…). Giúp nhận đúng chính tả từ tiếng Anh. Chỉ đọc file trên máy, không gửi đi đâu."
      >
        <Switch label="Tự gợi ý từ trong workspace" checked={auto} onChange={onAuto} />
      </Row>
      {auto && <WorkspaceTerms />}
      <div className="px-4 py-3">
        <p className="mb-2 text-[12px] leading-relaxed text-muted">
          Từ bạn tự thêm (luôn được ưu tiên): tên riêng, tên hàm, thư viện bạn hay nói (vd. <span className="font-mono">handleClick</span>,{' '}
          <span className="font-mono">zustand</span>) — mỗi dòng một mục, viết đúng chính tả muốn ra. Tên agent được thêm tự động.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={5}
          spellCheck={false}
          aria-label="Từ gợi ý"
          placeholder={'handleClick\nzustand\nnpm install'}
          className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent"
        />
      </div>
    </Group>
  )
}

/** Xem từ vựng app đã lấy từ workspace đang mở (để biết vì sao một từ được / không được nhận đúng). */
function WorkspaceTerms(): React.JSX.Element | null {
  const ws = useWorkspaces((s) => s.items.find((w) => w.id === s.activeId))
  const [terms, setTerms] = useState<string[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setTerms(null)
    setOpen(false)
  }, [ws?.id])
  if (!ws) return null
  const show = (): void => {
    setOpen(true)
    if (!terms) void window.stag.voice.vocab(ws.id).then(setTerms, () => setTerms([]))
  }
  return (
    <Row
      label={`Từ của workspace "${ws.name}"`}
      desc={
        open ? (
          terms === null ? (
            'Đang quét…'
          ) : terms.length ? (
            <span className="font-mono text-[11px] leading-relaxed">
              {terms.length} từ, quan trọng nhất trước: {terms.slice(0, 80).join(', ')}
              {terms.length > 80 ? '…' : ''}
            </span>
          ) : (
            'Không tìm thấy từ nào (thư mục trống hoặc không đọc được).'
          )
        ) : (
          'Mỗi lần nói, app chọn khoảng 60 từ hợp nhất: từ bạn thêm, tên agent, từ đang hiện trong ô, rồi đến từ của workspace.'
        )
      }
    >
      {!open && <SmallButton onClick={show}>Xem</SmallButton>}
    </Row>
  )
}

/** Sửa chữ sau khi nhận dạng: luật thay từ + lệnh nói. */
function FixGroup({
  rules,
  onRules,
  commands,
  onCommands
}: {
  rules: VoiceReplacement[]
  onRules: (r: VoiceReplacement[]) => void
  commands: boolean
  onCommands: (v: boolean) => void
}): React.JSX.Element {
  const saved = formatReplacements(rules)
  const [text, setText] = useDraft(saved)
  const commit = (): void => {
    const next = parseReplacements(text)
    if (formatReplacements(next) !== saved) onRules(next)
    else setText(saved)
  }
  return (
    <Group title="Sửa chữ sau khi nhận dạng">
      <Row
        label={'Nói "xuống dòng" để xuống dòng'}
        desc={'"…sửa hàm này, xuống dòng, rồi chạy test" → hai dòng. Nói "ký tự xuống dòng" hay "dấu xuống dòng" thì giữ nguyên chữ.'}
      >
        <Switch label="Lệnh xuống dòng" checked={commands} onChange={onCommands} />
      </Row>
      <div className="px-4 py-3">
        <p className="mb-2 text-[12px] leading-relaxed text-muted">
          Luật thay từ cho những chỗ máy hay nghe sai — mỗi dòng <span className="font-mono">chữ máy ra → chữ bạn muốn</span>, khớp trọn cụm, không phân biệt hoa
          thường. Tên hàm bị tách (<span className="font-mono">handle click</span>) hay sai hoa thường thì app tự sửa theo từ gợi ý, không cần luật.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={4}
          spellCheck={false}
          aria-label="Luật thay từ"
          placeholder={'hen đồ click → handleClick\nsu tan → zustand'}
          className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent"
        />
      </div>
    </Group>
  )
}
