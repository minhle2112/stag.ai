import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  formatCode,
  POLICIES,
  POLICY_LABEL,
  type CredentialLogEntry,
  type CredentialPolicy,
  type CredentialView,
  type ImportKind,
  type ImportPreview,
  type TotpPreview
} from '@shared/credentials'
import { agentKind, type Agent } from '@shared/types'
import { useCredentials } from '../../store/credentials'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Icon } from '../Icon'
import { Button, Modal } from '../Modal'
import { ProductAvatar, productColor } from '../artifacts/ui'
import { errText } from './AdaptersSection'
import { Callout, Empty, ErrorBar, INPUT, INPUT_MONO, SearchBox, SectionTitle, SmallButton } from './controls'
import { LevelBar } from './levels'

/** Agent (không phải ô terminal) của mọi workspace, đọc một lần khi mở trang. */
function useAllAgents(): Record<string, Agent[]> {
  const workspaces = useWorkspaces((s) => s.items)
  const [map, setMap] = useState<Record<string, Agent[]>>({})
  useEffect(() => {
    let live = true
    void Promise.all(
      workspaces.map((w) =>
        window.stag.agent
          .snapshot(w.id)
          .then((s) => [w.id, s.agents.filter((a) => agentKind(a) !== 'terminal')] as const)
          .catch(() => [w.id, [] as Agent[]] as const)
      )
    ).then((rows) => live && setMap(Object.fromEntries(rows)))
    return () => {
      live = false
    }
  }, [workspaces])
  return map
}

function Fav({ name, size = 30 }: { name: string; size?: number }): React.JSX.Element {
  const c = productColor(name)
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-md font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42, color: `color-mix(in srgb, ${c} var(--avatar-ink), var(--color-fg))`, background: `color-mix(in srgb, ${c} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 35%, transparent)` }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

function Chip({ children, tone }: { children: ReactNode; tone?: 'ok' | 'no' | 'warn' }): React.JSX.Element {
  const cls = tone === 'ok' ? 'border-work/40 text-work' : tone === 'no' ? 'border-danger/40 text-danger' : tone === 'warn' ? 'border-wait/40 text-wait' : 'border-line-2 text-muted'
  return <span className={`inline-flex h-[20px] items-center gap-1 rounded border px-1.5 text-[11px] whitespace-nowrap ${cls}`}>{children}</span>
}

/** Vòng đếm ngược của mã 2FA. */
function Ring({ left, period }: { left: number; period: number }): React.JSX.Element {
  const L = 2 * Math.PI * 8
  return (
    <svg viewBox="0 0 22 22" width={18} height={18} className={left <= 5 ? 'text-wait' : 'text-accent'}>
      <circle cx="11" cy="11" r="8" fill="none" stroke="var(--color-line-2)" strokeWidth="2.5" />
      <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={L} strokeDashoffset={L * (1 - left / period)} transform="rotate(-90 11 11)" />
    </svg>
  )
}

/** Mã 2FA hiện tại của mục (main tính, đổi mỗi giây). */
function TotpLive({ id }: { id: string }): React.JSX.Element {
  const [c, setC] = useState<{ code: string; left: number; period: number } | null>(null)
  useEffect(() => {
    let live = true
    const tick = (): void => void window.stag.credentials.code(id).then((r) => live && setC(r))
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [id])
  if (!c) return <span className="text-dim">…</span>
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-[16px] font-semibold tracking-wider">{formatCode(c.code)}</span>
      <Ring left={c.left} period={c.period} />
      <span className="text-[11.5px] text-dim">{c.left}s</span>
    </span>
  )
}

const POLICY_HINT: Record<CredentialPolicy, string> = {
  ask: 'Mỗi lần agent muốn đăng nhập, app hiện thẻ hỏi bạn.',
  first: 'Lần đầu mỗi agent dùng mục này, app hỏi bạn. Bạn chọn “Luôn cho agent này” thì những lần sau không hỏi. Agent bạn chọn ở trên coi như đã cho.',
  auto: 'Agent đã chọn điền ngay không hỏi. Agent khác vẫn xin được, và app hỏi bạn. Vẫn chỉ trên đúng tên miền, mỗi lần dùng đều ghi vào nhật ký.',
  off: 'Mục này chỉ để bạn tự xem / chép. Agent không thấy nó trong credential_list.'
}

