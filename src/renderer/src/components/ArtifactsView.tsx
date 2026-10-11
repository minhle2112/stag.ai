import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactEvent, ArtifactStat, ArtifactText, Workspace } from '@shared/types'
import { ago } from '../status'
import { useArtifacts } from '../store/artifacts'
import { useUi } from '../store/ui'
import { CodeView } from './artifacts/CodeView'
import { splitLines } from './artifacts/code'
import {
  buildStacks,
  CATEGORIES,
  fileUrl,
  filterStacks,
  formatSize,
  groupRows,
  kindLabel,
  markerOf,
  previewKind,
  rowTime,
  type ArtifactCategory,
  type ArtifactGroup,
  type ArtifactGroupMode,
  type ArtifactRow,
  type ArtifactStack
} from './artifacts/stacks'
import { cleanError, DocxView, FontView, HtmlView, ImageView, Note, OtherView, PdfView, PptxView, SheetView, ZipView } from './artifacts/previewers'
import { Icon } from './Icon'
import { IconButton } from './shell/IconButton'
import { AgentAvatar } from './ui/AgentAvatar'
import { Seg } from './ui/Seg'
import { renderNote } from './vault/markdown'

/** Số dòng tối đa của danh sách một lúc (danh sách dài thì lọc / tìm để thu hẹp). */
const MAX_ROWS = 400

/** Cách gom đã chọn nhớ theo máy (chỉ là tiện lợi của người xem, không quan trọng nếu mất). */
const GROUP_KEY = 'stag.artifacts.group'
function readGroup(): ArtifactGroupMode {
  try {
    const v = localStorage.getItem(GROUP_KEY)
    if (v === 'dir' || v === 'agent' || v === 'time') return v
  } catch {
    // Không đọc được storage (cửa sổ riêng tư…): dùng mặc định.
  }
  // Mặc định giữ đúng thứ tự cũ của tab: mới nhất lên đầu.
  return 'time'
}

/** Dấu đầu dòng của danh sách: + tạo mới (xanh lá), ~ đã sửa (xanh dương), - đã xoá (đỏ). */
const MARK = {
  add: { ch: '+', cls: 'text-work', tip: 'Tạo mới' },
  mod: { ch: '~', cls: 'text-info', tip: 'Đã sửa' },
  del: { ch: '-', cls: 'text-danger', tip: 'Đã xoá' }
} as const

interface Selection {
  key: string
  /** Chế độ không gom: lần tạo / sửa cụ thể đang chọn. */
  at?: string
}

