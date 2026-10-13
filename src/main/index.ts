import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, protocol, safeStorage, session, shell, Tray, utilityProcess } from 'electron'
import { IPC } from '@shared/ipc'
import { AdapterService } from './adapters'
import { AgentService } from './agents'
import { ExternalAdapterStore } from './externalAdapters'
import { ArtifactLog, serveArtifact } from './artifacts'
import { ArtifactStore } from './artifactStore'
import { InspectService } from './inspect'
import { detectSetup, installSetup, removeWordpress, setupMessage } from './inspectSetup'
import { Board } from './board'
import { BrowserService } from './browser'
import { DevServerService } from './devServer'
import { StatusHub } from './hub'
import { registerIpc, registerVoiceIpc, registerVoiceSystemIpc } from './ipc'
import { VoiceService } from './voice'
import { Notifier } from './notifier'
import { PtyManager } from './pty'
import { SecretStore } from './secrets'
import { OAuthService } from './oauth'
import { ApprovalQueue } from './approvals'
import { SkillLibrary } from './skills'
import { KeyedThrottle, PluginHost, PluginWebhookServer, type SpawnWorker } from './plugins'
import pluginUiCss from './inject/pluginUi.css?raw'
import pluginUiJs from './inject/pluginUi.js?raw'
import { independentSessionEnv } from './adapters'
import { onUserNoteWrite, putNote, readNote } from './vault'
import { agentKind } from '@shared/types'
import type { PluginEvent } from '@shared/plugins'
import type { InspectAction, SourceKind } from '@shared/inspect'
import { SettingsStore } from './settings'
import { VaultActivityLog } from './vaultActivity'
import { VaultIndexer } from './vaultIndex'
import { WorkspaceStore } from './workspace'
import { VocabCache } from './voiceVocab'
import { CloudUsage, VoiceCloud } from './voiceCloud'
import { GlobalVoice, KeySender, VoiceOverlay } from './voiceSystem'
import { SONIOX_SECRET } from '@shared/voice'
import { samePath } from './fsutil'
import type { GeneralSettings, Workspace } from '@shared/types'
import { MemoryKeeper } from './workLog'
import { resolveMemory } from '@shared/settings'
import { ClaudeUsageService, registerClaudeUsageIpc } from './claudeUsage'
import { registerThemeIpc, ThemeService } from './theme'
import { WINDOW_BG } from '@shared/theme'
import { homedir } from 'node:os'

// Chạy bản thử với dữ liệu riêng (không đụng workspace/agent của bản người dùng đang mở).
// Phải đặt trước khi tạo các service vì chúng đọc đường dẫn userData lúc khởi tạo.
if (process.env.STAG_USER_DATA) app.setPath('userData', process.env.STAG_USER_DATA)
// Thử gõ bằng giọng nói không cần nói: Chromium lấy âm thanh micro từ file WAV (lặp lại), không hỏi quyền.
if (process.env.STAG_FAKE_MIC) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.STAG_FAKE_MIC)
}

// Một bản chạy cho mỗi thư mục dữ liệu (khoá theo userData nên phải sau setPath): mở stag.ai lần nữa (vd. lúc
// đang nằm dưới khay) thì hiện cửa sổ đang có, không chạy bản thứ hai ghi chồng lên workspaces.json / agents.json.
const primary = app.requestSingleInstanceLock()

