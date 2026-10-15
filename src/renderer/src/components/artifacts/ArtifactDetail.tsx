// Màn chi tiết một sản phẩm: xem từng bản (bản chụp lúc nộp), so sánh hai bản, góp ý theo mạch ở cột phải.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  blockDiff,
  diffStats,
  formatTime,
  isMarkdownFile,
  latestVersion,
  needsYou,
  type ArtifactComment,
  type ArtifactRecord,
  type ArtifactVersion,
  type CommentAnchor,
  type DocBlock
} from '@shared/artifacts'
import type { Workspace } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useUi } from '../../store/ui'
import { t, tx, useT } from '../../i18n'
import { CodeView } from './CodeView'
import { anchorMode, DocView, renderBlock, type DocMark, type RenderedBlock } from './DocView'
import { cleanError, DocxView, FontView, HtmlView, Note, OtherView, PdfView, PptxView, SheetView, ZipView, type PinMark } from './previewers'
import type { TaskEntry } from './products'
import { fileUrl, previewKind } from './stacks'
import { BTN, BTN_GHOST, BTN_PRI, Mi, ProductAvatar, Switch, typeLabel, when } from './ui'

/** Agent nhận góp ý: rảnh (gửi ngay) / đang làm (chờ hết lượt) / phiên đóng (chờ phiên mới). */
export type Delivery = 'idle' | 'busy' | 'closed'

const deliveryLine = (d: Delivery, agent: string): string =>
  d === 'idle' ? t('artifacts.delivery.idle', { agent }) : d === 'busy' ? t('artifacts.delivery.busy', { agent }) : t('artifacts.delivery.closed', { agent })
const queuedLine = (d: Delivery): string => (d === 'idle' ? t('artifacts.queued.idle') : d === 'busy' ? t('artifacts.queued.busy') : t('artifacts.queued.closed'))
const sentToast = (d: Delivery, agent: string, n = 1): string =>
  d === 'idle'
    ? n > 1
      ? t('artifacts.sent.idleMany', { count: n, agent })
      : t('artifacts.sent.idle', { agent })
    : d === 'busy'
      ? n > 1
        ? t('artifacts.sent.busyMany', { count: n, agent })
        : t('artifacts.sent.busy', { agent })
      : n > 1
        ? t('artifacts.sent.closedMany', { count: n, agent })
        : t('artifacts.sent.closed', { agent })

const tone = (c: ArtifactComment): string => (c.state === 'draft' ? 'draft' : c.state === 'you' ? 'you' : c.state === 'fixed' ? 'fixed' : c.state === 'closed' ? 'closed' : 'open')

/** Chữ trả lời viết dở theo mạch (giữ khi chuyển sang góp ý khác / rời sản phẩm, trong phiên chạy app). */
const replyDrafts = new Map<string, string>()

const blockCache = new Map<string, Promise<DocBlock[]>>()
function useBlocks(ws: Workspace, id: string, v: ArtifactVersion | undefined): DocBlock[] | null {
  const [b, setB] = useState<DocBlock[] | null>(null)
  const key = v?.blocks ? `${ws.id}:${id}:${v.v}:${v.sha256}` : ''
  useEffect(() => {
    if (!key || !v) {
      setB(null)
      return
    }
    let alive = true
    let p = blockCache.get(key)
    if (!p) {
      p = window.stag.products.blocks(ws.id, id, v.v)
      blockCache.set(key, p)
    }
    p.then((x) => alive && setB(x)).catch(() => alive && setB([]))
    return () => {
      alive = false
    }
  }, [key, ws.id, id, v])
  return b
}

interface Compose {
  anchor: CommentAnchor
  text: string
  /** Phiên bản đang xem lúc bắt đầu viết (neo tính theo bản này, kể cả khi lưu nháp sau khi đã đổi bản / rời trang). */
  v: number
  /** Đang sửa nháp này (Huỷ / Esc = giữ nguyên nháp cũ). */
  edit?: string
}

interface Reply {
  cid: string
  mode: 'reply' | 'again' | 'reopen'
}

