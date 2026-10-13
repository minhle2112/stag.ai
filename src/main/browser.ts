import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, session as electronSession, WebContentsView, type Session, type WebContents } from 'electron'
import { browserPartition, originDecision, toUrl } from '@shared/browser'
import { DEFAULT_BROWSER, type Agent, type BrowserPermissionAsk, type BrowserSettings, type BrowserState, type BrowserTab, type BrowserTabDev, type BrowserTabOwner, type ViewRect } from '@shared/types'
import { VIEWPORT_WIDTH, type Rect, type ViewportKind } from '@shared/inspect'
import snapshotSrc from './inject/snapshot.js?raw'
import { PAGE_BG, type ThemeState } from '@shared/theme'

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
  /** Đang chờ dev server (xem devTab). */
  dev?: BrowserTabDev
  /** Chế độ Soi đang bật trên tab này. */
  inspect: boolean
  /** Khung màn hình (Desktop / Tablet / Mobile). */
  viewport: ViewportKind
  /** Đang xem ảnh bản TRƯỚC của góp ý số này (chế độ Soi). */
  before?: number
}

/** Tab trang web nhìn từ chế độ Soi (InspectService). */
export interface PageTab {
  wsId: string
  tabId: string
  wc: WebContents
  owner: BrowserTabOwner
  inspect: boolean
  viewport: ViewportKind
}

/** Móc của chế độ Soi: Ctrl+Shift+C trong trang, trang tải xong. */
export interface InspectHooks {
  toggle(wsId: string, tabId: string): void
}

interface WsBrowser {
  tabs: Tab[]
  active: string | null
  /** Origin ngoài localhost người dùng đã cho agent mở (tới khi tắt app). */
  allowed: Set<string>
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
  /** Câu hỏi đã xong mà không do người dùng bấm (hết giờ, Cài đặt đổi, xoá workspace): giao diện bỏ hộp thoại. */
  askClosed(askId: string): void
}

const CONSOLE_MAX = 300
const SNAPSHOT_MAX = 30_000
const ASK_TIMEOUT = 2 * 60_000
const SCREENSHOT_MAX_WIDTH = 1280
/** Bán kính góc của view trang (px CSS, khung pane bo 12px). */
const VIEW_RADIUS = 10

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

/** Thư mục chứa partition `persist:` của Electron trong userData. */
const PARTITIONS_DIR = 'Partitions'
const PARTITION_PREFIX = 'stag-browser-'

/**
 * Browser trong app: mỗi workspace một bộ tab (WebContentsView) với session riêng. Mặc định session chỉ trong bộ nhớ
 * (cookie mất khi tắt app); bật "Giữ cookie" (Cài đặt → Trình duyệt) thì tab mở sau đó dùng partition `persist:`.
 * Người dùng dùng qua pane; agent dùng qua tool MCP browser_*, mỗi agent một tab.
 */
export class BrowserService {
  private byWs = new Map<string, WsBrowser>()
  private win: BrowserWindow | null = null
  /** Pane đang hiện browser của workspace nào, ở vị trí nào (null = không hiện view nào). */
  private shown: { wsId: string; rect: ViewRect } | null = null
  /** Thu phóng giao diện app (Settings → Chung): vị trí renderer gửi là px CSS, view cần px cửa sổ. */
  private zoom = 1
  private asks = new Map<string, PendingAsk>()
  /** Cài đặt → Trình duyệt (cấp app). */
  private config: BrowserSettings = DEFAULT_BROWSER
  /** Partition đã gắn xử lý quyền / tải file (mỗi partition một lần). */
  private wired = new Set<string>()
  /** Chế độ Soi (gắn sau, xem attachInspect). */
  private inspectHooks: InspectHooks | null = null
  /** Màu app + màu Windows (ThemeService). Trang web giữ màu theo Windows, không theo app. */
  private theme: ThemeState | null = null
  /** Ctrl+Shift+L khi trang đang giữ bàn phím: đổi nhanh sáng / tối như ở trang app. */
  themeToggle: (() => void) | null = null

