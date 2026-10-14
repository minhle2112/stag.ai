import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron'

/**
 * Chặn ở cửa: IPC chỉ nhận từ khung chính của cửa sổ app, quyền trình duyệt (micro, clipboard…) chỉ cho trang app.
 * Hàm thuần (không gọi Electron) để test được; index.ts gắn vào ipcMain / session.
 */

/** Trang của app: file renderer đã build (`file:///…/renderer/index.html`) hoặc dev server của electron-vite. */
export interface AppPage {
  file: string
  dev?: string
}

/** `url` là trang của app (bỏ qua #hash / ?query). Windows: đường dẫn file không phân biệt hoa thường. */
export function isAppUrl(url: string, page: AppPage, win = process.platform === 'win32'): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (page.dev) {
    try {
      if (u.protocol !== 'file:' && u.origin === new URL(page.dev).origin) return true
    } catch {
      /* ELECTRON_RENDERER_URL hỏng: chỉ nhận file */
    }
  }
  if (u.protocol !== 'file:') return false
  const norm = (p: string): string => {
    const s = decodeURIComponent(p).replace(/\\/g, '/')
    return win ? s.toLowerCase() : s
  }
  try {
    return norm(u.pathname) === norm(new URL(page.file).pathname)
  } catch {
    return false
  }
}

interface FrameLike {
  url: string
  parent: unknown
}

/** Khung chính (không phải iframe plugin / xem trước) đang hiện trang app. */
export function isAppFrame(frame: FrameLike | null | undefined, page: AppPage): boolean {
  return !!frame && !frame.parent && isAppUrl(frame.url, page)
}

type AnyEvent = IpcMainEvent | IpcMainInvokeEvent
type Listener = (e: never, ...args: never[]) => unknown

/**
 * Bọc ipcMain một lần cho cả app: mọi `handle` / `on` đăng ký sau đó chỉ chạy khi `trusted(e)`; kênh trong `exempt`
 * (kênh lớp Soi của trang trong ô Browser, tự kiểm tra tab gửi) giữ nguyên. Bị từ chối: `invoke` nhận lỗi,
 * `sendSync` nhận null (không để trang treo), `send` bị bỏ qua.
 */
export function guardIpc(ipc: IpcMain, trusted: (e: AnyEvent) => boolean, exempt: ReadonlySet<string>, log: (msg: string) => void = console.warn): void {
  const wrapped = new WeakMap<Listener, Listener>()
  const deny = (channel: string, e: AnyEvent): void => {
    let from = '?'
    try {
      from = e.senderFrame?.url || e.sender.getURL()
    } catch {
      /* khung đã đóng */
    }
    log(`[ipc] từ chối "${channel}" từ ${from}`)
  }
  const wrapHandle = (channel: string, fn: Listener): Listener =>
    ((e: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!exempt.has(channel) && !trusted(e)) {
        deny(channel, e)
        throw new Error(`IPC "${channel}" refused: sender is not the app window`)
      }
      return (fn as (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown)(e, ...args)
    }) as Listener
  const wrapOn = (channel: string, fn: Listener): Listener => {
    const w = ((e: IpcMainEvent, ...args: unknown[]) => {
      if (!exempt.has(channel) && !trusted(e)) {
        deny(channel, e)
        e.returnValue = null
        return
      }
      ;(fn as (e: IpcMainEvent, ...a: unknown[]) => unknown)(e, ...args)
    }) as Listener
    wrapped.set(fn, w)
    return w
  }
  const handle = ipc.handle.bind(ipc)
  const handleOnce = ipc.handleOnce.bind(ipc)
  const on = ipc.on.bind(ipc)
  const once = ipc.once.bind(ipc)
  const removeListener = ipc.removeListener.bind(ipc)
  const g = ipc as unknown as Record<string, unknown>
  g.handle = (channel: string, fn: Listener) => handle(channel, wrapHandle(channel, fn) as never)
  g.handleOnce = (channel: string, fn: Listener) => handleOnce(channel, wrapHandle(channel, fn) as never)
  g.on = g.addListener = (channel: string, fn: Listener) => on(channel, wrapOn(channel, fn) as never)
  g.once = (channel: string, fn: Listener) => once(channel, wrapOn(channel, fn) as never)
  g.removeListener = g.off = (channel: string, fn: Listener) => removeListener(channel, (wrapped.get(fn) ?? fn) as never)
}

// ---- quyền trình duyệt ----

export interface PermissionAsk {
  permission: string
  /** URL khung xin quyền ('' = không rõ). */
  url: string
  isMainFrame: boolean
  /** Request: loại thiết bị xin (`audio` / `video`); check: một loại (`audio` / `video` / `unknown`). */
  mediaTypes?: string[]
}

/**
 * Trang app chỉ cần: micro (gõ bằng giọng nói), ghi clipboard (nút chép), toàn màn hình (video xem trước).
 * Chỉ khung chính của trang app được; iframe plugin / xem trước HTML và mọi trang khác bị từ chối. Mặc định: từ chối.
 */
export function appPermissionAllowed(p: PermissionAsk, page: AppPage): boolean {
  if (!p.isMainFrame || !isAppUrl(p.url, page)) return false
  switch (p.permission) {
    case 'media':
      // Chỉ thu âm, không camera / chia sẻ màn hình.
      return (p.mediaTypes ?? []).every((t) => t === 'audio' || t === 'unknown')
    case 'clipboard-sanitized-write':
    case 'fullscreen':
      return true
    default:
      return false
  }
}

/** Gắn xử lý quyền cho session của cửa sổ app (session mặc định). */
export function guardAppSession(ses: Session, page: AppPage): void {
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const d = details as { requestingUrl?: string; isMainFrame?: boolean; mediaTypes?: string[] }
    cb(appPermissionAllowed({ permission, url: d.requestingUrl ?? '', isMainFrame: !!d.isMainFrame, mediaTypes: d.mediaTypes ?? [] }, page))
  })
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const url = details.requestingUrl || (details.isMainFrame && wc ? wc.getURL() : '')
    return appPermissionAllowed({ permission, url, isMainFrame: !!details.isMainFrame, mediaTypes: details.mediaType ? [details.mediaType] : [] }, page)
  })
}

/**
 * Session khác (partition của ô Browser…): trang web lạ / agent điều khiển → từ chối mọi quyền (browser.ts cũng tự đặt
 * handler từ chối khi xin), chỉ giữ ghi clipboard (nút "Copy" của trang, như Chrome mặc định).
 */
export function guardOtherSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
}

/** WebContents của cửa sổ app (để kiểm tra người gửi IPC). */
export class AppContents {
  private ids = new Set<number>()

  add(wc: WebContents): void {
    const id = wc.id
    this.ids.add(id)
    wc.once('destroyed', () => this.ids.delete(id))
  }

  has(wc: WebContents | null | undefined): boolean {
    return !!wc && this.ids.has(wc.id)
  }
}
