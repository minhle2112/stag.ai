// Kiểu dữ liệu nghiệp vụ dùng chung giữa main và renderer.

export interface Workspace {
  id: string
  name: string
  /** Thư mục dự án (tuyệt đối). */
  path: string
  /** Thư mục vault (tuyệt đối). */
  vaultPath: string
  createdAt: string
}

export type VaultKind = 'stag' | 'obsidian'

export interface VaultCandidate {
  path: string
  /** Đường dẫn tương đối so với thư mục dự án ('' = chính thư mục dự án). */
  relPath: string
  /** 'stag' = có _INDEX.md đúng mẫu; 'obsidian' = chỉ có .obsidian/. */
  kind: VaultKind
  /** Đã có trong danh sách vault của Obsidian. */
  registered: boolean
}

export interface WorkspaceInspection {
  path: string
  suggestedName: string
  isGitRepo: boolean
  candidates: VaultCandidate[]
  /** Workspace đã có trong app với cùng thư mục (nếu có). */
  existing?: Workspace
}

export type VaultChoice =
  | { mode: 'new' }
  | { mode: 'existing'; path: string; /** Bổ sung phần còn thiếu theo template (chỉ thêm, không ghi đè). */ augment: boolean }

export interface CreateWorkspaceRequest {
  path: string
  name: string
  vault: VaultChoice
  gitInit: boolean
}

export interface CreateWorkspaceResult {
  workspace: Workspace
  /** Danh sách việc app đã làm / bỏ qua, để hiện cho người dùng. */
  report: string[]
}

export interface VaultNode {
  name: string
  /** Đường dẫn tương đối trong vault, phân cách bằng '/'. */
  rel: string
  dir: boolean
  children?: VaultNode[]
}

/** Một note trong chỉ mục vault (Vault Viewer). */
export interface VaultNoteInfo {
  /** Đường dẫn tương đối trong vault, phân cách '/', có đuôi `.md`. */
  rel: string
  /** Tên file bỏ `.md` (Obsidian hiển thị và link theo tên này). */
  name: string
  /** `type:` trong frontmatter (log / decision / feature / agent…), dùng tô màu graph. */
  type: string | null
  aliases: string[]
  tags: string[]
  /** Lần sửa cuối (ms). */
  mtime: number
}

/** Một link từ note này sang note khác. */
export interface VaultLink {
  from: string
  /** `rel` của note đích; null = note chưa có (node "ma" trong graph, tên lấy từ `target`). */
  to: string | null
  /** Chữ gốc trỏ tới note, đã bỏ `|bí danh` và `#heading`. */
  target: string
  embed: boolean
  /** Dòng chứa link trong note nguồn (từ 1). */
  line: number
}

/** Chỉ mục toàn vault: note + link. Backlinks = các link có `to` là note đang xem. Không gồm link tới file đính kèm. */
export interface VaultIndex {
  vaultPath: string
  notes: VaultNoteInfo[]
  links: VaultLink[]
}

/** Kết quả tìm kiếm toàn văn trong vault. */
export interface VaultSearchHit {
  rel: string
  /** Từ khoá có trong tên note. */
  titleMatch: boolean
  /** Các dòng có từ khoá (tối đa vài dòng mỗi note), `text` là dòng gốc đã cắt ngắn. */
  matches: Array<{ line: number; text: string }>
}

/** Kết quả lưu note sửa trong app: 'conflict' = file trên đĩa đã đổi từ lúc bắt đầu sửa (`disk` null = đã bị xoá). */
export type NoteWriteResult = { status: 'saved' } | { status: 'conflict'; disk: string | null }

/** Một lần agent đọc / ghi note trong vault (suy ra từ hook, chỉ giữ trong bộ nhớ của app). */
export interface VaultActivity {
  agentId: string
  agentName: string
  /** Đường dẫn tương đối trong vault, '/', có đuôi `.md` (đúng hoa thường của file thật nếu biết). */
  rel: string
  kind: 'read' | 'write'
  /** ISO. */
  at: string
}

/**
 * Một lần agent tạo / sửa / xoá file trong dự án (output của agent, suy ra từ hook PostToolUse).
 * Lưu ở `<dự án>/.stag/artifacts.json`.
 */
export interface ArtifactEvent {
  agentId: string
  agentName: string
  /** Đường dẫn tương đối so với thư mục dự án, '/' (đúng hoa thường của đường dẫn agent dùng). */
  rel: string
  /** 'write' = tạo hoặc ghi đè cả file; 'edit' = sửa một phần; 'delete' = xoá. */
  kind: 'write' | 'edit' | 'delete'
  /** Tool đã dùng (Write, Edit, apply_patch, Bash…). */
  tool: string
  /** ISO. */
  at: string
}

