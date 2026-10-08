import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactEvent, ArtifactStat, ArtifactText, Workspace } from '@shared/types'
import { ago } from '../status'
import { useArtifacts } from '../store/artifacts'
import { useUi } from '../store/ui'
import {
  buildStacks,
  CATEGORIES,
  extOf,
  fileUrl,
  filterStacks,
  formatSize,
  kindLabel,
  previewKind,
  type ArtifactCategory,
  type ArtifactStack
} from './artifacts/stacks'
import {
  cleanError,
  docxSnippet,
  DocxView,
  FontView,
  HtmlView,
  Note,
  OtherView,
  PdfView,
  pdfThumb,
  PptxView,
  pptxThumbInto,
  sheetSnippet,
  SheetView,
  staticHtml,
  useVisible,
  ZipView
} from './artifacts/previewers'
import { agentColor } from './vault/activity'
import { renderNote } from './vault/markdown'

/** Số thẻ tối đa hiện một lúc (danh sách dài thì lọc / tìm để thu hẹp). */
const MAX_CARDS = 400

/** Tab Artifacts: mọi file agent của workspace đã tạo / sửa / xoá trong dự án. */
export function ArtifactsView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const events = useArtifacts((s) => s.byWs[workspace.id])
  const load = useArtifacts((s) => s.load)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ArtifactCategory | 'all'>('all')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [stacked, setStacked] = useState(true)
  const [wide, setWide] = useState(false)
  const [selected, setSelected] = useState<{ key: string; at?: string } | null>(null)
  const [stats, setStats] = useState<Record<string, ArtifactStat | null>>({})
  // Cập nhật nhãn "x phút" theo thời gian.
  const [, setNow] = useState(0)

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
  /** Chế độ không gom: mỗi lần tạo / sửa là một thẻ. */
  const flat = useMemo(
    () =>
      stacked
        ? []
        : shown
            .flatMap((s) => s.events.filter((e) => !agentId || e.agentId === agentId).map((e) => ({ stack: s, event: e })))
            .sort((a, b) => b.event.at.localeCompare(a.event.at)),
    [stacked, shown, agentId]
  )

  // Kích thước / giờ sửa trên đĩa của các file đang hiện (đọc lại khi danh sách đổi).
  const statKey = shown
    .slice(0, MAX_CARDS)
    .map((s) => `${s.rel}@${s.last}`)
    .join('|')
  useEffect(() => {
    const rels = shown.slice(0, MAX_CARDS).map((s) => s.rel)
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

  return (
    <div className="flex h-full">
      <div className={`min-w-0 flex-1 flex-col ${current && wide ? 'hidden' : 'flex'}`}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative w-[340px] max-w-full">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm artifact…"
              className="w-full rounded-lg border border-line bg-panel py-1.5 pl-8 pr-3 outline-none placeholder:text-muted focus:border-accent/60"
            />
          </div>
          <div className="flex-1" />
          {agents.length > 1 && (
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value || null)}
              className="rounded-md border border-line bg-panel px-2 py-1 text-[12px] outline-none"
            >
              <option value="">Mọi agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setStacked(!stacked)}
            title={stacked ? 'Đang gom theo file — bấm để hiện từng lần tạo / sửa' : 'Đang hiện từng lần tạo / sửa — bấm để gom theo file'}
            className={`flex h-8 w-8 items-center justify-center rounded-md border ${stacked ? 'border-line bg-panel-2 text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            <StackIcon size={16} />
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${category === c.id ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
            >
              {c.label}
              {!empty && counts[c.id] ? <span className="ml-1 text-muted">{counts[c.id]}</span> : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {events === undefined ? null : empty ? (
            <EmptyState title="Chưa có artifact nào." hint="File agent tạo hoặc sửa trong dự án (ảnh, video, tài liệu, code…) sẽ tự hiện ở đây." />
          ) : !shown.length ? (
            <EmptyState title="Không có artifact khớp." hint="Thử bỏ bớt bộ lọc hoặc đổi chữ tìm." />
          ) : stacked ? (
            <CardGrid>
              {shown.slice(0, MAX_CARDS).map((s) => (
                <ArtifactCard
                  key={s.key}
                  ws={workspace}
                  stack={s}
                  stat={stats[s.rel]}
                  active={selected?.key === s.key}
                  onClick={() => setSelected({ key: s.key })}
                />
              ))}
            </CardGrid>
          ) : (
            <CardGrid>
              {flat.slice(0, MAX_CARDS).map(({ stack, event }) => (
                <ArtifactCard
                  key={`${stack.key}@${event.at}@${event.agentId}@${event.kind}`}
                  ws={workspace}
                  stack={stack}
                  event={event}
                  stat={stats[stack.rel]}
                  active={selected?.key === stack.key && selected.at === event.at}
                  onClick={() => setSelected({ key: stack.key, at: event.at })}
                />
              ))}
            </CardGrid>
          )}
          {(stacked ? shown.length : flat.length) > MAX_CARDS && (
            <div className="mt-4 text-center text-[12px] text-muted">Đang hiện {MAX_CARDS} mục mới nhất — tìm hoặc lọc để xem mục cũ hơn.</div>
          )}
        </div>
      </div>

      {current && (
        <ArtifactPreview
          key={current.key}
          ws={workspace}
          stack={current}
          stat={stats[current.rel]}
          focusAt={selected?.at}
          wide={wide}
          onWide={() => setWide(!wide)}
          onClose={() => setSelected(null)}
          onForget={async () => {
            setSelected(null)
            await window.stag.artifacts.forget(workspace.id, current.rel)
          }}
        />
      )}
    </div>
  )
}

function CardGrid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-5">{children}</div>
}

function ArtifactCard({
  ws,
  stack,
  event,
  stat,
  active,
  onClick
}: {
  ws: Workspace
  stack: ArtifactStack
  /** Chế độ không gom: thẻ của một lần tạo / sửa. */
  event?: ArtifactEvent
  stat: ArtifactStat | null | undefined
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const layers = event ? 0 : Math.min(stack.events.length - 1, 2)
  const gone = stat === null || stack.deleted
  const who = event ? [{ id: event.agentId, name: event.agentName }] : stack.agents
  return (
    <button onClick={onClick} className="group relative text-left" style={{ paddingBottom: layers * 4 }}>
      {/* Các lớp phía sau = file đã được tạo / sửa nhiều lần (một "chồng" artifact). */}
      {layers >= 2 && <div className="absolute inset-x-3 bottom-0 top-2 rounded-lg border border-line bg-panel/60" />}
      {layers >= 1 && <div className="absolute inset-x-1.5 top-1 rounded-lg border border-line bg-panel" style={{ bottom: layers >= 2 ? 4 : 0 }} />}
      <div
        className={`relative overflow-hidden rounded-lg border bg-panel transition-colors ${
          active ? 'border-accent' : 'border-line group-hover:border-accent/50'
        }`}
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-panel-2">
          <Thumb ws={ws} rel={stack.rel} version={stat?.mtime ?? stack.last} gone={gone} />
          {gone && event?.kind !== 'delete' && (
            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-red-300">{stack.deleted ? 'Đã xoá' : 'Không còn file'}</span>
          )}
          {!event && stack.events.length > 1 && (
            <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-fg" title={`${stack.events.length} lần tạo / sửa`}>
              <StackIcon size={11} />
              {stack.events.length}
            </span>
          )}
          {event && (
            <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-fg">{kindLabel(event.kind)}</span>
          )}
        </div>
        <div className="px-2.5 py-2">
          <div className="truncate font-medium" title={stack.rel}>
            {stack.name}
          </div>
          <div className="truncate text-[11px] text-muted">{stack.dir || '(thư mục gốc)'}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
            <AgentDots agents={who} />
            <span className="truncate">{who.map((a) => a.name).join(', ')}</span>
            <span className="ml-auto shrink-0">{ago(event?.at ?? stack.last)}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function AgentDots({ agents }: { agents: Array<{ id: string; name: string }> }): React.JSX.Element {
  return (
    <span className="flex shrink-0 -space-x-1">
      {agents.slice(0, 3).map((a) => (
        <span key={a.id} className="h-2.5 w-2.5 rounded-full ring-2 ring-panel" style={{ background: agentColor(a.id) }} title={a.name} />
      ))}
    </span>
  )
}

/**
 * Ảnh thu nhỏ của thẻ: ảnh / khung đầu video; trang đầu PDF; slide đầu PowerPoint; trang HTML thu nhỏ; vài dòng đầu
 * của file chữ; file Office có ảnh nhúng hoặc file Windows tạo được ảnh thu nhỏ; còn lại là nhãn đuôi file.
 * Chỉ tải khi thẻ lọt vào màn hình.
 */
function Thumb({ ws, rel, version, gone }: { ws: Workspace; rel: string; version: string; gone: boolean }): React.JSX.Element {
  const kind = previewKind(rel)
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [failed, setFailed] = useState(false)
  /** Ảnh (data URL) từ pdf.js / file Office / Windows. */
  const [picture, setPicture] = useState<string | null>(null)
  const [snippet, setSnippet] = useState<string | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const slideHost = useRef<HTMLDivElement>(null)
  const [slide, setSlide] = useState(false)
  /** Word không có ảnh nhúng: vài đoạn đầu; bảng tính: vài ô đầu. */
  const [paper, setPaper] = useState<string[] | null>(null)
  const [cells, setCells] = useState<string[][] | null>(null)

  useEffect(() => {
    setFailed(false)
    setPicture(null)
    setSnippet(null)
    setHtml(null)
    setSlide(false)
    setPaper(null)
    setCells(null)
    if (!visible || gone || kind === 'image' || kind === 'video') return
    let alive = true
    let ro: ResizeObserver | null = null
    const fail = (): void => {
      if (alive) setFailed(true)
    }
    if (kind === 'text' || kind === 'markdown')
      window.stag.artifacts
        .text(ws.id, rel, 2048)
        .then((r) => alive && setSnippet(r.status === 'ok' ? r.text : null))
        .catch(fail)
    else if (kind === 'pdf') pdfThumb(ws, rel, version).then((u) => alive && (u ? setPicture(u) : setFailed(true)))
    else if (kind === 'html')
      window.stag.artifacts
        .text(ws.id, rel)
        .then(async (t) => (t.status === 'ok' ? staticHtml(ws, rel, t.text) : null))
        .then((h) => alive && setHtml(h))
        .catch(fail)
    else
      window.stag.artifacts
        .thumb(ws.id, rel)
        .then(async (u) => {
          if (!alive) return
          if (u) return setPicture(u)
          // Không có ảnh nhúng (vd. file tạo bằng thư viện, không qua Office): tự vẽ phần đầu.
          const host = slideHost.current
          if (kind === 'pptx' && host) {
            setSlide(true)
            const fit = await pptxThumbInto(ws, rel, host)
            if (!fit) return fail()
            if (!alive) return
            ro = new ResizeObserver(fit)
            ro.observe(host)
          } else if (kind === 'docx') {
            const t = await docxSnippet(ws, rel)
            if (alive) (t?.length ? setPaper(t) : fail())
          } else if (kind === 'sheet') {
            const c = await sheetSnippet(ws, rel)
            if (alive) (c?.length ? setCells(c) : fail())
          } else fail()
        })
        .catch(fail)
    return () => {
      alive = false
      ro?.disconnect()
    }
  }, [ws, rel, version, kind, gone, visible])

  let body: React.ReactNode = null
  if (!gone && !failed && kind === 'image')
    body = <img src={fileUrl(ws.id, rel, version)} loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-cover" />
  else if (!gone && !failed && kind === 'video')
    body = <video src={`${fileUrl(ws.id, rel, version)}#t=0.1`} preload="metadata" muted onError={() => setFailed(true)} className="h-full w-full object-cover" />
  else if (picture) body = <img src={picture} draggable={false} className="h-full w-full bg-white object-cover object-top" />
  else if (html != null)
    body = (
      <div className="h-full w-full overflow-hidden bg-white">
        <iframe
          sandbox=""
          srcDoc={html}
          tabIndex={-1}
          className="pointer-events-none origin-top-left border-0"
          style={{ width: '400%', height: '400%', transform: 'scale(0.25)' }}
        />
      </div>
    )
  else if (paper)
    body = (
      <div className="h-full overflow-hidden bg-[#2a2e37] px-5 pt-3">
        <div className="h-full overflow-hidden bg-white px-3 py-2.5 text-[7.5px] leading-[1.5] text-[#1f2937]">
          {paper.map((p, i) => (
            <p key={i} className={i === 0 ? 'mb-1 text-[10px] font-semibold' : 'mb-1'}>
              {p}
            </p>
          ))}
        </div>
      </div>
    )
  else if (cells)
    body = (
      <table className="w-full table-fixed border-collapse text-[9px]">
        <tbody>
          {cells.map((r, i) => (
            <tr key={i} className={i === 0 ? 'bg-panel font-semibold text-fg' : 'text-muted'}>
              {r.map((c, j) => (
                <td key={j} className="truncate border border-line px-1 py-[2px]">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  else if (snippet)
    body = <pre className="h-full overflow-hidden whitespace-pre-wrap break-all p-2.5 font-mono text-[9.5px] leading-[1.45] text-muted">{snippet.slice(0, 900)}</pre>
  else if (!slide || failed)
    body = (
      <div className="flex h-full items-center justify-center">
        <span className="rounded-md border border-line px-2.5 py-1 font-mono text-[13px] uppercase text-muted">{extOf(rel) || 'file'}</span>
      </div>
    )
  return (
    <div ref={ref} className="relative h-full w-full">
      {kind === 'pptx' && <div ref={slideHost} className={`absolute inset-0 overflow-hidden bg-[#2a2e37] ${slide && !failed ? '' : 'hidden'}`} />}
      {body}
    </div>
  )
}

function ArtifactPreview({
  ws,
  stack,
  stat,
  focusAt,
  wide,
  onWide,
  onClose,
  onForget
}: {
  ws: Workspace
  stack: ArtifactStack
  stat: ArtifactStat | null | undefined
  focusAt?: string
  /** Khung xem trước chiếm cả vùng (ẩn lưới thẻ). */
  wide: boolean
  onWide: () => void
  onClose: () => void
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

  let content: React.ReactNode = null
  if (missing) content = <Note>{stack.deleted ? 'File đã bị agent xoá.' : 'Không còn file này trên đĩa (đã xoá hoặc đổi tên).'}</Note>
  else if (kind === 'image')
    content = (
      <div className="flex min-h-full items-center justify-center bg-[repeating-conic-gradient(#1d212a_0%_25%,#161920_0%_50%)] bg-[length:16px_16px] p-4">
        <img src={fileUrl(ws.id, stack.rel, version)} className="max-h-full max-w-full object-contain" draggable={false} />
      </div>
    )
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
    content = (
      <>
        {html ? (
          <div className="md-body select-text px-5 py-4" onClick={onMdClick} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <CodeText text={text.text} />
        )}
        {text.truncated && <Note>Chỉ hiện 512 KB đầu. Bấm “Mở” để xem cả file.</Note>}
      </>
    )

  return (
    <aside className={`flex shrink-0 flex-col border-l border-line bg-panel ${wide ? 'w-full' : 'w-[46%] min-w-[360px] max-w-[760px]'}`}>
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold select-text" title={stack.rel}>
            {stack.name}
          </div>
          <div className="truncate text-[12px] text-muted select-text">{stack.rel}</div>
        </div>
        <button
          onClick={onWide}
          className="rounded-md px-2 py-0.5 text-[14px] leading-none text-muted hover:bg-panel-2 hover:text-fg"
          title={wide ? 'Thu nhỏ khung xem trước' : 'Phóng to khung xem trước'}
        >
          {wide ? '⇥' : '⇤'}
        </button>
        <button onClick={onClose} className="rounded-md px-2 py-0.5 text-[16px] leading-none text-muted hover:bg-panel-2 hover:text-fg" title="Đóng (Esc)">
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-[12px]">
        <ToolButton disabled={missing} onClick={() => act(window.stag.artifacts.open(ws.id, stack.rel))}>
          Mở
        </ToolButton>
        <ToolButton disabled={missing} onClick={() => act(window.stag.artifacts.reveal(ws.id, stack.rel))}>
          Hiện trong thư mục
        </ToolButton>
        {kind === 'markdown' && text?.status === 'ok' && <ToolButton onClick={() => setSource(!source)}>{source ? 'Xem' : 'Mã nguồn'}</ToolButton>}
        {kind === 'html' && !missing && <ToolButton onClick={runInBrowser}>Chạy trong Browser</ToolButton>}
        <div className="flex-1" />
        <span className="text-muted">
          {stat ? `${formatSize(stat.size)} · ${editedAgo(stat.mtime)}` : stat === null ? 'Không còn file trên đĩa' : ''}
        </span>
        <ToolButton onClick={onForget} title="Bỏ khỏi danh sách artifact (không xoá file)">
          Ẩn
        </ToolButton>
      </div>
      {error && <div className="border-b border-line bg-red-500/10 px-4 py-1.5 text-[12px] text-red-300">{error}</div>}

      <div className="min-h-0 flex-1 overflow-auto">{content}</div>

      <div className={`shrink-0 overflow-y-auto border-t border-line px-4 ${history ? 'max-h-[28%] py-3' : 'py-2'}`}>
        <button onClick={() => setHistory(!history)} className="flex w-full items-center gap-1 text-[11px] uppercase tracking-wider text-muted hover:text-fg">
          <span className="w-3">{history ? '▾' : '▸'}</span>
          Lịch sử ({stack.events.length})
        </button>
        {history && (
          <ul className="mt-2 space-y-1">
            {stack.events.map((e, i) => (
              <li key={`${e.at}-${i}`} className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12px] ${focusAt === e.at ? 'bg-panel-2' : ''}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(e.agentId) }} />
                <span className="truncate font-medium">{e.agentName}</span>
                <span className={e.kind === 'delete' ? 'text-red-300' : 'text-muted'}>{kindLabel(e.kind)}</span>
                <span className="truncate text-muted" title={e.rel}>
                  {e.rel !== stack.rel ? e.rel : ''}
                </span>
                <span className="ml-auto shrink-0 text-muted" title={new Date(e.at).toLocaleString('vi-VN')}>
                  {e.tool} · {ago(e.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

/** Code / văn bản thường, có số dòng. */
function CodeText({ text }: { text: string }): React.JSX.Element {
  const lines = useMemo(() => {
    const ls = text.split('\n')
    if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop()
    return ls.length
  }, [text])
  return (
    <div className="flex min-w-max font-mono text-[12px] leading-[1.55]">
      <pre className="sticky left-0 shrink-0 border-r border-line bg-panel py-3 pl-3 pr-2 text-right text-muted select-none">
        {Array.from({ length: lines }, (_, i) => `${i + 1}\n`).join('')}
      </pre>
      <pre className="select-text whitespace-pre py-3 pl-3 pr-4">{text}</pre>
    </div>
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

function ToolButton({
  children,
  onClick,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="rounded-md bg-panel-2 px-2.5 py-1 hover:bg-line disabled:opacity-40">
      {children}
    </button>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-md bg-panel-2 text-muted">
        <StackIcon size={34} />
      </div>
      <div className="mt-4 font-semibold">{title}</div>
      <div className="mt-1 max-w-[380px] text-[12px] text-muted">{hint}</div>
    </div>
  )
}

function StackIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
