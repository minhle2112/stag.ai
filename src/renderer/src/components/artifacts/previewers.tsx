// Xem trước artifact ngay trong app theo loại file. Thư viện nặng (pdf.js, docx-preview, SheetJS, JSZip) chỉ tải
// khi cần (import động → chunk riêng). Nội dung từ file của agent luôn được vẽ trong shadow DOM (không lẫn CSS với
// app) hoặc iframe sandbox (HTML), và CSP của app chặn mọi script nội tuyến.
import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '@shared/types'
import { Icon } from '../Icon'
import { Seg } from '../ui/Seg'
import { extOf, fileUrl, formatSize } from './stacks'

// ---------- tiện ích chung ----------

/** Gọi `fn` một lần khi phần tử lọt vào màn hình (để thẻ ngoài tầm nhìn chưa phải tải gì). */
export function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return [ref, visible]
}

/** Tải cả file qua IPC; lỗi (file quá lớn…) trả về thông báo. */
function useBytes(ws: Workspace, rel: string, version: string): { data: Uint8Array | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: Uint8Array | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    setState({ data: null, error: null, loading: true })
    window.stag.artifacts
      .bytes(ws.id, rel)
      .then((data) => alive && setState({ data, error: data ? null : 'Không còn file này trên đĩa.', loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: cleanError(e), loading: false }))
    return () => {
      alive = false
    }
  }, [ws.id, rel, version])
  return state
}

export function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Phần tử có shadow root riêng để vẽ nội dung file vào (CSS của file không lọt ra app và ngược lại). */
function useShadowHost(): [React.RefObject<HTMLDivElement | null>, () => ShadowRoot | null] {
  const ref = useRef<HTMLDivElement>(null)
  const get = (): ShadowRoot | null => {
    const el = ref.current
    if (!el) return null
    return el.shadowRoot ?? el.attachShadow({ mode: 'open' })
  }
  return [ref, get]
}

/** Link trong nội dung file: http(s) mở bằng trình duyệt hệ thống, còn lại bỏ qua. */
function guardLinks(root: ShadowRoot | HTMLElement): void {
  root.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) return
    e.preventDefault()
    if (/^https?:/i.test(href)) window.open(href)
  })
}

export function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-5 py-6 text-center text-[12px] text-muted">{children}</div>
}

function Loading(): React.JSX.Element {
  return <Note>Đang mở…</Note>
}

// ---------- ảnh ----------

