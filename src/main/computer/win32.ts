/**
 * Gọi Win32 (user32 / kernel32 / dwmapi) qua koffi cho computer use: liệt kê cửa sổ theo z-order, cửa sổ dưới một
 * điểm, đưa cửa sổ lên trước, chuột / bàn phím bằng SendInput (gõ Unicode bằng KEYEVENTF_UNICODE → tiếng Việt có
 * dấu). Mọi toạ độ là pixel thật trong toạ độ ảo (tiến trình chính Electron nhận DPI theo từng màn hình).
 * Chỉ nạp koffi khi gọi lần đầu (máy không phải Windows / test không nạp).
 */
import { createRequire } from 'node:module'

export interface WinInfo {
  /** Địa chỉ HWND (chuỗi số), dùng làm id. */
  id: string
  title: string
  className: string
  pid: number
  exe: string
  /** Khung nhìn thấy (DWM extended frame bounds), pixel thật. */
  rect: { x: number; y: number; width: number; height: number }
  minimized: boolean
  /** Cửa sổ công cụ / không hiện ở thanh tác vụ / có chủ (hộp thoại, menu bật lên). */
  tool: boolean
  owned: boolean
  /** Cửa sổ nền của Windows (desktop, thanh tác vụ). */
  shell: boolean
  /**
   * Lớp phủ click xuyên qua (WS_EX_TRANSPARENT: viền của stag.ai, lớp phủ của Claude Desktop / Discord / NVIDIA…):
   * không phải nội dung của app, chuột đi xuyên qua.
   */
  clickThrough: boolean
}

type Fn = (...args: unknown[]) => unknown

interface Api {
  koffi: { address(p: unknown): bigint; struct: Fn }
  GetTopWindow: Fn
  GetWindow: Fn
  IsWindowVisible: Fn
  IsIconic: Fn
  GetWindowTextW: Fn
  GetClassNameW: Fn
  GetWindowThreadProcessId: Fn
  GetWindowLongPtrW: Fn
  DwmGetWindowAttribute: Fn
  OpenProcess: Fn
  CloseHandle: Fn
  QueryFullProcessImageNameW: Fn
  GetCursorPos: Fn
  SetCursorPos: Fn
  WindowFromPoint: Fn
  GetAncestor: Fn
  GetForegroundWindow: Fn
  SetForegroundWindow: Fn
  ShowWindow: Fn
  BringWindowToTop: Fn
  SendInput: Fn
  GetSystemMetrics: Fn
  GetWindowRect: Fn
  GetAsyncKeyState: Fn
}

let api: Api | null = null
let loadError: string | null = null

function load(): Api {
  if (api) return api
  if (loadError) throw new Error(loadError)
  if (process.platform !== 'win32') {
    loadError = 'Computer use is only available on Windows.'
    throw new Error(loadError)
  }
  try {
    const req = createRequire(__filename)
    const koffi = req('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const dwm = koffi.load('dwmapi.dll')
    koffi.struct('STAG_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    koffi.struct('STAG_POINT', { x: 'int32', y: 'int32' })
    api = {
      koffi,
      GetTopWindow: user32.func('void * __stdcall GetTopWindow(void *h)'),
      GetWindow: user32.func('void * __stdcall GetWindow(void *h, uint32_t cmd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *h)'),
      IsIconic: user32.func('bool __stdcall IsIconic(void *h)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *h, _Out_ uint16_t *buf, int n)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(void *h, _Out_ uint16_t *buf, int n)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *h, _Out_ uint32_t *pid)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *h, int idx)'),
      DwmGetWindowAttribute: dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *h, uint32_t attr, _Out_ void *buf, uint32_t size)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *h)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, _Out_ uint16_t *buf, _Inout_ uint32_t *size)'),
      GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ STAG_POINT *p)'),
      SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
      WindowFromPoint: user32.func('void * __stdcall WindowFromPoint(STAG_POINT p)'),
      GetAncestor: user32.func('void * __stdcall GetAncestor(void *h, uint32_t flags)'),
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *h)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(void *h, int cmd)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(void *h)'),
      SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t n, void *inputs, int size)'),
      GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int i)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *h, _Out_ STAG_RECT *r)'),
      GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vk)')
    }
    return api
  } catch (e) {
    loadError = `Computer use could not load its Windows input library (koffi): ${(e as Error).message}`
    throw new Error(loadError)
  }
}

