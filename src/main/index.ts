import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { AgentService } from './agents'
import { Board } from './board'
import { BrowserService } from './browser'
import { StatusHub } from './hub'
import { registerIpc } from './ipc'
import { PtyManager } from './pty'
import { WorkspaceStore } from './workspace'

// Chạy bản thử với dữ liệu riêng (không đụng workspace/agent của bản người dùng đang mở).
// Phải đặt trước khi tạo các service vì chúng đọc đường dẫn userData lúc khởi tạo.
if (process.env.STAG_USER_DATA) app.setPath('userData', process.env.STAG_USER_DATA)

const ptys = new PtyManager()
const workspaces = new WorkspaceStore()
const board = new Board((workspaceId) => send(IPC.boardChanged, workspaceId))
const send = (channel: string, ...args: unknown[]): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
}
const browser = new BrowserService({
  changed: (workspaceId, state) => send(IPC.browserChanged, workspaceId, state),
  reveal: (workspaceId, tabId) => send(IPC.browserReveal, workspaceId, tabId),
  ask: (ask) => send(IPC.browserAsk, ask)
})
const agents = new AgentService(ptys, workspaces, board, browser)
const hub = new StatusHub({
  hook: (agentId, payload) => agents.onHook(agentId, payload),
  mcp: (agentId) => agents.mcpFor(agentId)
})

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

  // Link ngoài mở bằng trình duyệt hệ thống, không mở cửa sổ Electron mới.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await workspaces.load()
  await agents.load()
  await hub.start()
  agents.attachHub(hub)
  registerIpc(ptys, workspaces, agents, board, browser)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
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
