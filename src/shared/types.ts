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

export type ObsidianOpenResult =
  | { status: 'opened' }
  | { status: 'needs-register'; vaultPath: string; obsidianInstalled: boolean }
