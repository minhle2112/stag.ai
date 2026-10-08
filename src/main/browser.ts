import { randomUUID } from 'node:crypto'
import { BrowserWindow, nativeImage, session as electronSession, WebContentsView, type Session, type WebContents } from 'electron'
import type { Agent, BrowserPermissionAsk, BrowserState, BrowserTab, BrowserTabOwner, ViewRect } from '@shared/types'
import snapshotSrc from './inject/snapshot.js?raw'

interface ConsoleEntry {
  level: string
  text: string
  at: string
}

interface Tab {
  id: string
  wsId: string
  owner: BrowserTabOwner
  view: WebContentsView
  console: ConsoleEntry[]
  cdp: boolean
}

interface WsBrowser {
  tabs: Tab[]
  active: string | null
  /** Origin ngoài localhost người dùng đã cho agent mở (tới khi tắt app). */
  allowed: Set<string>
  session: Session
}

interface PendingAsk {
  ask: BrowserPermissionAsk
  resolve: (allow: boolean) => void
}

export interface BrowserEvents {
  changed(workspaceId: string, state: BrowserState): void
  /** Agent vừa mở trang: giao diện mở pane và chuyển tới tab đó. */
  reveal(workspaceId: string, tabId: string): void
  ask(ask: BrowserPermissionAsk): void
}

const CONSOLE_MAX = 300
const SNAPSHOT_MAX = 30_000
const ASK_TIMEOUT = 2 * 60_000
const SCREENSHOT_MAX_WIDTH = 1280

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 }
}
export const BROWSER_KEYS = Object.keys(KEYS) as [string, ...string[]]

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** localhost, 127.x, ::1, *.localhost — agent dùng tự do. */
export function isLocalUrl(url: URL): boolean {
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h)
}