/** Ảnh trên nền ô vuông tối (thấy rõ phần trong suốt), kèm kích thước thật của ảnh. */
export function ImageView({ ws, rel, version, onError }: { ws: Workspace; rel: string; version: string; onError: () => void }): React.JSX.Element {
  const [dim, setDim] = useState<string | null>(null)
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2.5 bg-[repeating-conic-gradient(#14171a_0%_25%,#101215_0%_50%)] bg-[length:16px_16px] p-6">
      <img
        src={fileUrl(ws.id, rel, version)}
        draggable={false}
        onError={onError}
        onLoad={(e) => setDim(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
        className="max-h-full max-w-full rounded-[4px] object-contain shadow-[0_8px_30px_rgba(0,0,0,.5)]"
      />
      {dim && (
        <div className="font-mono text-[11px] text-dim">
          {dim} · {extOf(rel).toUpperCase() || 'ẢNH'}
        </div>
      )}
    </div>
  )
}

// ---------- PDF (pdf.js) ----------

type PdfJs = typeof import('pdfjs-dist')
let pdfjsP: Promise<PdfJs> | null = null
function pdfjs(): Promise<PdfJs> {
  pdfjsP ??= (async () => {
    const lib = await import('pdfjs-dist')
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    lib.GlobalWorkerOptions.workerSrc = worker
    return lib
  })()
  return pdfjsP
}

async function openPdf(data: Uint8Array): Promise<import('pdfjs-dist').PDFDocumentProxy> {
  const lib = await pdfjs()
  // pdf.js chuyển buffer sang worker (làm rỗng mảng gốc) → đưa bản sao.
  return lib.getDocument({ data: data.slice(), enableXfa: false }).promise
}

/** Ghim góp ý vẽ trên trang PDF / ảnh (tab Sản phẩm). */
export interface PinMark {
  id: string
  /** Số trên ghim ('+' = đang soạn). */
  label: string
  page?: number
  x: number
  y: number
  /** Màu theo trạng thái góp ý: you / fixed / open / draft / closed. */
  tone: string
  hot?: boolean
}

const PIN_TONES: Record<string, [string, string]> = {
  you: ['var(--color-wait)', '#1a1300'],
  fixed: ['var(--color-work)', '#03200f'],
  open: ['#c9ced5', '#111'],
  draft: ['var(--color-accent)', 'var(--color-accent-on)'],
  closed: ['var(--color-line-3)', 'var(--color-muted)']
}

/** Phần tử ghim (giọt nước xoay 45°, số ở giữa), đặt theo toạ độ 0–1 trong khung cha `position: relative`. */
export function pinElement(p: PinMark): HTMLElement {
  const [bg, fg] = PIN_TONES[p.tone] ?? PIN_TONES.open
  const el = document.createElement('span')
  el.dataset.pin = p.id
  Object.assign(el.style, {
    position: 'absolute',
    left: `${p.x * 100}%`,
    top: `${p.y * 100}%`,
    width: '22px',
    height: '22px',
    margin: '-22px 0 0 -11px',
    borderRadius: '50% 50% 50% 0',
    transform: 'rotate(-45deg)',
    display: 'grid',
    placeItems: 'center',
    font: '700 10px var(--font-sans)',
    cursor: 'pointer',
    border: '1.5px solid #000a',
    background: bg,
    color: fg,
    boxShadow: p.hot ? '0 0 0 3px rgba(221,225,230,.35)' : 'none',
    zIndex: '2'
  })
  const n = document.createElement('span')
  n.style.transform = 'rotate(45deg)'
  n.textContent = p.label
  el.appendChild(n)
  return el
}

export function PdfView({
  ws,
  rel,
  version,
  pins,
  picking,
  onPick,
  onPin
}: {
  ws: Workspace
  rel: string
  version: string
  /** Ghim góp ý (theo trang). */
  pins?: PinMark[]
  /** Đang chờ người dùng bấm vào trang để ghim. */
  picking?: boolean
  onPick?: (p: { page: number; x: number; y: number }) => void
  onPin?: (id: string) => void
}): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const host = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pages, setPages] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [laid, setLaid] = useState(0)
  const pick = useRef({ picking, onPick, onPin })
  pick.current = { picking, onPick, onPin }

  useEffect(() => {
    const el = host.current
    if (!data || !el) return
    let doc: import('pdfjs-dist').PDFDocumentProxy | null = null
    let cancelled = false
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) (e.target as HTMLElement & { draw?: () => void }).draw?.()
      },
      { root: el.parentElement, rootMargin: '600px' }
    )
    el.replaceChildren()
    setFailed(null)
    ;(async () => {
      try {
        doc = await openPdf(data)
        if (cancelled) return
        setPages(doc.numPages)
        const width = Math.max(200, el.clientWidth - 32) * zoom
        const ratio = window.devicePixelRatio || 1
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const scale = width / base.width
          const vp = page.getViewport({ scale })
          const box = document.createElement('div') as HTMLDivElement & { draw?: () => void }
          box.dataset.page = String(n)
          Object.assign(box.style, { position: 'relative', width: `${vp.width}px`, height: `${vp.height}px`, margin: '0 auto 16px', background: '#fff', boxShadow: '0 6px 30px rgba(0,0,0,.5)' })
          box.draw = () => {
            box.draw = undefined
            const canvas = document.createElement('canvas')
            canvas.width = Math.floor(vp.width * ratio)
            canvas.height = Math.floor(vp.height * ratio)
            Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
            box.appendChild(canvas)
            void page.render({ canvas, viewport: page.getViewport({ scale: scale * ratio }) }).promise.catch(() => {})
          }
          el.appendChild(box)
          io.observe(box)
        }
        if (!cancelled) setLaid((x) => x + 1)
      } catch (e) {
        if (!cancelled) setFailed(cleanError(e))
      }
    })()
    return () => {
      cancelled = true
      io.disconnect()
      void doc?.loadingTask.destroy()
    }
  }, [data, zoom])

  // Ghim góp ý: vẽ lại khi danh sách ghim đổi hoặc các trang vừa dựng lại (đổi cỡ).
  useEffect(() => {
    const el = host.current
    if (!el) return
    el.querySelectorAll('[data-pin]').forEach((p) => p.remove())
    for (const p of pins ?? []) el.querySelector(`[data-page="${p.page ?? 1}"]`)?.appendChild(pinElement(p))
  }, [pins, laid])

  const onClick = (e: React.MouseEvent): void => {
    const t = e.target as HTMLElement
    const pin = t.closest<HTMLElement>('[data-pin]')
    if (pin) {
      e.stopPropagation()
      pick.current.onPin?.(pin.dataset.pin!)
      return
    }
    const box = t.closest<HTMLElement>('[data-page]')
    if (!box || !pick.current.picking) return
    const r = box.getBoundingClientRect()
    pick.current.onPick?.({ page: Number(box.dataset.page), x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })
  }

  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được file PDF: ${failed}`}</Note>
  return (
    <div className="flex h-full flex-col bg-[#24282d]">
      <div className="flex shrink-0 items-center justify-center gap-1 py-1.5 text-[12px] text-muted">
        <span className="mr-1 font-mono text-[11px]">{pages ? `${pages} trang` : ''}</span>
        <ZoomButtons zoom={zoom} setZoom={setZoom} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-5">
        <div ref={host} onClick={onClick} className={picking ? 'cursor-crosshair' : ''} />
      </div>
    </div>
  )
}

function ZoomButtons({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }): React.JSX.Element {
  const btn = 'inline-grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-40'
  return (
    <>
      <button type="button" className={btn} disabled={zoom <= 0.5} data-tip="Thu nhỏ" onClick={() => setZoom(Math.max(0.5, +(zoom - 0.25).toFixed(2)))}>
        <MinusIcon />
      </button>
      <button
        type="button"
        className="h-6 rounded-md px-1.5 font-mono text-[11px] text-muted hover:bg-panel-3 hover:text-fg"
        onClick={() => setZoom(1)}
        data-tip="Vừa khung"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={btn} disabled={zoom >= 3} data-tip="Phóng to" onClick={() => setZoom(Math.min(3, +(zoom + 0.25).toFixed(2)))}>
        <Icon name="plus" size="s" />
      </button>
    </>
  )
}

/** Dấu trừ cùng nét 1.5px với bộ icon của app (bộ icon chưa có "minus"). */
function MinusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  )
}

const pdfThumbs = new Map<string, Promise<string | null>>()
/** Ảnh trang đầu của PDF (data URL) cho thẻ. */
export function pdfThumb(ws: Workspace, rel: string, version: string): Promise<string | null> {
  const key = `${ws.id}|${rel}|${version}`
  let p = pdfThumbs.get(key)
  if (!p) {
    p = (async () => {
      const data = await window.stag.artifacts.bytes(ws.id, rel).catch(() => null)
      if (!data) return null
      const doc = await openPdf(data)
      try {
        const page = await doc.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: 480 / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, viewport: vp }).promise
        return canvas.toDataURL('image/jpeg', 0.85)
      } finally {
        void doc.loadingTask.destroy()
      }
    })().catch(() => null)
    pdfThumbs.set(key, p)
  }
  return p
}

// ---------- Word (docx-preview) ----------

export function DocxView({ ws, rel, version }: { ws: Workspace; rel: string; version: string }): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const [ref, shadow] = useShadowHost()
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const root = shadow()
    if (!data || !root) return
    let cancelled = false
    let ro: ResizeObserver | null = null
    root.replaceChildren()
    const style = document.createElement('div')
    const body = document.createElement('div')
    root.append(style, body)
    guardLinks(root)
    setFailed(null)
    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(data, body, style, {
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          experimental: true
        })
      )
      .then(() => {
        if (cancelled) return
        // Nền khung giống màu app thay vì xám sáng mặc định; trang rộng hơn khung thì thu nhỏ cho vừa.
        const w = body.querySelector<HTMLElement>('.docx-wrapper')
        const host = ref.current
        if (!w || !host) return
        Object.assign(w.style, { background: '#24282d', padding: '16px' })
        const pageWidth = Math.max(...Array.from(w.querySelectorAll<HTMLElement>(':scope > section')).map((s) => s.offsetWidth), 1)
        const fit = (): void => {
          w.style.zoom = String(Math.min(1, (host.clientWidth - 32) / pageWidth))
        }
        fit()
        ro = new ResizeObserver(fit)
        ro.observe(host)
      })
      .catch((e) => !cancelled && setFailed(cleanError(e)))
    return () => {
      cancelled = true
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được file Word: ${failed}`}</Note>
  return <div ref={ref} className="min-h-full bg-[#24282d] select-text" />
}

