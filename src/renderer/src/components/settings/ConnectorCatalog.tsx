import { useEffect, useMemo, useState } from 'react'
import { CATALOG, catalogDescription, findCatalog, methodLabel } from '@shared/catalog'
import { agentKind, type CatalogEntry, type CatalogMethod, type ConnectAccess, type ConnectResult, type Connector, type ToolApproval } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useApprovals } from '../../store/approvals'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { Button, Modal } from '../Modal'
import { errText } from './AdaptersSection'

/**
 * Settings → Connector, phần theo trang Connectors của Paperclip: Danh mục (tìm, Connect, "Kết nối công cụ riêng"),
 * hộp Connect 2 bước (ai được dùng → cách kết nối) và Duyệt (lần gọi tool đang chờ người dùng).
 * Danh mục + logo: định nghĩa app của Paperclip (MIT) và icon LobeHub (MIT), xem assets/connectors/LICENSES.md.
 */

const LOGOS = import.meta.glob('../../assets/connectors/*.{svg,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const logoUrl = (file?: string): string | undefined => (file ? LOGOS[`../../assets/connectors/${file}`] : undefined)

/** Logo dịch vụ (bản cho nền tối nếu có), hoặc chữ cái đầu. */
export function ConnectorLogo({ slug, name, size = 36 }: { slug?: string; name: string; size?: number }): React.JSX.Element {
  const e = slug ? CATALOG.find((x) => x.slug === slug) : undefined
  const src = logoUrl(e?.logoDark) ?? logoUrl(e?.logo)
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="object-contain" style={{ width: size * 0.6, height: size * 0.6 }} />
      ) : (
        <span className="text-[13px] font-semibold text-muted">{(name.trim()[0] ?? '?').toUpperCase()}</span>
      )}
    </span>
  )
}

// ---- Danh mục ----

export function BrowseView({ onOpen, onCustom }: { onOpen: (id: string) => void; onCustom: () => void }): React.JSX.Element {
  const items = useSettings((s) => s.value.app.connectors.items)
  const [q, setQ] = useState('')
  const [connecting, setConnecting] = useState<CatalogEntry | null>(null)
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    return k ? CATALOG.filter((e) => `${e.name} ${e.slug} ${e.description} ${e.categories.join(' ')}`.toLowerCase().includes(k)) : CATALOG
  }, [q])

  return (
    <>
      <div className="relative mb-5 max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          aria-label="Tìm connector"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm connector…"
          className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-3 text-[13px] outline-none focus:border-accent"
        />
      </div>
      <div className="flex flex-col gap-3">
        {list.map((e) => {
          const mine = items.filter((c) => c.catalog?.slug === e.slug)
          return (
            <div key={e.slug} className="flex items-center gap-3.5 rounded-xl border border-line bg-panel px-4 py-3.5">
              <ConnectorLogo slug={e.slug} name={e.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{e.name}</span>
                  {mine.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpen(mine[0].id)}
                      className="rounded-full border border-emerald-500/40 px-2 py-px text-[10.5px] text-emerald-300 hover:bg-emerald-500/10"
                    >
                      Đã kết nối{mine.length > 1 ? ` ×${mine.length}` : ''}
                    </button>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-muted">{catalogDescription(e)}</div>
              </div>
              <ConnectButton label={`Kết nối ${e.name}`} onClick={() => setConnecting(e)} />
            </div>
          )
        })}
        {list.length === 0 && <div className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-[12.5px] text-muted">Không thấy connector nào khớp "{q}".</div>}
        <div className="flex items-center gap-3.5 rounded-xl border border-line bg-panel px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted">
            <LinkIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">Kết nối công cụ riêng</div>
            <div className="mt-0.5 text-[12px] text-muted">Thêm máy chủ MCP tự cấu hình, hoặc dán cấu hình có sẵn (JSON).</div>
          </div>
          <ConnectButton label="Kết nối công cụ riêng" onClick={onCustom} />
        </div>
      </div>
      {connecting && (
        <ConnectDialog
          key={connecting.slug}
          entry={connecting}
          onClose={() => setConnecting(null)}
          onOpen={(id) => {
            setConnecting(null)
            onOpen(id)
          }}
        />
      )}
    </>
  )
}

function ConnectButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 rounded-md border border-line bg-panel-2/60 px-3.5 py-1.5 text-[12.5px] font-medium hover:bg-panel-2"
    >
      Kết nối
    </button>
  )
}

// ---- hộp Connect ----

type Step = 'access' | 'method' | 'working' | 'done'

