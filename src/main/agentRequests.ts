import { randomUUID } from 'node:crypto'
import type { AgentRequest } from '@shared/agentApi'

export type AgentRequestAnswer = 'allow' | 'deny' | 'timeout'

/** Chờ người dùng xác nhận tối đa chừng này (Codex được đặt tool_timeout_sec dài hơn, xem codex.ts). */
export const AGENT_REQUEST_MS = 280_000

/**
 * Hàng đợi yêu cầu của agent cần người dùng xác nhận trong app (Agent API, vd. tạo agent mới). Mỗi lần đổi thì báo
 * renderer cả danh sách; hết hạn, phiên agent đóng hoặc agent bị xoá → từ chối.
 */
export class AgentRequestQueue {
  private pending = new Map<string, { req: AgentRequest; done: (a: AgentRequestAnswer) => void }>()

  constructor(private notify: (list: AgentRequest[]) => void) {}

  list(): AgentRequest[] {
    return [...this.pending.values()].map((p) => p.req)
  }

  ask(req: Omit<AgentRequest, 'id' | 'until'>, timeoutMs = AGENT_REQUEST_MS): Promise<AgentRequestAnswer> {
    const full: AgentRequest = { ...req, id: randomUUID(), until: new Date(Date.now() + timeoutMs).toISOString() }
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish('timeout'), timeoutMs)
      const finish = (a: AgentRequestAnswer): void => {
        if (!this.pending.delete(full.id)) return
        clearTimeout(timer)
        this.notify(this.list())
        resolve(a)
      }
      this.pending.set(full.id, { req: full, done: finish })
      this.notify(this.list())
    })
  }

  answer(id: string, allow: boolean): void {
    this.pending.get(id)?.done(allow ? 'allow' : 'deny')
  }

  /** Phiên của agent đã xin đóng / agent bị xoá: bỏ các yêu cầu của nó. */
  cancelAgent(agentId: string): void {
    for (const p of [...this.pending.values()]) if (p.req.fromAgentId === agentId) p.done('deny')
  }
}