export function ArtifactDetail({
  ws,
  art: a,
  entry,
  focus,
  focusNonce,
  delivery,
  toast,
  onBack
}: {
  ws: Workspace
  art: ArtifactRecord
  entry: TaskEntry
  focus: string | null
  focusNonce: number
  delivery: Delivery
  toast: (t: string) => void
  onBack: () => void
}): React.JSX.Element {
  useT()
  const latest = latestVersion(a)
  const kind = previewKind(a.rel)
  const isImage = kind === 'image'
  // Bản người dùng đã xem trước khi mở lần này (để so sánh bản mới với nó).
  const [prevSeen] = useState(a.seen)
  const [ver, setVer] = useState(latest.v)
  const cur = a.versions.find((v) => v.v === ver) ?? latest
  const canDiff = a.versions.length > 1 && ver > a.versions[0].v && (isImage || !!cur.blocks)
  const autoDiff = !focus && prevSeen > 0 && prevSeen < latest.v && (isImage || !!latest.blocks)
  const [diff, setDiff] = useState(autoDiff)
  const [cmp, setCmp] = useState<number>(autoDiff ? prevSeen : Math.max(1, latest.v - 1))
  const comparing = diff && canDiff && cmp < ver
  const [rtab, setRtab] = useState<'cmt' | 'hist' | 'info'>('cmt')
  const [hot, setHot] = useState<string | null>(focus)
  const [compose, setCompose] = useState<Compose | null>(null)
  const [reply, setReply] = useState<Reply | null>(null)
  const [pinning, setPinning] = useState(false)
  const [openClosed, setOpenClosed] = useState(false)
  const [gone, setGone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hintOff, setHintOff] = useState(autoDiff)
  const scroll = useRef<HTMLDivElement>(null)
  const changeIdx = useRef(-1)
  const setTab = useUi((s) => s.setTab)
  const show = useAgents((s) => s.show)

  // Đã xem bản mới nhất.
  useEffect(() => {
    if (a.seen < latest.v && ver === latest.v) void window.stag.products.seen(ws.id, a.id).catch(() => {})
  }, [ws.id, a.id, a.seen, latest.v, ver])

  useEffect(() => {
    let alive = true
    window.stag.artifacts.stat(ws.id, [a.rel]).then((r) => alive && setGone(r[a.rel] === null))
    return () => {
      alive = false
    }
  }, [ws.id, a.rel, latest.v])

  // ---------- tài liệu ----------
  const markdown = isMarkdownFile(a.rel)
  const blocks = useBlocks(ws, a.id, cur.blocks ? cur : undefined)
  const oldV = a.versions.find((v) => v.v === cmp)
  const oldBlocks = useBlocks(ws, a.id, comparing && oldV?.blocks ? oldV : undefined)
  const rendered = useMemo(() => {
    const m = new Map<string, RenderedBlock>()
    for (const b of blocks ?? []) m.set(b.id, renderBlock(b, markdown, a.rel))
    return m
  }, [blocks, markdown, a.rel])

  const comments = a.comments
  const C = (id: string): ArtifactComment | undefined => comments.find((c) => c.id === id)

  const marks: DocMark[] = useMemo(() => {
    const out: DocMark[] = []
    for (const c of comments)
      if (c.anchor.type === 'text' && c.v <= ver && (c.state !== 'closed' || hot === c.id) && rendered.has(c.anchor.block))
        out.push({ id: c.id, block: c.anchor.block, off: c.anchor.off, quote: c.anchor.quote, tone: tone(c), hot: hot === c.id })
    if (compose?.anchor.type === 'text' && !compose.edit) out.push({ id: '__new', ...compose.anchor, tone: 'draft', hot: false })
    return out
  }, [comments, ver, hot, rendered, compose])

  // ---------- điều hướng góp ý ----------
  const focusComment = useCallback(
    (cid: string) => {
      const c = comments.find((x) => x.id === cid)
      if (!c) return
      if (c.anchor.type !== 'general') setDiff(false)
      if (c.anchor.type === 'text' && c.v > ver) setVer(c.v)
      if (c.state === 'closed') setOpenClosed(true)
      setHot(cid)
      setRtab('cmt')
      setPinning(false)
      setScrollReq((r) => ({ cid, n: (r?.n ?? 0) + 1 }))
    },
    [comments, ver]
  )
  // Cuộn tới chỗ neo sau khi vẽ xong (ghim PDF được vẽ lại khi đổi góp ý đang chọn; trang PDF có thể chưa dựng xong).
  const [scrollReq, setScrollReq] = useState<{ cid: string; n: number } | null>(null)
  useEffect(() => {
    if (!scrollReq) return
    const { cid } = scrollReq
    let tries = 0
    const t = setInterval(() => {
      const el = scroll.current?.querySelector<HTMLElement>(`[data-c="${cid}"], [data-pin="${cid}"]`)
      if (!el && ++tries < 25) return
      clearInterval(t)
      el?.scrollIntoView({ block: 'center', behavior: el.dataset.pin ? 'auto' : 'smooth' })
      document.querySelector(`[data-cid="${cid}"]`)?.scrollIntoView({ block: 'nearest' })
    }, 80)
    return () => clearInterval(t)
  }, [scrollReq])
  useEffect(() => {
    if (focus) focusComment(focus)
    // Mỗi lần bấm mở (kể cả bấm lại cùng sản phẩm) — không theo `comments` đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce])

  // ---------- soạn góp ý ----------
  const live = useRef({ compose, drafts: 0 })
  live.current = { compose, drafts: comments.filter((c) => c.state === 'draft').length }

  /** Góp ý đang viết dở có chữ → lưu thành nháp (không làm mất). */
  const stash = useCallback(async (): Promise<boolean> => {
    const k = live.current.compose
    if (!k || k.edit || !k.text.trim()) return false
    await window.stag.products.comment(ws.id, a.id, { v: k.v, anchor: k.anchor, text: k.text, send: false })
    return true
  }, [ws.id, a.id])

  // Rời sản phẩm: giữ chữ đang viết dở, nhắc nháp chưa gửi. StrictMode (npm run dev) gỡ rồi gắn lại ngay lúc mở:
  // chỉ coi là rời khi sau một nhịp vẫn chưa gắn lại.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (mounted.current) return
        const { compose: k, drafts } = live.current
        if (k && !k.edit && k.text.trim()) {
          void window.stag.products.comment(ws.id, a.id, { v: k.v, anchor: k.anchor, text: k.text, send: false }).catch(() => {})
          toast(t('artifacts.toast.stashedIn', { title: a.title }))
        } else if (drafts) toast(t('artifacts.toast.draftsLeft', { count: drafts, title: a.title }))
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startCompose = async (anchor: CommentAnchor, text = '', edit?: string): Promise<void> => {
    if (await stash().catch(() => false)) toast(t('artifacts.toast.stashed'))
    setReply(null)
    setPinning(false)
    setRtab('cmt')
    setCompose({ anchor, text, edit, v: ver })
  }

  const act = async (fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast(ok)
      return true
    } catch (e) {
      toast(cleanError(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const drafts = comments.filter((c) => c.state === 'draft')
  const submit = async (send: boolean): Promise<void> => {
    const k = compose
    if (!k || !k.text.trim()) return
    if (k.edit) {
      if (await act(() => window.stag.products.editDraft(ws.id, k.edit!, k.text), t('artifacts.toast.draftEdited'))) setCompose(null)
      return
    }
    const done = await act(
      () => window.stag.products.comment(ws.id, a.id, { v: k.v, anchor: k.anchor, text: k.text, send }),
      send ? sentToast(delivery, a.agentName) : t('artifacts.toast.draftSaved')
    )
    if (done) setCompose(null)
  }

  const sendReply = async (): Promise<void> => {
    if (!reply) return
    const key = `${ws.id}:${reply.cid}`
    const text = (replyDrafts.get(key) ?? '').trim()
    if (!text) return
    if (await act(() => window.stag.products.say(ws.id, reply.cid, text), sentToast(delivery, a.agentName))) {
      replyDrafts.delete(key)
      setHot(reply.cid)
      setReply(null)
    }
  }

  // ---------- phím ----------
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable) return
      // Hộp thoại đang mở đè lên (hỏi khoá phạm vi, agent xin việc…): Esc là của nó.
      if (e.key !== 'Escape' || e.defaultPrevented || useUi.getState().modals > 0) return
      if (pinning) setPinning(false)
      else if (!compose && !reply) onBack()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [pinning, compose, reply, onBack])

  // ---------- phiên bản ----------
  const pickVer = (v: number): void => {
    setVer(v)
    changeIdx.current = -1
    if (cmp >= v) setCmp(Math.max(a.versions[0].v, v - 1))
    if (v === a.versions[0].v) setDiff(false)
  }
  const diffRows = useMemo(() => (comparing && blocks && oldBlocks ? blockDiff(oldBlocks, blocks) : null), [comparing, blocks, oldBlocks])
  const stats = diffRows ? diffStats(diffRows) : null
  const nextChange = (): void => {
    const els = [...(scroll.current?.querySelectorAll<HTMLElement>('[data-chg]') ?? [])]
    if (!els.length) return
    changeIdx.current = (changeIdx.current + 1) % els.length
    const el = els[changeIdx.current]
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.animate([{ backgroundColor: 'rgba(106,169,255,.22)' }, { backgroundColor: 'rgba(106,169,255,.22)', offset: 0.4 }, {}], 1100)
  }
  const newSince = latest.v > a.seen && ver < latest.v
  const showHint = !comparing && !hintOff && ver === latest.v && prevSeen > 0 && prevSeen < latest.v && (isImage || !!latest.blocks)

  // ---------- nội dung ----------
  const rel = cur.snapshot
  const vkey = cur.sha256
  const pins: PinMark[] = comments
    .filter((c) => c.anchor.type === 'pin' && (c.state !== 'closed' || hot === c.id))
    .map((c) => ({ id: c.id, label: String(c.no), page: c.anchor.type === 'pin' ? c.anchor.page : undefined, x: c.anchor.type === 'pin' ? c.anchor.x : 0, y: c.anchor.type === 'pin' ? c.anchor.y : 0, tone: tone(c), hot: hot === c.id }))
  if (compose?.anchor.type === 'pin' && !compose.edit) pins.push({ id: '__new', label: '+', page: compose.anchor.page, x: compose.anchor.x, y: compose.anchor.y, tone: 'draft' })
  const pickPin = (p: { page?: number; x: number; y: number }): void => void startCompose({ type: 'pin', x: p.x, y: p.y, ...(p.page ? { page: p.page } : {}) })

  const runInBrowser = (): void => {
    const abs = `${ws.path.replace(/\\/g, '/').replace(/\/+$/, '')}/${gone ? rel : a.rel}`
    const url = `file:///${abs.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')}`
    void act(() => window.stag.browser.newTab(ws.id, url).then(() => useUi.getState().setBrowserOpen(true)))
  }

  let view: React.ReactNode
  if (cur.blocks) {
    view = blocks ? (
      <DocView
        rel={a.rel}
        markdown={markdown}
        blocks={blocks}
        rendered={rendered}
        oldBlocks={comparing ? oldBlocks : null}
        marks={marks}
        onMark={focusComment}
        onComment={(an) => void startCompose({ type: 'text', ...an })}
        onDiffSelect={() => toast(t('artifacts.toast.diffSelect'))}
      />
    ) : (
      <Note>{t('artifacts.opening')}</Note>
    )
  } else if (isImage && comparing) {
    const old = a.versions.find((v) => v.v === cmp)!
    view = (
      <div className="mx-auto my-[22px] grid max-w-[1100px] grid-cols-2 gap-3 px-[18px]">
        {[old, cur].map((v) => (
          <div key={v.v}>
            <div className="mb-1.5 ml-0.5 font-mono text-[11.5px] text-dim">
              v{v.v} · {when(v.at)}
            </div>
            <div className="overflow-hidden rounded-[10px] border border-line bg-[repeating-conic-gradient(#14171b_0_25%,#101215_0_50%)] bg-[length:16px_16px]">
              <img src={fileUrl(ws.id, v.snapshot, v.sha256)} draggable={false} className="block w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  } else if (isImage) {
    view = <PinImage src={fileUrl(ws.id, rel, vkey)} pins={pins} picking={pinning} onPick={pickPin} onPin={focusComment} />
  } else if (kind === 'pdf') {
    view = <PdfView ws={ws} rel={rel} version={vkey} pins={pins} picking={pinning} onPick={pickPin} onPin={focusComment} />
  } else if (kind === 'video' || kind === 'audio') {
    view = (
      <Player
        kind={kind}
        src={fileUrl(ws.id, rel, vkey)}
        comments={comments.filter((c) => c.anchor.type === 'time' && (c.state !== 'closed' || hot === c.id))}
        draft={compose?.anchor.type === 'time' && !compose.edit ? compose.anchor.t : null}
        hot={hot}
        onMark={focusComment}
        onComment={(t) => void startCompose({ type: 'time', t })}
      />
    )
  } else if (kind === 'sheet') {
    const cells: Record<string, string> = {}
    for (const c of comments)
      if (c.anchor.type === 'cell' && (c.state !== 'closed' || hot === c.id)) cells[`${c.anchor.sheet ?? ''}!${c.anchor.cell}`] = `${tone(c)}${hot === c.id ? ' hot' : ''}`
    if (compose?.anchor.type === 'cell') cells[`${compose.anchor.sheet ?? ''}!${compose.anchor.cell}`] = 'draft'
    view = (
      <SheetView
        ws={ws}
        rel={rel}
        version={vkey}
        cells={cells}
        onCell={(x) => {
          // CSV / TSV chỉ có một sheet (tên "Sheet1" do SheetJS đặt): không ghi tên sheet.
          const sheet = /\.(csv|tsv)$/i.test(a.rel) ? '' : x.sheet
          const hit = comments.find((c) => c.anchor.type === 'cell' && c.anchor.cell === x.cell && (!sheet || !c.anchor.sheet || c.anchor.sheet === sheet) && c.state !== 'closed')
          if (hit) focusComment(hit.id)
          else void startCompose({ type: 'cell', cell: x.cell, ...(sheet ? { sheet } : {}), value: x.value })
        }}
      />
    )
  } else if (kind === 'html') view = <HtmlView ws={ws} rel={rel} version={vkey} baseRel={a.rel} onRun={runInBrowser} />
  else if (kind === 'docx') view = <DocxView ws={ws} rel={rel} version={vkey} />
  else if (kind === 'pptx') view = <PptxView ws={ws} rel={rel} version={vkey} />
  else if (kind === 'zip') view = <ZipView ws={ws} rel={rel} version={vkey} />
  else if (kind === 'font') view = <FontView ws={ws} rel={rel} version={vkey} />
  else if (kind === 'text' || kind === 'markdown') view = <TextFallback ws={ws} rel={rel} vkey={vkey} />
  else view = <OtherView ws={ws} rel={rel} version={vkey} />

  const pinnable = (isImage && !comparing) || kind === 'pdf'
  const fullHeight = ['pdf', 'sheet', 'html', 'docx', 'pptx'].includes(kind) && !cur.blocks

  // ---------- cột góp ý ----------
  const you = comments.filter(needsYou)
  const waiting = comments.filter((c) => c.state === 'queued' || c.state === 'sent')
  const closed = comments.filter((c) => c.state === 'closed')
  const byNew = (x: ArtifactComment, y: ArtifactComment): number => y.updatedAt.localeCompare(x.updatedAt)

  const anchorNote = (c: ArtifactComment): React.ReactNode => {
    if (c.v > ver)
      return (
        <div className="mt-1.5 text-[11.5px] text-dim">
          {t('artifacts.anchor.onVersion', { v: c.v })} ·{' '}
          <button type="button" className="text-info" onClick={() => (pickVer(c.v), focusComment(c.id))}>
            {t('artifacts.view')}
          </button>
        </div>
      )
    if (c.anchor.type !== 'text' || !blocks) return null
    const m = anchorMode(rendered, c.anchor)
    if (m === 'gone')
      return (
        <div className="mt-1.5 text-[11.5px] text-dim">
          {t('artifacts.anchor.gone', { v: ver })} ·{' '}
          <button
            type="button"
            className="text-info"
            onClick={() => {
              pickVer(c.v)
              setDiff(false)
              focusComment(c.id)
            }}
          >
            {t('artifacts.anchor.viewIn', { v: c.v })}
          </button>
        </div>
      )
    if (m === 'fuzzy' || m === 'whole') return <div className="mt-1.5 text-[11.5px] text-dim">{t('artifacts.anchor.fuzzy', { v: ver })}</div>
    return null
  }

  const card = (c: ArtifactComment): React.JSX.Element => {
    const isEditing = compose?.edit === c.id
    const isReplying = reply?.cid === c.id
    const border =
      c.state === 'you' ? 'border-l-2 border-l-wait' : c.state === 'fixed' ? 'border-l-2 border-l-work' : c.state === 'draft' ? 'border-l-2 border-l-accent bg-[color-mix(in_srgb,var(--color-accent)_4%,var(--color-panel))]' : ''
    let status: React.ReactNode = null
    if (c.state === 'draft')
      status = (
        <Stt cls="text-accent" icon="pen" text={t('artifacts.status.draft')}>
          <button type="button" className={BTN_GHOST} onClick={() => void startCompose(c.anchor, c.thread[0]?.text ?? '', c.id)}>
            {t('common.edit')}
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => void act(() => window.stag.products.deleteDraft(ws.id, c.id), t('artifacts.toast.draftDeleted'))}>
            {t('common.delete')}
          </button>
        </Stt>
      )
    else if (c.state === 'queued')
      status = (
        <Stt icon="clock" text={t('artifacts.status.queued', { when: queuedLine(delivery) })}>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() =>
              void act(async () => {
                const r = await window.stag.products.unsend(ws.id, c.id)
                if (r.draft) toast(t('artifacts.toast.unsentDraft'))
                else {
                  replyDrafts.set(`${ws.id}:${c.id}`, r.text)
                  setCompose(null)
                  setReply({ cid: c.id, mode: 'reply' })
                  toast(t('artifacts.toast.unsentReply'))
                }
              })
            }
          >
            {t('artifacts.unsend')}
          </button>
        </Stt>
      )
    else if (c.state === 'sent') status = <Stt icon="clock" text={t('artifacts.status.sent', { agent: a.agentName })} />
    else if (c.state === 'fixed')
      status = (
        <Stt cls="text-work" icon="check" text={t('artifacts.status.fixed', { agent: a.agentName, v: c.fixedIn ?? '' })}>
          {c.fixedIn !== ver && c.fixedIn != null && (
            <button type="button" className="text-[11.5px] text-info" onClick={() => pickVer(c.fixedIn!)}>
              {t('artifacts.viewVersion', { v: c.fixedIn })}
            </button>
          )}
        </Stt>
      )
    else if (c.state === 'you') status = <Stt cls="text-wait" text={t('artifacts.status.you', { agent: a.agentName })} />
    else if (c.state === 'closed')
      status = (
        <Stt text={c.fixedIn ? t('artifacts.status.closedFixed', { v: c.fixedIn }) : t('artifacts.status.closed')}>
          <button type="button" className={BTN_GHOST} onClick={() => openReply(c.id, 'reopen')}>
            {t('artifacts.reopen')}
          </button>
        </Stt>
      )
    const lastAgent = [...c.thread].reverse().find((m) => m.by === 'agent')
    const acts =
      isReplying || isEditing ? null : c.state === 'fixed' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className={BTN_PRI} disabled={busy} onClick={() => void act(() => window.stag.products.close(ws.id, c.id).then(() => replyDrafts.delete(`${ws.id}:${c.id}`)), t('artifacts.toast.closed'))}>
            {t('artifacts.okClose')}
          </button>
          <button type="button" className={BTN} onClick={() => openReply(c.id, 'again')}>
            {t('artifacts.notOk')}
          </button>
        </div>
      ) : c.state === 'you' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(lastAgent?.options ?? []).map((o, k) => (
            <button key={o} type="button" disabled={busy} className={k ? BTN : BTN_PRI} onClick={() => void act(() => window.stag.products.say(ws.id, c.id, o), sentToast(delivery, a.agentName))}>
              {o}
            </button>
          ))}
          <button type="button" className={lastAgent?.options?.length ? BTN_GHOST : BTN_PRI} onClick={() => openReply(c.id, 'reply')}>
            {t('artifacts.reply')}
          </button>
          <button type="button" className={BTN_GHOST} onClick={() => void act(() => window.stag.products.close(ws.id, c.id).then(() => replyDrafts.delete(`${ws.id}:${c.id}`)), t('artifacts.toast.closed'))}>
            {t('common.close')}
          </button>
        </div>
      ) : null
    return (
      <div
        key={c.id}
        data-cid={c.id}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, textarea, a')) return
          focusComment(c.id)
        }}
        className={`mb-2 cursor-pointer rounded-[9px] border bg-panel px-[11px] py-2.5 ${hot === c.id ? 'border-fg/35' : 'border-line hover:border-line-3'} ${border} ${c.v > ver ? 'opacity-70' : ''}`}
      >
        <AnchorQuote c={c} kind={kind} />
        {isEditing && compose ? (
          <Composer
            value={compose.text}
            onChange={(text) => setCompose({ ...compose, text })}
            placeholder={t('artifacts.edit.placeholder')}
            hint={t('artifacts.edit.hint')}
            onCancel={() => setCompose(null)}
            onSubmit={() => void submit(false)}
            buttons={
              <>
                <button type="button" className={BTN_GHOST} onClick={() => setCompose(null)}>
                  {t('common.cancel')}
                </button>
                <span className="flex-1" />
                <button type="button" className={BTN_PRI} disabled={busy || !compose.text.trim()} onClick={() => void submit(false)}>
                  {t('common.save')}
                </button>
              </>
            }
          />
        ) : (
          <Thread c={c} agent={a.agentName} />
        )}
        {anchorNote(c)}
        {!isEditing && status}
        {acts}
        {isReplying && reply && (
          <div className="mt-2.5">
            <div className="mb-1.5 text-[11.5px] text-dim">{reply.mode === 'again' ? t('artifacts.reply.again') : reply.mode === 'reopen' ? t('artifacts.reply.reopen') : t('artifacts.reply.to', { agent: a.agentName })}</div>
            <ReplyBox
              k={`${ws.id}:${c.id}`}
              placeholder={reply.mode === 'reply' ? t('artifacts.reply.placeholder', { agent: a.agentName }) : t('artifacts.reply.againPlaceholder')}
              busy={busy}
              onCancel={() => setReply(null)}
              onSend={() => void sendReply()}
            />
          </div>
        )}
      </div>
    )
  }

  const openReply = (cid: string, mode: Reply['mode']): void => {
    void stash().then((saved) => saved && toast(t('artifacts.toast.stashed')))
    setCompose(null)
    setReply({ cid, mode })
    setHot(cid)
  }

  const composerTop = compose && !compose.edit && (
    <div className="mb-2.5 rounded-[9px] border border-accent bg-panel-2 p-2.5">
      <AnchorQuote anchor={compose.anchor} kind={kind} label={compose.anchor.type === 'pin' ? '+' : undefined} accent />
      <Composer
        value={compose.text}
        onChange={(text) => setCompose({ ...compose, text })}
        placeholder={t('artifacts.compose.placeholder')}
        hint={drafts.length ? t('artifacts.compose.hintDrafts') : t('artifacts.compose.hint')}
        onCancel={() => {
          if (compose.text.trim()) void submit(false)
          else setCompose(null)
        }}
        onSubmit={() => void submit(!drafts.length)}
        buttons={
          <>
            <button type="button" className={BTN_GHOST} onClick={() => setCompose(null)}>
              {t('common.cancel')}
            </button>
            <span className="flex-1" />
            <button type="button" className={BTN} disabled={busy || !compose.text.trim()} onClick={() => void submit(false)}>
              {t('artifacts.saveDraft')}
            </button>
            <button type="button" className={BTN_PRI} disabled={busy || !compose.text.trim()} onClick={() => void submit(true)}>
              {t('common.send')}
            </button>
          </>
        }
      />
    </div>
  )

  const emptyHint: Record<string, string> = {
    doc: t('artifacts.emptyHint.doc'),
    image: t('artifacts.emptyHint.image'),
    pdf: t('artifacts.emptyHint.pdf'),
    sheet: t('artifacts.emptyHint.sheet'),
    video: t('artifacts.emptyHint.media'),
    audio: t('artifacts.emptyHint.media')
  }
  const cmtTab = (
    <>
      {composerTop}
      {you.length > 0 && <Sub cls="text-wait">{t('artifacts.sec.you', { count: you.length })}</Sub>}
      {[...you].sort(byNew).map(card)}
      {drafts.length > 0 && <Sub cls="text-accent">{t('artifacts.sec.drafts', { count: drafts.length })}</Sub>}
      {drafts.map(card)}
      {waiting.length > 0 && <Sub>{t('artifacts.sec.waiting', { count: waiting.length })}</Sub>}
      {[...waiting].sort(byNew).map(card)}
      {closed.length > 0 && (
        <>
          <button type="button" onClick={() => setOpenClosed(!openClosed)} className="flex w-full items-center gap-1.5 px-1 pt-2.5 pb-1.5 text-left text-[11px] font-semibold tracking-[0.07em] text-dim hover:text-muted">
            {openClosed ? '▾' : '▸'} {t('artifacts.sec.closed', { count: closed.length })}
          </button>
          {openClosed && [...closed].sort(byNew).map(card)}
        </>
      )}
      {!comments.length && !compose && <div className="px-1.5 py-2 text-[12.5px] leading-relaxed text-dim">{emptyHint[cur.blocks ? 'doc' : kind] ?? t('artifacts.emptyHint.none')}</div>}
      {!compose && (
        <div className="mt-1.5">
          <button type="button" className={BTN_GHOST} onClick={() => void startCompose({ type: 'general' })}>
            {t('artifacts.generalComment')}
          </button>
        </div>
      )}
    </>
  )

  const fixedCount = (v: number): number => comments.filter((c) => c.fixedIn === v).length
  const histTab = (
    <div>
      {[...a.versions].reverse().map((v) => (
        <div key={v.v} className="flex gap-2.5 border-b border-line px-1 py-[9px]">
          <span className={`w-[26px] shrink-0 font-mono text-[11.5px] font-semibold ${v.v === ver ? 'text-accent' : 'text-muted'}`}>v{v.v}</span>
          <div className="min-w-0 flex-1 leading-normal">
            <div>{v.note || (v.v === a.versions[0].v ? t('artifacts.hist.first') : t('artifacts.hist.noNote'))}</div>
            <div className="text-[11.5px] text-dim">
              {when(v.at)} · {v.agentName}
              {fixedCount(v.v) ? ` · ${t('artifacts.hist.fixed', { count: fixedCount(v.v) })}` : ''}
            </div>
          </div>
          {v.v !== ver && (
            <button type="button" className="self-start rounded-[5px] px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg" onClick={() => pickVer(v.v)}>
              {t('artifacts.view')}
            </button>
          )}
        </div>
      ))}
    </div>
  )

  const infoTab = (
    <div>
      <dl className="m-0 grid grid-cols-[92px_1fr] gap-x-2.5 gap-y-[9px] text-[12.5px]">
        <dt className="text-dim">{t('artifacts.info.file')}</dt>
        <dd className="m-0 font-mono text-[11.5px] break-all select-text">
          {a.rel}
          {gone && <span className="text-danger"> {t('artifacts.info.deleted')}</span>}
        </dd>
        <dt className="text-dim">{t('artifacts.info.type')}</dt>
        <dd className="m-0">{typeLabel(kind)}</dd>
        <dt className="text-dim">{t('artifacts.info.by')}</dt>
        <dd className="m-0 flex items-center gap-1.5">
          <ProductAvatar name={a.agentName} small />
          {a.agentName}
        </dd>
        <dt className="text-dim">{t('artifacts.info.task')}</dt>
        <dd className="m-0">{entry.title}</dd>
        <dt className="text-dim">{t('artifacts.info.first')}</dt>
        <dd className="m-0">{when(a.versions[0].at)}</dd>
        <dt className="text-dim">{t('artifacts.info.versions')}</dt>
        <dd className="m-0">{a.versions.length}</dd>
        <dt className="text-dim">{t('artifacts.info.snapshot')}</dt>
        <dd className="m-0 font-mono text-[11.5px] break-all select-text">.stag/artifacts/{a.id}/</dd>
      </dl>
      <div className="mt-4">
        <button
          type="button"
          className={`${BTN_GHOST} text-danger hover:text-danger`}
          onClick={() =>
            void act(() => window.stag.products.hide(ws.id, a.id), t('artifacts.toast.hidden', { title: a.title })).then((ok) => ok && onBack())
          }
        >
          {t('artifacts.hide')}
        </button>
        <div className="mt-1 pl-2 text-[11.5px] text-dim">{t('artifacts.hideNote')}</div>
      </div>
    </div>
  )

  const many = a.versions.length > 4
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_350px]">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-line">
        <div className="border-b border-line px-[22px] pt-3 pb-[11px]">
          <div className="flex min-w-0 items-center gap-1.5 pr-8 text-[12px] text-dim">
            <button type="button" onClick={onBack} className="rounded px-1 py-0.5 whitespace-nowrap text-muted hover:bg-panel-2 hover:text-fg">
              ← {entry.title}
            </button>
            <span>/</span>
            <span className="truncate font-mono select-text">{a.rel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <h2 className="m-0 min-w-0 flex-1 text-[18px] font-semibold">{a.title}</h2>
            {pinnable && (
              <button type="button" className={pinning ? BTN_PRI : BTN} onClick={() => setPinning(!pinning)}>
                <Mi name="pin" /> {pinning ? t('artifacts.pin.picking') : t('artifacts.pin.button')}
              </button>
            )}
            {!gone && (
              <>
                <button type="button" className={BTN} onClick={() => void act(() => window.stag.artifacts.open(ws.id, a.rel))}>
                  {t('artifacts.openDefault')}
                </button>
                <button type="button" className={BTN_GHOST} onClick={() => void act(() => window.stag.artifacts.reveal(ws.id, a.rel))}>
                  {t('artifacts.reveal')}
                </button>
              </>
            )}
          </div>
          {a.description && <div className="mt-[3px] leading-normal text-muted select-text">{a.description}</div>}
          <div className="mt-[11px] flex min-h-7 flex-wrap items-center gap-2">
            {many ? (
              <select value={ver} onChange={(e) => pickVer(Number(e.target.value))} className="rounded-[7px] border border-line-2 bg-panel px-2 py-1 font-mono text-[12px] text-fg">
                {[...a.versions].reverse().map((v) => (
                  <option key={v.v} value={v.v}>
                    v{v.v}
                    {v.v === latest.v ? ` · ${t('artifacts.latest')}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="inline-flex overflow-hidden rounded-[7px] border border-line-2">
                {a.versions.map((v, i) => (
                  <button
                    key={v.v}
                    type="button"
                    onClick={() => pickVer(v.v)}
                    className={`px-[11px] py-1 font-mono text-[12px] ${i ? 'border-l border-line-2' : ''} ${v.v === ver ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg'}`}
                  >
                    v{v.v}
                  </button>
                ))}
              </span>
            )}
            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap text-dim">
              <ProductAvatar name={cur.agentName} small />
              <span>{t('artifacts.publishedBy', { agent: cur.agentName })}</span>·
              <b className="truncate font-medium text-muted">{cur.note || (cur.v === a.versions[0].v ? t('artifacts.hist.first') : t('artifacts.hist.noNoteLower'))}</b>· {when(cur.at)}
            </span>
            {canDiff && (
              <>
                <button type="button" onClick={() => (setDiff(!comparing), setHintOff(true), (changeIdx.current = -1), setPinning(false))} className="inline-flex items-center gap-[7px] rounded-md px-1.5 py-[3px] text-[12px] text-muted hover:bg-panel-2 hover:text-fg">
                  <Switch on={comparing} />
                  {isImage ? t('artifacts.sideBySide') : t('artifacts.compareWith')}
                </button>
                <select
                  value={Math.min(cmp, ver - 1)}
                  disabled={!comparing}
                  onChange={(e) => ((changeIdx.current = -1), setCmp(Number(e.target.value)))}
                  className="rounded-[7px] border border-line-2 bg-panel px-2 py-1 font-mono text-[12px] text-fg disabled:opacity-45"
                >
                  {a.versions
                    .filter((v) => v.v < ver)
                    .reverse()
                    .map((v) => (
                      <option key={v.v} value={v.v}>
                        v{v.v}
                      </option>
                    ))}
                </select>
              </>
            )}
          </div>
          {(newSince || showHint) && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-accent">
              {newSince ? (
                <>
                  {t('artifacts.newVersionAvail', { v: latest.v })}
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() => {
                      const from = ver
                      pickVer(latest.v)
                      if (isImage || latest.blocks) {
                        setCmp(from)
                        setDiff(true)
                      }
                    }}
                  >
                    {t('artifacts.viewChanges')}
                  </button>
                </>
              ) : (
                <>
                  {t('artifacts.newSinceSeen', { v: latest.v, seen: prevSeen })}
                  <button type="button" className={BTN_GHOST} onClick={() => (setCmp(prevSeen), setDiff(true), setHintOff(true))}>
                    {t('artifacts.viewChanges')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {gone && (
          <div className="flex items-center gap-2.5 border-b border-line bg-danger/6 px-[22px] py-2 text-[12.5px] text-danger-text">
            <Mi name="warn" />
            <span className="min-w-0">
              {tx('artifacts.gone', { file: <span className="font-mono">{a.rel}</span>, v: cur.v })}
            </span>
            <span className="flex-1" />
            <button type="button" className={BTN} onClick={() => void act(async () => (await window.stag.products.saveAs(ws.id, cur.snapshot)) && toast(t('artifacts.toast.snapshotSaved')))}>
              {t('artifacts.saveSnapshot')}
            </button>
          </div>
        )}
        {comparing && stats && (
          <div className="flex items-center gap-2.5 border-b border-line bg-panel px-[22px] py-[7px] text-[12px] text-muted">
            <span>
              v{cmp} → v{ver}:
            </span>
            {stats.add > 0 && <span className="text-work">{t('artifacts.diff.added', { count: stats.add })}</span>}
            {stats.chg > 0 && <span className="text-info">{t('artifacts.diff.changed', { count: stats.chg })}</span>}
            {stats.del > 0 && <span className="text-danger">{t('artifacts.diff.removed', { count: stats.del })}</span>}
            {!stats.add && !stats.chg && !stats.del && <span>{t('artifacts.diff.same')}</span>}
            <span className="flex-1" />
            <span className="text-dim">{t('artifacts.diff.note')}</span>
            {stats.add + stats.chg + stats.del > 0 && (
              <button type="button" className={BTN} onClick={nextChange}>
                {t('artifacts.diff.next')}
              </button>
            )}
          </div>
        )}
        <div ref={scroll} className={`relative min-h-0 flex-1 bg-bg ${fullHeight ? 'overflow-hidden' : 'overflow-auto'}`}>
          {view}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col bg-bg">
        <div className="flex gap-0.5 border-b border-line px-2.5 pt-2">
          {(
            [
              ['cmt', t('artifacts.tab.comments'), you.length ? t('artifacts.tab.needYou', { count: you.length }) : comments.length || ''],
              ['hist', t('artifacts.tab.versions'), a.versions.length],
              ['info', t('artifacts.tab.info'), '']
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRtab(id)}
              className={`-mb-px border-b-2 px-2.5 py-[7px] ${rtab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {label}
              {n !== '' && <span className={`ml-1 font-mono text-[11px] ${id === 'cmt' && you.length ? 'text-wait' : 'text-dim'}`}>{n}</span>}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2.5">{rtab === 'cmt' ? cmtTab : rtab === 'hist' ? histTab : infoTab}</div>
        {rtab === 'cmt' && (
          <div className="border-t border-line bg-panel p-2.5">
            {drafts.length > 0 && (
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex-1">{t('artifacts.draftsCount', { count: drafts.length })}</span>
                <button
                  type="button"
                  className={BTN_PRI}
                  disabled={busy}
                  onClick={() => void act(() => window.stag.products.sendDrafts(ws.id, a.id), sentToast(delivery, a.agentName, drafts.length))}
                >
                  {t('artifacts.sendDrafts', { count: drafts.length, agent: a.agentName })}
                </button>
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[11.5px] leading-snug text-dim">
              <ProductAvatar name={a.agentName} small />
              <span className="min-w-0 flex-1">
                {deliveryLine(delivery, a.agentName)}
                {delivery === 'closed' && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="text-info"
                      onClick={() => {
                        setTab('agents')
                        show(ws.id, a.agentId)
                      }}
                    >
                      {t('artifacts.openCell', { agent: a.agentName })}
                    </button>
                  </>
                )}
              </span>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

// ---------- mảnh nhỏ ----------

function Sub({ cls = 'text-dim', children }: { cls?: string; children: React.ReactNode }): React.JSX.Element {
  return <div className={`flex items-center gap-1.5 px-1 pt-2.5 pb-1.5 text-[11px] font-semibold tracking-[0.07em] first:pt-0.5 ${cls}`}>{children}</div>
}

function Stt({ cls = 'text-dim', icon, text, children }: { cls?: string; icon?: 'pen' | 'clock' | 'check'; text: string; children?: React.ReactNode }): React.JSX.Element {
  return (
    <div className={`mt-2 flex items-center gap-1.5 text-[11.5px] ${cls}`}>
      {icon && <Mi name={icon} />}
      <span className="min-w-0">{text}</span>
      <span className="flex-1" />
      {children}
    </div>
  )
}

/** Nhãn chỗ neo của góp ý (đoạn trích / ghim / thời điểm / ô / chung). */
function AnchorQuote({ c, anchor, kind, label, accent }: { c?: ArtifactComment; anchor?: CommentAnchor; kind: string; label?: string; accent?: boolean }): React.JSX.Element {
  const t = useT()
  const an = anchor ?? c!.anchor
  const bar = accent ? 'border-accent' : 'border-line-3'
  let body: React.ReactNode
  if (an.type === 'text') body = an.quote
  else if (an.type === 'pin') {
    const n = String(label ?? c?.no ?? '')
    body = (
      <>
        <Mi name="pin" />{' '}
        {kind !== 'pdf' ? t('artifacts.anchor.pinImage', { n }) : an.page ? t('artifacts.anchor.pinPdfPage', { n, page: an.page }) : t('artifacts.anchor.pinPdf', { n })}
      </>
    )
  } else if (an.type === 'time')
    body = (
      <>
        <Mi name="play" /> {t('artifacts.anchor.at', { time: formatTime(an.t) })}
      </>
    )
  else if (an.type === 'cell')
    body = (
      <>
        <Mi name="cell" /> {t('artifacts.anchor.cell', { cell: `${an.sheet ? `${an.sheet} · ` : ''}${an.cell}`, value: an.value || t('artifacts.anchor.empty') })}
      </>
    )
  else body = t('artifacts.anchor.general')
  return <div className={`mb-[7px] line-clamp-2 border-l-2 pl-2 text-[12px] text-muted ${bar}`}>{body}</div>
}

function Thread({ c, agent }: { c: ArtifactComment; agent: string }): React.JSX.Element {
  const t = useT()
  return (
    <div>
      {c.thread.map((m, i) => (
        <div key={i} className={`flex gap-[7px] leading-normal ${i ? 'mt-2 border-t border-line pt-2' : ''}`}>
          {m.by === 'user' ? (
            <span className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border border-line-2 bg-panel-3 text-[8px] font-bold text-muted">{t('artifacts.youInitial')}</span>
          ) : (
            <ProductAvatar name={m.name ?? agent} small />
          )}
          <div className="min-w-0 flex-1">
            <div className="mb-px text-[11.5px] text-dim">
              <b className="font-semibold text-fg">{m.by === 'user' ? t('artifacts.you') : (m.name ?? agent)}</b> · {when(m.at)}
            </div>
            <div className={`break-words whitespace-pre-wrap select-text ${m.by === 'user' ? 'text-fg' : 'text-muted'}`}>{m.text}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Composer({
  value,
  onChange,
  placeholder,
  hint,
  onCancel,
  onSubmit,
  buttons
}: {
  value: string
  onChange: (t: string) => void
  placeholder: string
  hint: string
  onCancel: () => void
  onSubmit: () => void
  buttons: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const t = ref.current
    if (!t) return
    t.focus()
    t.setSelectionRange(t.value.length, t.value.length)
  }, [])
  return (
    <div>
      <textarea
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault()
            onSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
        className="min-h-[66px] w-full resize-y rounded-md border border-line-2 bg-panel px-2 py-[7px] text-fg outline-none select-text focus:border-accent"
      />
      <div className="mt-1 text-[11px] text-dim">{hint}</div>
      <div className="mt-2 flex items-center gap-1.5">{buttons}</div>
    </div>
  )
}

/** Ô trả lời trong mạch: chữ giữ trong `replyDrafts` (không mất khi chuyển góp ý khác). */
function ReplyBox({ k, placeholder, busy, onCancel, onSend }: { k: string; placeholder: string; busy: boolean; onCancel: () => void; onSend: () => void }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState(replyDrafts.get(k) ?? '')
  return (
    <Composer
      value={text}
      onChange={(v) => {
        setText(v)
        replyDrafts.set(k, v)
      }}
      placeholder={placeholder}
      hint={t('artifacts.reply.hint')}
      onCancel={onCancel}
      onSubmit={onSend}
      buttons={
        <>
          <button type="button" className={BTN_GHOST} onClick={onCancel}>
            {t('common.close')}
          </button>
          <span className="flex-1" />
          <button type="button" className={BTN_PRI} disabled={busy || !text.trim()} onClick={onSend}>
            {t('common.send')}
          </button>
        </>
      }
    />
  )
}

/** Ảnh + ghim góp ý (toạ độ 0–1 theo ảnh). */
function PinImage({ src, pins, picking, onPick, onPin }: { src: string; pins: PinMark[]; picking: boolean; onPick: (p: { x: number; y: number }) => void; onPin: (id: string) => void }): React.JSX.Element {
  const t = useT()
  const [failed, setFailed] = useState(false)
  if (failed) return <Note>{t('artifacts.imageFailed')}</Note>
  return (
    <div className="mx-auto my-[22px] max-w-[840px] px-[18px]">
      <div
        className={`relative overflow-hidden rounded-[10px] border border-line bg-[repeating-conic-gradient(#14171b_0_25%,#101215_0_50%)] bg-[length:16px_16px] ${picking ? 'cursor-crosshair outline-2 outline-offset-2 outline-accent' : ''}`}
        onClick={(e) => {
          if (!picking || (e.target as HTMLElement).closest('[data-pin]')) return
          const r = e.currentTarget.getBoundingClientRect()
          onPick({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
        }}
      >
        <img src={src} draggable={false} onError={() => setFailed(true)} className="block w-full" />
        {pins.map((p) => (
          <Pin key={p.id} p={p} onClick={() => p.id !== '__new' && onPin(p.id)} />
        ))}
      </div>
    </div>
  )
}

const PIN_BG: Record<string, string> = {
  you: 'bg-wait text-wait-on',
  fixed: 'bg-work text-work-on',
  open: 'bg-[#c9ced5] text-[#111]',
  draft: 'bg-accent text-accent-on',
  closed: 'bg-line-3 text-muted'
}

function Pin({ p, onClick }: { p: PinMark; onClick: () => void }): React.JSX.Element {
  return (
    <span
      data-pin={p.id}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
      className={`absolute z-[2] -mt-[22px] -ml-[11px] grid h-[22px] w-[22px] -rotate-45 cursor-pointer place-items-center rounded-[50%_50%_50%_0] border-[1.5px] border-black/65 text-[10px] font-bold ${PIN_BG[p.tone] ?? PIN_BG.open} ${p.hot ? 'shadow-[0_0_0_3px_rgba(221,225,230,.35)]' : ''}`}
    >
      <span className="rotate-45">{p.label}</span>
    </span>
  )
}

/** Video / âm thanh + vạch thời điểm có góp ý; "Góp ý tại m:ss" lấy thời điểm đang xem. */
function Player({
  kind,
  src,
  comments,
  draft,
  hot,
  onMark,
  onComment
}: {
  kind: 'video' | 'audio'
  src: string
  comments: ArtifactComment[]
  draft: number | null
  hot: string | null
  onMark: (id: string) => void
  onComment: (t: number) => void
}): React.JSX.Element {
  const tr = useT()
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [failed, setFailed] = useState(false)
  // Bấm vào góp ý theo thời điểm → tua tới đó.
  useEffect(() => {
    const c = comments.find((x) => x.id === hot)
    const el = ref.current
    if (c?.anchor.type === 'time' && el) {
      el.currentTime = c.anchor.t
      el.pause()
    }
  }, [hot, comments])
  if (failed) return <Note>{tr('artifacts.mediaFailed')}</Note>
  const marks = [...comments.map((c) => ({ id: c.id, t: c.anchor.type === 'time' ? c.anchor.t : 0, tone: tone(c) })), ...(draft != null ? [{ id: '__new', t: draft, tone: 'draft' }] : [])]
  const TM: Record<string, string> = { you: 'bg-wait', draft: 'bg-accent', fixed: 'bg-work', closed: 'bg-line-3', open: 'bg-[#c9ced5]' }
  const media = { ref, src, controls: true, onError: () => setFailed(true), onTimeUpdate: () => setT(ref.current?.currentTime ?? 0), onLoadedMetadata: () => setDur(ref.current?.duration ?? 0) }
  return (
    <div className="mx-auto my-[22px] max-w-[840px] px-[18px]">
      <div className="overflow-hidden rounded-[10px] border border-line bg-black">
        {kind === 'video' ? <video {...media} className="block max-h-[60vh] w-full" /> : <audio {...media} className="block w-full p-4" />}
        <div className="relative mx-2.5 my-2 h-4">
          <div className="absolute top-[7px] right-0 left-0 h-0.5 rounded bg-line-2" />
          {dur > 0 &&
            marks.map((m) => (
              <button
                key={m.id}
                type="button"
                title={formatTime(m.t)}
                onClick={() => m.id !== '__new' && onMark(m.id)}
                style={{ left: `${Math.min(100, (m.t / dur) * 100)}%` }}
                className={`absolute top-[3px] -ml-[5px] h-2.5 w-2.5 rounded-full border-[1.5px] border-black/65 ${TM[m.tone] ?? TM.open} ${hot === m.id ? 'ring-2 ring-fg/35' : ''}`}
              />
            ))}
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-panel-2 px-2.5 py-[7px] font-mono text-[11.5px] text-dim">
          {tr('artifacts.player.snapshot', { pos: formatTime(t), dur: formatTime(dur) })}
          <span className="flex-1" />
          <button
            type="button"
            className={`${BTN} font-sans`}
            onClick={() => {
              ref.current?.pause()
              onComment(ref.current?.currentTime ?? t)
            }}
          >
            <Mi name="cmt" /> {tr('artifacts.player.commentAt', { time: formatTime(t) })}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Tài liệu chữ không tách khối (quá lớn): hiện như code, chỉ góp ý chung. */
function TextFallback({ ws, rel, vkey }: { ws: Workspace; rel: string; vkey: string }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [msg, setMsg] = useState<'missingSnapshot' | 'notText' | null>(null)
  useEffect(() => {
    let alive = true
    window.stag.artifacts.text(ws.id, rel).then((r) => {
      if (!alive) return
      if (r.status === 'ok') setText(r.text)
      else setMsg(r.status === 'missing' ? 'missingSnapshot' : 'notText')
    })
    return () => {
      alive = false
    }
  }, [ws.id, rel, vkey])
  if (msg) return <Note>{t(`artifacts.${msg}`)}</Note>
  if (text == null) return <Note>{t('artifacts.opening')}</Note>
  return <CodeView text={text} rel={rel} />
}
