import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  formatAgo,
  formatReset,
  pacePercent,
  SESSION_MS,
  usageLevel,
  usageWarning,
  WEEK_MS,
  type ClaudeUsageState,
  type UsageLevel,
  type UsageWindow
} from '@shared/claudeUsage'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { tx, useT } from '../../i18n'

const LEVEL_COLOR: Record<UsageLevel, string> = {
  ok: 'var(--color-accent)',
  high: 'var(--color-wait)',
  max: 'var(--color-danger)',
  na: 'var(--color-dim)'
}

/** Ngôi sao cam của Claude. */
function ClaudeGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="#d97757" className="shrink-0" aria-hidden>
      <path d="M8 0l1.6 5.2L15 6.4l-4.3 3 1.5 5.6L8 11.8 3.8 15l1.5-5.6L1 6.4l5.4-1.2z" />
    </svg>
  )
}

function Ring({ percent }: { percent: number }): React.JSX.Element {
  const r = 5.2
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className="shrink-0" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2.6" stroke="var(--color-line-2)" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        strokeWidth="2.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(percent, 100)) / 100} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

/** Vòng + số % + nhãn nhỏ ("5g" / "tuần"). */
function RingStat({ w, label }: { w: UsageWindow; label: string }): React.JSX.Element {
  const lv = usageLevel(w.percent)
  return (
    <span className="flex items-center gap-1" style={{ color: LEVEL_COLOR[lv] }}>
      <Ring percent={w.percent} />
      <span className={`font-mono text-[11.5px] ${lv === 'ok' ? 'text-fg' : ''}`}>{w.percent}%</span>
      <span className="text-[10.5px] text-dim">{label}</span>
    </span>
  )
}

function Meter({ name, w, windowMs, now }: { name: string; w: UsageWindow; windowMs: number; now: number }): React.JSX.Element {
  const t = useT()
  const lv = usageLevel(w.percent)
  const pace = pacePercent(w.resetsAt, windowMs, now)
  const reset = formatReset(w.resetsAt, now)
  return (
    <div className="rounded-md px-2.5 py-[7px]">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="flex-1 text-fg">{name}</span>
        <span className="font-mono text-[12px]" style={lv === 'ok' ? undefined : { color: LEVEL_COLOR[lv] }}>
          {w.percent}%
        </span>
      </div>
      <div className="relative h-1.5 rounded-[3px] bg-line-2">
        <i className="block h-full rounded-[3px]" style={{ width: `${Math.min(w.percent, 100)}%`, background: LEVEL_COLOR[lv] }} />
        {pace !== null && (
          <span
            className="absolute -top-0.5 -bottom-0.5 w-0.5 rounded-[1px] bg-muted opacity-70"
            style={{ left: `calc(${pace}% - 1px)` }}
            data-tip={t('usage.item.paceTip')}
          />
        )}
      </div>
      {reset && <div className="mt-[5px] text-[11px] text-dim">{t('usage.item.reset', { when: reset })}</div>}
    </div>
  )
}

const CAP = 'px-2.5 pt-1.5 pb-0.5 text-[11px] font-semibold tracking-[0.07em] text-dim'
const LINK = 'rounded-[5px] px-1.5 py-[3px] text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-50'