/** Có dùng được không (Windows + koffi nạp được); không ném lỗi. */
export function available(): { ok: boolean; error?: string } {
  try {
    load()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd'])
const exeCache = new Map<number, { exe: string; at: number }>()

function text(fn: Fn, h: unknown): string {
  const buf = new Uint16Array(512)
  const n = fn(h, buf, 512) as number
  return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : ''
}

/** Đường dẫn exe của một tiến trình ('' = không đọc được, vd. tiến trình hệ thống). Nhớ 30 s. */
export function exeOfPid(pid: number): string {
  const c = exeCache.get(pid)
  if (c && Date.now() - c.at < 30_000) return c.exe
  const a = load()
  let exe = ''
  const h = a.OpenProcess(0x1000, false, pid)
  if (h) {
    const buf = new Uint16Array(1024)
    const size = [1024]
    if (a.QueryFullProcessImageNameW(h, 0, buf, size)) exe = String.fromCharCode(...buf.subarray(0, size[0]))
    a.CloseHandle(h)
  }
  exeCache.set(pid, { exe, at: Date.now() })
  if (exeCache.size > 500) exeCache.clear()
  return exe
}

function info(a: Api, h: unknown): WinInfo {
  const pidOut = [0]
  a.GetWindowThreadProcessId(h, pidOut)
  const ex = Number(a.GetWindowLongPtrW(h, -20))
  const className = text(a.GetClassNameW, h)
  const buf = Buffer.alloc(16)
  let rect: WinInfo['rect']
  // DWMWA_EXTENDED_FRAME_BOUNDS (9): khung nhìn thấy, không gồm viền kéo giãn vô hình (GetWindowRect lệch ~8 px).
  if (a.DwmGetWindowAttribute(h, 9, buf, 16) === 0) {
    const l = buf.readInt32LE(0)
    const t = buf.readInt32LE(4)
    rect = { x: l, y: t, width: buf.readInt32LE(8) - l, height: buf.readInt32LE(12) - t }
  } else {
    const r = { left: 0, top: 0, right: 0, bottom: 0 }
    a.GetWindowRect(h, r)
    rect = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
  }
  return {
    id: String(a.koffi.address(h)),
    title: text(a.GetWindowTextW, h),
    className,
    pid: pidOut[0],
    exe: exeOfPid(pidOut[0]),
    rect,
    minimized: !!a.IsIconic(h),
    tool: !!(ex & 0x80) || !!(ex & 0x08000000),
    owned: !!a.GetWindow(h, 4),
    shell: SHELL_CLASSES.has(className),
    clickThrough: !!(ex & 0x20)
  }
}

function cloaked(a: Api, h: unknown): boolean {
  const b = Buffer.alloc(4)
  return a.DwmGetWindowAttribute(h, 14, b, 4) === 0 && b.readUInt32LE(0) !== 0
}

/** Cửa sổ cấp cao đang hiện (kể cả thu nhỏ), từ trên xuống dưới theo z-order. Bỏ cửa sổ ẩn / bị DWM che (desktop ảo khác). */
export function listWindows(): WinInfo[] {
  const a = load()
  const out: WinInfo[] = []
  let h = a.GetTopWindow(null)
  let guard = 0
  while (h && guard++ < 4000) {
    if (a.IsWindowVisible(h) && !cloaked(a, h)) out.push(info(a, h))
    h = a.GetWindow(h, 2)
  }
  return out
}

/** Cửa sổ cấp cao (root owner) dưới một điểm pixel thật; null = không có. */
export function windowAt(x: number, y: number): WinInfo | null {
  const a = load()
  const h = a.WindowFromPoint({ x: Math.round(x), y: Math.round(y) })
  if (!h) return null
  // GA_ROOT (2): cửa sổ cấp cao chứa nó; hộp thoại / menu bật lên có chủ là app → vẫn tính theo exe của tiến trình.
  const root = a.GetAncestor(h, 2) ?? h
  return info(a, root)
}

/** Cửa sổ đang nhận bàn phím; null = không có (vd. màn hình khoá). */
export function foregroundWindow(): WinInfo | null {
  const a = load()
  const h = a.GetForegroundWindow()
  return h ? info(a, h) : null
}

function handleOf(a: Api, id: string): unknown {
  let h = a.GetTopWindow(null)
  let guard = 0
  while (h && guard++ < 4000) {
    if (String(a.koffi.address(h)) === id) return h
    h = a.GetWindow(h, 2)
  }
  return null
}

/**
 * Đưa một cửa sổ lên trước (khôi phục nếu đang thu nhỏ). Windows chặn SetForegroundWindow khi tiến trình gọi không
 * ở trước → nhấn-nhả Alt trước (cách thường dùng để mở khoá foreground).
 */
export function focusWindow(id: string): boolean {
  const a = load()
  const h = handleOf(a, id)
  if (!h) return false
  if (a.IsIconic(h)) a.ShowWindow(h, 9)
  keyEvents([
    { vk: 0x12, up: false },
    { vk: 0x12, up: true }
  ])
  a.BringWindowToTop(h)
  return !!a.SetForegroundWindow(h)
}

export function cursorPos(): { x: number; y: number } {
  const a = load()
  const p = { x: 0, y: 0 }
  a.GetCursorPos(p)
  return { x: p.x, y: p.y }
}

// INPUT (x64): type DWORD + đệm 4 + union 32 byte = 40 byte.
const INPUT_SIZE = 40
const MOUSE = 0
const KEYBOARD = 1

function mouseInput(buf: Buffer, off: number, dx: number, dy: number, data: number, flags: number): void {
  buf.writeUInt32LE(MOUSE, off)
  buf.writeInt32LE(dx, off + 8)
  buf.writeInt32LE(dy, off + 12)
  buf.writeInt32LE(data, off + 16)
  buf.writeUInt32LE(flags, off + 20)
}

function keyInput(buf: Buffer, off: number, vk: number, scan: number, flags: number): void {
  buf.writeUInt32LE(KEYBOARD, off)
  buf.writeUInt16LE(vk, off + 8)
  buf.writeUInt16LE(scan, off + 10)
  buf.writeUInt32LE(flags, off + 12)
}

function send(buf: Buffer, n: number): void {
  const a = load()
  const sent = a.SendInput(n, buf, INPUT_SIZE) as number
  if (sent !== n)
    throw new Error('Windows blocked the input. The target window probably runs as administrator (UIPI) or a secure desktop (UAC, lock screen) is open. Ask the user to do this step.')
}

/** Di chuột tới pixel thật (toạ độ ảo) bằng SendInput (app thấy WM_MOUSEMOVE như chuột thật), rồi đặt chính xác. */
export function moveMouse(x: number, y: number): void {
  const a = load()
  const vx = a.GetSystemMetrics(76) as number
  const vy = a.GetSystemMetrics(77) as number
  const vw = a.GetSystemMetrics(78) as number
  const vh = a.GetSystemMetrics(79) as number
  const buf = Buffer.alloc(INPUT_SIZE)
  const nx = Math.round(((x - vx) * 65535) / Math.max(1, vw - 1))
  const ny = Math.round(((y - vy) * 65535) / Math.max(1, vh - 1))
  // MOVE | ABSOLUTE | VIRTUALDESK
  mouseInput(buf, 0, nx, ny, 0, 0x0001 | 0x8000 | 0x4000)
  send(buf, 1)
  a.SetCursorPos(Math.round(x), Math.round(y))
}

const BUTTON_FLAGS = { left: [0x0002, 0x0004], right: [0x0008, 0x0010], middle: [0x0020, 0x0040] } as const

export function mouseButton(button: keyof typeof BUTTON_FLAGS, up: boolean): void {
  const buf = Buffer.alloc(INPUT_SIZE)
  mouseInput(buf, 0, 0, 0, 0, BUTTON_FLAGS[button][up ? 1 : 0])
  send(buf, 1)
}

/** Cuộn: notches > 0 = lên / phải. */
export function wheel(notches: number, horizontal: boolean): void {
  const buf = Buffer.alloc(INPUT_SIZE)
  mouseInput(buf, 0, 0, 0, Math.round(notches * 120), horizontal ? 0x1000 : 0x0800)
  send(buf, 1)
}

/** Phím nằm trong vùng mở rộng (cần KEYEVENTF_EXTENDEDKEY để không bị hiểu thành phím số bên phải). */
const EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0x5d, 0x6f, 0x90, 0x2c])

