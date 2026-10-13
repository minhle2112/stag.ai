// Trang một việc ở tab Sản phẩm: tóm tắt bàn giao + thẻ các sản phẩm agent đã nộp.
import { useEffect, useRef, useState } from 'react'
import { failureReason, latestVersion, needsYou, unseenVersions, type ArtifactRecord, type DocBlock } from '@shared/artifacts'
import type { Workspace } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useUi } from '../../store/ui'
import { docxSnippet, pdfThumb, pptxThumbInto, sheetSnippet, staticHtml, useVisible } from './previewers'
import type { TaskEntry } from './products'
import { fileUrl, previewKind } from './stacks'
import { BTN, BTN_GHOST, Mi, ProductAvatar, shortWhen, typeLabel, when } from './ui'
import { plainBlock } from '@shared/artifacts'

export function TaskPage({ ws, entry: t, running, onOpen }: { ws: Workspace; entry: TaskEntry; running: boolean; onOpen: (id: string) => void }): React.JSX.Element {
  const setTab = useUi((s) => s.setTab)
  const show = useAgents((s) => s.show)
  const run = t.status === 'open'
  const n = t.artifacts.length
  const lastFail = t.failures.at(-1)
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1060px] px-[26px] pt-[22px] pb-10">
        <div className="flex items-start gap-2.5 pr-8">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[19px] font-semibold">{t.title}</h2>
            <div className="mt-[7px] flex flex-wrap items-center gap-[7px] text-[12px] text-muted">
              <ProductAvatar name={t.agentName} />
              <span>{t.agentName}</span>
              <span>·</span>
              {run ? (
                <span className="text-work">● Đang làm · từ {shortWhen(t.when)}</span>
              ) : (
                <span>
                  {t.status === 'dropped' ? 'Đã bỏ' : 'Xong'} {when(t.when)}
                </span>
              )}
            </div>
          </div>
          <button type="button" className={BTN_GHOST} onClick={() => setTab('kanban')}>
            Mở trên Kanban
          </button>
          <button
            type="button"
            className={BTN}
            onClick={() => {
              setTab('agents')
              show(ws.id, t.agentId)
            }}
          >
            Mở ô {t.agentName}
          </button>
        </div>
        {(t.summary || run) && (
          <div className="mt-3 rounded-r-md border border-l-2 border-line border-l-line-3 bg-panel px-3 py-2.5 leading-[1.55] text-muted select-text">
            <b className="font-semibold text-fg">{run ? 'Đang làm:' : 'Bàn giao:'}</b> {t.summary || (running ? 'agent chưa bàn giao.' : 'phiên của agent đang đóng.')}
          </div>
        )}
        {lastFail && (
          <div className="mt-2.5 flex items-center gap-2 rounded-[7px] border border-line bg-panel px-3 py-2 text-[12.5px] text-muted">
            <Mi name="warn" className="text-danger" />
            <span className="min-w-0">
              {t.failures.length > 1 ? `${t.failures.length} lần nộp không thành, gần nhất` : '1 lần nộp không thành'} lúc {shortWhen(lastFail.at)}:{' '}
              <span className="font-mono text-[11.5px]">{lastFail.file || '(không có file)'}</span> —{' '}
              <span title={lastFail.error}>{failureReason(lastFail.error)}</span>. Agent đã nhận báo lỗi.
            </span>
          </div>
        )}
        {n ? (
          <>
            <div className="flex items-baseline gap-2 pt-[22px] text-[11px] font-semibold tracking-[0.07em] text-dim">
              SẢN PHẨM <span className="font-mono tracking-normal">{n}</span>
            </div>
            <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">
              {t.artifacts.map((a) => (
                <Card key={a.id} ws={ws} a={a} onOpen={() => onOpen(a.id)} />
              ))}
            </div>
          </>
        ) : run ? (
          <>
            <div className="pt-[22px] text-[11px] font-semibold tracking-[0.07em] text-dim">SẢN PHẨM</div>
            <div className="mt-2.5 flex items-center gap-3.5 rounded-[10px] border border-dashed border-line-2 p-[22px] leading-relaxed text-dim">
              <div className="flex w-[150px] shrink-0 flex-col gap-[7px]">
                {[100, 70, 85].map((w) => (
                  <i key={w} className="block h-2 animate-pulse rounded bg-panel-3" style={{ width: `${w}%` }} />
                ))}
              </div>
              <div>
                <b className="font-semibold text-fg">{t.agentName} đang làm, chưa nộp gì.</b>
                <br />
                Sản phẩm sẽ hiện ở đây ngay khi agent nộp, kèm báo ở “Cần bạn xem”.
              </div>
            </div>
          </>
        ) : (
          <div className="mx-auto mt-16 max-w-[420px] text-center leading-relaxed text-dim">
            <b className="mb-1.5 block text-[14px] text-fg">Việc này không có sản phẩm</b>
            Agent chỉ sửa code. Những file đó xem ở Kanban → thẻ việc.
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ ws, a, onOpen }: { ws: Workspace; a: ArtifactRecord; onOpen: () => void }): React.JSX.Element {
  const v = latestVersion(a)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    let alive = true
    window.stag.artifacts.stat(ws.id, [a.rel]).then((r) => alive && setGone(r[a.rel] === null))
    return () => {
      alive = false
    }
  }, [ws.id, a.rel, a.updatedAt])
  const you = a.comments.filter(needsYou).length
  const drafts = a.comments.filter((c) => c.state === 'draft').length
  const waiting = a.comments.filter((c) => c.state === 'sent' || c.state === 'queued').length
  const fresh = unseenVersions(a) > 0
  const kind = previewKind(a.rel)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex flex-col overflow-hidden rounded-[10px] border bg-panel text-left transition-colors hover:border-line-3 ${gone ? 'border-dashed border-line-2' : 'border-line'}`}
    >
      <div className="relative h-[148px] overflow-hidden border-b border-line bg-panel-2">
        <Thumb ws={ws} a={a} />
        <span className="absolute top-2 left-2 rounded-full border border-line-2 bg-chip px-[7px] py-0.5 text-[10.5px] font-semibold text-muted">{typeLabel(kind)}</span>
        {fresh ? (
          <span className="absolute top-2 right-2 rounded-full border border-accent/45 bg-chip px-[7px] py-0.5 text-[10.5px] font-semibold text-accent">Mới · v{v.v}</span>
        ) : a.versions.length > 1 ? (
          <span className="absolute top-2 right-2 rounded-full border border-line-2 bg-chip px-[7px] py-0.5 font-mono text-[10.5px] font-semibold text-fg">v{v.v}</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-[5px] px-[13px] pt-[11px] pb-3">
        <div className="text-[13.5px] font-semibold">{a.title}</div>
        {a.description && <div className="line-clamp-2 text-[12.5px] leading-normal text-muted">{a.description}</div>}
        <div className="mt-auto flex items-center gap-[9px] pt-1.5 text-[11.5px] whitespace-nowrap text-dim">
          {gone ? <span className="text-danger">File gốc đã bị xoá</span> : <span className="min-w-0 truncate font-mono">{a.rel.split('/').pop()}</span>}
          <span className="flex-1" />
          {you > 0 && <span className="text-wait">● {you} cần bạn</span>}
          {drafts > 0 && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Mi name="pen" />
              {drafts} nháp
            </span>
          )}
          {!you && !drafts && waiting > 0 && (
            <span className="inline-flex items-center gap-1">
              <Mi name="clock" />
              {waiting} chờ agent
            </span>
          )}
          {!you && !drafts && !waiting && a.comments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Mi name="cmt" />
              {a.comments.length}
            </span>
          )}
          <span>{shortWhen(v.at)}</span>
        </div>
      </div>
    </button>
  )
}

/** Ảnh thu nhỏ của bản mới nhất (đọc bản chụp, nên file gốc bị xoá vẫn hiện). */
function Thumb({ ws, a }: { ws: Workspace; a: ArtifactRecord }): React.JSX.Element {
  const v = latestVersion(a)
  const rel = v.snapshot
  const kind = previewKind(rel)
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [data, setData] = useState<{ img?: string; lines?: string[]; rows?: string[][]; html?: string } | null>(null)
  const pptHost = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible) return
    let alive = true
    const set = (d: typeof data): void => {
      if (alive) setData(d)
    }
    if (v.blocks)
      window.stag.products.blocks(ws.id, a.id, v.v).then((b: DocBlock[]) => set({ lines: b.slice(0, 8).map((x) => plainBlock(x.text)) }))
    else if (kind === 'pdf') void pdfThumb(ws, rel, v.sha256).then((img) => set(img ? { img } : {}))
    else if (kind === 'docx')
      void window.stag.artifacts
        .thumb(ws.id, rel)
        .then(async (img) => set(img ? { img } : { lines: (await docxSnippet(ws, rel).catch(() => null)) ?? [] }))
    else if (kind === 'sheet') void sheetSnippet(ws, rel).then((rows) => set({ rows: rows ?? [] }), () => set({}))
    else if (kind === 'html')
      void window.stag.artifacts.text(ws.id, rel).then(async (t) => set(t.status === 'ok' ? { html: await staticHtml(ws, rel, t.text, a.rel) } : {}))
    else if (kind === 'pptx') {
      const host = pptHost.current
      if (host) void pptxThumbInto(ws, rel, host).catch(() => null)
    } else if (kind === 'other' || kind === 'zip' || kind === 'font') void window.stag.artifacts.thumb(ws.id, rel).then((img) => set(img ? { img } : {}))
    return () => {
      alive = false
    }
  }, [visible, ws, a.id, a.rel, rel, v.v, v.blocks, v.sha256, kind])

  let inner: React.ReactNode = null
  if (kind === 'image') inner = <img src={fileUrl(ws.id, rel, v.sha256)} draggable={false} className="h-full w-full object-cover" />
  else if (kind === 'video') inner = <video src={`${fileUrl(ws.id, rel, v.sha256)}#t=0.5`} preload="metadata" muted className="h-full w-full bg-black object-cover" />
  else if (kind === 'pptx') inner = <div ref={pptHost} className="h-full w-full" />
  else if (data?.img) inner = <img src={data.img} draggable={false} className="h-full w-full object-cover object-top" />
  else if (data?.html != null)
    inner = (
      <iframe sandbox="" srcDoc={data.html} tabIndex={-1} title="" className="pointer-events-none h-[592px] w-[1200px] origin-top-left scale-[0.25] border-0 bg-white" />
    )
  else if (data?.rows)
    inner = (
      <div className="p-3">
        <table className="w-full border-collapse font-mono text-[10px]">
          <tbody>
            {data.rows.slice(0, 6).map((r, i) => (
              <tr key={i}>
                {r.slice(0, 4).map((c, j) => (
                  <td key={j} className={`max-w-[80px] truncate border border-line px-1.5 py-0.5 ${i ? 'text-muted' : 'bg-panel-3 text-fg'}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  else if (data?.lines)
    inner = (
      <div className="absolute inset-x-[22px] top-[14px] -bottom-2.5 overflow-hidden rounded-t-md border border-line-2 bg-panel-2 px-3.5 py-3 text-[8.5px] leading-normal text-muted">
        {data.lines.map((l, i) =>
          i === 0 ? (
            <h4 key={i} className="mb-1.5 truncate text-[11px] font-semibold text-fg">
              {l}
            </h4>
          ) : (
            <p key={i} className="mb-[3px] line-clamp-2">
              {l}
            </p>
          )
        )}
      </div>
    )
  else if (data) inner = <div className="grid h-full place-items-center font-mono text-[22px] font-semibold text-dim">{(a.rel.split('.').pop() ?? '').toUpperCase()}</div>
  return (
    <div ref={ref} className="absolute inset-0">
      {inner}
    </div>
  )
}