const ACTION_TEXT: Record<CredentialLogEntry['action'], string> = {
  login: 'điền đăng nhập',
  username: 'điền tên đăng nhập',
  password: 'điền mật khẩu',
  totp: 'điền mã 2FA',
  blocked: 'muốn điền trên trang sai tên miền',
  denied: 'xin điền, bị từ chối',
  needs_user: 'gặp 2FA kho không điền được',
  saved: 'lưu mục',
  updated: 'cập nhật mục',
  imported: 'nhập',
  totp_saved: 'lưu khoá 2FA'
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const hm = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Hôm nay ${hm}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Hôm qua ${hm}`
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`
}

/**
 * Cài đặt → Mật khẩu: kho mật khẩu cho agent. App tự điền vào trang trong ô Browser (chỉ trên đúng tên miền), agent
 * không bao giờ thấy mật khẩu hay mã 2FA. Mục dùng chung mọi workspace; mỗi mục chọn workspace / agent được dùng.
 */
export function PasswordsSection(): React.JSX.Element {
  const { available, items, never, loaded } = useCredentials()
  const focus = useUi((s) => s.settingsFocus)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ item?: CredentialView; only2fa?: boolean } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const agents = useAllAgents()

  // Mở từ toast "Xem nhật ký" / nút chìa khoá của ô Browser.
  useEffect(() => {
    if (focus?.credential) setSel(focus.credential)
    if (focus?.credentialSearch !== undefined) setQ(focus.credentialSearch)
  }, [focus])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return items.filter((i) => !s || `${i.name} ${i.domains.join(' ')} ${i.username}`.toLowerCase().includes(s))
  }, [items, q])
  const current = items.find((i) => i.id === sel) ?? shown[0] ?? null

  const doImport = (kind: ImportKind): void => {
    setMenu(false)
    setError('')
    window.stag.credentials
      .import(kind)
      .then((p) => p && setPreview(p))
      .catch((e) => setError(errText(e)))
  }

  return (
    <>
      <SectionTitle
        title="Mật khẩu"
        desc="Kho mật khẩu cho agent. Agent nhờ app đăng nhập, app tự điền vào trang trong ô Browser, chỉ trên đúng tên miền của mục. Agent không bao giờ thấy mật khẩu hay mã 2FA. Mã hoá bằng Windows, không ghi vào vault hay cài đặt."
        right={
          <>
            <LevelBar appOnly />
            <div className="relative">
              <SmallButton icon="import" onClick={() => setMenu((m) => !m)}>
                Nhập
              </SmallButton>
              {menu && <ImportMenu onPick={doImport} onClose={() => setMenu(false)} />}
            </div>
            <SmallButton variant="primary" icon="plus" disabled={!available} onClick={() => setDialog({})}>
              Thêm
            </SmallButton>
          </>
        }
      />
      {!available && <ErrorBar error="Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu mật khẩu được." />}
      <ErrorBar error={error} />

      {loaded && !items.length ? (
        <Empty title="Chưa có mật khẩu nào">
          Bấm <b>Thêm</b>, nhập từ Bitwarden / Chrome, hoặc tự đăng nhập một trang trong ô Browser: app hỏi bạn có lưu không. Agent gọi tool <code>credential_fill</code> để app điền giúp.
        </Empty>
      ) : (
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4">
          <div className="min-w-0">
            <SearchBox value={q} onChange={setQ} placeholder="Tìm tên, tên miền, tài khoản…" />
            <div className="mt-2 space-y-0.5">
              {shown.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setSel(i.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${current?.id === i.id ? 'bg-panel-3' : 'hover:bg-panel-2'}`}
                >
                  <Fav name={i.name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{i.name}</span>
                    <span className="block truncate text-[11.5px] text-dim">
                      {i.domains[0]}
                      {i.username ? ` · ${i.username}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    {i.hasTotp && <Chip tone="ok">2FA</Chip>}
                    {i.policy === 'off' ? <Chip tone="no">chỉ bạn</Chip> : <Chip>{i.agents.length} agent</Chip>}
                  </span>
                </button>
              ))}
              {!shown.length && <div className="py-6 text-center text-[12px] text-dim">Không có mục nào khớp.</div>}
            </div>
          </div>
          <div className="min-w-0">{current && <Detail key={current.id} item={current} agents={agents} onEdit={(only2fa) => setDialog({ item: current, only2fa })} />}</div>
        </div>
      )}

      {never.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-dim uppercase">Không bao giờ hỏi lưu</div>
          <div className="flex flex-wrap gap-1.5">
            {never.map((h) => (
              <span key={h} className="inline-flex h-6 items-center gap-1 rounded-md border border-line-2 pr-1 pl-2 font-mono text-[11.5px]">
                {h}
                <button type="button" title="Bỏ khỏi danh sách" className="rounded p-0.5 text-dim hover:bg-panel-3 hover:text-fg" onClick={() => void window.stag.credentials.neverRemove(h)}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {dialog && (
        <ItemDialog
          item={dialog.item}
          only2fa={dialog.only2fa}
          agents={agents}
          onClose={() => setDialog(null)}
          onSaved={(v) => {
            setSel(v.id)
            setDialog(null)
          }}
        />
      )}
      {preview && <ImportDialog preview={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function ImportMenu({ onPick, onClose }: { onPick: (k: ImportKind) => void; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [onClose])
  const item = (k: ImportKind, title: string, sub: string): React.JSX.Element => (
    <button type="button" onClick={() => onPick(k)} className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-panel-3">
      <Icon name="import" className="mt-0.5 text-dim" />
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11.5px] text-dim">{sub}</span>
      </span>
    </button>
  )
  return (
    <div ref={ref} className="absolute top-8 right-0 z-20 w-[310px] rounded-lg border border-line-2 bg-panel-2 p-1 shadow-float">
      {item('bitwarden-json', 'Bitwarden (.json)', 'File export không mã hoá, có cả khoá 2FA')}
      {item('bitwarden-csv', 'Bitwarden (.csv)', 'login_uri, login_username, login_password, login_totp')}
      {item('chrome-csv', 'Chrome / Edge (.csv)', 'Mật khẩu đã lưu trong trình duyệt (không có 2FA)')}
      <div className="mx-2 my-1 border-t border-line" />
      <div className="px-2.5 py-1.5 text-[11.5px] text-dim">Xem trước, bỏ chọn từng mục rồi mới nhập. Nhập xong nhớ xoá file export.</div>
    </div>
  )
}

function Field({ label, children, acts }: { label: string; children: ReactNode; acts?: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-9 items-center gap-3 border-b border-line py-1.5">
      <span className="w-[110px] shrink-0 text-[12px] text-dim">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
      {acts && <div className="flex shrink-0 items-center gap-0.5">{acts}</div>}
    </div>
  )
}

function IconBtn({ icon, tip, onClick }: { icon: 'copy' | 'eye' | 'eyeoff'; tip: string; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" data-tip={tip} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-panel-3 hover:text-fg">
      <Icon name={icon} size="s" />
    </button>
  )
}

function Detail({ item, agents, onEdit }: { item: CredentialView; agents: Record<string, Agent[]>; onEdit: (only2fa: boolean) => void }): React.JSX.Element {
  const workspaces = useWorkspaces((s) => s.items)
  const [pw, setPw] = useState<string | null>(null)
  const [log, setLog] = useState<CredentialLogEntry[] | null>(null)
  const [copied, setCopied] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState('')
  const off = item.policy === 'off'

  useEffect(() => {
    let live = true
    void window.stag.credentials.log(item.id).then((l) => live && setLog(l))
    return () => {
      live = false
    }
  }, [item.id, item.updatedAt, item.lastUsed?.at])
  // Hiện mật khẩu: tự ẩn sau 20 giây.
  useEffect(() => {
    if (pw === null) return
    const t = setTimeout(() => setPw(null), 20_000)
    return () => clearTimeout(t)
  }, [pw])

  const patch = (p: Parameters<typeof window.stag.credentials.patch>[1]): void => {
    setError('')
    window.stag.credentials.patch(item.id, p).catch((e) => setError(errText(e)))
  }
  const copy = (field: 'username' | 'password' | 'totp'): void => {
    void window.stag.credentials.copy(item.id, field).then((ok) => {
      if (!ok) return
      setCopied(field)
      setTimeout(() => setCopied(''), 1500)
    })
  }
  const inScope = workspaces.filter((w) => item.workspaces === null || item.workspaces.includes(w.id))
  const team = inScope.flatMap((w) => (agents[w.id] ?? []).map((a) => ({ a, ws: w.name })))
  const many = inScope.length > 1

  return (
    <div>
      <div className="flex items-center gap-3 pb-2">
        <Fav name={item.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{item.name}</div>
          <div className="text-[12px] text-dim">Lần dùng cuối: {item.lastUsed ? `${when(item.lastUsed.at)} · ${item.lastUsed.agentName}` : 'Chưa dùng'}</div>
        </div>
        <SmallButton icon="pen" onClick={() => onEdit(false)}>
          Sửa
        </SmallButton>
        {confirmDel ? (
          <>
            <SmallButton variant="dangerSolid" onClick={() => void window.stag.credentials.remove(item.id)}>
              Xoá hẳn
            </SmallButton>
            <SmallButton variant="ghost" onClick={() => setConfirmDel(false)}>
              Thôi
            </SmallButton>
          </>
        ) : (
          <SmallButton variant="ghost" onClick={() => setConfirmDel(true)}>
            Xoá
          </SmallButton>
        )}
      </div>
      <ErrorBar error={error} />

      <div className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-dim uppercase">Đăng nhập</div>
      <Field label="Tên miền">
        {item.domains.map((d) => (
          <span key={d} className="inline-flex h-6 items-center gap-1 rounded-md border border-line-2 px-1.5 font-mono text-[11.5px]">
            <Icon name="globe" size={12} className="text-dim" />
            {d}
          </span>
        ))}
      </Field>
      <Field label="Tên đăng nhập" acts={item.username ? <IconBtn icon="copy" tip={copied === 'username' ? 'Đã chép' : 'Chép'} onClick={() => copy('username')} /> : undefined}>
        <span className="truncate">{item.username || <span className="text-dim">(không có)</span>}</span>
      </Field>
      <Field
        label="Mật khẩu"
        acts={
          item.hasPassword ? (
            <>
              <IconBtn icon={pw !== null ? 'eyeoff' : 'eye'} tip={pw !== null ? 'Ẩn' : 'Hiện (tự ẩn sau 20 giây)'} onClick={() => (pw !== null ? setPw(null) : void window.stag.credentials.reveal(item.id).then((v) => setPw(v ?? '')))} />
              <IconBtn icon="copy" tip={copied === 'password' ? 'Đã chép' : 'Chép (tự xoá khỏi clipboard sau 30 giây)'} onClick={() => copy('password')} />
            </>
          ) : undefined
        }
      >
        {item.hasPassword ? (
          <>
            <span className="font-mono text-[12.5px]">{pw ?? '••••••••••••••••'}</span>
            {pw !== null && <Chip tone="warn">tự ẩn sau 20 giây</Chip>}
          </>
        ) : (
          <span className="text-dim">Chưa có</span>
        )}
      </Field>
      <Field label="Mã 2FA" acts={item.hasTotp ? <IconBtn icon="copy" tip={copied === 'totp' ? 'Đã chép' : 'Chép'} onClick={() => copy('totp')} /> : undefined}>
        {item.hasTotp ? (
          <TotpLive id={item.id} />
        ) : (
          <>
            <span className="text-dim">Chưa có</span>
            <SmallButton icon="qr" onClick={() => onEdit(true)}>
              Thêm 2FA
            </SmallButton>
          </>
        )}
      </Field>

      <div className="mt-5 mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-dim uppercase">
        <span className="flex-1">Agent được dùng</span>
        <select
          aria-label="Workspace"
          className={`${INPUT} h-6 w-auto text-[12px] font-normal tracking-normal normal-case`}
          value={item.workspaces === null ? '*' : (item.workspaces[0] ?? '*')}
          onChange={(e) => patch({ workspaces: e.target.value === '*' ? null : [e.target.value] })}
        >
          <option value="*">Mọi workspace</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              Workspace: {w.name}
            </option>
          ))}
        </select>
      </div>
      <Field label="Agent">
        {team.length ? (
          team.map(({ a, ws }) => {
            const on = item.agents.includes(a.id) && !off
            return (
              <button
                key={a.id}
                type="button"
                disabled={off}
                onClick={() => patch({ agents: on ? item.agents.filter((x) => x !== a.id) : [...item.agents, a.id] })}
                className={`inline-flex h-6 items-center gap-1.5 rounded-full border pr-2 pl-0.5 text-[12px] disabled:opacity-50 ${on ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg'}`}
              >
                <ProductAvatar name={a.name} small />
                {a.name}
                {many && <span className="text-dim">· {ws}</span>}
                {on && <Icon name="check" size={12} className="text-accent" />}
              </button>
            )
          })
        ) : (
          <span className="text-[12px] text-dim">Chưa có agent nào.</span>
        )}
      </Field>
      <Field label="Khi agent dùng">
        <div className="inline-flex flex-wrap rounded-md border border-line-2 p-0.5">
          {POLICIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => patch({ policy: p })}
              className={`rounded px-2 py-0.5 text-[12px] ${item.policy === p ? (p === 'off' ? 'bg-danger/15 text-danger' : 'bg-panel-3 font-medium text-fg') : 'text-muted hover:text-fg'}`}
            >
              {POLICY_LABEL[p]}
            </button>
          ))}
        </div>
      </Field>
      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{POLICY_HINT[item.policy]}</p>

      <div className="mt-5 mb-1 flex items-center text-[11px] font-semibold tracking-wider text-dim uppercase">
        <span className="flex-1">Nhật ký dùng</span>
        <span className="font-normal tracking-normal normal-case">90 ngày · không ghi mật khẩu</span>
      </div>
      <div className="rounded-md border border-line">
        {log === null ? (
          <div className="px-3 py-2 text-[12px] text-dim">…</div>
        ) : !log.length ? (
          <div className="px-3 py-2 text-[12px] text-dim">Chưa có lần dùng nào.</div>
        ) : (
          log.slice(0, 30).map((e, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
              <span className="w-[92px] shrink-0 text-dim">{when(e.at)}</span>
              {e.agentId ? <ProductAvatar name={e.agentName} small /> : <span className="w-[15px]" />}
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium">{e.agentName}</b>{' '}
                {e.action === 'blocked' && e.detail === 'insecure_page' ? 'muốn điền trên trang http:// (không mã hoá)' : (ACTION_TEXT[e.action] ?? e.action)}
                {e.host && (
                  <>
                    {' '}
                    trên <span className={e.action === 'blocked' ? 'font-medium text-danger' : ''}>{e.host}</span>
                  </>
                )}
                {e.how === 'once' ? ' · bạn cho phép' : e.how === 'always' ? ' · bạn cho phép, luôn cho' : ''}
              </span>
              {e.action === 'blocked' ? (
                <Chip tone="no">đã chặn</Chip>
              ) : e.action === 'denied' ? (
                <Chip tone="no">từ chối</Chip>
              ) : e.action === 'needs_user' ? (
                <Chip tone="warn">cần bạn</Chip>
              ) : e.agentId ? (
                <Chip tone="ok">đã điền</Chip>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** Mật khẩu ngẫu nhiên 20 ký tự (chữ hoa, thường, số, ký hiệu). */
function strongPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%&*+-=?@_']
  const all = sets.join('')
  const r = new Uint32Array(20)
  crypto.getRandomValues(r)
  const out = [...r].map((x, i) => (i < sets.length ? sets[i][x % sets[i].length] : all[x % all.length]))
  for (let i = out.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

function ItemDialog({
  item,
  only2fa,
  agents,
  onClose,
  onSaved
}: {
  item?: CredentialView
  only2fa?: boolean
  agents: Record<string, Agent[]>
  onClose: () => void
  onSaved: (v: CredentialView) => void
}): React.JSX.Element {
  const activeWs = useWorkspaces((s) => s.activeId)
  const [name, setName] = useState(item?.name ?? '')
  const [domains, setDomains] = useState(item?.domains.join(', ') ?? '')
  const [username, setUsername] = useState(item?.username ?? '')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [tab, setTab] = useState<'key' | 'qr'>('key')
  const [key, setKey] = useState('')
  const [totp, setTotp] = useState<TotpPreview | null>(null)
  const [verified, setVerified] = useState(false)
  const [removeTotp, setRemoveTotp] = useState(false)
  const [picked, setPicked] = useState<string[]>(item?.agents ?? [])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const team = activeWs ? (agents[activeWs] ?? []) : []

  // Khoá dán vào: kiểm và hiện mã hiện tại để so với app trên điện thoại.
  useEffect(() => {
    setVerified(false)
    if (!key.trim()) return setTotp(null)
    const t = setTimeout(() => void window.stag.credentials.totpPreview(key).then(setTotp), 250)
    return () => clearTimeout(t)
  }, [key])
  // Mã đổi mỗi 30 giây: làm mới khi đã có khoá hợp lệ.
  useEffect(() => {
    if (!totp?.ok || !totp.value) return
    const t = setInterval(() => void window.stag.credentials.totpPreview(totp.value!).then((p) => setTotp((cur) => (cur && cur.value === p.value ? { ...p, value: cur.value } : cur))), 1000)
    return () => clearInterval(t)
  }, [totp?.ok, totp?.value])

  const fromScan = (p: TotpPreview | null): void => {
    if (!p) return
    if (!p.ok) return setError(p.error ?? 'Không đọc được mã QR.')
    setError('')
    setKey(p.value ?? '')
    setTab('key')
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    const file = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))?.getAsFile()
    if (!file) return
    e.preventDefault()
    const r = new FileReader()
    r.onload = () => void window.stag.credentials.scanImage(String(r.result)).then(fromScan)
    r.readAsDataURL(file)
  }

  const hasKey = !!key.trim()
  const canSave = !busy && (!hasKey || (totp?.ok && verified)) && (only2fa ? hasKey : !!name.trim() && !!domains.trim() && (!!item || !!password || hasKey))
  const save = (): void => {
    setBusy(true)
    setError('')
    window.stag.credentials
      .save({
        ...(item ? { id: item.id } : {}),
        name: name.trim(),
        domains: domains.split(/[\s,]+/).filter(Boolean),
        username,
        ...(password ? { password } : {}),
        ...(hasKey ? { totp: totp?.value ?? key } : removeTotp ? { totp: null } : {}),
        ...(only2fa ? {} : { agents: item ? [...new Set([...item.agents.filter((a) => !team.some((t) => t.id === a)), ...picked])] : picked })
      })
      .then(onSaved)
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      title={only2fa ? 'Thêm 2FA' : item ? 'Sửa mật khẩu' : 'Thêm mật khẩu'}
      icon="key"
      width="w-[600px]"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Huỷ
          </Button>
          <Button primary disabled={!canSave} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3" onPaste={onPaste}>
        <ErrorBar error={error} />
        {!only2fa && (
          <>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Tên</span>
              <input className={`${INPUT} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop ABC · admin" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">Tên miền</span>
              <input className={`${INPUT_MONO} w-full`} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="admin.shop-abc.vn" spellCheck={false} />
              <span className="mt-1 block text-[11.5px] text-dim">
                App chỉ điền trên đúng tên miền này. Thêm <code>*.shop-abc.vn</code> nếu muốn cả tên miền con. Nhiều tên miền: cách nhau bằng dấu phẩy.
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] text-muted">Tên đăng nhập</span>
                <input className={`${INPUT} w-full`} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin@shop-abc.vn" spellCheck={false} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-muted">Mật khẩu</span>
                <span className="flex items-center gap-1">
                  <input
                    className={`${INPUT_MONO} min-w-0 flex-1`}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={item?.hasPassword ? '(giữ nguyên)' : ''}
                    autoComplete="new-password"
                  />
                  <button type="button" data-tip={showPw ? 'Ẩn' : 'Hiện'} onClick={() => setShowPw((v) => !v)} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-panel-3 hover:text-fg">
                    <Icon name={showPw ? 'eyeoff' : 'eye'} size="s" />
                  </button>
                  <button
                    type="button"
                    data-tip="Tạo mật khẩu mạnh"
                    onClick={() => {
                      setPassword(strongPassword())
                      setShowPw(true)
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-panel-3 hover:text-fg"
                  >
                    <Icon name="dice" size="s" />
                  </button>
                </span>
              </label>
            </div>
          </>
        )}

        <div>
          <span className="mb-1 block text-[12px] text-muted">{only2fa ? `Khoá 2FA cho “${item?.name ?? ''}”` : 'Mã 2FA (không bắt buộc)'}</span>
          <div className="rounded-lg border border-line-2 bg-panel p-2.5">
            <div className="mb-2 inline-flex rounded-md border border-line-2 p-0.5">
              {(['key', 'qr'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2.5 py-0.5 text-[12px] ${tab === t ? 'bg-panel-3 font-medium' : 'text-muted hover:text-fg'}`}>
                  {t === 'key' ? 'Dán khoá' : 'Quét QR'}
                </button>
              ))}
            </div>
            {tab === 'key' ? (
              <>
                <input
                  className={`${INPUT_MONO} w-full`}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={item?.hasTotp ? '(đã có khoá 2FA — dán khoá mới để thay)' : 'JBSW Y3DP EHPK 3PXP… hoặc otpauth://totp/…'}
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="mt-1 block text-[11.5px] text-dim">
                  Khoá bí mật trang web hiện khi bật 2FA (“không quét được mã?”), hoặc dán cả link <code>otpauth://totp/…</code>. Dán ảnh QR (Ctrl+V) cũng được.
                </span>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void window.stag.credentials.scanScreen().then(fromScan)} className="rounded-md border border-dashed border-line-2 px-3 py-3 text-center text-[12px] text-muted hover:border-accent/50 hover:text-fg">
                  <Icon name="monitor" size={20} className="mx-auto mb-1" />
                  <b className="block font-medium text-fg">Quét trên màn hình</b>
                  Mở trang hiện mã QR (ô Browser cũng được) rồi bấm. App tìm mã QR trên màn hình.
                </button>
                <button type="button" onClick={() => void window.stag.credentials.scanImage().then(fromScan)} className="rounded-md border border-dashed border-line-2 px-3 py-3 text-center text-[12px] text-muted hover:border-accent/50 hover:text-fg">
                  <Icon name="img" size={20} className="mx-auto mb-1" />
                  <b className="block font-medium text-fg">Chọn ảnh QR</b>
                  hoặc dán ảnh bằng Ctrl+V
                </button>
              </div>
            )}
            {hasKey && totp && (
              <div className="mt-2.5 flex items-center gap-3 rounded-md border border-line bg-bg px-2.5 py-2">
                {totp.ok ? (
                  <>
                    <span className="font-mono text-[17px] font-semibold tracking-wider">{totp.code}</span>
                    <Ring left={totp.left ?? 30} period={30} />
                    <span className="min-w-0 flex-1 text-[12px] text-muted">
                      App 2FA trên điện thoại của bạn có hiện đúng mã này không?{totp.issuer ? ` (${totp.issuer}${totp.account ? ` · ${totp.account}` : ''})` : ''}
                    </span>
                    {verified ? (
                      <Chip tone="ok">
                        <Icon name="check" size={11} />
                        Đã kiểm
                      </Chip>
                    ) : (
                      <SmallButton icon="check" onClick={() => setVerified(true)}>
                        Khớp
                      </SmallButton>
                    )}
                  </>
                ) : (
                  <span className="text-[12px] text-danger">{totp.error}</span>
                )}
              </div>
            )}
            {item?.hasTotp && !only2fa && !hasKey && (
              <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={removeTotp} onChange={(e) => setRemoveTotp(e.target.checked)} />
                Bỏ khoá 2FA đã lưu
              </label>
            )}
          </div>
        </div>

        {!only2fa && (
          <div>
            <span className="mb-1 block text-[12px] text-muted">Agent được dùng {team.length ? '(workspace đang mở)' : ''}</span>
            <div className="flex flex-wrap gap-1.5">
              {team.map((a) => {
                const on = picked.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
                    className={`inline-flex h-6 items-center gap-1.5 rounded-full border pr-2 pl-0.5 text-[12px] ${on ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line-2 text-muted hover:text-fg'}`}
                  >
                    <ProductAvatar name={a.name} small />
                    {a.name}
                    {on && <Icon name="check" size={12} className="text-accent" />}
                  </button>
                )
              })}
              {!team.length && <span className="text-[12px] text-dim">Chưa có agent nào trong workspace đang mở.</span>}
            </div>
            <span className="mt-1 block text-[11.5px] text-dim">
              {item ? 'Đổi chế độ hỏi ở trang chi tiết.' : 'Mục mới: “Hỏi mỗi lần”. Agent chưa được chọn vẫn có thể xin, và app sẽ hỏi bạn.'}
            </span>
          </div>
        )}
        {hasKey && totp?.ok && !verified && <Callout tone="wait">Bấm “Khớp” sau khi so mã với app trên điện thoại rồi mới lưu được.</Callout>}
      </div>
    </Modal>
  )
}

function ImportDialog({ preview, onClose }: { preview: ImportPreview; onClose: () => void }): React.JSX.Element {
  const [pick, setPick] = useState<Set<number>>(() => new Set(preview.rows.map((_r, i) => i)))
  const [result, setResult] = useState<{ added: number; updated: number; errors: string[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const folder = preview.file.replace(/[\\/][^\\/]*$/, '')
  const toggle = (i: number): void =>
    setPick((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  const run = (): void => {
    setBusy(true)
    window.stag.credentials
      .importCommit(preview.token, [...pick])
      .then(setResult)
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal
      title="Nhập mật khẩu"
      icon="import"
      width="w-[640px]"
      onClose={onClose}
      footer={
        result ? (
          <Button primary onClick={onClose}>
            Xong
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button primary disabled={busy || !pick.size} onClick={run}>
              Nhập {pick.size} mục
            </Button>
          </>
        )
      }
    >
      <ErrorBar error={error} />
      {result ? (
        <div className="space-y-3">
          <Callout tone="ok" icon="check">
            Đã thêm {result.added} mục{result.updated ? `, cập nhật ${result.updated} mục đã có` : ''}. Mục nhập vào ở chế độ “Hỏi mỗi lần”, chưa agent nào được chọn.
          </Callout>
          {result.errors.length > 0 && (
            <Callout tone="danger">
              {result.errors.slice(0, 8).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </Callout>
          )}
          <Callout tone="wait" icon="shield">
            <div className="font-medium">Xoá file export ngay</div>
            <div className="mt-0.5 break-all">
              <code>{preview.file}</code> chứa mật khẩu chưa mã hoá.
            </div>
            <div className="mt-1.5">
              <SmallButton onClick={() => void window.stag.openFolder(folder)}>Mở thư mục</SmallButton>
            </div>
          </Callout>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted">
            <span className="break-all font-mono">{preview.file}</span> · {preview.rows.length} mục đăng nhập. Bỏ chọn mục không muốn nhập.
          </p>
          {preview.errors.length > 0 && (
            <Callout tone="wait" className="mb-2">
              {preview.errors.slice(0, 6).map((e) => (
                <div key={e}>{e}</div>
              ))}
              {preview.errors.length > 6 && <div>… và {preview.errors.length - 6} dòng khác</div>}
            </Callout>
          )}
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-line">
            {preview.rows.map((r, i) => (
              <label key={i} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 text-[12.5px] last:border-b-0 hover:bg-panel-2">
                <input type="checkbox" checked={pick.has(i)} onChange={() => toggle(i)} />
                <Fav name={r.name} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.name}</span>
                  <span className="block truncate text-[11.5px] text-dim">
                    {r.domains.join(', ')}
                    {r.username ? ` · ${r.username}` : ''}
                  </span>
                </span>
                {r.hasTotp && <Chip tone="ok">2FA</Chip>}
                {r.duplicate && <Chip tone="warn">đã có → cập nhật</Chip>}
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
