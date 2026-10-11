import type { Agent } from '@shared/types'

/** Bảng màu avatar agent (khớp bản thiết kế). Màu chọn theo tên nên một agent luôn cùng màu ở mọi màn hình. */
const PALETTE = ['#e58e5e', '#f2c063', '#7cb6ff', '#c3e88d', '#e879b9', '#c792ea', '#5eead4', '#f08a8a']

export function agentColor(key: string): string {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/**
 * Avatar chữ cái có màu của agent: dùng thống nhất ở Kanban, Artifacts, Nhật ký, bộ nhớ… (một danh tính cho mỗi agent).
 * Truyền `agent` hoặc `name`.
 */
export function AgentAvatar({ agent, name, size = 18 }: { agent?: Pick<Agent, 'name'>; name?: string; size?: number }): React.JSX.Element {
  const n = agent?.name ?? name ?? '?'
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-[5px] font-bold text-[#0b0d10]"
      style={{ width: size, height: size, background: agentColor(n), fontSize: Math.max(10, Math.round(size * 0.58)) }}
    >
      {n.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
