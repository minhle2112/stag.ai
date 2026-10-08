import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppInfo, type PtyExit, type PtySpawnOptions } from '@shared/ipc'
import type {
  Agent,
  AgentRun,
  AgentsSnapshot,
  BoardSnapshot,
  BrowserPermissionAsk,
  BrowserState,
  CreateAgentRequest,
  CreateWorkspaceRequest,
  LayoutNode,
  StartAgentRequest,
  Task,
  ViewRect,
  CreateWorkspaceResult,
  ObsidianOpenResult,
  VaultNode,
  Workspace,
  WorkspaceInspection
} from '@shared/types'

const api = {
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  pty: {
    spawn: (opts: PtySpawnOptions): Promise<string> => ipcRenderer.invoke(IPC.ptySpawn, opts),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): void => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id: string): void => ipcRenderer.send(IPC.ptyKill, id),
    onData(id: string, cb: (data: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, pid: string, data: string): void => {
        if (pid === id) cb(data)
      }
      ipcRenderer.on(IPC.ptyData, fn)
      return () => ipcRenderer.removeListener(IPC.ptyData, fn)
    },
    onExit(id: string, cb: (exit: PtyExit) => void): () => void {
      const fn = (_e: IpcRendererEvent, pid: string, exit: PtyExit): void => {
        if (pid === id) cb(exit)
      }
      ipcRenderer.on(IPC.ptyExit, fn)
      return () => ipcRenderer.removeListener(IPC.ptyExit, fn)
    },
    /** Nhận dữ liệu của mọi terminal (để không mất phần in ra trước khi ô kịp gắn vào). */
    onAnyData(cb: (id: string, data: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, id: string, data: string): void => cb(id, data)
      ipcRenderer.on(IPC.ptyData, fn)
      return () => ipcRenderer.removeListener(IPC.ptyData, fn)
    },
    onAnyExit(cb: (id: string, exit: PtyExit) => void): () => void {
      const fn = (_e: IpcRendererEvent, id: string, exit: PtyExit): void => cb(id, exit)
      ipcRenderer.on(IPC.ptyExit, fn)
      return () => ipcRenderer.removeListener(IPC.ptyExit, fn)
    }
  },
  agent: {
    snapshot: (workspaceId: string): Promise<AgentsSnapshot> => ipcRenderer.invoke(IPC.agentSnapshot, workspaceId),
    create: (req: CreateAgentRequest): Promise<Agent> => ipcRenderer.invoke(IPC.agentCreate, req),
    start: (req: StartAgentRequest): Promise<AgentRun> => ipcRenderer.invoke(IPC.agentStart, req),
    stop: (agentId: string): Promise<void> => ipcRenderer.invoke(IPC.agentStop, agentId),
    remove: (agentId: string): Promise<void> => ipcRenderer.invoke(IPC.agentRemove, agentId),
    saveLayout: (workspaceId: string, layout: LayoutNode | null): Promise<void> =>
      ipcRenderer.invoke(IPC.agentLayout, workspaceId, layout)
  },
  board: {
    snapshot: (workspaceId: string): Promise<BoardSnapshot> => ipcRenderer.invoke(IPC.boardSnapshot, workspaceId),
    completeTask: (workspaceId: string, taskId: string): Promise<Task | undefined> =>
      ipcRenderer.invoke(IPC.taskComplete, workspaceId, taskId),
    dropTask: (workspaceId: string, taskId: string): Promise<Task | undefined> => ipcRenderer.invoke(IPC.taskDrop, workspaceId, taskId),
    /** Bảng của một workspace vừa đổi (việc hoặc trạng thái agent). */
    onChanged(cb: (workspaceId: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, workspaceId: string): void => cb(workspaceId)
      ipcRenderer.on(IPC.boardChanged, fn)
      return () => ipcRenderer.removeListener(IPC.boardChanged, fn)
    }
  },
  browser: {
    state: (workspaceId: string): Promise<BrowserState> => ipcRenderer.invoke(IPC.browserState, workspaceId),
    newTab: (workspaceId: string, url?: string): Promise<void> => ipcRenderer.invoke(IPC.browserNewTab, workspaceId, url),
    closeTab: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserCloseTab, workspaceId, tabId),
    activate: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserActivate, workspaceId, tabId),
    navigate: (workspaceId: string, tabId: string, input: string): Promise<void> =>
      ipcRenderer.invoke(IPC.browserNavigate, workspaceId, tabId, input),
    back: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserBack, workspaceId, tabId),
    forward: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserForward, workspaceId, tabId),
    reload: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserReload, workspaceId, tabId),
    /** Vị trí vùng hiển thị trang (null = ẩn). */
    setBounds: (workspaceId: string | null, rect: ViewRect | null): void => ipcRenderer.send(IPC.browserBounds, workspaceId, rect),
    answer: (askId: string, allow: boolean): Promise<void> => ipcRenderer.invoke(IPC.browserAnswer, askId, allow),
    onChanged(cb: (workspaceId: string, state: BrowserState) => void): () => void {
      const fn = (_e: IpcRendererEvent, workspaceId: string, state: BrowserState): void => cb(workspaceId, state)
      ipcRenderer.on(IPC.browserChanged, fn)
      return () => ipcRenderer.removeListener(IPC.browserChanged, fn)
    },
    onReveal(cb: (workspaceId: string, tabId: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, workspaceId: string, tabId: string): void => cb(workspaceId, tabId)
      ipcRenderer.on(IPC.browserReveal, fn)
      return () => ipcRenderer.removeListener(IPC.browserReveal, fn)
    },
    onAsk(cb: (ask: BrowserPermissionAsk) => void): () => void {
      const fn = (_e: IpcRendererEvent, ask: BrowserPermissionAsk): void => cb(ask)
      ipcRenderer.on(IPC.browserAsk, fn)
      return () => ipcRenderer.removeListener(IPC.browserAsk, fn)
    }
  },
  workspace: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke(IPC.wsList),
    pick: (): Promise<string | null> => ipcRenderer.invoke(IPC.wsPick),
    inspect: (path: string): Promise<WorkspaceInspection> => ipcRenderer.invoke(IPC.wsInspect, path),
    create: (req: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> => ipcRenderer.invoke(IPC.wsCreate, req),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.wsRemove, id)
  },
  vault: {
    tree: (vaultPath: string): Promise<VaultNode[]> => ipcRenderer.invoke(IPC.vaultTree, vaultPath),
    read: (vaultPath: string, rel: string): Promise<string> => ipcRenderer.invoke(IPC.vaultRead, vaultPath, rel),
    openInObsidian: (vaultPath: string): Promise<ObsidianOpenResult> => ipcRenderer.invoke(IPC.vaultOpenObsidian, vaultPath),
    isRegistered: (vaultPath: string): Promise<boolean> => ipcRenderer.invoke(IPC.vaultIsRegistered, vaultPath)
  },
  openFolder: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openFolder, path),
  openTemplates: (): Promise<string> => ipcRenderer.invoke(IPC.templatesOpen)
}

export type StagApi = typeof api

contextBridge.exposeInMainWorld('stag', api)
