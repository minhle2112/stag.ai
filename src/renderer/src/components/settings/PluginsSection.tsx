import { useEffect, useState, type ReactNode } from 'react'
import {
  describeCron,
  PLUGIN_CAPABILITIES,
  PLUGIN_EVENTS,
  PLUGIN_ID_RE,
  pluginFolderFor,
  pluginIdFrom,
  pluginToolName,
  RISKY_CAPABILITIES,
  type InstalledPlugin,
  type PluginCatalogEntry,
  type PluginCapability,
  type PluginConfigField,
  type PluginSlot,
  type PluginState
} from '@shared/plugins'
import { usePlugins } from '../../store/plugins'
import { PluginFrame } from '../PluginFrame'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { Button, Modal } from '../Modal'
import { Seg } from '../ui/Seg'
import { errText } from './AdaptersSection'
import { Badge, Callout, DetailHead, Empty, ErrorBar, Group, INPUT, INPUT_MONO, Row, RowBlock, SectionTitle, SmallButton, Switch, TEXTAREA_TEXT, Tile, Tiles, type Tone } from './controls'
import { LevelBar, LevelToggle, useAgentLevel, useLevel, type Level, type LevelKey } from './levels'
import { SkillAvatar } from './SkillsSection'

/**
 * Settings → Plugin (alpha, bố cục theo trang Plugins của Paperclip): danh sách đã cài, cài từ npm / thư mục,
 * duyệt quyền trước khi chạy, trang mỗi plugin với Cấu hình / Trạng thái / Giới thiệu.
 */

const STATE: Record<PluginState, { label: string; tone: Tone }> = {
  ready: { label: 'Sẵn sàng', tone: 'ok' },
  starting: { label: 'Đang khởi động', tone: 'muted' },
  stopped: { label: 'Đã dừng', tone: 'muted' },
  disabled: { label: 'Đang tắt', tone: 'muted' },
  error: { label: 'Lỗi', tone: 'bad' },
  approval_pending: { label: 'Chờ duyệt quyền', tone: 'warn' },
  upgrade_pending: { label: 'Chờ duyệt quyền mới', tone: 'warn' }
}
const SLOT: Record<PluginSlot['type'], string> = {
  sidebar: 'Thanh bên',
  globalToolbarButton: 'Thanh trên cùng',
  agentMenu: 'Menu ⋯ của agent',
  page: 'Tab trang riêng',
  settingsPage: 'Trang cài đặt',
  dashboardWidget: 'Widget trong lưới agent',
  statusBarItem: 'Thanh trạng thái'
}

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
  return <Badge tone={s.tone}>{s.label}</Badge>
}

