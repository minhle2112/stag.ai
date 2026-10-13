import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { composerFor } from './store/chat'
import { TERMINAL_PALETTES, type Theme } from '@shared/theme'

/**
 * Terminal của từng agent sống ngoài React: khi ô gắn lại (đóng / mở ô, đổi workspace), phần tử DOM của terminal
 * được chuyển sang ô mới chứ không tạo lại, nên không mất nội dung và không ngắt phiên.
 */
interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  opened: boolean
  ptyId: string | null
  input: { dispose: () => void } | null
  /** Kích thước đã báo cho tiến trình gần nhất, và hẹn giờ báo kích thước mới. */
  sent: { cols: number; rows: number } | null
  resizeTimer: ReturnType<typeof setTimeout> | null
}

/** Chờ người dùng ngừng kéo (pane browser, cạnh ô trên canvas) rồi mới báo kích thước cho tiến trình. */
const RESIZE_DEBOUNCE_MS = 80

const entries = new Map<string, Entry>()
const agentByPty = new Map<string, string>()
/** Dữ liệu tới trước khi terminal kịp gắn với agent. */
const pending = new Map<string, string[]>()
const exitListeners = new Set<(agentId: string, ptyId: string) => void>()
let busStarted = false

/** Màu terminal hiện tại (store/theme.ts đặt): đủ 16 màu ANSI, sáng hoặc tối. */
let palette: Theme = document.documentElement.dataset.theme === 'light' && !('termdark' in document.documentElement.dataset) ? 'light' : 'dark'

/** Đổi màu mọi terminal đang mở ngay, không mở lại phiên. */
export function setTerminalTheme(t: Theme): void {
  if (t === palette) return
  palette = t
  for (const e of entries.values()) e.term.options.theme = TERMINAL_PALETTES[t]
}

export function startTerminalBus(): void {
  if (busStarted) return
  busStarted = true
  window.stag.pty.onAnyData((ptyId, data) => {
    const agentId = agentByPty.get(ptyId)
    if (agentId) entries.get(agentId)?.term.write(data)
    else pending.set(ptyId, [...(pending.get(ptyId) ?? []), data])
  })
  window.stag.pty.onAnyExit((ptyId, { exitCode }) => {
    const agentId = agentByPty.get(ptyId)
    pending.delete(ptyId)
    if (!agentId) return
    agentByPty.delete(ptyId)
    const e = entries.get(agentId)
    if (e && e.ptyId === ptyId) {
      e.ptyId = null
      e.input?.dispose()
      e.input = null
      e.term.write(`\r\n\x1b[90m[phiên đã đóng, mã ${exitCode}]\x1b[0m\r\n`)
    }
    exitListeners.forEach((fn) => fn(agentId, ptyId))
  })
}

export function onAgentExit(fn: (agentId: string, ptyId: string) => void): () => void {
  exitListeners.add(fn)
  return () => exitListeners.delete(fn)
}

/** Cỡ chữ mọi terminal (Settings → Chung → Terminal). */
let fontSize = 13

/** Đang chạy hiệu ứng phóng to / thu về của canvas: ô đổi cỡ mỗi khung hình, chỉ canh terminal một lần lúc xong. */
let fitSuspended = false

export function suspendFit(on: boolean): void {
  fitSuspended = on
  if (!on) for (const agentId of entries.keys()) fitTerminal(agentId)
}

type Coords = { clientX: number; clientY: number }
interface MouseServiceLike {
  getCoords: (event: Coords, element: HTMLElement, ...rest: unknown[]) => unknown
  getMouseReportCoords: (event: MouseEvent, element: HTMLElement) => unknown
}

/**
 * Canvas thu nhỏ ô bằng CSS transform; xterm tính ô chữ dưới chuột bằng (clientX - mép trái) / bề rộng ô chữ chưa
 * thu nhỏ → chọn chữ / bấm link lệch. Đổi toạ độ chuột về hệ chưa thu nhỏ trước khi xterm dùng (MouseService là phần
 * nội bộ của xterm 6; không có thì bỏ qua, chỉ mất độ chính xác khi zoom ≠ 100%).
 */