/** Tab Artifacts: mọi file agent của workspace đã tạo / sửa / xoá trong dự án. Danh sách bên trái, xem trước bên phải. */
export function ArtifactsView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const events = useArtifacts((s) => s.byWs[workspace.id])
  const load = useArtifacts((s) => s.load)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ArtifactCategory | 'all'>('all')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [group, setGroup] = useState<ArtifactGroupMode>(readGroup)
  const [stacked, setStacked] = useState(true)
  const [listOpen, setListOpen] = useState(true)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [stats, setStats] = useState<Record<string, ArtifactStat | null>>({})
  // Cập nhật nhãn "x phút" và tên nhóm giờ theo thời gian.
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    load(workspace.id)
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [workspace.id, load])

  const stacks = useMemo(() => buildStacks(events ?? []), [events])
  const agents = useMemo(() => {
    const seen = new Map<string, string>()
    for (const s of stacks) for (const a of s.agents) if (!seen.has(a.id)) seen.set(a.id, a.name)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [stacks])
  const shown = useMemo(() => filterStacks(stacks, category, query, agentId), [stacks, category, query, agentId])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 }
    for (const s of filterStacks(stacks, 'all', query, agentId)) {
      c.all++
      c[s.category] = (c[s.category] ?? 0) + 1
    }
    return c
  }, [stacks, query, agentId])
  /** Mỗi file một dòng (đã gom) hoặc mỗi lần tạo / sửa một dòng (chế độ không gom). */
  const rows = useMemo<ArtifactRow[]>(
    () =>
      stacked
        ? shown.map((stack) => ({ stack }))
        : shown
            .flatMap((s) => s.events.filter((e) => !agentId || e.agentId === agentId).map((event) => ({ stack: s, event })))
            .sort((a, b) => b.event.at.localeCompare(a.event.at)),
    [stacked, shown, agentId]
  )
  const groups = useMemo(
    () => groupRows(rows.slice(0, MAX_ROWS), group, { now: new Date(now), onlyAgent: agentId }),
    [rows, group, now, agentId]
  )
  /** Thứ tự các dòng như đang hiện (để chuyển chọn bằng phím mũi tên). */
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  // Kích thước / giờ sửa trên đĩa của các file đang hiện (đọc lại khi danh sách đổi).
  const statKey = shown
    .slice(0, MAX_ROWS)
    .map((s) => `${s.rel}@${s.last}`)
    .join('|')
  useEffect(() => {
    const rels = shown.slice(0, MAX_ROWS).map((s) => s.rel)
    if (!rels.length) return
    let alive = true
    window.stag.artifacts.stat(workspace.id, rels).then((r) => alive && setStats((prev) => ({ ...prev, ...r })))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id, statKey])

  const current = selected ? stacks.find((s) => s.key === selected.key) ?? null : null

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])

  const empty = !(events ?? []).length
  const agentName = agentId ? agents.find((a) => a.id === agentId)?.name ?? '' : ''
  const showList = listOpen || !current

  const isActive = (r: ArtifactRow): boolean => {
    if (!selected || r.stack.key !== selected.key) return false
    if (!r.event) return true
    return selected.at ? r.event.at === selected.at : r.event === r.stack.events[0]
  }
  const select = (r: ArtifactRow): void => setSelected({ key: r.stack.key, at: r.event?.at })
  const sig = (r: ArtifactRow): string => `${r.stack.key}|${r.event?.at ?? ''}`

  const onListKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const dir = e.key === 'ArrowDown' ? 1 : -1
    const cur = order.findIndex(isActive)
    let i = cur < 0 ? (dir > 0 ? 0 : order.length - 1) : cur + dir
    // Cùng một file có thể hiện ở nhiều nhóm (gom theo agent): bỏ qua bản trùng liền kề.
    while (cur >= 0 && i >= 0 && i < order.length && sig(order[i]) === sig(order[cur])) i += dir
    if (i < 0 || i >= order.length) return
    select(order[i])
    requestAnimationFrame(() => listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }

  const changeGroup = (g: ArtifactGroupMode): void => {
    setGroup(g)
    try {
      localStorage.setItem(GROUP_KEY, g)
    } catch {
      // Bỏ qua: chỉ là nhớ lựa chọn.
    }
  }

  if (events !== undefined && empty)
    return (
      <div className="flex h-full items-center justify-center bg-panel">
        <EmptyState title="Chưa có artifact nào." hint="File agent tạo hoặc sửa trong dự án (ảnh, video, tài liệu, code…) sẽ tự hiện ở đây." />
      </div>
    )

  return (
    <div
      className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)]"
      style={{ gridTemplateColumns: showList ? 'clamp(220px, 34%, 330px) minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
    >
      {showList && (
        <aside className="flex min-h-0 min-w-0 flex-col border-r border-line bg-bg">
          <div className="flex shrink-0 flex-col gap-2 border-b border-line p-2">
            <label className="flex h-7 items-center gap-1.5 rounded-md border border-line-2 bg-bg0 pr-1 pl-2 text-dim focus-within:border-accent/40">
              <Icon name="search" size="s" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tìm tệp, thư mục, agent"
                className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-fg outline-none placeholder:text-dim"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  data-tip="Xoá chữ tìm"
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg"
                >
                  <Icon name="x" size="s" />
                </button>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Seg
                value={group}
                onChange={changeGroup}
                options={[
                  { value: 'dir', label: 'Thư mục', tip: 'Nhóm theo thư mục' },
                  { value: 'agent', label: 'Agent', tip: 'Nhóm theo agent · bấm tên agent để chỉ hiện việc của agent đó' },
                  { value: 'time', label: 'Giờ', tip: 'Nhóm theo giờ, mới nhất trước' }
                ]}
              />
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-dim">{stacked ? `${shown.length} tệp` : `${rows.length} lần`}</span>
              <IconButton
                icon="hist"
                tip={stacked ? 'Đang gom theo file — bấm để hiện từng lần tạo / sửa' : 'Đang hiện từng lần tạo / sửa — bấm để gom theo file'}
                on={!stacked}
                onClick={() => setStacked(!stacked)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.filter((c) => c.id === 'all' || c.id === category || counts[c.id]).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`flex h-5 items-center gap-1 rounded px-2 text-[11px] ${category === c.id ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {c.label}
                  {counts[c.id] ? <span className="font-mono text-dim">{counts[c.id]}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {agentId && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel py-1.5 pr-2 pl-3 text-[12px]">
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pr-0.5 pl-[3px]">
                <AgentAvatar name={agentName} size={16} />
                {agentName}
                <button
                  type="button"
                  onClick={() => setAgentId(null)}
                  data-tip="Bỏ lọc"
                  className="grid h-[18px] w-[18px] place-items-center rounded-full text-muted hover:bg-panel-3 hover:text-fg"
                >
                  <Icon name="x" size="s" />
                </button>
              </span>
            </div>
          )}

          <div
            ref={listRef}
            role="listbox"
            aria-label="Artifact"
            tabIndex={0}
            onKeyDown={onListKey}
            className="min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
          >
            {events === undefined ? null : !groups.length ? (
              <div className="px-3 py-4 text-[12px] text-dim">Không có tệp khớp. Thử bỏ bớt bộ lọc hoặc đổi chữ tìm.</div>
            ) : (
              groups.map((g) => (
                <Fragment key={g.key}>
                  <GroupHeader g={g} mode={group} agentId={agentId} onAgent={setAgentId} />
                  {g.rows.map((r) => (
                    <ArtifactRowItem
                      key={`${g.key}|${r.stack.key}|${r.event ? `${r.event.at}|${r.event.agentId}|${r.event.kind}` : ''}`}
                      row={r}
                      mode={group}
                      agentId={g.agent?.id}
                      active={isActive(r)}
                      gone={r.event ? r.event.kind === 'delete' : r.stack.deleted || stats[r.stack.rel] === null}
                      onSelect={() => select(r)}
                    />
                  ))}
                </Fragment>
              ))
            )}
            {rows.length > MAX_ROWS && (
              <div className="px-3 py-3 text-center text-[11px] text-dim">Đang hiện {MAX_ROWS} mục mới nhất — tìm hoặc lọc để xem mục cũ hơn.</div>
            )}
          </div>
        </aside>
      )}

      {current ? (
        <ArtifactPreview
          key={current.key}
          ws={workspace}
          stack={current}
          stat={stats[current.rel]}
          focusAt={selected?.at}
          listOpen={listOpen}
          onToggleList={() => setListOpen(!listOpen)}
          onForget={async () => {
            setSelected(null)
            await window.stag.artifacts.forget(workspace.id, current.rel)
          }}
        />
      ) : (
        <section className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-2 bg-panel text-dim">
          <Icon name="fdiff" size="l" />
          <span className="text-[12px]">Chọn một tệp ở bên trái để xem</span>
        </section>
      )}
    </div>
  )
}

function GroupHeader({
  g,
  mode,
  agentId,
  onAgent
}: {
  g: ArtifactGroup
  mode: ArtifactGroupMode
  agentId: string | null
  onAgent: (id: string | null) => void
}): React.JSX.Element | null {
  const head = 'flex min-h-[30px] items-center gap-1.5 px-3 pt-2.5 pb-1'
  if (mode === 'agent' && g.agent) {
    // Đang lọc theo agent này: chip ở trên đã nói rõ, không lặp lại tiêu đề nhóm.
    if (agentId === g.agent.id) return null
    const id = g.agent.id
    return (
      <div className={`${head} text-[12px] text-muted`}>
        <AgentAvatar name={g.agent.name} size={16} />
        <button
          type="button"
          onClick={() => onAgent(id)}
          data-tip={`Chỉ hiện thay đổi của ${g.agent.name}`}
          className="min-w-0 truncate font-medium hover:text-fg"
        >
          {g.agent.name}
        </button>
        <span className="font-mono text-[11px] text-dim">{g.rows.length}</span>
      </div>
    )
  }
  return (
    <div className={`${head} text-[11px] text-dim`}>
      <Icon name={mode === 'dir' ? 'folder' : 'hist'} size="s" />
      <span className="min-w-0 flex-1 truncate font-mono" data-tip={g.label}>
        {g.label}
      </span>
      <span className="font-mono">{g.rows.length}</span>
    </div>
  )
}

function ArtifactRowItem({
  row,
  mode,
  agentId,
  active,
  gone,
  onSelect
}: {
  row: ArtifactRow
  mode: ArtifactGroupMode
  /** Nhóm theo agent: agent của nhóm chứa dòng này (dấu + giờ tính riêng cho agent đó). */
  agentId?: string
  active: boolean
  /** File đã bị xoá / không còn trên đĩa. */
  gone: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { stack, event } = row
  const mk = MARK[markerOf(row, agentId)]
  const who = event ? [{ id: event.agentId, name: event.agentName }] : stack.agents
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onSelect}
      data-tip={stack.rel}
      data-tip-side="right"
      className={`flex min-w-0 cursor-pointer items-center gap-2 px-3 py-[5px] text-[13px] ${active ? 'bg-accent/10' : 'hover:bg-panel-2'}`}
    >
      <span className={`w-3 shrink-0 text-center font-mono text-[12px] font-bold ${mk.cls}`}>{mk.ch}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className={gone ? 'text-dim line-through' : ''}>{stack.name}</span>
        {mode !== 'dir' && stack.dir && <small className="ml-[5px] text-[11px] text-dim">{stack.dir}</small>}
      </span>
      {mode !== 'agent' && <Avatars who={who} size={16} />}
      <time className="shrink-0 font-mono text-[11px] text-dim">{ago(rowTime(row, agentId))}</time>
    </div>
  )
}

/** Avatar của (tối đa 3) agent, chồng lên nhau; tên đầy đủ trong chú thích. */
function Avatars({ who, size }: { who: Array<{ id: string; name: string }>; size: number }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 -space-x-1.5" data-tip={who.map((a) => a.name).join(', ')}>
      {who.slice(0, 3).map((a) => (
        <span key={a.id} className="inline-flex rounded-[5px] ring-2 ring-bg">
          <AgentAvatar name={a.name} size={size} />
        </span>
      ))}
    </span>
  )
}

function ArtifactPreview({
  ws,
  stack,
  stat,
  focusAt,
  listOpen,
  onToggleList,
  onForget
}: {
  ws: Workspace
  stack: ArtifactStack
  stat: ArtifactStat | null | undefined
  focusAt?: string
  /** Danh sách bên trái đang hiện (nút ở đầu khung ẩn / hiện nó để xem rộng hơn). */
  listOpen: boolean
  onToggleList: () => void
  onForget: () => void
}): React.JSX.Element {
  const kind = previewKind(stack.rel)
  const textual = kind === 'text' || kind === 'markdown'
  const [text, setText] = useState<ArtifactText | null>(null)
  const [source, setSource] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [history, setHistory] = useState(true)
  const setBrowserOpen = useUi((s) => s.setBrowserOpen)
  const version = stat?.mtime ?? stack.last

  // Đọc lại khi agent ghi thêm (stack.last) hoặc file đổi trên đĩa (mtime).
  useEffect(() => {
    setMediaFailed(false)
    if (!textual) return
    let alive = true
    window.stag.artifacts.text(ws.id, stack.rel).then((r) => alive && setText(r))
    return () => {
      alive = false
    }
  }, [ws.id, stack.rel, version, textual])

  const html = useMemo(
    () => (kind === 'markdown' && text?.status === 'ok' && !source ? renderNote(text.text, { current: stack.rel, notes: null }).html : ''),
    [kind, text, source, stack.rel]
  )
  const lineCount = useMemo(() => (text?.status === 'ok' && !text.truncated ? splitLines(text.text).length : null), [text])

  const act = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((e: Error) => setError(cleanError(e)))
  }
  /** Trang HTML cần JavaScript: mở bằng file:// trong Browser của app (session riêng, tách khỏi cửa sổ app). */
  const runInBrowser = (): void => {
    const abs = `${ws.path.replace(/\\/g, '/').replace(/\/+$/, '')}/${stack.rel}`
    const url = `file:///${abs.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')}`
    act(window.stag.browser.newTab(ws.id, url).then(() => setBrowserOpen(true)))
  }

  const missing = stat === null || text?.status === 'missing'
  const props = { ws, rel: stack.rel, version }
  const mk = MARK[markerOf({ stack })]
  const meta = stat
    ? [formatSize(stat.size), lineCount != null ? `${lineCount} dòng` : null, editedAgo(stat.mtime)].filter(Boolean).join(' · ')
    : stat === null
      ? 'Không còn file trên đĩa'
      : ''

  let content: React.ReactNode = null
  if (missing) content = <Note>{stack.deleted ? 'File đã bị agent xoá.' : 'Không còn file này trên đĩa (đã xoá hoặc đổi tên).'}</Note>
  else if (kind === 'image' && mediaFailed) content = <OtherView {...props} reason="Trình xem trong app không đọc được ảnh này." />
  else if (kind === 'image') content = <ImageView {...props} onError={() => setMediaFailed(true)} />
  else if ((kind === 'video' || kind === 'audio') && mediaFailed)
    content = <OtherView {...props} reason="Trình phát trong app không đọc được định dạng / codec của file này." />
  else if (kind === 'video')
    content = (
      <div className="flex h-full items-center justify-center bg-black p-2">
        <video src={fileUrl(ws.id, stack.rel, version)} controls onError={() => setMediaFailed(true)} className="max-h-full max-w-full" />
      </div>
    )
  else if (kind === 'audio')
    content = (
      <div className="p-6">
        <audio src={fileUrl(ws.id, stack.rel, version)} controls onError={() => setMediaFailed(true)} className="w-full" />
      </div>
    )
  else if (kind === 'pdf') content = <PdfView {...props} />
  else if (kind === 'docx') content = <DocxView {...props} />
  else if (kind === 'sheet') content = <SheetView {...props} />
  else if (kind === 'pptx') content = <PptxView {...props} />
  else if (kind === 'html') content = <HtmlView {...props} onRun={runInBrowser} />
  else if (kind === 'zip') content = <ZipView {...props} />
  else if (kind === 'font') content = <FontView {...props} />
  else if (kind === 'other' || text?.status === 'binary') content = <OtherView {...props} />
  else if (text?.status === 'ok')
    content = html ? (
      <div className="md-body mx-auto max-w-[820px] px-6 py-5 select-text @[700px]:px-10" onClick={onMdClick} dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <CodeView text={text.text} rel={stack.rel} />
    )

  return (
    <section className="@container flex min-h-0 min-w-0 flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className={`w-3 shrink-0 text-center font-mono text-[12px] font-bold ${mk.cls}`} data-tip={mk.tip}>
          {mk.ch}
        </span>
        <span className="min-w-0 truncate font-mono text-[12px] select-text" title={stack.rel}>
          {stack.dir && <span className="text-dim">{stack.dir}/</span>}
          {stack.name}
        </span>
        {meta && <span className="hidden shrink-0 font-mono text-[11px] text-dim @[680px]:inline">{meta}</span>}
        <span className="flex-1" />
        {kind === 'markdown' && text?.status === 'ok' && (
          <Seg
            value={source ? 'source' : 'view'}
            onChange={(v) => setSource(v === 'source')}
            options={[
              { value: 'view', label: 'Xem' },
              { value: 'source', label: 'Mã nguồn' }
            ]}
          />
        )}
        <Avatars who={stack.agents} size={18} />
        {kind === 'html' && !missing && <IconButton icon="globe" tip="Chạy trang trong Browser của app (có JavaScript)" onClick={runInBrowser} />}
        {!missing && <IconButton icon="ext" tip="Mở bằng ứng dụng mặc định" onClick={() => act(window.stag.artifacts.open(ws.id, stack.rel))} />}
        {!missing && <IconButton icon="folder" tip="Hiện trong thư mục" onClick={() => act(window.stag.artifacts.reveal(ws.id, stack.rel))} />}
        <IconButton icon="archive" tip="Ẩn khỏi danh sách artifact (không xoá file)" onClick={onForget} />
        <IconButton icon="side" tip={listOpen ? 'Ẩn danh sách để xem rộng hơn' : 'Hiện danh sách'} on={!listOpen} onClick={onToggleList} />
      </div>
      {error && <div className="shrink-0 border-b border-line bg-danger/10 px-3 py-1.5 text-[12px] text-danger">{error}</div>}
      {text?.status === 'ok' && text.truncated && (
        <div className="shrink-0 border-b border-line bg-panel-2 px-3 py-1.5 text-[12px] text-muted">
          Chỉ hiện 512 KB đầu — mở bằng ứng dụng mặc định để xem cả file.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">{content}</div>

      <div className={`shrink-0 overflow-y-auto border-t border-line px-3 ${history ? 'max-h-[28%] py-2' : 'py-1.5'}`}>
        <button
          type="button"
          onClick={() => setHistory(!history)}
          className="flex w-full items-center gap-1 text-[11px] font-semibold tracking-[0.07em] text-dim hover:text-fg"
        >
          <Icon name={history ? 'cd' : 'cr'} size="s" />
          LỊCH SỬ · {stack.events.length}
        </button>
        {history && (
          <ul className="mt-1.5 space-y-0.5">
            {stack.events.map((e, i) => (
              <HistoryRow key={`${e.at}-${i}`} e={e} stack={stack} focus={focusAt === e.at} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function HistoryRow({ e, stack, focus }: { e: ArtifactEvent; stack: ArtifactStack; focus: boolean }): React.JSX.Element {
  return (
    <li className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12px] ${focus ? 'bg-panel-3' : ''}`}>
      <AgentAvatar name={e.agentName} size={16} />
      <span className="truncate font-medium">{e.agentName}</span>
      <span className={e.kind === 'delete' ? 'text-danger' : 'text-muted'}>{kindLabel(e.kind)}</span>
      <span className="truncate font-mono text-[11px] text-dim" title={e.rel}>
        {e.rel !== stack.rel ? e.rel : ''}
      </span>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-dim" title={new Date(e.at).toLocaleString('vi-VN')}>
        {e.tool} · {ago(e.at)}
      </span>
    </li>
  )
}

/** "vừa sửa" / "sửa 5 phút trước". */
function editedAgo(iso: string): string {
  const a = ago(iso)
  return a === 'vừa xong' ? 'vừa sửa' : `sửa ${a} trước`
}

/** Link trong file markdown: http(s) mở bằng trình duyệt hệ thống, còn lại bỏ qua (không điều hướng cửa sổ app). */
function onMdClick(e: React.MouseEvent): void {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:/i.test(href)) window.open(href)
}

function EmptyState({ title, hint }: { title: string; hint: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-[56px] w-[56px] items-center justify-center rounded-lg bg-panel-2 text-dim">
        <Icon name="fdiff" size={26} />
      </div>
      <div className="mt-4 text-[13px] font-semibold">{title}</div>
      <div className="mt-1 max-w-[380px] text-[12px] text-muted">{hint}</div>
    </div>
  )
}
