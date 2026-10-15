/**
 * Computer use (agent điều khiển chuột / bàn phím Windows, giống Claude Desktop): kiểu dùng chung main ↔ renderer.
 * Logic chạy ở src/main/computer/.
 */

/** Mức app (theo Claude Desktop): full = mọi thao tác, click = click trái + cuộn, read = chỉ xem, blocked = không xin được. */
export type ComputerTier = 'full' | 'click' | 'read' | 'blocked'
export const COMPUTER_TIERS: readonly ComputerTier[] = ['full', 'click', 'read', 'blocked']

/** Phím dừng toàn hệ thống (Cài đặt → Máy tính). `accel` = accelerator của Electron. */
export const COMPUTER_STOP_HOTKEYS = {
  'ctrl+alt+q': { accel: 'Control+Alt+Q', label: 'Ctrl+Alt+Q' },
  'ctrl+alt+x': { accel: 'Control+Alt+X', label: 'Ctrl+Alt+X' },
  'ctrl+shift+f12': { accel: 'Control+Shift+F12', label: 'Ctrl+Shift+F12' },
  pause: { accel: 'Pause', label: 'Pause' }
} as const
export type ComputerStopHotkey = keyof typeof COMPUTER_STOP_HOTKEYS
export const COMPUTER_STOP_HOTKEY_IDS = Object.keys(COMPUTER_STOP_HOTKEYS) as ComputerStopHotkey[]

/** Cài đặt → Máy tính (cấp app; workspace / agent chỉ ghi đè `agentTools`). */
export interface ComputerSettings {
  /** Cho agent điều khiển máy tính (MCP `computer-use` trong phiên Claude). Mặc định tắt. */
  agentTools: boolean
  stopHotkey: ComputerStopHotkey
  /** Thu nhỏ stag.ai khi agent bắt đầu điều khiển (để không che app). */
  minimizeApp: boolean
  /** Bạn di chuột giữa chừng → agent tạm dừng tới khi bạn bấm Tiếp tục. */
  pauseOnUser: boolean
  /** Mỗi thao tác chuột / phím trả kèm một ảnh chụp sau khi làm. */
  screenshotAfter: boolean
  /** Mức app người dùng đặt (khoá = tên exe thường, vd. `capcut.exe`); vắng = mặc định. */
  tiers: Record<string, ComputerTier>
}

export const DEFAULT_COMPUTER: ComputerSettings = {
  agentTools: false,
  stopHotkey: 'ctrl+alt+q',
  minimizeApp: true,
  pauseOnUser: true,
  screenshotAfter: true,
  tiers: {}
}

/** Vì sao app có mức đó (để giao diện nói rõ). */
export type ComputerTierReason = 'browser' | 'terminal' | 'ide' | 'password' | 'finance' | 'system' | 'self' | 'user' | 'other'

/** Một app trong thẻ hỏi request_access. */
export interface ComputerAppAsk {
  key: string
  displayName: string
  exe?: string
  tier: ComputerTier
  reason: ComputerTierReason
  /** Icon exe (data URL PNG nhỏ), vắng = không có. */
  icon?: string
}

/** Thẻ hỏi computer use: agent xin dùng các app (+ quyền clipboard / tổ hợp hệ thống). */
export interface ComputerAsk {
  reason: string
  apps: ComputerAppAsk[]
  /** Tên agent đưa nhưng không tìm thấy trên máy. */
  unknown: string[]
  clipboardRead: boolean
  clipboardWrite: boolean
  systemKeyCombos: boolean
}

/** Một cửa sổ đang mở (bảng @ trong ô soạn tin, ô Máy tính). */
export interface ComputerWindow {
  id: string
  title: string
  exe: string
  key: string
  displayName: string
  tier: ComputerTier
  reason: ComputerTierReason
  minimized: boolean
  icon?: string
}

/** App đã cấp cho một phiên. */
export interface ComputerGrant {
  key: string
  displayName: string
  tier: ComputerTier
  /** 'always' = nhớ cho agent này (Cài đặt), 'session' = tới khi phiên đóng. */
  scope: 'session' | 'always'
}

export interface ComputerLogLine {
  at: number
  agentName: string
  text: string
  ok: boolean
}

/** Trạng thái gửi renderer (ô Máy tính, chấm thanh tiêu đề). */
export interface ComputerState {
  available: boolean
  error?: string
  holder: { agentId: string; agentName: string; workspaceId: string; sessionId: string; since: number } | null
  paused: boolean
  /** Ảnh agent thấy gần nhất (JPEG data URL nhỏ) + chỗ vừa click (tỉ lệ 0–1 trong ảnh). */
  shot?: { url: string; at: number; display: string; mark?: { x: number; y: number } }
  log: ComputerLogLine[]
  /** App đã cấp theo phiên đang chạy. */
  sessions: Array<{ agentId: string; agentName: string; workspaceId: string; sessionId: string; grants: ComputerGrant[] }>
  hotkey: string
}

/** Kênh IPC của computer use. */
export const CU_IPC = {
  state: 'computer:state',
  getState: 'computer:getState',
  windows: 'computer:windows',
  command: 'computer:command',
  revoke: 'computer:revoke',
  attachWindow: 'computer:attachWindow',
  tierFor: 'computer:tierFor'
} as const

/** Lệnh người dùng từ ô Máy tính / thanh nổi. */
export type ComputerCommand = 'pause' | 'resume' | 'stop'

/** Kết quả gắn một cửa sổ (chọn trong bảng @) vào tin gửi agent. */
export interface ComputerAttach {
  ok: boolean
  error?: string
  /** Dòng ngữ cảnh chèn vào tin (tiếng Anh, cho agent). */
  context?: string
  /** Ảnh cửa sổ (JPEG base64, không có tiền tố data:) để đính kèm; vắng = không chụp được. */
  image?: string
  /** Computer use đang tắt cho agent này. */
  disabled?: boolean
}