// ---------- Bảng tính (SheetJS) ----------

/** Số dòng tối đa đọc mỗi sheet (file lớn vẫn mở nhanh). */
const SHEET_ROWS = 2000

const SHEET_CSS = `
  :host { display: block; }
  table { border-collapse: collapse; font: 12px 'Inter Variable', 'Segoe UI', system-ui, sans-serif; color: #dde1e6; }
  td, th { border: 1px solid #2a2f36; padding: 3px 8px; white-space: pre; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
  tr:first-child td { background: #1d2126; font-weight: 600; position: sticky; top: 0; }
  tr:nth-child(even) td { background: rgba(255,255,255,.02); }
  td.n { color: #69717b; text-align: right; background: #16191d !important; position: sticky; left: 0; font-weight: 400; font-family: 'JetBrains Mono Variable', Consolas, monospace; font-size: 11px; }
  a { color: #6aa9ff; }
  :host(.pick) td[id] { cursor: cell; }
  :host(.pick) td[id]:hover { background: #16191d; }
  td.cm { box-shadow: inset 0 -2px 0 #3a4048; background: rgba(221,225,230,.05) !important; }
  td.cm.you { box-shadow: inset 0 -2px 0 #f4b544; }
  td.cm.fixed { box-shadow: inset 0 -2px 0 #3ddc84; }
  td.cm.draft { box-shadow: inset 0 -2px 0 #2de2c0; }
  td.cm.hot { outline: 2px solid rgba(221,225,230,.35); outline-offset: -2px; }
`

