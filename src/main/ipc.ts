import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC, type AppInfo, type PtySpawnOptions } from '@shared/ipc'
import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import { connectorSecrets, OAUTH_SECRET_PREFIX, parseMcpJson } from '@shared/connectors'
import type { ApprovalDecision, CliAdapterId, ConnectRequest, ConnectResult, Connector, ConnectorImport, ConnectorTestResult, SkillImportResult, SkillsList } from '@shared/types'
import { independentSessionEnv } from './adapters'
import { importInherited, inheritedConfig, scanInherited, testConnector } from './connectors'
import type { SecretStore } from './secrets'
import type { OAuthService } from './oauth'
import type { ApprovalQueue } from './approvals'
import { connectFromCatalog } from './connect'
import { readSkillDir, scanSkills, type SkillLibrary } from './skills'
import type { PluginCallContext, PluginHost } from './plugins'
import type { PluginInstallRequest, PluginScaffoldRequest } from '@shared/plugins'
import type { AdapterInstallRequest, AppMeta, InstalledAdapterPatch, AppSettingsPatch, CreateAgentRequest, CreateWorkspaceRequest, LayoutNode, OverrideLevel, SettingsOverridesPatch, StartAgentRequest, ViewRect, Workspace } from '@shared/types'
import type { AdapterService } from './adapters'
import type { AgentService } from './agents'
import type { ExternalAdapterStore } from './externalAdapters'
import { artifactPath, type ArtifactLog } from './artifacts'
import { artifactThumb } from './artifactThumb'
import type { Board } from './board'
import type { BrowserService } from './browser'
import { openInObsidian } from './obsidian'
import type { Notifier } from './notifier'
import type { PtyManager } from './pty'
import type { SettingsStore } from './settings'
import { detectShells } from './shells'
import { prepareUserTemplates } from './templates'
import { createNote, findRegisteredId, readNote, vaultTree, writeNote } from './vault'
import type { VaultActivityLog } from './vaultActivity'
import { VaultIndexer, VaultWatchers } from './vaultIndex'
import type { WorkspaceStore } from './workspace'
import type { VoiceService } from './voice'
import type { VocabCache } from './voiceVocab'
import type { CloudUsage, VoiceCloud } from './voiceCloud'
import type { VoiceCloudInfo } from '@shared/voice'

const vaultIndexer = new VaultIndexer()
const vaultWatchers = new VaultWatchers()

