import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppInfo, type PtyExit, type PtySpawnOptions } from '@shared/ipc'
import type {
  Agent,
  AgentRun,
  AgentsSnapshot,
  AppSettings,
  ArtifactEvent,
  ArtifactStat,
  ArtifactText,
  BoardSnapshot,
  BrowserPermissionAsk,
  NoteWriteResult,
  VaultActivity,
  BrowserState,
  CreateAgentRequest,
  CreateWorkspaceRequest,
  LayoutNode,
  StartAgentRequest,
  Task,
  ViewRect,
  CreateWorkspaceResult,
  ObsidianOpenResult,
  VaultIndex,
  VaultNode,
  VaultSearchHit,
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
      ipcRenderer.invoke(IPC.agentLayout, workspaceId, layout),
    rename: (agentId: string, name: string): Promise<Agent> => ipcRenderer.invoke(IPC.agentRename, agentId, name),
    /** Thứ tự agent của workspace ở thanh bên. */
    reorder: (workspaceId: string, orderedIds: string[]): Promise<void> => ipcRenderer.invoke(IPC.agentReorder, workspaceId, orderedIds),
    /** Nhờ agent bàn giao rồi chuyển sang phiên mới (agent phải đang chờ bạn). */
    handoff: (agentId: string): Promise<void> => ipcRenderer.invoke(IPC.agentHandoff, agentId),
    /** Phiên cũ đã đóng sau khi bàn giao: mở phiên mới cho agent. */
    onRestart(cb: (agentId: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, agentId: string): void => cb(agentId)
      ipcRenderer.on(IPC.agentRestart, fn)
      return () => ipcRenderer.removeListener(IPC.agentRestart, fn)
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChanged(cb: (s: AppSettings) => void): () => void {
      const fn = (_e: IpcRendererEvent, s: AppSettings): void => cb(s)
      ipcRenderer.on(IPC.settingsChanged, fn)
      return () => ipcRenderer.removeListener(IPC.settingsChanged, fn)
    }
  },
  board: {
    snapshot: (workspaceId: string): Promise<BoardSnapshot> => ipcRenderer.invoke(IPC.boardSnapshot, workspaceId),
    completeTask: (workspaceId: string, taskId: string): Promise<Task | undefined> =>
      ipcRenderer.invoke(IPC.taskComplete, workspaceId, taskId),
    dropTask: (workspaceId: string, taskId: string): Promise<Task | undefined> => ipcRenderer.invoke(IPC.taskDrop, workspaceId, taskId),
    answerScope: (askId: string, allow: boolean): Promise<void> => ipcRenderer.invoke(IPC.scopeAnswer, askId, allow),
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
    },
    /** Mở / đóng DevTools của tab (cửa sổ riêng). */
    toggleDevTools: (workspaceId: string, tabId: string): Promise<void> => ipcRenderer.invoke(IPC.browserDevTools, workspaceId, tabId)
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
    /** Lưu note; `base` = nội dung lúc bắt đầu sửa (file trên đĩa khác `base` → 'conflict', không ghi). */
    write: (vaultPath: string, rel: string, text: string, base: string | null): Promise<NoteWriteResult> =>
      ipcRenderer.invoke(IPC.vaultWrite, vaultPath, rel, text, base),
    /** Tạo note mới trong thư mục `folder` ('' = gốc vault); trả về `rel`. */
    create: (vaultPath: string, folder: string, name: string): Promise<string> => ipcRenderer.invoke(IPC.vaultCreate, vaultPath, folder, name),
    /** Agent đọc / ghi note nào trong workspace (từ lúc mở app). */
    activity: (workspaceId: string): Promise<VaultActivity[]> => ipcRenderer.invoke(IPC.vaultActivity, workspaceId),
    onActivity(cb: (workspaceId: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, workspaceId: string): void => cb(workspaceId)
      ipcRenderer.on(IPC.vaultActivityChanged, fn)
      return () => ipcRenderer.removeListener(IPC.vaultActivityChanged, fn)
    },
    openInObsidian: (vaultPath: string): Promise<ObsidianOpenResult> => ipcRenderer.invoke(IPC.vaultOpenObsidian, vaultPath),
    isRegistered: (vaultPath: string): Promise<boolean> => ipcRenderer.invoke(IPC.vaultIsRegistered, vaultPath),
    /** Chỉ mục toàn vault: note (kèm type/aliases/tags) + link đã phân giải. */
    index: (vaultPath: string): Promise<VaultIndex> => ipcRenderer.invoke(IPC.vaultIndex, vaultPath),
    /** Tìm toàn văn, không phân biệt hoa thường và dấu tiếng Việt. */
    search: (vaultPath: string, query: string): Promise<VaultSearchHit[]> => ipcRenderer.invoke(IPC.vaultSearch, vaultPath, query),
    /** Gọi `cb` khi file trong vault đổi (đã gộp 300ms, bỏ qua `.obsidian/`). Trả về hàm huỷ theo dõi. */
    watch(vaultPath: string, cb: () => void): () => void {
      const fn = (_e: IpcRendererEvent, path: string): void => {
        if (path === vaultPath) cb()
      }
      ipcRenderer.on(IPC.vaultChanged, fn)
      ipcRenderer.invoke(IPC.vaultWatch, vaultPath)
      return () => {
        ipcRenderer.removeListener(IPC.vaultChanged, fn)
        ipcRenderer.invoke(IPC.vaultUnwatch, vaultPath)
      }
    }
  },
  artifacts: {
    /** File agent tạo / sửa / xoá trong dự án (cũ trước, mới sau). */
    list: (workspaceId: string): Promise<ArtifactEvent[]> => ipcRenderer.invoke(IPC.artifactList, workspaceId),
    stat: (workspaceId: string, rels: string[]): Promise<Record<string, ArtifactStat | null>> => ipcRenderer.invoke(IPC.artifactStat, workspaceId, rels),
    /** Nội dung chữ để xem trước; `max` = số byte tối đa (mặc định 512 KB). */
    text: (workspaceId: string, rel: string, max?: number): Promise<ArtifactText> => ipcRenderer.invoke(IPC.artifactText, workspaceId, rel, max),
    /** Cả nội dung file (tối đa 150 MB) để xem trước PDF / Office / zip / font; null = không còn file. */
    bytes: (workspaceId: string, rel: string): Promise<Uint8Array | null> => ipcRenderer.invoke(IPC.artifactBytes, workspaceId, rel),
    /** Ảnh thu nhỏ (data URL) từ file Office hoặc từ Windows; null = không có. */
    thumb: (workspaceId: string, rel: string): Promise<string | null> => ipcRenderer.invoke(IPC.artifactThumb, workspaceId, rel),
    /** Bỏ file khỏi danh sách (không xoá file). */
    forget: (workspaceId: string, rel: string): Promise<void> => ipcRenderer.invoke(IPC.artifactForget, workspaceId, rel),
    /** Mở bằng app mặc định của Windows. */
    open: (workspaceId: string, rel: string): Promise<void> => ipcRenderer.invoke(IPC.artifactOpen, workspaceId, rel),
    reveal: (workspaceId: string, rel: string): Promise<void> => ipcRenderer.invoke(IPC.artifactReveal, workspaceId, rel),
    onChanged(cb: (workspaceId: string) => void): () => void {
      const fn = (_e: IpcRendererEvent, workspaceId: string): void => cb(workspaceId)
      ipcRenderer.on(IPC.artifactsChanged, fn)
      return () => ipcRenderer.removeListener(IPC.artifactsChanged, fn)
    }
  },
  openFolder: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openFolder, path),
  openTemplates: (): Promise<string> => ipcRenderer.invoke(IPC.templatesOpen)
}

export type StagApi = typeof api

contextBridge.exposeInMainWorld('stag', api)