  /** `pagePreload` = script chế độ Soi chạy trong thế giới cô lập của mỗi trang (trang không đọc được nó). */
  constructor(
    private events: BrowserEvents,
    private pagePreload?: string
  ) {}

  attachInspect(hooks: InspectHooks): void {
    this.inspectHooks = hooks
  }

  /**
   * Cài đặt đổi. Áp ngay: trang tab mới, máy tìm kiếm, chính sách trang ngoài (câu hỏi đang chờ được trả lời theo
   * chính sách mới / origin vừa thêm vào danh sách luôn cho). Giữ cookie: tab mở sau khi đổi.
   */
  setSettings(next: BrowserSettings): void {
    this.config = next
    for (const [id, p] of [...this.asks]) {
      const d = originDecision(p.ask.url, next)
      if (d === 'open') this.answer(id, true, true)
      else if (d === 'deny') this.answer(id, false, true)
    }
  }

  /** Session của workspace theo cài đặt "Giữ cookie" hiện tại; gắn xử lý quyền / tải file lần đầu dùng. */
  private sessionFor(wsId: string): Session {
    const name = browserPartition(wsId, this.config.keepCookies)
    const ses = electronSession.fromPartition(name)
    if (this.wired.has(name)) return ses
    this.wired.add(name)
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.on('will-download', (event, _item, wc) => {
      // Agent không tự tải file về máy. Người dùng tải bình thường (có hộp thoại lưu).
      const tab = this.findByContents(wc)
      if (tab && tab.owner.kind === 'agent') {
        event.preventDefault()
        this.log(tab, 'warning', '[stag] Blocked a download: agents may not download files.')
      }
    })
    return ses
  }

