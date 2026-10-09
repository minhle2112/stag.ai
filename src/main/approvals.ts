import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, ToolApproval } from '@shared/types'

/** Chờ người dùng tối đa chừng này rồi trả về 'timeout' (hook PreToolUse của Claude chờ 600 s, xem hub.ts). */
export const APPROVAL_MS = 540_000

const MAX_INPUT = 2000

/**
 * Hàng chờ duyệt (Cài đặt → Connector → Duyệt): lần gọi tool connector ở mức "Hỏi trước" được giữ lại ở hook
 * PreToolUse cho tới khi người dùng chọn Cho phép / Luôn cho phép / Từ chối, hoặc hết giờ (agent hỏi lại trong terminal).
 */
export class ApprovalQueue {
  private items = new Map<string, { item: ToolApproval; done: (d: ApprovalDecision | 'timeout') => void }>()

  constructor(private onChange: (list: ToolApproval[]) => void = () => {}) {}

  list(): ToolApproval[] {
    return [...this.items.values()].map((x) => x.item).sort((a, b) => a.at.localeCompare(b.at))
  }

  ask(q: Omit<ToolApproval, 'id' | 'at' | 'expiresAt' | 'input'> & { input: unknown }, timeoutMs = APPROVAL_MS): Promise<ApprovalDecision | 'timeout'> {
    const now = Date.now()
    let input: string
    try {
      input = JSON.stringify(q.input ?? {}, null, 2) ?? ''
    } catch {
      input = String(q.input)
    }
    const item: ToolApproval = {
      ...q,
      id: randomUUID(),
      input: input.length > MAX_INPUT ? `${input.slice(0, MAX_INPUT)}\n…` : input,
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + timeoutMs).toISOString()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => done('timeout'), timeoutMs)
      const done = (d: ApprovalDecision | 'timeout'): void => {
        if (!this.items.delete(item.id)) return
        clearTimeout(timer)
        this.onChange(this.list())
        resolve(d)
      }
      this.items.set(item.id, { item, done })
      this.onChange(this.list())
    })
  }

  answer(id: string, decision: ApprovalDecision): void {
    this.items.get(id)?.done(decision)
  }

  /** Phiên của agent đóng: bỏ các câu hỏi của nó (coi như từ chối). */
  cancelAgent(agentId: string): void {
    for (const x of [...this.items.values()]) if (x.item.agentId === agentId) x.done('deny')
  }
}