export function registerIpc(ptys: PtyManager, workspaces: WorkspaceStore, agents: AgentService, board: Board, browser: BrowserService, settings: SettingsStore, activity: VaultActivityLog, artifacts: ArtifactLog, notifier: Notifier, adapters: AdapterService, external: ExternalAdapterStore, secrets: SecretStore, oauth: OAuthService, approvals: ApprovalQueue, skills: SkillLibrary, plugins: PluginHost): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({ cwd: process.cwd(), platform: process.platform }))

  ipcMain.handle(IPC.ptySpawn, (e, opts: PtySpawnOptions) => ptys.spawn(e.sender, opts))
  ipcMain.on(IPC.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on(IPC.ptyResize, (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on(IPC.ptyKill, (_e, id: string) => ptys.kill(id))

  ipcMain.handle(IPC.wsList, () => workspaces.list())
  ipcMain.handle(IPC.wsPick, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: 'Chọn thư mục dự án',
      defaultPath: settings.general().projectsDir || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.wsInspect, (_e, path: string) => workspaces.inspect(path))
  ipcMain.handle(IPC.wsCreate, (_e, req: CreateWorkspaceRequest) => workspaces.create(req))
  ipcMain.handle(IPC.wsRemove, async (_e, id: string) => {
    const agentIds = (await agents.snapshot(id)).agents.map((a) => a.id)
    await agents.removeWorkspace(id)
    await workspaces.remove(id)
    await settings.forget('agent', agentIds)
    await settings.forget('workspace', [id])
  })

  ipcMain.handle(IPC.vaultTree, (_e, vaultPath: string) => vaultTree(vaultPath))
  ipcMain.handle(IPC.vaultRead, (_e, vaultPath: string, rel: string) => readNote(vaultPath, rel))
  ipcMain.handle(IPC.vaultWrite, (_e, vaultPath: string, rel: string, text: string, base: string | null) => writeNote(vaultPath, rel, text, base))
  ipcMain.handle(IPC.vaultCreate, (_e, vaultPath: string, folder: string, name: string) => createNote(vaultPath, folder, name))
  ipcMain.handle(IPC.vaultActivity, (_e, workspaceId: string) => activity.list(workspaceId))
  ipcMain.handle(IPC.vaultOpenObsidian, (_e, vaultPath: string) => openInObsidian(vaultPath))
  ipcMain.handle(IPC.vaultIsRegistered, async (_e, vaultPath: string) => !!(await findRegisteredId(vaultPath)))
  ipcMain.handle(IPC.openFolder, (_e, path: string) => shell.openPath(path))
  ipcMain.handle(IPC.templatesOpen, async () => shell.openPath(await prepareUserTemplates()))

  ipcMain.handle(IPC.agentSnapshot, (_e, workspaceId: string) => agents.snapshot(workspaceId))
  ipcMain.handle(IPC.agentCreate, (_e, req: CreateAgentRequest) => agents.create(req))
  ipcMain.handle(IPC.agentStart, (e, req: StartAgentRequest) => agents.start(e.sender, req))
  ipcMain.handle(IPC.agentStop, (_e, agentId: string) => agents.stop(agentId))
  ipcMain.handle(IPC.agentRemove, async (_e, agentId: string) => {
    await agents.remove(agentId)
    await settings.forget('agent', [agentId])
  })
  ipcMain.handle(IPC.agentLayout, (_e, workspaceId: string, layout: LayoutNode | null) => agents.saveLayout(workspaceId, layout))
  ipcMain.handle(IPC.agentRequestList, () => agents.requests.list())
  ipcMain.handle(IPC.agentRequestAnswer, (_e, id: string, allow: boolean) => agents.requests.answer(id, allow))

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
    browser.openUserTab(workspaceId, url)
  })
  ipcMain.handle(IPC.browserCloseTab, (_e, workspaceId: string, tabId: string) => browser.closeTab(workspaceId, tabId))
  ipcMain.handle(IPC.browserActivate, (_e, workspaceId: string, tabId: string) => browser.activate(workspaceId, tabId))
  ipcMain.handle(IPC.browserNavigate, (_e, workspaceId: string, tabId: string, input: string) => browser.navigate(workspaceId, tabId, input))
  ipcMain.handle(IPC.browserBack, (_e, workspaceId: string, tabId: string) => browser.back(workspaceId, tabId))
  ipcMain.handle(IPC.browserForward, (_e, workspaceId: string, tabId: string) => browser.forward(workspaceId, tabId))
  ipcMain.handle(IPC.browserReload, (_e, workspaceId: string, tabId: string) => browser.reload(workspaceId, tabId))
  ipcMain.on(IPC.browserBounds, (_e, workspaceId: string | null, rect: ViewRect | null) => browser.setBounds(workspaceId, rect))
  ipcMain.handle(IPC.browserAnswer, (_e, askId: string, allow: boolean) => browser.answer(askId, allow))
  ipcMain.handle(IPC.scopeAnswer, (_e, askId: string, allow: boolean) => board.answerScope(askId, allow))
  ipcMain.handle(IPC.taskDrop, (_e, workspaceId: string, taskId: string) => board.closeTask(ws(workspaceId), taskId, 'dropped'))
  ipcMain.handle(IPC.agentRename, (_e, agentId: string, name: string) => agents.rename(agentId, name))
  ipcMain.handle(IPC.agentReorder, (_e, workspaceId: string, orderedIds: string[]) => agents.reorder(workspaceId, orderedIds))
  ipcMain.handle(IPC.browserDevTools, (_e, workspaceId: string, tabId: string) => browser.toggleDevTools(workspaceId, tabId))
  ipcMain.handle(IPC.vaultIndex, (_e, vaultPath: string) => vaultIndexer.index(vaultPath))
  ipcMain.handle(IPC.vaultSearch, (_e, vaultPath: string, query: string) => vaultIndexer.search(vaultPath, query))
  ipcMain.handle(IPC.vaultWatch, (e, vaultPath: string) => vaultWatchers.watch(vaultPath, e.sender))
  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_e, patch: AppSettingsPatch) => settings.setApp(patch))
  ipcMain.handle(IPC.agentHandoff, (_e, agentId: string) => agents.handoffNow(agentId))
  ipcMain.handle(IPC.artifactList, (_e, workspaceId: string) => artifacts.list(ws(workspaceId)))
  ipcMain.handle(IPC.artifactStat, (_e, workspaceId: string, rels: string[]) => artifacts.stat(ws(workspaceId), rels))
  ipcMain.handle(IPC.artifactText, (_e, workspaceId: string, rel: string, max?: number) => artifacts.text(ws(workspaceId), rel, max))
  ipcMain.handle(IPC.artifactBytes, (_e, workspaceId: string, rel: string) => artifacts.bytes(ws(workspaceId), rel))
  ipcMain.handle(IPC.artifactThumb, (_e, workspaceId: string, rel: string) => artifactThumb(artifactPath(ws(workspaceId), rel)))
  ipcMain.handle(IPC.artifactForget, (_e, workspaceId: string, rel: string) => artifacts.forget(ws(workspaceId), rel))
  ipcMain.handle(IPC.artifactOpen, async (_e, workspaceId: string, rel: string) => {
    const err = await shell.openPath(artifactPath(ws(workspaceId), rel))
    if (err) throw new Error(err)
  })
  ipcMain.handle(IPC.artifactReveal, (_e, workspaceId: string, rel: string) => shell.showItemInFolder(artifactPath(ws(workspaceId), rel)))
  ipcMain.handle(IPC.vaultUnwatch, (e, vaultPath: string) => vaultWatchers.unwatch(vaultPath, e.sender))
  ipcMain.handle(IPC.settingsOverride, (_e, level: OverrideLevel, id: string, patch: SettingsOverridesPatch) => {
    if (level !== 'workspace' && level !== 'agent') throw new Error('Cấp cài đặt không hợp lệ')
    if (!patch || typeof patch !== 'object') throw new Error('Ghi đè không hợp lệ')
    return settings.setOverrides(level, id, patch)
  })
  ipcMain.handle(IPC.shellsList, () => detectShells())
  ipcMain.handle(
    IPC.appMeta,
    (): AppMeta => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      userData: app.getPath('userData'),
      packaged: app.isPackaged
    })
  )
  ipcMain.handle(IPC.pickFolder, async (e, title: string, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { title, defaultPath: defaultPath || undefined, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.notifyTest, () => notifier.test())
  ipcMain.handle(IPC.adapterCheck, (_e, id: string) => {
    if (id !== 'claude' && id !== 'codex') throw new Error('Adapter không hợp lệ')
    return adapters.check(id)
  })
  ipcMain.handle(IPC.adapterExtList, () => external.list())
  ipcMain.handle(IPC.adapterExtInstall, (_e, req: AdapterInstallRequest) => {
    if (req?.type !== 'npm' && req?.type !== 'local') throw new Error('Cách cài không hợp lệ')
    if (req.type === 'npm' && typeof req.name !== 'string') throw new Error('Thiếu tên gói')
    if (req.type === 'local' && typeof req.path !== 'string') throw new Error('Thiếu đường dẫn')
    return external.install(req)
  })
  ipcMain.handle(IPC.adapterExtRemove, (_e, id: string) => external.remove(String(id)))
  ipcMain.handle(IPC.adapterExtUpdate, (_e, id: string, patch: InstalledAdapterPatch) => external.update(String(id), patch ?? {}))
  ipcMain.handle(IPC.adapterExtCheck, (_e, id: string) => external.check(String(id)))
  // ---- Connector (MCP) + bí mật ----
  /** Thư mục chạy thử / quét: thư mục dự án của workspace (máy chủ phạm vi local / project phụ thuộc nó), không có thì thư mục nhà. */
  const cwdOf = (workspaceId?: string | null): string => (workspaceId && workspaces.get(workspaceId)?.path) || homedir()
  const cliEnv = (id: CliAdapterId): NodeJS.ProcessEnv => ({ ...independentSessionEnv(process.env), ...adapters.env(id) })
  /** Lưu bí mật tách ra khi nhập (tên trùng bí mật đã có → không ghi đè, báo lại) rồi thêm connector. */
  const saveImport = async (parsed: ReturnType<typeof parseMcpJson>): Promise<ConnectorImport> => {
    const fresh = parsed.secrets.filter((x) => !secrets.has(x.name))
    const kept = parsed.secrets.filter((x) => secrets.has(x.name)).map((x) => x.name)
    if (parsed.connectors.length) {
      if (fresh.length) await secrets.setMany(fresh)
      await settings.addConnectors(parsed.connectors)
    }
    const errors = [...parsed.errors, ...kept.map((n) => `Bí mật ${n} đã có: giữ giá trị cũ (đổi ở Secrets nếu cần)`)]
    return { connectors: parsed.connectors, secrets: fresh.map((x) => x.name), errors }
  }
  const takenIds = (): string[] => settings.get().app.connectors.items.map((c) => c.id)
  ipcMain.handle(IPC.connectorSave, (_e, c: Connector, prevId?: string) => {
    if (!c || typeof c !== 'object') throw new Error('Connector không hợp lệ')
    return settings.saveConnector(c, typeof prevId === 'string' ? prevId : undefined)
  })
  ipcMain.handle(IPC.connectorRemove, (_e, id: string) => settings.removeConnector(String(id)))
  ipcMain.handle(IPC.connectorImport, (_e, text: string) => saveImport(parseMcpJson(String(text ?? ''), takenIds())))
  ipcMain.handle(IPC.connectorCopy, async (_e, runtime: CliAdapterId, name: string, workspaceId?: string) => {
    if (runtime !== 'claude' && runtime !== 'codex') throw new Error('CLI không hợp lệ')
    const exe = runtime === 'codex' ? (await adapters.exe('codex')).path : ''
    const config = await inheritedConfig(runtime, String(name), exe, cwdOf(workspaceId), cliEnv(runtime))
    if (!config) throw new Error(`Không đọc được cấu hình của "${name}" (máy chủ claude.ai / plugin không chép được).`)
    return saveImport(importInherited(String(name), config, takenIds()))
  })
  /** Thử kết nối (làm mới token OAuth trước) rồi lưu danh sách tool. */
  const runTest = async (id: string, workspaceId?: string): Promise<ConnectorTestResult> => {
    const c = settings.get().app.connectors.items.find((x) => x.id === id)
    if (!c) throw new Error('Connector không tồn tại')
    let fresh: Map<string, string>
    try {
      fresh = await oauth.fresh(c.oauth ? [{ name: c.bearerSecret, label: c.label || c.id }] : [])
    } catch (e) {
      return { ok: false, server: '', tools: [], error: (e as Error).message, ms: 0 }
    }
    const r = await testConnector(c, (n) => fresh.get(n) ?? secrets.get(n), cwdOf(workspaceId), independentSessionEnv(process.env))
    // Lưu danh sách tool để chọn mức cho từng tool (connector có thể vừa bị sửa / gỡ trong lúc chờ).
    const cur = settings.get().app.connectors.items.find((x) => x.id === id)
    if (r.ok && cur) await settings.saveConnector({ ...cur, tools: r.tools, testedAt: new Date().toISOString() })
    return r
  }
  ipcMain.handle(IPC.connectorTest, (_e, id: string, workspaceId?: string) => runTest(String(id), workspaceId))
  ipcMain.handle(IPC.connectorConnect, async (_e, req: ConnectRequest, workspaceId?: string): Promise<ConnectResult> => {
    if (!req || typeof req.slug !== 'string' || typeof req.method !== 'string' || !req.access) throw new Error('Yêu cầu kết nối không hợp lệ')
    const id = await connectFromCatalog(req, { settings, secrets, oauth })
    return { id, test: await runTest(id, workspaceId) }
  })
  ipcMain.handle(IPC.connectorConnectCancel, () => oauth.cancel())
  ipcMain.handle(IPC.connectorReauth, async (_e, id: string, workspaceId?: string) => {
    const c = settings.get().app.connectors.items.find((x) => x.id === id)
    if (!c?.oauth) throw new Error('Connector này không đăng nhập bằng OAuth')
    await oauth.relogin(c.bearerSecret)
    return runTest(c.id, workspaceId)
  })
  ipcMain.handle(IPC.approvalsList, () => approvals.list())
  ipcMain.handle(IPC.approvalsAnswer, (_e, id: string, decision: ApprovalDecision) => {
    if (decision !== 'allow' && decision !== 'always' && decision !== 'deny') throw new Error('Quyết định không hợp lệ')
    approvals.answer(String(id), decision)
  })
  ipcMain.handle(IPC.connectorScan, async (_e, runtime: CliAdapterId, workspaceId?: string) => {
    if (runtime !== 'claude' && runtime !== 'codex') throw new Error('CLI không hợp lệ')
    const cwd = cwdOf(workspaceId)
    let exe: string
    try {
      exe = (await adapters.exe(runtime)).path
    } catch (e) {
      return { runtime, cwd, servers: [], error: (e as Error).message, scannedAt: new Date().toISOString() }
    }
    return scanInherited(runtime, exe, cwd, cliEnv(runtime))
  })
  ipcMain.handle(IPC.secretsList, () => secrets.list())
  ipcMain.handle(IPC.secretsSet, (_e, name: string, value: string) => {
    if (typeof name !== 'string' || typeof value !== 'string') throw new Error('Bí mật không hợp lệ')
    if (name.trim().toUpperCase().startsWith(OAUTH_SECRET_PREFIX)) throw new Error(`Tên bắt đầu bằng ${OAUTH_SECRET_PREFIX} dành cho đăng nhập OAuth của app, chọn tên khác.`)
    return secrets.set(name.trim(), value)
  })
  ipcMain.handle(IPC.secretsRemove, (_e, name: string) => {
    const users = settings.get().app.connectors.items.filter((c) => connectorSecrets(c).includes(name)).map((c) => c.id)
    if (users.length) throw new Error(`Bí mật ${name} đang được dùng bởi: ${users.join(', ')}. Bỏ khỏi connector đó trước.`)
    return secrets.remove(String(name))
  })
  // ---- Skill ----
  const skillsList = async (): Promise<SkillsList> => ({ library: await skills.list(), catalog: await skills.catalog() })
  const imported = async (r: { added: string[]; skipped: Array<{ name: string; reason: string }> }): Promise<SkillImportResult> => ({ ...r, list: await skillsList() })
  /** Chỉ đọc file tên SKILL.md (skill có sẵn của CLI, đường dẫn lấy từ lần quét). */
  const skillMdPath = (p: unknown): string => {
    if (typeof p !== 'string' || !/^skill\.md$/i.test(basename(p))) throw new Error('Đường dẫn skill không hợp lệ')
    return p
  }
  ipcMain.handle(IPC.skillsList, () => skillsList())
  ipcMain.handle(IPC.skillsRead, (_e, name: string) => skills.read(String(name)))
  ipcMain.handle(IPC.skillsReadPath, (_e, path: string) => readSkillDir(dirname(skillMdPath(path)), false))
  ipcMain.handle(IPC.skillsCatalogDoc, (_e, slug: string) => skills.catalogDoc(String(slug)))
  ipcMain.handle(IPC.skillsCreate, async (_e, name: string, description: string) => {
    await skills.create(String(name ?? '').trim(), String(description ?? ''))
    return skillsList()
  })
  ipcMain.handle(IPC.skillsSave, async (_e, name: string, md: string) => {
    const r = await skills.save(String(name), String(md ?? ''))
    if (r.name !== name) await settings.renameSkill(name, r.name)
    return { ...r, list: await skillsList() }
  })
  ipcMain.handle(IPC.skillsRemove, async (_e, name: string) => {
    await skills.remove(String(name))
    await settings.renameSkill(name, null)
    return skillsList()
  })
  ipcMain.handle(IPC.skillsImport, async (e, kind: 'folder' | 'zip') => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: kind === 'zip' ? 'Chọn file .zip chứa skill' : 'Chọn thư mục skill (có SKILL.md) hoặc thư mục chứa nhiều skill',
      properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
      filters: kind === 'zip' ? [{ name: 'Zip', extensions: ['zip', 'skill'] }] : undefined
    })
    if (r.canceled || !r.filePaths[0]) return null
    return imported(kind === 'zip' ? await skills.importZip(r.filePaths[0]) : await skills.importDir(r.filePaths[0], { kind: 'folder', from: r.filePaths[0] }))
  })
  ipcMain.handle(IPC.skillsInstall, async (_e, slug: string) => imported(await skills.installCatalog(String(slug))))
  ipcMain.handle(IPC.skillsCopy, async (_e, runtime: CliAdapterId, path: string) => {
    if (runtime !== 'claude' && runtime !== 'codex') throw new Error('CLI không hợp lệ')
    return imported(await skills.importDir(dirname(skillMdPath(path)), { kind: runtime, from: path }))
  })
  ipcMain.handle(IPC.skillsScan, (_e, runtime: CliAdapterId, workspaceId?: string) => {
    if (runtime !== 'claude' && runtime !== 'codex') throw new Error('CLI không hợp lệ')
    return scanSkills(runtime, cwdOf(workspaceId), async () => (await adapters.exe('codex')).path, cliEnv('codex'))
  })
  ipcMain.handle(IPC.skillsReveal, async (_e, target: string) => {
    const dir = typeof target === 'string' && /^skill\.md$/i.test(basename(target)) ? dirname(target) : (await skills.read(String(target))).dir
    const err = await shell.openPath(dir)
    if (err) throw new Error(err)
  })
  // ---- Plugin ----
  const pluginId = (id: unknown): string => {
    if (typeof id !== 'string' || !id) throw new Error('id plugin không hợp lệ')
    return id
  }
  ipcMain.handle(IPC.pluginsList, () => plugins.list())
  ipcMain.handle(IPC.pluginsInstall, (_e, req: PluginInstallRequest) => {
    if (req?.type === 'npm' && typeof req.name === 'string') return plugins.install({ type: 'npm', name: req.name, version: typeof req.version === 'string' ? req.version : undefined })
    if (req?.type === 'local' && typeof req.path === 'string') return plugins.install({ type: 'local', path: req.path })
    if (req?.type === 'catalog' && typeof req.slug === 'string') return plugins.install({ type: 'catalog', slug: req.slug })
    throw new Error('Yêu cầu cài không hợp lệ')
  })
  ipcMain.handle(IPC.pluginsApprove, (_e, id: string) => plugins.approve(pluginId(id)))
  ipcMain.handle(IPC.pluginsRemove, async (_e, id: string) => {
    await plugins.remove(pluginId(id))
    return plugins.list()
  })
  ipcMain.handle(IPC.pluginsReload, (_e, id: string) => plugins.reload(pluginId(id)))
  ipcMain.handle(IPC.pluginsRestart, (_e, id: string) => plugins.restart(pluginId(id)))
  ipcMain.handle(IPC.pluginsConfig, (_e, id: string, config: Record<string, unknown>) => plugins.setConfig(pluginId(id), config && typeof config === 'object' ? config : {}))
  ipcMain.handle(IPC.pluginsHealth, (_e, id: string) => plugins.health(pluginId(id)))
  const callContext = (workspaceId?: string, agentId?: string): PluginCallContext => {
    const ws = typeof workspaceId === 'string' ? workspaces.get(workspaceId) : undefined
    const agent = typeof agentId === 'string' ? agents.pluginView().find((x) => x.agent.id === agentId)?.agent : undefined
    return { workspaceId: ws?.id, workspaceName: ws?.name, workspacePath: ws?.path, agentId: agent?.id, agentName: agent?.name }
  }
  ipcMain.handle(IPC.pluginsSlot, (_e, id: string, slotId: string, workspaceId?: string, agentId?: string) =>
    plugins.runSlot(pluginId(id), String(slotId), callContext(workspaceId, agentId))
  )
  ipcMain.handle(IPC.pluginsBridge, (_e, id: string, method: string, params: Record<string, unknown>, workspaceId?: string, agentId?: string) =>
    plugins.bridge(pluginId(id), String(method), params && typeof params === 'object' ? params : {}, callContext(workspaceId, agentId))
  )
  ipcMain.handle(IPC.pluginsCatalog, () => plugins.catalog())
  ipcMain.handle(IPC.pluginsScaffold, (_e, req: PluginScaffoldRequest) => {
    if (!req || typeof req.parentDir !== 'string' || typeof req.name !== 'string' || typeof req.id !== 'string') throw new Error('Yêu cầu tạo plugin không hợp lệ')
    return plugins.scaffold({ parentDir: req.parentDir, name: req.name, id: req.id, template: req.template === 'page' ? 'page' : 'basic' })
  })
  ipcMain.handle(IPC.pluginsRunJob, (_e, id: string, key: string) => plugins.runJob(pluginId(id), String(key), 'manual'))
  ipcMain.handle(IPC.pluginsRotateWebhook, (_e, id: string) => plugins.rotateWebhookToken(pluginId(id)))
  ipcMain.handle(IPC.pickFile, async (e, title: string, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title,
      defaultPath: defaultPath || undefined,
      properties: ['openFile'],
      filters: [{ name: 'Chương trình', extensions: ['exe'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.browserClearData, (_e, workspaceId?: string) => browser.clearData(typeof workspaceId === 'string' && workspaceId ? ws(workspaceId).id : undefined))
}

/** Gõ bằng giọng nói (V1): model + nhận dạng. Âm thanh chỉ đi renderer → main → tiến trình nhận dạng, không ghi ra đĩa. */
export function registerVoiceIpc(voice: VoiceService, vocab: VocabCache, workspaces: WorkspaceStore, cloud: VoiceCloud, usage: CloudUsage): void {
  const sessionId = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[\w-]{1,64}$/.test(v)) throw new Error('Mã lượt nói không hợp lệ.')
    return v
  }
  ipcMain.handle(IPC.voiceCloudInfo, (): VoiceCloudInfo => ({ hasKey: cloud.hasKey(), monthSeconds: Math.round(usage.month()) }))
  ipcMain.handle(IPC.voiceCloudStart, (e, id: unknown, terms: unknown) => {
    const words = Array.isArray(terms) ? terms.filter((x): x is string => typeof x === 'string' && x.length <= 80).slice(0, 300) : []
    const sid = sessionId(id)
    const sender = e.sender
    cloud.start(
      sid,
      words,
      (final, partial) => {
        if (!sender.isDestroyed()) sender.send(IPC.voiceCloudText, sid, final, partial)
      },
      (error) => {
        if (!sender.isDestroyed()) sender.send(IPC.voiceCloudText, sid, '', '', error)
      }
    )
  })
  ipcMain.on(IPC.voiceCloudAudio, (_e, id: unknown, samples: unknown) => {
    // Renderer gửi từng khúc ~0,1–0,5 s; chặn khúc lớn bất thường.
    if (typeof id === 'string' && samples instanceof Float32Array && samples.length <= 30 * 16000) cloud.audio(id, samples)
  })
  ipcMain.handle(IPC.voiceCloudEnd, (_e, id: unknown) => cloud.end(sessionId(id)))
  ipcMain.on(IPC.voiceCloudCancel, (_e, id: unknown) => {
    if (typeof id === 'string') cloud.cancel(id)
  })
  ipcMain.handle(IPC.voiceCloudTest, () => cloud.test())

  ipcMain.handle(IPC.voiceStatus, () => voice.get())
  ipcMain.handle(IPC.voiceDownload, () => {
    void voice.download()
  })
  ipcMain.handle(IPC.voiceCancel, () => voice.cancelDownload())
  ipcMain.handle(IPC.voiceRemove, () => voice.removeModel())
  ipcMain.handle(IPC.voicePrewarm, () => voice.prewarm())
  ipcMain.handle(IPC.voiceUnload, () => voice.unload())
  ipcMain.handle(IPC.voiceTranscribe, (_e, samples: unknown, hotwords: unknown) => {
    if (!(samples instanceof Float32Array) || samples.length === 0) throw new Error('Không có âm thanh.')
    // Renderer đã cắt đoạn ≤ 12 s; chặn đoạn quá dài (model chỉ chứa ~20 s).
    if (samples.length > 30 * 16000) throw new Error('Đoạn âm thanh quá dài.')
    const words = Array.isArray(hotwords) ? hotwords.filter((x): x is string => typeof x === 'string') : []
    return voice.transcribe(samples, words)
  })
  ipcMain.handle(IPC.voiceVocab, (_e, workspaceId: unknown) => {
    const ws = typeof workspaceId === 'string' ? workspaces.get(workspaceId) : undefined
    return ws?.path ? vocab.get(ws.path) : []
  })
}
