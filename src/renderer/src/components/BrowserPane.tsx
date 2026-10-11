import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserTab, Workspace } from '@shared/types'
import { useBrowser } from '../store/browser'
import { useUi } from '../store/ui'
import { Button, Modal } from './Modal'
import { Icon } from './Icon'
import { IconButton } from './shell/IconButton'
import { isBlankTab, NewTabPanel } from './NewTabPanel'
import { MenuItem } from './AgentMenu'
import { Popover } from './canvas/frame'

/**
 * Pane browser của một workspace. Trang thật là WebContentsView do main vẽ đè lên vùng `viewport`;
 * pane chỉ báo vị trí vùng đó và vẽ thanh tab / địa chỉ.
 */
export function BrowserPane({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useBrowser((s) => s.byWs[wsId])
  const load = useBrowser((s) => s.load)
  const modals = useUi((s) => s.modals)
  const resizing = useBrowser((s) => s.resizing)
  const viewport = useRef<HTMLDivElement>(null)
  const active = state?.tabs.find((t) => t.id === state.activeTabId)
  // Tab trống của người dùng: ẩn view (trang trắng) để hiện trang Tab mới (gợi ý dev server) bằng HTML.
  const blank = isBlankTab(active)
  const b = window.stag.browser

  useEffect(() => {
    load(wsId)
  }, [wsId, load])

  // Báo main vị trí vùng hiển thị; ẩn view khi có hộp thoại hoặc đang kéo đổi độ rộng
  // (view gốc luôn nằm trên HTML và nuốt sự kiện chuột).
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const report = (): void => {
      if (modals > 0 || resizing || blank) return b.setBounds(null, null)
      const r = el.getBoundingClientRect()
      b.setBounds(wsId, { x: r.left, y: r.top, width: r.width, height: r.height })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', report)
      b.setBounds(null, null)
    }
  }, [wsId, modals, resizing, blank, b])

  const driver = active?.owner.kind === 'agent' ? active.owner.agentName : null
  const toggleBrowser = useUi((s) => s.toggleBrowser)
  const expanded = useBrowser((s) => s.expanded)
  const setExpanded = useBrowser((s) => s.setExpanded)
  const [menu, setMenu] = useState(false)
  const menuBtn = useRef<HTMLSpanElement>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {state?.tabs.map((t) => (
            <TabButton key={t.id} tab={t} active={t.id === state.activeTabId} onSelect={() => b.activate(wsId, t.id)} onClose={() => b.closeTab(wsId, t.id)} />
          ))}
          <IconButton icon="plus" tip="Tab mới · Ctrl+T" onClick={() => b.newTab(wsId)} />
        </div>
        <span ref={menuBtn} className="inline-flex">
          <IconButton icon="more" tip="Thêm" on={menu} onClick={() => setMenu((m) => !m)} />
        </span>
        <IconButton icon={expanded ? 'unfocus' : 'focus'} tip={expanded ? 'Thu nhỏ pane' : 'Phóng to pane'} onClick={() => setExpanded(!expanded)} />
        <IconButton icon="x" tip="Đóng · Ctrl+Shift+B" onClick={toggleBrowser} />
      </div>
      {menu && (
        <Popover anchor={menuBtn.current} onClose={() => setMenu(false)}>
          <BrowserMenu wsId={wsId} tab={active} onClose={() => setMenu(false)} />
        </Popover>
      )}

      <AddressBar wsId={wsId} tab={active} />

      {driver && (
        <div className="flex h-[30px] shrink-0 items-center gap-1.5 border-b border-line bg-accent/10 px-3 text-[12px]">
          <span className="h-1.5 w-1.5 rounded-full bg-work" />
          <b className="font-semibold">{driver}</b>
          <span className="text-muted">đang điều khiển tab này</span>
        </div>
      )}

      <div ref={viewport} className="relative min-h-0 flex-1 rounded-b-[11px] bg-bg">
        {blank && !resizing && <NewTabPanel wsId={wsId} tab={active} />}
        {active && resizing && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] text-dim">Thả chuột để giữ độ rộng này</div>
        )}
      </div>
    </div>
  )
}