/** Thông tin file của một artifact trên đĩa (null = không còn file). */
export interface ArtifactStat {
  size: number
  /** ISO. */
  mtime: string
}

/** Nội dung xem trước dạng chữ của một artifact. */
export type ArtifactText = { status: 'ok'; text: string; truncated: boolean } | { status: 'binary' } | { status: 'missing' }

export type ObsidianOpenResult =
  | { status: 'opened' }
  | { status: 'needs-register'; vaultPath: string; obsidianInstalled: boolean }

/** Mức tự quyền của Claude Code ('default' = theo cài đặt Claude Code của người dùng). */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan'

/**
 * Loại ô trong lưới: agent chạy một CLI AI (có tên, vai trò, note bộ nhớ, luật phiên riêng), hoặc
 * terminal thường (shell trong thư mục dự án, không có bộ nhớ, không lên kanban).
 * 'external' = agent chạy CLI của một adapter ngoài người dùng cài (xem `Agent.adapterId`).
 */
export type AgentKind = 'claude' | 'codex' | 'terminal' | 'external'

/** Agent tạo trước khi có loại ô là agent Claude Code. */
export function agentKind(a: { kind?: AgentKind }): AgentKind {
  return a.kind ?? 'claude'
}

/** Agent = danh tính lâu dài trong một workspace. Mỗi lần chạy là một phiên (session) mới. */
export interface Agent {
  id: string
  workspaceId: string
  /** Thiếu = 'claude' (xem agentKind). */
  kind?: AgentKind
  name: string
  role: string
  permissionMode: PermissionMode
  createdAt: string
  /** Phiên CLI gần nhất, để "tiếp tục phiên trước" (--resume). Terminal không có. */
  lastSessionId?: string
  /** kind = 'external': id adapter ngoài (stagAdapter.id). */
  adapterId?: string
}

export type SplitDir = 'row' | 'col'

/**
 * Lưới ô của tab Agents: cây chia đôi. 'row' = trái|phải, 'col' = trên/dưới.
 * Lá: ô agent (`leaf`) hoặc ô widget của plugin (`widget` = "<id plugin>/<id slot dashboardWidget>", mỗi widget
 * tối đa một ô trong một workspace).
 */
export type LayoutNode =
  | { type: 'leaf'; agentId: string }
  | { type: 'widget'; widget: string }
  | { type: 'split'; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode }

/** Ô lá của lưới (agent hoặc widget). */
export type LayoutCell = Exclude<LayoutNode, { type: 'split' }>

export interface AgentRun {
  agentId: string
  sessionId: string
  ptyId: string
  startedAt: string
}

export interface AgentsSnapshot {
  agents: Agent[]
  layout: LayoutNode | null
  running: AgentRun[]
}

export interface CreateAgentRequest {
  workspaceId: string
  kind: AgentKind
  /** kind = 'external': adapter ngoài nào. */
  adapterId?: string
  name: string
  role: string
  permissionMode: PermissionMode
}

export interface StartAgentRequest {
  agentId: string
  /** true = tiếp tục phiên trước (lastSessionId), false = phiên mới. */
  resume: boolean
  cols: number
  rows: number
}

/**
 * Agent đang làm gì lúc này (suy ra từ hook của Claude Code).
 * 'starting' = phiên vừa mở, chưa có hook nào (đang tải, hoặc đứng ở hộp thoại "trust this folder").
 */
export type AgentActivity = 'starting' | 'working' | 'waiting' | 'stopped'

/**
 * Vì sao agent đang chờ: hết lượt trả lời, xin quyền, hỏi lựa chọn, lâu không ai gõ,
 * hay người dùng bấm Esc ngắt giữa lượt ('interrupted', phát hiện qua transcript).
 */
export type WaitReason = 'turn' | 'permission' | 'question' | 'idle' | 'interrupted'

/** Độ dài context của phiên đang chạy. */
export interface ContextUsage {
  /** Token đầu vào của lượt gần nhất (input + cache), giống `used_percentage` của Claude Code. */
  used: number
  /** Kích thước cửa sổ context (200k / 1M…); null = chưa biết (người dùng có statusLine riêng, xem hub.ts). */
  size: number | null
  /** Lúc đo `used` (ISO). */
  at: string
}

/**
 * Bàn giao sang phiên mới khi context gần đầy: 'asking' = app đã nhờ agent viết bản bàn giao,
 * 'restarting' = đã có bản bàn giao, đang đóng phiên cũ / mở phiên mới, 'failed' = agent hết lượt mà
 * không bàn giao (không thử lại trong phiên này).
 */
export type HandoffState = 'asking' | 'restarting' | 'failed'

