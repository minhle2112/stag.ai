import { useEffect, useState } from 'react'
import { AI_FIX_MODEL, AI_FIX_SECRET, formatMb, SONIOX_SECRET, SONIOX_USD_PER_HOUR, VOICE_GLOBAL_HOTKEYS, VOICE_HOTKEYS, VOICE_MODEL, type VoiceAiInfo, type VoiceCloudInfo, type VoiceHotkey } from '@shared/voice'
import { formatReplacements, parseReplacements } from '@shared/voiceVocab'
import type { VoiceEngine, VoiceGlobalHotkey, VoiceReplacement, VoiceSettings } from '@shared/types'
import { fmtNumber, useT } from '../../i18n'
import { useSettings } from '../../store/settings'
import { useVoice } from '../../store/voice'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, INPUT_MONO, Row, RowBlock, SectionTitle, Select, SmallButton, Switch, TEXTAREA, useSaveError } from './controls'
import { LevelBar } from './levels'

const UNLOAD = [1, 5, 15, 30, 60, 0]
/** Ví dụ luật thay từ: chữ tiếng Việt máy hay nghe sai từ code. */
const RULES_SAMPLE = 'hen đồ click → handleClick\nsu tan → zustand' // i18n-ignore: sample Vietnamese mis-hearings

/** Nhãn của lựa chọn giải phóng model (tính lúc vẽ, theo ngôn ngữ). */
function unloadLabel(t: ReturnType<typeof useT>, minutes: number): string {
  if (minutes === 0) return t('voice.settings.unloadNever')
  if (minutes === 60) return t('voice.settings.unloadHour')
  return t('voice.settings.unloadMinutes', { count: minutes })
}