/** Độ rộng tối thiểu (px) của pane browser và của phần agent/kanban bên trái. */
const PANE_MIN = 320
const MAIN_MIN = 360

/** Tỉ lệ độ rộng pane khi mép trái của nó ở `x`, đã giới hạn theo px. */
function ratioAt(row: DOMRect, x: number): number {
  const max = Math.max(PANE_MIN, row.width - MAIN_MIN)
  const px = Math.min(max, Math.max(PANE_MIN, row.right - x))
  return px / row.width
}

/**
 * Cột bên phải chứa pane browser, kéo mép trái để đổi độ rộng (nhấp đúp = về mặc định).
 * Độ rộng lưu dạng tỉ lệ; CSS `clamp` giữ cả hai bên không nhỏ hơn mức tối thiểu khi cửa sổ co lại.
 * Lúc kéo: ẩn view trang (nó nuốt sự kiện chuột) và phủ một lớp trong suốt toàn cửa sổ.
 * Terminal bên trái tự fit lại nhờ ResizeObserver của từng ô.
 */
export function BrowserDock({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const width = useBrowser((s) => s.width)
  const setWidth = useBrowser((s) => s.setWidth)
  const resetWidth = useBrowser((s) => s.resetWidth)
  const setResizing = useBrowser((s) => s.setResizing)
  const expanded = useBrowser((s) => s.expanded)
  const setExpanded = useBrowser((s) => s.setExpanded)
  const [dragging, setDragging] = useState(false)
  const aside = useRef<HTMLElement>(null)
  const normalWidth = `clamp(${PANE_MIN}px, ${(width * 100).toFixed(3)}%, calc(100% - ${MAIN_MIN}px))`
  /** Phóng to: mép trái của pane = mép trái vùng nội dung (`main`, ngay sau thanh bên). */
  const [coverLeft, setCoverLeft] = useState(0)

  useLayoutEffect(() => {
    const main = aside.current?.parentElement?.querySelector<HTMLElement>(':scope > main')
    if (!expanded || !main) return
    const measure = (): void => setCoverLeft(main.offsetLeft)
    measure()
    // Ẩn / hiện thanh bên làm `main` đổi chỗ.
    const ro = new ResizeObserver(measure)
    ro.observe(main)
    return () => ro.disconnect()
  }, [expanded])

  // Đổi view (tab chính, Cài đặt) hoặc workspace: thu nhỏ lại, không che trang vừa mở.
  const view = useUi((s) => `${s.tab}:${s.settings !== null}`)
  useEffect(() => setExpanded(false), [view, workspace.id, setExpanded])

  // Esc thu nhỏ lại (trừ khi đang gõ trong ô nhập).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent): void => {
      const typing = e.target instanceof Element && !!e.target.closest('input, textarea, [contenteditable="true"], .xterm')
      if (e.key === 'Escape' && !typing) setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, setExpanded])

  function startDrag(e: React.PointerEvent<HTMLDivElement>): void {
    const row = aside.current?.parentElement
    if (e.button !== 0 || !row) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = row.getBoundingClientRect()
    let x = e.clientX
    let moved = false
    let frame = 0
    const apply = (): void => {
      frame = 0
      setWidth(ratioAt(rect, x))
    }
    const move = (ev: PointerEvent): void => {
      if (ev.clientX === x) return
      x = ev.clientX
      moved = true
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const end = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      cancelAnimationFrame(frame)
      // Chỉ lưu khi thật sự kéo: nhấp đúp (hai lần nhấn không di chuột) không được làm lệch độ rộng.
      if (moved) setWidth(ratioAt(rect, x), true)
      setDragging(false)
      setResizing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    setDragging(true)
    setResizing(true)
  }

  return (
    <>
    {/* Phóng to: pane phủ cả vùng nội dung (như Claude desktop); ô giữ chỗ giữ nguyên độ rộng cũ để canvas / terminal
        bên dưới không đổi cỡ. */}
    {expanded && <div className="shrink-0" style={{ width: normalWidth }} />}
    <aside
      ref={aside}
      className={`shrink-0 bg-bg py-2 pr-2 pl-1.5 ${expanded ? 'absolute inset-y-0 right-0 z-30' : 'relative'}`}
      style={expanded ? { left: coverLeft } : { width: normalWidth }}
    >
      {/* Phần lớn thanh kéo nằm bên trái mép pane: phần nằm trên vùng trang sẽ bị view che. */}
      {!expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Kéo để đổi độ rộng · nhấp đúp để về mặc định"
          onPointerDown={startDrag}
          onDoubleClick={resetWidth}
          className="group absolute inset-y-0 -left-[5px] z-20 w-[8px] cursor-col-resize"
        >
          <div className={`mx-auto h-full w-[2px] transition-colors ${dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/60'}`} />
        </div>
      )}
      {/* Khung nổi bo góc như pane browser của Claude desktop; view trang được bo góc dưới ở main. */}
      <div className="h-full overflow-hidden rounded-xl border border-line-2 bg-panel shadow-[0_4px_18px_rgba(0,0,0,0.35)]">
        <BrowserPane key={workspace.id} workspace={workspace} />
      </div>
      {dragging && <div className="fixed inset-0 z-[60] cursor-col-resize" />}
    </aside>
    </>
  )
}

