// Kiểu dữ liệu nghiệp vụ dùng chung giữa main và renderer.

export interface Workspace {
  id: string
  name: string
  /** Thư mục dự án (tuyệt đối). */
  path: string
  /** Thư mục vault (tuyệt đối). */
  vaultPath: string
  createdAt: string
  /**
   * Project trong workspace, mỗi project một đội agent (xem shared/projects.ts). Không có / rỗng = app như cũ: mọi agent
   * ở "Chung" (thư mục gốc).
   */
  projects?: Project[]
  /** Người dùng bấm "Để sau" ở thẻ gợi ý tách monorepo thành project: không hiện lại. */
  projectHintOff?: boolean
  /** Cặp project đã chọn "Luôn cho" gửi việc qua lại (`<id nhỏ>|<id lớn>`, xem projectPair). */
  projectLinks?: string[]
}

/** Một project trong workspace: thư mục code riêng + đội agent riêng (Agent.projectId). */
export interface Project {
  id: string
  name: string
  /** Thư mục code, tương đối so với thư mục workspace, phân cách '/' (vd. `apps/web`). */
  folder: string
  /** Mục tiêu (không bắt buộc). */
  goal: string
  /** Màu nhận diện (chỉ số xoay vòng trong PROJECT_COLORS). */
  color: number
  /** Note của project trong vault, tương đối so với vault (giữ nguyên khi đổi tên project). */
  note: string
  createdAt: string
}

/** Thư mục code của project mới: tạo thư mục mới (`name` trống = theo tên project) hoặc dùng thư mục có sẵn. */
export type ProjectFolderChoice = { mode: 'new'; name: string } | { mode: 'existing'; path: string }

/** Một agent của đội mẫu khi tạo project. */
export interface ProjectTeamMember {
  name: string
  role: string
  kind: 'claude' | 'codex'
  model?: string
  /** Nhân bản agent này ("Chép đội"): cùng loại / vai trò / quyền / ô / ghi đè cài đặt. */
  cloneOf?: string
}

export interface CreateProjectRequest {
  workspaceId: string
  name: string
  goal: string
  folder: ProjectFolderChoice
  team: ProjectTeamMember[]
}

export interface CreateProjectResult {
  workspace: Workspace
  project: Project
  agents: Agent[]
  /** Đã tạo thư mục mới (không phải dùng thư mục có sẵn). */
  createdFolder: boolean
}

/** Thông tin để hỏi trước khi xoá project. */
export interface ProjectDeleteInfo {
  /** Số file trong thư mục code (null = không đếm được / quá nhiều, xem `more`). */
  files: number | null
  more?: boolean
  /** Số file đã sửa chưa commit (null = không phải repo git / không đọc được). */
  dirty: number | null
  /** Thư mục còn tồn tại. */
  exists: boolean
}

/** Thư mục ở gốc workspace (cho hộp tạo project): `pkg` = có package.json (gợi ý monorepo). */
export interface WorkspaceFolder {
  path: string
  pkg: boolean
}

export type VaultKind = 'stag' | 'other'

export interface VaultCandidate {
  path: string
  /** Đường dẫn tương đối so với thư mục dự án ('' = chính thư mục dự án). */
  relPath: string
  /** 'stag' = có _INDEX.md đúng mẫu; 'other' = thư mục note khác mẫu (tự tìm thấy nhờ `.obsidian/`, hoặc người dùng tự chọn). */
  kind: VaultKind
  /** Thư mục người dùng tự chọn không có gì (bỏ qua mục ẩn): mặc định bổ sung theo template. */
  empty?: boolean
  /** Nằm ngoài thư mục dự án (không thêm vào .gitignore của dự án). */
  outside?: boolean
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
  /** Tên file bỏ `.md` (`[[link]]` trỏ theo tên này). */
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
  /** Giao diện ô: 'cli' = terminal (mặc định), 'chat' = ô chat (chỉ Claude Code, xem shared/chat.ts). */
  cell?: AgentCell
  /** Project của agent (mở phiên trong thư mục project); thiếu = "Chung" (thư mục gốc của workspace). Không đổi được. */
  projectId?: string
}

/** Giao diện của ô agent. */
export type AgentCell = 'cli' | 'chat'

/** Hình chữ nhật trên canvas (toạ độ thế giới, px ở mức zoom 100%). */
export interface CanvasRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Nội dung một ô: ô agent (`leaf`) hoặc ô widget của plugin (`widget` = "<id plugin>/<id slot dashboardWidget>", mỗi
 * widget tối đa một ô trong một workspace).
 */
export type CanvasRef = { type: 'leaf'; agentId: string } | { type: 'widget'; widget: string }