export interface AgentStatus {
  agentId: string
  activity: AgentActivity
  reason?: WaitReason
  /** Tool đang chạy (khi activity = 'working'). */
  tool?: string
  since: string
  context?: ContextUsage
  handoff?: HandoffState
}

/** Bàn giao khi context gần đầy. Đặt được ở cấp app, ghi đè theo workspace / agent. */
/**
 * Khoá phạm vi (Settings S5): agent định sửa vào phạm vi việc đang mở của agent khác thì
 * `ask` = hỏi bạn (Claude: hộp quyền trong terminal; Codex: hộp thoại của app), `block` = chặn luôn,
 * `warn` = cho sửa, chỉ cảnh báo (kanban + kết quả task_start), `off` = tắt hẳn (không khoá, không cảnh báo).
 */
export type ScopeMode = 'ask' | 'block' | 'warn' | 'off'
export interface ScopeLockSettings {
  mode: ScopeMode
  /** Đoán lệnh shell có ghi vào chỗ bị khoá không (Bash / PowerShell / exec_command). */
  guessShell: boolean
  /** Mẫu đường dẫn không bao giờ khoá (cú pháp như phạm vi việc, vd. `docs/**`, `*.lock`); cộng thêm vault / .git / .sessions / .stag. */
  exempt: string[]
}

/** Trình duyệt trong app (Settings S5). */
export type SearchEngine = 'google' | 'duckduckgo' | 'bing'
export type ExternalPagePolicy = 'ask' | 'allow' | 'deny'
export interface BrowserSettings {
  /** Trang mở khi bạn bấm "+" tab mới ('' = trang trống). */
  homePage: string
  /** Chữ gõ vào thanh địa chỉ không phải địa chỉ → tìm bằng. */
  searchEngine: SearchEngine
  /** Cho agent dùng trình duyệt (tool browser_* trong MCP stag). Ghi đè được theo workspace / agent. */
  agentTools: boolean
  /** Agent mở trang ngoài localhost: hỏi bạn / luôn cho / luôn chặn. */
  externalPages: ExternalPagePolicy
  /** Origin luôn cho agent mở (không hỏi), vd. `https://github.com`. */
  allowedOrigins: string[]
  /** Giữ cookie / đăng nhập của trình duyệt mỗi workspace sau khi tắt app. */
  keepCookies: boolean
}

/** Gõ bằng giọng nói (Settings → Giọng nói, chỉ ở cấp app). Xem shared/voice.ts. */
export type VoiceHotkey = 'ctrl+space' | 'ctrl+shift+space' | 'ctrl+alt+space' | 'f9'
export interface VoiceSettings {
  /** Bật phím tắt + nút micro trên ô agent. */
  enabled: boolean
  /** Giữ tổ hợp này để nói, thả ra để dừng. */
  hotkey: VoiceHotkey
  /** deviceId của micro ('' = micro mặc định của Windows). */
  micId: string
  /** Hiện khung xem trước để sửa rồi mới chèn (tắt = chèn thẳng vào ô, vẫn không tự nhấn Enter). */
  preview: boolean
  /** Không dùng bao nhiêu phút thì tắt tiến trình nhận dạng để trả RAM (0 = giữ tới khi tắt app). */
  unloadMinutes: number
  /** Từ gợi ý thêm (tên riêng, thuật ngữ tiếng Anh hay dùng), giúp nhận đúng chính tả. */
  hotwords: string[]
}

export interface HandoffSettings {
  /** Tự bàn giao sang phiên mới khi context đạt `handoffPercent`. */
  autoHandoff: boolean
  /** Ngưỡng % cửa sổ context để bàn giao (HANDOFF_MIN…HANDOFF_MAX). */
  handoffPercent: number
}

export const HANDOFF_MIN = 20
/** Claude Code tự compact ở khoảng 96,7% cửa sổ 1M (và ở 100% cửa sổ 200k): bàn giao phải trước đó. */
export const HANDOFF_MAX = 95

/** Shell cho ô Terminal. Không có trên máy thì dùng PowerShell. */
export type ShellId = 'powershell' | 'pwsh' | 'gitbash' | 'cmd'
export type CloseAction = 'quit' | 'tray'

