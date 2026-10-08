import type { VaultSearchHit } from '@shared/types'
import { highlight } from './highlight'

function Marked({ text, query }: { text: string; query: string }): React.JSX.Element {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent/25 text-fg">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  )
}

/** Kết quả tìm kiếm thay cho cây file: tên note, thư mục, vài dòng khớp (bấm để nhảy tới dòng). */
export function SearchResults({
  hits,
  query,
  selected,
  onOpen
}: {
  hits: VaultSearchHit[] | null
  query: string
  selected: string | null
  onOpen: (rel: string, line?: number) => void
}): React.JSX.Element {
  if (!hits) return <div className="px-3 text-muted">Đang tìm…</div>
  if (!hits.length) return <div className="px-3 text-muted">Không thấy note nào.</div>
  return (
    <div className="space-y-1">
      {hits.map((h) => {
        const i = h.rel.lastIndexOf('/')
        const name = h.rel.slice(i + 1).replace(/\.md$/i, '')
        const dir = i === -1 ? '' : h.rel.slice(0, i)
        return (
          <div key={h.rel} className={`px-3 py-1 ${selected === h.rel ? 'bg-panel-2' : ''}`}>
            <div className="cursor-pointer truncate text-fg hover:text-accent" onClick={() => onOpen(h.rel)} title={h.rel}>
              <Marked text={name} query={query} />
            </div>
            {dir && <div className="truncate text-[11px] text-muted">{dir}</div>}
            {h.matches.map((m) => (
              <div
                key={m.line}
                onClick={() => onOpen(h.rel, m.line)}
                className="mt-0.5 cursor-pointer rounded px-1 py-0.5 text-[12px] leading-snug break-words text-muted hover:bg-panel-2 hover:text-fg"
              >
                <span className="mr-1 text-[10px] opacity-60">{m.line}</span>
                <Marked text={m.text} query={query} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
