import type { AgentStatus } from '@shared/types'

export interface StatusView {
  /** Lớp Tailwind cho chấm trạng thái. */
  dot: string
  label: string
  /** Agent đang chờ người dùng (để đếm và tô màu). */
  waiting: boolean
}

const WAIT_LABEL: Record<NonNullable<AgentStatus['reason']>, string> = {
  turn: 'chờ bạn trả lời',
  permission: 'cần bạn duyệt quyền',
  question: 'đang hỏi bạn',
  idle: 'chờ bạn lâu rồi',
  interrupted: 'bạn đã ngắt'
}

/** Trạng thái hiển thị của một agent, dùng chung cho ô terminal và kanban. */
export function statusView(running: boolean, starting: boolean, status: AgentStatus | undefined): StatusView {
  if (starting) return { dot: 'bg-muted animate-pulse', label: 'đang mở phiên', waiting: false }
  if (!running) return { dot: 'bg-muted/50', label: 'phiên đã dừng', waiting: false }
  if (status?.activity === 'starting') return { dot: 'bg-muted animate-pulse', label: 'đang khởi động', waiting: false }
  if (status?.activity === 'waiting')
    return { dot: 'bg-amber-400', label: WAIT_LABEL[status.reason ?? 'turn'], waiting: true }
  return {
    dot: 'bg-emerald-400 animate-pulse',
    label: status?.tool ? `đang chạy ${toolName(status.tool)}` : 'đang làm',
    waiting: false
  }
}

/** "vừa xong", "5 phút", "2 giờ", "3 ngày". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'vừa xong'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} phút`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} giờ`
  return `${Math.round(h / 24)} ngày`
}

/** Ngày địa phương YYYY-MM-DD của một mốc thời gian ISO. */
export function localDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "mcp__stag__task_done" → "stag · task_done". */
function toolName(tool: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]} · ${m[2]}` : tool
}