function patchMouseForScale(term: Terminal): void {
  const ms = (term as unknown as { _core?: { _mouseService?: MouseServiceLike } })._core?._mouseService
  if (!ms || typeof ms.getCoords !== 'function' || typeof ms.getMouseReportCoords !== 'function') return
  const unscale = <T extends Coords>(event: T, el: HTMLElement): T => {
    const r = el.getBoundingClientRect()
    const s = el.offsetWidth ? r.width / el.offsetWidth : 1
    if (!s || Math.abs(s - 1) < 0.001) return event
    const clientX = r.left + (event.clientX - r.left) / s
    const clientY = r.top + (event.clientY - r.top) / s
    return new Proxy(event, {
      get: (t, k) => {
        if (k === 'clientX') return clientX
        if (k === 'clientY') return clientY
        const v = Reflect.get(t, k)
        // Hàm gốc của MouseEvent (preventDefault…) phải gọi trên chính sự kiện, không phải trên Proxy.
        return typeof v === 'function' ? v.bind(t) : v
      }
    })
  }
  const getCoords = ms.getCoords.bind(ms)
  const getReport = ms.getMouseReportCoords.bind(ms)
  ms.getCoords = (event, element, ...rest) => getCoords(unscale(event, element), element, ...rest)
  ms.getMouseReportCoords = (event, element) => getReport(unscale(event, element), element)
}

/** Đổi cỡ chữ: áp cho terminal đang có rồi canh lại kích thước (số cột/dòng đổi theo). */
export function setTerminalFontSize(size: number): void {
  if (size === fontSize) return
  fontSize = size
  for (const [agentId, e] of entries) {
    e.term.options.fontSize = size
    fitTerminal(agentId)
  }
}

