import { useEffect, useState } from 'react'
import { AI_FIX_MODEL, AI_FIX_SECRET, formatMb, SONIOX_SECRET, SONIOX_USD_PER_HOUR, VOICE_GLOBAL_HOTKEYS, VOICE_HOTKEYS, VOICE_MODEL, type VoiceAiInfo, type VoiceCloudInfo, type VoiceHotkey } from '@shared/voice'
import { formatReplacements, parseReplacements } from '@shared/voiceVocab'
import type { VoiceEngine, VoiceGlobalHotkey, VoiceReplacement, VoiceSettings } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useVoice } from '../../store/voice'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, INPUT_MONO, Row, RowBlock, SectionTitle, Select, SmallButton, Switch, TEXTAREA, useSaveError } from './controls'
import { LevelBar } from './levels'

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
        right={<LevelBar appOnly />}
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
        <Row
          label={'Nói "gửi" để gửi'}
          desc={'Kết câu bằng "gửi" hoặc "gửi đi" → chèn rồi nhấn Enter luôn (bỏ qua khung xem trước). Chỉ nói "gửi" → nhấn Enter cho phần đã gõ sẵn. Tắt sẵn vì câu có chữ "gửi" ở cuối sẽ bị gửi đi.'}
        >
          <Switch label={'Nói "gửi" để gửi'} checked={v.sendCommand} onChange={(sendCommand) => set({ sendCommand })} />
        </Row>
        <GlobalRows v={v} set={set} />
      </Group>

      <MicGroup micId={v.micId} onChange={(micId) => set({ micId })} />

      <HotwordsGroup value={v.hotwords} onSave={(hotwords) => set({ hotwords })} auto={v.workspaceVocab} onAuto={(workspaceVocab) => set({ workspaceVocab })} />

      <FixGroup rules={v.replacements} onRules={(replacements) => set({ replacements })} commands={v.commands} onCommands={(commands) => set({ commands })} />

      <AiGroup on={v.aiFix} onChange={(aiFix) => set({ aiFix })} />

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

/** Soniox: API key + chi phí tháng này. */
function CloudRows(): React.JSX.Element {
  const [info, setInfo] = useState<VoiceCloudInfo | null>(null)
  const refresh = (): void => void window.stag.voice.cloudInfo().then(setInfo, () => {})
  useEffect(refresh, [])
  const minutes = (info?.monthSeconds ?? 0) / 60
  return (
    <>
      <KeyRow
        label="API key Soniox"
        secret={SONIOX_SECRET}
        hasKey={!!info?.hasKey}
        help="Tạo key tại console.soniox.com → API keys rồi dán vào đây. Key được mã hoá bằng tài khoản Windows của bạn."
        test={() => window.stag.voice.cloudTest()}
        onChanged={refresh}
      />
      <Row
        label="Chi phí"
        sub={`Soniox tính khoảng ${SONIOX_USD_PER_HOUR} USD mỗi giờ âm thanh (thời gian bạn giữ phím). Tháng này: ${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} phút ≈ ${((minutes / 60) * SONIOX_USD_PER_HOUR).toFixed(2)} USD (app tự đếm, hoá đơn thật xem ở console.soniox.com).`}
      />
    </>
  )
}

