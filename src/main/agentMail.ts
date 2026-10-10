import type { AgentStatus } from '@shared/types'
import { HANDOFF_SETTLE_MS, HANDOFF_TYPING_MS } from './context'

/** Tin nhắn agent gửi agent khác (agent_send), chờ gõ vào terminal của agent nhận. */
export interface MailItem {
  fromId: string
  fromName: string
  text: string
  at: number
}

/** Mỗi agent nhận giữ tối đa chừng này tin chưa gõ. */
export const MAIL_QUEUE_MAX = 5
/** Mỗi agent gửi tối đa chừng này tin trong một phút (chặn hai agent nhắn qua lại không dừng). */
export const MAIL_PER_MINUTE = 6
/** Sau khi gõ một tin, chờ chừng này để hook của lượt mới kịp tới rồi mới xét tin tiếp theo. */
export const MAIL_GAP_MS = 5000

/**
 * Agent nhận có đang rảnh để gõ tin vào không: đang chờ vì hết lượt / để lâu (không phải đang hỏi, xin quyền, bị
 * ngắt), đã chờ đủ lâu, người dùng không vừa gõ phím, và không đang bàn giao (giống handoffDue trong context.ts).
 */
export function mailReady(status: AgentStatus | undefined, lastInputAt: number, now: number): boolean {
  if (!status || status.handoff === 'asking' || status.handoff === 'restarting') return false
  if (status.activity !== 'waiting' || (status.reason !== 'turn' && status.reason !== 'idle')) return false
  if (now - Date.parse(status.since) < HANDOFF_SETTLE_MS) return false
  return now - lastInputAt >= HANDOFF_TYPING_MS
}

/** Hàng chờ tin nhắn giữa agent + giới hạn gửi. Không biết gì về terminal: AgentService quyết định khi nào gõ. */
export class AgentMail {
  private queues = new Map<string, MailItem[]>()
  private sent = new Map<string, number[]>()
  private quietUntil = new Map<string, number>()

  /** Thêm tin; vượt giới hạn thì ném lỗi (tiếng Anh, agent gửi đọc). Trả về số tin đang chờ của agent nhận. */
  enqueue(targetId: string, item: MailItem): number {
    const recent = (this.sent.get(item.fromId) ?? []).filter((t) => item.at - t < 60_000)
    if (recent.length >= MAIL_PER_MINUTE)
      throw new Error(`You sent ${MAIL_PER_MINUTE} messages in the last minute. Wait, and avoid back-and-forth chatter between agents.`)
    const q = this.queues.get(targetId) ?? []
    if (q.length >= MAIL_QUEUE_MAX) throw new Error(`That agent already has ${MAIL_QUEUE_MAX} undelivered messages. Wait until it has read them.`)
    this.sent.set(item.fromId, [...recent, item.at])
    q.push(item)
    this.queues.set(targetId, q)
    return q.length
  }

  /** Tin tiếp theo để gõ cho agent nhận nếu nó rảnh (`ready`) và đã qua khoảng nghỉ sau tin trước. */
  next(targetId: string, ready: boolean, now: number): MailItem | undefined {
    const q = this.queues.get(targetId)
    if (!q?.length || !ready || now < (this.quietUntil.get(targetId) ?? 0)) return undefined
    const item = q.shift()!
    if (!q.length) this.queues.delete(targetId)
    this.quietUntil.set(targetId, now + MAIL_GAP_MS)
    return item
  }

  /** Agent đang có tin chờ gõ. */
  targets(): string[] {
    return [...this.queues.keys()]
  }

  pending(targetId: string): number {
    return this.queues.get(targetId)?.length ?? 0
  }

  /** Agent nhận bị xoá: bỏ tin của nó. */
  forget(agentId: string): void {
    this.queues.delete(agentId)
    this.quietUntil.delete(agentId)
    this.sent.delete(agentId)
  }
}