/** Ô trên canvas: nội dung + vị trí / kích thước + thứ tự chồng (`z` lớn nằm trên). */
export type CanvasCell = CanvasRef & CanvasRect & { z: number }

/** Camera của canvas: điểm thế giới (0,0) nằm ở (x, y) px của khung, phóng `zoom` lần. */
export interface CanvasView {
  x: number
  y: number
  zoom: number
}

/**
 * Bố cục tab Agents: canvas tự do (thay cho lưới chia đôi cũ, xem shared/canvas.ts). `closed` = chỗ cuối cùng của
 * các ô đã đóng (mã ô → hình), để mở lại đúng chỗ cũ. `view` = camera lần cuối (null = vừa khung khi mở).
 */
export interface CanvasLayout {
  cells: CanvasCell[]
  closed: Record<string, CanvasRect>
  view: CanvasView | null
}

export interface AgentRun {
  agentId: string
  sessionId: string
  /** Ô chat: `chat:<sessionId>` (không có pty thật). */
  ptyId: string
  startedAt: string
  /** Thiếu = 'cli'. */
  mode?: AgentCell
  /** `Agent.lastSessionId` ở main lúc trả về (Codex: thread id, khác `sessionId` của app; có thể chưa biết). */
  lastSessionId?: string
}

export interface AgentsSnapshot {
  agents: Agent[]
  /** Canvas của tab Chung (workspace chưa có project: canvas duy nhất). */
  layout: CanvasLayout
  running: AgentRun[]
  /** Canvas của từng project đã lưu (theo id project). */
  projectLayouts?: Record<string, CanvasLayout>
}

export interface CreateAgentRequest {
  workspaceId: string
  kind: AgentKind
  /** kind = 'external': adapter ngoài nào. */
  adapterId?: string
  name: string
  role: string
  permissionMode: PermissionMode
  /** Giao diện ô (mặc định 'cli'); 'chat' chỉ cho Claude Code. */
  cell?: AgentCell
  /** Model / mức suy nghĩ riêng của agent (ghi đè cấp agent ở Cài đặt → Adapter); bỏ trống = theo cài đặt. */
  model?: string
  effort?: string
  /** Việc đầu tiên: thành lời mở của phiên đầu tiên (thay lời chào). */
  firstTask?: string
  /** Phạm vi làm việc dự kiến (thư mục / glob), kèm vào lời mở để agent dùng khi task_start. */
  scope?: string
  /** Project của agent mới (thiếu = Chung). */
  projectId?: string
}

/** Người dùng phát một tin cho nhiều agent trong một workspace (gõ như người dùng gõ vào từng ô). */
export interface BroadcastRequest {
  workspaceId: string
  agentIds: string[]
  text: string
}

