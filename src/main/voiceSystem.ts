import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { BrowserWindow, clipboard, ClipboardItem, globalShortcut, screen } from 'electron'
import { t as tr } from '@shared/i18n'
import { VOICE_GLOBAL_HOTKEYS } from '@shared/voice'
import type { VoiceSettings } from '@shared/types'

/**
 * Gõ bằng giọng nói toàn hệ thống (V4, tuỳ chọn): phím tắt dùng được khi stag.ai không ở trên cùng, chữ dán vào ứng dụng
 * đang mở. Windows chỉ báo nhấn (không báo nhả) cho phím tắt toàn hệ thống → bấm để bắt đầu, bấm lần nữa để dừng.
 * Không bao giờ tự nhấn Enter trừ khi người dùng bật lệnh "gửi" và nói "gửi".
 */

/**
 * Nhấn phím giả bằng user32 `keybd_event` qua một tiến trình PowerShell chạy sẵn (khởi động ~1 s một lần, sau đó mỗi lệnh
 * vài ms). Trước mỗi lệnh chờ người dùng nhả Ctrl / Alt / Shift / Win (vừa bấm phím tắt xong) để Ctrl+V không thành Ctrl+Alt+V.
 * Không gõ được vào cửa sổ chạy quyền quản trị (Windows chặn).
 */
const KEY_SCRIPT = [
  "Add-Type -Namespace W -Name K -MemberDefinition @'",
  '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
  '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);',
  "'@",
  'function Held { foreach ($k in 0x10, 0x11, 0x12, 0x5B, 0x5C) { if (([W.K]::GetAsyncKeyState($k) -band 0x8000) -ne 0) { return $true } }; return $false }',
  'function Tap($mods, $key) {',
  '  foreach ($m in $mods) { [W.K]::keybd_event($m, 0, 0, [UIntPtr]::Zero) }',
  '  [W.K]::keybd_event($key, 0, 0, [UIntPtr]::Zero); [W.K]::keybd_event($key, 0, 2, [UIntPtr]::Zero)',
  '  foreach ($m in $mods) { [W.K]::keybd_event($m, 0, 2, [UIntPtr]::Zero) }',
  '}',
  "[Console]::Out.WriteLine('ready')",
  'while ($null -ne ($line = [Console]::In.ReadLine())) {',
  '  $n = 0; while ((Held) -and $n -lt 150) { Start-Sleep -Milliseconds 20; $n++ }',
  "  if ($line -eq 'paste') { Tap @(0x11) 0x56 } elseif ($line -eq 'enter') { Tap @() 0x0D }",
  "  [Console]::Out.WriteLine('done')",
  '}'
].join('\n')

export type SpawnKeys = () => ChildProcessWithoutNullStreams

const spawnPowerShell: SpawnKeys = () =>
  spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(KEY_SCRIPT, 'utf16le').toString('base64')], {
    windowsHide: true
  })

export class KeySender {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private waiters: Array<() => void> = []
  private chain: Promise<void> = Promise.resolve()

  constructor(private spawnKeys: SpawnKeys = spawnPowerShell) {}

  /** Bật trước (lúc bắt đầu nói) để lúc dán không phải chờ PowerShell khởi động. */
  warm(): Promise<void> {
    if (this.ready) return this.ready
    const p = this.spawnKeys()
    this.proc = p
    let buf = ''
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(tr('voice.keys.startFailed'))), 15_000)
      p.stdout.on('data', (d: Buffer) => {
        buf += d.toString()
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (line === 'ready') {
            clearTimeout(t)
            resolve()
          } else if (line === 'done') this.waiters.shift()?.()
        }
      })
      p.on('exit', () => {
        clearTimeout(t)
        if (this.proc === p) {
          this.proc = null
          this.ready = null
        }
        reject(new Error(tr('voice.keys.exited')))
        for (const w of this.waiters.splice(0)) w()
      })
      p.on('error', (e) => reject(e))
    })
    this.ready.catch(() => {})
    return this.ready
  }

  /** Gửi một lệnh, lần lượt từng lệnh, chờ xong. */
  press(cmd: 'paste' | 'enter'): Promise<void> {
    const run = async (): Promise<void> => {
      await this.warm()
      const p = this.proc
      if (!p) throw new Error(tr('voice.keys.notRunning'))
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(tr('voice.keys.noReply'))), 5000)
        this.waiters.push(() => {
          clearTimeout(t)
          resolve()
        })
        p.stdin.write(`${cmd}\n`)
      })
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => {})
    return next
  }

  dispose(): void {
    this.proc?.kill()
    this.proc = null
    this.ready = null
  }
}

