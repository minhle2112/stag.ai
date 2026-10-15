import { useEffect, useMemo, useRef, useState } from 'react'
import { inboxOf, latestVersion } from '@shared/artifacts'
import type { AgentStatus, Project, Workspace } from '@shared/types'
import { CHUNG } from '@shared/projects'
import { useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useProducts } from '../store/artifacts'
import { useUi } from '../store/ui'
import { tx, useLocale, useT } from '../i18n'
import { highlight } from './vault/highlight'
import { ArtifactDetail, type Delivery } from './artifacts/ArtifactDetail'
import { buildEntries, emptyCount, entryBadges, groupEntries, OLDER_PAGE, searchArtifacts, visibleEntries, type TaskEntry } from './artifacts/products'
import { TaskPage } from './artifacts/TaskPage'
import { BTN, Mi, ProductAvatar, shortWhen, Switch, useToast } from './artifacts/ui'
import { Icon } from './Icon'
import { ProjectMark } from './projects/ProjectMark'

const EMPTY_KEY = 'stag.products.showEmpty'

interface Sel {
  task: string | null
  art: string | null
  /** Mở sản phẩm thì nhảy tới góp ý này. */
  focus: string | null
  /** Đổi mỗi lần bấm mở (bấm lại cùng sản phẩm từ hộp "Cần bạn xem" vẫn nhảy tới góp ý). */
  n: number
}

/** Agent nhận góp ý đang ở trạng thái nào (để nói góp ý sẽ được gửi lúc nào). */
export function deliveryOf(running: boolean, status: AgentStatus | undefined): Delivery {
  if (!running) return 'closed'
  if (status?.activity === 'waiting' && (status.reason === 'turn' || status.reason === 'idle')) return 'idle'
  return 'busy'
}

