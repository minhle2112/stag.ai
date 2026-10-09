import { useEffect, useState, type ReactNode } from 'react'
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_EVENTS,
  pluginToolName,
  RISKY_CAPABILITIES,
  type InstalledPlugin,
  type PluginCapability,
  type PluginConfigField,
  type PluginState
} from '@shared/plugins'
import { usePlugins } from '../../store/plugins'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Button, Modal } from '../Modal'
import { Badge, errText, type Tone } from './AdaptersSection'
import { ErrorBar, SmallButton } from './controls'
import { LevelPicker, LevelToggle, useAgentLevel, useLevel, type Level, type LevelKey } from './levels'
import { SkillAvatar } from './SkillsSection'

/**
 * Settings → Plugin (alpha, bố cục theo trang Plugins của Paperclip): danh sách đã cài, cài từ npm / thư mục,
 * duyệt quyền trước khi chạy, trang mỗi plugin với Cấu hình / Trạng thái / Giới thiệu.
 */

const STATE: Record<PluginState, { label: string; tone: Tone }> = {
  ready: { label: 'Sẵn sàng', tone: 'ok' },
  starting: { label: 'Đang khởi động', tone: 'warn' },
  stopped: { label: 'Đã dừng', tone: 'muted' },
  disabled: { label: 'Đang tắt', tone: 'muted' },
  error: { label: 'Lỗi', tone: 'bad' },
  approval_pending: { label: 'Chờ duyệt quyền', tone: 'warn' },
  upgrade_pending: { label: 'Chờ duyệt quyền mới', tone: 'warn' }
}
const TONE_TEXT: Record<Tone, string> = { ok: 'text-emerald-300 border-emerald-500/40', warn: 'text-amber-300 border-amber-400/40', bad: 'text-red-300 border-red-500/40', muted: 'text-muted border-line' }
const SLOT: Record<string, string> = { sidebar: 'Thanh bên', globalToolbarButton: 'Thanh trên cùng', agentMenu: 'Menu ⋯ của agent' }

const pluginSetApp =
  (id: string) =>
  (on: boolean): Promise<void> => {
    const toggles = { ...useSettings.getState().value.app.plugins.toggles }
    if (on) delete toggles[id]
    else toggles[id] = false
    return useSettings.getState().save({ plugins: { toggles } })
  }

function StateBadge({ state }: { state: PluginState }): React.JSX.Element {
  const s = STATE[state]
  return <span className={`rounded-full border px-2 py-px text-[10.5px] ${TONE_TEXT[s.tone]}`}>{s.label}</span>
}