/** Phần clipboard dùng để dán (thay được trong test). */
export type ClipboardLike = Pick<Electron.Clipboard, 'read' | 'write' | 'readText' | 'writeText' | 'clear'>

/**
 * Chép hẳn nội dung clipboard ra bộ nhớ. Mục `clipboard.read()` trả về chỉ đọc dữ liệu khi gọi `getType()` — đọc sau khi đã
 * ghi chữ của mình vào thì nhận lại chính chữ đó, clipboard cũ mất (gặp khi thử 2026-10-09). Phải đọc hết từng kiểu trước.
 */
export async function snapshotClipboard(clip: ClipboardLike): Promise<Electron.ClipboardItem[]> {
  const out: Electron.ClipboardItem[] = []
  for (const item of await clip.read().catch(() => [] as Electron.ClipboardItem[])) {
    const data: Record<string, Blob | string | Electron.ClipboardBookmark> = {}
    for (const type of item.types) {
      try {
        data[type] = await item.getType(type)
      } catch {
        /* kiểu không đọc được: bỏ */
      }
    }
    if (Object.keys(data).length) out.push(new ClipboardItem(data))
  }
  return out
}

/** Dán chữ vào ứng dụng đang mở (qua clipboard + Ctrl+V), trả lại nguyên clipboard cũ; `send` = nhấn Enter sau đó. */
export async function typeText(
  keys: Pick<KeySender, 'press'>,
  text: string,
  send: boolean,
  clip: ClipboardLike = clipboard,
  sleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms))
): Promise<void> {
  if (text) {
    const old = await snapshotClipboard(clip)
    await clip.writeText(text)
    try {
      await keys.press('paste')
      // Ứng dụng đọc clipboard bất đồng bộ sau Ctrl+V: chờ một chút rồi mới trả clipboard cũ.
      await sleep(400)
    } finally {
      // Người dùng (hoặc ứng dụng khác) đã chép thứ khác trong lúc đó thì không đè lên.
      if ((await clip.readText().catch(() => '')) === text) {
        if (old.length) await clip.write(old).catch(() => {})
        else clip.clear()
      }
    }
  }
  if (send) {
    if (text) await sleep(60)
    await keys.press('enter')
  }
}

/** Trạng thái hiện trên ô nổi. */
export interface OverlayState {
  phase: 'idle' | 'opening' | 'listening' | 'processing' | 'fixing' | 'error'
  text?: string
  partial?: string
  level?: number
  error?: string
  hotkey?: string
}

