// Hợp đồng dữ liệu của ô chat (Claude Code chạy `-p --input-format stream-json --output-format stream-json`).
// Main giữ danh sách `ChatItem` của từng agent làm nguồn sự thật và đẩy thay đổi sang renderer; renderer chỉ vẽ.
// Quyết định thiết kế: vault `50 Decisions/2026-10-10 Chat-style agent cell postponed to the design phase.md`.

/** Một khối trong tin nhắn của assistant. */
export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | {
      type: 'tool'
      /** id tool_use của Claude (khoá để ghép kết quả và thẻ xin quyền). */
      toolUseId: string
      /** Tên tool: Bash, Read, Edit, Write, Grep, Glob, WebFetch, Task, mcp__stag__task_start… */
      name: string
      /** Tham số tool (đã parse; đang stream thì có thể chưa đủ → {}). */
      input: unknown
      state: 'running' | 'ok' | 'error' | 'denied'
      /** Kết quả (cắt tối đa 20 000 ký tự, xem `truncated`). */
      output?: string
      truncated?: boolean
    }

export type ChatItem =
  | {
      kind: 'user'
      id: string
      at: string
      text: string
      /** Số ảnh đính kèm (chỉ để hiện "+N ảnh"; ảnh không lưu lại trong danh sách). */
      images?: number
      /** 'user' = người dùng gõ; 'agent' = agent khác gửi (agent_send / bàn giao / việc đầu tiên); 'app' = lời mở của app. */
      origin: 'user' | 'agent' | 'app'
      /** origin = 'agent': tên agent gửi. */
      from?: string
    }
  | {
      kind: 'assistant'
      id: string
      at: string
      blocks: ChatBlock[]
      /** Đang stream (chưa có message hoàn chỉnh). */
      streaming?: boolean
      model?: string
    }
  | {
      /** Claude xin quyền chạy một tool (control_request can_use_tool) hoặc app hỏi (khoá phạm vi, connector). */
      kind: 'ask'
      id: string
      at: string
      requestId: string
      toolUseId?: string
      tool: string
      input: unknown
      /** Lý do / mô tả ngắn (đường dẫn file, lệnh…). */
      reason?: string
      /** Gợi ý của Claude kiểu "luôn cho phép trong phiên" (hiện nút Luôn cho phép khi có). */
      canRemember: boolean
      state: 'pending' | 'allowed' | 'denied' | 'cancelled'
    }
  | { kind: 'notice'; id: string; at: string; level: 'info' | 'warn' | 'error'; text: string }
  | {
      /** Dòng tổng kết cuối mỗi lượt (kết quả `result`). */
      kind: 'turn'
      id: string
      at: string
      durationMs: number
      costUsd?: number
      /** 'success' | 'error_during_execution' | 'error_max_turns' | 'interrupted' … */
      outcome: string
    }

export type ChatPhase =
  /** Chưa có tiến trình (chưa mở hoặc đã dừng). */
  | 'off'
  /** Tiến trình đang khởi động, chưa nhận lượt đầu. */
  | 'starting'
  /** Chờ người dùng gõ. */
  | 'idle'
  /** Đang chạy một lượt. */
  | 'busy'
  /** Đang chờ người dùng duyệt một thẻ `ask`. */
  | 'waiting'

export interface ChatQuotaWindow {
  /** 0..1 */
  utilization: number
  /** epoch giây */
  resetsAt: number
}

export interface ChatState {
  phase: ChatPhase
  sessionId?: string
  model?: string
  /** Token context hiện tại / kích thước cửa sổ (từ usage của assistant + modelUsage.contextWindow). */
  contextUsed?: number
  contextSize?: number
  /** Tổng chi phí quy đổi của phiên (USD, chỉ để tham khảo; gói Pro / Max không tính tiền theo token). */
  costUsd?: number
  quota?: { fiveHour?: ChatQuotaWindow; sevenDay?: ChatQuotaWindow }
}

/** main → renderer. */
export type ChatEvent =
  /** Thay toàn bộ danh sách (mở ô, tiếp tục phiên, nạp lịch sử). */
  | { type: 'reset'; agentId: string; items: ChatItem[]; state: ChatState }
  /** Thêm một mục mới hoặc thay mục cùng `id` (stream: cùng id assistant được gửi lại nhiều lần). */
  | { type: 'upsert'; agentId: string; item: ChatItem }
  | { type: 'state'; agentId: string; state: ChatState }

export interface ChatImage {
  /** image/png, image/jpeg, image/gif, image/webp */
  mediaType: string
  /** base64, không có tiền tố data: */
  data: string
}

export interface ChatSendRequest {
  agentId: string
  text: string
  images?: ChatImage[]
}

export interface ChatPermissionAnswer {
  agentId: string
  requestId: string
  behavior: 'allow' | 'deny'
  /** allow + true: áp dụng gợi ý "luôn cho phép" của Claude (permission_suggestions) cho phần còn lại của phiên. */
  remember?: boolean
  /**
   * allow: thay tham số tool bằng bản này. Dùng cho tool AskUserQuestion (trả `{ ...input, answers: { "<câu hỏi>": "<nhãn đã chọn>" } }`)
   * — bỏ trống = giữ nguyên tham số Claude đã gửi.
   */
  updatedInput?: unknown
}

export interface ChatSnapshot {
  items: ChatItem[]
  state: ChatState
}

/** Số ký tự tối đa của output một tool giữ trong danh sách. */
export const CHAT_OUTPUT_MAX = 20_000
