/**
 * Viền màu quanh mọi màn hình + thanh nhỏ "Agent X đang điều khiển máy · Tạm dừng · Dừng" khi một agent cầm máy.
 * Cửa sổ đặt setContentProtection (WDA_EXCLUDEFROMCAPTURE: không lọt vào ảnh agent chụp — đã thử ở CU0) và mức
 * 'screen-saver' (nằm trên cả lớp phủ của app khác). Viền không nhận chuột; thanh nhận chuột nhưng không lấy focus.
 * Nút trên thanh đổi trang sang `stag-cu://<lệnh>`, main chặn lại (không cần preload).
 */
import { BrowserWindow, screen } from 'electron'

export interface PillState {
  agentName: string
  action: string
  paused: boolean
  pausedText: string
  labels: { driving: string; pause: string; resume: string; stop: string }
  hotkey: string
}

const PILL_W = 560
const PILL_H = 44

function html(body: string, css: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent;font:13px/1.2 "Segoe UI",system-ui,sans-serif;user-select:none}${css}</style></head><body>${body}</body></html>`)}`
}

const BORDER = html(
  '<div class="b"></div>',
  '.b{position:fixed;inset:0;border:3px solid #2de2c0;box-shadow:inset 0 0 18px rgba(45,226,192,.55);border-radius:2px}body.p .b{border-color:#f5a524;box-shadow:inset 0 0 18px rgba(245,165,36,.55)}'
)

const PILL = html(
  '<div class="p" id="p"><span class="dot"></span><span class="t" id="t"></span><button id="pause"></button><button id="stop" class="stop"></button></div>' +
    `<script>
      const $ = (id) => document.getElementById(id)
      $('pause').onclick = () => { location.href = 'stag-cu://' + ($('pause').dataset.cmd || 'pause') }
      $('stop').onclick = () => { location.href = 'stag-cu://stop' }
      window.update = (s) => {
        document.body.classList.toggle('paused', s.paused)
        $('t').textContent = s.paused ? s.pausedText : s.agentName + ' · ' + s.labels.driving + (s.action ? ' · ' + s.action : '')
        $('pause').textContent = s.paused ? s.labels.resume : s.labels.pause
        $('pause').dataset.cmd = s.paused ? 'resume' : 'pause'
        $('stop').textContent = s.labels.stop + ' (' + s.hotkey + ')'
      }
    </script>`,
  '.p{box-sizing:border-box;margin:4px auto 0;height:36px;width:calc(100% - 8px);display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;border-radius:18px;background:rgba(17,19,22,.94);color:#e8eaed;border:1px solid #2de2c0;box-shadow:0 6px 20px rgba(0,0,0,.45)}' +
    '.paused .p{border-color:#f5a524}.dot{width:8px;height:8px;border-radius:50%;background:#2de2c0;flex:none;animation:b 1.2s infinite}.paused .dot{background:#f5a524;animation:none}' +
    '@keyframes b{50%{opacity:.35}}.t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    'button{flex:none;height:26px;border:1px solid #3a3f46;border-radius:13px;background:#24282e;color:#e8eaed;font:inherit;font-size:12px;padding:0 10px;cursor:pointer}button:hover{background:#2f343b}' +
    '.stop{border-color:#7a2a2a;background:#4a1c1c}.stop:hover{background:#5e2323}'
)

export class ComputerOverlay {
  private borders: BrowserWindow[] = []
  private pill: BrowserWindow | null = null
  private last: PillState | null = null

  constructor(private onCommand: (cmd: 'pause' | 'resume' | 'stop') => void) {}

  shown(): boolean {
    return !!this.pill && !this.pill.isDestroyed()
  }

  show(state: PillState): void {
    if (!this.shown()) this.create()
    this.update(state)
  }

  update(state: PillState): void {
    this.last = state
    const p = this.pill
    if (!p || p.isDestroyed()) return
    const js = `window.update && window.update(${JSON.stringify(state)})`
    if (p.webContents.isLoading()) p.webContents.once('did-finish-load', () => void p.webContents.executeJavaScript(js).catch(() => {}))
    else void p.webContents.executeJavaScript(js).catch(() => {})
    for (const b of this.borders)
      if (!b.isDestroyed()) void b.webContents.executeJavaScript(`document.body.classList.toggle('p', ${state.paused})`).catch(() => {})
  }

  hide(): void {
    for (const w of [...this.borders, this.pill]) if (w && !w.isDestroyed()) w.destroy()
    this.borders = []
    this.pill = null
  }

  private create(): void {
    this.hide()
    const common = {
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false }
    } as const
    for (const d of screen.getAllDisplays()) {
      const w = new BrowserWindow({ ...common, ...d.bounds })
      w.setIgnoreMouseEvents(true)
      this.prepare(w)
      void w.loadURL(BORDER)
      w.showInactive()
      this.borders.push(w)
    }
    const prim = screen.getPrimaryDisplay().workArea
    const pill = new BrowserWindow({ ...common, x: Math.round(prim.x + (prim.width - PILL_W) / 2), y: prim.y + 6, width: PILL_W, height: PILL_H })
    this.prepare(pill)
    pill.webContents.on('will-navigate', (e, url) => {
      e.preventDefault()
      const cmd = /^stag-cu:\/\/(pause|resume|stop)/.exec(url)?.[1] as 'pause' | 'resume' | 'stop' | undefined
      if (cmd) this.onCommand(cmd)
    })
    void pill.loadURL(PILL).then(() => {
      if (this.last) this.update(this.last)
    })
    pill.showInactive()
    this.pill = pill
  }

  private prepare(w: BrowserWindow): void {
    w.setContentProtection(true)
    w.setAlwaysOnTop(true, 'screen-saver')
    w.setVisibleOnAllWorkspaces(true)
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  }
}