/** Mục "Claude" ở thanh trạng thái (kiểu B "Hai vòng"): % phiên 5 giờ + % tuần; bấm mở bảng chi tiết. */
export function ClaudeUsageItem(): React.JSX.Element | null {
  const t = useT()
  const enabled = useSettings((s) => s.value.app.general.claudeUsage)
  const openSettings = useUi((s) => s.openSettings)
  const [state, setState] = useState<ClaudeUsageState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const btn = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)

  useEffect(() => {
    let alive = true
    void window.stag.claudeUsage.get().then((s) => alive && setState(s))
    const off = window.stag.claudeUsage.onChanged(setState)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Giờ reset / "N phút trước" chạy theo đồng hồ.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 334)), bottom: window.innerHeight - r.top + 4 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!enabled || !state || state.status === 'off') return null

  const u = state.status === 'ok' ? state.usage : null
  const tNow = Math.max(now, state.fetchedAt ?? 0)
  const tip = u
    ? [
        u.session &&
          (u.session.resetsAt
            ? t('usage.item.tipSessionReset', { percent: u.session.percent, when: formatReset(u.session.resetsAt, tNow) })
            : t('usage.item.tipSession', { percent: u.session.percent })),
        u.week && t('usage.item.tipWeek', { percent: u.week.percent })
      ]
        .filter(Boolean)
        .join(' · ')
    : state.status === 'loading'
      ? t('usage.item.loading')
      : state.status === 'signedOut'
        ? t('usage.item.signedOut')
        : t('usage.item.failed')

  async function refresh(): Promise<void> {
    setBusy(true)
    try {
      setState(await window.stag.claudeUsage.refresh())
    } finally {
      setBusy(false)
    }
  }

  const warn = u ? usageWarning(u, tNow) : null

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-tip={open ? undefined : `Claude: ${tip}`}
        className={`flex h-[22px] items-center gap-1.5 rounded px-2 hover:bg-panel-2 hover:text-fg ${open ? 'bg-panel-2 text-fg' : ''}`}
      >
        <ClaudeGlyph />
        {u && (u.session || u.week) ? (
          <>
            {u.session && <RingStat w={u.session} label={t('usage.item.ringSession')} />}
            {u.week && (
              <span className={u.session ? 'ml-1' : ''}>
                <RingStat w={u.week} label={t('usage.item.ringWeek')} />
              </span>
            )}
          </>
        ) : (
          <span className="text-dim">Claude —</span>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
            <div
              className="fixed z-50 w-[330px] rounded-[10px] border border-line-2 bg-pop p-1.5 text-[12px] text-muted shadow-pop"
              style={{ left: pos.left, bottom: pos.bottom }}
            >
              <div className="flex items-center gap-2 px-2 pt-1.5 pb-2">
                <ClaudeGlyph />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-fg">Claude</div>
                  <div className="truncate text-[11px] text-dim">
                    {state.account?.email ||
                      (state.status === 'signedOut' ? t('usage.item.notSignedIn') : state.status === 'loading' ? t('usage.item.loading') : t('usage.item.account'))}
                  </div>
                </div>
                {state.account?.plan && (
                  <span className="rounded-full bg-accent/12 px-[7px] py-0.5 text-[10.5px] font-semibold text-accent">{state.account.plan}</span>
                )}
              </div>

              {state.status === 'signedOut' && (
                <div className="mx-1.5 my-1 rounded-md border border-wait/25 bg-wait/8 px-2.5 py-2 leading-[1.45] text-wait-text">
                  {state.error ? `${state.error} ` : ''}
                  {tx('usage.item.loginHint', { command: <b>/login</b> })}
                </div>
              )}
              {state.status === 'error' && (
                <div className="mx-1.5 my-1 rounded-md border border-danger/25 bg-danger/10 px-2.5 py-2 leading-[1.45] text-danger-text">
                  {t('usage.item.failedWith', { error: state.error ?? '' })}
                </div>
              )}
              {warn && (
                <div
                  className={`mx-1.5 my-1 rounded-md border px-2.5 py-2 leading-[1.45] ${
                    warn.tone === 'danger' ? 'border-danger/25 bg-danger/10 text-danger-text' : 'border-wait/25 bg-wait/8 text-wait-text'
                  }`}
                >
                  {warn.text}
                </div>
              )}

              {u?.session && (
                <>
                  <div className={CAP}>{t('usage.item.currentSession')}</div>
                  <Meter name={t('usage.item.fiveHours')} w={u.session} windowMs={SESSION_MS} now={tNow} />
                </>
              )}
              {u && (u.week || u.models.length > 0) && (
                <>
                  <div className={CAP}>{t('usage.item.thisWeek')}</div>
                  {u.week && <Meter name={t('usage.item.allModels')} w={u.week} windowMs={WEEK_MS} now={tNow} />}
                  {u.models.map((m) => (
                    <Meter key={m.label} name={t('usage.item.onlyModel', { model: m.label })} w={m} windowMs={WEEK_MS} now={tNow} />
                  ))}
                </>
              )}

              <div className="mx-1 my-1.5 h-px bg-line" />
              <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] text-dim">
                <span className="truncate" data-tip={u && state.error ? state.error : undefined}>
                  {u ? `${formatAgo(state.fetchedAt, tNow)}${state.error ? t('usage.item.lastFailed') : ''}` : ''}
                </span>
                <span className="flex-1" />
                <button type="button" className={LINK} disabled={busy} onClick={() => void refresh()}>
                  {busy ? t('usage.item.asking') : t('usage.item.refresh')}
                </button>
                <button
                  type="button"
                  className={LINK}
                  onClick={() => {
                    setOpen(false)
                    openSettings('general')
                  }}
                >
                  {t('usage.item.settings')}
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  )
}
