import type { AgentStatus } from '@shared/types'
import { useHandoffFor } from '../store/settings'
import { contextView } from '../status'

const TONE = {
  normal: 'text-muted',
  warn: 'text-wait',
  full: 'text-danger'
} as const

/** % context của phiên (hoặc số token khi chưa biết kích thước cửa sổ). Chưa có số thì không hiện gì. */
export function ContextBadge({ status, className = '' }: { status: AgentStatus | undefined; className?: string }): React.JSX.Element | null {
  const handoff = useHandoffFor(status?.agentId)
  const v = contextView(status, handoff)
  if (!v) return null
  return (
    <span className={`shrink-0 font-mono text-[11px] tabular-nums ${TONE[v.tone]} ${className}`} title={v.title}>
      ctx {v.text}
      {v.failed && <span className="ml-0.5 text-danger">!</span>}
    </span>
  )
}

/** Nhờ agent bàn giao sang phiên mới ngay (menu ⋯). Lỗi (agent đang làm…) thì báo bằng hộp thoại. */
export async function handoffNow(agentId: string): Promise<void> {
  try {
    await window.stag.agent.handoff(agentId)
  } catch (e) {
    window.alert(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  }
}
