import { useMemo } from 'react'
import type { AgentStatus } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { useWorkspaces } from '../../store/workspaces'

export interface WaitingAgent {
  wsId: string
  wsName: string
  agentId: string
  agentName: string
  reason: AgentStatus['reason']
}

/** Agent đang chờ người dùng (đang chạy + activity = waiting) ở mọi workspace, theo thứ tự workspace → agent. */
export function useWaitingAgents(): WaitingAgent[] {
  const boards = useBoard((s) => s.byWs)
  const agents = useAgents((s) => s.byWs)
  const workspaces = useWorkspaces((s) => s.items)
  return useMemo(() => {
    const out: WaitingAgent[] = []
    for (const w of workspaces) {
      const a = agents[w.id]
      const b = boards[w.id]
      if (!a || !b) continue
      for (const st of b.statuses) {
        if (st.activity !== 'waiting' || !a.running[st.agentId]) continue
        const agent = a.agents.find((x) => x.id === st.agentId)
        if (agent) out.push({ wsId: w.id, wsName: w.name, agentId: agent.id, agentName: agent.name, reason: st.reason })
      }
    }
    return out
  }, [boards, agents, workspaces])
}
