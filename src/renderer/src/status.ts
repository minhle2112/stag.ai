import type { AgentKind, AgentStatus, HandoffSettings } from '@shared/types'

/** Lý do chờ người dùng, dạng ngắn ("cần bạn duyệt quyền"). */
export function statusReason(reason: AgentStatus['reason'] | undefined): string {
  return WAIT_LABEL[reason ?? 'turn']
}

/**
 * Dấu trạng thái kiểu Claude desktop (thanh bên): vòng xoay xanh lá = đang chạy, vòng xoay xanh dương = bàn giao,
 * chấm hổ phách = cần bạn, chấm xám = nghỉ / đã dừng, chấm xanh nhạt = terminal thường.
 */
export type StatusMark = 'ok' | 'in' | 'wa' | 'off' | 'tm'

export interface StatusView {
  /** Dấu trạng thái ở thanh bên (xem StatusMark). */
  mark: StatusMark
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
export function statusView(running: boolean, starting: boolean, status: AgentStatus | undefined, kind: AgentKind = 'claude'): StatusView {
  // Terminal thường không có hook: chỉ biết đang mở hay đã đóng.
  if (kind === 'terminal') {
    if (starting) return { mark: 'off', dot: 'bg-muted animate-pulse', label: 'đang mở terminal', waiting: false }
    if (!running) return { mark: 'off', dot: 'bg-muted/50', label: 'terminal đã đóng', waiting: false }
    return { mark: 'tm', dot: 'bg-info/70', label: 'terminal', waiting: false }
  }
  if (starting) return { mark: 'off', dot: 'bg-muted animate-pulse', label: 'đang mở phiên', waiting: false }
  // Bàn giao: phiên cũ đóng rồi mở phiên mới ngay, nên giữ nhãn này cả lúc tiến trình đã thoát.
  if (status?.handoff === 'restarting') return { mark: 'in', dot: 'bg-info animate-pulse', label: 'đang chuyển sang phiên mới', waiting: false }
  if (!running) return { mark: 'off', dot: 'bg-muted/50', label: 'phiên đã dừng', waiting: false }
  // Adapter ngoài không có hook: chỉ biết phiên đang chạy.
  if (kind === 'external' && (!status || status.activity === 'starting')) return { mark: 'ok', dot: 'bg-work/70', label: 'đang chạy', waiting: false }
  if (status?.activity === 'starting') return { mark: 'off', dot: 'bg-muted animate-pulse', label: 'đang khởi động', waiting: false }
  if (status?.handoff === 'asking') return { mark: 'in', dot: 'bg-info animate-pulse', label: 'đang viết bàn giao', waiting: false }
  if (status?.activity === 'waiting')
    return { mark: 'wa', dot: 'bg-wait', label: WAIT_LABEL[status.reason ?? 'turn'], waiting: true }
  return {
    mark: 'ok',
    dot: 'bg-work animate-pulse',
    label: status?.tool ? `đang chạy ${toolName(status.tool)}` : 'đang làm',
    waiting: false
  }
}

export interface ContextView {
  /** "42%" khi biết kích thước cửa sổ, không thì số token ("85k"). */
  text: string
  title: string
  /** 'warn' = còn dưới 10 điểm % nữa là tới ngưỡng bàn giao, 'full' = đã tới ngưỡng. */
  tone: 'normal' | 'warn' | 'full'
  /** Lần tự bàn giao gần nhất trong phiên này không thành. */
  failed: boolean
}

/** 85382 → "85k", 1000000 → "1M", 1250000 → "1.3M". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

/** Độ dài context của phiên để hiện trên ô terminal / thẻ kanban. null = chưa có số. */
export function contextView(status: AgentStatus | undefined, settings: HandoffSettings): ContextView | null {
  const c = status?.context
  if (!c) return null
  const failed = status?.handoff === 'failed'
  const auto = settings.autoHandoff ? `tự bàn giao ở ${settings.handoffPercent}%` : 'tự bàn giao đang tắt'
  const fail = failed ? '\nLần tự bàn giao vừa rồi không thành (agent hết lượt mà chưa bàn giao). Bàn giao tay ở menu ⋯ của agent.' : ''
  if (!c.size) {
    return {
      text: formatTokens(c.used),
      title: `Context: ${c.used.toLocaleString('vi-VN')} token (chưa biết kích thước cửa sổ nên chưa tính được %, chưa tự bàn giao)${fail}`,
      tone: 'normal',
      failed
    }
  }
  const pct = Math.min(100, (c.used / c.size) * 100)
  const limit = settings.handoffPercent
  const tone = settings.autoHandoff && pct >= limit ? 'full' : pct >= limit - 10 ? 'warn' : 'normal'
  return {
    text: `${Math.floor(pct)}%`,
    title: `Context: ${c.used.toLocaleString('vi-VN')} / ${formatTokens(c.size)} token (${pct.toFixed(1)}%) · ${auto}${fail}`,
    tone,
    failed
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
