import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type AppInfo, type PtySpawnOptions } from '@shared/ipc'
import type { CreateAgentRequest, CreateWorkspaceRequest, LayoutNode, StartAgentRequest, ViewRect, Workspace } from '@shared/types'
import type { AgentService } from './agents'
import type { Board } from './board'
import { toUrl, type BrowserService } from './browser'
import { openInObsidian } from './obsidian'
import type { PtyManager } from './pty'
import { prepareUserTemplates } from './templates'
import { findRegisteredId, readNote, vaultTree } from './vault'
import type { WorkspaceStore } from './workspace'

export function registerIpc(ptys: PtyManager, workspaces: WorkspaceStore, agents: AgentService, board: Board, browser: BrowserService): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ cwd: process.cwd(), platform: process.platform }))

  ipcMain.handle(IPC.ptySpawn, (e, opts: PtySpawnOptions) => ptys.spawn(e.sender, opts))
  ipcMain.on(IPC.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, id: string) => ptys.kill(id))

  ipcMain.handle(IPC.wsList, () => workspaces.list())
  ipcMain.handle(IPC.wsPick, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục dự án', properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.wsInspect, (_e, path: string) => workspaces.inspect(path))
  ipcMain.handle(IPC.wsCreate, (_e, req: CreateWorkspaceRequest) => workspaces.create(req))
  ipcMain.handle(IPC.wsRemove, async (_e, id: string) => {
    await agents.removeWorkspace(id)
    await workspaces.remove(id)
  })

  ipcMain.handle(IPC.vaultTree, (_e, vaultPath: string) => vaultTree(vaultPath))
  ipcMain.handle(IPC.vaultRead, (_e, vaultPath: string, rel: string) => readNote(vaultPath, rel))
  ipcMain.handle(IPC.vaultOpenObsidian, (_e, vaultPath: string) => openInObsidian(vaultPath))
  ipcMain.handle(IPC.vaultIsRegistered, async (_e, vaultPath: string) => !!(await findRegisteredId(vaultPath)))
  ipcMain.handle(IPC.openFolder, (_e, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.templatesOpen, async () => shell.openPath(await prepareUserTemplates()))

  ipcMain.handle(IPC.agentSnapshot, (_e, workspaceId: string) => agents.snapshot(workspaceId))
  ipcMain.handle(IPC.agentCreate, (_e, req: CreateAgentRequest) => agents.create(req))
  ipcMain.handle(IPC.agentStart, (e, req: StartAgentRequest) => agents.start(e.sender, req))
  ipcMain.handle(IPC.agentStop, (_e, agentId: string) => agents.stop(agentId))
  ipcMain.handle(IPC.agentRemove, (_e, agentId: string) => agents.remove(agentId))
  ipcMain.handle(IPC.agentLayout, (_e, workspaceId: string, layout: LayoutNode | null) => agents.saveLayout(workspaceId, layout))

  const ws = (id: string): Workspace => {
    const w = workspaces.get(id)
    if (!w) throw new Error('Workspace không tồn tại')
    return w
  }
  ipcMain.handle(IPC.boardSnapshot, (_e, workspaceId: string) => board.snapshot(ws(workspaceId)))
  ipcMain.handle(IPC.taskComplete, (_e, workspaceId: string, taskId: string) => board.closeTask(ws(workspaceId), taskId, 'done'))
  ipcMain.handle(IPC.browserState, (_e, workspaceId: string) => browser.state(workspaceId))
  ipcMain.handle(IPC.browserNewTab, (_e, workspaceId: string, url?: string) => {
    ws(workspaceId)
    browser.newTab(workspaceId, { kind: 'user' }, url ? toUrl(url) : undefined)
  })
  ipcMain.handle(IPC.browserCloseTab, (_e, workspaceId: string, tabId: string) => browser.closeTab(workspaceId, tabId))
  ipcMain.handle(IPC.browserActivate, (_e, workspaceId: string, tabId: string) => browser.activate(workspaceId, tabId))
  ipcMain.handle(IPC.browserNavigate, (_e, workspaceId: string, tabId: string, input: string) => browser.navigate(workspaceId, tabId, input))
  ipcMain.handle(IPC.browserBack, (_e, workspaceId: string, tabId: string) => browser.back(workspaceId, tabId))
  ipcMain.handle(IPC.browserForward, (_e, workspaceId: string, tabId: string) => browser.forward(workspaceId, tabId))
  ipcMain.handle(IPC.browserReload, (_e, workspaceId: string, tabId: string) => browser.reload(workspaceId, tabId))
  ipcMain.on(IPC.browserBounds, (_e, workspaceId: string | null, rect: ViewRect | null) => browser.setBounds(workspaceId, rect))
  ipcMain.handle(IPC.browserAnswer, (_e, askId: string, allow: boolean) => browser.answer(askId, allow))
  ipcMain.handle(IPC.taskDrop, (_e, workspaceId: string, taskId: string) => board.closeTask(ws(workspaceId), taskId, 'dropped'))
  ipcMain.handle(IPC.browserDevTools, (_e, workspaceId: string, tabId: string) => browser.toggleDevTools(workspaceId, tabId))
}
