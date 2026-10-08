import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { AgentService } from './agents'
import { Board } from './board'
import { StatusHub } from './hub'
import { registerIpc } from './ipc'
import { PtyManager } from './pty'
import { WorkspaceStore } from './workspace'

const ptys = new PtyManager()
const workspaces = new WorkspaceStore()
const board = new Board((workspaceId) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.boardChanged, workspaceId)
})
const agents = new AgentService(ptys, workspaces, board)
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
  registerIpc(ptys, workspaces, agents, board)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  agents.shutdown()
  hub.stop()
})

app.on('window-all-closed', () => {
  agents.shutdown()
  hub.stop()
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