/** Chuỗi gõ vào thanh địa chỉ → URL. Không giống địa chỉ thì tìm bằng Google. */
export function toUrl(input: string): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^localhost:\d/i.test(s)) return s
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s)) return `https://${s}`
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`
}

/**
 * Browser trong app: mỗi workspace một bộ tab (WebContentsView) với session riêng không lưu xuống đĩa
 * (cookie mất khi tắt app). Người dùng dùng qua pane; agent dùng qua tool MCP browser_*, mỗi agent một tab.
 */
export class BrowserService {
  private byWs = new Map<string, WsBrowser>()
  private win: BrowserWindow | null = null
  /** Pane đang hiện browser của workspace nào, ở vị trí nào (null = không hiện view nào). */
  private shown: { wsId: string; rect: ViewRect } | null = null
  private asks = new Map<string, PendingAsk>()

  constructor(private events: BrowserEvents) {}

  attachWindow(win: BrowserWindow): void {
    this.win = win
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
  }

  // ---- trạng thái ----

  private ws(wsId: string): WsBrowser {
    let b = this.byWs.get(wsId)
    if (!b) {
      // Không có tiền tố "persist:" → session chỉ trong bộ nhớ.
      const ses = electronSession.fromPartition(`stag-browser-${wsId}`)
      ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
      ses.on('will-download', (event, _item, wc) => {
        // Agent không tự tải file về máy. Người dùng tải bình thường (có hộp thoại lưu).
        const tab = this.findByContents(wc)
        if (tab && tab.owner.kind === 'agent') {
          event.preventDefault()
          this.log(tab, 'warning', '[stag] Đã chặn tải file: agent không được tải file về máy.')
        }
      })
      b = { tabs: [], active: null, allowed: new Set(), session: ses }
      this.byWs.set(wsId, b)
    }
    return b
  }

  private findByContents(wc: WebContents): Tab | undefined {
    for (const b of this.byWs.values()) {
      const t = b.tabs.find((x) => x.view.webContents === wc)
      if (t) return t
    }
    return undefined
  }

  private tab(wsId: string, tabId: string): Tab {
    const t = this.byWs.get(wsId)?.tabs.find((x) => x.id === tabId)
    if (!t) throw new Error('Tab không còn')
    return t
  }

  state(wsId: string): BrowserState {
    const b = this.byWs.get(wsId)
    if (!b) return { tabs: [], activeTabId: null }
    return { tabs: b.tabs.map((t) => describeTab(t)), activeTabId: b.active }
  }

  private emit(wsId: string): void {
    this.events.changed(wsId, this.state(wsId))
  }

  // ---- tab ----

  newTab(wsId: string, owner: BrowserTabOwner, url?: string): Tab {
    const b = this.ws(wsId)
    const view = new WebContentsView({
      webPreferences: {
        session: b.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Tab của agent thường không hiện trên màn hình mà vẫn phải chạy bình thường.
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor('#ffffff')
    view.setVisible(false)
    const tab: Tab = { id: randomUUID(), wsId, owner, view, console: [], cdp: false }
    b.tabs.push(tab)
    b.active = tab.id
    this.wire(tab)
    this.win?.contentView.addChildView(view)
    if (url) view.webContents.loadURL(url).catch(() => {})
    this.layout()
    this.emit(wsId)
    return tab
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const changed = (): void => this.emit(tab.wsId)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-navigate', changed)
    wc.on('did-navigate-in-page', changed)

    wc.on('console-message', (e) => {
      // Cảnh báo bảo mật của chính Electron về trang (thiếu CSP…), không phải lỗi của trang.
      if (e.message.startsWith('Electron Security Warning')) return
      this.log(tab, e.level, e.message + (e.sourceId ? `  (${e.sourceId}:${e.lineNumber})` : ''))
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.log(tab, 'error', `[stag] Không tải được ${url}: ${desc} (${code})`)
    })
    wc.on('render-process-gone', (_e, d) => this.log(tab, 'error', `[stag] Trang bị sập: ${d.reason}`))
    wc.on('did-navigate', (_e, url) => this.log(tab, 'info', `[stag] Đã mở ${url}`))

    // Agent bấm link / bị chuyển hướng sang origin chưa được phép → chặn, bảo agent xin quyền.
    const guard = (e: Electron.Event, url: string, isMainFrame = true): void => {
      if (tab.owner.kind !== 'agent' || !isMainFrame) return
      if (!this.agentMayOpen(tab.wsId, url)) {
        e.preventDefault()
        this.log(tab, 'warning', `[stag] Đã chặn điều hướng tới ${url}: chưa được phép. Gọi browser_navigate với URL này để xin quyền người dùng.`)
      }
    }
    wc.on('will-navigate', (e) => guard(e, e.url))
    wc.on('will-redirect', (e) => guard(e, e.url, e.isMainFrame))

    // Popup / target=_blank: tab người dùng → tab mới; tab agent → mở luôn trong tab của agent.
    wc.setWindowOpenHandler(({ url }) => {
      if (tab.owner.kind === 'agent') {
        if (this.agentMayOpen(tab.wsId, url)) wc.loadURL(url).catch(() => {})
        else this.log(tab, 'warning', `[stag] Đã chặn mở cửa sổ ${url}: chưa được phép.`)
      } else {
        this.newTab(tab.wsId, { kind: 'user' }, url)
      }
      return { action: 'deny' }
    })
    wc.debugger.on('detach', () => {
      tab.cdp = false
    })
  }

  private log(tab: Tab, level: string, text: string): void {
    tab.console.push({ level, text, at: new Date().toISOString() })
    if (tab.console.length > CONSOLE_MAX) tab.console.splice(0, tab.console.length - CONSOLE_MAX)
  }

  closeTab(wsId: string, tabId: string): void {
    const b = this.byWs.get(wsId)
    const i = b?.tabs.findIndex((t) => t.id === tabId) ?? -1
    if (!b || i < 0) return
    const [tab] = b.tabs.splice(i, 1)
    this.destroy(tab)
    if (b.active === tabId) b.active = b.tabs[Math.min(i, b.tabs.length - 1)]?.id ?? null
    this.layout()
    this.emit(wsId)
  }

  private destroy(tab: Tab): void {
    this.win?.contentView.removeChildView(tab.view)
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
  }

  activate(wsId: string, tabId: string): void {
    const b = this.byWs.get(wsId)
    if (!b?.tabs.some((t) => t.id === tabId)) return
    b.active = tabId
    this.layout()
    this.emit(wsId)
  }

  navigate(wsId: string, tabId: string, input: string): void {
    this.tab(wsId, tabId).view.webContents.loadURL(toUrl(input)).catch(() => {})
  }

  back(wsId: string, tabId: string): void {
    const nav = this.tab(wsId, tabId).view.webContents.navigationHistory
    if (nav.canGoBack()) nav.goBack()
  }

  forward(wsId: string, tabId: string): void {
    const nav = this.tab(wsId, tabId).view.webContents.navigationHistory
    if (nav.canGoForward()) nav.goForward()
  }

  reload(wsId: string, tabId: string): void {
    this.tab(wsId, tabId).view.webContents.reload()
  }

  /** Giao diện báo vị trí pane (null = pane đóng, hoặc đang có hộp thoại che). */
  setBounds(wsId: string | null, rect: ViewRect | null): void {
    this.shown = wsId && rect ? { wsId, rect } : null
    this.layout()
  }

  private layout(): void {
    for (const [wsId, b] of this.byWs) {
      for (const tab of b.tabs) {
        const visible = !!this.shown && this.shown.wsId === wsId && b.active === tab.id
        if (visible) {
          const r = this.shown!.rect
          tab.view.setBounds({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
        }
        tab.view.setVisible(visible)
      }
    }
  }

  closeAgentTabs(agentId: string): void {
    for (const [wsId, b] of this.byWs)
      for (const t of [...b.tabs]) if (t.owner.kind === 'agent' && t.owner.agentId === agentId) this.closeTab(wsId, t.id)
  }

  closeWorkspace(wsId: string): void {
    const b = this.byWs.get(wsId)
    if (!b) return
    for (const t of b.tabs) this.destroy(t)
    this.byWs.delete(wsId)
    for (const [id, p] of this.asks) if (p.ask.workspaceId === wsId) this.answer(id, false)
  }

  // ---- quyền ----

  private agentMayOpen(wsId: string, raw: string): boolean {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return false
    }
    if (url.protocol === 'about:') return true
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isLocalUrl(url) || this.ws(wsId).allowed.has(url.origin)
  }

  answer(askId: string, allow: boolean): void {
    const p = this.asks.get(askId)
    if (!p) return
    this.asks.delete(askId)
    p.resolve(allow)
  }

  private askUser(wsId: string, agent: Agent, url: URL): Promise<boolean> {
    const ask: BrowserPermissionAsk = { id: randomUUID(), workspaceId: wsId, agentName: agent.name, origin: url.origin, url: url.href }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.answer(ask.id, false), ASK_TIMEOUT)
      this.asks.set(ask.id, {
        ask,
        resolve: (allow) => {
          clearTimeout(timer)
          resolve(allow)
        }
      })
      this.events.ask(ask)
    })
  }

  // ---- agent ----

  private agentTab(agent: Agent): Tab | undefined {
    return this.byWs
      .get(agent.workspaceId)
      ?.tabs.find((t) => t.owner.kind === 'agent' && t.owner.agentId === agent.id)
  }

  private requireAgentTab(agent: Agent): Tab {
    const tab = this.agentTab(agent)
    if (!tab) throw new Error('Bạn chưa có tab nào. Gọi browser_navigate trước.')
    return tab
  }

  async agentNavigate(agent: Agent, raw: string): Promise<string> {
    let url: URL
    try {
      url = new URL(toUrl(raw))
    } catch {
      throw new Error(`URL không hợp lệ: ${raw}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.href !== 'about:blank')
      throw new Error('Chỉ mở được trang http/https.')
    const wsId = agent.workspaceId
    if (!this.agentMayOpen(wsId, url.href)) {
      const allow = await this.askUser(wsId, agent, url)
      if (!allow) throw new Error(`Người dùng không cho phép mở ${url.origin}. Đừng thử lại trang này trừ khi người dùng bảo.`)
      this.ws(wsId).allowed.add(url.origin)
    }

    let tab = this.agentTab(agent)
    if (!tab) tab = this.newTab(wsId, { kind: 'agent', agentId: agent.id, agentName: agent.name })
    else this.activate(wsId, tab.id)
    this.events.reveal(wsId, tab.id)

    const wc = tab.view.webContents
    try {
      await wc.loadURL(url.href)
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      // ERR_ABORTED: trang tự chuyển hướng/huỷ giữa chừng — vẫn đọc được trạng thái hiện tại.
      if (!/ERR_ABORTED/.test(msg)) throw new Error(`Không mở được ${url.href}: ${msg}`)
    }
    await settle(wc)
    return `Đã mở: ${wc.getURL()}\nTiêu đề: ${wc.getTitle()}\nGọi browser_snapshot để đọc trang và lấy số [ref] của nút/ô nhập.`
  }

  async agentSnapshot(agent: Agent): Promise<string> {
    const wc = this.requireAgentTab(agent).view.webContents
    await settle(wc, 0)
    return (await wc.executeJavaScript(`${snapshotSrc}(${SNAPSHOT_MAX})`)) as string
  }

  private async cdp(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const dbg = tab.view.webContents.debugger
    if (!tab.cdp) {
      if (!dbg.isAttached()) dbg.attach('1.3')
      tab.cdp = true
    }
    return dbg.sendCommand(method, params)
  }

  /** Cuộn phần tử [ref] vào giữa màn hình, trả về toạ độ tâm (CSS px trong khung nhìn). */
  private async locate(tab: Tab, ref: number, focus = false): Promise<{ x: number; y: number }> {
    const js = `(() => {
      const el = document.querySelector('[data-stag-ref="${ref}"]')
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'center' })
      ${focus ? 'el.focus()' : ''}
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`
    const pos = (await tab.view.webContents.executeJavaScript(js)) as { x: number; y: number } | null
    if (!pos) throw new Error(`Không thấy phần tử [${ref}] (trang đã đổi?). Gọi browser_snapshot để lấy ref mới.`)
    return pos
  }

  /** Thông báo chặn của app phát sinh trong lúc thao tác (để agent biết vì sao trang không đổi). */
  private blockedSince(tab: Tab, before: number): string {
    const notes = tab.console.slice(before).filter((e) => e.text.startsWith('[stag] Đã chặn'))
    return notes.length ? '\n' + notes.map((e) => e.text).join('\n') : ''
  }

  async agentClick(agent: Agent, ref: number): Promise<string> {
    const tab = this.requireAgentTab(agent)
    const before = tab.console.length
    const { x, y } = await this.locate(tab, ref)
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await settle(tab.view.webContents)
    const wc = tab.view.webContents
    return `Đã bấm [${ref}]. Trang hiện tại: ${wc.getURL()} — ${wc.getTitle()}` + this.blockedSince(tab, before)
  }

  async agentType(agent: Agent, ref: number, text: string, submit: boolean): Promise<string> {
    const tab = this.requireAgentTab(agent)
    const before = tab.console.length
    await this.locate(tab, ref, true)
    // Chọn hết nội dung cũ để chữ mới thay thế.
    await tab.view.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[data-stag-ref="${ref}"]')
      if (el && typeof el.select === 'function') el.select()
      else if (el && el.isContentEditable) document.execCommand('selectAll')
    })()`)
    await this.cdp(tab, 'Input.insertText', { text })
    if (submit) await this.key(tab, 'Enter')
    await settle(tab.view.webContents)
    return (submit ? `Đã gõ vào [${ref}] và nhấn Enter.` : `Đã gõ vào [${ref}].`) + this.blockedSince(tab, before)
  }

  async agentPress(agent: Agent, keyName: string): Promise<string> {
    const tab = this.requireAgentTab(agent)
    const before = tab.console.length
    await this.key(tab, keyName)
    await settle(tab.view.webContents)
    return `Đã nhấn ${keyName}.` + this.blockedSince(tab, before)
  }

  private async key(tab: Tab, keyName: string): Promise<void> {
    const k = KEYS[keyName]
    if (!k) throw new Error(`Phím không hỗ trợ: ${keyName}`)
    const base = { key: keyName, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode }
    await this.cdp(tab, 'Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, ...(k.text ? { text: k.text } : {}) })
    await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  async agentScreenshot(agent: Agent): Promise<string> {
    const tab = this.requireAgentTab(agent)
    const res = (await this.cdp(tab, 'Page.captureScreenshot', { format: 'png' })) as { data: string }
    let img = nativeImage.createFromBuffer(Buffer.from(res.data, 'base64'))
    if (img.getSize().width > SCREENSHOT_MAX_WIDTH) img = img.resize({ width: SCREENSHOT_MAX_WIDTH })
    return img.toPNG().toString('base64')
  }

  /** Trả các dòng console từ lần đọc trước, rồi xoá. */
  agentConsole(agent: Agent, onlyErrors: boolean): string {
    const tab = this.agentTab(agent)
    if (!tab) return 'Bạn chưa có tab nào.'
    const entries = tab.console.filter((e) => !onlyErrors || e.level === 'error' || e.level === 'warning')
    tab.console = []
    if (!entries.length) return onlyErrors ? 'Không có lỗi/cảnh báo mới.' : 'Console không có gì mới.'
    return entries.map((e) => `${e.at.slice(11, 19)} [${e.level}] ${e.text}`).join('\n')
  }

  shutdown(): void {
    for (const id of [...this.asks.keys()]) this.answer(id, false)
    for (const wsId of [...this.byWs.keys()]) this.closeWorkspace(wsId)
  }
}

function describeTab(t: Tab): BrowserTab {
  const wc = t.view.webContents
  const dead = wc.isDestroyed()
  return {
    id: t.id,
    owner: t.owner,
    url: dead ? '' : wc.getURL(),
    title: dead ? '' : wc.getTitle(),
    loading: !dead && wc.isLoading(),
    canGoBack: !dead && wc.navigationHistory.canGoBack(),
    canGoForward: !dead && wc.navigationHistory.canGoForward()
  }
}

/** Chờ trang ổn định sau một thao tác: đợi chút, nếu đang tải thì chờ tải xong (tối đa 10 giây). */
async function settle(wc: WebContents, ms = 300): Promise<void> {
  if (ms) await delay(ms)
  if (!wc.isLoading()) return
  await Promise.race([new Promise<void>((r) => wc.once('did-stop-loading', () => r())), delay(10_000)])
}