/** Mục "Chung" của Settings (chỉ ở cấp app). */
export interface GeneralSettings {
  /** % thu phóng giao diện (ZOOM_MIN…ZOOM_MAX). */
  zoom: number
  /** Chạy cùng Windows (chỉ có tác dụng ở bản cài đặt). */
  openAtLogin: boolean
  /** Mở app thì vào lại workspace đang mở lần trước (tắt = workspace đầu danh sách). */
  reopenLastWorkspace: boolean
  /** Thư mục mở sẵn khi chọn thư mục cho workspace mới ('' = để Windows tự chọn). */
  projectsDir: string
  /** Cỡ chữ của mọi terminal (ô agent và ô Terminal). */
  terminalFontSize: number
  /** Báo khi agent chuyển sang chờ bạn (chỉ khi cửa sổ app không được chọn). */
  notifyWaiting: boolean
  /** Báo khi agent xong một việc trên kanban. */
  notifyTaskDone: boolean
  notifySound: boolean
  /** Bấm × trên cửa sổ: thoát hẳn hay thu xuống khay (agent vẫn chạy). */
  closeAction: CloseAction
  /** Hỏi lại trước khi thoát nếu còn agent / terminal đang chạy. */
  confirmQuitRunning: boolean
}

export const ZOOM_MIN = 70
export const ZOOM_MAX = 150
export const TERMINAL_FONT_MIN = 9
export const TERMINAL_FONT_MAX = 24

/** Adapter = cách app chạy một loại ô (Claude Code, Codex, Terminal). Trùng với AgentKind. */
export type AdapterId = Exclude<AgentKind, 'external'>
export type CliAdapterId = Exclude<AdapterId, 'terminal'>

/** Model + mức suy nghĩ của một CLI. '' = theo cấu hình CLI của người dùng (~/.claude, ~/.codex). */
export interface ModelSettings {
  model: string
  effort: string
}

/** Adapter chạy một CLI AI (Claude Code / Codex). */
export interface CliAdapterSettings extends ModelSettings {
  /** Hiện trong hộp "Thêm agent". Agent đã có vẫn chạy được khi tắt. */
  enabled: boolean
  /** File chạy ('' = tự tìm trong PATH). */
  path: string
  /** Mức quyền chọn sẵn khi thêm agent. */
  defaultPermission: PermissionMode
  /** Tham số thêm cho mọi phiên, cách nhau bằng dấu cách ("…" giữ khoảng trắng). */
  extraArgs: string
  /** Biến môi trường thêm, mỗi dòng KEY=value (dòng # là ghi chú). Không phải chỗ để key bí mật. */
  env: string
}

export interface TerminalAdapterSettings {
  enabled: boolean
  shell: ShellId
}

export interface AdaptersSettings {
  claude: CliAdapterSettings
  codex: CliAdapterSettings
  terminal: TerminalAdapterSettings
}

/** Giá trị trong cấu hình connector: chữ thường, hoặc tên một bí mật (Settings → Secrets). */
export type ConnectorValue = { value: string } | { secret: string; prefix?: string }

/** Tool của connector: tự cho phép / hỏi trước / chặn. */
export type ToolPolicy = 'allow' | 'ask' | 'block'

/** Connector = máy chủ MCP app đưa vào phiên agent (Settings → Connector). Không chứa giá trị bí mật. */
export interface Connector {
  /** Tên máy chủ MCP trong phiên: a-z, 0-9, '_', '-'; không trùng "stag". */
  id: string
  label: string
  transport: 'stdio' | 'http'
  /** stdio: chương trình + tham số + biến môi trường. */
  command: string
  args: string[]
  env: Record<string, ConnectorValue>
  /** http (Streamable HTTP): địa chỉ, bí mật làm `Authorization: Bearer …` ('' = không), header thêm. */
  url: string
  /** URL có token bên trong (vd. Zapier) cất thành bí mật này; `url` chỉ còn bản rút gọn để hiện. '' = không. */
  urlSecret: string
  bearerSecret: string
  headers: Record<string, ConnectorValue>
  /** Đăng nhập OAuth trong app: bearerSecret = bí mật `OAUTH_<ID>` chứa token (app tự làm mới trước mỗi phiên). */
  oauth: boolean
  /** Tạo từ danh mục (logo, tên dịch vụ, cách kết nối). */
  catalog?: { slug: string; method: string }
  /** Bật ở cấp app (workspace / agent ghi đè được). */
  enabled: boolean
  /** Mức cho tool chưa đặt riêng trong toolPolicy. */
  approval: 'allow' | 'ask'
  toolPolicy: Record<string, ToolPolicy>
  /** Tool thấy ở lần "Thử kết nối" gần nhất. */
  tools: ConnectorTool[]
  testedAt: string
}

export interface ConnectorTool {
  name: string
  description: string
}

export interface ConnectorsSettings {
  items: Connector[]
  /** Bật / tắt máy chủ MCP có sẵn của Claude Code / Codex ở cấp app. Khoá `claude:<tên>` / `codex:<tên>`; vắng = bật. */
  inherited: Record<string, boolean>
}

