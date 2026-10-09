import type { InstalledPlugin, PluginCatalogEntry, PluginInstallRequest, PluginJobRun, PluginScaffoldRequest } from '@shared/plugins'
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AppInfo, type PtyExit, type PtySpawnOptions } from '@shared/ipc'
import type {
  Agent,
  AgentRun,
  AgentsSnapshot,
  AdapterInstallRequest,
  AdapterStatus,
  ExternalAdapterStatus,
  InstalledAdapter,
  InstalledAdapterPatch,
  AppMeta,
  AppSettingsPatch,
  CliAdapterId,
  ApprovalDecision,
  ConnectRequest,
  ConnectResult,
  ToolApproval,
  Connector,
  ConnectorImport,
  ConnectorTestResult,
  SkillDoc,
  SkillImportResult,
  SkillScan,
  SkillsList,
  InheritedScan,
  SecretsList,
  ArtifactEvent,
  ArtifactStat,
  ArtifactText,
  BoardSnapshot,
  BrowserPermissionAsk,
  NoteWriteResult,
  OverrideLevel,
  Settings,
  SettingsOverridesPatch,
  ShellInfo,
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
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    /** Sửa cấp app (chỉ các trường có mặt). */
    set: (patch: AppSettingsPatch): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
    /** Sửa ghi đè của một workspace / agent theo mục; mục = null → theo cấp trên. */
    setOverrides: (level: OverrideLevel, id: string, patch: SettingsOverridesPatch): Promise<Settings> =>
      ipcRenderer.invoke(IPC.settingsOverride, level, id, patch),
    checkAdapter: (id: CliAdapterId): Promise<AdapterStatus> => ipcRenderer.invoke(IPC.adapterCheck, id),
    shells: (): Promise<ShellInfo[]> => ipcRenderer.invoke(IPC.shellsList),
    meta: (): Promise<AppMeta> => ipcRenderer.invoke(IPC.appMeta),
    notifyTest: (): Promise<void> => ipcRenderer.invoke(IPC.notifyTest),
    onChanged(cb: (s: Settings) => void): () => void {
      const fn = (_e: IpcRendererEvent, s: Settings): void => cb(s)
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
  /** Chọn một thư mục; null = huỷ. */
  pickFolder: (title: string, defaultPath?: string): Promise<string | null> => ipcRenderer.invoke(IPC.pickFolder, title, defaultPath),
  /** Adapter ngoài (alpha). */
  externalAdapters: {
    list: (): Promise<InstalledAdapter[]> => ipcRenderer.invoke(IPC.adapterExtList),
    install: (req: AdapterInstallRequest): Promise<InstalledAdapter> => ipcRenderer.invoke(IPC.adapterExtInstall, req),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC.adapterExtRemove, id),
    update: (id: string, patch: InstalledAdapterPatch): Promise<InstalledAdapter> => ipcRenderer.invoke(IPC.adapterExtUpdate, id, patch),
    check: (id: string): Promise<ExternalAdapterStatus> => ipcRenderer.invoke(IPC.adapterExtCheck, id),
    onChanged(cb: (list: InstalledAdapter[]) => void): () => void {
      const fn = (_e: IpcRendererEvent, list: InstalledAdapter[]): void => cb(list)
      ipcRenderer.on(IPC.adapterExtChanged, fn)
      return () => ipcRenderer.removeListener(IPC.adapterExtChanged, fn)
    }
  },
  /** Connector (máy chủ MCP). `workspaceId` = thư mục chạy thử / quét. */
  connectors: {
    save: (c: Connector, prevId?: string): Promise<Settings> => ipcRenderer.invoke(IPC.connectorSave, c, prevId),
    remove: (id: string): Promise<Settings> => ipcRenderer.invoke(IPC.connectorRemove, id),
    importJson: (text: string): Promise<ConnectorImport> => ipcRenderer.invoke(IPC.connectorImport, text),
    copy: (runtime: CliAdapterId, name: string, workspaceId?: string): Promise<ConnectorImport> => ipcRenderer.invoke(IPC.connectorCopy, runtime, name, workspaceId),
    test: (id: string, workspaceId?: string): Promise<ConnectorTestResult> => ipcRenderer.invoke(IPC.connectorTest, id, workspaceId),
    scan: (runtime: CliAdapterId, workspaceId?: string): Promise<InheritedScan> => ipcRenderer.invoke(IPC.connectorScan, runtime, workspaceId),
    /** Connect từ danh mục: có thể mở trình duyệt đăng nhập; xong thì thử kết nối luôn. */
    connect: (req: ConnectRequest, workspaceId?: string): Promise<ConnectResult> => ipcRenderer.invoke(IPC.connectorConnect, req, workspaceId),
    cancelConnect: (): Promise<void> => ipcRenderer.invoke(IPC.connectorConnectCancel),
    reauth: (id: string, workspaceId?: string): Promise<ConnectorTestResult> => ipcRenderer.invoke(IPC.connectorReauth, id, workspaceId)
  },
  /** Skill: thư viện của stag.ai, danh mục kèm app, skill có sẵn của Claude Code / Codex. */
  skills: {
    list: (): Promise<SkillsList> => ipcRenderer.invoke(IPC.skillsList),
    read: (name: string): Promise<SkillDoc> => ipcRenderer.invoke(IPC.skillsRead, name),
    readPath: (path: string): Promise<SkillDoc> => ipcRenderer.invoke(IPC.skillsReadPath, path),
    catalogDoc: (slug: string): Promise<SkillDoc> => ipcRenderer.invoke(IPC.skillsCatalogDoc, slug),
    create: (name: string, description: string): Promise<SkillsList> => ipcRenderer.invoke(IPC.skillsCreate, name, description),
    save: (name: string, md: string): Promise<{ name: string; problem: string | null; list: SkillsList }> => ipcRenderer.invoke(IPC.skillsSave, name, md),
    remove: (name: string): Promise<SkillsList> => ipcRenderer.invoke(IPC.skillsRemove, name),
    /** Mở hộp chọn thư mục / file zip; null = người dùng huỷ. */
    import: (kind: 'folder' | 'zip'): Promise<SkillImportResult | null> => ipcRenderer.invoke(IPC.skillsImport, kind),
    install: (slug: string): Promise<SkillImportResult> => ipcRenderer.invoke(IPC.skillsInstall, slug),
    copy: (runtime: CliAdapterId, path: string): Promise<SkillImportResult> => ipcRenderer.invoke(IPC.skillsCopy, runtime, path),
    scan: (runtime: CliAdapterId, workspaceId?: string): Promise<SkillScan> => ipcRenderer.invoke(IPC.skillsScan, runtime, workspaceId),
    /** Tên skill trong thư viện, hoặc đường dẫn SKILL.md của skill có sẵn. */
    reveal: (target: string): Promise<void> => ipcRenderer.invoke(IPC.skillsReveal, target)
  },
  /** Plugin của stag.ai (alpha). */
  plugins: {
    list: (): Promise<InstalledPlugin[]> => ipcRenderer.invoke(IPC.pluginsList),
    install: (req: PluginInstallRequest): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsInstall, req),
    approve: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsApprove, id),
    remove: (id: string): Promise<InstalledPlugin[]> => ipcRenderer.invoke(IPC.pluginsRemove, id),
    reload: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsReload, id),
    restart: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsRestart, id),
    setConfig: (id: string, config: Record<string, unknown>): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsConfig, id, config),
    health: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsHealth, id),
    /** Bấm một slot: trả URL để mở hoặc lời nhắn để hiện. */
    runSlot: (id: string, slotId: string, workspaceId?: string, agentId?: string): Promise<{ openUrl?: string; target?: 'browser' | 'external'; message?: string }> =>
      ipcRenderer.invoke(IPC.pluginsSlot, id, slotId, workspaceId, agentId),
    onChanged(cb: (list: InstalledPlugin[]) => void): () => void {
      const fn = (_e: IpcRendererEvent, list: InstalledPlugin[]): void => cb(list)
      ipcRenderer.on(IPC.pluginsChanged, fn)
      return () => ipcRenderer.removeListener(IPC.pluginsChanged, fn)
    },
    /** Lời gọi từ trang của plugin (iframe); ngữ cảnh workspace / agent do app điền. */
    bridge: (id: string, method: string, params: Record<string, unknown>, workspaceId?: string, agentId?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.pluginsBridge, id, method, params, workspaceId, agentId),
    /** Plugin kèm app (mục "Có sẵn"). */
    catalog: (): Promise<PluginCatalogEntry[]> => ipcRenderer.invoke(IPC.pluginsCatalog),
    /** Tạo plugin mới từ mẫu rồi cài tại chỗ. */
    scaffold: (req: PluginScaffoldRequest): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsScaffold, req),
    runJob: (id: string, key: string): Promise<PluginJobRun> => ipcRenderer.invoke(IPC.pluginsRunJob, id, key),
    rotateWebhook: (id: string): Promise<InstalledPlugin> => ipcRenderer.invoke(IPC.pluginsRotateWebhook, id),
    /** Worker đẩy dữ liệu cho trang của nó (ctx.streams.emit). */
    onStream(cb: (id: string, channel: string, data: unknown) => void): () => void {
      const fn = (_e: IpcRendererEvent, id: string, channel: string, data: unknown): void => cb(id, channel, data)
      ipcRenderer.on(IPC.pluginsStream, fn)
      return () => ipcRenderer.removeListener(IPC.pluginsStream, fn)
    }
  },
  /** Lần gọi tool connector đang chờ duyệt. */
  approvals: {
    list: (): Promise<ToolApproval[]> => ipcRenderer.invoke(IPC.approvalsList),
    answer: (id: string, decision: ApprovalDecision): Promise<void> => ipcRenderer.invoke(IPC.approvalsAnswer, id, decision),
    onChanged(cb: (list: ToolApproval[]) => void): () => void {
      const fn = (_e: IpcRendererEvent, list: ToolApproval[]): void => cb(list)
      ipcRenderer.on(IPC.approvalsChanged, fn)
      return () => ipcRenderer.removeListener(IPC.approvalsChanged, fn)
    }
  },
  /** Bí mật: giao diện chỉ thấy tên, chỉ gửi giá trị đi (không đọc lại được). */
  secrets: {
    list: (): Promise<SecretsList> => ipcRenderer.invoke(IPC.secretsList),
    set: (name: string, value: string): Promise<SecretsList> => ipcRenderer.invoke(IPC.secretsSet, name, value),
    remove: (name: string): Promise<SecretsList> => ipcRenderer.invoke(IPC.secretsRemove, name),
    onChanged(cb: (list: SecretsList) => void): () => void {
      const fn = (_e: IpcRendererEvent, list: SecretsList): void => cb(list)
      ipcRenderer.on(IPC.secretsChanged, fn)
      return () => ipcRenderer.removeListener(IPC.secretsChanged, fn)
    }
  },
  /** Chọn một file .exe; null = huỷ. */
  pickFile: (title: string, defaultPath?: string): Promise<string | null> => ipcRenderer.invoke(IPC.pickFile, title, defaultPath),
  /** Người dùng bấm thông báo của một agent. */
  onRevealAgent(cb: (workspaceId: string, agentId: string) => void): () => void {
    const fn = (_e: IpcRendererEvent, workspaceId: string, agentId: string): void => cb(workspaceId, agentId)
    ipcRenderer.on(IPC.revealAgent, fn)
    return () => ipcRenderer.removeListener(IPC.revealAgent, fn)
  },
  openTemplates: (): Promise<string> => ipcRenderer.invoke(IPC.templatesOpen)
}

export type StagApi = typeof api

contextBridge.exposeInMainWorld('stag', api)