export function PluginsSection(): React.JSX.Element {
  const focus = useUi((s) => s.settingsFocus)
  const agentLevel = useAgentLevel()
  const items = usePlugins((s) => s.items)
  const [open, setOpen] = useState<string | null>(focus?.plugin ?? null)
  const [installing, setInstalling] = useState(false)
  const [creating, setCreating] = useState(false)
  const [level, setLevel] = useState<LevelKey>(() => agentLevel(focus?.agentId))
  const lv = useLevel(level)

  useEffect(() => {
    if (focus?.plugin) setOpen(focus.plugin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const plugin = open ? items.find((p) => p.manifest.id === open) : undefined
  return (
    <>
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            Plugin
            <Badge>Alpha</Badge>
          </span>
        }
        desc="Plugin mở rộng chính app stag.ai: thêm nút và trang riêng, thêm tool cho agent, nghe sự kiện của app, chạy việc theo lịch, nhận webhook. Mỗi plugin chạy trong tiến trình riêng và chỉ chạy sau khi bạn duyệt quyền."
        right={<LevelBar level={level} setLevel={setLevel} field="plugins" />}
      />
      {plugin ? (
        <PluginDetail key={plugin.manifest.id} p={plugin} lv={lv} onBack={() => setOpen(null)} />
      ) : (
        <PluginList items={items} lv={lv} onOpen={setOpen} onInstall={() => setInstalling(true)} onCreate={() => setCreating(true)} />
      )}
      {creating && (
        <CreatePluginDialog
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false)
            setOpen(p.manifest.id)
          }}
        />
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

function PluginList(p: { items: InstalledPlugin[]; lv: Level; onOpen: (id: string) => void; onInstall: () => void; onCreate: () => void }): React.JSX.Element {
  const loaded = usePlugins((s) => s.loaded)
  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-2">
        <SmallButton onClick={p.onCreate}>Tạo plugin</SmallButton>
        <SmallButton variant="primary" icon="plus" onClick={p.onInstall}>
          Cài plugin
        </SmallButton>
      </div>
      <Callout icon="shield">
        Plugin là tính năng alpha. Plugin chạy chương trình trên máy bạn với quyền của bạn; quyền bạn duyệt chỉ giới hạn những gì nó làm <b>qua stag.ai</b>{' '}
        (gõ vào agent, đọc vault…). Chỉ cài từ nguồn bạn tin.
      </Callout>
      <Group title={`Đã cài${p.items.length > 0 ? ` · ${p.items.length}` : ''}`}>
        {!loaded ? null : p.items.length === 0 ? (
          <Empty title="Chưa cài plugin nào">
            Cài một plugin có sẵn bên dưới, bấm "Cài plugin" để chọn một gói npm / một thư mục có <code>stagPlugin</code> trong package.json, hoặc "Tạo plugin" để
            bắt đầu từ mẫu.
          </Empty>
        ) : (
          <Tiles>
            {p.items.map((x) => {
              const line = [
                x.manifest.id,
                x.source.type === 'npm' ? `npm ${x.source.name}` : x.source.type === 'catalog' ? 'kèm app' : 'thư mục',
                x.manifest.tools.length ? `${x.manifest.tools.length} tool` : '',
                x.manifest.ui.slots.length ? `${x.manifest.ui.slots.length} nút / trang` : '',
                x.manifest.events.length ? `${x.manifest.events.length} sự kiện` : '',
                x.manifest.jobs.length ? `${x.manifest.jobs.length} việc theo lịch` : '',
                x.manifest.webhooks.length ? `${x.manifest.webhooks.length} webhook` : ''
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <Tile
                  key={x.manifest.id}
                  logo={<SkillAvatar name={x.manifest.displayName} size={30} />}
                  title={x.manifest.displayName}
                  badge={<StateBadge state={x.status.state} />}
                  sub={<span className="font-mono text-[11px]">{line}</span>}
                  tip={`v${x.version} · ${line}`}
                  onOpen={() => p.onOpen(x.manifest.id)}
                  control={<LevelToggle k={x.manifest.id} level={p.lv} label={x.manifest.displayName} field="plugins" setApp={pluginSetApp(x.manifest.id)} />}
                />
              )
            })}
          </Tiles>
        )}
      </Group>
      <AvailablePlugins onInstalled={p.onOpen} />
    </>
  )
}

/** Mục "Có sẵn": plugin kèm app chưa cài (như "Available" của Paperclip). */
function AvailablePlugins({ onInstalled }: { onInstalled: (id: string) => void }): React.JSX.Element | null {
  const items = usePlugins((s) => s.items)
  const [catalog, setCatalog] = useState<PluginCatalogEntry[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    window.stag.plugins
      .catalog()
      .then(setCatalog)
      .catch(() => setCatalog([]))
  }, [items.length])
  const list = (catalog ?? []).filter((c) => !items.some((x) => x.manifest.id === c.manifest.id))
  if (!list.length) return null
  return (
    <Group title="Có sẵn · kèm app">
      <ErrorBar error={error} />
      <Tiles>
        {list.map((c) => (
          <Tile
            key={c.slug}
            logo={<SkillAvatar name={c.manifest.displayName} size={30} />}
            title={c.manifest.displayName}
            badge={<Badge>v{c.version}</Badge>}
            sub={c.manifest.description}
            tip={c.manifest.description}
            control={
              <SmallButton
                size="xs"
                disabled={!!busy}
                onClick={() => {
                  setBusy(c.slug)
                  setError('')
                  window.stag.plugins
                    .install({ type: 'catalog', slug: c.slug })
                    .then((p) => onInstalled(p.manifest.id))
                    .catch((e) => setError(errText(e)))
                    .finally(() => setBusy(''))
                }}
              >
                {busy === c.slug ? 'Đang cài…' : 'Cài'}
              </SmallButton>
            }
          />
        ))}
      </Tiles>
    </Group>
  )
}

// ---- trang một plugin ----

/** `page:<slot>` = trang cài đặt riêng của plugin (slot settingsPage). */
type Tab = 'config' | 'status' | 'about' | `page:${string}`

function PluginDetail({ p, lv, onBack }: { p: InstalledPlugin; lv: Level; onBack: () => void }): React.JSX.Element {
  const m = p.manifest
  const [tab, setTab] = useState<Tab>(m.instanceConfigSchema ? 'config' : 'status')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const pending = p.status.state === 'approval_pending' || p.status.state === 'upgrade_pending'
  const settingsPages = m.ui.slots.filter((x) => x.type === 'settingsPage')
  const tabs: Array<[Tab, string]> = [
    ['config', 'Cấu hình'],
    ...settingsPages.map((x): [Tab, string] => [`page:${x.id}`, x.displayName]),
    ['status', 'Trạng thái'],
    ['about', 'Giới thiệu']
  ]
  const pageSlot = tab.startsWith('page:') ? settingsPages.find((x) => `page:${x.id}` === tab) : undefined

  const act = (label: string, fn: () => Promise<unknown>): void => {
    setBusy(label)
    setError('')
    fn()
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(''))
  }

  return (
    <>
      <DetailHead
        onBack={onBack}
        backLabel="Tất cả plugin"
        logo={<SkillAvatar name={m.displayName} size={30} />}
        title={m.displayName}
        badge={
          <>
            <Badge>v{p.version}</Badge>
            <StateBadge state={p.status.state} />
          </>
        }
        sub={m.description}
        control={
          <>
            <span className="text-[12px] text-dim">{lv.lvl === 'app' ? 'Mọi nơi' : lv.name}</span>
            <LevelToggle k={m.id} level={lv} label={m.displayName} field="plugins" setApp={pluginSetApp(m.id)} />
          </>
        }
      />
      <ErrorBar error={error} />

      {pending && <ApprovalCard p={p} busy={busy === 'approve'} onApprove={() => act('approve', () => window.stag.plugins.approve(m.id))} />}
      {p.status.state === 'error' && p.status.lastError && <ErrorBar error={p.status.lastError} />}

      <div className="mb-3 flex items-center gap-2">
        <Seg value={tab} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} />
        <div className="flex-1" />
        <div className="flex gap-1.5">
          {m.entrypoints.worker && (
            <SmallButton onClick={() => act('restart', () => window.stag.plugins.restart(m.id))} disabled={!!busy}>
              {busy === 'restart' ? 'Đang khởi động lại…' : 'Khởi động lại'}
            </SmallButton>
          )}
          <SmallButton onClick={() => act('reload', () => window.stag.plugins.reload(m.id))} disabled={!!busy}>
            {busy === 'reload' ? 'Đang đọc…' : p.source.type === 'local' ? 'Đọc lại gói' : 'Cài lại'}
          </SmallButton>
          <SmallButton
            variant={confirmRemove ? 'dangerSolid' : 'danger'}
            onClick={() => (confirmRemove ? act('remove', async () => (await window.stag.plugins.remove(m.id), onBack())) : setConfirmRemove(true))}
            onBlur={() => setConfirmRemove(false)}
            disabled={!!busy}
          >
            {confirmRemove ? 'Bấm lần nữa để gỡ' : 'Gỡ'}
          </SmallButton>
        </div>
      </div>

      {tab === 'config' && <ConfigForm p={p} />}
      {pageSlot &&
        (p.status.state === 'ready' ? (
          <div className="overflow-hidden rounded-lg border border-line-2">
            <PluginFrame plugin={p} slot={pageSlot} autoHeight />
          </div>
        ) : (
          <div className="text-[12px] text-dim">Trang này mở được khi plugin đã được duyệt quyền, đang bật và đang chạy.</div>
        ))}
      {tab === 'status' && <StatusTab p={p} />}
      {tab === 'about' && <AboutTab p={p} />}
    </>
  )
}

