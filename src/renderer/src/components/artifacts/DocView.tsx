// Tài liệu chữ ở tab Sản phẩm: vẽ từng khối (id giữ qua các bản), tô chỗ có góp ý, so sánh hai bản tới từng chữ,
// bôi chọn một đoạn để góp ý (neo = id khối + vị trí ký tự trong chữ hiển thị của khối + đoạn trích).
import { useEffect, useMemo, useRef, useState } from 'react'
import { blockDiff, blockKind, locateQuote, plainBlock, wordDiff, type DocBlock } from '@shared/artifacts'
import { renderNote } from '../vault/markdown'
import { escapeHtml } from './code'
import { Mi } from './ui'

export interface RenderedBlock {
  html: string
  /** Chữ hiển thị của khối (textContent) — vị trí neo tính trên chuỗi này. */
  text: string
  depth: number
  kind: ReturnType<typeof blockKind>
}

/** Vẽ một khối thành HTML (markdown như note của Vault; chữ thường / code giữ xuống dòng). */
export function renderBlock(b: DocBlock, markdown: boolean, rel: string): RenderedBlock {
  const kind = blockKind(b.text)
  let src = b.text
  let depth = 0
  if (markdown && kind === 'list') {
    // Mục con: bỏ thụt đầu dòng (markdown-it sẽ coi ≥ 4 dấu cách là khối code) và thụt bằng CSS.
    const ind = /^\s*/.exec(src)![0].length
    depth = Math.min(6, Math.floor(ind / 2))
    src = src
      .split('\n')
      .map((l) => l.slice(Math.min(ind, /^\s*/.exec(l)![0].length)))
      .join('\n')
  }
  const html = markdown ? renderNote(src, { current: rel, notes: null }).html : `<p class="whitespace-pre-wrap font-mono text-[12.5px]">${escapeHtml(b.text)}</p>`
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  return { html, text: tpl.content.textContent ?? '', depth, kind }
}

export interface DocMark {
  id: string
  block: string
  off: number
  quote: string
  /** you / fixed / open / draft / closed */
  tone: string
  hot: boolean
}

const MARK_TONE: Record<string, string> = {
  open: 'bg-fg/7 border-b-[1.5px] border-dashed border-line-3',
  you: 'bg-wait/16 border-b-[1.5px] border-solid border-wait',
  fixed: 'bg-work/11 border-b-[1.5px] border-solid border-work',
  draft: 'bg-accent/16 border-b-[1.5px] border-solid border-accent',
  closed: 'bg-transparent border-b border-dotted border-line-3'
}
const MARK_BASE = 'cursor-pointer rounded-[2px] text-inherit'

/** Bọc các đoạn [s, e) (vị trí trong chữ hiển thị) bằng <mark>; đoạn đè lên nhau thì bỏ đoạn sau. */
export function decorate(html: string, marks: Array<{ s: number; e: number; id: string; cls: string }>): string {
  if (!marks.length) return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content
  let last = -1
  const sorted = [...marks].sort((a, b) => a.s - b.s).filter((m) => (m.s >= last && m.e > m.s ? ((last = m.e), true) : false))
  for (const m of sorted.reverse()) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const parts: Array<{ node: Text; from: number; to: number }> = []
    let pos = 0
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const len = n.data.length
      const a = Math.max(m.s, pos)
      const b = Math.min(m.e, pos + len)
      if (a < b) parts.push({ node: n, from: a - pos, to: b - pos })
      pos += len
      if (pos >= m.e) break
    }
    for (const p of parts) {
      let node = p.node
      if (p.to < node.data.length) node.splitText(p.to)
      if (p.from > 0) node = node.splitText(p.from)
      const mark = document.createElement('mark')
      mark.dataset.c = m.id
      mark.className = m.cls
      node.replaceWith(mark)
      mark.appendChild(node)
    }
  }
  const div = document.createElement('div')
  div.appendChild(root)
  return div.innerHTML
}

