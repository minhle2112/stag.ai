import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { VaultActivity, VaultNode, VaultSearchHit, Workspace } from '@shared/types'
import { resolveNote } from '@shared/wikilink'
import { ago } from '../status'
import { useUi } from '../store/ui'
import { fmtDate, fmtDateTime, fmtTime, useLocale, useT } from '../i18n'
import { useVaultActivity } from '../store/vaultActivity'
import { useVaultIndex } from '../vaultIndex'
import { Icon } from './Icon'
import { Button, Modal } from './Modal'
import { IconButton } from './shell/IconButton'
import { AgentAvatar } from './ui/AgentAvatar'
import { Seg } from './ui/Seg'
import { RECENT_MS, touchesByNote, type NoteTouch } from './vault/activity'
import { Backlinks } from './vault/Backlinks'
import { GraphView } from './vault/GraphView'
import { kindLabel, LiveBadges } from './vault/LiveBadge'
import { renderNote } from './vault/markdown'
import { NoteEditor, type EditorStatus } from './vault/NoteEditor'
import { NOTE_PROSE } from './vault/noteProse'
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

/** Bề rộng khung tối thiểu để tự hiện cột cây (232px) / cột liên kết (250px): phần note còn ≥ ~420 / ~500px. */
const TREE_MIN = 640
const LINKS_MIN = 980

/** Giờ lưu lần cuối: hôm nay chỉ giờ, ngày khác thêm ngày. */
function savedAt(ms: number): { short: string; full: string } {
  const d = new Date(ms)
  const hm = fmtTime(d)
  const today = new Date().toDateString() === d.toDateString()
  return { short: today ? hm : `${fmtDate(d, { day: 'numeric', month: 'numeric' })} ${hm}`, full: fmtDateTime(d, { dateStyle: 'short', timeStyle: 'medium' }) }
}