function ApprovalCard({ p, busy, onApprove }: { p: InstalledPlugin; busy: boolean; onApprove: () => void }): React.JSX.Element {
  const fresh = p.manifest.capabilities.filter((c) => !p.approved.includes(c))
  const upgrade = p.status.state === 'upgrade_pending'
  return (
    <div className="mb-4 rounded-lg border border-wait/40 bg-wait/[0.06] px-4 py-3">
      <div className="mb-1 text-[13px] font-semibold text-wait">{upgrade ? 'Bản mới xin thêm quyền' : 'Duyệt quyền để chạy plugin'}</div>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {upgrade
          ? 'Plugin chưa chạy lại cho tới khi bạn duyệt các quyền mới dưới đây.'
          : `${p.manifest.displayName} của ${p.manifest.author || 'tác giả không rõ'} xin các quyền dưới đây. Plugin chưa chạy cho tới khi bạn duyệt.`}
      </p>
      {p.manifest.capabilities.length === 0 ? (
        <div className="mb-3 text-[12px] text-dim">Không xin quyền nào.</div>
      ) : (
        <ul className="mb-3 space-y-1">
          {p.manifest.capabilities.map((c) => (
            <CapabilityLine key={c} c={c} isNew={upgrade && fresh.includes(c)} />
          ))}
        </ul>
      )}
      <SmallButton variant="primary" onClick={onApprove} disabled={busy}>
        {busy ? 'Đang khởi động…' : upgrade ? 'Duyệt quyền mới và chạy' : 'Duyệt và chạy'}
      </SmallButton>
    </div>
  )
}

