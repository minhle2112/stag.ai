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
import type { PlainKey } from '@shared/i18n'
import { agentKind, type Agent } from '@shared/types'
import { fmtDate, fmtTime, t, tx, useT } from '../../i18n'
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

const POLICY_HINT: Record<CredentialPolicy, PlainKey> = {
  ask: 'passwords.policyHint.ask',
  first: 'passwords.policyHint.first',
  auto: 'passwords.policyHint.auto',
  off: 'passwords.policyHint.off'
}

const ACTION_TEXT: Record<CredentialLogEntry['action'], PlainKey> = {
  login: 'passwords.action.login',
  username: 'passwords.action.username',
  password: 'passwords.action.password',
  totp: 'passwords.action.totp',
  blocked: 'passwords.action.blocked',
  denied: 'passwords.action.denied',
  needs_user: 'passwords.action.needsUser',
  saved: 'passwords.action.saved',
  updated: 'passwords.action.updated',
  imported: 'passwords.action.imported',
  totp_saved: 'passwords.action.totpSaved'
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const hm = fmtTime(d)
  if (d.toDateString() === now.toDateString()) return t('passwords.when.today', { time: hm })
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return t('passwords.when.yesterday', { time: hm })
  return `${fmtDate(d, { day: 'numeric', month: 'numeric' })} ${hm}`
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
  const t = useT()

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
        title={t('common.name.passwords')}
        desc={t('passwords.section.desc')}
        right={
          <>
            <LevelBar appOnly />
            <div className="relative">
              <SmallButton icon="import" onClick={() => setMenu((m) => !m)}>
                {t('passwords.section.import')}
              </SmallButton>
              {menu && <ImportMenu onPick={doImport} onClose={() => setMenu(false)} />}
            </div>
            <SmallButton variant="primary" icon="plus" disabled={!available} onClick={() => setDialog({})}>
              {t('common.add')}
            </SmallButton>
          </>
        }
      />
      {!available && <ErrorBar error={t('passwords.store.noCipher')} />}
      <ErrorBar error={error} />

      {loaded && !items.length ? (
        <Empty title={t('passwords.section.emptyTitle')}>
          {tx('passwords.section.emptyBody', { add: <b>{t('common.add')}</b>, tool: <code>credential_fill</code> })}
        </Empty>
      ) : (
        <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4">
          <div className="min-w-0">
            <SearchBox value={q} onChange={setQ} placeholder={t('passwords.section.search')} />
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
                    {i.policy === 'off' ? <Chip tone="no">{t('passwords.section.onlyYou')}</Chip> : <Chip>{t('passwords.section.agentCount', { count: i.agents.length })}</Chip>}
                  </span>
                </button>
              ))}
              {!shown.length && <div className="py-6 text-center text-[12px] text-dim">{t('passwords.section.noMatch')}</div>}
            </div>
          </div>
          <div className="min-w-0">{current && <Detail key={current.id} item={current} agents={agents} onEdit={(only2fa) => setDialog({ item: current, only2fa })} />}</div>
        </div>
      )}

      {never.length > 0 && (
        <div className="mt-6">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-dim uppercase">{t('passwords.section.never')}</div>
          <div className="flex flex-wrap gap-1.5">
            {never.map((h) => (
              <span key={h} className="inline-flex h-6 items-center gap-1 rounded-md border border-line-2 pr-1 pl-2 font-mono text-[11.5px]">
                {h}
                <button type="button" title={t('passwords.section.neverRemove')} className="rounded p-0.5 text-dim hover:bg-panel-3 hover:text-fg" onClick={() => void window.stag.credentials.neverRemove(h)}>
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
  const t = useT()
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
      {item('bitwarden-json', 'Bitwarden (.json)', t('passwords.importMenu.bitwardenJson'))}
      {item('bitwarden-csv', 'Bitwarden (.csv)', 'login_uri, login_username, login_password, login_totp')}
      {item('chrome-csv', 'Chrome / Edge (.csv)', t('passwords.importMenu.chromeCsv'))}
      <div className="mx-2 my-1 border-t border-line" />
      <div className="px-2.5 py-1.5 text-[11.5px] text-dim">{t('passwords.importMenu.note')}</div>
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
  const t = useT()

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
          <div className="text-[12px] text-dim">{t('passwords.detail.lastUsed', { when: item.lastUsed ? `${when(item.lastUsed.at)} · ${item.lastUsed.agentName}` : t('passwords.detail.never') })}</div>
        </div>
        <SmallButton icon="pen" onClick={() => onEdit(false)}>
          {t('common.edit')}
        </SmallButton>
        {confirmDel ? (
          <>
            <SmallButton variant="dangerSolid" onClick={() => void window.stag.credentials.remove(item.id)}>
              {t('passwords.detail.deleteForGood')}
            </SmallButton>
            <SmallButton variant="ghost" onClick={() => setConfirmDel(false)}>
              {t('common.cancel')}
            </SmallButton>
          </>
        ) : (
          <SmallButton variant="ghost" onClick={() => setConfirmDel(true)}>
            {t('common.delete')}
          </SmallButton>
        )}
      </div>
      <ErrorBar error={error} />

      <div className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-dim uppercase">{t('passwords.detail.login')}</div>
      <Field label={t('passwords.field.domain')}>
        {item.domains.map((d) => (
          <span key={d} className="inline-flex h-6 items-center gap-1 rounded-md border border-line-2 px-1.5 font-mono text-[11.5px]">
            <Icon name="globe" size={12} className="text-dim" />
            {d}
          </span>
        ))}
      </Field>
      <Field label={t('passwords.field.username')} acts={item.username ? <IconBtn icon="copy" tip={copied === 'username' ? t('common.copied') : t('common.copy')} onClick={() => copy('username')} /> : undefined}>
        <span className="truncate">{item.username || <span className="text-dim">{t('passwords.detail.none')}</span>}</span>
      </Field>
      <Field
        label={t('passwords.field.password')}
        acts={
          item.hasPassword ? (
            <>
              <IconBtn icon={pw !== null ? 'eyeoff' : 'eye'} tip={pw !== null ? t('passwords.detail.hide') : t('passwords.detail.reveal')} onClick={() => (pw !== null ? setPw(null) : void window.stag.credentials.reveal(item.id).then((v) => setPw(v ?? '')))} />
              <IconBtn icon="copy" tip={copied === 'password' ? t('common.copied') : t('passwords.detail.copyPassword')} onClick={() => copy('password')} />
            </>
          ) : undefined
        }
      >
        {item.hasPassword ? (
          <>
            <span className="font-mono text-[12.5px]">{pw ?? '••••••••••••••••'}</span>
            {pw !== null && <Chip tone="warn">{t('passwords.detail.autoHide')}</Chip>}
          </>
        ) : (
          <span className="text-dim">{t('passwords.detail.notSet')}</span>
        )}
      </Field>
      <Field label={t('passwords.field.totp')} acts={item.hasTotp ? <IconBtn icon="copy" tip={copied === 'totp' ? t('common.copied') : t('common.copy')} onClick={() => copy('totp')} /> : undefined}>
        {item.hasTotp ? (
          <TotpLive id={item.id} />
        ) : (
          <>
            <span className="text-dim">{t('passwords.detail.notSet')}</span>
            <SmallButton icon="qr" onClick={() => onEdit(true)}>
              {t('passwords.detail.add2fa')}
            </SmallButton>
          </>
        )}
      </Field>

      <div className="mt-5 mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-dim uppercase">
        <span className="flex-1">{t('passwords.detail.agents')}</span>
        <select
          aria-label="Workspace"
          className={`${INPUT} h-6 w-auto text-[12px] font-normal tracking-normal normal-case`}
          value={item.workspaces === null ? '*' : (item.workspaces[0] ?? '*')}
          onChange={(e) => patch({ workspaces: e.target.value === '*' ? null : [e.target.value] })}
        >
          <option value="*">{t('passwords.detail.allWorkspaces')}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {t('passwords.detail.workspace', { name: w.name })}
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
          <span className="text-[12px] text-dim">{t('passwords.detail.noAgents')}</span>
        )}
      </Field>
      <Field label={t('passwords.detail.whenUsed')}>
        <div className="inline-flex flex-wrap rounded-md border border-line-2 p-0.5">
          {POLICIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => patch({ policy: p })}
              className={`rounded px-2 py-0.5 text-[12px] ${item.policy === p ? (p === 'off' ? 'bg-danger/15 text-danger' : 'bg-panel-3 font-medium text-fg') : 'text-muted hover:text-fg'}`}
            >
              {t(POLICY_LABEL[p])}
            </button>
          ))}
        </div>
      </Field>
      <p className="mt-1.5 text-[12px] leading-relaxed text-dim">{t(POLICY_HINT[item.policy])}</p>

      <div className="mt-5 mb-1 flex items-center text-[11px] font-semibold tracking-wider text-dim uppercase">
        <span className="flex-1">{t('passwords.detail.log')}</span>
        <span className="font-normal tracking-normal normal-case">{t('passwords.detail.logNote')}</span>
      </div>
      <div className="rounded-md border border-line">
        {log === null ? (
          <div className="px-3 py-2 text-[12px] text-dim">…</div>
        ) : !log.length ? (
          <div className="px-3 py-2 text-[12px] text-dim">{t('passwords.detail.logEmpty')}</div>
        ) : (
          log.slice(0, 30).map((e, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] last:border-b-0">
              <span className="w-[92px] shrink-0 text-dim">{when(e.at)}</span>
              {e.agentId ? <ProductAvatar name={e.agentName} small /> : <span className="w-[15px]" />}
              <span className="min-w-0 flex-1 truncate">
                {tx(e.host ? 'passwords.log.lineOn' : 'passwords.log.line', {
                  who: <b className="font-medium">{e.agentId ? e.agentName : t('passwords.log.you')}</b>,
                  action: e.action === 'blocked' && e.detail === 'insecure_page' ? t('passwords.action.insecure') : ACTION_TEXT[e.action] ? t(ACTION_TEXT[e.action]) : e.action,
                  host: <span className={e.action === 'blocked' ? 'font-medium text-danger' : ''}>{e.host}</span>
                })}
                {e.how === 'once' ? t('passwords.log.allowedOnce') : e.how === 'always' ? t('passwords.log.allowedAlways') : ''}
              </span>
              {e.action === 'blocked' ? (
                <Chip tone="no">{t('passwords.log.chipBlocked')}</Chip>
              ) : e.action === 'denied' ? (
                <Chip tone="no">{t('passwords.log.chipDenied')}</Chip>
              ) : e.action === 'needs_user' ? (
                <Chip tone="warn">{t('passwords.log.chipNeedsUser')}</Chip>
              ) : e.agentId ? (
                <Chip tone="ok">{t('passwords.log.chipFilled')}</Chip>
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
  const t = useT()

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
    if (!p.ok) return setError(p.error ?? t('passwords.item.qrUnreadable'))
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
      title={only2fa ? t('passwords.detail.add2fa') : item ? t('passwords.item.editTitle') : t('passwords.item.addTitle')}
      icon="key"
      width="w-[600px]"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button primary disabled={!canSave} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3" onPaste={onPaste}>
        <ErrorBar error={error} />
        {!only2fa && (
          <>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">{t('passwords.item.name')}</span>
              <input className={`${INPUT} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop ABC · admin" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] text-muted">{t('passwords.field.domain')}</span>
              <input className={`${INPUT_MONO} w-full`} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="admin.shop-abc.vn" spellCheck={false} />
              <span className="mt-1 block text-[11.5px] text-dim">
                {tx('passwords.item.domainHint', { wild: <code>*.shop-abc.vn</code> })}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] text-muted">{t('passwords.field.username')}</span>
                <input className={`${INPUT} w-full`} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin@shop-abc.vn" spellCheck={false} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-muted">{t('passwords.field.password')}</span>
                <span className="flex items-center gap-1">
                  <input
                    className={`${INPUT_MONO} min-w-0 flex-1`}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={item?.hasPassword ? t('passwords.item.keep') : ''}
                    autoComplete="new-password"
                  />
                  <button type="button" data-tip={showPw ? t('passwords.detail.hide') : t('passwords.item.show')} onClick={() => setShowPw((v) => !v)} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-panel-3 hover:text-fg">
                    <Icon name={showPw ? 'eyeoff' : 'eye'} size="s" />
                  </button>
                  <button
                    type="button"
                    data-tip={t('passwords.item.generate')}
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
          <span className="mb-1 block text-[12px] text-muted">{only2fa ? t('passwords.item.keyFor', { name: item?.name ?? '' }) : t('passwords.item.totpOptional')}</span>
          <div className="rounded-lg border border-line-2 bg-panel p-2.5">
            <div className="mb-2 inline-flex rounded-md border border-line-2 p-0.5">
              {(['key', 'qr'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`rounded px-2.5 py-0.5 text-[12px] ${tab === k ? 'bg-panel-3 font-medium' : 'text-muted hover:text-fg'}`}>
                  {k === 'key' ? t('passwords.item.tabKey') : t('passwords.item.tabQr')}
                </button>
              ))}
            </div>
            {tab === 'key' ? (
              <>
                <input
                  className={`${INPUT_MONO} w-full`}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={item?.hasTotp ? t('passwords.item.keyReplace') : t('passwords.item.keyPlaceholder')}
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="mt-1 block text-[11.5px] text-dim">
                  {tx('passwords.item.keyHint', { link: <code>otpauth://totp/…</code> })}
                </span>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => void window.stag.credentials.scanScreen().then(fromScan)} className="rounded-md border border-dashed border-line-2 px-3 py-3 text-center text-[12px] text-muted hover:border-accent/50 hover:text-fg">
                  <Icon name="monitor" size={20} className="mx-auto mb-1" />
                  <b className="block font-medium text-fg">{t('passwords.item.scanScreen')}</b>
                  {t('passwords.item.scanScreenDesc')}
                </button>
                <button type="button" onClick={() => void window.stag.credentials.scanImage().then(fromScan)} className="rounded-md border border-dashed border-line-2 px-3 py-3 text-center text-[12px] text-muted hover:border-accent/50 hover:text-fg">
                  <Icon name="img" size={20} className="mx-auto mb-1" />
                  <b className="block font-medium text-fg">{t('passwords.item.pickImage')}</b>
                  {t('passwords.item.pickImageDesc')}
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
                      {t('passwords.item.verifyAsk')}{totp.issuer ? ` (${totp.issuer}${totp.account ? ` · ${totp.account}` : ''})` : ''}
                    </span>
                    {verified ? (
                      <Chip tone="ok">
                        <Icon name="check" size={11} />
                        {t('passwords.item.verified')}
                      </Chip>
                    ) : (
                      <SmallButton icon="check" onClick={() => setVerified(true)}>
                        {t('passwords.item.match')}
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
                {t('passwords.item.removeTotp')}
              </label>
            )}
          </div>
        </div>

        {!only2fa && (
          <div>
            <span className="mb-1 block text-[12px] text-muted">{team.length ? t('passwords.item.agentsOpenWs') : t('passwords.detail.agents')}</span>
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
              {!team.length && <span className="text-[12px] text-dim">{t('passwords.item.noAgentsWs')}</span>}
            </div>
            <span className="mt-1 block text-[11.5px] text-dim">
              {item ? t('passwords.item.policyEdit') : t('passwords.item.policyNew')}
            </span>
          </div>
        )}
        {hasKey && totp?.ok && !verified && <Callout tone="wait">{t('passwords.item.verifyFirst')}</Callout>}
      </div>
    </Modal>
  )
}

function ImportDialog({ preview, onClose }: { preview: ImportPreview; onClose: () => void }): React.JSX.Element {
  const [pick, setPick] = useState<Set<number>>(() => new Set(preview.rows.map((_r, i) => i)))
  const [result, setResult] = useState<{ added: number; updated: number; errors: string[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const t = useT()
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
      title={t('passwords.importDlg.title')}
      icon="import"
      width="w-[640px]"
      onClose={onClose}
      footer={
        result ? (
          <Button primary onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button primary disabled={busy || !pick.size} onClick={run}>
              {t('passwords.importDlg.run', { count: pick.size })}
            </Button>
          </>
        )
      }
    >
      <ErrorBar error={error} />
      {result ? (
        <div className="space-y-3">
          <Callout tone="ok" icon="check">
            {result.updated ? t('passwords.importDlg.doneUpdated', { count: result.added, updated: result.updated }) : t('passwords.importDlg.done', { count: result.added })}
          </Callout>
          {result.errors.length > 0 && (
            <Callout tone="danger">
              {result.errors.slice(0, 8).map((e) => (
                <div key={e}>{e}</div>
              ))}
            </Callout>
          )}
          <Callout tone="wait" icon="shield">
            <div className="font-medium">{t('passwords.importDlg.deleteFile')}</div>
            <div className="mt-0.5 break-all">{tx('passwords.importDlg.plainFile', { file: <code>{preview.file}</code> })}</div>
            <div className="mt-1.5">
              <SmallButton onClick={() => void window.stag.openFolder(folder)}>{t('passwords.importDlg.openFolder')}</SmallButton>
            </div>
          </Callout>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-muted">
            {tx('passwords.importDlg.summary', { file: <span className="break-all font-mono">{preview.file}</span>, count: preview.rows.length })}
          </p>
          {preview.errors.length > 0 && (
            <Callout tone="wait" className="mb-2">
              {preview.errors.slice(0, 6).map((e) => (
                <div key={e}>{e}</div>
              ))}
              {preview.errors.length > 6 && <div>{t('passwords.importDlg.moreErrors', { count: preview.errors.length - 6 })}</div>}
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
                {r.duplicate && <Chip tone="warn">{t('passwords.importDlg.duplicate')}</Chip>}
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
