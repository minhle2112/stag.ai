import type { ComputerAsk, ComputerTier } from '@shared/computer'
import type { PlainKey } from '@shared/i18n'
import { useT } from '../../i18n'

/** Màu chip theo mức app. */
export const TIER_TONE: Record<ComputerTier, string> = {
  full: 'border-accent/40 bg-accent/10 text-accent',
  click: 'border-wait/40 bg-wait/10 text-wait',
  read: 'border-line-3 bg-panel-3 text-muted',
  blocked: 'border-danger/40 bg-danger/10 text-danger'
}

export function TierChip({ tier, reason }: { tier: ComputerTier; reason?: string }): React.JSX.Element {
  const t = useT()
  const why = reason && reason !== 'other' ? t(`computer.reason.${reason}` as PlainKey) : ''
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[11px] whitespace-nowrap ${TIER_TONE[tier]}`}
      data-tip={`${t(`computer.tierDesc.${tier}` as PlainKey)}${why ? ` · ${why}` : ''}`}
    >
      {t(`computer.tier.${tier}` as PlainKey)}
    </span>
  )
}

/** Thân thẻ hỏi request_access: lý do, danh sách app + mức, quyền thêm. */
export function ComputerAskBody({ ask }: { ask: ComputerAsk }): React.JSX.Element {
  const t = useT()
  const extras = [ask.clipboardRead && t('computer.req.clipboardRead'), ask.clipboardWrite && t('computer.req.clipboardWrite'), ask.systemKeyCombos && t('computer.req.systemKeyCombos')].filter(Boolean)
  return (
    <div className="mt-3 grid grid-cols-[96px_1fr] gap-x-2.5 gap-y-1.5 rounded-md border border-line bg-bg p-2.5 text-[12px]">
      <div className="text-dim">{t('computer.req.reason')}</div>
      <div className="min-w-0 break-words">{ask.reason}</div>
      <div className="text-dim">{t('computer.req.apps')}</div>
      <ul className="min-w-0 space-y-1">
        {ask.apps.map((a) => (
          <li key={a.key} className={`flex min-w-0 items-center gap-2 ${a.tier === 'blocked' ? 'opacity-60' : ''}`}>
            {a.icon ? <img src={a.icon} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded bg-panel-3" />}
            <b className="min-w-0 truncate">{a.displayName}</b>
            <span className="min-w-0 truncate font-mono text-[11px] text-dim">{a.key}</span>
            <span className="flex-1" />
            <TierChip tier={a.tier} reason={a.reason} />
          </li>
        ))}
        {ask.unknown.length > 0 && <li className="text-wait">{t('computer.req.unknown', { names: ask.unknown.join(', ') })}</li>}
        {ask.apps.some((a) => a.tier === 'blocked') && <li className="text-[11px] text-muted">{t('computer.req.blockedNote')}</li>}
      </ul>
      {extras.length > 0 && (
        <>
          <div className="text-dim">{t('computer.req.extras')}</div>
          <ul className="min-w-0 list-inside list-disc">
            {extras.map((x) => (
              <li key={String(x)}>{x}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