function tabLabel(t: BrowserTab): string {
  if (t.title) return t.title
  try {
    const u = new URL(t.url)
    return u.protocol === 'about:' ? 'Tab mới' : u.host
  } catch {
    return 'Tab mới'
  }
}

function TabButton({ tab, active, onSelect, onClose }: { tab: BrowserTab; active: boolean; onSelect: () => void; onClose: () => void }): React.JSX.Element {
  const agent = tab.owner.kind === 'agent' ? tab.owner.agentName : null
  return (
    <div
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onClose()}
      data-tip={`${tab.title || tabLabel(tab)}\n${tab.url}${agent ? `\n${agent} đang điều khiển` : ''}`}
      className={`group flex h-7 max-w-[180px] min-w-[72px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-[13px] whitespace-nowrap ${
        active ? 'bg-panel-3 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'
      }`}
    >
      {(tab.loading || tab.dev) && !tab.dev?.error && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-line-2 border-t-accent" />}
      {agent && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-work" />}
      <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded text-dim hover:bg-line hover:text-fg ${active ? 'opacity-60 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        data-tip="Đóng tab"
      >
        <Icon name="x" size="s" />
      </button>
    </div>
  )
}

function AddressBar({ wsId, tab }: { wsId: string; tab: BrowserTab | undefined }): React.JSX.Element {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const b = window.stag.browser
  const shownUrl = tab && tab.url !== 'about:blank' ? tab.url : ''

  useEffect(() => {
    if (!editing) setText(shownUrl)
  }, [shownUrl, editing])

  async function go(): Promise<void> {
    const input = text.trim()
    if (!input) return
    if (tab) await b.navigate(wsId, tab.id, input)
    else await b.newTab(wsId, input)
    setEditing(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  const navBtn = (icon: 'al' | 'ar' | 'ref', tip: string, disabled: boolean, fn: () => void): React.JSX.Element => (
    <button
      type="button"
      disabled={disabled}
      onClick={fn}
      data-tip={tip}
      aria-label={tip}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} />
    </button>
  )
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-2">
      {navBtn('al', 'Lùi', !tab?.canGoBack, () => tab && b.back(wsId, tab.id))}
      {navBtn('ar', 'Tới', !tab?.canGoForward, () => tab && b.forward(wsId, tab.id))}
      {navBtn('ref', 'Tải lại', !tab || isBlankTab(tab), () => tab && b.reload(wsId, tab.id))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setEditing(true)
          e.target.select()
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
          if (e.key === 'Escape') {
            setText(shownUrl)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder="Nhập URL"
        spellCheck={false}
        className="mx-1 h-7 min-w-0 flex-1 rounded-md border border-line-2 bg-bg0 px-2.5 text-[12.5px] text-fg outline-none select-text placeholder:text-dim focus:border-accent/60"
      />
      <button
        type="button"
        disabled={!tab || isBlankTab(tab)}
        onClick={() => tab && b.toggleDevTools(wsId, tab.id)}
        aria-pressed={!!tab?.devtools}
        data-tip={tab?.devtools ? 'Đóng DevTools của tab này' : 'Soi phần tử (DevTools) · F12'}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-panel-3 hover:text-fg disabled:opacity-30 ${tab?.devtools ? 'bg-panel-3 text-accent' : 'text-muted'}`}
      >
        <Icon name="code" />
      </button>
    </div>
  )
}

/** Menu ⋮ của pane: việc ít dùng (mở ngoài, DevTools, dev server, xoá dữ liệu trang). Ẩn view trang khi mở (view nằm đè HTML). */
function BrowserMenu({ wsId, tab, onClose }: { wsId: string; tab: BrowserTab | undefined; onClose: () => void }): React.JSX.Element {
  const b = window.stag.browser
  useEffect(() => {
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [])
  const web = !!tab && /^https?:\/\//i.test(tab.url)
  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return (
    <div className="min-w-[220px] rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] shadow-xl">
      <MenuItem label="Tab mới" hint="Ctrl+T" onClick={run(() => void b.newTab(wsId))} />
      <MenuItem label="Dev server của dự án…" onClick={run(() => void b.newTab(wsId))} />
      {web && <MenuItem label="Mở bằng trình duyệt ngoài" onClick={run(() => window.open(tab.url))} />}
      {tab && !isBlankTab(tab) && <MenuItem label={tab.devtools ? 'Đóng DevTools' : 'Mở DevTools'} hint="F12" onClick={run(() => void b.toggleDevTools(wsId, tab.id))} />}
      {tab && <MenuItem label="Đóng tab" onClick={run(() => void b.closeTab(wsId, tab.id))} />}
      <div className="my-1 h-px bg-line" />
      <MenuItem label="Xoá cookie và dữ liệu trang" danger onClick={run(() => void b.clearData(wsId))} />
    </div>
  )
}

/** Agent xin mở trang ngoài localhost: hỏi người dùng (hộp thoại đầu hàng đợi). */
export function BrowserAskDialog(): React.JSX.Element | null {
  const ask = useBrowser((s) => s.asks[0])
  const answer = useBrowser((s) => s.answer)
  const allowAlways = useBrowser((s) => s.allowAlways)
  if (!ask) return null
  return (
    <Modal
      title="Agent muốn mở trang ngoài"
      footer={
        <>
          <Button onClick={() => answer(ask.id, false)}>Từ chối</Button>
          {/* Lưu Cài đặt hỏng thì vẫn cho phép lần này (allowAlways luôn trả lời). */}
          <Button onClick={() => void allowAlways(ask).catch(() => {})}>Luôn cho trang này</Button>
          <Button primary onClick={() => answer(ask.id, true)}>
            Cho phép
          </Button>
        </>
      }
    >
      <p>
        Agent <b>{ask.agentName}</b> muốn mở:
      </p>
      <p className="mt-2 break-all rounded-md bg-panel-2 px-3 py-2 font-mono text-[12px]">{ask.url}</p>
      <p className="mt-3 text-[12px] text-muted">
        Cho phép thì agent dùng được mọi trang thuộc <span className="font-mono">{ask.origin}</span> tới khi tắt app. "Luôn cho trang này" lưu origin vào
        Cài đặt → Trình duyệt (mọi agent, cả sau khi mở lại app). Agent đang chờ bạn trả lời (tự từ chối sau 2 phút).
      </p>
    </Modal>
  )
}