// Ảnh / video agent tạo ra (tab Artifacts): `stag-file://<workspaceId>/<đường dẫn trong dự án>`. Phải đăng ký trước khi app sẵn sàng.
// Trang của plugin (iframe cách ly): `stag-plugin://<id plugin>/<file trong entrypoints.ui>`.
protocol.registerSchemesAsPrivileged([
  { scheme: 'stag-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'stag-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

const ptys = new PtyManager()
const workspaces = new WorkspaceStore()
const board = new Board(
  (workspaceId) => send(IPC.boardChanged, workspaceId),
  (e) => {
    notifier.onBoardEvent(e)
    // Agent Claude hết lượt → hỏi lại usage tài khoản (thanh trạng thái).
    if (e.kind === 'waiting' && e.reason === 'turn') {
      const a = agents.pluginView().find((v) => v.agent.id === e.agentId)?.agent
      if (a && agentKind(a) === 'claude') claudeUsage.poke()
    }
    plugins.emit(
      e.kind === 'waiting'
        ? { type: 'agent.waiting', at: new Date().toISOString(), workspaceId: e.workspaceId, agentId: e.agentId, agentName: e.agentName, data: { reason: e.reason } }
        : {
            type: e.kind === 'taskDone' ? 'task.done' : 'task.started',
            at: new Date().toISOString(),
            workspaceId: e.workspaceId,
            agentId: e.agentId,
            agentName: e.agentName,
            data: e.kind === 'taskStarted' ? { title: e.title, scope: e.scope } : { title: e.title }
          }
    )
  },
  // Việc đóng → nhật ký việc trong vault + mục "Work done" của note agent (workLog.ts).
  (ws, c) => void memory.taskClosed(ws, c).catch((e) => console.error('[memory]', e))
)
/** Chỉ mục vault dùng chung: Vault Viewer + tool memory_* của agent. */
const vaultIndexer = new VaultIndexer()
const memory = new MemoryKeeper((ws, agentId) => resolveMemory(settings.get(), ws.id, agentId))
const send = (channel: string, ...args: unknown[]): void => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, ...args)
}
const browser = new BrowserService(
  {
    changed: (workspaceId, state) => send(IPC.browserChanged, workspaceId, state),
    reveal: (workspaceId, tabId) => send(IPC.browserReveal, workspaceId, tabId),
    ask: (ask) => send(IPC.browserAsk, ask),
    askClosed: (askId) => send(IPC.browserAskClosed, askId)
  },
  // Lớp Soi của trang (chế độ Soi): preload riêng, chạy trong thế giới cô lập của mỗi tab.
  join(__dirname, '../preload/inspect.js')
)
const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), (s) => {
  send(IPC.settingsChanged, s)
  applyGeneral(s.app.general)
  theme.apply()
  browser.setSettings(s.app.browser)
  void plugins.applySettings(s)
  // Đổi "giải phóng sau N phút": hẹn lại giờ tắt tiến trình nhận dạng.
  voice.touch()
  globalVoice.sync()
  claudeUsage.sync()
})
/** Màu app (Cài đặt → Giao diện): nativeTheme, nền cửa sổ, ô Trình duyệt, theme của Claude Code. */
const theme = new ThemeService({
  general: () => settings.general(),
  setPref: (pref) => settings.setApp({ general: { theme: pref } }),
  changed: (s) => {
    send(IPC.themeChanged, s)
    for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(WINDOW_BG[s.theme])
    browser.setTheme(s)
  },
  // Như Claude Code: CLAUDE_CONFIG_DIR (nếu đặt) chứa .claude.json thay cho thư mục nhà.
  claudeConfig: join(process.env.CLAUDE_CONFIG_DIR || homedir(), '.claude.json'),
  claudeBackup: join(app.getPath('userData'), 'claude-theme.json')
})
/** Usage tài khoản Claude ở thanh trạng thái (bật / tắt ở Cài đặt → Chung). */
const claudeUsage = new ClaudeUsageService({
  enabled: () => settings.general().claudeUsage,
  changed: (s) => send(IPC.claudeUsageChanged, s),
  version: app.getVersion()
})
const notifier = new Notifier(
  () => settings.general(),
  (id) => workspaces.get(id)?.name,
  (workspaceId, agentId) => {
    showWindow()
    send(IPC.revealAgent, workspaceId, agentId)
  }
)
/** Sự kiện plugin từ nguồn dày (agent ghi một file liên tục): mỗi file / note một sự kiện mỗi 5 giây. */
const eventGate = new KeyedThrottle(5000)
const activity = new VaultActivityLog(
  (workspaceId) => send(IPC.vaultActivityChanged, workspaceId),
  (ws, a, rels) => {
    for (const rel of rels)
      if (eventGate.pass(`vault|${ws.id}|${a.id}|${rel.toLowerCase()}`)) plugins.emit(pluginEvent('vault.note.changed', a, { path: rel, by: 'agent' }))
  }
)
const artifacts = new ArtifactLog(
  (workspaceId) => send(IPC.artifactsChanged, workspaceId),
  (ws, a, files) => {
    // Chỉ tạo / sửa (file bị xoá không phải "written").
    for (const f of files)
      if (f.kind !== 'delete' && eventGate.pass(`artifact|${ws.id}|${a.id}|${f.rel.toLowerCase()}`))
        plugins.emit(pluginEvent('artifact.written', a, { path: f.rel, kind: f.kind }))
  }
)
// Người dùng lưu / tạo note trong app (Vault).
onUserNoteWrite((vaultPath, rel) => {
  const ws = workspaces.list().find((w) => samePath(w.vaultPath, vaultPath))
  if (ws && eventGate.pass(`vault-user|${ws.id}|${rel.toLowerCase()}`))
    plugins.emit({ type: 'vault.note.changed', at: new Date().toISOString(), workspaceId: ws.id, data: { path: rel, by: 'user' } })
})
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
// Danh mục skill kèm app: resources/skill-catalog (đóng gói qua extraResources).
const skills = new SkillLibrary(
  join(app.getPath('userData'), 'skills'),
  app.isPackaged ? join(process.resourcesPath, 'skill-catalog') : join(app.getAppPath(), 'resources', 'skill-catalog'),
  join(app.getPath('userData'), 'skill-sessions')
)
/** Worker plugin chạy trong utilityProcess của Electron (tiến trình Node riêng, không có quyền của tiến trình chính). */
const spawnUtility: SpawnWorker = (script, o) => {
  // Tên hiện trong Task Manager: "stag.ai plugin: <tên>"; tiến trình của chính app đặt tên đầy đủ (vd. "stag.ai giọng nói").
  const serviceName = o.name.startsWith('stag.ai ') ? o.name : `stag.ai plugin: ${o.name}`
  const c = utilityProcess.fork(script, [], { cwd: o.cwd, env: o.env, serviceName, stdio: 'pipe' })
  let alive = true
  c.on('exit', () => (alive = false))
  return {
    get pid() {
      return c.pid
    },
    send: (m) => {
      if (alive) c.postMessage(m)
    },
    onMessage: (fn) => c.on('message', fn),
    onExit: (fn) => c.on('exit', (code) => fn(code)),
    onOutput: (fn) => {
      c.stdout?.on('data', (d) => fn(String(d), false))
      c.stderr?.on('data', (d) => fn(String(d), true))
    },
    kill: () => {
      if (alive) c.kill()
    }
  }
}
const plugins = new PluginHost(join(app.getPath('userData'), 'plugins'), {
  spawn: spawnUtility,
  env: independentSessionEnv(process.env),
  onChange: (list) => send(IPC.pluginsChanged, list),
  onStream: (id, channel, data) => send(IPC.pluginsStream, id, channel, data),
  // Plugin kèm app + SDK chép vào plugin mới (đóng gói qua extraResources).
  catalogDir: app.isPackaged ? join(process.resourcesPath, 'plugin-catalog') : join(app.getAppPath(), 'resources', 'plugin-catalog'),
  sdkFile: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'), 'plugin-sdk', 'stag-plugin-sdk.mjs'),
  api: {
    agents: () => ({
      workspaces: workspaces.list().map((w) => ({ id: w.id, name: w.name, path: w.path })),
      agents: agents.pluginView().map(({ agent: a, running, activity }) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        kind: agentKind(a),
        workspaceId: a.workspaceId,
        running,
        activity
      }))
    }),
    sendToAgent: async (agentId, text) => agents.typeInto(agentId, text),
    board: async (workspaceId) => {
      const ws = workspaces.get(workspaceId)
      if (!ws) throw new Error('Không có workspace này.')
      return (await board.snapshot(ws)).tasks
    },
    vaultRead: async (workspaceId, rel) => {
      const ws = workspaces.get(workspaceId)
      if (!ws) throw new Error('Không có workspace này.')
      return readNote(ws.vaultPath, rel).catch(() => null)
    },
    vaultWrite: async (workspaceId, rel, content) => {
      const ws = workspaces.get(workspaceId)
      if (!ws) throw new Error('Không có workspace này.')
      await putNote(ws.vaultPath, rel, content)
    },
    workspacePaths: (workspaceId) => {
      const ws = workspaces.get(workspaceId)
      return ws ? { path: ws.path, vaultPath: ws.vaultPath } : null
    },
    notify: (title, body) => new Notification({ title, body }).show()
  }
})
const webhooks = new PluginWebhookServer(plugins)
/** Gõ bằng giọng nói: model ở userData/voice, nhận dạng trong utilityProcess riêng (chỉ chạy khi đang dùng). */
const voice = new VoiceService({
  dir: join(app.getPath('userData'), 'voice'),
  spawn: (script, o) => spawnUtility(script, { ...o, name: 'stag.ai giọng nói' }),
  workerScript: join(__dirname, 'voiceWorker.js'),
  env: process.env,
  settings: () => settings.get().app.voice,
  onStatus: (s) => send(IPC.voiceChanged, s)
})
/**
 * Máy đám mây Soniox (V3): key trong kho bí mật. STAG_SONIOX_URL (chỉ địa chỉ máy này) để thử với máy chủ giả,
 * không cho trỏ ra máy khác để key không bị gửi nhầm chỗ.
 */