/** Cài đặt → Giọng nói (V1): model nhận dạng, phím tắt, micro, từ gợi ý, giải phóng RAM. */
export function VoiceSection(): React.JSX.Element {
  const v = useSettings((s) => s.value.app.voice)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const set = (patch: Partial<VoiceSettings>): void => run(save({ voice: patch }))
  const t = useT()
  const unload = (UNLOAD.includes(v.unloadMinutes) ? UNLOAD : [...UNLOAD, v.unloadMinutes]).map((value) => ({ value, label: unloadLabel(t, value) }))

  return (
    <>
      <SectionTitle
        title={t('voice.settings.title')}
        desc={`${t('voice.settings.desc', { key: VOICE_HOTKEYS[v.hotkey] })} ${v.engine === 'soniox' ? t('voice.settings.descCloud') : t('voice.settings.descLocal')}`}
        right={<LevelBar appOnly />}
      />
      <ErrorBar error={error} />

      <Group title={t('voice.settings.engine')}>
        <Row label={t('voice.settings.engineWhich')} desc={v.engine === 'soniox' ? t('voice.settings.engineCloudDesc') : t('voice.settings.engineLocalDesc')}>
          <Select
            label={t('voice.settings.engine')}
            value={v.engine}
            onChange={(engine: VoiceEngine) => set({ engine })}
            options={[
              { value: 'local', label: t('voice.settings.engineLocal') },
              { value: 'soniox', label: t('voice.settings.engineCloud') }
            ]}
          />
        </Row>
        {v.engine === 'soniox' && <CloudRows />}
      </Group>

      <ModelGroup cloud={v.engine === 'soniox'} />

      <Group title={t('voice.settings.usage')}>
        <Row label={t('voice.settings.enable')} desc={t('voice.settings.enableDesc')}>
          <Switch label={t('voice.settings.enable')} checked={v.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label={t('voice.settings.hotkey')} desc={t('voice.settings.hotkeyDesc')}>
          <Select
            label={t('voice.settings.hotkey')}
            value={v.hotkey}
            onChange={(hotkey: VoiceHotkey) => set({ hotkey })}
            options={(Object.keys(VOICE_HOTKEYS) as VoiceHotkey[]).map((k) => ({ value: k, label: VOICE_HOTKEYS[k] }))}
          />
        </Row>
        <Row label={t('voice.settings.preview')} desc={t('voice.settings.previewDesc')}>
          <Switch label={t('voice.settings.preview')} checked={v.preview} onChange={(preview) => set({ preview })} />
        </Row>
        <Row label={t('voice.settings.sendCommand')} desc={t('voice.settings.sendCommandDesc')}>
          <Switch label={t('voice.settings.sendCommand')} checked={v.sendCommand} onChange={(sendCommand) => set({ sendCommand })} />
        </Row>
        <GlobalRows v={v} set={set} />
      </Group>

      <MicGroup micId={v.micId} onChange={(micId) => set({ micId })} />

      <HotwordsGroup value={v.hotwords} onSave={(hotwords) => set({ hotwords })} auto={v.workspaceVocab} onAuto={(workspaceVocab) => set({ workspaceVocab })} />

      <FixGroup rules={v.replacements} onRules={(replacements) => set({ replacements })} commands={v.commands} onCommands={(commands) => set({ commands })} />

      <AiGroup on={v.aiFix} onChange={(aiFix) => set({ aiFix })} />

      <Group title={t('voice.settings.ram')}>
        <Row label={t('voice.settings.unload')} desc={t('voice.settings.unloadDesc')}>
          <Select label={t('voice.settings.unload')} value={v.unloadMinutes} onChange={(unloadMinutes: number) => set({ unloadMinutes })} options={unload} />
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
  const t = useT()
  return (
    <>
      <KeyRow
        label={t('voice.settings.sonioxKey')}
        secret={SONIOX_SECRET}
        hasKey={!!info?.hasKey}
        help={t('voice.settings.sonioxKeyHelp')}
        test={() => window.stag.voice.cloudTest()}
        onChanged={refresh}
      />
      <Row
        label={t('voice.settings.cost')}
        sub={t('voice.settings.costDesc', {
          rate: fmtNumber(SONIOX_USD_PER_HOUR),
          minutes: minutes < 10 ? fmtNumber(minutes, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : fmtNumber(Math.round(minutes)),
          usd: fmtNumber((minutes / 60) * SONIOX_USD_PER_HOUR, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        })}
      />
    </>
  )
}

/** Sửa bằng AI (V4, tuỳ chọn): bật / tắt + API key Anthropic. */
function AiGroup({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  const [info, setInfo] = useState<VoiceAiInfo | null>(null)
  const refresh = (): void => void window.stag.voice.aiInfo().then(setInfo, () => {})
  useEffect(refresh, [])
  const t = useT()
  return (
    <Group title={t('voice.settings.ai')}>
      <Row label={t('voice.settings.aiFix')} desc={t('voice.settings.aiFixDesc', { model: AI_FIX_MODEL })}>
        <Switch label={t('voice.settings.aiFix')} checked={on} onChange={onChange} />
      </Row>
      {on && (
        <KeyRow
          label={t('voice.settings.anthropicKey')}
          secret={AI_FIX_SECRET}
          hasKey={!!info?.hasKey}
          help={t('voice.settings.anthropicKeyHelp', { secret: AI_FIX_SECRET })}
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
  const t = useT()
  useEffect(() => {
    // Main đăng ký phím khi cửa sổ mất focus; hỏi lại sau mỗi lần đổi để báo phím đang bị ứng dụng khác dùng.
    const timer = setTimeout(() => void window.stag.voice.globalInfo().then((i) => setErr(i.error), () => {}), 300)
    return () => clearTimeout(timer)
  }, [v.global, v.globalHotkey])
  return (
    <>
      <Row
        label={t('voice.settings.global')}
        desc={t('voice.settings.globalDesc', { key: VOICE_GLOBAL_HOTKEYS[v.globalHotkey].label })}
        sub={err ? <span className="text-danger">{err}</span> : undefined}
      >
        <Switch label={t('voice.settings.global')} checked={v.global} onChange={(global) => set({ global })} />
      </Row>
      {v.global && (
        <Row label={t('voice.settings.globalHotkey')} desc={t('voice.settings.globalHotkeyDesc')}>
          <Select
            label={t('voice.settings.globalHotkey')}
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
  const t = useT()
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
    }, t('voice.key.savedOk'))
  return (
    <Row
      label={label}
      desc={help}
      sub={
        msg ? (
          <span className={msg.ok ? 'text-work' : 'text-danger'}>{msg.text}</span>
        ) : hasKey ? (
          t('voice.key.saved', { secret })
        ) : undefined
      }
    >
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && void save()}
        placeholder={hasKey ? t('voice.key.savedPlaceholder') : t('voice.key.paste')}
        aria-label={label}
        className={`w-56 ${INPUT_MONO}`}
      />
      <SmallButton onClick={() => void save()} disabled={!key.trim() || busy}>
        {t('common.save')}
      </SmallButton>
      {hasKey && (
        <>
          <SmallButton onClick={() => void act(() => test(), t('voice.key.works'))} disabled={busy}>
            {busy ? t('voice.key.testing') : t('voice.key.test')}
          </SmallButton>
          <SmallButton onClick={() => void act(() => window.stag.secrets.remove(secret), t('voice.key.removed'))} disabled={busy}>
            {t('voice.key.remove')}
          </SmallButton>
        </>
      )}
    </Row>
  )
}

function ModelGroup({ cloud }: { cloud: boolean }): React.JSX.Element {
  const status = useVoice((s) => s.status)
  const pct = status.total ? Math.min(100, Math.round(((status.received ?? 0) * 100) / status.total)) : 0
  const t = useT()
  let desc: React.ReactNode
  let action: React.ReactNode
  switch (status.model) {
    case 'ready':
      desc = t('voice.model.ready')
      action = <SmallButton onClick={() => void window.stag.voice.remove()}>{t('voice.model.remove')}</SmallButton>
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
      action = <SmallButton onClick={() => void window.stag.voice.cancel()}>{t('common.cancel')}</SmallButton>
      break
    case 'verifying':
      desc = t('voice.model.verifying')
      break
    case 'extracting':
      desc = t('voice.model.extracting')
      break
    case 'error':
      desc = <span className="text-danger">{status.error}</span>
      action = <SmallButton onClick={() => void window.stag.voice.download()}>{t('common.retry')}</SmallButton>
      break
    default:
      desc = t('voice.model.missing', { size: formatMb(VOICE_MODEL.bytes) })
      action = <SmallButton onClick={() => void window.stag.voice.download()}>{t('voice.model.download')}</SmallButton>
  }
  return (
    <Group title={cloud ? t('voice.model.titleFallback') : t('voice.model.title')}>
      <Row label={VOICE_MODEL.label} sub={desc}>
        {action}
      </Row>
    </Group>
  )
}

function EngineRow(): React.JSX.Element {
  const status = useVoice((s) => s.status)
  const t = useT()
  const text = status.engine === 'ready' ? t('voice.engineRow.ready') : status.engine === 'loading' ? t('voice.engineRow.loading') : t('voice.engineRow.off')
  return (
    <Row label={t('voice.engineRow.label')} sub={status.error && status.model === 'ready' ? <span className="text-danger">{status.error}</span> : text}>
      {status.engine !== 'off' && <SmallButton onClick={() => void window.stag.voice.unload()}>{t('voice.engineRow.unload')}</SmallButton>}
    </Row>
  )
}

/** Chọn micro. Tên micro chỉ hiện sau khi app được dùng micro một lần (Chromium giấu tên trước đó). */
function MicGroup({ micId, onChange }: { micId: string; onChange: (id: string) => void }): React.JSX.Element {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [err, setErr] = useState('')
  const t = useT()
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
      s.getTracks().forEach((tr) => tr.stop())
      list()
    } catch (e) {
      setErr(t('voice.run.micFailed', { message: (e as Error).message }))
    }
  }
  const options = [{ value: '', label: t('voice.mic.default') }, ...mics.map((m, i) => ({ value: m.deviceId, label: m.label || t('voice.mic.numbered', { n: i + 1 }) }))]
  if (micId && !mics.some((m) => m.deviceId === micId)) options.push({ value: micId, label: t('voice.mic.unplugged') })
  return (
    <Group title={t('voice.mic.title')}>
      <Row label={t('voice.mic.title')} sub={err ? <span className="text-danger">{err}</span> : named ? undefined : t('voice.mic.showNamesHint')}>
        {!named && mics.length > 0 && <SmallButton onClick={() => void allow()}>{t('voice.mic.showNames')}</SmallButton>}
        <Select label={t('voice.mic.title')} value={micId} onChange={onChange} options={options} />
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
  const t = useT()
  return (
    <Group title={t('voice.hotwords.title')}>
      <Row label={t('voice.hotwords.auto')} desc={t('voice.hotwords.autoDesc')}>
        <Switch label={t('voice.hotwords.auto')} checked={auto} onChange={onAuto} />
      </Row>
      {auto && <WorkspaceTerms />}
      <RowBlock label={t('voice.hotwords.manual')} htmlFor="voice-hotwords" desc={t('voice.hotwords.manualDesc')}>
        <textarea
          id="voice-hotwords"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={5}
          spellCheck={false}
          aria-label={t('voice.hotwords.title')}
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
  const t = useT()
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
      label={t('voice.terms.label', { name: ws.name })}
      desc={t('voice.terms.desc')}
      sub={
        open ? (
          terms === null ? (
            t('voice.terms.scanning')
          ) : terms.length ? (
            <span className="font-mono text-[11px] leading-relaxed">
              {t('voice.terms.list', { count: terms.length, terms: terms.slice(0, 80).join(', ') })}
              {terms.length > 80 ? '…' : ''}
            </span>
          ) : (
            t('voice.terms.none')
          )
        ) : undefined
      }
    >
      {!open && <SmallButton onClick={show}>{t('voice.terms.view')}</SmallButton>}
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
  const t = useT()
  return (
    <Group title={t('voice.fix.title')}>
      <Row label={t('voice.fix.newline')} desc={t('voice.fix.newlineDesc')}>
        <Switch label={t('voice.fix.newlineSwitch')} checked={commands} onChange={onCommands} />
      </Row>
      <RowBlock label={t('voice.fix.rules')} htmlFor="voice-rules" desc={t('voice.fix.rulesDesc')}>
        <textarea
          id="voice-rules"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          rows={4}
          spellCheck={false}
          aria-label={t('voice.fix.rules')}
          placeholder={RULES_SAMPLE}
          className={`${TEXTAREA} w-full`}
        />
      </RowBlock>
    </Group>
  )
}
