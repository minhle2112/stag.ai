import { useEffect, useRef } from 'react'
import type { Workspace } from '@shared/types'
import { computerToolsOn } from '@shared/settings'
import { useComputer, startComputerBus } from '../../store/computer'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { IconButton } from '../shell/IconButton'
import { TierChip } from './ComputerAskBody'
import { useT } from '../../i18n'

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * Ô "Máy tính" trong dock bên phải (chung khung với Browser): ảnh agent thấy gần nhất + chấm chỗ vừa click, ai đang
 * điều khiển, Tạm dừng / Tiếp tục / Dừng, app đã cấp theo phiên (thu hồi được), dòng thao tác.
 */
export function ComputerPane({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const t = useT()
  const state = useComputer((s) => s.state)
  const settings = useSettings((s) => s.value)
  const openSettings = useUi((s) => s.openSettings)
  const toggle = useUi((s) => s.toggleComputer)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => startComputerBus(), [])
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state?.log.length])

  const on = computerToolsOn(settings, workspace.id, null) || Object.values(settings.agents).some((o) => o.computer?.agentTools)
  const holder = state?.holder
  const cmd = (c: 'pause' | 'resume' | 'stop'): void => void window.stag.computer.command(c)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Icon name="monitor" size="s" className="text-muted" />
        <b className="text-[12.5px]">{t('computer.pane.title')}</b>
        {holder && (
          <span className={`ml-1 inline-flex min-w-0 items-center gap-1.5 text-[12px] ${state?.paused ? 'text-wait' : 'text-accent'}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${state?.paused ? 'bg-wait' : 'animate-pulse bg-accent'}`} />
            <span className="truncate">{state?.paused ? t('computer.pane.paused') : t('computer.pane.driving', { name: holder.agentName })}</span>
          </span>
        )}
        <span className="flex-1" />
        <IconButton icon="x" tip={t('computer.pane.close')} onClick={toggle} />
      </div>

      {!on && (
        <div className="m-3 flex items-center gap-2 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[12px] text-muted">
          <span className="min-w-0 flex-1">{t('computer.pane.off')}</span>
          <button type="button" onClick={() => openSettings('computer')} className="shrink-0 rounded-md border border-line-2 px-2 py-0.5 text-fg hover:border-line-3">
            {t('computer.pane.openSettings')}
          </button>
        </div>
      )}
      {state && !state.available && <div className="m-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{t('computer.unavailable', { error: state.error ?? '' })}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {holder && (
          <div className="flex items-center gap-2 px-3 pt-3">
            {state?.paused ? (
              <button type="button" onClick={() => cmd('resume')} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-on hover:brightness-110">
                <Icon name="play" size="s" />
                {t('computer.pane.resume')}
              </button>
            ) : (
              <button type="button" onClick={() => cmd('pause')} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line-2 px-3 text-[12.5px] hover:border-line-3">
                {t('computer.pane.pause')}
              </button>
            )}
            <button
              type="button"
              onClick={() => cmd('stop')}
              data-tip={t('computer.pane.stopTip', { hotkey: state?.hotkey ?? '' })}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-danger/50 bg-danger/10 px-3 text-[12.5px] text-danger hover:bg-danger/20"
            >
              <Icon name="stop" size="s" />
              {t('computer.pane.stop')}
              <kbd className="ml-1 font-mono text-[11px] opacity-80">{state?.hotkey}</kbd>
            </button>
          </div>
        )}
        {!holder && <div className="px-3 pt-3 text-[12px] text-muted">{t('computer.pane.idle')}</div>}

        <div className="px-3 pt-3">
          {state?.shot ? (
            <figure className="m-0">
              <div className="relative overflow-hidden rounded-md border border-line-2 bg-bg0">
                <img src={state.shot.url} alt="" className="block w-full" />
                {state.shot.mark && (
                  <span
                    className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-accent/30 shadow-[0_0_0_3px_rgba(0,0,0,0.35)]"
                    style={{ left: `${state.shot.mark.x * 100}%`, top: `${state.shot.mark.y * 100}%` }}
                  />
                )}
              </div>
              <figcaption className="mt-1 text-[11px] text-dim">
                {t('computer.pane.shot', { display: state.shot.display })} · {time(state.shot.at)}
              </figcaption>
            </figure>
          ) : (
            <div className="grid h-28 place-items-center rounded-md border border-dashed border-line-2 text-[12px] text-dim">{t('computer.pane.noShot')}</div>
          )}
        </div>

        <section className="px-3 pt-4">
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-dim uppercase">{t('computer.pane.grants')}</h3>
          {state?.sessions.length ? (
            <div className="space-y-2">
              {state.sessions.map((s) => (
                <div key={s.sessionId} className="rounded-md border border-line bg-panel-2 p-2">
                  <div className="mb-1 flex items-center gap-2 text-[12px]">
                    <b className="min-w-0 truncate">{s.agentName}</b>
                    <span className="flex-1" />
                    <button type="button" onClick={() => void window.stag.computer.revoke(s.sessionId)} className="text-[11px] text-muted hover:text-danger">
                      {t('computer.pane.revokeAll')}
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {s.grants.map((g) => (
                      <li key={g.key} className="flex items-center gap-2 text-[12px]">
                        <span className="min-w-0 truncate">{g.displayName}</span>
                        <span className="min-w-0 truncate font-mono text-[11px] text-dim">{g.key}</span>
                        {g.scope === 'always' && <span className="text-[11px] text-dim">· {t('computer.pane.always')}</span>}
                        <span className="flex-1" />
                        <TierChip tier={g.tier} />
                        <button type="button" onClick={() => void window.stag.computer.revoke(s.sessionId, g.key)} className="text-[11px] text-muted hover:text-danger">
                          {t('computer.pane.revoke')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px] text-dim">{t('computer.pane.noGrants')}</div>
          )}
        </section>

        <section className="px-3 pt-4 pb-3">
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-dim uppercase">{t('computer.pane.log')}</h3>
          <div ref={logRef} className="max-h-64 overflow-y-auto rounded-md border border-line bg-bg0 p-2 font-mono text-[11px] leading-[1.5]">
            {state?.log.length ? (
              state.log.map((l, i) => (
                <div key={`${l.at}:${i}`} className={l.ok ? 'text-muted' : 'text-danger'}>
                  <span className="text-dim">{time(l.at)}</span> <span className="text-fg">{l.agentName}</span> {l.text}
                </div>
              ))
            ) : (
              <div className="text-dim">{t('computer.pane.noLog')}</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
