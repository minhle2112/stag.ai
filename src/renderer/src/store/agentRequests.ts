import { create } from 'zustand'
import type { AgentRequest } from '@shared/agentApi'
import { fetchThenListen } from './sync'

interface AgentRequestsState {
  /** Yêu cầu của agent chờ bạn xác nhận (Agent API), cũ nhất trước. */
  list: AgentRequest[]
  answer: (id: string, allow: boolean | 'always') => void
}

export const useAgentRequests = create<AgentRequestsState>((set) => {
  fetchThenListen(window.stag.agent.requests, window.stag.agent.onRequests, (list) => set({ list }))
  return {
    list: [],
    answer(id, allow) {
      set((s) => ({ list: s.list.filter((r) => r.id !== id) }))
      void window.stag.agent.answerRequest(id, allow)
    }
  }
})