/** Sửa bằng AI (V4, tuỳ chọn): bật / tắt + API key Anthropic. */
function AiGroup({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  const [info, setInfo] = useState<VoiceAiInfo | null>(null)
  const refresh = (): void => void window.stag.voice.aiInfo().then(setInfo, () => {})
  useEffect(refresh, [])
  return (
    <Group title="Sửa bằng AI (tuỳ chọn)">
      <Row
        label="Nhờ AI sửa từ nghe sai"
        desc={`Sau khi nhận dạng, gửi câu vừa nói và danh sách từ của dự án cho Claude (${AI_FIX_MODEL}) để sửa từ code bị nghe sai, vd. "hen đồ click" → handleClick. Không gửi âm thanh hay chữ trong terminal. Khung xem trước hiện chữ ngay, AI sửa xong thì thay (có Hoàn tác). Mỗi câu tốn khoảng một phần trăm cent.`}
      >
        <Switch label="Nhờ AI sửa từ nghe sai" checked={on} onChange={onChange} />
      </Row>
      {on && (
        <KeyRow
          label="API key Anthropic"
          secret={AI_FIX_SECRET}
          hasKey={!!info?.hasKey}
          help={`Tạo key tại console.anthropic.com → API keys. Dùng chung bí mật ${AI_FIX_SECRET} với connector nếu đã có.`}
          test={() => window.stag.voice.aiTest()}
          onChanged={refresh}
        />
      )}
    </Group>
  )
}

/** Gõ vào ứng dụng khác (V4, tuỳ chọn): bật / tắt, phím tắt toàn hệ thống, báo nếu phím bị chiếm. */
function GlobalRows({ v, set }: { v: VoiceSettings; set: (p: Partial<VoiceSettings>) => void }): React.JSX.Element {
  const [err, setErr] = useState('')
  useEffect(() => {
    // Main đăng ký phím khi cửa sổ mất focus; hỏi lại sau mỗi lần đổi để báo phím đang bị ứng dụng khác dùng.
    const t = setTimeout(() => void window.stag.voice.globalInfo().then((i) => setErr(i.error), () => {}), 300)
    return () => clearTimeout(t)
  }, [v.global, v.globalHotkey])
  return (
    <>
      <Row
        label="Gõ vào ứng dụng khác"
        desc={`Khi stag.ai không ở trên cùng: bấm ${VOICE_GLOBAL_HOTKEYS[v.globalHotkey].label} để nói, bấm lần nữa để dừng (Windows không báo nhả phím cho phím tắt toàn hệ thống), Esc để huỷ. Chữ được dán vào ô đang gõ của ứng dụng đó (clipboard được trả lại như cũ), không xem trước, không tự nhấn Enter. Không gõ được vào cửa sổ chạy quyền quản trị.`}
        sub={err ? <span className="text-danger">{err}</span> : undefined}
      >
        <Switch label="Gõ vào ứng dụng khác" checked={v.global} onChange={(global) => set({ global })} />
      </Row>
      {v.global && (
        <Row label="Phím tắt toàn hệ thống" desc="Trong stag.ai vẫn dùng phím giữ-để-nói ở trên.">
          <Select
            label="Phím tắt toàn hệ thống"
            value={v.globalHotkey}
            onChange={(globalHotkey: VoiceGlobalHotkey) => set({ globalHotkey })}
            options={(Object.keys(VOICE_GLOBAL_HOTKEYS) as VoiceGlobalHotkey[]).map((k) => ({ value: k, label: VOICE_GLOBAL_HOTKEYS[k].label }))}
          />
        </Row>
      )}
    </>
  )
}

/** Ô dán API key: lưu vào kho bí mật (app không hiện lại key), lưu xong thì thử luôn; Kiểm tra / Xoá key. */
function KeyRow({
  label,
  secret,
  hasKey,
  help,
  test,
  onChanged
}: {
  label: string
  secret: string
  hasKey: boolean
  help: string
  test: () => Promise<void>
  onChanged: () => void
}): React.JSX.Element {
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = onChanged
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
      await window.stag.secrets.set(secret, key.trim())
      setKey('')
      await test()
    }, 'Đã lưu và thử key: dùng được.')
  return (
    <Row
      label={label}
      desc={help}
      sub={
        msg ? (
          <span className={msg.ok ? 'text-work' : 'text-danger'}>{msg.text}</span>
        ) : hasKey ? (
          `Đã lưu (mã hoá trong bí mật ${secret}, app không hiện lại). Dán key mới để thay.`
        ) : undefined
      }
    >
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
        placeholder={hasKey ? '•••••••• (đã lưu)' : 'Dán API key'}
        aria-label={label}
        className={`w-56 ${INPUT_MONO}`}
      />
      <SmallButton onClick={() => void save()} disabled={!key.trim() || busy}>
        Lưu
      </SmallButton>
      {hasKey && (
        <>
          <SmallButton onClick={() => void act(() => test(), 'Key dùng được.')} disabled={busy}>
            {busy ? 'Đang thử…' : 'Kiểm tra'}
          </SmallButton>
          <SmallButton onClick={() => void act(() => window.stag.secrets.remove(secret), 'Đã xoá key.')} disabled={busy}>
            Xoá key
          </SmallButton>
        </>
      )}
    </Row>
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
          <span className="h-1.5 w-40 overflow-hidden rounded bg-panel-3">
            <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
          </span>
          <span className="font-mono text-[11px]">
            {formatMb(status.received ?? 0)} / {formatMb(status.total ?? VOICE_MODEL.bytes)} ({pct}%)
          </span>
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
      desc = <span className="text-danger">{status.error}</span>
      action = <SmallButton onClick={() => void window.stag.voice.download()}>Thử lại</SmallButton>
      break
    default:
      desc = `Cần tải một lần ${formatMb(VOICE_MODEL.bytes)} từ GitHub (k2-fsa/sherpa-onnx). App kiểm tra mã SHA-256 trước khi dùng.`
      action = <SmallButton onClick={() => void window.stag.voice.download()}>Tải model</SmallButton>
  }
  return (
    <Group title={cloud ? 'Model trên máy (dự phòng, không bắt buộc)' : 'Model nhận dạng'}>
      <Row label={VOICE_MODEL.label} sub={desc}>
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
    <Row label="Tiến trình nhận dạng" sub={status.error && status.model === 'ready' ? <span className="text-danger">{status.error}</span> : text}>
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
      <Row label="Micro" sub={err ? <span className="text-danger">{err}</span> : named ? undefined : 'Bấm "Hiện tên micro" để thấy tên từng micro.'}>
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
      <RowBlock
        label="Từ bạn tự thêm"
        htmlFor="voice-hotwords"
        desc="Luôn được ưu tiên: tên riêng, tên hàm, thư viện bạn hay nói (vd. handleClick, zustand) — mỗi dòng một mục, viết đúng chính tả muốn ra. Tên agent được thêm tự động."
      >
        <textarea
          id="voice-hotwords"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={5}
          spellCheck={false}
          aria-label="Từ gợi ý"
          placeholder={'handleClick\nzustand\nnpm install'}
          className={`${TEXTAREA} w-full`}
        />
      </RowBlock>
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
      desc="Mỗi lần nói, app chọn khoảng 60 từ hợp nhất: từ bạn thêm, tên agent, từ đang hiện trong ô, rồi đến từ của workspace."
      sub={
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
        ) : undefined
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
      <RowBlock
        label="Luật thay từ"
        htmlFor="voice-rules"
        desc="Cho những chỗ máy hay nghe sai — mỗi dòng “chữ máy ra → chữ bạn muốn”, khớp trọn cụm, không phân biệt hoa thường. Tên hàm bị tách (handle click) hay sai hoa thường thì app tự sửa theo từ gợi ý, không cần luật."
      >
        <textarea
          id="voice-rules"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={4}
          spellCheck={false}
          aria-label="Luật thay từ"
          placeholder={'hen đồ click → handleClick\nsu tan → zustand'}
          className={`${TEXTAREA} w-full`}
        />
      </RowBlock>
    </Group>
  )
}
