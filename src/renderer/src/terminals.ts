import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * Terminal của từng agent sống ngoài React: khi lưới chia lại ô, phần tử DOM của terminal
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

/** Chờ người dùng ngừng kéo (pane browser, thanh chia ô) rồi mới báo kích thước cho tiến trình. */
const RESIZE_DEBOUNCE_MS = 80

const entries = new Map<string, Entry>()
const agentByPty = new Map<string, string>()
/** Dữ liệu tới trước khi terminal kịp gắn với agent. */
const pending = new Map<string, string[]>()
const exitListeners = new Set<(agentId: string, ptyId: string) => void>()
let busStarted = false

const theme = {
  background: '#0f1115',
  foreground: '#e6e8ee',
  cursor: '#6ea8fe',
  selectionBackground: '#2f3b52',
  scrollbarSliderBackground: 'rgba(139, 147, 167, 0.2)',
  scrollbarSliderHoverBackground: 'rgba(139, 147, 167, 0.35)',
  scrollbarSliderActiveBackground: 'rgba(139, 147, 167, 0.5)',
  overviewRulerBorder: '#0f1115'
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

function entry(agentId: string): Entry {
  let e = entries.get(agentId)
  if (!e) {
    const el = document.createElement('div')
    el.style.width = '100%'
    el.style.height = '100%'
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono') || 'Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    e = { term, fit, el, opened: false, ptyId: null, input: null, sent: null, resizeTimer: null }
    entries.set(agentId, e)
  }
  return e
}

/** Gắn terminal của agent vào một ô; trả về hàm gỡ ra. */
export function attachTerminal(agentId: string, host: HTMLElement): () => void {
  const e = entry(agentId)
  host.appendChild(e.el)
  if (!e.opened) {
    e.term.open(e.el)
    e.opened = true
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
  if (!e || !e.opened || !e.el.isConnected || e.el.clientWidth === 0 || e.el.clientHeight === 0) return
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