/** Cài đặt cấp app. */
export interface AppSettings {
  general: GeneralSettings
  handoff: HandoffSettings
  adapters: AdaptersSettings
  connectors: ConnectorsSettings
  skills: SkillsSettings
  plugins: PluginsSettings
  scope: ScopeLockSettings
  browser: BrowserSettings
  voice: VoiceSettings
}

export interface PluginsSettings {
  /** Bật / tắt plugin (khoá = id plugin) ở cấp app; vắng = bật. Tắt ở app = dừng worker. */
  toggles: Record<string, boolean>
}

export interface SkillsSettings {
  /**
   * Bật / tắt ở cấp app. Khoá: tên skill trong thư viện của stag.ai (vắng = bật), `claude:<tên>` / `codex:<tên>`
   * (skill có sẵn của CLI, vắng = bật), `claude-plugin:<plugin@marketplace>` (cả plugin Claude Code, vắng = bật).
   */
  toggles: Record<string, boolean>
}

/** Phần ghi đè ở cấp workspace / agent; thiếu khoá = theo cấp trên. */
export interface SettingsOverrides {
  handoff?: Partial<HandoffSettings>
  /** Model / mức suy nghĩ theo CLI (ở cấp agent chỉ CLI của agent đó có tác dụng). */
  models?: Partial<Record<CliAdapterId, Partial<ModelSettings>>>
  /** Bật / tắt connector (id) hoặc máy chủ MCP có sẵn (`claude:<tên>` / `codex:<tên>`). */
  connectors?: Record<string, boolean>
  /** Bật / tắt skill (khoá như SkillsSettings.toggles). */
  skills?: Record<string, boolean>
  /** Bật / tắt plugin (khoá = id plugin): ẩn slot, tool, sự kiện của nó ở cấp này. */
  plugins?: Record<string, boolean>
  /** Khoá phạm vi: workspace đổi được mode / guessShell và thêm exempt (cộng với app); agent chỉ đổi mode. */
  scope?: Partial<ScopeLockSettings>
  /** Trình duyệt: chỉ bật / tắt tool trình duyệt của agent. */
  browser?: { agentTools?: boolean }
}

/** Sửa ghi đè: khoá có mặt thay cả mục đó, `null` = bỏ mục đó (theo cấp trên). Khoá vắng mặt giữ nguyên. */
export type SettingsOverridesPatch = { [K in keyof SettingsOverrides]?: SettingsOverrides[K] | null }

/** Toàn bộ userData/settings.json: cấp app + ghi đè theo workspace và theo agent (app → workspace → agent). */
export interface Settings {
  version: 2
  app: AppSettings
  workspaces: Record<string, SettingsOverrides>
  agents: Record<string, SettingsOverrides>
}

/** Sửa cấp app: chỉ các trường có mặt. */
export interface AppSettingsPatch {
  general?: Partial<GeneralSettings>
  handoff?: Partial<HandoffSettings>
  adapters?: {
    claude?: Partial<CliAdapterSettings>
    codex?: Partial<CliAdapterSettings>
    terminal?: Partial<TerminalAdapterSettings>
  }
  /** Chỉ phần bật / tắt máy chủ có sẵn; danh sách connector sửa qua IPC riêng (connectors:save / remove). */
  connectors?: { inherited?: Record<string, boolean> }
  /** Thay cả map bật / tắt skill ở cấp app. */
  skills?: { toggles: Record<string, boolean> }
  /** Thay cả map bật / tắt plugin ở cấp app. */
  plugins?: { toggles: Record<string, boolean> }
  scope?: Partial<ScopeLockSettings>
  browser?: Partial<BrowserSettings>
  voice?: Partial<VoiceSettings>
}

export type OverrideLevel = 'workspace' | 'agent'

export const DEFAULT_HANDOFF: HandoffSettings = { autoHandoff: true, handoffPercent: 80 }
export const DEFAULT_SCOPE: ScopeLockSettings = { mode: 'ask', guessShell: true, exempt: [] }
export const DEFAULT_BROWSER: BrowserSettings = { homePage: '', searchEngine: 'google', agentTools: true, externalPages: 'ask', allowedOrigins: [], keepCookies: false }
export const VOICE_UNLOAD_MAX = 120
export const DEFAULT_VOICE: VoiceSettings = { enabled: true, hotkey: 'ctrl+space', micId: '', preview: true, unloadMinutes: 5, hotwords: [] }
export const DEFAULT_GENERAL: GeneralSettings = {
  zoom: 100,
  openAtLogin: false,
  reopenLastWorkspace: true,
  projectsDir: '',
  terminalFontSize: 13,
  notifyWaiting: true,
  notifyTaskDone: true,
  notifySound: true,
  closeAction: 'quit',
  confirmQuitRunning: true
}
const DEFAULT_CLI: CliAdapterSettings = { enabled: true, path: '', model: '', effort: '', defaultPermission: 'default', extraArgs: '', env: '' }
export const DEFAULT_ADAPTERS: AdaptersSettings = {
  claude: DEFAULT_CLI,
  codex: DEFAULT_CLI,
  terminal: { enabled: true, shell: 'powershell' }
}
export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  app: { general: DEFAULT_GENERAL, handoff: DEFAULT_HANDOFF, adapters: DEFAULT_ADAPTERS, connectors: { items: [], inherited: {} }, skills: { toggles: {} }, plugins: { toggles: {} }, scope: DEFAULT_SCOPE, browser: DEFAULT_BROWSER, voice: DEFAULT_VOICE },
  workspaces: {},
  agents: {}
}