function entry(agentId: string): Entry {
  let e = entries.get(agentId)
  if (!e) {
    const el = document.createElement('div')
    el.style.width = '100%'
    el.style.height = '100%'
    const term = new Terminal({
      // Phông riêng cho terminal (không theo --font-mono của giao diện): TUI của Claude / Codex vẽ khung bằng ký tự Unicode.
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      theme: TERMINAL_PALETTES[palette],
      // Chữ mờ của Claude Code là SGR 2 (xterm vẽ bằng màu chữ nhạt đi một nửa) → trên nền trắng chỉ ~3:1. xterm tự đẩy
      // màu chữ lên cho đủ 4.5:1 với nền (cả hai chế độ).
      minimumContrastRatio: 4.5
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.attachCustomKeyEventHandler((ev) => clipboardKey(term, ev))
    e = { term, fit, el, opened: false, ptyId: null, input: null, sent: null, resizeTimer: null }
    entries.set(agentId, e)
  }
  return e
}

/**
 * Chép / dán kiểu Windows Terminal. Mặc định xterm đổi Ctrl+V thành ^V và Ctrl+C thành ^C gửi thẳng vào phiên (chặn luôn
 * sự kiện paste của trình duyệt), nên không dán được gì từ ngoài vào. Ctrl+V / Ctrl+Shift+V: dán chữ, hoặc ảnh (qua file
 * PNG tạm, xem pty.clipboard). Ctrl+C khi đang bôi đen: chép rồi bỏ bôi đen; không bôi đen thì vẫn là ^C để ngắt.
 * Trả false = xterm bỏ qua phím này.
 */
function clipboardKey(term: Terminal, ev: KeyboardEvent): boolean {
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return true
  const key = ev.key.toLowerCase()
  const copy = key === 'c' && term.hasSelection()
  if (key !== 'v' && !copy) return true
  // Chặn cả keypress / keyup của tổ hợp này; chỉ làm việc ở keydown. preventDefault để trình duyệt không dán thêm lần nữa.
  ev.preventDefault()
  if (ev.type !== 'keydown') return false
  if (copy) {
    void navigator.clipboard.writeText(term.getSelection())
    term.clearSelection()
  } else {
    void window.stag.pty.clipboard().then((clip) => {
      if (!clip) return
      if ('text' in clip) term.paste(clip.text)
      else term.paste(/\s/.test(clip.imagePath) ? `"${clip.imagePath}"` : clip.imagePath)
    })
  }
  return false
}

/** Gắn terminal của agent vào một ô; trả về hàm gỡ ra. */
export function attachTerminal(agentId: string, host: HTMLElement): () => void {
  const e = entry(agentId)
  host.appendChild(e.el)
  if (!e.opened) {
    e.term.open(e.el)
    e.opened = true
    patchMouseForScale(e.term)
  }
  fitTerminal(agentId)
  return () => {
    if (e.el.parentElement === host) host.removeChild(e.el)
  }
}

/**
 * Canh lại kích thước theo ô ngay (để hình không giật), còn việc báo cho tiến trình thì gom lại:
 * kéo pane gọi hàm này mỗi khung hình, mỗi lần báo là Claude TUI vẽ lại cả màn hình.
 */
export function fitTerminal(agentId: string): void {
  const e = entries.get(agentId)
  if (fitSuspended || !e || !e.opened || !e.el.isConnected || e.el.clientWidth === 0 || e.el.clientHeight === 0) return
  e.fit.fit()
  if (e.resizeTimer) clearTimeout(e.resizeTimer)
  e.resizeTimer = setTimeout(() => {
    e.resizeTimer = null
    sendSize(e)
  }, RESIZE_DEBOUNCE_MS)
}

/** Báo kích thước cho tiến trình, bỏ qua nếu không đổi so với lần báo trước. */
function sendSize(e: Entry, force = false): void {
  if (!e.ptyId) return
  const { cols, rows } = e.term
  if (!force && e.sent && e.sent.cols === cols && e.sent.rows === rows) return
  e.sent = { cols, rows }
  window.stag.pty.resize(e.ptyId, cols, rows)
}

export function terminalSize(agentId: string): { cols: number; rows: number } {
  const t = entry(agentId).term
  return { cols: t.cols, rows: t.rows }
}

/** Nối terminal của agent với một tiến trình đang chạy. */
export function bindPty(agentId: string, ptyId: string): void {
  const e = entry(agentId)
  if (e.ptyId === ptyId) return
  e.input?.dispose()
  e.ptyId = ptyId
  agentByPty.set(ptyId, agentId)
  for (const chunk of pending.get(ptyId) ?? []) e.term.write(chunk)
  pending.delete(ptyId)
  e.input = e.term.onData((data) => window.stag.pty.write(ptyId, data))
  e.sent = null
  if (e.opened) sendSize(e, true)
}

/**
 * Dán chữ vào terminal của agent như người dùng dán (gõ bằng giọng nói): xterm tự bọc bracketed paste nếu chương trình
 * bật (Claude Code, Codex) nên xuống dòng không gửi tin giữa chừng. Chỉ nhấn Enter khi `submit` (người dùng nói "gửi").
 * false = ô không có phiên đang chạy.
 * Ô chat (store/chat.ts): chữ đi vào ô soạn tin của ô đó, "gửi" = gửi tin.
 */
export function pasteIntoTerminal(agentId: string, text: string, submit = false): boolean {
  const composer = composerFor(agentId)
  if (composer) return composer.insert(text, submit)
  const e = entries.get(agentId)
  if (!e?.ptyId) return false
  const ptyId = e.ptyId
  // Chương trình không bật bracketed paste (vd. Windows PowerShell 5.1): xuống dòng khi dán = Enter, dòng đầu chạy luôn.
  // Gộp thành một dòng để không bao giờ tự gửi.
  if (text) e.term.paste(e.term.modes.bracketedPasteMode ? text : text.replace(/\s*\r?\n\s*/g, ' '))
  // Enter tách khỏi phần dán một chút để chương trình xử lý xong đoạn dán trước.
  if (submit) setTimeout(() => window.stag.pty.write(ptyId, '\r'), text ? 80 : 0)
  e.term.focus()
  return true
}

/** Chữ ở `lines` dòng cuối của terminal (lấy từ code đang hiện trong ô làm gợi ý giọng nói). */
export function terminalText(agentId: string, lines = 200): string {
  const b = entries.get(agentId)?.term.buffer.active
  if (!b) return ''
  const out: string[] = []
  for (let i = Math.max(0, b.length - lines); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
  return out.join('\n')
}

/** Dòng cuối có chữ của terminal (xem trước ở dải ô nhỏ của chế độ tập trung). */
export function terminalLastLine(agentId: string): string {
  const b = entries.get(agentId)?.term.buffer.active
  if (!b) return ''
  for (let i = b.length - 1; i >= Math.max(0, b.length - 40); i--) {
    const t = b.getLine(i)?.translateToString(true).trim()
    if (t) return t
  }
  return ''
}

export function focusTerminal(agentId: string): void {
  entries.get(agentId)?.term.focus()
}

export function disposeTerminal(agentId: string): void {
  const e = entries.get(agentId)
  if (!e) return
  if (e.resizeTimer) clearTimeout(e.resizeTimer)
  e.input?.dispose()
  if (e.ptyId) agentByPty.delete(e.ptyId)
  e.term.dispose()
  e.el.remove()
  entries.delete(agentId)
}
