import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { VaultActivity, VaultNode, VaultSearchHit, Workspace } from '@shared/types'
import { resolveNote } from '@shared/wikilink'
import { ago } from '../status'
import { useVaultActivity } from '../store/vaultActivity'
import { useVaultIndex } from '../vaultIndex'
import { Button, Modal } from './Modal'
import { agentColor, RECENT_MS, touchesByNote, type NoteTouch } from './vault/activity'
import { Backlinks } from './vault/Backlinks'
import { GraphView } from './vault/GraphView'
import { renderNote } from './vault/markdown'
import { NoteEditor } from './vault/NoteEditor'
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

  /** Chế độ sửa (giữ nguyên khi chuyển note, như Obsidian). */
  const [editing, setEditing] = useState(false)
  const [newNote, setNewNote] = useState(false)
  /** Cột trái: cây note hay nhật ký agent đọc/ghi. */
  const [side, setSide] = useState<'tree' | 'activity'>('tree')

  // Agent đọc / ghi note nào (từ hook); "gần đây" mờ dần theo đồng hồ.
  const events = useVaultActivity((s) => s.byWs[workspace.id])
  const loadActivity = useVaultActivity((s) => s.load)
  useEffect(() => {
    loadActivity(workspace.id)
  }, [workspace.id, loadActivity])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const recent = useMemo(() => touchesByNote(events ?? [], Date.now() - RECENT_MS), [events, now])
  const allTouches = useMemo(() => touchesByNote(events ?? []), [events])

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
  const canEdit = view === 'note' && !!doc && doc.text !== null && doc.rel === current
  const toggleEditRef = useRef(() => {})
  toggleEditRef.current = () => {
    if (canEdit || editing) setEditing(!editing)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Ctrl+E: đổi Xem ↔ Sửa (như Obsidian).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        toggleEditRef.current()
        return
      }
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
          {view === 'note' && (
            <Button onClick={() => toggleEditRef.current()} disabled={!canEdit && !editing}>
              <span title="Ctrl+E">{editing ? 'Xem' : 'Sửa'}</span>
            </Button>
          )}
          <Button onClick={() => setNewNote(true)}>Note mới</Button>
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
          {!query.trim() && (
            <div className="flex shrink-0 gap-1 px-2 pb-1.5 text-[12px]">
              {(['tree', 'activity'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  className={`rounded px-2 py-0.5 ${side === s ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {s === 'tree' ? 'Note' : `Agent đọc/ghi${recent.size ? ` (${recent.size})` : ''}`}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {query.trim() ? (
              <SearchResults hits={hits} query={query.trim()} selected={current} onOpen={openAt} />
            ) : side === 'activity' ? (
              <ActivityList
                events={events ?? []}
                now={now}
                selected={current}
                onOpen={(rel) => open(index?.notes.find((n) => n.rel.toLowerCase() === rel.toLowerCase())?.rel ?? rel)}
              />
            ) : (
              <>
                {tree.length === 0 && <div className="px-3 text-muted">Vault trống hoặc không tồn tại.</div>}
                <Tree nodes={tree} depth={0} selected={current} onSelect={open} recent={recent} now={now} />
              </>
            )}
            {error && <div className="mt-2 px-3 text-[11px] text-red-400">Không đọc được chỉ mục: {error}</div>}
          </div>
        </nav>
        {view === 'graph' ? (
          <div className="relative min-w-0 flex-1">
            {index ? (
              <GraphView index={index} current={current} onOpen={(rel) => open(rel)} activity={recent} />
            ) : (
              <div className="p-4 text-muted">Đang đọc vault…</div>
            )}
          </div>
        ) : editing && doc && doc.rel === current ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <NoteTouches touches={allTouches.get(doc.rel.toLowerCase())} now={now} className="border-b border-line px-6 py-1.5" />
            <div className="min-h-0 flex-1">
              <NoteEditor key={doc.rel} vaultPath={vaultPath} rel={doc.rel} disk={doc.text} notes={index?.notes ?? null} />
            </div>
          </div>
        ) : (
          <article ref={scrollerRef} className="min-w-0 flex-1 overflow-y-auto px-6 py-4 select-text">
            {!current ? (
              <div className="text-muted">Chọn một note bên trái.</div>
            ) : doc ? (
              <div className="mx-auto max-w-3xl">
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                  <span>{doc.rel}</span>
                  <NoteTouches touches={allTouches.get(doc.rel.toLowerCase())} now={now} />
                </div>
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

      {newNote && (
        <NewNoteDialog
          vaultPath={vaultPath}
          folders={folderList(tree)}
          initialFolder={current?.includes('/') ? current.slice(0, current.lastIndexOf('/')) : ''}
          onCancel={() => setNewNote(false)}
          onCreated={(rel) => {
            setNewNote(false)
            setReload((n) => n + 1)
            setEditing(true)
            open(rel)
          }}
        />
      )}
    </div>
  )
}

/** Mọi thư mục trong cây ('' = gốc vault). */
function folderList(nodes: VaultNode[]): string[] {
  const out = ['']
  const walk = (ns: VaultNode[]): void => {
    for (const n of ns)
      if (n.dir) {
        out.push(n.rel)
        walk(n.children ?? [])
      }
  }
  walk(nodes)
  return out
}

function NewNoteDialog({
  vaultPath,
  folders,
  initialFolder,
  onCancel,
  onCreated
}: {
  vaultPath: string
  folders: string[]
  initialFolder: string
  onCancel: () => void
  onCreated: (rel: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(folders.includes(initialFolder) ? initialFolder : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(): Promise<void> {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      onCreated(await window.stag.vault.create(vaultPath, folder, name))
    } catch (e) {
      setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Note mới"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={submit} disabled={busy || !name.trim()}>
            Tạo và sửa
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Tên note</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="vd. Login flow"
          className="mb-4 w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
        />
        <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Thư mục</div>
        <select
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          className="w-full rounded-md border border-line bg-bg px-2 py-1.5 outline-none focus:border-accent"
        >
          {folders.map((f) => (
            <option key={f} value={f}>
              {f || '(gốc vault)'}
            </option>
          ))}
        </select>
        <p className="mt-3 text-[12px] text-muted">Vault viết bằng tiếng Anh (quy ước của dự án): tên và nội dung note nên là tiếng Anh.</p>
        {error && <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>}
      </form>
    </Modal>
  )
}

const kindLabel = (k: 'read' | 'write'): string => (k === 'write' ? 'ghi' : 'đọc')

/** Chấm màu của agent: ghi = chấm đặc, đọc = vòng rỗng. */
function TouchDot({ touch }: { touch: NoteTouch }): React.JSX.Element {
  const c = agentColor(touch.agentId)
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={touch.kind === 'write' ? { backgroundColor: c } : { border: `1.5px solid ${c}` }}
    />
  )
}

/** "● Coder ghi · 2 phút" cho note đang xem (từ lúc mở app). */
function NoteTouches({ touches, now, className = '' }: { touches?: NoteTouch[]; now: number; className?: string }): React.JSX.Element | null {
  if (!touches?.length) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted ${className}`}>
      {touches.map((t) => (
        <span key={t.agentId} className="flex items-center gap-1" title={`${t.agentName} ${kindLabel(t.kind)} note này lúc ${new Date(t.at).toLocaleTimeString()}`}>
          <TouchDot touch={t} />
          <span className="text-fg/80">{t.agentName}</span> {kindLabel(t.kind)} · {ago(t.at, now)}
        </span>
      ))}
    </div>
  )
}

/** Nhật ký agent đọc / ghi note, mới nhất trước. */
function ActivityList({
  events,
  now,
  selected,
  onOpen
}: {
  events: VaultActivity[]
  now: number
  selected: string | null
  onOpen: (rel: string) => void
}): React.JSX.Element {
  if (!events.length)
    return <div className="px-3 text-[12px] text-muted">Chưa có agent nào đọc/ghi note từ lúc mở app. Hoạt động hiện ở đây khi agent làm việc.</div>
  return (
    <>
      {[...events]
        .reverse()
        .slice(0, 150)
        .map((e, i) => {
          const name = e.rel.replace(/\.md$/i, '')
          return (
            <div
              key={`${e.at}-${i}`}
              onClick={() => onOpen(e.rel)}
              title={e.rel}
              className={`cursor-pointer px-3 py-1 ${selected?.toLowerCase() === e.rel.toLowerCase() ? 'bg-panel-2' : 'hover:bg-panel-2/60'}`}
            >
              <div className="flex items-center gap-1.5 text-[12px]">
                <TouchDot touch={e} />
                <span className="text-fg/90">{e.agentName}</span>
                <span className="text-muted">{kindLabel(e.kind)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted">{ago(e.at, now)}</span>
              </div>
              <div className="truncate pl-3.5 text-[12px] text-muted">{name.slice(name.lastIndexOf('/') + 1)}</div>
            </div>
          )
        })}
    </>
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

interface TreeProps {
  nodes: VaultNode[]
  depth: number
  selected: string | null
  onSelect: (rel: string) => void
  /** Agent vừa đọc / ghi note nào (khoá = rel chữ thường). */
  recent: Map<string, NoteTouch[]>
  now: number
}

function Tree({ nodes, depth, selected, onSelect, recent, now }: TreeProps): React.JSX.Element {
  return (
    <>
      {nodes.map((n) =>
        n.dir ? (
          <Folder key={n.rel} node={n} depth={depth} selected={selected} onSelect={onSelect} recent={recent} now={now} />
        ) : (
          <div
            key={n.rel}
            onClick={() => onSelect(n.rel)}
            style={{ paddingLeft: 12 + depth * 14 }}
            title={touchTitle(recent.get(n.rel.toLowerCase()), now)}
            className={`flex cursor-pointer items-center gap-1.5 py-1 pr-2 ${selected === n.rel ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            {recent.get(n.rel.toLowerCase())?.slice(0, 3).map((t) => <TouchDot key={t.agentId} touch={t} />)}
          </div>
        )
      )}
    </>
  )
}

function Folder({ node, depth, selected, onSelect, recent, now }: Omit<TreeProps, 'nodes'> & { node: VaultNode }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div onClick={() => setOpen(!open)} style={{ paddingLeft: 12 + depth * 14 }} className="cursor-pointer truncate py-1 pr-2 text-fg">
        <span className="inline-block w-3 text-muted">{open ? '▾' : '▸'}</span>
        {node.name}
      </div>
      {open && node.children && <Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} recent={recent} now={now} />}
    </>
  )
}

function touchTitle(touches: NoteTouch[] | undefined, now: number): string | undefined {
  return touches?.map((t) => `${t.agentName} ${kindLabel(t.kind)} · ${ago(t.at, now)}`).join('\n')
}