/** Một shell tìm thấy trên máy (Settings → Adapter → Terminal). */
export interface ShellInfo {
  id: ShellId
  label: string
  path: string
  args: string[]
}

/** Thông tin phiên bản cho Settings → Giới thiệu. */
export interface AppMeta {
  version: string
  electron: string
  chrome: string
  node: string
  userData: string
  packaged: boolean
}

export type TaskStatus = 'open' | 'done' | 'dropped'

/** Một việc agent nhận (tool task_start), lưu ở <dự án>/.stag/tasks.json. */
export interface Task {
  id: string
  agentId: string
  /** Giữ tên lúc tạo để lịch sử vẫn đọc được khi agent đã bị xoá. */
  agentName: string
  sessionId: string
  title: string
  scope: string
  status: TaskStatus
  createdAt: string
  doneAt?: string
  summary?: string
  /** Người dùng đánh dấu xong/bỏ bằng tay (không phải agent báo). */
  manual?: boolean
  /** File agent đã sửa trong lúc việc mở (tương đối so với dự án, '/'), cũng thuộc vùng khoá của việc (xem scope.ts). */
  files?: string[]
}

/**
 * Agent Codex sắp sửa file trong vùng khoá của việc agent khác: Codex không có hộp xin quyền cho hook
 * nên app hỏi người dùng (Claude Code thì hỏi ngay trong terminal của nó).
 */
export interface ScopeAsk {
  id: string
  agentId: string
  agentName: string
  /** File / mục khoá sắp bị sửa (tương đối so với dự án). */
  file: string
  /** Lệnh shell sắp chạy (khi đoán từ lệnh, không phải tool sửa file). */
  command?: string
  /** Việc đang giữ file đó. */
  holder: { agentName: string; title: string; entry: string }
  /** Hạn trả lời (ISO); quá hạn thì app từ chối. */
  until: string
}

export interface BoardSnapshot {
  statuses: AgentStatus[]
  tasks: Task[]
  scopeAsks: ScopeAsk[]
}

/** Ai mở tab browser: người dùng, hoặc một agent. */
export type BrowserTabOwner = { kind: 'user' } | { kind: 'agent'; agentId: string; agentName: string }

export interface BrowserTab {
  id: string
  owner: BrowserTabOwner
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** DevTools của tab đang mở (cửa sổ riêng). */
  devtools: boolean
}

/** Browser của một workspace. */
export interface BrowserState {
  tabs: BrowserTab[]
  activeTabId: string | null
}

/** Agent xin mở trang ngoài localhost: người dùng trả lời trong app. */
export interface BrowserPermissionAsk {
  id: string
  workspaceId: string
  agentName: string
  origin: string
  url: string
}

export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

/** Một model gợi ý cho ô Model của adapter. */
export interface AdapterModel {
  id: string
  label: string
  /** Mức suy nghĩ model này nhận (rỗng = không rõ). */
  efforts: string[]
}

/** Kết quả kiểm tra một adapter CLI trên máy (Settings → Adapter). */
export interface AdapterStatus {
  id: CliAdapterId
  /** File chạy dùng thật; null = không tìm thấy. */
  path: string | null
  source: 'auto' | 'custom'
  version: string | null
  login: { state: 'in' | 'out' | 'unknown'; detail: string }
  /** Model trong cấu hình của người dùng (~/.claude/settings.json, ~/.codex/config.toml), nếu có. */
  configModel: string | null
  models: AdapterModel[]
  /** Lỗi tìm / chạy CLI (tiếng Việt, hiện thẳng cho người dùng). */
  error: string | null
  checkedAt: string
}