const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;font:13px/1.45 "Segoe UI",system-ui,sans-serif;color:#e6e8ee;overflow:hidden}
#b{margin:6px;padding:9px 14px;border-radius:12px;background:rgba(21,24,31,.94);border:1px solid #2a3040;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#top{display:flex;align-items:center;gap:10px}
#dot{width:10px;height:10px;border-radius:50%;background:#ef4444;flex:none}
#dot.busy{background:#6ea8fe;animation:p 1s infinite}#dot.err{background:#f59e0b}
@keyframes p{50%{opacity:.35}}
#msg{flex:none}#hint{color:#8b93a7;font-size:12px;margin-left:auto;white-space:nowrap}
#lv{height:4px;border-radius:2px;background:#2a3040;flex:1;min-width:40px;overflow:hidden}#lv>i{display:block;height:100%;background:#34d399;width:0}
#t{margin-top:4px;max-height:66px;overflow:hidden;display:none}#t span{color:#8b93a7}
</style></head><body><div id="b"><div id="top"><span id="dot"></span><span id="msg"></span><div id="lv"><i></i></div><span id="hint"></span></div><div id="t"></div></div>
<script>
function set(s){
  var dot=document.getElementById('dot'),msg=document.getElementById('msg'),lv=document.getElementById('lv'),t=document.getElementById('t'),hint=document.getElementById('hint');
  var listening=s.phase==='listening'||s.phase==='opening';
  dot.className=s.phase==='error'?'err':listening?'':'busy';
  var l=s.l||{};
  msg.textContent=s.phase==='error'?(s.error||l.error):s.phase==='opening'?l.opening:listening?l.listening:s.phase==='fixing'?l.fixing:l.processing;
  lv.style.display=listening?'block':'none';lv.firstChild.style.width=Math.round((s.level||0)*100)+'%';
  hint.textContent=listening?l.hint:'';
  var has=(s.text||s.partial)&&s.phase!=='error';t.style.display=has?'block':'none';
  t.textContent=s.text||'';if(s.partial){var sp=document.createElement('span');sp.textContent=(s.text?' ':'')+s.partial;t.appendChild(sp)}
}
</script></body></html>`

/** Ô nổi nhỏ ở đáy màn hình (không lấy focus, chuột đi xuyên qua) báo đang nghe / đang nhận dạng / lỗi. */
export class VoiceOverlay {
  private win: BrowserWindow | null = null
  private loaded: Promise<void> | null = null

  private ensure(): Promise<void> {
    if (this.win && !this.win.isDestroyed() && this.loaded) return this.loaded
    const win = new BrowserWindow({
      width: 520,
      height: 120,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    // Không cho ô nổi mở trang nào khác.
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win = win
    this.loaded = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`).then(() => {})
    return this.loaded
  }

  async update(s: OverlayState): Promise<void> {
    if (s.phase === 'idle') {
      if (this.win && !this.win.isDestroyed()) this.win.hide()
      return
    }
    await this.ensure()
    const win = this.win
    if (!win || win.isDestroyed()) return
    // Chữ của ô nổi theo ngôn ngữ giao diện, tính lúc gửi.
    const l = {
      error: tr('common.error'),
      opening: tr('voice.status.opening'),
      listening: tr('voice.status.listening'),
      fixing: tr('voice.status.fixing'),
      processing: tr('voice.status.processing'),
      hint: tr('voice.overlay.hint', { key: s.hotkey || tr('voice.overlay.hotkey') })
    }
    await win.webContents.executeJavaScript(`set(${JSON.stringify({ ...s, l })})`).catch(() => {})
    if (!win.isVisible()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      win.setBounds({ x: Math.round(area.x + (area.width - 520) / 2), y: area.y + area.height - 130, width: 520, height: 120 })
      win.showInactive()
    }
  }

  dispose(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.loaded = null
  }
}

/**
 * Phím tắt toàn hệ thống: chỉ đăng ký khi đã bật và cửa sổ stag.ai không ở trên cùng (trong app thì phím giữ-để-nói
 * thường lo). Esc toàn hệ thống chỉ đăng ký trong lúc đang nói để huỷ.
 */
export class GlobalVoice {
  private registered: string | null = null
  private escape = false
  /** Lỗi đăng ký (phím đã bị ứng dụng khác chiếm) để Cài đặt báo. */
  error = ''

  constructor(
    private d: {
      settings: () => VoiceSettings
      appFocused: () => boolean
      onToggle: () => void
      onCancel: () => void
      shortcuts?: Pick<typeof globalShortcut, 'register' | 'unregister'>
    }
  ) {}

  private get sc(): Pick<typeof globalShortcut, 'register' | 'unregister'> {
    return this.d.shortcuts ?? globalShortcut
  }

  /** Gọi khi đổi Cài đặt, khi cửa sổ được / mất focus. */
  sync(): void {
    const v = this.d.settings()
    const want = v.enabled && v.global && !this.d.appFocused() ? VOICE_GLOBAL_HOTKEYS[v.globalHotkey].accel : null
    if (want === this.registered) return
    if (this.registered) this.sc.unregister(this.registered)
    this.registered = null
    this.error = ''
    if (process.env.STAG_VOICE_DEBUG) console.log('[voice] global hotkey:', want ?? 'not registered')
    if (!want) return
    const ok = this.sc.register(want, () => {
      if (process.env.STAG_VOICE_DEBUG) console.log('[voice] global hotkey pressed')
      this.d.onToggle()
    })
    if (ok) this.registered = want
    else this.error = tr('voice.global.taken', { key: VOICE_GLOBAL_HOTKEYS[v.globalHotkey].label })
  }

  /** Đang nói ngoài app: Esc toàn hệ thống để huỷ. */
  setActive(active: boolean): void {
    if (active === this.escape) return
    this.escape = active
    if (active) {
      if (!this.sc.register('Escape', () => this.d.onCancel())) this.escape = false
    } else this.sc.unregister('Escape')
  }

  dispose(): void {
    if (this.registered) this.sc.unregister(this.registered)
    if (this.escape) this.sc.unregister('Escape')
    this.registered = null
    this.escape = false
  }
}