export function PluginsSection(): React.JSX.Element {
  const focus = useUi((s) => s.settingsFocus)
  const agentLevel = useAgentLevel()
  const items = usePlugins((s) => s.items)
  const [open, setOpen] = useState<string | null>(focus?.plugin ?? null)
  const [installing, setInstalling] = useState(false)
  const [level, setLevel] = useState<LevelKey>(() => agentLevel(focus?.agentId))
  const lv = useLevel(level)

  useEffect(() => {
    if (focus?.plugin) setOpen(focus.plugin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const plugin = open ? items.find((p) => p.manifest.id === open) : undefined
  return (
    <>
      {plugin ? (
        <PluginDetail key={plugin.manifest.id} p={plugin} lv={lv} onBack={() => setOpen(null)} />
      ) : (
        <PluginList items={items} level={level} setLevel={setLevel} lv={lv} onOpen={setOpen} onInstall={() => setInstalling(true)} />
      )}
      {installing && (
        <InstallPluginDialog
          onClose={() => setInstalling(false)}
          onInstalled={(p) => {
            setInstalling(false)
            setOpen(p.manifest.id)
          }}
        />
      )}
    </>
  )
}

function PluginList(p: {
  items: InstalledPlugin[]
  level: LevelKey
  setLevel: (l: LevelKey) => void
  lv: Level
  onOpen: (id: string) => void
  onInstall: () => void
}): React.JSX.Element {
  const loaded = usePlugins((s) => s.loaded)
  return (
    <>
      <div className="mb-2 flex items-center gap-2.5">
        <h1 className="text-[18px] font-semibold tracking-tight">Plugin</h1>
        <span className="rounded-full border border-amber-400/40 px-2 py-px text-[10.5px] text-amber-300">Alpha</span>
        <div className="flex-1" />
        <button type="button" onClick={p.onInstall} className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90">
          <span className="text-[15px] leading-none">+</span> Cài plugin
        </button>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Plugin mở rộng chính app stag.ai: thêm nút ở thanh bên / thanh trên cùng / menu agent, thêm tool cho agent, nghe sự kiện của app. Mỗi plugin chạy trong
        tiến trình riêng và chỉ chạy sau khi bạn duyệt quyền.
      </p>
      <div className="mb-5 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-amber-200/90">
        Plugin là tính năng alpha. Plugin chạy chương trình trên máy bạn với quyền của bạn; quyền bạn duyệt chỉ giới hạn những gì nó làm <b>qua stag.ai</b>{' '}
        (gõ vào agent, đọc vault…). Chỉ cài từ nguồn bạn tin.
      </div>
      <LevelPicker level={p.level} setLevel={p.setLevel} field="plugins" />
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <PuzzleIcon className="h-4 w-4 text-muted" /> Đã cài
        {p.items.length > 0 && <span className="text-[11.5px] font-normal text-muted">{p.items.length}</span>}
      </div>
      {!loaded ? null : p.items.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <PuzzleIcon className="mb-3 h-7 w-7 text-muted" />
          <div className="text-[13px] font-medium">Chưa cài plugin nào</div>
          <div className="mt-1 max-w-md text-[12px] leading-relaxed text-muted">
            Bấm "Cài plugin" và chọn một gói npm hoặc một thư mục có <code>stagPlugin</code> trong package.json. Plugin mẫu trong mã nguồn:{' '}
            <code>examples/stag-plugin-hello</code>.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line bg-panel">
          {p.items.map((x) => (
            <div
              key={x.manifest.id}
              role="button"
              tabIndex={0}
              onClick={() => p.onOpen(x.manifest.id)}
              onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && p.onOpen(x.manifest.id)}
              className="group flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-panel-2/60"
            >
              <SkillAvatar name={x.manifest.displayName} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{x.manifest.displayName}</span>
                  <Badge>v{x.version}</Badge>
                  <StateBadge state={x.status.state} />
                </div>
                <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">
                  {[
                    x.manifest.id,
                    x.source.type === 'npm' ? `npm ${x.source.name}` : 'thư mục',
                    x.manifest.tools.length ? `${x.manifest.tools.length} tool` : '',
                    x.manifest.ui.slots.length ? `${x.manifest.ui.slots.length} nút` : '',
                    x.manifest.events.length ? `${x.manifest.events.length} sự kiện` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <LevelToggle k={x.manifest.id} level={p.lv} label={x.manifest.displayName} field="plugins" setApp={pluginSetApp(x.manifest.id)} />
              <span className="text-muted group-hover:text-fg">›</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---- trang một plugin ----

type Tab = 'config' | 'status' | 'about'

function PluginDetail({ p, lv, onBack }: { p: InstalledPlugin; lv: Level; onBack: () => void }): React.JSX.Element {
  const m = p.manifest
  const [tab, setTab] = useState<Tab>(m.instanceConfigSchema ? 'config' : 'status')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const pending = p.status.state === 'approval_pending' || p.status.state === 'upgrade_pending'

  const act = (label: string, fn: () => Promise<unknown>): void => {
    setBusy(label)
    setError('')
    fn()
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(''))
  }

  return (
    <>
      <button type="button" onClick={onBack} className="mb-3 text-[12.5px] text-muted hover:text-fg">
        ← Tất cả plugin
      </button>
      <div className="mb-4 flex items-start gap-3">
        <SkillAvatar name={m.displayName} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[18px] font-semibold">{m.displayName}</h1>
            <Badge>v{p.version}</Badge>
            <StateBadge state={p.status.state} />
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{m.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11.5px] text-muted">{lv.lvl === 'app' ? 'Mọi nơi' : lv.name}</span>
          <LevelToggle k={m.id} level={lv} label={m.displayName} field="plugins" setApp={pluginSetApp(m.id)} />
        </div>
      </div>
      <ErrorBar error={error} />

      {pending && <ApprovalCard p={p} busy={busy === 'approve'} onApprove={() => act('approve', () => window.stag.plugins.approve(m.id))} />}
      {p.status.state === 'error' && p.status.lastError && <ErrorBar error={p.status.lastError} />}

      <div className="mb-3 flex items-center gap-1 border-b border-line">
        {(
          [
            ['config', 'Cấu hình'],
            ['status', 'Trạng thái'],
            ['about', 'Giới thiệu']
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-[12.5px] ${tab === id ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex gap-1.5 pb-1">
          {m.entrypoints.worker && (
            <SmallButton onClick={() => act('restart', () => window.stag.plugins.restart(m.id))} disabled={!!busy}>
              {busy === 'restart' ? 'Đang khởi động lại…' : 'Khởi động lại'}
            </SmallButton>
          )}
          <SmallButton onClick={() => act('reload', () => window.stag.plugins.reload(m.id))} disabled={!!busy}>
            {busy === 'reload' ? 'Đang đọc…' : p.source.type === 'npm' ? 'Cài lại' : 'Đọc lại gói'}
          </SmallButton>
          <button
            type="button"
            onClick={() => (confirmRemove ? act('remove', async () => (await window.stag.plugins.remove(m.id), onBack())) : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
            disabled={!!busy}
            className={`rounded-md px-3 py-1.5 text-[12.5px] ${confirmRemove ? 'bg-red-500/90 text-white' : 'bg-panel-2 text-red-300 hover:bg-line'}`}
          >
            {confirmRemove ? 'Bấm lần nữa để gỡ' : 'Gỡ'}
          </button>
        </div>
      </div>

      {tab === 'config' && <ConfigForm p={p} />}
      {tab === 'status' && <StatusTab p={p} />}
      {tab === 'about' && <AboutTab p={p} />}
    </>
  )
}

function ApprovalCard({ p, busy, onApprove }: { p: InstalledPlugin; busy: boolean; onApprove: () => void }): React.JSX.Element {
  const fresh = p.manifest.capabilities.filter((c) => !p.approved.includes(c))
  const upgrade = p.status.state === 'upgrade_pending'
  return (
    <div className="mb-5 rounded-lg border border-amber-400/40 bg-amber-400/[0.06] px-4 py-3.5">
      <div className="mb-1 text-[13px] font-semibold text-amber-200">{upgrade ? 'Bản mới xin thêm quyền' : 'Duyệt quyền để chạy plugin'}</div>
      <p className="mb-3 text-[12px] leading-relaxed text-amber-100/80">
        {upgrade
          ? 'Plugin chưa chạy lại cho tới khi bạn duyệt các quyền mới dưới đây.'
          : `${p.manifest.displayName} của ${p.manifest.author || 'tác giả không rõ'} xin các quyền dưới đây. Plugin chưa chạy cho tới khi bạn duyệt.`}
      </p>
      {p.manifest.capabilities.length === 0 ? (
        <div className="mb-3 text-[12px] text-muted">Không xin quyền nào.</div>
      ) : (
        <ul className="mb-3 space-y-1">
          {p.manifest.capabilities.map((c) => (
            <CapabilityLine key={c} c={c} isNew={upgrade && fresh.includes(c)} />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onApprove}
        disabled={busy}
        className="rounded-md bg-amber-300 px-3 py-1.5 text-[12.5px] font-semibold text-black hover:brightness-105 disabled:opacity-50"
      >
        {busy ? 'Đang khởi động…' : upgrade ? 'Duyệt quyền mới và chạy' : 'Duyệt và chạy'}
      </button>
    </div>
  )
}

function CapabilityLine({ c, isNew }: { c: PluginCapability; isNew?: boolean }): React.JSX.Element {
  const risky = RISKY_CAPABILITIES.includes(c)
  return (
    <li className="flex items-baseline gap-2 text-[12.5px]">
      <span className={risky ? 'text-red-300' : 'text-fg'}>•</span>
      <span className={risky ? 'text-red-200' : ''}>{PLUGIN_CAPABILITIES[c]}</span>
      <code className="text-[11px] text-muted">{c}</code>
      {isNew && <span className="rounded bg-amber-400/20 px-1.5 text-[10.5px] text-amber-200">mới</span>}
    </li>
  )
}

function ConfigForm({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const schema = p.manifest.instanceConfigSchema
  const [draft, setDraft] = useState<Record<string, unknown>>(p.config)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  if (!schema || !Object.keys(schema.properties).length) return <div className="text-[12.5px] text-muted">Plugin này không có gì để cấu hình.</div>
  const dirty = JSON.stringify(draft) !== JSON.stringify(p.config)
  const save = (): void => {
    setSaving(true)
    setMsg(null)
    window.stag.plugins
      .setConfig(p.manifest.id, draft)
      .then((x) => {
        setDraft(x.config)
        setMsg({ text: p.status.state === 'ready' && p.manifest.entrypoints.worker ? 'Đã lưu, plugin đã nhận cấu hình mới.' : 'Đã lưu.' })
      })
      .catch((e) => setMsg({ text: errText(e), bad: true }))
      .finally(() => setSaving(false))
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="rounded-lg border border-line bg-panel px-4 py-4"
    >
      {Object.entries(schema.properties).map(([k, f]) => (
        <Field key={k} name={k} f={f} required={schema.required.includes(k)} value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} />
      ))}
      {msg && <div className={`mb-3 rounded-md border px-3 py-2 text-[12px] ${msg.bad ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-line bg-panel-2/60'}`}>{msg.text}</div>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || !dirty} className="rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
        {dirty && <SmallButton onClick={() => setDraft(p.config)}>Huỷ</SmallButton>}
        <span className="text-[11.5px] text-muted">Không ghi mật khẩu / token ở đây: cấu hình lưu dạng chữ thường.</span>
      </div>
    </form>
  )
}

function Field({ name, f, required, value, onChange }: { name: string; f: PluginConfigField; required: boolean; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const id = `plugin-cfg-${name}`
  const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent'
  let control: ReactNode
  if (f.type === 'boolean') control = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
  else if (f.enum)
    control = (
      <select id={id} value={String(value ?? '')} onChange={(e) => onChange(f.type === 'string' ? e.target.value : Number(e.target.value))} className={input}>
        {!required && <option value="">(mặc định)</option>}
        {f.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    )
  else if (f.format === 'textarea') control = <textarea id={id} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={input} />
  else
    control = (
      <input
        id={id}
        type={f.type === 'string' ? 'text' : 'number'}
        value={value === undefined || value === null ? '' : String(value)}
        placeholder={f.default !== undefined ? String(f.default) : ''}
        min={f.minimum}
        max={f.maximum}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`${input} ${f.format === 'url' ? 'font-mono' : ''}`}
      />
    )
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium">
        {f.title ?? name}
        {required && <span className="text-red-300"> *</span>}
        <code className="ml-2 text-[11px] font-normal text-muted">{name}</code>
      </label>
      {control}
      {f.description && <p className="mt-1 text-[11.5px] text-muted">{f.description}</p>}
    </div>
  )
}

function since(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s} giây` : s < 3600 ? `${Math.floor(s / 60)} phút` : `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`
}

function StatusTab({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  const s = p.status
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  const row = (label: string, value: ReactNode): React.JSX.Element => (
    <div className="flex items-baseline gap-3 px-4 py-2 text-[12.5px]">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  )
  return (
    <div className="space-y-5">
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {row('Trạng thái', <StateBadge state={s.state} />)}
        {m.entrypoints.worker ? (
          <>
            {row('Worker', s.pid ? `đang chạy · PID ${s.pid}` : 'không chạy')}
            {row('Chạy được', s.pid ? since(s.startedAt) : '—')}
            {row('Khởi động lại', String(s.restarts))}
            {row(
              'Sức khoẻ',
              <span className="flex items-center gap-2">
                {s.health ? (
                  <span className={s.health.ok ? 'text-emerald-300' : 'text-red-300'}>
                    {s.health.ok ? 'ổn' : 'lỗi'}
                    {s.health.message ? ` · ${s.health.message}` : ''} · {new Date(s.health.at).toLocaleTimeString()}
                  </span>
                ) : (
                  <span className="text-muted">chưa kiểm (30 giây / lần)</span>
                )}
                {s.pid && <SmallButton onClick={() => void window.stag.plugins.health(m.id)}>Kiểm tra</SmallButton>}
              </span>
            )}
            {row('Lần gọi tool', String(s.toolCalls))}
            {row('Sự kiện đã gửi', String(s.events))}
          </>
        ) : (
          row('Worker', 'không có (plugin chỉ có nút mở địa chỉ)')
        )}
        {s.lastError && row('Lỗi gần nhất', <span className="text-red-300">{s.lastError}</span>)}
      </div>

      {m.tools.length > 0 && (
        <Block title="Tool cho agent">
          {m.tools.map((t) => (
            <div key={t.name} className="px-4 py-2 text-[12.5px]">
              <code className="text-[12px]">{pluginToolName(m.id, t.name)}</code> <span className="text-muted">· {t.displayName}</span>
              <div className="mt-0.5 text-[11.5px] text-muted">{t.description}</div>
            </div>
          ))}
        </Block>
      )}
      {m.ui.slots.length > 0 && (
        <Block title="Nút">
          {m.ui.slots.map((x) => (
            <div key={x.id} className="flex items-baseline gap-3 px-4 py-2 text-[12.5px]">
              <span className="w-40 shrink-0 text-muted">{SLOT[x.type]}</span>
              <span className="font-medium">{x.displayName}</span>
              <span className="truncate font-mono text-[11px] text-muted">{x.open ? `mở ${x.open.url} (${x.open.target === 'browser' ? 'trong app' : 'trình duyệt'})` : `gọi ${x.action}`}</span>
            </div>
          ))}
        </Block>
      )}
      {m.events.length > 0 && (
        <Block title="Sự kiện nhận">
          {m.events.map((e) => (
            <div key={e} className="flex gap-3 px-4 py-2 text-[12.5px]">
              <code className="w-44 shrink-0 text-[11.5px]">{e}</code>
              <span className="text-muted">{PLUGIN_EVENTS[e]}</span>
            </div>
          ))}
        </Block>
      )}
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Nhật ký (200 dòng gần nhất)</div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {p.logs.length === 0 ? (
            <span className="text-muted">Chưa có gì.</span>
          ) : (
            [...p.logs].reverse().map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-300' : ''}>
                <span className="text-muted">{new Date(l.at).toLocaleTimeString()} </span>
                {l.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">{children}</div>
    </div>
  )
}

function AboutTab({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  const row = (label: string, value: ReactNode): React.JSX.Element => (
    <div className="flex items-baseline gap-3 px-4 py-2 text-[12.5px]">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-all">{value}</span>
    </div>
  )
  return (
    <div className="space-y-5">
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {row('Mã plugin', <code>{m.id}</code>)}
        {row('Tác giả', m.author || '—')}
        {row('Gói', `${p.name || '—'}@${p.version}`)}
        {row('Nguồn', p.source.type === 'npm' ? `npm · ${p.source.name}@${p.source.version}` : `thư mục · ${p.source.path}`)}
        {row('Thư mục', <span className="font-mono text-[11.5px]">{p.dir}</span>)}
        {row('Worker', m.entrypoints.worker ? <code>{m.entrypoints.worker}</code> : 'không có')}
        {row('Cài lúc', new Date(p.installedAt).toLocaleString())}
        {m.categories.length > 0 && row('Nhóm', m.categories.join(', '))}
      </div>
      <Block title="Quyền">
        {m.capabilities.length === 0 ? (
          <div className="px-4 py-2 text-[12.5px] text-muted">Không xin quyền nào.</div>
        ) : (
          <ul className="space-y-1 px-4 py-2.5">
            {m.capabilities.map((c) => (
              <CapabilityLine key={c} c={c} isNew={!p.approved.includes(c)} />
            ))}
          </ul>
        )}
      </Block>
    </div>
  )
}

// ---- cài ----

function InstallPluginDialog({ onClose, onInstalled }: { onClose: () => void; onInstalled: (p: InstalledPlugin) => void }): React.JSX.Element {
  const [tab, setTab] = useState<'npm' | 'local'>('local')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = tab === 'npm' ? name.trim() !== '' : path.trim() !== ''

  async function install(): Promise<void> {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const p = await window.stag.plugins.install(tab === 'npm' ? { type: 'npm', name: name.trim(), version: version.trim() || undefined } : { type: 'local', path: path.trim() })
      onInstalled(p)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }
  const tabBtn = (id: 'npm' | 'local', label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`rounded-md border px-2.5 py-1 text-[12.5px] ${tab === id ? 'border-fg/60 bg-panel-2 text-fg' : 'border-line text-muted hover:text-fg'}`}
    >
      {label}
    </button>
  )
  const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent'
  return (
    <Modal
      title="Cài plugin"
      width="w-[500px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={() => void install()} disabled={busy || !ready}>
            {busy ? (tab === 'npm' ? 'Đang chạy npm install…' : 'Đang đọc gói…') : 'Cài'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void install()
        }}
      >
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Gói cần có mục <code>stagPlugin</code> trong package.json (xem <code>docs/plugins.md</code>). Cài xong, bạn xem quyền plugin xin rồi mới cho chạy.
        </p>
        <div className="mb-4 flex gap-2">
          {tabBtn('local', 'Thư mục')}
          {tabBtn('npm', 'Gói npm')}
        </div>
        {tab === 'npm' ? (
          <>
            <label className="mb-1.5 block text-[12.5px]" htmlFor="plugin-npm-name">
              Tên gói
            </label>
            <input id="plugin-npm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="stag-plugin-example" spellCheck={false} className={input} />
            <label className="mb-1.5 mt-3 block text-[12.5px]" htmlFor="plugin-npm-version">
              Phiên bản (tuỳ chọn)
            </label>
            <input id="plugin-npm-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" spellCheck={false} className={input} />
            <p className="mt-2 text-[11.5px] text-muted">
              Cài bằng <code>npm install --ignore-scripts</code> vào thư mục riêng của app.
            </p>
          </>
        ) : (
          <>
            <label className="mb-1.5 block text-[12.5px]" htmlFor="plugin-local-path">
              Thư mục gói
            </label>
            <div className="flex gap-2">
              <input id="plugin-local-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\code\stag-plugin-example" spellCheck={false} className={input} />
              <SmallButton
                onClick={() =>
                  void window.stag.pickFolder('Chọn thư mục plugin (có package.json)', path || undefined).then((d) => {
                    if (d) setPath(d)
                  })
                }
              >
                Chọn
              </SmallButton>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">Dùng tại chỗ, không chép: sửa gói rồi bấm "Đọc lại gói" ở trang plugin.</p>
          </>
        )}
        <p className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-amber-200/90">
          Plugin chạy chương trình trên máy bạn với quyền của bạn. Chỉ cài từ nguồn bạn tin.
        </p>
        {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
      </form>
    </Modal>
  )
}

function PuzzleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H5V6a1 1 0 0 1 1-1h4V4z" />
    </svg>
  )
}