/** Khai báo `stagAdapter` trong package.json của một adapter ngoài (xem docs/adapters.md). */
export interface ExternalAdapterManifest {
  /** a-z, 0-9, '-'; không trùng adapter có sẵn. */
  id: string
  label: string
  description: string
  /** Tên chương trình trong PATH, hoặc đường dẫn có {pkg} (thư mục gói). */
  command: string
  /** Luôn truyền cho mọi phiên ({pkg} được thay). */
  args: string[]
  versionArgs: string[]
  /** Lệnh gợi ý khi không tìm thấy chương trình (vd. pip install aider-chat). */
  install: string
  homepage: string
  models: Array<{ id: string; label: string }>
  /** Cờ chọn model (vd. --model); '' = adapter không nhận model. */
  modelFlag: string
  /** Cách đưa luật phiên (một file .md app viết) cho CLI: qua cờ + đường dẫn, qua biến môi trường, hoặc không. */
  rules: { flag: string } | { env: string } | null
  /** Lời mở phiên: qua cờ, là tham số cuối, hoặc không gửi. */
  prompt: { flag: string } | { positional: true } | null
  /** CLI đọc được file cấu hình MCP kiểu Claude (`{ mcpServers }`): cờ nhận đường dẫn file đó; '' = không. */
  mcpConfigFlag: string
}

export type ExternalAdapterSource = { type: 'npm'; name: string; version: string } | { type: 'local'; path: string }

/** Một adapter ngoài đã cài (userData/adapters/registry.json). */
export interface InstalledAdapter {
  manifest: ExternalAdapterManifest
  source: ExternalAdapterSource
  /** Thư mục gói (có package.json). */
  dir: string
  /** version trong package.json của gói. */
  version: string
  installedAt: string
  /** Hiện trong hộp Thêm agent. */
  enabled: boolean
  /** '' = mặc định của CLI. */
  model: string
  extraArgs: string
  env: string
}

export type AdapterInstallRequest = { type: 'npm'; name: string; version?: string } | { type: 'local'; path: string }

/** Sửa được từ Settings → Adapter → adapter ngoài. */
export type InstalledAdapterPatch = Partial<Pick<InstalledAdapter, 'enabled' | 'model' | 'extraArgs' | 'env'>>

/** Kiểm tra chương trình của một adapter ngoài. */
export interface ExternalAdapterStatus {
  id: string
  path: string | null
  version: string | null
  error: string | null
  checkedAt: string
}

/** Máy chủ MCP có sẵn trong cấu hình Claude Code / Codex của người dùng (app chỉ bật / tắt, không sửa). */
export interface InheritedServer {
  /** `claude:<tên>` / `codex:<tên>`: khoá bật / tắt trong cài đặt. */
  key: string
  runtime: CliAdapterId
  name: string
  /** claude.ai = connector của tài khoản Claude; plugin = từ plugin Claude Code; user / local / project = phạm vi `claude mcp add`. */
  source: 'claude.ai' | 'plugin' | 'user' | 'local' | 'project' | 'codex'
  /** Lệnh hoặc URL (không có biến môi trường). */
  target: string
  /** Tình trạng CLI báo (vd. "Connected", "Needs authentication"). */
  status: string
  /** Chép được thành connector của stag.ai (có cấu hình đọc được). */
  copyable: boolean
}

export interface InheritedScan {
  runtime: CliAdapterId
  /** Thư mục dự án đã quét (máy chủ phạm vi local / project phụ thuộc thư mục). */
  cwd: string
  servers: InheritedServer[]
  error: string | null
  scannedAt: string
}

/** Kết quả "Thử kết nối". */
export interface ConnectorTestResult {
  ok: boolean
  server: string
  tools: ConnectorTool[]
  error: string | null
  ms: number
}

/** Một bí mật đã lưu (không bao giờ gửi giá trị sang giao diện). */
export interface SecretInfo {
  name: string
  updatedAt: string
}

export interface SecretsList {
  /** Windows mã hoá được (safeStorage); false = không lưu được bí mật. */
  available: boolean
  items: SecretInfo[]
}

/** Dán JSON / chép máy chủ có sẵn: connector mới + bí mật tách ra từ giá trị trông như token. */
export interface ConnectorImport {
  connectors: Connector[]
  /** Tên bí mật sẽ tạo (giá trị giữ ở main). */
  secrets: string[]
  errors: string[]
}

/** Một mục trong danh mục connector (Cài đặt → Connector → Danh mục), xem src/shared/connectorCatalog.json. */
export interface CatalogEntry {
  slug: string
  name: string
  description: string
  categories: string[]
  featured: boolean
  docsUrl?: string
  /** Tên file trong src/renderer/src/assets/connectors. */
  logo?: string
  logoDark?: string
  methods: CatalogMethod[]
}