export function keyEvents(events: Array<{ vk: number; up: boolean }>): void {
  if (!events.length) return
  const buf = Buffer.alloc(INPUT_SIZE * events.length)
  events.forEach((e, i) => keyInput(buf, i * INPUT_SIZE, e.vk, 0, (e.up ? 0x0002 : 0) | (EXTENDED.has(e.vk) ? 0x0001 : 0)))
  send(buf, events.length)
}

/** Gõ các đơn vị UTF-16 (KEYEVENTF_UNICODE): mỗi đơn vị = nhấn + nhả. */
export function typeUnicode(units: number[]): void {
  if (!units.length) return
  const buf = Buffer.alloc(INPUT_SIZE * units.length * 2)
  units.forEach((u, i) => {
    keyInput(buf, i * 2 * INPUT_SIZE, 0, u, 0x0004)
    keyInput(buf, (i * 2 + 1) * INPUT_SIZE, 0, u, 0x0004 | 0x0002)
  })
  send(buf, units.length * 2)
}

/** Nút chuột / phím bổ trợ đang bị giữ (người dùng đang thao tác, hoặc agent quên nhả). */
export function keyDown(vk: number): boolean {
  const a = load()
  return ((a.GetAsyncKeyState(vk) as number) & 0x8000) !== 0
}
