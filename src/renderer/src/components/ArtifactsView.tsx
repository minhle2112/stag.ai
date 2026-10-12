import { useEffect, useMemo, useRef, useState } from 'react'
import { inboxOf, latestVersion } from '@shared/artifacts'
import type { AgentStatus, Workspace } from '@shared/types'
import { useAgents } from '../store/agents'
import { useBoard } from '../store/board'
import { useProducts } from '../store/artifacts'
import { highlight } from './vault/highlight'
import { ArtifactDetail, type Delivery } from './artifacts/ArtifactDetail'
import { buildEntries, emptyCount, entryBadges, groupEntries, OLDER_PAGE, searchArtifacts, visibleEntries, type TaskEntry } from './artifacts/products'
import { TaskPage } from './artifacts/TaskPage'
import { BTN, Mi, ProductAvatar, shortWhen, Switch, useToast } from './artifacts/ui'
import { Icon } from './Icon'

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

/** Tab "Sản phẩm": thứ agent tự nộp (artifact_publish), gom theo việc trên kanban, có phiên bản và góp ý. */
export function ArtifactsView({ workspace: ws }: { workspace: Workspace }): React.JSX.Element {
  const snap = useProducts((s) => s.byWs[ws.id])
  const loadProducts = useProducts((s) => s.load)
  const board = useBoard((s) => s.byWs[ws.id])
  const loadBoard = useBoard((s) => s.load)
  const agentsWs = useAgents((s) => s.byWs[ws.id])
  const [sel, setSel] = useState<Sel>({ task: null, art: null, focus: null, n: 0 })
  const [q, setQ] = useState('')
  const [agentF, setAgentF] = useState<string | null>(null)
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
    const t = setInterval(() => setTick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  const entries = useMemo(() => buildEntries(board?.tasks ?? [], snap, new Date()), [board?.tasks, snap, tick])
  const arts = useMemo(() => new Map((snap?.artifacts ?? []).map((a) => [a.id, a])), [snap])
  const entryOfArt = (id: string): TaskEntry | undefined => entries.find((e) => e.artifacts.some((a) => a.id === id))
  const visible = useMemo(() => visibleEntries(entries, { agentId: agentF, showEmpty }), [entries, agentF, showEmpty])
  const groups = useMemo(() => groupEntries(visible, olderShown), [visible, olderShown])
  const agentList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const e of entries) if (e.artifacts.length || e.status === 'open') seen.set(e.agentId, e.agentName)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [entries])
  const inbox = useMemo(() => inboxOf(snap?.artifacts ?? []).filter((x) => !agentF || arts.get(x.artifactId)?.agentId === agentF), [snap, agentF, arts])
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
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && document.activeElement?.closest('[data-products]')) {
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
            placeholder="Tìm sản phẩm, việc, agent…"
            className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-dim"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="px-0.5 text-dim hover:text-fg" aria-label="Xoá tìm kiếm">
              <Icon name="x" size="s" />
            </button>
          )}
        </label>
        {agentList.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 px-2.5 pb-1.5">
            <button
              type="button"
              onClick={() => setAgentF(null)}
              className={`rounded-md border px-2 py-0.5 text-[11.5px] ${!agentF ? 'border-line-3 bg-panel-2 text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              Mọi agent
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
                  KẾT QUẢ <span className="font-mono tracking-normal">{hits.length}</span>
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
                <b className="mb-1.5 block text-[14px] text-fg">Không thấy sản phẩm nào khớp “{q.trim()}”</b>
                Tìm theo tên, mô tả, file, việc hoặc agent{agentF ? ` (đang lọc: ${agentList.find((a) => a.id === agentF)?.name ?? ''})` : ''}.
                <div className="mt-2.5">
                  <button type="button" className={BTN} onClick={() => setQ('')}>
                    Xoá tìm kiếm
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              {inbox.length > 0 && (
                <div className="mt-1.5 mb-1 rounded-[9px] border border-wait/25 bg-[color-mix(in_srgb,var(--color-wait)_5%,var(--color-panel))] p-1">
                  <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-wait">
                    CẦN BẠN XEM <span className="font-mono tracking-normal">{inbox.length}</span>
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
                            <Kc cls="bg-accent/15 text-accent">
                              {x.newVersions > 1 ? `${x.newVersions} bản mới (v${a.seen + 1}–v${latestVersion(a).v})` : `Bản mới v${latestVersion(a).v}`}
                            </Kc>
                          )}
                          {x.asks > 0 && <Kc cls="bg-wait/15 text-wait">{x.asks} hỏi bạn</Kc>}
                          {x.fixed > 0 && <Kc cls="bg-work/15 text-work">{x.fixed} đã sửa, chờ bạn xem</Kc>}
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
                    className="flex w-full items-center gap-1.5 px-2 pt-3 pb-[5px] text-left text-[11px] font-semibold tracking-[0.07em] text-dim hover:text-muted"
                  >
                    <Icon name={closed[g.id] ? 'cr' : 'cd'} size="s" />
                    {g.label}
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
                      Còn {g.more} việc cũ hơn — Tải thêm
                    </button>
                  )}
                </div>
              ))}
              {!loading && !groups.length && !inbox.length && (
                <div className="mx-3 my-10 text-center leading-relaxed text-dim">
                  {agentF ? 'Agent này chưa có việc nào có sản phẩm.' : 'Chưa có việc nào trên kanban.'}
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
            Hiện việc không có sản phẩm ({emptyCount(entries, agentF)})
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
              'Đang tải…'
            ) : noneAtAll ? (
              <>
                <b className="mb-1.5 block text-[14px] text-fg">Chưa có sản phẩm nào</b>
                Khi agent làm xong một thứ cho bạn xem (báo cáo, mockup, ảnh, video…), agent nộp nó bằng tool <code className="font-mono text-accent">artifact_publish</code> và sản phẩm hiện ở đây, gom theo việc trên Kanban. Code agent sửa không hiện ở đây.
              </>
            ) : (
              'Chọn một việc ở cột trái.'
            )}
          </div>
        )}
      </main>

      <button
        type="button"
        onClick={() => setHelp(!help)}
        title="Sản phẩm là gì?"
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
  const b = entryBadges(e)
  const n = e.artifacts.length
  const run = e.status === 'open'
  return (
    <button type="button" onClick={onClick} className={`mb-px block w-full rounded-[7px] px-[9px] py-2 text-left ${on ? 'bg-panel-3' : 'hover:bg-panel-2'}`}>
      <div className="flex items-center gap-[7px]">
        <ProductAvatar name={e.agentName} />
        <span className={`min-w-0 flex-1 truncate font-medium ${e.status === 'dropped' ? 'text-muted line-through decoration-dim' : ''}`}>{e.title}</span>
        {b.drafts > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-accent" title={`${b.drafts} góp ý nháp chưa gửi`}>
            <Mi name="pen" />
            {b.drafts}
          </span>
        )}
        {b.you > 0 && (
          <span className="font-mono text-[11px] font-semibold text-wait" title={`${b.you} góp ý cần bạn`}>
            ●{b.you}
          </span>
        )}
        {b.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Có bản mới" />}
      </div>
      <div className="mt-[3px] flex gap-[5px] overflow-hidden pl-[25px] text-[11.5px] whitespace-nowrap text-dim">
        {run ? (
          <>
            <span className="text-work">● đang làm · {shortWhen(e.when)}</span>
            <span>·</span>
            <span>{n ? `${n} sản phẩm` : 'chưa nộp gì'}</span>
          </>
        ) : (
          <>
            <span>{n ? `${n} sản phẩm` : 'không có sản phẩm'}</span>
            <span>·</span>
            <span>
              {e.status === 'dropped' ? 'bỏ' : 'xong'} {shortWhen(e.when)}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function Help({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[title="Sản phẩm là gì?"]')) onClose()
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
      className="absolute top-9 right-3 z-30 max-h-[calc(100%-48px)] w-[400px] overflow-auto rounded-[10px] border border-line-2 bg-panel-2 px-4 py-3.5 leading-relaxed text-muted shadow-[0_14px_40px_rgba(0,0,0,.6)] select-text"
    >
      <h3 className="mb-1 text-[13px] font-semibold text-fg">Tab Sản phẩm chỉ có thứ agent tự nộp</h3>
      Code đã sửa, file tạm, config không hiện ở đây (xem trong Kanban → thẻ việc). Khi có thứ cho bạn xem, agent gọi tool của stag:
      <pre className="mt-1.5 rounded-md border border-line bg-bg0 px-2.5 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted">
        {`artifact_publish(
  file: "docs/reports/smoke-0.1.2.md",
  title: "Báo cáo smoke test 0.1.2",
  description: "6/6 pass, 1 lỗi nhỏ…",
  note: "Sửa theo 2 góp ý…",   // từ lần nộp thứ 2
  fixes: ["c2"])                // góp ý đã sửa`}
      </pre>
      Sản phẩm gắn vào việc đang mở của agent đó trên Kanban.
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">Phiên bản</h3>
      Nộp lại cùng file → v2, v3… App chụp lại file mỗi lần nộp (<code className={code}>.stag/artifacts/</code>), nên file gốc bị xoá hay sửa tiếp vẫn xem lại được từng bản. Tài liệu so sánh được hai bản bất kỳ, tô tới từng chữ; ảnh so sánh đặt cạnh nhau.
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">Góp ý</h3>
      Tài liệu: bôi chọn một đoạn. Ảnh, PDF: ghim một điểm. Video: góp ý tại thời điểm đang xem. Bảng: bấm vào ô. Viết xong bấm <b className="text-fg">Lưu nháp</b> để gom nhiều góp ý, hoặc <b className="text-fg">Gửi</b>. Agent đang rảnh thì góp ý được gõ vào phiên ngay; agent đang làm thì chờ hết lượt (không cắt ngang); phiên đang đóng thì chờ tới khi phiên mới mở. Agent trả lời bằng <code className={code}>artifact_reply(id, text)</code>, mỗi góp ý là một mạch trao đổi.
      <h3 className="mt-3 mb-1 text-[13px] font-semibold text-fg">Neo góp ý</h3>
      Mỗi góp ý lưu: khối, vị trí trong khối, và chữ được trích. Sang bản mới, app tìm đúng chữ trích ở vị trí cũ, rồi chỗ gần nhất trong khối, rồi tìm gần đúng (gạch chấm); khối đã bị bỏ thì hiện “Xem ở vN”.
    </div>
  )
}

