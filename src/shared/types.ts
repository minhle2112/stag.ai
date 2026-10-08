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

export type ObsidianOpenResult =
  | { status: 'opened' }
  | { status: 'needs-register'; vaultPath: string; obsidianInstalled: boolean }

/** Mức tự quyền của Claude Code ('default' = theo cài đặt Claude Code của người dùng). */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan'

/** Agent = danh tính lâu dài trong một workspace. Mỗi lần chạy là một phiên (session) mới. */
export interface Agent {
  id: string
  workspaceId: string
  name: string
  role: string
  permissionMode: PermissionMode
  createdAt: string
  /** Phiên Claude Code gần nhất, để "tiếp tục phiên trước" (--resume). */
  lastSessionId?: string
}

export type SplitDir = 'row' | 'col'

/** Lưới ô của tab Agents: cây chia đôi. 'row' = trái|phải, 'col' = trên/dưới. */
export type LayoutNode =
  | { type: 'leaf'; agentId: string }
  | { type: 'split'; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode }

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

export interface AgentStatus {
  agentId: string
  activity: AgentActivity
  reason?: WaitReason
  /** Tool đang chạy (khi activity = 'working'). */
  tool?: string
  since: string
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
}

export interface BoardSnapshot {
  statuses: AgentStatus[]
  tasks: Task[]
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
