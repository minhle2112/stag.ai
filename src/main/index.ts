import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeImage, protocol, safeStorage, shell, Tray } from 'electron'
import { IPC } from '@shared/ipc'
import { AdapterService } from './adapters'
import { AgentService } from './agents'
import { ExternalAdapterStore } from './externalAdapters'
import { ArtifactLog, serveArtifact } from './artifacts'
import { Board } from './board'
import { BrowserService } from './browser'
import { StatusHub } from './hub'
import { registerIpc } from './ipc'
import { Notifier } from './notifier'
import { PtyManager } from './pty'
import { SecretStore } from './secrets'
import { OAuthService } from './oauth'
import { ApprovalQueue } from './approvals'
import { SettingsStore } from './settings'
import { VaultActivityLog } from './vaultActivity'
import { WorkspaceStore } from './workspace'
import type { GeneralSettings } from '@shared/types'

// Chạy bản thử với dữ liệu riêng (không đụng workspace/agent của bản người dùng đang mở).
// Phải đặt trước khi tạo các service vì chúng đọc đường dẫn userData lúc khởi tạo.
if (process.env.STAG_USER_DATA) app.setPath('userData', process.env.STAG_USER_DATA)

// Một bản chạy cho mỗi thư mục dữ liệu (khoá theo userData nên phải sau setPath): mở stag.ai lần nữa (vd. lúc
// đang nằm dưới khay) thì hiện cửa sổ đang có, không chạy bản thứ hai ghi chồng lên workspaces.json / agents.json.
const primary = app.requestSingleInstanceLock()

// Ảnh / video agent tạo ra (tab Artifacts): `stag-file://<workspaceId>/<đường dẫn trong dự án>`. Phải đăng ký trước khi app sẵn sàng.
protocol.registerSchemesAsPrivileged([{ scheme: 'stag-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const ptys = new PtyManager()
const workspaces = new WorkspaceStore()
const board = new Board(
  (workspaceId) => send(IPC.boardChanged, workspaceId),
  (e) => notifier.onBoardEvent(e)
)
const send = (channel: string, ...args: unknown[]): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
}
const browser = new BrowserService({
  changed: (workspaceId, state) => send(IPC.browserChanged, workspaceId, state),
  reveal: (workspaceId, tabId) => send(IPC.browserReveal, workspaceId, tabId),
  ask: (ask) => send(IPC.browserAsk, ask)
})
const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), (s) => {
  send(IPC.settingsChanged, s)
  applyGeneral(s.app.general)
})
const notifier = new Notifier(
  () => settings.general(),
  (id) => workspaces.get(id)?.name,
  (workspaceId, agentId) => {
    showWindow()
    send(IPC.revealAgent, workspaceId, agentId)
  }
)
const activity = new VaultActivityLog((workspaceId) => send(IPC.vaultActivityChanged, workspaceId))
const artifacts = new ArtifactLog((workspaceId) => send(IPC.artifactsChanged, workspaceId))
const adapters = new AdapterService(settings)
const external = new ExternalAdapterStore(join(app.getPath('userData'), 'adapters'), (list) => send(IPC.adapterExtChanged, list))
const secrets = new SecretStore(
  join(app.getPath('userData'), 'secrets.json'),
  {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b)
  },
  (list) => send(IPC.secretsChanged, list)
)
const oauth = new OAuthService(secrets, (url) => shell.openExternal(url))
const approvals = new ApprovalQueue((list) => send(IPC.approvalsChanged, list))
const agents = new AgentService(ptys, workspaces, board, browser, settings, activity, artifacts, adapters, external, secrets, oauth, approvals)
const hub = new StatusHub({
  hook: (agentId, payload) => agents.onHook(agentId, payload),
  mcp: (agentId) => agents.mcpFor(agentId),
  status: (agentId, body) => agents.onStatusLine(agentId, body)
})

/** Đang thoát thật (không chỉ ẩn cửa sổ xuống khay). */
let quitting = false
let tray: Tray | null = null
/** Đã báo "app vẫn chạy dưới khay" một lần trong lần chạy này. */
let toldTray = false

function trayIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons', 'tray.png') : join(app.getAppPath(), 'resources', 'icons', 'tray.png')
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function showWindow(): void {
  const win = mainWindow()
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Áp các cài đặt "Chung" cần main làm: thu phóng, chạy cùng Windows, icon khay. */
function applyGeneral(g: GeneralSettings): void {
  const factor = g.zoom / 100
  for (const win of BrowserWindow.getAllWindows()) win.webContents.setZoomFactor(factor)
  browser.setZoom(factor)
  // Bản dev là electron.exe trần: đăng ký chạy cùng Windows sẽ mở Electron trống, nên chỉ làm ở bản cài.
  if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== g.openAtLogin) app.setLoginItemSettings({ openAtLogin: g.openAtLogin })
  if (g.closeAction === 'tray' && !tray) {
    tray = new Tray(nativeImage.createFromPath(trayIconPath()))
    tray.setToolTip('stag.ai')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Mở stag.ai', click: showWindow },
        { type: 'separator' },
        { label: 'Thoát', click: () => void requestQuit() }
      ])
    )
    tray.on('click', showWindow)
  } else if (g.closeAction === 'quit' && tray) {
    tray.destroy()
    tray = null
    // Cửa sổ đang ẩn dưới khay mà bỏ khay thì phải hiện lại, không thì không còn đường mở.
    const win = mainWindow()
    if (win && !win.isVisible()) showWindow()
  }
}

/** Thoát hẳn; còn agent / terminal đang chạy thì hỏi lại trước (nếu bật trong Settings). */
async function requestQuit(): Promise<void> {
  const n = agents.runningCount()
  if (n > 0 && settings.general().confirmQuitRunning) {
    const win = mainWindow()
    if (win && !win.isVisible()) showWindow()
    const opts = {
      type: 'question' as const,
      buttons: ['Thoát', 'Huỷ'],
      defaultId: 1,
      cancelId: 1,
      title: 'stag.ai',
      message: `Còn ${n} agent / terminal đang chạy`,
      detail: 'Thoát app sẽ dừng tất cả các phiên này. Việc trên kanban và bộ nhớ vault vẫn giữ nguyên.',
      checkboxLabel: 'Không hỏi lại'
    }
    const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 0) return
    if (r.checkboxChecked) await settings.setApp({ general: { confirmQuitRunning: false } })
  }
  quitting = true
  app.quit()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    title: 'stag.ai',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  browser.attachWindow(win)
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.general().zoom / 100))

  // Bấm ×: thu xuống khay (agent vẫn chạy) hoặc thoát hẳn (hỏi lại nếu còn phiên chạy).
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    if (settings.general().closeAction === 'tray' && tray) {
      win.hide()
      if (!toldTray) {
        toldTray = true
        notifier.info('stag.ai vẫn đang chạy', 'Agent tiếp tục làm việc. Bấm icon stag.ai ở khay hệ thống để mở lại.')
      }
      return
    }
    void requestQuit()
  })
  // Windows đăng xuất / tắt máy: không chặn đóng cửa sổ.
  win.on('session-end', () => {
    quitting = true
  })

  // Link ngoài mở bằng trình duyệt hệ thống, không mở cửa sổ Electron mới.
  // Chỉ http(s)/mailto: link trong note của vault có thể là `file:` hay giao thức lạ.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  // Không để cửa sổ app tự điều hướng sang trang khác (vd. bấm link trong note mà quên chặn).
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault()
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  if (!primary) return
  await workspaces.load()
  await settings.load()
  await external.load()
  await secrets.load()
  await agents.load()
  await hub.start()
  protocol.handle('stag-file', (req) => {
    const url = new URL(req.url)
    const ws = workspaces.get(url.hostname)
    if (!ws) return new Response('Not found', { status: 404 })
    return serveArtifact(ws, decodeURIComponent(url.pathname.replace(/^\/+/, '')), req.headers.get('range'))
  })
  agents.attachHub(hub)
  registerIpc(ptys, workspaces, agents, board, browser, settings, activity, artifacts, notifier, adapters, external, secrets, oauth, approvals)
  createWindow()
  applyGeneral(settings.general())
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Thông báo Windows cần AppUserModelID; bản dev dùng đường dẫn electron.exe như Electron khuyên.
app.setAppUserModelId(app.isPackaged ? 'ai.stag.app' : process.execPath)

if (primary) app.on('second-instance', showWindow)
else {
  quitting = true
  app.quit()
}

app.on('before-quit', () => {
  quitting = true
  tray?.destroy()
  tray = null
  void artifacts.flush()
  browser.shutdown()
  agents.shutdown()
  hub.stop()
})

app.on('window-all-closed', () => {
  agents.shutdown()
  hub.stop()
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