export interface BroadcastResult {
  results: Array<{
    agentId: string
    name: string
    /** 'sent' = đã gõ vào ô; 'queued' = agent đang bận, gõ khi nó rảnh; 'not-running' = chưa có phiên; 'invalid' = không gửi được. */
    status: 'sent' | 'queued' | 'not-running' | 'invalid'
  }>
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
/** Máy nhận dạng: trên máy (Qwen3-ASR, miễn phí, offline) hoặc đám mây (Soniox, cần API key, chữ hiện dần khi nói). */
export type VoiceEngine = 'local' | 'soniox'
export interface VoiceSettings {
  /** Bật phím tắt + nút micro trên ô agent. */
  enabled: boolean
  engine: VoiceEngine
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
  /** Tự lấy từ gợi ý trong workspace (tên file, hàm, class, thư viện) và từ đang hiện trong ô agent. */
  workspaceVocab: boolean
  /** Luật thay từ sau khi nhận dạng ("hen đồ click" → "handleClick"). */
  replacements: VoiceReplacement[]
  /** Lệnh nói: "xuống dòng" → xuống dòng thật. */
  commands: boolean
  /** V4 (tuỳ chọn): nhờ AI (Claude Haiku, API key riêng) sửa từ nghe sai theo danh sách từ của dự án. */
  aiFix: boolean
  /** V4 (tuỳ chọn): kết câu bằng "gửi" / "gửi đi" → chèn rồi nhấn Enter. */
  sendCommand: boolean
  /** V4 (tuỳ chọn): phím tắt toàn hệ thống, gõ vào ứng dụng đang mở (ngoài stag.ai). */
  global: boolean
  globalHotkey: VoiceGlobalHotkey
}

/** Phím tắt toàn hệ thống (bấm để bắt đầu, bấm lần nữa để dừng: Windows không báo nhả phím cho phím tắt toàn hệ thống). */
export type VoiceGlobalHotkey = 'ctrl+shift+space' | 'ctrl+alt+v' | 'f8'

export interface VoiceReplacement {
  /** Cụm máy hay nghe ra (khớp trọn cụm, không phân biệt hoa thường). */
  from: string
  to: string
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
/** Chế độ màu của app: tối, sáng, hay theo cài đặt sáng / tối của Windows. */
export type ThemePref = 'dark' | 'light' | 'system'

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
  /** Mục usage tài khoản Claude ở thanh trạng thái (hỏi usage định kỳ bằng tài khoản Claude Code). */
  claudeUsage: boolean
  /** Chế độ màu (Cài đặt → Giao diện). */
  theme: ThemePref
  /** Ô terminal đổi màu theo app; tắt = terminal luôn nền tối, kể cả khi app sáng. */
  terminalFollowTheme: boolean
  /** Ghi theme `light-ansi` / `dark-ansi` của Claude Code vào ~/.claude.json theo màu terminal; tắt = trả lại theme cũ. */
  claudeThemeSync: boolean
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

/**
 * Agent điều khiển app thay bạn (Agent API: tool agent_* trong MCP stag). Ghi đè được theo workspace / agent.
 * agent_list / adapter_models (chỉ đọc) luôn có.
 */
export interface AgentApiSettings {
  /** Tạo / đổi / mở / dừng / xoá agent khác (agent_create, agent_update, agent_open, agent_stop, agent_delete). */
  manage: boolean
  /** Nhắn agent khác (agent_send). */
  message: boolean
  /** Hỏi bạn trước khi agent tạo agent mới. Tắt: vẫn hỏi nếu agent mới có quyền cao hơn agent tạo nó. */
  confirmCreate: boolean
  /** Đọc trạng thái và nhật ký phiên của agent khác (agent_status, agent_log). */
  read: boolean
}

/**
 * Bộ nhớ trong vault (Cài đặt → Vault & bộ nhớ): app tự ghi việc xong vào `40 Log/<ngày>.md` và mục "Work done" của note
 * agent, rồi cất mục cũ sang `60 Agents/<tên> archive.md` khi note quá hạn mức. Ghi đè được theo workspace / agent.
 */
export interface MemorySettings {
  /** Việc xong (task_done, agent_handoff, bạn đánh dấu xong) → một dòng trong `40 Log/<ngày>.md`, mục "Agent work (auto)". */
  workLog: boolean
  /** Việc xong → một dòng trong mục "Work done" của note agent. */
  agentWorkDone: boolean
  /** Hạn mức note agent (KB). Quá thì cất mục "Work done" cũ; vẫn quá thì nhắc agent tự viết gọn ở phiên sau. */
  noteBudgetKb: number
  /** Số dòng "Work done" mới nhất giữ lại trong note khi cất (phần cũ hơn sang archive). */
  keepWorkDone: number
  /** Dời mục đã xong (`- [x]`) cũ trong mục "Open items" của `_INDEX.md` sang `_INDEX archive` khi `_INDEX` quá hạn mức. Theo app → workspace. */
  indexArchive: boolean
  /** Hạn mức `_INDEX.md` (KB). */
  indexBudgetKb: number
  /** Mục đã xong có ngày mới nhất trong vòng chừng này ngày thì vẫn giữ trong `_INDEX`. */
  indexKeepDays: number
  /** Tool memory_* trong MCP stag (agent đọc / tìm / sửa vault qua app): đầy đủ, chỉ đọc, hoặc tắt. */
  agentTools: MemoryToolsMode
}

export const MEMORY_TOOL_MODES = ['full', 'read', 'off'] as const
export type MemoryToolsMode = (typeof MEMORY_TOOL_MODES)[number]

export const NOTE_BUDGET_MIN = 2
export const NOTE_BUDGET_MAX = 64
export const KEEP_WORK_DONE_MIN = 3
export const KEEP_WORK_DONE_MAX = 100
/** Kết quả nút "Dọn ngay" cho `_INDEX.md` của một workspace. */
export interface IndexCleanResult {
  workspaceId: string
  name: string
  /** Số mục đã xong vừa dời sang `_INDEX archive`. */
  moved: number
  /** Cỡ `_INDEX.md` sau khi dọn (KB); null = không có `_INDEX.md`. */
  kb: number | null
  /** Lý do không dọn (tắt ở workspace này, không có `_INDEX.md`, lỗi). */
  skipped?: string
}

export const INDEX_BUDGET_MIN = 4
export const INDEX_BUDGET_MAX = 128
export const INDEX_KEEP_DAYS_MIN = 0
export const INDEX_KEEP_DAYS_MAX = 90

/** Cài đặt cấp app. */
export interface AppSettings {
  general: GeneralSettings
  handoff: HandoffSettings
  adapters: AdaptersSettings
  connectors: ConnectorsSettings
  skills: SkillsSettings
  plugins: PluginsSettings
  scope: ScopeLockSettings
  agentApi: AgentApiSettings
  browser: BrowserSettings
  voice: VoiceSettings
  memory: MemorySettings
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
  agentApi?: Partial<AgentApiSettings>
  /** Trình duyệt: chỉ bật / tắt tool trình duyệt của agent. */
  browser?: { agentTools?: boolean }
  memory?: Partial<MemorySettings>
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
  agentApi?: Partial<AgentApiSettings>
  browser?: Partial<BrowserSettings>
  voice?: Partial<VoiceSettings>
  memory?: Partial<MemorySettings>
}

export type OverrideLevel = 'workspace' | 'agent'

export const DEFAULT_HANDOFF: HandoffSettings = { autoHandoff: true, handoffPercent: 80 }
export const DEFAULT_SCOPE: ScopeLockSettings = { mode: 'ask', guessShell: true, exempt: [] }
export const DEFAULT_AGENT_API: AgentApiSettings = { manage: true, message: true, confirmCreate: true, read: true }
export const DEFAULT_MEMORY: MemorySettings = {
  workLog: true,
  agentWorkDone: true,
  noteBudgetKb: 8,
  keepWorkDone: 15,
  indexArchive: true,
  indexBudgetKb: 12,
  indexKeepDays: 3,
  agentTools: 'full'
}
export const DEFAULT_BROWSER: BrowserSettings = { homePage: '', searchEngine: 'google', agentTools: true, externalPages: 'ask', allowedOrigins: [], keepCookies: false }
export const VOICE_UNLOAD_MAX = 120
export const DEFAULT_VOICE: VoiceSettings = { enabled: true, engine: 'local', hotkey: 'ctrl+space', micId: '', preview: true, unloadMinutes: 5, hotwords: [], workspaceVocab: true, replacements: [], commands: true, aiFix: false, sendCommand: false, global: false, globalHotkey: 'ctrl+shift+space' }
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
  confirmQuitRunning: true,
  claudeUsage: true,
  theme: 'dark',
  terminalFollowTheme: true,
  claudeThemeSync: true
}
const DEFAULT_CLI: CliAdapterSettings = { enabled: true, path: '', model: '', effort: '', defaultPermission: 'default', extraArgs: '', env: '' }
export const DEFAULT_ADAPTERS: AdaptersSettings = {
  claude: DEFAULT_CLI,
  codex: DEFAULT_CLI,
  terminal: { enabled: true, shell: 'powershell' }
}
export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  app: { general: DEFAULT_GENERAL, handoff: DEFAULT_HANDOFF, adapters: DEFAULT_ADAPTERS, connectors: { items: [], inherited: {} }, skills: { toggles: {} }, plugins: { toggles: {} }, scope: DEFAULT_SCOPE, agentApi: DEFAULT_AGENT_API, browser: DEFAULT_BROWSER, voice: DEFAULT_VOICE, memory: DEFAULT_MEMORY },
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
  /** Một dòng tiếng Anh agent viết cho nhật ký việc trong vault (task_done `log`). */
  log?: string
  /** Người dùng đánh dấu xong/bỏ bằng tay (không phải agent báo). */
  manual?: boolean
  /** File agent đã sửa trong lúc việc mở (tương đối so với dự án, '/'), cũng thuộc vùng khoá của việc (xem scope.ts). */
  files?: string[]
  /**
   * Thư mục project của agent lúc nhận việc (tương đối so với thư mục workspace, '/'): `scope` tính từ đây. Thiếu = gốc
   * workspace (agent ở Chung). `files` luôn tính từ gốc workspace.
   */
  base?: string
  /** Project của agent lúc nhận việc (lọc Sản phẩm / Nhật ký theo project). Thiếu = Chung. */
  projectId?: string
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
  /** Chế độ Soi đang bật trên tab. */
  inspect?: boolean
  /** Khung màn hình: desk = cả ô, tab = 820px, mob = 390px. */
  viewport?: 'desk' | 'tab' | 'mob'
  /** Đang xem ảnh bản TRƯỚC của góp ý số này. */
  before?: number
  /** Tab đang chờ dev server mở cổng (Tab mới → "Dùng cái này"); có `error` = không chạy được. */
  dev?: BrowserTabDev
}

export interface BrowserTabDev {
  name: string
  port: number
  /** Lệnh hiển thị (`npm run dev`). */
  command: string
  /** Ô terminal đang chạy lệnh (null = chưa tạo xong). */
  agentId: string | null
  error?: string
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