function CapabilityLine({ c, isNew }: { c: PluginCapability; isNew?: boolean }): React.JSX.Element {
  const risky = RISKY_CAPABILITIES.includes(c)
  return (
    <li className="flex items-baseline gap-2 text-[12px]">
      <span className={risky ? 'text-danger' : 'text-fg'}>•</span>
      <span className={risky ? 'text-danger' : ''}>{PLUGIN_CAPABILITIES[c]}</span>
      <code className="font-mono text-[11px] text-dim">{c}</code>
      {isNew && <span className="rounded bg-wait/20 px-1.5 text-[11px] text-wait">mới</span>}
    </li>
  )
}

function ConfigForm({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const schema = p.manifest.instanceConfigSchema
  const [draft, setDraft] = useState<Record<string, unknown>>(p.config)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  if (!schema || !Object.keys(schema.properties).length) return <div className="text-[12px] text-dim">Plugin này không có gì để cấu hình.</div>
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
    >
      {Object.entries(schema.properties).map(([k, f]) => (
        <Field key={k} name={k} f={f} required={schema.required.includes(k)} value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} />
      ))}
      {msg && (
        <Callout tone={msg.bad ? 'danger' : 'info'} className="mt-3">
          {msg.text}
        </Callout>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex h-[26px] items-center rounded-md border border-accent bg-accent px-2.5 text-[12px] font-semibold text-accent-on hover:brightness-110 disabled:opacity-40"
        >
          {saving ? 'Đang lưu…' : 'Lưu'}
        </button>
        {dirty && <SmallButton onClick={() => setDraft(p.config)}>Huỷ</SmallButton>}
        <span className="text-[12px] text-dim">Không ghi mật khẩu / token ở đây: cấu hình lưu dạng chữ thường.</span>
      </div>
    </form>
  )
}

function Field({ name, f, required, value, onChange }: { name: string; f: PluginConfigField; required: boolean; value: unknown; onChange: (v: unknown) => void }): React.JSX.Element {
  const id = `plugin-cfg-${name}`
  const label = (
    <>
      {f.title ?? name}
      {required && <span className="text-danger"> *</span>}
      <code className="ml-2 font-mono text-[11px] font-normal text-dim">{name}</code>
    </>
  )
  if (f.type === 'boolean')
    return (
      <Row label={label} desc={f.description} htmlFor={id}>
        <Switch label={f.title ?? name} checked={value === true} onChange={(v) => onChange(v)} />
      </Row>
    )
  let control: ReactNode
  if (f.enum)
    control = (
      <select id={id} value={String(value ?? '')} onChange={(e) => onChange(f.type === 'string' ? e.target.value : Number(e.target.value))} className={`${INPUT} w-full`}>
        {!required && <option value="">(mặc định)</option>}
        {f.enum.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    )
  else if (f.format === 'textarea') control = <textarea id={id} rows={4} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={`${TEXTAREA_TEXT} w-full`} />
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
        className={`${f.format === 'url' ? INPUT_MONO : INPUT} w-full`}
      />
    )
  return (
    <RowBlock label={label} desc={f.description} htmlFor={id}>
      {control}
    </RowBlock>
  )
}

function since(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  return s < 60 ? `${s} giây` : s < 3600 ? `${Math.floor(s / 60)} phút` : `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`
}

/** Một dòng "nhãn: giá trị" của trang Trạng thái / Giới thiệu. */
function KV({ label, children, breakAll }: { label: string; children: ReactNode; breakAll?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2 text-[12px]">
      <span className="w-40 shrink-0 text-dim">{label}</span>
      <span className={`min-w-0 flex-1 ${breakAll ? 'break-all' : ''}`}>{children}</span>
    </div>
  )
}

function StatusTab({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  const s = p.status
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  return (
    <div>
      <div>
        <KV label="Trạng thái">
          <StateBadge state={s.state} />
        </KV>
        {m.entrypoints.worker ? (
          <>
            <KV label="Worker">{s.pid ? `đang chạy · PID ${s.pid}` : 'không chạy'}</KV>
            <KV label="Chạy được">{s.pid ? since(s.startedAt) : '—'}</KV>
            <KV label="Khởi động lại">{String(s.restarts)}</KV>
            <KV label="Sức khoẻ">
              <span className="flex items-center gap-2">
                {s.health ? (
                  <span className={s.health.ok ? 'text-work' : 'text-danger'}>
                    {s.health.ok ? 'ổn' : 'lỗi'}
                    {s.health.message ? ` · ${s.health.message}` : ''} · {new Date(s.health.at).toLocaleTimeString()}
                  </span>
                ) : (
                  <span className="text-dim">chưa kiểm (30 giây / lần)</span>
                )}
                {s.pid && <SmallButton onClick={() => void window.stag.plugins.health(m.id)}>Kiểm tra</SmallButton>}
              </span>
            </KV>
            <KV label="Lần gọi tool">{String(s.toolCalls)}</KV>
            <KV label="Sự kiện đã gửi">{String(s.events)}</KV>
          </>
        ) : (
          <KV label="Worker">không có (plugin chỉ có nút mở địa chỉ)</KV>
        )}
        {s.lastError && (
          <KV label="Lỗi gần nhất">
            <span className="text-danger">{s.lastError}</span>
          </KV>
        )}
      </div>

      {m.tools.length > 0 && (
        <Group title="Tool cho agent">
          {m.tools.map((t) => (
            <div key={t.name} className="border-b border-line py-2 text-[12px]">
              <code className="font-mono text-[12px]">{pluginToolName(m.id, t.name)}</code> <span className="text-dim">· {t.displayName}</span>
              <div className="mt-0.5 text-[12px] text-dim">{t.description}</div>
            </div>
          ))}
        </Group>
      )}
      {m.ui.slots.length > 0 && (
        <Group title="Nút và trang">
          {m.ui.slots.map((x) => (
            <div key={x.id} className="flex items-baseline gap-3 border-b border-line py-2 text-[12px]">
              <span className="w-40 shrink-0 text-dim">{SLOT[x.type]}</span>
              <span className="font-medium">{x.displayName}</span>
              <span className="truncate font-mono text-[11px] text-dim">
                {[
                  x.dataKey && `chữ từ dữ liệu "${x.dataKey}"`,
                  x.path ? `${m.entrypoints.ui}/${x.path}` : x.open ? `mở ${x.open.url} (${x.open.target === 'browser' ? 'trong app' : 'trình duyệt'})` : x.action && `gọi ${x.action}`
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          ))}
        </Group>
      )}
      {m.jobs.length > 0 && <JobsBlock p={p} />}
      {m.webhooks.length > 0 && <WebhooksBlock p={p} />}
      {m.events.length > 0 && (
        <Group title="Sự kiện nhận">
          {m.events.map((e) => (
            <div key={e} className="flex gap-3 border-b border-line py-2 text-[12px]">
              <code className="w-44 shrink-0 font-mono text-[11px]">{e}</code>
              <span className="text-dim">{PLUGIN_EVENTS[e]}</span>
            </div>
          ))}
        </Group>
      )}
      <Group title="Nhật ký (200 dòng gần nhất)">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line-2 bg-bg px-3 py-2 font-mono text-[11px] leading-relaxed">
          {p.logs.length === 0 ? (
            <span className="text-dim">Chưa có gì.</span>
          ) : (
            [...p.logs].reverse().map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-muted' : ''}>
                <span className="text-dim">{new Date(l.at).toLocaleTimeString()} </span>
                {l.message}
              </div>
            ))
          )}
        </div>
      </Group>
    </div>
  )
}

const clock = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '—')

function JobsBlock({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  const [error, setError] = useState('')
  const ready = p.status.state === 'ready'
  return (
    <Block title="Việc theo lịch" note="Giờ máy; chỉ chạy khi app đang mở. Lỡ giờ lúc máy ngủ thì chạy bù một lần.">
      {error && <div className="border-b border-line py-2 text-[12px] text-danger">{error}</div>}
      {m.jobs.map((j) => {
        const st = p.jobs.find((x) => x.key === j.key)
        const last = p.jobRuns.find((r) => r.key === j.key)
        return (
          <div key={j.key} className="flex items-start gap-3 border-b border-line py-2.5 text-[12px]">
            <div className="min-w-0 flex-1">
              <div>
                <span className="font-medium">{j.displayName}</span> <code className="font-mono text-[11px] text-dim">{j.key}</code>
              </div>
              {j.description && <div className="mt-0.5 text-[12px] text-dim">{j.description}</div>}
              <div className="mt-1 text-[12px] text-dim">
                {describeCron(j.schedule)} <code className="font-mono text-[11px]">({j.schedule})</code> · lần tới: {st?.running ? 'đang chạy' : clock(st?.nextRun)}
                {last && (
                  <>
                    {' '}
                    · lần trước: {clock(last.startedAt)}{' '}
                    <span className={last.ok === false ? 'text-danger' : last.ok ? 'text-work' : ''}>
                      {last.ok === null ? 'đang chạy' : last.ok ? 'xong' : `lỗi: ${last.error ?? ''}`}
                    </span>
                  </>
                )}
              </div>
            </div>
            <SmallButton
              disabled={!ready || st?.running}
              onClick={() => {
                setError('')
                window.stag.plugins.runJob(m.id, j.key).catch((e) => setError(errText(e)))
              }}
            >
              {st?.running ? 'Đang chạy…' : 'Chạy ngay'}
            </SmallButton>
          </div>
        )
      })}
      {p.jobRuns.length > 0 && (
        <details className="py-2 text-[12px]">
          <summary className="cursor-pointer text-dim">Các lần chạy gần đây ({p.jobRuns.length})</summary>
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px]">
            {p.jobRuns.map((r) => (
              <div key={r.runId} className={r.ok === false ? 'text-danger' : ''}>
                <span className="text-dim">{clock(r.startedAt)}</span> {r.key} · {r.trigger === 'manual' ? 'bấm tay' : 'theo lịch'} ·{' '}
                {r.ok === null ? 'đang chạy' : r.ok ? `xong (${Math.max(0, Date.parse(r.finishedAt ?? r.startedAt) - Date.parse(r.startedAt))} ms)` : `lỗi: ${r.error ?? ''}`}
              </div>
            ))}
          </div>
        </details>
      )}
    </Block>
  )
}

function WebhooksBlock({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  const [copied, setCopied] = useState('')
  const [confirm, setConfirm] = useState(false)
  return (
    <Block
      title="Webhook"
      note="Địa chỉ chỉ nhận yêu cầu từ chính máy này (127.0.0.1). Dịch vụ ngoài Internet cần một tunnel (vd. cloudflared, ngrok) trỏ về địa chỉ này. Địa chỉ có mã bí mật: đừng dán vào chỗ công khai."
    >
      {m.webhooks.map((w) => {
        const url = p.webhookUrls[w.endpointKey]
        return (
          <div key={w.endpointKey} className="border-b border-line py-2.5 text-[12px]">
            <div>
              <span className="font-medium">{w.displayName}</span> <code className="font-mono text-[11px] text-dim">POST · {w.endpointKey}</code>
            </div>
            {w.description && <div className="mt-0.5 text-[12px] text-dim">{w.description}</div>}
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-line-2 bg-bg px-2 py-1 font-mono text-[11px] select-text">{url ?? 'Máy chủ webhook chưa chạy.'}</code>
              {url && (
                <SmallButton
                  onClick={() =>
                    void navigator.clipboard.writeText(url).then(() => {
                      setCopied(w.endpointKey)
                      setTimeout(() => setCopied(''), 1500)
                    })
                  }
                >
                  {copied === w.endpointKey ? 'Đã chép' : 'Chép'}
                </SmallButton>
              )}
            </div>
          </div>
        )
      })}
      <div className="flex items-center gap-2 border-b border-line py-2 text-[12px]">
        <span className="flex-1 text-dim">Lộ địa chỉ? Đổi mã bí mật, địa chỉ cũ thôi dùng được.</span>
        <SmallButton
          variant={confirm ? 'dangerSolid' : 'default'}
          onClick={() => (confirm ? void window.stag.plugins.rotateWebhook(m.id).then(() => setConfirm(false)) : setConfirm(true))}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? 'Bấm lần nữa để đổi' : 'Đổi mã'}
        </SmallButton>
      </div>
      {p.deliveries.length > 0 && (
        <details className="py-2 text-[12px]">
          <summary className="cursor-pointer text-dim">Lần nhận gần đây ({p.deliveries.length})</summary>
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px]">
            {p.deliveries.map((d) => (
              <div key={d.requestId} className={d.status >= 400 ? 'text-danger' : ''}>
                <span className="text-dim">{clock(d.at)}</span> {d.endpointKey} · {d.status} · {d.ms} ms{d.error ? ` · ${d.error}` : ''}
              </div>
            ))}
          </div>
        </details>
      )}
    </Block>
  )
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }): React.JSX.Element {
  return (
    <Group title={title}>
      {note && <p className="mb-1.5 text-[12px] leading-relaxed text-dim">{note}</p>}
      {children}
    </Group>
  )
}

