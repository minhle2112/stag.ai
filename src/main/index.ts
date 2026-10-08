import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpc } from './ipc'
import { PtyManager } from './pty'
import { ensureUserTemplates } from './templates'
import { WorkspaceStore } from './workspace'

const ptys = new PtyManager()
const workspaces = new WorkspaceStore()

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
  await ensureUserTemplates()
  await workspaces.load()
  registerIpc(ptys, workspaces)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