  /**
   * Xoá cookie, bộ nhớ trang (localStorage, IndexedDB…) và cache của trình duyệt một workspace (`wsId`) hoặc mọi
   * workspace (kể cả dữ liệu đã lưu của workspace đã xoá). Cả session lưu xuống đĩa lẫn session trong bộ nhớ.
   */
  async clearData(wsId?: string): Promise<void> {
    // Partition `persist:` còn trên đĩa (workspace đang mở hay đã xoá) + partition đã dùng trong lần chạy này.
    // Không gọi fromPartition cho partition chưa từng có: nó sẽ tạo thư mục trống.
    const dir = join(app.getPath('userData'), PARTITIONS_DIR)
    const onDisk = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(PARTITION_PREFIX))
    const names = new Set<string>([...this.wired, ...onDisk.map((n) => `persist:${n}`)])
    for (const name of names) {
      if (wsId && name !== browserPartition(wsId, true) && name !== browserPartition(wsId, false)) continue
      const ses = electronSession.fromPartition(name)
      await ses.clearStorageData()
      await ses.clearCache()
    }
  }

  /**
   * Màu app đổi. `nativeTheme.themeSource` lật cả `prefers-color-scheme` của trang web, nên khi màu app khác màu Windows
   * thì ghim lại màu Windows cho mọi tab bằng CDP; nền view (trước khi trang vẽ) theo màu app.
   */
  setTheme(s: ThemeState): void {
    this.theme = s
    for (const b of this.byWs.values())
      for (const t of b.tabs) {
        t.view.setBackgroundColor(PAGE_BG[s.theme])
        void this.pinScheme(t)
      }
  }

  /** Áp ghim `prefers-color-scheme` cho một tab (gắn debugger nếu cần). Lỗi (tab đóng, DevTools giữ…) thì bỏ qua. */
  private async pinScheme(tab: Tab): Promise<void> {
    const s = this.theme
    const wc = tab.view.webContents
    if (!s || wc.isDestroyed()) return
    const page = s.windowsDark ? 'dark' : 'light'
    const pin = s.theme !== page
    // Không cần ghim mà debugger chưa gắn: không gắn chỉ để gỡ ghim.
    if (!pin && !tab.cdp) return
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      tab.cdp = true
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: pin ? page : '' }] })
    } catch {
      /* tab đã đóng / không gắn được debugger */
    }
  }

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
      b = { tabs: [], active: null, allowed: new Set() }
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
    if (!t) throw new Error('Tab no longer exists')
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
        // Theo "Giữ cookie" lúc mở tab: đổi cài đặt chỉ áp cho tab mở sau đó.
        session: this.sessionFor(wsId),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Lớp Soi: chạy trong thế giới cô lập (contextIsolation), chỉ nói chuyện với main qua IPC, trang không chạm tới.
        ...(this.pagePreload ? { preload: this.pagePreload } : {}),
        // Tab của agent thường không hiện trên màn hình mà vẫn phải chạy bình thường.
        backgroundThrottling: false
      }
    })
    view.setBackgroundColor(PAGE_BG[this.theme?.theme ?? 'dark'])
    // Pane là khung nổi bo góc (như Claude desktop): bo cả trang cho khớp góc dưới của khung.
    view.setBorderRadius(VIEW_RADIUS)
    view.setVisible(false)
    const tab: Tab = { id: randomUUID(), wsId, owner, view, console: [], cdp: false, inspect: false, viewport: 'desk' }
    b.tabs.push(tab)
    b.active = tab.id
    this.wire(tab)
    void this.pinScheme(tab)
    this.win?.contentView.addChildView(view)
    if (url) view.webContents.loadURL(url).catch(() => {})
    this.layout()
    this.emit(wsId)
    return tab
  }

  /** Người dùng mở tab mới: chữ gõ ở thanh địa chỉ (tìm bằng máy tìm kiếm đã chọn), hoặc trang tab mới trong Cài đặt. */
  openUserTab(wsId: string, input?: string): void {
    const url = input?.trim() ? toUrl(input, this.config.searchEngine) : this.config.homePage || undefined
    this.newTab(wsId, { kind: 'user' }, url)
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const changed = (): void => this.emit(tab.wsId)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-navigate', changed)
    wc.on('did-navigate-in-page', changed)
    wc.on('devtools-opened', changed)
    wc.on('devtools-closed', changed)
    // Ctrl+Shift+C khi trang đang giữ bàn phím (ô Browser đang chọn): bật / tắt Soi. Ô khác (terminal) không nhận
    // phím này nên không đụng tới phím chép của terminal.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !input.control || !input.shift || input.alt || input.meta) return
      if (input.key.toLowerCase() === 'l' && this.themeToggle) {
        e.preventDefault()
        return this.themeToggle()
      }
      if (input.key.toLowerCase() !== 'c' || !this.inspectHooks) return
      e.preventDefault()
      this.inspectHooks.toggle(tab.wsId, tab.id)
    })

    wc.on('console-message', (e) => {
      // Cảnh báo bảo mật của chính Electron về trang (thiếu CSP…), không phải lỗi của trang.
      // (Có thể kèm `%c` định dạng màu ở đầu.)
      if (/^(%c)?Electron Security Warning/.test(e.message)) return
      this.log(tab, e.level, e.message + (e.sourceId ? `  (${e.sourceId}:${e.lineNumber})` : ''))
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.log(tab, 'error', `[stag] Failed to load ${url}: ${desc} (${code})`)
    })
    wc.on('render-process-gone', (_e, d) => this.log(tab, 'error', `[stag] Page crashed: ${d.reason}`))
    wc.on('did-navigate', (_e, url) => {
      // Trang mới: ảnh bản TRƯỚC (chế độ Soi) không còn nằm đè lên trang nữa.
      tab.before = undefined
      this.log(tab, 'info', `[stag] Opened ${url}`)
      // Ghim màu trang có thể mất khi trang đổi tiến trình; áp lại (rẻ, không gắn thêm gì nếu không cần).
      void this.pinScheme(tab)
    })

    // Agent bấm link / bị chuyển hướng sang origin chưa được phép → chặn, bảo agent xin quyền
    // (hoặc báo Cài đặt chặn hẳn trang ngoài).
    const guard = (e: Electron.Event, url: string, isMainFrame = true): void => {
      if (tab.owner.kind !== 'agent' || !isMainFrame) return
      const d = this.decide(tab.wsId, url)
      if (d === 'open') return
      e.preventDefault()
      this.log(
        tab,
        'warning',
        d === 'deny'
          ? `[stag] Blocked navigation to ${url}: the user's stag.ai settings block agents from opening pages outside localhost.`
          : `[stag] Blocked navigation to ${url}: not allowed yet. Call browser_navigate with this URL to ask the user for permission.`
      )
    }
    wc.on('will-navigate', (e) => guard(e, e.url))
    wc.on('will-redirect', (e) => guard(e, e.url, e.isMainFrame))

    // Popup / target=_blank: tab người dùng → tab mới; tab agent → mở luôn trong tab của agent.
    wc.setWindowOpenHandler(({ url }) => {
      if (tab.owner.kind === 'agent') {
        if (this.decide(tab.wsId, url) === 'open') wc.loadURL(url).catch(() => {})
        else this.log(tab, 'warning', `[stag] Blocked opening a window for ${url}: not allowed.`)
      } else {
        this.newTab(tab.wsId, { kind: 'user' }, url)
      }
      return { action: 'deny' }
    })
    wc.debugger.on('detach', () => {
      tab.cdp = false
      // Mở / đóng DevTools tách debugger và xoá ghim màu trang theo Windows: gắn lại sau khi DevTools gắn xong.
      setTimeout(() => void this.pinScheme(tab), 300)
    })
    const repin = (): void => void setTimeout(() => void this.pinScheme(tab), 300)
    wc.on('devtools-opened', repin)
    wc.on('devtools-closed', repin)
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
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    // Cửa sổ DevTools đi theo tab: đóng trước để không còn cửa sổ mồ côi.
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    wc.close()
  }

  /**
   * Mở / đóng DevTools của tab. Luôn là cửa sổ riêng (`detach`): view nằm đè lên giao diện app
   * nên DevTools gắn vào cửa sổ app sẽ bị che. Dùng chung được với `webContents.debugger` của tool agent.
   */
  toggleDevTools(wsId: string, tabId: string): void {
    const tab = this.tab(wsId, tabId)
    const wc = tab.view.webContents
    if (wc.isDevToolsOpened()) return wc.closeDevTools()
    const who = tab.owner.kind === 'agent' ? `agent ${tab.owner.agentName}` : 'tab'
    wc.openDevTools({ mode: 'detach', activate: true, title: `DevTools · ${who} · ${wc.getURL() || 'about:blank'}` })
  }

  activate(wsId: string, tabId: string): void {
    const b = this.byWs.get(wsId)
    if (!b?.tabs.some((t) => t.id === tabId)) return
    b.active = tabId
    this.layout()
    this.emit(wsId)
  }

  navigate(wsId: string, tabId: string, input: string): void {
    const tab = this.tab(wsId, tabId)
    if (tab.dev) {
      tab.dev = undefined
      this.emit(wsId)
    }
    tab.view.webContents.loadURL(toUrl(input, this.config.searchEngine)).catch(() => {})
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

  // ---- dev server (Tab mới → "Dùng cái này") ----

  /**
   * Đánh dấu tab của người dùng đang chờ dev server; `tabId` không còn (hoặc vắng) thì mở tab mới. Trả về id tab.
   * Tab đó hiện trạng thái khởi động thay cho trang trống tới khi devOpen / devFail.
   */
  devTab(wsId: string, tabId: string | undefined, dev: BrowserTabDev): string {
    const b = this.ws(wsId)
    let tab = tabId ? b.tabs.find((t) => t.id === tabId && t.owner.kind === 'user') : undefined
    if (!tab) tab = this.newTab(wsId, { kind: 'user' })
    tab.dev = dev
    b.active = tab.id
    this.layout()
    this.emit(wsId)
    return tab.id
  }

  devUpdate(wsId: string, tabId: string, patch: Partial<BrowserTabDev>): void {
    const tab = this.byWs.get(wsId)?.tabs.find((t) => t.id === tabId)
    if (!tab?.dev) return
    tab.dev = { ...tab.dev, ...patch }
    this.emit(wsId)
  }

  /** Server đã lên: mở trang trong tab (nếu tab còn và vẫn đang chờ — người dùng chưa gõ địa chỉ khác). */
  devOpen(wsId: string, tabId: string, url: string): void {
    const tab = this.byWs.get(wsId)?.tabs.find((t) => t.id === tabId)
    if (!tab?.dev) return
    tab.dev = undefined
    tab.view.webContents.loadURL(url).catch(() => {})
    this.emit(wsId)
  }

  /** Bỏ trạng thái chờ (Huỷ / Quay lại): tab về trang trống. */
  devClear(wsId: string, tabId: string): void {
    const tab = this.byWs.get(wsId)?.tabs.find((t) => t.id === tabId)
    if (!tab?.dev) return
    tab.dev = undefined
    this.emit(wsId)
  }

  /** Giao diện báo vị trí pane (null = pane đóng, hoặc đang có hộp thoại che). */
  setBounds(wsId: string | null, rect: ViewRect | null): void {
    this.shown = wsId && rect ? { wsId, rect } : null
    this.layout()
  }

  setZoom(factor: number): void {
    if (factor === this.zoom) return
    this.zoom = factor
    this.layout()
  }

  private layout(): void {
    for (const [wsId, b] of this.byWs) {
      for (const tab of b.tabs) {
        const visible = !!this.shown && this.shown.wsId === wsId && b.active === tab.id
        if (visible) {
          const r = viewportRect(this.shown!.rect, tab.viewport)
          const z = this.zoom
          tab.view.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) })
        }
        const wasVisible = tab.view.getVisible()
        tab.view.setVisible(visible)
        // Hiện lại sau khi ẩn (hộp thoại, kéo đổi độ rộng): ép vẽ lại, nếu không lúc cửa sổ đang bị che
        // view có thể giữ khung trống tới lần trang tự vẽ tiếp.
        if (visible && !wasVisible && !tab.view.webContents.isDestroyed()) tab.view.webContents.invalidate()
      }
    }
  }

  // ---- chế độ Soi ----

  private pageOf(t: Tab): PageTab {
    return { wsId: t.wsId, tabId: t.id, wc: t.view.webContents, owner: t.owner, inspect: t.inspect, viewport: t.viewport }
  }

  /** Tab có trang `wc` (IPC từ lớp Soi của trang: chỉ nhận từ tab của app). */
  pageTab(wc: WebContents): PageTab | null {
    const t = this.findByContents(wc)
    return t ? this.pageOf(t) : null
  }

  page(wsId: string, tabId: string): PageTab | null {
    const t = this.byWs.get(wsId)?.tabs.find((x) => x.id === tabId)
    return t && !t.view.webContents.isDestroyed() ? this.pageOf(t) : null
  }

  pages(wsId: string): PageTab[] {
    return (this.byWs.get(wsId)?.tabs ?? []).filter((t) => !t.view.webContents.isDestroyed()).map((t) => this.pageOf(t))
  }

  /** Bật / tắt Soi trên tab; trả về trạng thái mới. Tắt thì bỏ luôn chế độ xem bản trước. */
  setInspect(wsId: string, tabId: string, on: boolean): boolean {
    const t = this.tab(wsId, tabId)
    if (t.inspect === on) return on
    t.inspect = on
    this.emit(wsId)
    return on
  }

  setViewport(wsId: string, tabId: string, kind: ViewportKind): void {
    const t = this.tab(wsId, tabId)
    if (t.viewport === kind) return
    t.viewport = kind
    this.layout()
    this.emit(wsId)
  }

  /** Góp ý đang xem ảnh bản TRƯỚC trên tab (thanh "Đang xem bản TRƯỚC" của pane). */
  setBefore(wsId: string, tabId: string, id: number | undefined): void {
    const t = this.byWs.get(wsId)?.tabs.find((x) => x.id === tabId)
    if (!t || t.before === id) return
    t.before = id
    this.emit(wsId)
  }

  /**
   * Ảnh PNG một vùng của trang (`rect` px CSS trong khung nhìn). Trang đang hiện: webContents.capturePage(rect) — đúng
   * cái người dùng thấy. Trang đang ẩn (pane đóng, hộp thoại che) capturePage trả ảnh rỗng → chụp qua CDP (vùng cắt
   * của CDP tính theo toạ độ tài liệu nên cần `scroll` của trang).
   */
  async capture(wsId: string, tabId: string, rect: Rect, scroll = { x: 0, y: 0 }): Promise<Buffer | null> {
    const t = this.byWs.get(wsId)?.tabs.find((x) => x.id === tabId)
    if (!t || t.view.webContents.isDestroyed()) return null
    const wc = t.view.webContents
    const z = wc.getZoomFactor()
    const r = { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), w: Math.ceil(rect.w), h: Math.ceil(rect.h) }
    if (r.w < 1 || r.h < 1) return null
    if (t.view.getVisible()) {
      // capturePage có lúc không bao giờ xong (view vừa đổi cỡ / chưa vẽ lại): quá 1,5 giây thì chụp qua CDP.
      const img = await Promise.race([
        wc.capturePage({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.w * z), height: Math.round(r.h * z) }),
        delay(1500).then(() => null)
      ]).catch(() => null)
      if (img && !img.isEmpty()) return img.toPNG()
    }
    try {
      const clip = { x: r.x + scroll.x, y: r.y + scroll.y, width: r.w, height: r.h, scale: 1 }
      const res = (await this.cdp(t, 'Page.captureScreenshot', { format: 'png', clip })) as { data: string }
      return Buffer.from(res.data, 'base64')
    } catch {
      return null
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
    for (const [id, p] of this.asks) if (p.ask.workspaceId === wsId) this.answer(id, false, true)
  }

  // ---- quyền ----

  /** Agent mở `raw` được không (xem originDecision): localhost, origin luôn cho, chính sách trang ngoài, origin đã cho lần này. */
  private decide(wsId: string, raw: string): ReturnType<typeof originDecision> {
    return originDecision(raw, this.config, (origin) => !!this.byWs.get(wsId)?.allowed.has(origin))
  }

  /** `auto` = app tự trả lời (hết giờ, Cài đặt đổi…), không phải người dùng bấm: báo giao diện bỏ hộp thoại. */
  answer(askId: string, allow: boolean, auto = false): void {
    const p = this.asks.get(askId)
    if (!p) return
    this.asks.delete(askId)
    if (auto) this.events.askClosed(askId)
    p.resolve(allow)
  }

  private askUser(wsId: string, agent: Agent, url: URL): Promise<boolean> {
    const ask: BrowserPermissionAsk = { id: randomUUID(), workspaceId: wsId, agentName: agent.name, origin: url.origin, url: url.href }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.answer(ask.id, false, true), ASK_TIMEOUT)
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
    if (!tab) throw new Error('You have no tab yet. Call browser_navigate first.')
    return tab
  }

  async agentNavigate(agent: Agent, raw: string): Promise<string> {
    let url: URL
    try {
      url = new URL(toUrl(raw, this.config.searchEngine))
    } catch {
      throw new Error(`Invalid URL: ${raw}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.href !== 'about:blank')
      throw new Error('Only http/https pages can be opened.')
    const wsId = agent.workspaceId
    const d = this.decide(wsId, url.href)
    if (d === 'deny')
      throw new Error(
        `The user's stag.ai settings block agents from opening pages outside localhost (${url.origin}). Do not retry unless the user changes this setting.`
      )
    if (d !== 'open') {
      const allow = await this.askUser(wsId, agent, url)
      if (!allow) throw new Error(`The user did not allow opening ${url.origin}. Do not retry this page unless the user says so.`)
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
      if (!/ERR_ABORTED/.test(msg)) throw new Error(`Could not open ${url.href}: ${msg}`)
    }
    await settle(wc)
    return `Opened: ${wc.getURL()}\nTitle: ${wc.getTitle()}\nCall browser_snapshot to read the page and get the [ref] numbers of buttons/inputs.`
  }

  async agentSnapshot(agent: Agent): Promise<string> {
    const wc = this.requireAgentTab(agent).view.webContents
    await settle(wc, 0)
    return (await wc.executeJavaScript(`${snapshotSrc}(${SNAPSHOT_MAX})`)) as string
  }

  private async cdp(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const dbg = tab.view.webContents.debugger
    if (!tab.cdp) {
      const fresh = !dbg.isAttached()
      if (fresh) dbg.attach('1.3')
      tab.cdp = true
      // Gắn lại sau khi debugger bị tách: ghim màu trang theo Windows mất theo, áp lại.
      if (fresh) void this.pinScheme(tab)
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
    if (!pos) throw new Error(`Element [${ref}] not found (did the page change?). Call browser_snapshot to get fresh refs.`)
    return pos
  }

  /** Thông báo chặn của app phát sinh trong lúc thao tác (để agent biết vì sao trang không đổi). */
  private blockedSince(tab: Tab, before: number): string {
    const notes = tab.console.slice(before).filter((e) => e.text.startsWith('[stag] Blocked'))
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
    return `Clicked [${ref}]. Current page: ${wc.getURL()} — ${wc.getTitle()}` + this.blockedSince(tab, before)
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
    return (submit ? `Typed into [${ref}] and pressed Enter.` : `Typed into [${ref}].`) + this.blockedSince(tab, before)
  }

  async agentPress(agent: Agent, keyName: string): Promise<string> {
    const tab = this.requireAgentTab(agent)
    const before = tab.console.length
    await this.key(tab, keyName)
    await settle(tab.view.webContents)
    return `Pressed ${keyName}.` + this.blockedSince(tab, before)
  }

  private async key(tab: Tab, keyName: string): Promise<void> {
    const k = KEYS[keyName]
    if (!k) throw new Error(`Unsupported key: ${keyName}`)
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
    if (!tab) return 'You have no tab yet.'
    const entries = tab.console.filter((e) => !onlyErrors || e.level === 'error' || e.level === 'warning')
    tab.console = []
    if (!entries.length) return onlyErrors ? 'No new errors/warnings.' : 'Nothing new in the console.'
    return entries.map((e) => `${e.at.slice(11, 19)} [${e.level}] ${e.text}`).join('\n')
  }

  shutdown(): void {
    for (const id of [...this.asks.keys()]) this.answer(id, false)
    for (const wsId of [...this.byWs.keys()]) this.closeWorkspace(wsId)
    // Giữ cookie: ghi nốt dữ liệu trang / cookie còn trong bộ nhớ xuống đĩa.
    for (const name of this.wired) {
      if (!name.startsWith('persist:')) continue
      const ses = electronSession.fromPartition(name)
      ses.flushStorageData()
      void ses.cookies.flushStore()
    }
  }

  /** Agent đổi tên: nhãn trên tab browser của nó đổi theo. */
  renameAgent(agentId: string, agentName: string): void {
    for (const [wsId, b] of this.byWs) {
      const mine = b.tabs.filter((t) => t.owner.kind === 'agent' && t.owner.agentId === agentId)
      if (!mine.length) continue
      for (const t of mine) t.owner = { kind: 'agent', agentId, agentName }
      this.emit(wsId)
    }
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
    canGoForward: !dead && wc.navigationHistory.canGoForward(),
    devtools: !dead && wc.isDevToolsOpened(),
    inspect: t.inspect,
    viewport: t.viewport,
    ...(t.before !== undefined ? { before: t.before } : {}),
    ...(t.dev ? { dev: t.dev } : {})
  }
}

/** Vùng của view theo khung màn hình: Tablet / Mobile = bề ngang cố định, đặt giữa (hẹp hơn thì lấy hết). */
export function viewportRect(r: ViewRect, kind: ViewportKind): ViewRect {
  if (kind === 'desk') return r
  const width = Math.min(r.width, VIEWPORT_WIDTH[kind])
  return { x: r.x + Math.floor((r.width - width) / 2), y: r.y, width, height: r.height }
}

/** Chờ trang ổn định sau một thao tác: đợi chút, nếu đang tải thì chờ tải xong (tối đa 10 giây). */
async function settle(wc: WebContents, ms = 300): Promise<void> {
  if (ms) await delay(ms)
  if (!wc.isLoading()) return
  await Promise.race([new Promise<void>((r) => wc.once('did-stop-loading', () => r())), delay(10_000)])
}