function AboutTab({ p }: { p: InstalledPlugin }): React.JSX.Element {
  const m = p.manifest
  return (
    <div>
      <div>
        <KV label="Mã plugin" breakAll>
          <code className="font-mono text-[11px]">{m.id}</code>
        </KV>
        <KV label="Tác giả">{m.author || '—'}</KV>
        <KV label="Gói" breakAll>{`${p.name || '—'}@${p.version}`}</KV>
        <KV label="Nguồn" breakAll>
          {p.source.type === 'npm' ? `npm · ${p.source.name}@${p.source.version}` : p.source.type === 'catalog' ? `kèm app · ${p.source.slug}` : `thư mục · ${p.source.path}`}
        </KV>
        <KV label="Thư mục" breakAll>
          <span className="font-mono text-[11px]">{p.dir}</span>
        </KV>
        <KV label="Worker" breakAll>
          {m.entrypoints.worker ? <code className="font-mono text-[11px]">{m.entrypoints.worker}</code> : 'không có'}
        </KV>
        {m.entrypoints.ui && (
          <KV label="Giao diện" breakAll>
            <code className="font-mono text-[11px]">{m.entrypoints.ui}</code>
          </KV>
        )}
        <KV label="Cài lúc">{new Date(p.installedAt).toLocaleString()}</KV>
        {m.categories.length > 0 && <KV label="Nhóm">{m.categories.join(', ')}</KV>}
      </div>
      <Group title="Quyền">
        {m.capabilities.length === 0 ? (
          <div className="border-b border-line py-2 text-[12px] text-dim">Không xin quyền nào.</div>
        ) : (
          <ul className="space-y-1 border-b border-line py-2.5">
            {m.capabilities.map((c) => (
              <CapabilityLine key={c} c={c} isNew={!p.approved.includes(c)} />
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}

// ---- tạo plugin mới từ mẫu ----

function CreatePluginDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: InstalledPlugin) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [parentDir, setParentDir] = useState('')
  const [template, setTemplate] = useState<'basic' | 'page'>('page')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const realId = idTouched ? id.trim() : pluginIdFrom(name)
  const idOk = PLUGIN_ID_RE.test(realId)
  const ready = name.trim() !== '' && idOk && parentDir.trim() !== ''
  const sep = parentDir.includes('/') && !parentDir.includes('\\') ? '/' : '\\'

  async function create(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      onCreated(await window.stag.plugins.scaffold({ parentDir: parentDir.trim(), name: name.trim(), id: realId, template }))
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }
  const label = 'mb-1 block text-[12px] font-medium'
  return (
    <Modal
      title="Tạo plugin"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button primary disabled={!ready || busy} onClick={() => void create()}>
            {busy ? 'Đang tạo…' : 'Tạo và cài'}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-dim">
        Tạo thư mục plugin từ mẫu (manifest, worker, SDK{template === 'page' ? ', trang riêng' : ''}) rồi cài tại chỗ. Sửa file xong bấm "Đọc lại gói". Muốn agent viết
        tiếp: bật skill <code>stag-plugin-author</code> (Cài đặt → Skill → Khám phá) cho agent đó.
      </p>
      <ErrorBar error={error} />
      <label className={label} htmlFor="new-plugin-name">
        Tên
      </label>
      <input id="new-plugin-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Báo cáo tuần" className={`${INPUT} mb-3 w-full`} />
      <label className={label} htmlFor="new-plugin-id">
        Mã plugin
      </label>
      <input
        id="new-plugin-id"
        value={realId}
        onChange={(e) => {
          setIdTouched(true)
          setId(e.target.value)
        }}
        spellCheck={false}
        placeholder="my.bao-cao-tuan"
        className={`${INPUT_MONO} mb-1 w-full`}
      />
      <p className={`mb-3 text-[12px] ${realId && !idOk ? 'text-danger' : 'text-dim'}`}>a-z, 0-9, ".", "_", "-"; không đổi được sau khi cài (dữ liệu riêng của plugin gắn với mã).</p>
      <div className={label}>Thư mục chứa</div>
      <div className="mb-1 flex gap-2">
        <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} spellCheck={false} placeholder="C:\Users\…\plugins" className={`${INPUT_MONO} min-w-0 flex-1`} />
        <SmallButton
          icon="folder"
          size="md"
          onClick={() =>
            void window.stag.pickFolder('Chọn thư mục chứa plugin mới', parentDir || undefined).then((d) => {
              if (d) setParentDir(d)
            })
          }
        >
          Chọn…
        </SmallButton>
      </div>
      <p className="mb-3 truncate font-mono text-[11px] text-dim">
        {parentDir.trim() && idOk ? `${parentDir.trim().replace(/[\\/]+$/, '')}${sep}${pluginFolderFor(realId)}` : ' '}
      </p>
      <div className={label}>Mẫu</div>
      <div className="flex gap-2">
        {(
          [
            ['page', 'Có trang', 'Tool cho agent, nút ở thanh bên, tab trang riêng'],
            ['basic', 'Cơ bản', 'Tool cho agent, nút ở thanh bên']
          ] as const
        ).map(([k, tmplLabel, desc]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTemplate(k)}
            aria-pressed={template === k}
            className={`flex-1 rounded-lg border px-3 py-2 text-left ${template === k ? 'border-accent bg-accent/10' : 'border-line-2 hover:border-line-3'}`}
          >
            <div className="text-[13px] font-medium">{tmplLabel}</div>
            <div className="text-[12px] text-dim">{desc}</div>
          </button>
        ))}
      </div>
    </Modal>
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
  const field = `${INPUT_MONO} w-full`
  const label = 'mb-1 block text-[12px] font-medium'
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
        <p className="mb-3 text-[12px] leading-relaxed text-dim">
          Gói cần có mục <code>stagPlugin</code> trong package.json (xem <code>docs/plugins.md</code>). Cài xong, bạn xem quyền plugin xin rồi mới cho chạy.
        </p>
        <Seg
          className="mb-4 self-start"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'local',
              label: (
                <>
                  <Icon name="folder" size="s" />
                  Thư mục
                </>
              )
            },
            {
              value: 'npm',
              label: (
                <>
                  <Icon name="hex" size="s" />
                  Gói npm
                </>
              )
            }
          ]}
        />
        {tab === 'npm' ? (
          <>
            <label className={label} htmlFor="plugin-npm-name">
              Tên gói
            </label>
            <input id="plugin-npm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="stag-plugin-example" spellCheck={false} className={field} />
            <label className={`${label} mt-3`} htmlFor="plugin-npm-version">
              Phiên bản (tuỳ chọn)
            </label>
            <input id="plugin-npm-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" spellCheck={false} className={field} />
            <p className="mt-2 text-[12px] text-dim">
              Cài bằng <code>npm install --ignore-scripts</code> vào thư mục riêng của app.
            </p>
          </>
        ) : (
          <>
            <label className={label} htmlFor="plugin-local-path">
              Thư mục gói
            </label>
            <div className="flex gap-2">
              <input id="plugin-local-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\code\stag-plugin-example" spellCheck={false} className={field} />
              <SmallButton
                icon="folder"
                size="md"
                onClick={() =>
                  void window.stag.pickFolder('Chọn thư mục plugin (có package.json)', path || undefined).then((d) => {
                    if (d) setPath(d)
                  })
                }
              >
                Chọn
              </SmallButton>
            </div>
            <p className="mt-2 text-[12px] text-dim">Dùng tại chỗ, không chép: sửa gói rồi bấm "Đọc lại gói" ở trang plugin.</p>
          </>
        )}
        <Callout icon="shield" className="mt-4">
          Plugin chạy chương trình trên máy bạn với quyền của bạn. Chỉ cài từ nguồn bạn tin.
        </Callout>
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">{error}</div>}
      </form>
    </Modal>
  )
}