/** Một cách kết nối: oauth = đăng nhập trình duyệt (tự đăng ký client), oauth-app = OAuth app của bạn, key = API key, none = không cần, url = dán URL, stdio = chạy trên máy. */
export interface CatalogMethod {
  key: string
  kind: 'oauth' | 'oauth-app' | 'key' | 'none' | 'url' | 'stdio'
  label: string
  capability?: { label: string; description: string }
  guide: string
  warnings: string[]
  docs?: string
  register?: string
  serverUrl?: string
  /** URL có chỗ trống `{field}` (vd. tên cửa hàng Shopify). */
  serverUrlTemplate?: string
  fields: Array<{ key: string; label: string; placeholder: string; help: string; pattern?: string }>
  header?: { name: string; prefix: string }
  keyLabel?: string
  keyPlaceholder?: string
  oauth?: { authorizationEndpoint?: string; tokenEndpoint?: string; scopes?: string[]; params?: Record<string, string> }
  command?: string
  args?: string[]
}

/** Ai được dùng connector mới: mọi agent / một workspace / vài agent. */
export type ConnectAccess = { mode: 'all' } | { mode: 'workspace'; workspaceId: string } | { mode: 'agents'; agentIds: string[] }

export interface ConnectRequest {
  slug: string
  method: string
  access: ConnectAccess
  /** Trường điền vào URL (vd. storeDomain). */
  fields: Record<string, string>
  /** API key (kind key) hoặc URL (kind url). */
  value?: string
  /** OAuth app của bạn (kind oauth-app). */
  client?: { id: string; secret: string }
}

export interface ConnectResult {
  id: string
  test: ConnectorTestResult
}

/** Lần gọi tool của connector đang chờ người dùng duyệt (Cài đặt → Connector → Duyệt). */
export interface ToolApproval {
  id: string
  workspaceId: string
  agentId: string
  agentName: string
  connectorId: string
  tool: string
  /** Tham số của lần gọi (JSON, đã cắt ngắn). */
  input: string
  at: string
  /** Hết hạn lúc này: quá hạn thì hỏi lại trong terminal của agent. */
  expiresAt: string
}

export type ApprovalDecision = 'allow' | 'always' | 'deny'

// ---- Skill (Cài đặt → Skill) ----

/** Skill trong thư viện của stag.ai đến từ đâu. */
export interface SkillSource {
  kind: 'created' | 'folder' | 'zip' | 'catalog' | 'claude' | 'codex'
  /** Đường dẫn / slug gốc. */
  from?: string
  at: string
}

/** Skill trong thư viện của stag.ai (userData/skills/<tên>/SKILL.md). */
export interface LibrarySkill {
  name: string
  description: string
  files: number
  bytes: number
  source: SkillSource
  updatedAt: string
  /** SKILL.md hỏng (thiếu frontmatter, tên không khớp thư mục…): vẫn hiện để sửa, không đưa vào phiên. */
  problem?: string
}

export interface SkillFile {
  /** Đường dẫn trong thư mục skill, dấu `/`. */
  path: string
  bytes: number
}

/** Nội dung một skill để xem / sửa. */
export interface SkillDoc {
  name: string
  dir: string
  md: string
  files: SkillFile[]
  /** false = skill có sẵn của CLI / plugin: chỉ xem. */
  editable: boolean
}

/** Skill Claude Code / Codex tự nạp (app chỉ bật / tắt cho phiên agent, không sửa). */
export interface InheritedSkill {
  runtime: CliAdapterId
  name: string
  description: string
  /** user / project / claude.ai / plugin (Claude); user / repo / system / admin (Codex). */
  scope: 'user' | 'project' | 'claude.ai' | 'plugin' | 'repo' | 'system' | 'admin'
  /** Đường dẫn SKILL.md. */
  path: string
  /** Khoá bật / tắt: `claude:<tên>` / `codex:<tên>`; skill của plugin Claude Code: `claude-plugin:<plugin>` (cả plugin). */
  toggleKey: string
  /** Plugin Claude Code chứa skill này. */
  plugin?: string
  /** Codex: người dùng đã tắt trong config.toml của họ. */
  disabledInCli?: boolean
}

export interface SkillScan {
  runtime: CliAdapterId
  cwd: string
  skills: InheritedSkill[]
  error: string | null
  scannedAt: string
}

/** Skill trong danh mục kèm app (resources/skill-catalog, từ @paperclipai/skills-catalog, MIT). */
export interface SkillCatalogEntry {
  slug: string
  name: string
  description: string
  category: string
  tags: string[]
  files: number
  bytes: number
  /** "stag.ai" = skill của chính app; không có = lấy từ danh mục của Paperclip. */
  source?: string
}

export interface SkillsList {
  library: LibrarySkill[]
  catalog: SkillCatalogEntry[]
}

/** Kết quả nhập / cài / chép skill vào thư viện. */
export interface SkillImportResult {
  added: string[]
  skipped: Array<{ name: string; reason: string }>
  list: SkillsList
}