function ConnectDialog({ entry, onClose, onOpen }: { entry: CatalogEntry; onClose: () => void; onOpen: (id: string) => void }): React.JSX.Element {
  const workspaces = useWorkspaces((s) => s.items)
  const activeWs = useWorkspaces((s) => s.activeId)
  const byWs = useAgents((s) => s.byWs)
  const [step, setStep] = useState<Step>('access')
  const [mode, setMode] = useState<ConnectAccess['mode']>('all')
  const [wsId, setWsId] = useState(activeWs ?? workspaces[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [methodKey, setMethodKey] = useState(entry.methods.length === 1 ? entry.methods[0].key : '')
  const [value, setValue] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConnectResult | null>(null)
  const method = entry.methods.find((m) => m.key === methodKey)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && step !== 'working') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [step, onClose])

  const access: ConnectAccess = mode === 'all' ? { mode } : mode === 'workspace' ? { mode, workspaceId: wsId } : { mode, agentIds: picked }
  const accessOk = mode === 'all' || (mode === 'workspace' ? !!wsId : picked.length > 0)
  const methodOk =
    !!method &&
    method.fields.every((f) => (fields[f.key] ?? '').trim()) &&
    (method.kind !== 'key' && method.kind !== 'url' ? true : value.trim() !== '')

  async function connect(): Promise<void> {
    if (!method || !methodOk) return
    setStep('working')
    setError('')
    try {
      const r = await window.stag.connectors.connect(
        { slug: entry.slug, method: method.key, access, fields, value, client: method.kind === 'oauth-app' ? { id: clientId, secret: clientSecret } : undefined },
        mode === 'workspace' ? wsId : (activeWs ?? undefined)
      )
      setResult(r)
      setStep('done')
    } catch (e) {
      setError(errText(e))
      setStep('method')
    }
  }

  const agentsOf = (id: string): Array<{ id: string; name: string }> => (byWs[id]?.agents ?? []).filter((a) => agentKind(a) !== 'terminal')
  const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent'

  const footer =
    step === 'access' ? (
      <>
        <Button onClick={onClose}>Huỷ</Button>
        <Button primary disabled={!accessOk} onClick={() => setStep('method')}>
          Tiếp tục
        </Button>
      </>
    ) : step === 'method' ? (
      <>
        <Button onClick={() => setStep('access')}>Quay lại</Button>
        <Button primary disabled={!methodOk} onClick={connect}>
          Kết nối
        </Button>
      </>
    ) : step === 'working' ? (
      <Button onClick={() => void window.stag.connectors.cancelConnect()}>Huỷ đăng nhập</Button>
    ) : (
      <>
        <Button onClick={onClose}>Xong</Button>
        <Button primary onClick={() => onOpen(result!.id)}>
          Mở trang connector
        </Button>
      </>
    )

  return (
    <Modal title={`Kết nối ${entry.name}`} width="w-[600px]" onClose={step === 'working' ? undefined : onClose} footer={footer}>
      <div className="mb-4 flex items-center gap-3">
        <ConnectorLogo slug={entry.slug} name={entry.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] text-muted">{catalogDescription(entry)}</div>
          {entry.docsUrl && (
            <a href={entry.docsUrl} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
              Tài liệu của {entry.name} ↗
            </a>
          )}
        </div>
        {(step === 'access' || step === 'method') && <span className="text-[11.5px] text-muted">Bước {step === 'access' ? 1 : 2} / 2</span>}
      </div>

      {step === 'access' && (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Agent nào được dùng connector này?</legend>
          <Radio checked={mode === 'all'} onChange={() => setMode('all')} label="Mọi agent" desc="Bật ở mặc định của app; tắt riêng từng workspace / agent sau được." />
          <Radio
            checked={mode === 'workspace'}
            onChange={() => setMode('workspace')}
            label="Chỉ agent trong một workspace"
            desc={
              mode === 'workspace' && (
                <select aria-label="Workspace" value={wsId} onChange={(e) => setWsId(e.target.value)} className="mt-1.5 rounded-md border border-line bg-bg px-2 py-1 text-[12.5px]">
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )
            }
          />
          <Radio
            checked={mode === 'agents'}
            onChange={() => setMode('agents')}
            label="Chỉ agent tôi chọn"
            desc={
              mode === 'agents' && (
                <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-line p-2">
                  {workspaces.map((w) => (
                    <div key={w.id} className="mb-1">
                      <div className="text-[11px] uppercase tracking-wider text-muted">{w.name}</div>
                      {agentsOf(w.id).length === 0 && <div className="text-[12px] text-muted">(chưa có agent)</div>}
                      {agentsOf(w.id).map((a) => (
                        <label key={a.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                          <input
                            type="checkbox"
                            checked={picked.includes(a.id)}
                            onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))}
                          />
                          {a.name}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              )
            }
          />
        </fieldset>
      )}

      {step === 'method' && (
        <>
          <div className="mb-2 text-[13px] font-medium">Kết nối bằng cách nào?</div>
          <div className="mb-4 flex flex-col gap-2">
            {entry.methods.map((m) => (
              <Radio
                key={m.key}
                checked={methodKey === m.key}
                onChange={() => setMethodKey(m.key)}
                label={methodLabel(entry, m)}
                desc={m.capability?.description || KIND_HINT[m.kind]}
              />
            ))}
          </div>
          {method && <MethodForm entry={entry} m={method} value={value} setValue={setValue} fields={fields} setFields={setFields} clientId={clientId} setClientId={setClientId} clientSecret={clientSecret} setClientSecret={setClientSecret} input={input} />}
          {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
        </>
      )}

      {step === 'working' && (
        <div className="py-6 text-center text-[13px]">
          {method?.kind === 'oauth' || method?.kind === 'oauth-app' ? (
            <>
              <div className="font-medium">Đang chờ bạn đăng nhập {entry.name} trong trình duyệt…</div>
              <div className="mt-1 text-[12px] text-muted">Trình duyệt mặc định đã mở trang đăng nhập. Xong thì quay lại đây (tối đa 5 phút).</div>
            </>
          ) : (
            <div className="font-medium">Đang kết nối và thử lấy danh sách tool…</div>
          )}
        </div>
      )}

      {step === 'done' && result && (
        <div className="text-[13px]">
          {result.test.ok ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-emerald-200">
              Đã kết nối {entry.name}: {result.test.tools.length} tool{result.test.server ? ` (${result.test.server})` : ''}. Agent nhận connector ở phiên mở sau.
            </div>
          ) : (
            <div className="rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-amber-200">
              Đã lưu connector nhưng thử kết nối chưa được: {result.test.error}
              <div className="mt-1 text-[12px] text-muted">Mở trang connector để sửa và thử lại.</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

const KIND_HINT: Record<CatalogMethod['kind'], string> = {
  oauth: 'Mở trình duyệt để đăng nhập; app tự đăng ký và tự làm mới phiên đăng nhập.',
  'oauth-app': 'Dùng OAuth app bạn tạo ở trang quản trị của dịch vụ (client ID / secret, khai báo địa chỉ chuyển hướng của app); một số dịch vụ cho app tự đăng ký.',
  key: 'Dán API key / token; cất ở Secrets (mã hoá).',
  none: 'Không cần đăng nhập.',
  url: 'Dán URL máy chủ bạn đã tạo ở trang của dịch vụ (token nằm trong URL, cất ở Secrets).',
  stdio: 'Chạy máy chủ ngay trên máy bằng npx.'
}

function MethodForm(p: {
  entry: CatalogEntry
  m: CatalogMethod
  value: string
  setValue: (v: string) => void
  fields: Record<string, string>
  setFields: (f: Record<string, string>) => void
  clientId: string
  setClientId: (v: string) => void
  clientSecret: string
  setClientSecret: (v: string) => void
  input: string
}): React.JSX.Element {
  const { m, input } = p
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel-2/40 p-3">
      {m.guide && <p className="text-[12px] leading-relaxed text-muted">{m.guide}</p>}
      {m.fields.map((f) => (
        <label key={f.key} className="block text-[12.5px]">
          {f.label}
          <input value={p.fields[f.key] ?? ''} onChange={(e) => p.setFields({ ...p.fields, [f.key]: e.target.value })} placeholder={f.placeholder} spellCheck={false} className={`${input} mt-1 font-mono`} />
          {f.help && <span className="mt-1 block text-[11.5px] text-muted">{f.help}</span>}
        </label>
      ))}
      {m.kind === 'key' && (
        <label className="block text-[12.5px]">
          {m.keyLabel ?? 'API key'}
          <input type="password" value={p.value} onChange={(e) => p.setValue(e.target.value)} placeholder={m.keyPlaceholder} className={`${input} mt-1 font-mono`} />
          <span className="mt-1 block text-[11.5px] text-muted">
            Gửi trong header {m.header?.name ?? 'Authorization'}
            {m.header?.prefix ? ` dạng "${m.header.prefix}…"` : ''}. Cất ở Secrets, không hiện lại.
          </span>
        </label>
      )}
      {m.kind === 'url' && (
        <label className="block text-[12.5px]">
          URL máy chủ
          <input type="password" value={p.value} onChange={(e) => p.setValue(e.target.value)} placeholder="https://…" className={`${input} mt-1 font-mono`} />
        </label>
      )}
      {m.kind === 'oauth-app' && (
        <>
          <div className="text-[12px]">
            Địa chỉ chuyển hướng (khai báo trong OAuth app):
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-bg px-2 py-1 font-mono text-[12px]">http://127.0.0.1:47621/oauth/callback</code>
              <button
                type="button"
                className="text-[11.5px] text-accent hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText('http://127.0.0.1:47621/oauth/callback')
                  setCopied(true)
                }}
              >
                {copied ? 'Đã chép' : 'Chép'}
              </button>
              {m.register && (
                <a href={m.register} target="_blank" rel="noreferrer" className="text-[11.5px] text-accent hover:underline">
                  Tạo OAuth app ↗
                </a>
              )}
            </div>
          </div>
          <label className="block text-[12.5px]">
            Client ID <span className="text-muted">(bỏ trống: app thử tự đăng ký nếu dịch vụ cho phép)</span>
            <input value={p.clientId} onChange={(e) => p.setClientId(e.target.value)} spellCheck={false} className={`${input} mt-1 font-mono`} />
          </label>
          <label className="block text-[12.5px]">
            Client secret (nếu có)
            <input type="password" value={p.clientSecret} onChange={(e) => p.setClientSecret(e.target.value)} className={`${input} mt-1 font-mono`} />
          </label>
        </>
      )}
      {m.serverUrl && m.kind !== 'url' && m.kind !== 'stdio' && (
        <div className="text-[11.5px] text-muted">
          Máy chủ: <code className="font-mono">{m.serverUrl}</code>
        </div>
      )}
      {m.warnings.map((w) => (
        <div key={w} className="rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-2.5 py-1.5 text-[11.5px] text-amber-200/90">
          {w}
        </div>
      ))}
      {m.docs && (
        <a href={m.docs} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
          Hướng dẫn ↗
        </a>
      )}
    </div>
  )
}

function Radio({ checked, onChange, label, desc }: { checked: boolean; onChange: () => void; label: string; desc?: React.ReactNode }): React.JSX.Element {
  return (
    <label className={`mb-2 flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${checked ? 'border-accent bg-accent/10' : 'border-line hover:bg-panel-2/60'}`}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {desc && <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">{desc}</span>}
      </span>
    </label>
  )
}

// ---- Duyệt ----

export function ReviewView({ connectorLabel }: { connectorLabel: (id: string) => Connector | undefined }): React.JSX.Element {
  const items = useApprovals((s) => s.items)
  const workspaces = useWorkspaces((s) => s.items)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <>
      <h1 className="text-[18px] font-semibold tracking-tight">Duyệt</h1>
      <p className="mb-5 mt-1 text-[12.5px] leading-relaxed text-muted">
        Thao tác agent muốn chạy cần bạn đồng ý trước: cho phép một lần, luôn cho phép (tool đó chuyển sang "Tự cho phép"), hoặc từ chối. Áp dụng cho tool
        connector ở mức "Hỏi trước" trong phiên Claude Code; quá {9} phút không ai duyệt thì agent hỏi trong terminal. Codex tự hỏi trong terminal của nó.
      </p>
      {items.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel px-6 py-10 text-center text-[13px] text-muted">Không có gì đang chờ bạn duyệt.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <ApprovalCard key={a.id} a={a} c={connectorLabel(a.connectorId)} wsName={workspaces.find((w) => w.id === a.workspaceId)?.name ?? ''} now={now} />
          ))}
        </div>
      )}
    </>
  )
}

function ApprovalCard({ a, c, wsName, now }: { a: ToolApproval; c?: Connector; wsName: string; now: number }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const left = Math.max(0, Math.round((Date.parse(a.expiresAt) - now) / 1000))
  const answer = (d: 'allow' | 'always' | 'deny'): void => {
    setBusy(true)
    void window.stag.approvals.answer(a.id, d)
  }
  const name = c?.label || a.connectorId
  return (
    <div className="rounded-xl border border-amber-400/30 bg-panel px-4 py-3.5">
      <div className="flex items-center gap-3">
        <ConnectorLogo slug={c?.catalog?.slug} name={name} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <b className="font-semibold">{a.agentName}</b>
            {wsName && <span className="text-muted"> · {wsName}</span>} muốn dùng <b className="font-semibold">{name}</b>
          </div>
          <div className="mt-0.5 font-mono text-[12px] text-muted">{a.tool}</div>
        </div>
        <span className="text-[11.5px] tabular-nums text-muted">
          còn {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
        </span>
      </div>
      {a.input && a.input !== '{}' && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-bg px-3 py-2 font-mono text-[11.5px]">{a.input}</pre>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => answer('deny')} className="rounded-md border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-300 hover:bg-red-500/10 disabled:opacity-40">
          Từ chối
        </button>
        <button type="button" disabled={busy} onClick={() => answer('always')} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2 disabled:opacity-40">
          Luôn cho phép
        </button>
        <button type="button" disabled={busy} onClick={() => answer('allow')} className="rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40">
          Cho phép
        </button>
      </div>
    </div>
  )
}

/** Có trong danh mục không (để trang chi tiết hiện tên dịch vụ / cách kết nối). */
export function catalogOf(c: Connector): { entry: CatalogEntry; method: CatalogMethod } | null {
  return c.catalog ? findCatalog(c.catalog.slug, c.catalog.method) : null
}

function SearchIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function LinkIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  )
}
