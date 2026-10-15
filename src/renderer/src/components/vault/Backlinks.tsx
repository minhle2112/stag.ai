import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultIndex } from '@shared/types'
import { useT } from '../../i18n'
import { snippetAt } from './snippet'

function split(rel: string): { name: string; dir: string } {
  const i = rel.lastIndexOf('/')
  return { name: rel.slice(i + 1).replace(/\.md$/i, ''), dir: i === -1 ? '' : rel.slice(0, i) }
}

const snippetKey = (from: string, line: number): string => `${from}:${line}`

/** Tối đa chừng này note nguồn được đọc để lấy dòng ngữ cảnh (còn lại chỉ hiện "dòng N"). */
const SNIPPET_MAX = 30

function Heading({ children, count }: { children: string; count: number }): React.JSX.Element {
  return (
    <h4 className="flex min-h-[30px] items-center gap-1.5 px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">
      {children} · {count}
    </h4>
  )
}

/**
 * Cột phải của Vault: LIÊN KẾT NGƯỢC (note nào link tới note đang mở, kèm dòng chứa link) và LIÊN KẾT RA
 * (note nào note đang mở link tới; link chưa có note mờ đi).
 */
export function Backlinks({
  index,
  current,
  vaultPath,
  changed,
  onOpen
}: {
  index: VaultIndex
  current: string | null
  vaultPath: string
  /** Tăng mỗi khi vault đổi: đọc lại dòng ngữ cảnh. */
  changed: number
  onOpen: (rel: string, line?: number) => void
}): React.JSX.Element {
  const t = useT()
  const { incoming, outgoing } = useMemo(() => {
    const byFrom = new Map<string, number[]>()
    const out = new Map<string, { rel: string | null; name: string; line: number }>()
    for (const l of current ? index.links : []) {
      if (l.to === current && l.from !== current) {
        const lines = byFrom.get(l.from) ?? []
        if (!lines.includes(l.line)) lines.push(l.line)
        byFrom.set(l.from, lines)
      }
      if (l.from === current && l.to !== current) {
        const key = l.to ?? `ghost:${l.target.toLowerCase()}`
        const seen = out.get(key)
        if (!seen || l.line < seen.line) out.set(key, { rel: l.to, name: l.to ? split(l.to).name : l.target, line: l.line })
      }
    }
    const incoming = [...byFrom]
      .map(([from, lines]) => ({ from, lines: lines.sort((a, b) => a - b) }))
      .sort((a, b) => split(a.from).name.localeCompare(split(b.from).name, 'vi', { numeric: true }))
    return { incoming, outgoing: [...out.values()].sort((a, b) => a.line - b.line) }
  }, [index, current])

  // Dòng ngữ cảnh của link: đọc note nguồn (chỉ đọc, qua IPC có sẵn). Giữ chữ cũ trong lúc đọc lại.
  const [snippets, setSnippets] = useState<Record<string, string>>({})
  const wanted = useMemo(() => incoming.slice(0, SNIPPET_MAX).map((i) => ({ key: snippetKey(i.from, i.lines[0]), from: i.from, line: i.lines[0] })), [incoming])
  const wantedRef = useRef(wanted)
  wantedRef.current = wanted
  const wantedKey = JSON.stringify(wanted.map((w) => w.key))
  useEffect(() => {
    let alive = true
    for (const w of wantedRef.current) {
      window.stag.vault.read(vaultPath, w.from).then(
        (text) => {
          const snip = snippetAt(text, w.line)
          if (alive) setSnippets((s) => (s[w.key] === snip ? s : { ...s, [w.key]: snip }))
        },
        () => undefined
      )
    }
    return () => {
      alive = false
    }
  }, [vaultPath, wantedKey, changed])

  return (
    <>
      <Heading count={incoming.length}>{t('vault.backlinks')}</Heading>
      {incoming.length === 0 && <div className="px-3 py-1 text-[12px] text-dim">{t('vault.none')}</div>}
      {incoming.map(({ from, lines }) => {
        const { name, dir } = split(from)
        const snippet = snippets[snippetKey(from, lines[0])]
        return (
          <button
            key={from}
            type="button"
            onClick={() => onOpen(from, lines[0])}
            data-tip={t('vault.lineTip', { from, lines: lines.join(', ') })}
            className="block w-full px-3 py-[5px] text-left text-[12px] hover:bg-panel-2"
          >
            <span className="flex items-baseline gap-1.5">
              <span className="min-w-0 truncate text-fg">{name}</span>
              {lines.length > 1 && <span className="shrink-0 font-mono text-[11px] text-dim">({lines.length})</span>}
            </span>
            <small className="block truncate text-[11px] text-dim">{snippet || (dir ? t('vault.dirLine', { dir, line: String(lines[0]) }) : t('vault.line', { line: String(lines[0]) }))}</small>
          </button>
        )
      })}

      <Heading count={outgoing.length}>{t('vault.outgoing')}</Heading>
      {outgoing.length === 0 && <div className="px-3 py-1 text-[12px] text-dim">{t('vault.none')}</div>}
      {outgoing.map((o) =>
        o.rel ? (
          <button
            key={o.rel}
            type="button"
            onClick={() => onOpen(o.rel!)}
            data-tip={o.rel}
            className="block w-full truncate px-3 py-[5px] text-left text-[12px] text-fg hover:bg-panel-2"
          >
            {o.name}
          </button>
        ) : (
          <div key={`ghost:${o.name.toLowerCase()}`} className="px-3 py-[5px] text-[12px] text-dim" data-tip={t('vault.ghostTip')}>
            <div className="truncate">{o.name}</div>
            <small className="block text-[11px]">{t('vault.ghost')}</small>
          </div>
        )
      )}
    </>
  )
}
