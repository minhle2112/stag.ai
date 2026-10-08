import { useEffect, useRef, useState } from 'react'
import type { BrowserTab, Workspace } from '@shared/types'
import { useBrowser } from '../store/browser'
import { useUi } from '../store/ui'
import { Button, Modal } from './Modal'

/**
 * Pane browser của một workspace. Trang thật là WebContentsView do main vẽ đè lên vùng `viewport`;
 * pane chỉ báo vị trí vùng đó và vẽ thanh tab / địa chỉ.
 */
export function BrowserPane({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const wsId = workspace.id
  const state = useBrowser((s) => s.byWs[wsId])
  const load = useBrowser((s) => s.load)
  const modals = useUi((s) => s.modals)
  const viewport = useRef<HTMLDivElement>(null)
  const active = state?.tabs.find((t) => t.id === state.activeTabId)
  const b = window.stag.browser

  useEffect(() => {
    load(wsId)
  }, [wsId, load])

  // Báo main vị trí vùng hiển thị; ẩn view khi có hộp thoại (view gốc luôn nằm trên HTML).
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const report = (): void => {
      if (modals > 0) return b.setBounds(null, null)
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
  }, [wsId, modals, b])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-1.5 pt-1.5">
        {state?.tabs.map((t) => (
          <TabButton key={t.id} tab={t} active={t.id === state.activeTabId} onSelect={() => b.activate(wsId, t.id)} onClose={() => b.closeTab(wsId, t.id)} />
        ))}
        <button onClick={() => b.newTab(wsId)} className="mb-1 rounded px-2 py-0.5 text-muted hover:bg-panel-2 hover:text-fg" title="Tab mới">
          +
        </button>
      </div>

      <AddressBar wsId={wsId} tab={active} />

      <div ref={viewport} className="relative min-h-0 flex-1 bg-bg">
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted">
            <div>Chưa có tab nào.</div>
            <div className="text-[12px]">
              Gõ địa chỉ ở trên để mở trang, ví dụ <span className="font-mono">localhost:5173</span>. Agent cũng mở tab ở đây khi dùng browser.
            </div>
            <Button onClick={() => b.newTab(wsId)}>Tab mới</Button>
          </div>
        )}
      </div>
    </div>
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
  return (
    <div
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onClose()}
      title={tab.url}
      className={`group flex max-w-[200px] min-w-[90px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2 py-1 text-[12px] ${
        active ? 'border-line bg-panel-2 text-fg' : 'border-transparent text-muted hover:bg-panel-2/60 hover:text-fg'
      }`}
    >
      {tab.loading && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />}
      {tab.owner.kind === 'agent' && (
        <span className="shrink-0 rounded bg-accent/15 px-1 text-accent" title={`Tab của agent ${tab.owner.agentName}`}>
          {tab.owner.agentName}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="shrink-0 rounded px-0.5 text-muted opacity-0 hover:bg-line hover:text-fg group-hover:opacity-100"
        title="Đóng tab"
      >
        ×
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

  const nav = 'rounded px-1.5 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
      <button className={nav} disabled={!tab?.canGoBack} onClick={() => tab && b.back(wsId, tab.id)} title="Lùi">
        ←
      </button>
      <button className={nav} disabled={!tab?.canGoForward} onClick={() => tab && b.forward(wsId, tab.id)} title="Tới">
        →
      </button>
      <button className={nav} disabled={!tab} onClick={() => tab && b.reload(wsId, tab.id)} title="Tải lại">
        ↻
      </button>
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
        placeholder="Nhập địa chỉ hoặc từ khoá"
        spellCheck={false}
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-bg px-2 font-mono text-[12px] text-fg outline-none select-text focus:border-accent/60"
      />
    </div>
  )
}

/** Agent xin mở trang ngoài localhost: hỏi người dùng (hộp thoại đầu hàng đợi). */
export function BrowserAskDialog(): React.JSX.Element | null {
  const ask = useBrowser((s) => s.asks[0])
  const answer = useBrowser((s) => s.answer)
  if (!ask) return null
  return (
    <Modal
      title="Agent muốn mở trang ngoài"
      footer={
        <>
          <Button onClick={() => answer(ask.id, false)}>Từ chối</Button>
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
        Cho phép thì agent dùng được mọi trang thuộc <span className="font-mono">{ask.origin}</span> tới khi tắt app. Agent đang chờ bạn trả lời (tự từ chối sau 2 phút).
      </p>
    </Modal>
  )
}
