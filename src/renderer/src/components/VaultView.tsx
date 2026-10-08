import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { VaultNode, VaultSearchHit, Workspace } from '@shared/types'
import { resolveNote } from '@shared/wikilink'
import { useVaultIndex } from '../vaultIndex'
import { Button, Modal } from './Modal'
import { Backlinks } from './vault/Backlinks'
import { GraphView } from './vault/GraphView'
import { renderNote } from './vault/markdown'
import { scrollToTarget, type ScrollTarget } from './vault/scroll'
import { SearchResults } from './vault/SearchResults'

/** Một bước trong lịch sử xem note; `top` = vị trí cuộn lúc rời đi (để Lùi/Tiến quay về đúng chỗ). */
interface HistEntry {
  rel: string
  top: number
}

/** Note đang hiện: `text` null = không đọc được (đã bị xoá hoặc đổi tên). */
interface Doc {
  rel: string
  text: string | null
}

export function VaultView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { vaultPath } = workspace
  const [tree, setTree] = useState<VaultNode[]>([])
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [guide, setGuide] = useState(false)
  const [view, setView] = useState<'note' | 'graph'>('note')
  const { index, tick, error } = useVaultIndex(vaultPath)
  // Vault tự báo khi đổi (tick); nút "Làm mới" để dự phòng khi không theo dõi được (vd. vault tạo sau khi mở tab).
  const [reload, setReload] = useState(0)
  const changed = tick + reload

  const [hist, setHist] = useState<{ entries: HistEntry[]; pos: number }>({ entries: [], pos: -1 })
  const current = hist.entries[hist.pos]?.rel ?? null
  const [doc, setDoc] = useState<Doc | null>(null)
  const loaded = useRef<Doc | null>(null)
  const pending = useRef<ScrollTarget | null>(null)
  const scrollerRef = useRef<HTMLElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<VaultSearchHit[] | null>(null)

  const loadTree = useCallback(() => {
    window.stag.vault.tree(vaultPath).then(setTree, () => setTree([]))
  }, [vaultPath])

  const checkRegistered = useCallback(() => {
    window.stag.vault.isRegistered(vaultPath).then(setRegistered, () => setRegistered(null))
  }, [vaultPath])

  // Quay lại app (vd. sau khi đăng ký vault trong Obsidian) thì kiểm lại.
  useEffect(() => {
    checkRegistered()
    window.addEventListener('focus', checkRegistered)
    return () => window.removeEventListener('focus', checkRegistered)
  }, [checkRegistered])

  // Cây file đọc lại mỗi khi vault đổi.
  useEffect(() => loadTree(), [loadTree, changed])

  /** Mở note (thêm vào lịch sử). Cùng note đang mở thì chỉ cuộn. */
  const open = useCallback(
    (rel: string, target?: ScrollTarget) => {
      if (rel === current && view === 'note') {
        if (target && scrollerRef.current && bodyRef.current) scrollToTarget(scrollerRef.current, bodyRef.current, target)
        return
      }
      const top = scrollerRef.current?.scrollTop ?? 0
      pending.current = target ?? { top: 0 }
      setView('note')
      setHist((h) => {
        if (h.entries[h.pos]?.rel === rel) return h
        const entries = h.entries.slice(0, h.pos + 1)
        if (h.pos >= 0) entries[h.pos] = { ...entries[h.pos], top }
        entries.push({ rel, top: 0 })
        return { entries, pos: entries.length - 1 }
      })
    },
    [current, view]
  )

  const go = useCallback(
    (delta: number) => {
      const pos = hist.pos + delta
      if (pos < 0 || pos >= hist.entries.length) return
      const entries = [...hist.entries]
      entries[hist.pos] = { ...entries[hist.pos], top: scrollerRef.current?.scrollTop ?? 0 }
      pending.current = { top: entries[pos].top }
      setView('note')
      setHist({ entries, pos })
    },
    [hist]
  )

  // Lùi/Tiến: Alt+←/→ và nút chuột 4/5.
  const goRef = useRef(go)
  goRef.current = go
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        goRef.current(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        goRef.current(e.button === 3 ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  // Mặc định mở _INDEX.md.
  useEffect(() => {
    if (!current && tree.some((n) => n.rel === '_INDEX.md')) open('_INDEX.md')
  }, [tree, current, open])

  // Đọc note đang mở; vault đổi (tick) thì đọc lại và giữ vị trí cuộn.
  useEffect(() => {
    if (!current) return
    let alive = true
    const show = (text: string | null): void => {
      if (!alive) return
      const prev = loaded.current
      if (prev?.rel === current && prev.text === text) return // nội dung không đổi
      loaded.current = { rel: current, text }
      if (prev?.rel === current && !pending.current) pending.current = { top: scrollerRef.current?.scrollTop ?? 0 }
      setDoc({ rel: current, text })
    }
    window.stag.vault.read(vaultPath, current).then(show, () => show(null))
    return () => {
      alive = false
    }
  }, [vaultPath, current, changed])

  const html = useMemo(
    () => (doc?.text != null ? renderNote(doc.text, { current: doc.rel, notes: index?.notes ?? null }).html : ''),
    [doc, index]
  )

  // Note mới hiện ra (hoặc vừa đọc lại) → cuộn tới chỗ đã hẹn.
  useLayoutEffect(() => {
    const t = pending.current
    if (!t || view !== 'note' || !doc || doc.rel !== current || !scrollerRef.current || !bodyRef.current) return
    pending.current = null
    scrollToTarget(scrollerRef.current, bodyRef.current, t)
  }, [html, doc, current, view])

  // Tìm kiếm (gõ xong 200ms mới gọi); vault đổi thì tìm lại.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      window.stag.vault.search(vaultPath, q).then(
        (h) => alive && setHits(h),
        () => alive && setHits([])
      )
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [vaultPath, query, changed])

  /** Bấm trong note: chặn mọi điều hướng mặc định, tự xử lý link. */
  function onBodyClick(e: React.MouseEvent): void {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const href = a.dataset.href
    if (href) {
      if (/^(https?|mailto):/i.test(href)) window.open(href)
      return
    }
    const target = a.dataset.target
    if (target === undefined || !doc || !index) return
    const rel = resolveNote(target, doc.rel, index.notes)
    if (!rel) return // note "ma"
    open(rel, a.dataset.heading ? { heading: a.dataset.heading, flash: true } : undefined)
  }

  const openAt = useCallback((rel: string, line?: number) => open(rel, line ? { line, flash: true } : undefined), [open])

  async function openObsidian(): Promise<void> {
    const r = await window.stag.vault.openInObsidian(vaultPath)
    if (r.status === 'needs-register') setGuide(true)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="flex shrink-0">
          <NavButton label="←" title="Lùi (Alt+←)" disabled={hist.pos <= 0} onClick={() => go(-1)} />
          <NavButton label="→" title="Tiến (Alt+→)" disabled={hist.pos >= hist.entries.length - 1} onClick={() => go(1)} />
        </div>
        <span className="min-w-0 truncate text-muted" title={vaultPath}>
          {vaultPath}
        </span>
        {registered !== null && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${registered ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel-2 text-muted'}`}>
            {registered ? 'đã đăng ký Obsidian' : 'chưa đăng ký Obsidian'}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
          {(['note', 'graph'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[12px] ${view === v ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
            >
              {v === 'note' ? 'Note' : 'Graph'}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={() => {
              setReload((n) => n + 1)
              checkRegistered()
            }}
          >
            Làm mới
          </Button>
          <Button onClick={() => window.stag.openFolder(vaultPath)}>Mở thư mục</Button>
          <Button primary onClick={openObsidian}>
            Mở trong Obsidian
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col border-r border-line">
          <div className="shrink-0 p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Tìm trong vault…"
              spellCheck={false}
              className="w-full rounded-md border border-line bg-panel px-2 py-1 text-[12px] outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {query.trim() ? (
              <SearchResults hits={hits} query={query.trim()} selected={current} onOpen={openAt} />
            ) : (
              <>
                {tree.length === 0 && <div className="px-3 text-muted">Vault trống hoặc không tồn tại.</div>}
                <Tree nodes={tree} depth={0} selected={current} onSelect={open} />
              </>
            )}
            {error && <div className="mt-2 px-3 text-[11px] text-red-400">Không đọc được chỉ mục: {error}</div>}
          </div>
        </nav>
        {view === 'graph' ? (
          <div className="relative min-w-0 flex-1">
            {index ? <GraphView index={index} current={current} onOpen={(rel) => open(rel)} /> : <div className="p-4 text-muted">Đang đọc vault…</div>}
          </div>
        ) : (
          <article ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-4 select-text">
            {!current ? (
              <div className="text-muted">Chọn một note bên trái.</div>
            ) : doc ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 text-[11px] text-muted">{doc.rel}</div>
                {doc.text === null ? (
                  <div className="rounded-md border border-line bg-panel px-3 py-2 text-muted">Note đã bị xoá hoặc đổi tên.</div>
                ) : (
                  <div ref={bodyRef} className="md-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
                )}
                {index && doc.text !== null && <Backlinks index={index} current={doc.rel} onOpen={openAt} />}
              </div>
            ) : (
              <div className="text-muted">Đang mở…</div>
            )}
          </article>
        )}
      </div>

      {guide && (
        <Modal
          title="Đăng ký vault trong Obsidian (chỉ cần làm 1 lần)"
          onClose={() => setGuide(false)}
          footer={
            <>
              <Button onClick={() => setGuide(false)}>Đóng</Button>
              <Button
                primary
                onClick={async () => {
                  const ok = await window.stag.vault.isRegistered(vaultPath)
                  setRegistered(ok)
                  if (ok) {
                    setGuide(false)
                    window.stag.vault.openInObsidian(vaultPath)
                  }
                }}
              >
                Tôi đã đăng ký xong — mở vault
              </Button>
            </>
          }
        >
          <p className="mb-3 text-muted">
            Obsidian chưa biết vault này, và không có cách mở thẳng một vault chưa đăng ký. App đã mở Obsidian và{' '}
            <b className="text-fg">chép sẵn đường dẫn vault vào clipboard</b>.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Trong Obsidian, bấm tên vault ở góc dưới bên trái → <b>Manage vaults…</b>
            </li>
            <li>
              Ở mục <b>Open folder as vault</b>, bấm <b>Open</b>.
            </li>
            <li>
              Dán đường dẫn (<kbd>Ctrl</kbd>+<kbd>V</kbd>) vào ô địa chỉ của hộp chọn thư mục → <b>Select Folder</b>.
            </li>
          </ol>
          <div className="mt-3 rounded-md bg-panel-2 px-2 py-1.5 font-mono text-[12px] break-all">{vaultPath}</div>
          {registered === false && <p className="mt-3 text-[12px] text-muted">Chưa thấy vault trong danh sách của Obsidian.</p>}
        </Modal>
      )}
    </div>
  )
}

function NavButton({ label, title, disabled, onClick }: { label: string; title: string; disabled: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded px-1.5 py-0.5 text-[14px] text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
    >
      {label}
    </button>
  )
}

function Tree({
  nodes,
  depth,
  selected,
  onSelect
}: {
  nodes: VaultNode[]
  depth: number
  selected: string | null
  onSelect: (rel: string) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) =>
        n.dir ? (
          <Folder key={n.rel} node={n} depth={depth} selected={selected} onSelect={onSelect} />
        ) : (
          <div
            key={n.rel}
            onClick={() => onSelect(n.rel)}
            style={{ paddingLeft: 12 + depth * 14 }}
            className={`cursor-pointer truncate py-1 pr-2 ${selected === n.rel ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {n.name}
          </div>
        )
      )}
    </>
  )
}

function Folder({
  node,
  depth,
  selected,
  onSelect
}: {
  node: VaultNode
  depth: number
  selected: string | null
  onSelect: (rel: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div onClick={() => setOpen(!open)} style={{ paddingLeft: 12 + depth * 14 }} className="cursor-pointer truncate py-1 pr-2 text-fg">
        <span className="inline-block w-3 text-muted">{open ? '▾' : '▸'}</span>
        {node.name}
      </div>
      {open && node.children && <Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </>
  )
}