/** Tab "Sản phẩm": thứ agent tự nộp (artifact_publish), gom theo việc của agent, có phiên bản và góp ý. Có project → lọc theo project. */
export function ArtifactsView({ workspace: ws }: { workspace: Workspace }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const snap = useProducts((s) => s.byWs[ws.id])
  const loadProducts = useProducts((s) => s.load)
  const board = useBoard((s) => s.byWs[ws.id])
  const loadBoard = useBoard((s) => s.load)
  const agentsWs = useAgents((s) => s.byWs[ws.id])
  const [sel, setSel] = useState<Sel>({ task: null, art: null, focus: null, n: 0 })
  const [q, setQ] = useState('')
  const [agentF, setAgentF] = useState<string | null>(null)
  // Workspace có project: lọc theo project, mặc định là tab đang mở ở màn Agent.
  const projects = ws.projects ?? []
  const [projF, setProjF] = useState<string>(() => (projects.length ? (useAgents.getState().byWs[ws.id]?.place ?? 'all') : 'all'))
  const [showEmpty, setShowEmpty] = useState(() => {
    try {
      return localStorage.getItem(EMPTY_KEY) === '1'
    } catch {
      return false
    }
  })
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [olderShown, setOlderShown] = useState(OLDER_PAGE)
  const [help, setHelp] = useState(false)
  const [toastNode, toast] = useToast()

  useEffect(() => {
    void loadProducts(ws.id)
    void loadBoard(ws.id)
  }, [ws.id, loadProducts, loadBoard])

  // Giờ hiện tại cho nhóm theo ngày: tính lại mỗi phút (qua nửa đêm "Hôm nay" thành "Hôm qua").
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  // `locale`: tên "Không gắn việc" đổi theo ngôn ngữ.
  const allEntries = useMemo(() => buildEntries(board?.tasks ?? [], snap, new Date()), [board?.tasks, snap, tick, locale])
  // Chỗ của một việc: project của nó (project đã xoá → Chung); việc cũ / không gắn việc thì theo agent.
  const entries = useMemo(() => {
    if (!projects.length || projF === 'all') return allEntries
    const placeOfEntry = (e: TaskEntry): string => {
      const pid = e.projectId ?? agentsWs?.agents.find((a) => a.id === e.agentId)?.projectId
      return pid && projects.some((p) => p.id === pid) ? pid : CHUNG
    }
    return allEntries.filter((e) => placeOfEntry(e) === projF)
  }, [allEntries, projects, projF, agentsWs?.agents])
  const arts = useMemo(() => new Map((snap?.artifacts ?? []).map((a) => [a.id, a])), [snap])
  const entryOfArt = (id: string): TaskEntry | undefined => entries.find((e) => e.artifacts.some((a) => a.id === id))
  const visible = useMemo(() => visibleEntries(entries, { agentId: agentF, showEmpty }), [entries, agentF, showEmpty])
  const groups = useMemo(() => groupEntries(visible, olderShown), [visible, olderShown])
  const agentList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of entries) if (e.artifacts.length || e.status === 'open') seen.set(e.agentId, e.agentName)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [entries])
  const shownArts = useMemo(() => new Set(entries.flatMap((e) => e.artifacts.map((a) => a.id))), [entries])
  const inbox = useMemo(
    () => inboxOf(snap?.artifacts ?? []).filter((x) => (!agentF || arts.get(x.artifactId)?.agentId === agentF) && (projF === 'all' || !projects.length || shownArts.has(x.artifactId))),
    [snap, agentF, arts, projF, projects.length, shownArts, locale]
  )
  const hits = useMemo(() => (q.trim() ? searchArtifacts(entries, q, agentF) : []), [entries, q, agentF])

  // Chưa chọn gì: việc đầu tiên có sản phẩm (không có thì việc đầu tiên).
  const curTask = sel.task ?? (visible.find((e) => e.artifacts.length) ?? visible[0])?.id ?? null
  const entry = entries.find((e) => e.id === curTask) ?? null
  const art = sel.art ? arts.get(sel.art) : undefined

  const openArt = (id: string, focus: string | null = null): void => {
    const e = entryOfArt(id)
    setSel((s) => ({ task: e?.id ?? s.task, art: id, focus, n: s.n + 1 }))
  }
  const openTask = (id: string): void => setSel((s) => ({ task: id, art: null, focus: null, n: s.n + 1 }))

  const status = (agentId: string): Delivery => deliveryOf(!!agentsWs?.running[agentId], board?.statuses.find((x) => x.agentId === agentId))

  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && !useUi.getState().settings && !document.querySelector('[role=dialog]')) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loading = !snap || !board
  const noneAtAll = !loading && !(snap?.artifacts.some((a) => !a.hidden)) && !visible.length

  return (
    <div data-products className="relative grid h-full min-h-0 grid-cols-[300px_1fr] bg-bg text-[13px]">
      <aside className="flex min-h-0 flex-col border-r border-line">
        <label className="mx-2.5 mt-2.5 mb-1.5 flex items-center gap-1.5 rounded-[7px] border border-line-2 bg-panel px-2 py-1.5 text-dim focus-within:border-accent">
          <Icon name="search" size="s" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder={t('artifacts.list.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-dim"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="px-0.5 text-dim hover:text-fg" aria-label={t('artifacts.list.clearSearch')}>
              <Icon name="x" size="s" />
            </button>
          )}
        </label>
        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-2.5 pb-1.5" aria-label={t('artifacts.list.filterProject')}>
            {[{ id: 'all', label: t('artifacts.list.all'), p: undefined as Project | null | undefined }, { id: CHUNG, label: t('common.name.rootProject'), p: null }, ...projects.map((p) => ({ id: p.id, label: p.name, p }))].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setProjF(o.id)
                  setAgentF(null)
                }}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] ${projF === o.id ? 'border-line-3 bg-panel-2 text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              >
                {o.p !== undefined && <ProjectMark project={o.p} size={8} />}
                {o.label}
              </button>
            ))}
          </div>
        )}
        {agentList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 px-2.5 pb-1.5">
            <button
              type="button"
              onClick={() => setAgentF(null)}
              className={`rounded-md border px-2 py-0.5 text-[11.5px] ${!agentF ? 'border-line-3 bg-panel-2 text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {t('artifacts.list.allAgents')}
            </button>
            {agentList.map((a) => (
              <button
                key={a.id}
                type="button"
                title={a.name}
                onClick={() => setAgentF(agentF === a.id ? null : a.id)}
                className={`rounded-md border p-0.5 ${agentF === a.id ? 'border-line-3 bg-panel-2 opacity-100' : 'border-transparent opacity-55 hover:opacity-100'}`}
              >
                <ProductAvatar name={a.name} />
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2.5">
          {q.trim() ? (
            hits.length ? (
              <>
                <div className="px-2 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.07em] text-dim">
                  {t('artifacts.list.results')} <span className="font-mono tracking-normal">{hits.length}</span>
                </div>
                {hits.map((h) => (
                  <button
                    key={h.artifact.id}
                    type="button"
                    onClick={() => openArt(h.artifact.id)}
                    className={`block w-full rounded-[7px] px-2 py-2 text-left hover:bg-panel-2 ${sel.art === h.artifact.id ? 'bg-panel-3' : ''}`}
                  >
                    <div className="flex items-center gap-[7px]">
                      <ProductAvatar name={h.artifact.agentName} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        <Hl text={h.artifact.title} q={q} />
                      </span>
                    </div>
                    <div className="mt-0.5 truncate pl-[25px] text-[11.5px] text-dim">{h.field === 'title' ? h.entry.title : <Hl text={h.text} q={q} />}</div>
                  </button>
                ))}
              </>
            ) : (
              <div className="mx-2.5 my-8 text-center leading-relaxed text-dim">
                <b className="mb-1.5 block text-[14px] text-fg">{t('artifacts.list.noMatch', { q: q.trim() })}</b>
                {agentF
                  ? t('artifacts.list.noMatchHintFiltered', { name: agentList.find((a) => a.id === agentF)?.name ?? '' })
                  : t('artifacts.list.noMatchHint')}
                <div className="mt-2.5">
                  <button type="button" className={BTN} onClick={() => setQ('')}>
                    {t('artifacts.list.clearSearch')}
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              {inbox.length > 0 && (
                <div className="mt-1.5 mb-1 rounded-[9px] border border-wait/25 bg-[color-mix(in_srgb,var(--color-wait)_5%,var(--color-panel))] p-1">
                  <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-wait">
                    {t('artifacts.inbox.title')} <span className="font-mono tracking-normal">{inbox.length}</span>
                  </div>
                  {inbox.map((x) => {
                    const a = arts.get(x.artifactId)!
                    return (
                      <button
                        key={x.artifactId}
                        type="button"
                        onClick={() => openArt(x.artifactId, x.focus)}
                        className="block w-full rounded-md px-2 py-[7px] text-left hover:bg-panel-2"
                      >
                        <div className="flex items-center gap-[7px]">
                          <ProductAvatar name={a.agentName} />
                          <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                        </div>
                        <div className="mt-[5px] ml-[25px] flex flex-wrap gap-1">
                          {x.newVersions > 0 && (
                            <Kc cls="bg-accent/15 text-accent-text">
                              {x.newVersions > 1
                                ? t('artifacts.inbox.newVersions', { count: x.newVersions, from: a.seen + 1, to: latestVersion(a).v })
                                : t('artifacts.inbox.newVersion', { v: latestVersion(a).v })}
                            </Kc>
                          )}
                          {x.asks > 0 && <Kc cls="bg-wait/15 text-wait-text">{t('artifacts.inbox.asks', { count: x.asks })}</Kc>}
                          {x.fixed > 0 && <Kc cls="bg-work/15 text-work-text">{t('artifacts.inbox.fixed', { count: x.fixed })}</Kc>}
                        </div>
                        <div className="mt-1 ml-[25px] truncate text-[11.5px] text-dim">{x.sub}</div>
                      </button>
                    )
                  })}
                </div>
              )}
              {groups.map((g) => (
                <div key={g.id}>
                  <button
                    type="button"
                    onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                    className="flex w-full items-center gap-1.5 px-2 pt-3 pb-[5px] text-left text-[11px] font-semibold tracking-[0.07em] text-dim uppercase hover:text-muted"
                  >
                    <Icon name={closed[g.id] ? 'cr' : 'cd'} size="s" />
                    {t(g.label)}
                    <span className="font-mono tracking-normal">{g.entries.length + g.more}</span>
                  </button>
                  {!closed[g.id] &&
                    g.entries.map((e) => <TaskRow key={e.id} e={e} on={sel.art ? entryOfArt(sel.art)?.id === e.id : curTask === e.id} onClick={() => openTask(e.id)} />)}
                  {!closed[g.id] && g.more > 0 && (
                    <button
                      type="button"
                      onClick={() => setOlderShown((n) => n + OLDER_PAGE)}
                      className="mx-0.5 my-2 block w-[calc(100%-4px)] rounded-[7px] border border-dashed border-line-2 p-[7px] text-[12px] text-muted hover:bg-panel-2 hover:text-fg"
                    >
                      {t('artifacts.list.moreOlder', { count: g.more })}
                    </button>
                  )}
                </div>
              ))}
              {!loading && !groups.length && !inbox.length && (
                <div className="mx-3 my-10 text-center leading-relaxed text-dim">
                  {agentF ? t('artifacts.list.agentNoTasks') : t('artifacts.list.noTasks')}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[12px] text-muted">
          <button
            type="button"
            onClick={() => {
              const v = !showEmpty
              setShowEmpty(v)
              try {
                localStorage.setItem(EMPTY_KEY, v ? '1' : '0')
              } catch {
                // không lưu được thì thôi
              }
            }}
            className="inline-flex items-center gap-[7px] rounded-md px-1.5 py-[3px] hover:bg-panel-2 hover:text-fg"
          >
            <Switch on={showEmpty} />
            {t('artifacts.list.showEmpty', { count: emptyCount(entries, agentF) })}
          </button>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {art && entry ? (
          <ArtifactDetail
            key={art.id}
            ws={ws}
            art={art}
            entry={entry}
            focus={sel.focus}
            focusNonce={sel.n}
            delivery={status(art.agentId)}
            toast={toast}
            onBack={() => setSel((s) => ({ ...s, art: null, focus: null }))}
          />
        ) : entry ? (
          <TaskPage ws={ws} entry={entry} running={!!agentsWs?.running[entry.agentId]} onOpen={(id) => openArt(id)} />
        ) : (
          <div className="mx-auto mt-24 max-w-[440px] px-6 text-center leading-relaxed text-dim">
            {loading ? (
              t('common.loading')
            ) : noneAtAll ? (
              <>
                <b className="mb-1.5 block text-[14px] text-fg">{t('artifacts.empty.title')}</b>
                {tx('artifacts.empty.body', { tool: <code className="font-mono text-accent">artifact_publish</code> })}
              </>
            ) : (
              t('artifacts.pickTask')
            )}
          </div>
        )}
      </main>

      <button
        type="button"
        onClick={() => setHelp(!help)}
        title={t('artifacts.help.button')}
        data-artifacts-help
        className={`absolute top-2 right-3 z-30 h-[22px] w-[22px] rounded-full border border-line-2 text-[12px] font-semibold ${help ? 'bg-panel-3 text-fg' : 'bg-bg text-muted hover:bg-panel-3 hover:text-fg'}`}
      >
        ?
      </button>
      {help && <Help onClose={() => setHelp(false)} />}
      {toastNode}
    </div>
  )
}

function Kc({ cls, children }: { cls: string; children: React.ReactNode }): React.JSX.Element {
  return <span className={`rounded-full px-1.5 py-px text-[10.5px] font-semibold ${cls}`}>{children}</span>
}

function Hl({ text, q }: { text: string; q: string }): React.JSX.Element {
  return (
    <>
      {highlight(text, q).map((p, i) =>
        p.hit ? (
          <b key={i} className="rounded-[2px] bg-accent/10 font-semibold text-accent">
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

function TaskRow({ e, on, onClick }: { e: TaskEntry; on: boolean; onClick: () => void }): React.JSX.Element {
  const t = useT()
  const b = entryBadges(e)
  const n = e.artifacts.length
  const run = e.status === 'open'
  return (
    <button type="button" onClick={onClick} className={`mb-px block w-full rounded-[7px] px-[9px] py-2 text-left ${on ? 'bg-panel-3' : 'hover:bg-panel-2'}`}>
      <div className="flex items-center gap-[7px]">
        <ProductAvatar name={e.agentName} />
        <span className={`min-w-0 flex-1 truncate font-medium ${e.status === 'dropped' ? 'text-muted line-through decoration-dim' : ''}`}>{e.title}</span>
        {b.drafts > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-accent" title={t('artifacts.row.drafts', { count: b.drafts })}>
            <Mi name="pen" />
            {b.drafts}
          </span>
        )}
        {b.you > 0 && (
          <span className="font-mono text-[11px] font-semibold text-wait" title={t('artifacts.row.you', { count: b.you })}>
            ●{b.you}
          </span>
        )}
        {b.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t('artifacts.row.unread')} />}
      </div>
      <div className="mt-[3px] flex gap-[5px] overflow-hidden pl-[25px] text-[11.5px] whitespace-nowrap text-dim">
        {run ? (
          <>
            <span className="text-work">{t('artifacts.row.working', { when: shortWhen(e.when) })}</span>
            <span>·</span>
            <span>{n ? t('artifacts.row.count', { count: n }) : t('artifacts.row.nothingYet')}</span>
          </>
        ) : (
          <>
            <span>{n ? t('artifacts.row.count', { count: n }) : t('artifacts.row.none')}</span>
            <span>·</span>
            <span>{e.status === 'dropped' ? t('artifacts.row.dropped', { when: shortWhen(e.when) }) : t('artifacts.row.done', { when: shortWhen(e.when) })}</span>
          </>
        )}
      </div>
    </button>
  )
}

function Help({ onClose }: { onClose: () => void }): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-artifacts-help]')) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const code = 'font-mono text-[11.5px] text-accent'
  return (
    <div
      ref={ref}
      className="absolute top-9 right-3 z-30 max-h-[calc(100%-48px)] w-[400px] overflow-auto rounded-[10px] border border-line-2 bg-pop px-4 py-3.5 leading-relaxed text-muted shadow-pop select-text"
    >
      <h3 className="mb-1 text-[13px] font-semibold text-fg">{t('artifacts.help.title')}</h3>
      {t('artifacts.help.intro')}
      <pre className="mt-1.5 rounded-md border border-line bg-bg0 px-2.5 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted">
        {`artifact_publish(
  file: "docs/reports/smoke-0.1.2.md",
  title: "${t('artifacts.help.sampleTitle')}",
  description: "${t('artifacts.help.sampleDesc')}",
  note: "${t('artifacts.help.sampleNote')}",   // ${t('artifacts.help.sampleNoteCmt')}
  fixes: ["c2"])                // ${t('artifacts.help.sampleFixesCmt')}`}
      </pre>
      {t('artifacts.help.attach')}
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">{t('artifacts.help.versions')}</h3>
      {tx('artifacts.help.versionsBody', { dir: <code className={code}>.stag/artifacts/</code> })}
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">{t('artifacts.help.comments')}</h3>
      {tx('artifacts.help.commentsBody', {
        draft: <b className="text-fg">{t('artifacts.saveDraft')}</b>,
        send: <b className="text-fg">{t('common.send')}</b>,
        reply: <code className={code}>artifact_reply(id, text)</code>
      })}
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">{t('artifacts.help.anchor')}</h3>
      {t('artifacts.help.anchorBody')}
    </div>
  )
}