export function SheetView({
  ws,
  rel,
  version,
  cells,
  onCell
}: {
  ws: Workspace
  rel: string
  version: string
  /** Ô có góp ý (tab Sản phẩm): "Sheet!B4" → màu (you / fixed / open / draft / closed, thêm " hot" khi đang chọn). */
  cells?: Record<string, string>
  /** Bấm vào ô (bật chế độ góp ý theo ô). */
  onCell?: (c: { sheet: string; cell: string; value: string }) => void
}): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const [book, setBook] = useState<{ names: string[]; html: (i: number) => { html: string; rows: number; cut: boolean } } | null>(null)
  const [sheet, setSheet] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)
  const [ref, shadow] = useShadowHost()

  useEffect(() => {
    if (!data) return
    let cancelled = false
    setFailed(null)
    import('xlsx')
      .then((XLSX) => {
        const ext = extOf(rel)
        // CSV/TSV: giải mã UTF-8 trước (SheetJS đọc byte thô theo bảng mã cũ → hỏng chữ Việt).
        const wb =
          ext === 'csv' || ext === 'tsv'
            ? XLSX.read(new TextDecoder('utf-8').decode(data), { type: 'string', sheetRows: SHEET_ROWS + 1, FS: ext === 'tsv' ? '\t' : undefined })
            : XLSX.read(data, { type: 'array', sheetRows: SHEET_ROWS + 1, cellDates: true })
        if (cancelled) return
        setSheet(0)
        const done = new Map<number, { html: string; rows: number; cut: boolean }>()
        setBook({
          names: wb.SheetNames,
          html: (i) => {
            const hit = done.get(i)
            if (hit) return hit
            const s = wb.Sheets[wb.SheetNames[i]]
            const range = s?.['!ref'] ? XLSX.utils.decode_range(s['!ref']) : null
            const rows = range ? range.e.r - range.s.r + 1 : 0
            const cut = rows > SHEET_ROWS
            if (s && cut && range) s['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.s.r + SHEET_ROWS - 1, c: range.e.c } })
            const out = { html: s ? XLSX.utils.sheet_to_html(s, { header: '', footer: '' }) : '', rows, cut }
            done.set(i, out)
            return out
          }
        })
      })
      .catch((e) => !cancelled && setFailed(cleanError(e)))
    return () => {
      cancelled = true
    }
  }, [data, rel])

  const current = book && book.names.length ? book.html(Math.min(sheet, book.names.length - 1)) : null

  useEffect(() => {
    const root = shadow()
    if (!root || !current) return
    // sheet_to_html đã escape nội dung ô; CSP của app chặn mọi thuộc tính on* nếu có.
    root.innerHTML = `<style>${SHEET_CSS}</style>${current.html}`
    // Cột số dòng bên trái.
    root.querySelectorAll('tr').forEach((tr, i) => {
      const td = document.createElement('td')
      td.className = 'n'
      td.textContent = String(i + 1)
      tr.prepend(td)
    })
    guardLinks(root)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.html])

  const sheetName = book?.names[Math.min(sheet, book.names.length - 1)] ?? ''
  const cellRef = useRef({ onCell, sheetName })
  cellRef.current = { onCell, sheetName }
  // Ô có góp ý + bấm ô để góp ý (chỉ khi có onCell).
  useEffect(() => {
    const root = shadow()
    if (!root || !current) return
    ;(root.host as HTMLElement).classList.toggle('pick', !!onCell)
    root.querySelectorAll('td.cm').forEach((td) => td.classList.remove('cm', 'you', 'fixed', 'open', 'draft', 'closed', 'hot'))
    for (const [key, tone] of Object.entries(cells ?? {})) {
      const at = key.lastIndexOf('!')
      const sh = at >= 0 ? key.slice(0, at) : ''
      if (sh && sh !== sheetName) continue
      const td = root.getElementById(`sjs-${key.slice(at + 1)}`)
      if (td) td.classList.add('cm', ...tone.split(' ').filter(Boolean))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.html, cells, sheetName, !!onCell])
  useEffect(() => {
    const root = shadow()
    if (!root) return
    const click = (e: Event): void => {
      const td = (e.target as Element | null)?.closest?.('td[id^="sjs-"]')
      const cb = cellRef.current.onCell
      if (!td || !cb) return
      cb({ sheet: cellRef.current.sheetName, cell: td.id.slice(4), value: (td.textContent ?? '').trim() })
    }
    root.addEventListener('click', click)
    return () => root.removeEventListener('click', click)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!book])

  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được bảng tính: ${failed}`}</Note>
  if (!book) return <Loading />
  return (
    <div className="flex h-full flex-col">
      {book.names.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-1.5">
          {book.names.map((n, i) => (
            <button
              key={n}
              type="button"
              onClick={() => setSheet(i)}
              className={`shrink-0 rounded px-2.5 py-0.5 text-[12px] ${i === sheet ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg'}`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3 select-text">
        <div ref={ref} />
        {current?.cut && <Note>Chỉ hiện {SHEET_ROWS} dòng đầu. Mở bằng ứng dụng ngoài (nút ở đầu khung) để xem cả file.</Note>}
        {current && !current.rows && <Note>Sheet trống.</Note>}
      </div>
    </div>
  )
}

// ---------- PowerPoint (bộ vẽ riêng, xem pptx.ts) ----------

export function PptxView({ ws, rel, version }: { ws: Workspace; rel: string; version: string }): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const [ref, shadow] = useShadowHost()
  const [info, setInfo] = useState<{ count: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const root = shadow()
    const host = ref.current
    if (!data || !root || !host) return
    let cancelled = false
    root.replaceChildren()
    setFailed(null)
    const list = document.createElement('div')
    root.appendChild(list)
    guardLinks(root)
    let ro: ResizeObserver | null = null
    ;(async () => {
      try {
        const { loadPptx } = await import('./pptx')
        const deck = await loadPptx(data)
        if (cancelled) return
        setInfo({ count: deck.count })
        const frames: Array<{ outer: HTMLElement; slide: HTMLElement }> = []
        const fit = (): void => {
          const s = Math.max(0.1, (host.clientWidth - 32) / deck.width)
          for (const f of frames) {
            Object.assign(f.outer.style, { width: `${deck.width * s}px`, height: `${deck.height * s}px` })
            f.slide.style.transform = `scale(${s})`
          }
        }
        for (let i = 0; i < deck.count; i++) {
          const slide = await deck.render(i, document)
          if (cancelled) return
          slide.style.transformOrigin = '0 0'
          const outer = document.createElement('div')
          Object.assign(outer.style, { margin: '0 auto 6px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,.4)', position: 'relative' })
          outer.appendChild(slide)
          const label = document.createElement('div')
          Object.assign(label.style, { textAlign: 'center', color: '#69717b', font: "11px 'JetBrains Mono Variable', Consolas, monospace", margin: '0 0 14px' })
          label.textContent = `Slide ${i + 1} / ${deck.count}`
          list.append(outer, label)
          frames.push({ outer, slide })
          fit()
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
      } catch (e) {
        if (!cancelled) setFailed(cleanError(e))
      }
    })()
    return () => {
      cancelled = true
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được file PowerPoint: ${failed}`}</Note>
  return (
    <div className="min-h-full bg-[#24282d] select-text">
      {info && <div className="px-4 pt-3 text-center text-[11px] text-dim">{info.count} slide · bản xem trước gần đúng (biểu đồ, SmartArt, hiệu ứng chưa vẽ)</div>}
      <div ref={ref} className="px-4 py-3" />
    </div>
  )
}

/**
 * Slide đầu của pptx thu nhỏ vào `host` (thẻ), căn giữa theo chiều dọc. Trả về hàm co lại theo cỡ mới của
 * `host` (gọi khi thẻ đổi cỡ), hoặc null nếu không vẽ được.
 */
export async function pptxThumbInto(ws: Workspace, rel: string, host: HTMLElement): Promise<(() => void) | null> {
  const data = await window.stag.artifacts.bytes(ws.id, rel).catch(() => null)
  if (!data) return null
  const { loadPptx } = await import('./pptx')
  const deck = await loadPptx(data)
  if (!deck.count) return null
  const slide = await deck.render(0, document)
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  Object.assign(slide.style, { transformOrigin: '0 0', pointerEvents: 'none' })
  root.replaceChildren(slide)
  const fit = (): void => {
    const s = Math.min(host.clientWidth / deck.width, host.clientHeight / deck.height)
    slide.style.transform = `translate(${(host.clientWidth - deck.width * s) / 2}px, ${(host.clientHeight - deck.height * s) / 2}px) scale(${s})`
  }
  fit()
  return fit
}

/** Vài đoạn đầu của file Word (cho thẻ): đọc thẳng word/document.xml. */
export async function docxSnippet(ws: Workspace, rel: string): Promise<string[] | null> {
  const data = await window.stag.artifacts.bytes(ws.id, rel).catch(() => null)
  if (!data) return null
  const { default: JSZip } = await import('jszip')
  const xml = await (await JSZip.loadAsync(data)).file('word/document.xml')?.async('text')
  if (!xml) return null
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const out: string[] = []
  for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
    const t = Array.from(p.getElementsByTagNameNS('*', 't'))
      .map((e) => e.textContent ?? '')
      .join('')
    if (t.trim()) out.push(t)
    if (out.length >= 14) break
  }
  return out
}

/** Vài dòng / cột đầu của sheet đầu tiên (cho thẻ). */
export async function sheetSnippet(ws: Workspace, rel: string): Promise<string[][] | null> {
  const data = await window.stag.artifacts.bytes(ws.id, rel).catch(() => null)
  if (!data) return null
  const XLSX = await import('xlsx')
  const ext = extOf(rel)
  const wb =
    ext === 'csv' || ext === 'tsv'
      ? XLSX.read(new TextDecoder('utf-8').decode(data.subarray(0, 64 * 1024)), { type: 'string', sheetRows: 12, FS: ext === 'tsv' ? '\t' : undefined })
      : XLSX.read(data, { type: 'array', sheetRows: 12 })
  const s = wb.Sheets[wb.SheetNames[0]]
  if (!s) return null
  return (XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, raw: false, defval: '' }) as unknown[][]).map((r) => r.slice(0, 6).map((c) => String(c ?? '')))
}

// ---------- HTML (tĩnh, iframe sandbox) ----------

/**
 * Dựng trang HTML để xem tĩnh: bỏ script, gộp CSS cạnh file vào trang, đặt `<base>` để ảnh/CSS tương đối tải qua
 * `stag-file`. Iframe sandbox không cho script chạy; trang cần JavaScript thì bấm "Chạy trong Browser".
 */
export async function staticHtml(ws: Workspace, rel: string, source: string, baseRel = rel): Promise<string> {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  doc.querySelectorAll('script, noscript, meta[http-equiv], base').forEach((e) => e.remove())
  // Bản chụp (tab Sản phẩm) nằm ở .stag/artifacts/…: CSS / ảnh tương đối tính theo chỗ của file gốc (`baseRel`).
  const dir = baseRel.includes('/') ? baseRel.slice(0, baseRel.lastIndexOf('/') + 1) : ''
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? ''
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) continue
    const target = normalizeRel(dir + href.split(/[?#]/)[0])
    const css = target ? await window.stag.artifacts.text(ws.id, target).catch(() => null) : null
    if (css?.status !== 'ok') continue
    const style = doc.createElement('style')
    style.textContent = css.text
    link.replaceWith(style)
  }
  const base = doc.createElement('base')
  base.href = fileUrl(ws.id, dir || '')
  doc.head.prepend(base)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}

function normalizeRel(p: string): string | null {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '..') {
      if (!out.length) return null
      out.pop()
    } else if (seg && seg !== '.') out.push(seg)
  }
  return out.join('/')
}

export function HtmlView({ ws, rel, version, onRun, baseRel }: { ws: Workspace; rel: string; version: string; onRun: () => void; baseRel?: string }): React.JSX.Element {
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const [hasScript, setHasScript] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  useEffect(() => {
    let alive = true
    setSrcdoc(null)
    window.stag.artifacts
      .text(ws.id, rel)
      .then(async (t) => {
        if (t.status !== 'ok') throw new Error(t.status === 'missing' ? 'Không còn file này trên đĩa.' : 'File không phải văn bản.')
        setHasScript(/<script[\s>]/i.test(t.text))
        const html = await staticHtml(ws, rel, t.text, baseRel ?? rel)
        if (alive) setSrcdoc(html)
      })
      .catch((e) => alive && setFailed(cleanError(e)))
    return () => {
      alive = false
    }
  }, [ws, rel, version, baseRel])
  if (failed) return <Note>{failed}</Note>
  if (srcdoc == null) return <Loading />
  return (
    <div className="flex h-full flex-col bg-[#24282d]">
      {hasScript && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-[12px] text-muted">
          <Icon name="info" size="s" className="text-dim" />
          Trang có JavaScript — bản xem trước ở đây không chạy script.
          <button type="button" onClick={onRun} className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-0.5 text-fg hover:bg-panel-3">
            <Icon name="globe" size="s" />
            Chạy trong Browser
          </button>
        </div>
      )}
      <div className="flex shrink-0 justify-center py-2">
        <Seg
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: 'Máy tính' },
            { value: 'phone', label: 'Điện thoại' }
          ]}
        />
      </div>
      <div className="flex min-h-0 flex-1 justify-center px-5 pb-5">
        <iframe
          sandbox=""
          srcDoc={srcdoc}
          title={rel}
          className={`h-full rounded-md bg-white ${device === 'phone' ? 'w-[390px] max-w-full' : 'w-full'}`}
        />
      </div>
    </div>
  )
}

// ---------- zip ----------

export function ZipView({ ws, rel, version }: { ws: Workspace; rel: string; version: string }): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const [entries, setEntries] = useState<Array<{ name: string; dir: boolean; size: number }> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!data) return
    let alive = true
    import('jszip')
      .then(({ default: JSZip }) => JSZip.loadAsync(data))
      .then((zip) => {
        const list: Array<{ name: string; dir: boolean; size: number }> = []
        zip.forEach((name, f) => list.push({ name, dir: f.dir, size: (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0 }))
        if (alive) setEntries(list.sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch((e) => alive && setFailed(cleanError(e)))
    return () => {
      alive = false
    }
  }, [data])
  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được file nén: ${failed}`}</Note>
  if (!entries) return <Loading />
  const files = entries.filter((e) => !e.dir)
  return (
    <div className="select-text px-4 py-3 text-[12px]">
      <div className="mb-2 text-muted">
        {files.length} file · {formatSize(files.reduce((s, e) => s + e.size, 0))} khi giải nén
      </div>
      <ul className="font-mono">
        {entries.slice(0, 3000).map((e) => (
          <li key={e.name} className="flex gap-3 py-0.5">
            <span className={`truncate ${e.dir ? 'text-dim' : ''}`}>{e.name}</span>
            {!e.dir && <span className="ml-auto shrink-0 text-dim">{formatSize(e.size)}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------- font ----------

let fontSeq = 0
export function FontView({ ws, rel, version }: { ws: Workspace; rel: string; version: string }): React.JSX.Element {
  const { data, error, loading } = useBytes(ws, rel, version)
  const [family, setFamily] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!data) return
    const name = `artifact-font-${++fontSeq}`
    const face = new FontFace(name, data.slice().buffer)
    let alive = true
    face
      .load()
      .then((f) => {
        document.fonts.add(f)
        if (alive) setFamily(name)
      })
      .catch((e) => alive && setFailed(cleanError(e)))
    return () => {
      alive = false
      document.fonts.delete(face)
    }
  }, [data])
  if (loading) return <Loading />
  if (error || failed) return <Note>{error ?? `Không đọc được font: ${failed}`}</Note>
  if (!family) return <Loading />
  return (
    <div className="space-y-4 px-5 py-4 select-text" style={{ fontFamily: family }}>
      {[48, 32, 22, 16].map((s) => (
        <div key={s} style={{ fontSize: s }} className="leading-tight">
          Chữ Việt có dấu: Ắ Ộ Ữ ỷ đ — The quick brown fox 0123456789
        </div>
      ))}
      <div className="text-[18px] leading-relaxed">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz ăâêôơưđ !@#$%&amp;*()</div>
    </div>
  )
}

// ---------- còn lại: ảnh thu nhỏ của Windows ----------

export function OtherView({ ws, rel, version, reason }: { ws: Workspace; rel: string; version: string; reason?: string }): React.JSX.Element {
  const [thumb, setThumb] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    window.stag.artifacts
      .thumb(ws.id, rel)
      .then((t) => alive && setThumb(t))
      .catch(() => alive && setThumb(null))
    return () => {
      alive = false
    }
  }, [ws.id, rel, version])
  return (
    <div className="flex flex-col items-center gap-4 px-5 py-8 text-center">
      {thumb ? (
        <img src={thumb} className="max-h-[420px] max-w-full rounded border border-line" draggable={false} />
      ) : thumb === null ? (
        <span className="rounded-md border border-line-2 px-4 py-2 font-mono text-[18px] text-muted uppercase">{extOf(rel) || 'file'}</span>
      ) : null}
      <div className="max-w-[420px] text-[12px] text-muted">
        {reason ?? 'App chưa có cách xem nội dung loại file này.'} Dùng nút mở bằng ứng dụng mặc định ở đầu khung.
      </div>
    </div>
  )
}
