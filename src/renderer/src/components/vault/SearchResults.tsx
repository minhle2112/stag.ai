import type { VaultSearchHit } from '@shared/types'
import { useT } from '../../i18n'
import { Icon } from '../Icon'
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
  const t = useT()
  if (!hits) return <div className="px-3 py-1 text-dim">{t('vault.searching')}</div>
  if (!hits.length) return <div className="px-3 py-1 text-dim">{t('vault.noHits')}</div>
  return (
    <div>
      <div className="flex min-h-[30px] items-center px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">{t('vault.results', { count: hits.length })}</div>
      {hits.map((h) => {
        const i = h.rel.lastIndexOf('/')
        const name = h.rel.slice(i + 1).replace(/\.md$/i, '')
        const dir = i === -1 ? '' : h.rel.slice(0, i)
        return (
          <div key={h.rel} className={`pb-1 ${selected === h.rel ? 'bg-panel-3' : ''}`}>
            <div
              className="flex min-w-0 cursor-pointer items-center gap-1.5 px-2.5 py-[3px] text-muted hover:bg-panel-2 hover:text-fg"
              onClick={() => onOpen(h.rel)}
              data-tip={h.rel}
              data-tip-side="right"
            >
              <Icon name="file" className="text-dim" />
              <span className="min-w-0 flex-1 truncate">
                <Marked text={name} query={query} />
                {dir && <small className="ml-1.5 text-[11px] text-dim">{dir}</small>}
              </span>
            </div>
            {h.matches.map((m) => (
              <div
                key={m.line}
                onClick={() => onOpen(h.rel, m.line)}
                className="flex cursor-pointer gap-1.5 py-0.5 pr-2.5 pl-[34px] text-[12px] leading-snug break-words text-dim hover:bg-panel-2 hover:text-muted"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[11px] opacity-70">{m.line}</span>
                <span className="min-w-0">
                  <Marked text={m.text} query={query} />
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