export function VaultView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const { vaultPath } = workspace
  const vaultName = vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? vaultPath
  const [tree, setTree] = useState<VaultNode[]>([])
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

  /** Chế độ sửa (giữ nguyên khi chuyển note). */
  const [editing, setEditing] = useState(false)
  const [editStatus, setEditStatus] = useState<EditorStatus | null>(null)
  const [newNote, setNewNote] = useState(false)
  /** Hộp thuộc tính (frontmatter) của note đang mở có mở không. */
  const [propsOpen, setPropsOpen] = useState(false)
  /** Cột trái: cây note hay nhật ký agent đọc/ghi. */
  const [side, setSide] = useState<'tree' | 'activity'>('tree')
  /** Cột cây / cột liên kết: null = tự theo bề rộng khung, true/false = người dùng chọn. */
  const [treeOpen, setTreeOpen] = useState<boolean | null>(null)
  const [linksOpen, setLinksOpen] = useState<boolean | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Agent đọc / ghi note nào (từ hook); "gần đây" mờ dần theo đồng hồ.
  const events = useVaultActivity((s) => s.byWs[workspace.id])
  const loadActivity = useVaultActivity((s) => s.load)
  useEffect(() => {
    loadActivity(workspace.id)
  }, [workspace.id, loadActivity])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const recent = useMemo(() => touchesByNote(events ?? [], Date.now() - RECENT_MS), [events, now])
  const allTouches = useMemo(() => touchesByNote(events ?? []), [events])

  const loadTree = useCallback(() => {
    window.stag.vault.tree(vaultPath).then(setTree, () => setTree([]))
  }, [vaultPath])

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

  // Lùi/Tiến: Alt+←/→ và nút chuột 4/5. Ctrl+E: Xem ↔ Sửa. Ctrl+G: Note ↔ Đồ thị.
  const goRef = useRef(go)
  goRef.current = go
  const docReady = !!doc && doc.text !== null && doc.rel === current
  const canEdit = view === 'note' && docReady
  const toggleEditRef = useRef(() => {})
  toggleEditRef.current = () => {
    if (view === 'graph') {
      // Từ đồ thị: về note rồi vào chế độ sửa (như bản thiết kế).
      if (docReady) {
        setView('note')
        setEditing(true)
      }
      return
    }
    if (canEdit || editing) setEditing(!editing)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        const key = e.key.toLowerCase()
        if (key === 'e') {
          e.preventDefault()
          toggleEditRef.current()
          return
        }
        if (key === 'g') {
          e.preventDefault()
          setView((v) => (v === 'graph' ? 'note' : 'graph'))
          return
        }
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
    if (!current && !useUi.getState().vaultTarget && tree.some((n) => n.rel === '_INDEX.md')) open('_INDEX.md')
  }, [tree, current, open])

  // Nơi khác (Nhật ký…) yêu cầu mở một note cụ thể.
  const vaultTarget = useUi((s) => s.vaultTarget)
  useEffect(() => {
    if (!vaultTarget || vaultTarget.wsId !== workspace.id) return
    open(vaultTarget.rel)
    useUi.getState().clearVaultTarget()
  }, [vaultTarget, workspace.id, open])

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
    () =>
      doc?.text != null
        ? renderNote(doc.text, { current: doc.rel, notes: index?.notes ?? null, propsBox: propsOpen ? 'open' : 'closed' }).html
        : '',
    // `locale`: chữ "Thuộc tính" / "Chưa có note" trong HTML đổi theo ngôn ngữ.
    [doc, index, propsOpen, locale]
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

  /** Bấm trong note: chặn mọi điều hướng mặc định, tự xử lý link và hộp thuộc tính. */
  function onBodyClick(e: React.MouseEvent): void {
    const el = e.target as HTMLElement
    if (el.closest('summary')) {
      e.preventDefault()
      setPropsOpen((o) => !o)
      return
    }
    const a = el.closest('a')
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

  const searching = query.trim() !== ''
  // Khung hẹp (vd. mở trình duyệt bên phải): tự ẩn cột liên kết (< LINKS_MIN) rồi cột cây (< TREE_MIN) cho phần note còn
  // đủ rộng; có nút bật lại.
  const treeShown = searching || (treeOpen ?? width >= TREE_MIN)
  const linksShown = linksOpen ?? width >= LINKS_MIN
  const noteInfo = doc ? index?.notes.find((n) => n.rel === doc.rel) : undefined
  const saved = noteInfo ? savedAt(noteInfo.mtime) : null
  const docTouches = current ? (allTouches.get(current.toLowerCase()) ?? []) : []

  return (
    <>
      <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-bg">
        <div className="flex h-[38px] shrink-0 items-center gap-1.5 overflow-hidden border-b border-line px-2.5 whitespace-nowrap">
          <h1 className="mr-1.5 flex min-w-0 shrink items-center gap-2 text-[13px] font-semibold" data-tip={vaultPath}>
            <Icon name="vault" className="text-dim" />
            <span className="truncate">{vaultName}</span>
          </h1>
          <IconButton icon="al" tip={t('vault.back')} onClick={() => go(-1)} className={hist.pos <= 0 ? 'pointer-events-none opacity-30' : ''} />
          <IconButton
            icon="ar"
            tip={t('vault.forward')}
            onClick={() => go(1)}
            className={hist.pos >= hist.entries.length - 1 ? 'pointer-events-none opacity-30' : ''}
          />
          <Seg
            value={view}
            onChange={setView}
            options={[
              { value: 'note', label: <Icon name="file" />, tip: t('vault.noteView') },
              { value: 'graph', label: <Icon name="graph" />, tip: t('vault.graphView') }
            ]}
          />
          <div className="ml-1.5 flex h-7 max-w-[230px] min-w-24 flex-1 items-center gap-1.5 rounded-md border border-line-2 bg-bg0 pr-1 pl-2 focus-within:border-accent/40">
            <Icon name="search" size="s" className="text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder={t('vault.searchPlaceholder')}
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-dim"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                data-tip={t('vault.clearSearch')}
                aria-label={t('common.delete')}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-panel-3 hover:text-fg"
              >
                <Icon name="x" size="s" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1" />
          <IconButton icon="plus" tip={t('vault.newNote')} onClick={() => setNewNote(true)} />
          <IconButton
            icon="ref"
            tip={t('vault.refresh')}
            onClick={() => setReload((n) => n + 1)}
          />
          <IconButton icon="folder" tip={t('vault.openFolder')} onClick={() => window.stag.openFolder(vaultPath)} />
          <IconButton
            icon="pen"
            tip={editing && view === 'note' ? t('vault.editDone') : t('vault.edit')}
            on={editing && view === 'note'}
            onClick={() => toggleEditRef.current()}
            className={!canEdit && !editing && !(view === 'graph' && docReady) ? 'opacity-40' : ''}
          />
          {(width < TREE_MIN || treeOpen === false) && (
            <IconButton
              icon="side"
              tip={treeShown ? t('vault.hideTree') : t('vault.showTree')}
              on={treeShown}
              onClick={() => setTreeOpen(!treeShown)}
            />
          )}
          {(width < LINKS_MIN || linksOpen === false) && (
            <button
              type="button"
              onClick={() => setLinksOpen(!linksShown)}
              data-tip={linksShown ? t('vault.hideLinks') : t('vault.showLinks')}
              aria-label={t('vault.links')}
              aria-pressed={linksShown}
              className={`no-drag inline-grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-panel-3 hover:text-fg ${linksShown ? 'text-accent' : 'text-muted'}`}
            >
              <Icon name="side" className="-scale-x-100" />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className={`${treeShown ? 'flex' : 'hidden'} w-[232px] shrink-0 flex-col border-r border-line bg-bg`}>
            {searching ? (
              <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                <SearchResults hits={hits} query={query.trim()} selected={current} onOpen={openAt} />
              </div>
            ) : (
              <>
                <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-line px-2">
                  <Seg
                    value={side}
                    onChange={setSide}
                    options={[
                      { value: 'tree', label: <Icon name="folder" size="s" />, tip: t('vault.treeTab') },
                      {
                        value: 'activity',
                        label: (
                          <>
                            <Icon name="hist" size="s" />
                            {recent.size > 0 && <span className="font-mono text-[11px]">{recent.size}</span>}
                          </>
                        ),
                        tip: recent.size ? t('vault.activityTabRecent', { count: recent.size }) : t('vault.activityTab')
                      }
                    ]}
                  />
                  {index && <span className="ml-auto font-mono text-[11px] text-dim">{t('vault.noteCount', { count: index.notes.length })}</span>}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                  {side === 'activity' ? (
                    <ActivityList
                      events={events ?? []}
                      now={now}
                      selected={current}
                      onOpen={(rel) => open(index?.notes.find((n) => n.rel.toLowerCase() === rel.toLowerCase())?.rel ?? rel)}
                    />
                  ) : (
                    <>
                      {tree.length === 0 && <div className="px-3 text-dim">{t('vault.emptyVault')}</div>}
                      <Tree nodes={tree} depth={0} selected={current} onSelect={open} recent={recent} now={now} />
                    </>
                  )}
                  {error && <div className="mt-2 px-3 text-[11px] text-danger">{t('vault.indexError', { error })}</div>}
                </div>
              </>
            )}
          </nav>

          <section className="flex min-w-0 flex-1 flex-col bg-panel">
            {view === 'graph' ? (
              index ? (
                <GraphView index={index} current={current} onOpen={(rel) => open(rel)} activity={recent} />
              ) : (
                <div className="p-4 text-muted">{t('vault.reading')}</div>
              )
            ) : (
              <>
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
                  {current && (
                    <>
                      <span className="min-w-0 truncate font-mono text-[12px] text-dim" data-tip={current}>
                        {current}
                      </span>
                      <LiveBadges touches={docTouches} now={now} max={3} />
                      {editing && editStatus && <SaveBadge status={editStatus} />}
                    </>
                  )}
                  <div className="min-w-0 flex-1" />
                  {current &&
                    (editing ? (
                      <span className="shrink-0 text-[11px] text-dim">Markdown</span>
                    ) : (
                      saved && (
                        <span className="shrink-0 font-mono text-[11px] text-dim" data-tip={t('vault.lastSaved', { when: saved.full })}>
                          {saved.short}
                        </span>
                      )
                    ))}
                </div>
                {editing && doc && doc.rel === current && doc.text !== null ? (
                  <div className="min-h-0 flex-1">
                    <NoteEditor
                      key={doc.rel}
                      vaultPath={vaultPath}
                      rel={doc.rel}
                      disk={doc.text}
                      notes={index?.notes ?? null}
                      onStatus={setEditStatus}
                    />
                  </div>
                ) : (
                  <article ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto select-text">
                    {!current ? (
                      <div className="p-6 text-dim">{t('vault.pickNote')}</div>
                    ) : doc ? (
                      <div className="max-w-[800px] px-10 pt-6 pb-[60px]">
                        {doc.text === null ? (
                          <div className="rounded-md border border-line bg-bg px-3 py-2 text-muted">{t('vault.noteGone')}</div>
                        ) : (
                          <div ref={bodyRef} className={NOTE_PROSE} onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />
                        )}
                      </div>
                    ) : (
                      <div className="p-6 text-dim">{t('vault.opening')}</div>
                    )}
                  </article>
                )}
              </>
            )}
          </section>

          <aside className={`${linksShown ? 'flex' : 'hidden'} w-[250px] shrink-0 flex-col overflow-y-auto border-l border-line bg-bg py-1`}>
            {index ? (
              <Backlinks index={index} current={current} vaultPath={vaultPath} changed={changed} onOpen={openAt} />
            ) : (
              <div className="px-3 py-2 text-dim">{t('vault.reading')}</div>
            )}
          </aside>
        </div>
      </div>

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
    </>
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
  const t = useT()
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
  const field =
    'h-7 w-full rounded-md border border-line-2 bg-bg0 px-2.5 text-[13px] outline-none focus:border-accent/40'
  return (
    <Modal
      title={t('vault.new.title')}
      width="w-[440px]"
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary onClick={submit} disabled={busy || !name.trim()}>
            {t('vault.new.create')}
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
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.07em] text-dim">
          {t('vault.new.name')}
          <span data-tip={t('vault.new.nameTip')} className="inline-flex cursor-help">
            <Icon name="info" size="s" />
          </span>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('vault.new.namePlaceholder')}
          className={`mb-4 ${field}`}
        />
        <div className="mb-1.5 text-[11px] font-semibold tracking-[0.07em] text-dim">{t('vault.new.folder')}</div>
        <select value={folder} onChange={(e) => setFolder(e.target.value)} className={field}>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f || t('vault.new.root')}
            </option>
          ))}
        </select>
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div>}
      </form>
    </Modal>
  )
}