const cloudUsage = new CloudUsage(join(app.getPath('userData'), 'voice', 'cloud-usage.json'))
const voiceCloud = new VoiceCloud({
  key: () => secrets.get(SONIOX_SECRET),
  url: /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.STAG_SONIOX_URL ?? '') ? process.env.STAG_SONIOX_URL : undefined,
  onUsage: (s) => void cloudUsage.add(s)
})
/** V4 (tuỳ chọn): gõ bằng giọng nói vào ứng dụng khác — phím tắt toàn hệ thống, ô nổi, dán bằng Ctrl+V giả. */
const keySender = new KeySender()
const overlay = new VoiceOverlay()
const globalVoice = new GlobalVoice({
  settings: () => settings.get().app.voice,
  appFocused: () => BrowserWindow.getFocusedWindow() !== null,
  onToggle: () => send(IPC.voiceGlobal, 'toggle'),
  onCancel: () => send(IPC.voiceGlobal, 'cancel')
})
// Focus chuyển giữa các cửa sổ của app thì blur rồi focus: xét sau khi cả hai sự kiện xong.
const syncGlobal = (): void => void setTimeout(() => globalVoice.sync(), 50)
app.on('browser-window-focus', syncGlobal)
app.on('browser-window-blur', syncGlobal)
const pluginEvent = (type: PluginEvent['type'], a: { id: string; name: string; workspaceId: string }, data: Record<string, unknown> = {}): PluginEvent => ({
  type,
  at: new Date().toISOString(),
  workspaceId: a.workspaceId,
  agentId: a.id,
  agentName: a.name,
  data
})
const agents = new AgentService(ptys, workspaces, board, browser, settings, activity, artifacts, adapters, external, secrets, oauth, approvals, skills, memory, vaultIndexer)
/** Dev server của dự án: Tab mới của browser + tool preview_* của agent. */
const devServers = new DevServerService(workspaces, agents, browser)
agents.attachDevServers(devServers)
/** Sản phẩm agent nộp (tab Sản phẩm): artifact_publish / artifact_reply + góp ý gửi vào phiên agent. */
const products = new ArtifactStore(
  (workspaceId) => send(IPC.productsChanged, workspaceId),
  (agentId) => agents.kickComments(agentId)
)
agents.attachProducts(products)
/** Chế độ Soi của ô Browser: bình luận ghim lên phần tử trang → agent sửa (tool inspect_reply). */
const inspect = new InspectService(browser, (id) => workspaces.get(id), {
  changed: (workspaceId) => send(IPC.inspectChanged, workspaceId),
  queued: (agentId) => agents.kickComments(agentId),
  focus: (workspaceId, tabId, id) => send(IPC.inspectFocus, workspaceId, tabId, id)
})
inspect.attachTeam((wsId) => agents.inspectTeam(wsId))
agents.attachInspect(inspect)
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
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.setZoomFactor(factor)
  }
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
    backgroundColor: WINDOW_BG[theme.get().theme],
    title: 'stag.ai',
    autoHideMenuBar: true,
    // Thanh tiêu đề do giao diện tự vẽ, cả ba nút thu nhỏ / phóng to / đóng (lớp phủ gốc của Windows gần như không đổi màu khi rê chuột).
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())
  browser.attachWindow(win)
  // Renderer tải lại / chết giữa lúc đang nói: không còn ai báo "xong" → gỡ Esc toàn hệ thống, ẩn ô nổi, bỏ chạy nền.
  const resetVoice = (): void => {
    globalVoice.setActive(false)
    void overlay.update({ phase: 'idle' })
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(true)
  }
  win.webContents.on('did-start-loading', resetVoice)
  win.webContents.on('render-process-gone', resetVoice)
  win.webContents.on('did-finish-load', () => {
    const factor = settings.general().zoom / 100
    win.webContents.setZoomFactor(factor)
  })
  // Người dùng vừa đổi sáng / tối trong Cài đặt của Windows rồi quay lại app.
  win.on('focus', () => theme.refreshWindows())
  // Nút phóng to / thu về ở thanh tiêu đề đổi biểu tượng theo trạng thái cửa sổ.
  win.on('maximize', () => win.webContents.send(IPC.winMaximized, true))
  win.on('unmaximize', () => win.webContents.send(IPC.winMaximized, false))

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

  // Khung con trong cửa sổ app (trang plugin, xem trước HTML) không được tự điều hướng ra ngoài: chỉ trang của plugin
  // (stag-plugin:) và nội dung nhúng (about:srcdoc / about:blank). CSP frame-src của trang app không chặn việc này.
  win.webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return
    if (!/^(stag-plugin:|about:(srcdoc|blank))/i.test(e.url)) e.preventDefault()
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
  browser.setSettings(settings.get().app.browser)
  // Trước khi tạo cửa sổ: nền cửa sổ và trang đầu tiên lấy đúng màu đã lưu (không chớp sai màu).
  theme.start()
  registerThemeIpc(theme)
  browser.themeToggle = () => void theme.toggle()
  await external.load()
  await secrets.load()
  await skills.cleanAllSessions()
  await voice.load()
  await cloudUsage.load()
  await agents.load()
  await hub.start()
  protocol.handle('stag-file', (req) => {
    const url = new URL(req.url)
    const ws = workspaces.get(url.hostname)
    if (!ws) return new Response('Not found', { status: 404 })
    return serveArtifact(ws, decodeURIComponent(url.pathname.replace(/^\/+/, '')), req.headers.get('range'))
  })
  protocol.handle('stag-plugin', async (req) => {
    const url = new URL(req.url)
    const id = url.hostname
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const headers = plugins.uiHeaders(id)
    if (rel === '__stag/ui.js') return new Response(pluginUiJs, { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } })
    if (rel === '__stag/ui.css') return new Response(pluginUiCss, { headers: { ...headers, 'Content-Type': 'text/css; charset=utf-8' } })
    const file = await plugins.uiFile(id, rel)
    if (!file) return new Response('Not found', { status: 404, headers })
    return new Response(await readFile(file.path), { headers: { ...headers, 'Content-Type': file.type } })
  })
  // Khung con trong cửa sổ app (trang plugin, xem trước HTML) không được tải trang web. Trang plugin tự đặt
  // location.href ra ngoài thì will-frame-navigate không bắn và CSP frame-src cũng không chặn, nên chặn ở phiên mặc định
  // (chỉ cửa sổ app dùng; trình duyệt trong app có phiên riêng).
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: d.resourceType === 'subFrame' }))
  agents.attachHub(hub)
  await plugins.load()
  await plugins.applySettings(settings.get())
  plugins.startScheduler()
  await webhooks.start().catch((e) => console.error('[plugins] webhook server', e))
  agents.attachPlugins({
    onSession: (type, a) => plugins.emit(pluginEvent(type, a, { kind: agentKind(a) })),
    onHandoff: (a, d) => plugins.emit(pluginEvent('handoff.done', a, { ...d, summary: d.summary.slice(0, 20_000) })),
    onScopeConflict: (c) =>
      plugins.emit(
        pluginEvent('scope.conflict', c.agent, {
          path: c.hits[0],
          paths: c.hits,
          ownerAgentId: c.owner.agentId,
          ownerAgentName: c.owner.agentName,
          taskTitle: c.owner.title,
          entry: c.entry,
          ...(c.command ? { command: c.command } : {}),
          decision: c.decision
        })
      ),
    tools: (a, ws) =>
      plugins.toolsFor(ws.id, a.id).map((t) => ({
        name: t.mcpName,
        title: t.tool.displayName,
        description: t.tool.description,
        inputSchema: t.tool.parametersSchema,
        call: (params) =>
          plugins.callTool(t.pluginId, t.tool.name, params, { workspaceId: ws.id, workspaceName: ws.name, workspacePath: ws.path, agentId: a.id, agentName: a.name })
      }))
  })
  registerIpc(ptys, workspaces, agents, board, browser, settings, activity, artifacts, notifier, adapters, external, secrets, oauth, approvals, skills, plugins, vaultIndexer, devServers, products)
  // Góp ý còn trong hàng chờ từ lần chạy trước: nạp sẵn để được gửi khi agent rảnh, kể cả khi chưa mở tab.
  for (const w of workspaces.list()) void products.warm(w).catch(() => {})
  inspect.register()
  ipcMain.handle(IPC.inspectSnapshot, (_e, workspaceId: string) => inspect.snapshot(String(workspaceId)))
  ipcMain.handle(IPC.inspectAct, (_e, workspaceId: string, action: InspectAction) => inspect.act(String(workspaceId), action))
  for (const w of workspaces.list()) void inspect.warm(w).catch(() => {})
  const inspectRes = app.isPackaged ? join(process.resourcesPath, 'inspect') : join(app.getAppPath(), 'resources', 'inspect')
  const wsOf = (id: unknown): Workspace => {
    const w = workspaces.get(String(id))
    if (!w) throw new Error('Workspace không còn')
    return w
  }
  ipcMain.handle(IPC.inspectSetup, (_e, workspaceId: string) => detectSetup(wsOf(workspaceId)))
  ipcMain.handle(IPC.inspectInstall, (_e, workspaceId: string, kind: SourceKind) => {
    if (kind !== 'vite' && kind !== 'next' && kind !== 'wordpress') throw new Error('Không rõ loại')
    return installSetup(wsOf(workspaceId), kind, inspectRes)
  })
  ipcMain.handle(IPC.inspectUninstall, (_e, workspaceId: string) => removeWordpress(wsOf(workspaceId)))
  ipcMain.handle(IPC.inspectSetupMessage, async (_e, workspaceId: string, kind: 'vite' | 'next') => {
    const setup = await detectSetup(wsOf(workspaceId))
    const cfg = kind === 'vite' ? setup.vite?.config : setup.next?.config
    if (!cfg || (kind !== 'vite' && kind !== 'next')) throw new Error('Không thấy file cấu hình')
    return setupMessage(kind, cfg)
  })
  registerVoiceIpc(voice, new VocabCache(), workspaces, voiceCloud, cloudUsage)
  registerClaudeUsageIpc(claudeUsage)
  claudeUsage.sync()
  registerVoiceSystemIpc({
    secrets,
    aiUrl: /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.STAG_ANTHROPIC_URL ?? '') ? process.env.STAG_ANTHROPIC_URL : undefined,
    keys: keySender,
    overlay,
    global: globalVoice,
    // Đang nói ngoài app: cửa sổ stag.ai nằm dưới / thu nhỏ nhưng vẫn phải thu âm và gửi đều đặn (Chromium hãm hẹn giờ của cửa sổ nền).
    background: (on) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.setBackgroundThrottling(!on)
    }
  })
  // Menu (ẩn) như mặc định của Electron nhưng bỏ "Close" (Ctrl+W): Ctrl+W là phím xoá từ của CLI trong ô terminal, và mục
  // Close của menu mặc định đóng luôn cửa sổ app — cả khi con trỏ ở pane Trình duyệt hay trong khung widget / plugin, nơi
  // trang chính không bắt được phím.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
    ])
  )
  createWindow()
  globalVoice.sync()
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
  void products.flush()
  browser.shutdown()
  webhooks.stop()
  void plugins.shutdown()
  voice.shutdown()
  voiceCloud.shutdown()
  claudeUsage.shutdown()
  globalVoice.dispose()
  keySender.dispose()
  overlay.dispose()
  agents.shutdown()
  hub.stop()
})

app.on('window-all-closed', () => {
  agents.shutdown()
  hub.stop()
  ptys.killAll()
  if (process.platform !== 'darwin') app.quit()
})
