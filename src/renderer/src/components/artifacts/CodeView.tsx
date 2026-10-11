import { useEffect, useMemo, useRef, useState } from 'react'
import { highlightLines, splitLines, symbolsOf } from './code'

/** Chiều cao một dòng (px). Cố định để cuộn tới một dòng chỉ cần phép nhân, không cần một phần tử cho mỗi dòng. */
const LINE_H = 20
/** Đệm trên của khung code (py-2). */
const PAD_Y = 8

/**
 * Code / văn bản thường: số dòng, tô màu nhẹ, và cột "CẤU TRÚC" bên phải (hàm, class, tiêu đề…) khi file có.
 * Cột phải tự ẩn khi khung xem hẹp (container query của khung `@container` chứa nó).
 */
export function CodeView({ text, rel }: { text: string; rel: string }): React.JSX.Element {
  const lines = useMemo(() => splitLines(text), [text])
  const html = useMemo(() => highlightLines(lines, rel).join('\n'), [lines, rel])
  const gutter = useMemo(() => lines.map((_, i) => i + 1).join('\n'), [lines])
  const symbols = useMemo(() => symbolsOf(lines, rel), [lines, rel])
  const scroller = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState<number | null>(null)

  useEffect(() => {
    if (flash == null) return
    const t = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(t)
  }, [flash])

  const goTo = (line: number): void => {
    const el = scroller.current
    if (el) el.scrollTop = Math.max(0, PAD_Y + (line - 1) * LINE_H - el.clientHeight / 2 + LINE_H / 2)
    setFlash(line)
  }

  return (
    <div className="flex h-full min-h-0">
      <div ref={scroller} className="min-w-0 flex-1 overflow-auto">
        <div className="relative flex min-w-max font-mono text-[12px] leading-[20px]">
          <pre className="sticky left-0 z-[1] w-12 shrink-0 bg-panel py-2 pr-3.5 text-right text-dim select-none">{gutter}</pre>
          {/* `html` do code.ts sinh ra: mọi đoạn chữ của file đã escape, chỉ có <span class> do ta thêm. */}
          <pre className="py-2 pr-4 pl-3.5 whitespace-pre select-text text-fg" dangerouslySetInnerHTML={{ __html: html }} />
          {flash != null && (
            <div
              className="pointer-events-none absolute inset-x-0 z-[2] border-l-2 border-accent bg-accent/10"
              style={{ top: PAD_Y + (flash - 1) * LINE_H, height: LINE_H }}
            />
          )}
        </div>
      </div>
      {symbols.length > 0 && (
        <aside className="hidden w-[232px] shrink-0 overflow-y-auto border-l border-line bg-bg py-1 @[640px]:block">
          <h4 className="flex min-h-[30px] items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">
            CẤU TRÚC · {symbols.length}
            <span className="flex-1" />
            <span className="font-mono font-normal tracking-normal">{lines.length} dòng</span>
          </h4>
          {symbols.map((s) => (
            <button
              key={`${s.line}:${s.name}`}
              type="button"
              onClick={() => goTo(s.line)}
              className="flex w-full items-center gap-2 py-1 pr-3 text-left font-mono text-[12px] whitespace-nowrap text-muted hover:bg-panel-2 hover:text-fg"
              style={{ paddingLeft: 12 + s.depth * 10 }}
            >
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <small className="text-[11px] text-dim">{s.line}</small>
            </button>
          ))}
        </aside>
      )}
    </div>
  )
}
