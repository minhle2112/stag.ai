import type { AgentStatus } from '@shared/types'
import { useSettings } from '../store/settings'
import { contextView } from '../status'

const TONE = {
  normal: 'text-muted',
  warn: 'text-amber-300',
  full: 'text-red-300'
} as const

/** % context của phiên (hoặc số token khi chưa biết kích thước cửa sổ). Chưa có số thì không hiện gì. */
export function ContextBadge({ status, className = '' }: { status: AgentStatus | undefined; className?: string }): React.JSX.Element | null {
  const settings = useSettings((s) => s.value)
  const v = contextView(status, settings)
  if (!v) return null
  return (
    <span className={`shrink-0 font-mono text-[11px] tabular-nums ${TONE[v.tone]} ${className}`} title={v.title}>
      ctx {v.text}
      {v.failed && <span className="ml-0.5 text-red-300">!</span>}
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