/** Trạng thái lưu của trình soạn (cạnh đường dẫn): chấm + chữ; hổ phách chỉ khi đang chờ bạn chọn bản. */
function SaveBadge({ status }: { status: EditorStatus }): React.JSX.Element {
  const t = useT()
  const { state, conflict } = status
  const [label, tone, dot] = conflict
    ? [t('vault.save.conflict'), 'text-wait', 'bg-wait']
    : state === 'error'
      ? [t('vault.save.error'), 'text-danger', 'bg-danger']
      : state === 'saved'
        ? [t('vault.save.saved'), 'text-dim', '']
        : [state === 'saving' ? t('vault.save.saving') : t('vault.save.dirty'), 'text-fg', 'bg-fg']
  return (
    <span data-tip={t('vault.save.tip')} className={`inline-flex shrink-0 items-center gap-1.5 text-[12px] ${tone}`}>
      {dot && <span className={`h-[7px] w-[7px] rounded-full ${dot}`} />}
      {label}
    </span>
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
  const t = useT()
  if (!events.length) return <div className="px-3 text-[12px] text-dim">{t('vault.noActivity')}</div>
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
              data-tip={e.rel}
              data-tip-side="right"
              className={`cursor-pointer px-3 py-1 ${selected?.toLowerCase() === e.rel.toLowerCase() ? 'bg-panel-3' : 'hover:bg-panel-2'}`}
            >
              <div className="flex items-center gap-1.5 text-[12px]">
                <AgentAvatar name={e.agentName} size={16} />
                <span className="min-w-0 truncate text-fg">{e.agentName}</span>
                <span className={e.kind === 'write' ? 'text-muted' : 'text-dim'}>{kindLabel(e.kind)}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-dim">{ago(e.at, now)}</span>
              </div>
              <div className="truncate pl-[22px] text-[12px] text-dim">{name.slice(name.lastIndexOf('/') + 1)}</div>
            </div>
          )
        })}
    </>
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

/** Lề trái của một hàng: thư mục theo bậc; note trong thư mục thẳng hàng với icon thư mục cha. */
const indent = (depth: number, dir: boolean): number => (dir || depth === 0 ? 10 + depth * 18 : 12 + depth * 18)

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
            style={{ paddingLeft: indent(depth, false) }}
            data-tip={n.name.length > 22 ? n.name : undefined}
            data-tip-side="right"
            className={`flex min-w-0 cursor-pointer items-center gap-1.5 py-[3px] pr-2.5 ${selected === n.rel ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2'}`}
          >
            <Icon name="file" className="text-dim" />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            <LiveBadges touches={recent.get(n.rel.toLowerCase()) ?? []} now={now} max={2} />
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
      <div
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: indent(depth, true) }}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 py-[3px] pr-2.5 text-muted hover:bg-panel-2"
      >
        <Icon name={open ? 'cd' : 'cr'} size="s" className="text-dim" />
        <Icon name="folder" className="text-dim" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </div>
      {open && node.children && <Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} recent={recent} now={now} />}
    </>
  )
}