/** Neo của một góp ý trên bản đang xem: tìm được đúng / gần đúng / cả khối / khối đã bị bỏ. */
export function anchorMode(rendered: Map<string, RenderedBlock>, m: { block: string; off: number; quote: string }): 'exact' | 'fuzzy' | 'whole' | 'gone' {
  const r = rendered.get(m.block)
  if (!r) return 'gone'
  return locateQuote(r.text, m).mode
}

const ROW = {
  ins: 'bg-work/8 shadow-[inset_2px_0_0_var(--color-work)]',
  del: 'bg-danger/6 shadow-[inset_2px_0_0_var(--color-danger)] text-dim line-through decoration-danger/55',
  chg: 'shadow-[inset_2px_0_0_var(--color-info)]'
} as const

export function DocView({
  rel,
  markdown,
  blocks,
  rendered,
  oldBlocks,
  marks,
  onMark,
  onComment,
  onDiffSelect
}: {
  rel: string
  markdown: boolean
  blocks: DocBlock[]
  rendered: Map<string, RenderedBlock>
  /** Có = đang so sánh với bản này (không tô góp ý, không bôi chọn để góp ý). */
  oldBlocks: DocBlock[] | null
  marks: DocMark[]
  onMark: (id: string) => void
  onComment: (a: { block: string; off: number; quote: string }) => void
  /** Bôi chọn trong lúc so sánh. */
  onDiffSelect: () => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [float, setFloat] = useState<{ x: number; y: number; a: { block: string; off: number; quote: string } } | null>(null)

  const body = useMemo(() => {
    if (oldBlocks) {
      return blockDiff(oldBlocks, blocks).map((r) => {
        const b = r.block
        const rb = r.kind === 'del' ? renderBlock(b, markdown, rel) : (rendered.get(b.id) ?? renderBlock(b, markdown, rel))
        if (r.kind === 'chg') {
          const ops = wordDiff(plainBlock(r.old.text), plainBlock(b.text))
          const inner = ops
            .map((o) =>
              o.op === 'eq'
                ? escapeHtml(o.text)
                : o.op === 'ins'
                  ? `<ins class="rounded-[2px] bg-work/20 text-[#bff3d2] no-underline">${escapeHtml(o.text)}</ins>`
                  : `<del class="rounded-[2px] bg-danger/14 text-[#e9a7a1] line-through decoration-danger">${escapeHtml(o.text)}</del>`
            )
            .join('')
          const tag = rb.kind === 'heading' ? 'font-semibold text-[1.1em]' : ''
          return { id: b.id, kind: r.kind, depth: rb.depth, html: `<p class="whitespace-pre-wrap ${tag}">${inner}</p>`, list: rb.kind === 'list' }
        }
        return { id: b.id, kind: r.kind, depth: rb.depth, html: rb.html, list: rb.kind === 'list' }
      })
    }
    return blocks.map((b) => {
      const rb = rendered.get(b.id) ?? renderBlock(b, markdown, rel)
      const ms = marks
        .filter((m) => m.block === b.id)
        .map((m) => {
          const l = locateQuote(rb.text, m)
          const [s, e] = l.mode === 'whole' ? [0, rb.text.length] : [l.s, l.e]
          const cls = `${MARK_BASE} ${MARK_TONE[m.tone] ?? MARK_TONE.open} ${l.mode !== 'exact' ? 'border-dotted' : ''} ${m.hot ? 'outline-2 outline-fg/30 outline-offset-1' : ''}`
          return { s, e, id: m.id, cls }
        })
      return { id: b.id, kind: 'eq' as const, depth: rb.depth, html: decorate(rb.html, ms), list: rb.kind === 'list' }
    })
  }, [blocks, oldBlocks, rendered, marks, markdown, rel])

  // Bôi chọn → nút "+ Góp ý" nổi cạnh đoạn chọn.
  useEffect(() => {
    const up = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest?.('[data-float]')) return
      setTimeout(() => {
        const sel = getSelection()
        const el = host.current
        if (!sel || !sel.rangeCount || !el || !el.contains(sel.anchorNode)) {
          setFloat(null)
          return
        }
        const raw = sel.toString()
        const txt = raw.trim()
        if (txt.length < 2) {
          setFloat(null)
          return
        }
        if (oldBlocks) {
          setFloat(null)
          onDiffSelect()
          return
        }
        const rg = sel.getRangeAt(0)
        const start = rg.startContainer
        const blk = (start.nodeType === 1 ? (start as Element) : start.parentElement)?.closest<HTMLElement>('[data-b]')
        if (!blk || !el.contains(blk)) {
          setFloat(null)
          return
        }
        const pre = document.createRange()
        pre.selectNodeContents(blk)
        pre.setEnd(rg.startContainer, rg.startOffset)
        const off = pre.toString().length + (raw.length - raw.trimStart().length)
        const blockText = blk.textContent ?? ''
        // Chọn qua nhiều khối: neo vào khối đầu.
        const quote = (blockText.slice(off, off + txt.length) === txt ? txt : blockText.slice(off).trim()).replace(/\s+/g, ' ')
        const r = rg.getBoundingClientRect()
        setFloat({ x: Math.min(innerWidth - 130, r.right - 50), y: Math.max(44, r.top - 36), a: { block: blk.dataset.b!, off, quote } })
      }, 0)
    }
    // Cuộn khung chứa (nút nổi đặt theo toạ độ màn hình) → ẩn nút.
    const scrolled = (): void => setFloat(null)
    document.addEventListener('mouseup', up)
    document.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('mouseup', up)
      document.removeEventListener('scroll', scrolled, true)
    }
  }, [oldBlocks, onDiffSelect])

  // Phím C khi đang có đoạn chọn.
  useEffect(() => {
    if (!float) return
    const key = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable) return
      if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        start(float.a)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const start = (a: { block: string; off: number; quote: string }): void => {
    setFloat(null)
    try {
      getSelection()?.removeAllRanges()
    } catch {
      // bỏ qua
    }
    onComment(a)
  }

  return (
    <>
      <div
        ref={host}
        onClick={(e) => {
          const m = (e.target as HTMLElement).closest<HTMLElement>('mark[data-c]')
          if (m && !getSelection()?.toString().trim()) onMark(m.dataset.c!)
          const a = (e.target as HTMLElement).closest('a')
          if (a) {
            e.preventDefault()
            const href = a.getAttribute('href') ?? ''
            if (/^https?:/i.test(href)) window.open(href)
          }
        }}
        className="md-body mx-auto my-[22px] mb-[70px] max-w-[760px] rounded-[10px] border border-line bg-panel px-[38px] py-7 text-[13.5px] leading-[1.7] select-text"
      >
        {body.map((r, i) => (
          <div
            key={`${r.id}-${r.kind}-${i}`}
            data-b={r.kind === 'del' ? undefined : r.id}
            data-chg={r.kind !== 'eq' ? r.kind : undefined}
            className={`rounded ${r.kind !== 'eq' ? `-mx-2.5 px-2.5 ${ROW[r.kind]}` : ''} ${r.list ? '[&>ol]:my-0.5 [&>ul]:my-0.5' : ''} [&>*:first-child]:mt-0`}
            style={r.depth ? { paddingLeft: r.depth * 18 + (r.kind !== 'eq' ? 10 : 0) } : undefined}
            dangerouslySetInnerHTML={{ __html: r.html }}
          />
        ))}
        {!body.length && <p className="text-dim">Tài liệu trống.</p>}
      </div>
      {float && (
        <button
          type="button"
          data-float
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => start(float.a)}
          style={{ left: float.x, top: float.y }}
          className="fixed z-40 inline-flex items-center gap-1.5 rounded-[7px] border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-on shadow-[0_8px_24px_rgba(0,0,0,.5)]"
        >
          <Mi name="cmt" /> Góp ý <span className="rounded border border-b-2 border-black/40 px-1 font-mono text-[10.5px]">C</span>
        </button>
      )}
    </>
  )
}
