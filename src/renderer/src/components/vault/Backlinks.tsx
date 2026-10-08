import { useMemo } from 'react'
import type { VaultIndex } from '@shared/types'

function split(rel: string): { name: string; dir: string } {
  const i = rel.lastIndexOf('/')
  return { name: rel.slice(i + 1).replace(/\.md$/i, ''), dir: i === -1 ? '' : rel.slice(0, i) }
}

/** Dưới note: các note có link tới note đang mở (gom theo note nguồn) và link đi ra chưa có note. */
export function Backlinks({
  index,
  current,
  onOpen
}: {
  index: VaultIndex
  current: string
  onOpen: (rel: string, line?: number) => void
}): React.JSX.Element {
  const { incoming, ghosts } = useMemo(() => {
    const byFrom = new Map<string, number[]>()
    const ghostSet = new Set<string>()
    for (const l of index.links) {
      if (l.to === current && l.from !== current) {
        const lines = byFrom.get(l.from) ?? []
        if (!lines.includes(l.line)) lines.push(l.line)
        byFrom.set(l.from, lines)
      }
      if (l.from === current && l.to === null) ghostSet.add(l.target)
    }
    const incoming = [...byFrom].sort(([a], [b]) => split(a).name.localeCompare(split(b).name, 'vi', { numeric: true }))
    return { incoming, ghosts: [...ghostSet].sort((a, b) => a.localeCompare(b, 'vi')) }
  }, [index, current])

  return (
    <section className="mt-8 border-t border-line pt-3 text-[12px]">
      <div className="mb-2 font-semibold text-muted">Liên kết tới note này ({incoming.length})</div>
      {incoming.length === 0 && <div className="text-muted">Chưa có note nào link tới đây.</div>}
      <ul className="space-y-1">
        {incoming.map(([from, lines]) => {
          const { name, dir } = split(from)
          return (
            <li key={from} className="flex flex-wrap items-baseline gap-x-2">
              <button className="text-accent hover:underline" onClick={() => onOpen(from)}>
                {name}
              </button>
              {dir && <span className="text-muted">{dir}</span>}
              {lines.map((line) => (
                <button key={line} className="text-[11px] text-muted hover:text-fg" onClick={() => onOpen(from, line)}>
                  dòng {line}
                </button>
              ))}
            </li>
          )
        })}
      </ul>
      {ghosts.length > 0 && (
        <>
          <div className="mt-4 mb-1 font-semibold text-muted">Link chưa có note ({ghosts.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {ghosts.map((g) => (
              <span key={g} title="Chưa có note" className="rounded border border-dashed border-line px-1.5 py-0.5 text-muted">
                {g}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
