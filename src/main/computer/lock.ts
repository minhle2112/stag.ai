/**
 * Khoá điều khiển máy: chỉ một agent cầm chuột / bàn phím tại một thời điểm. Tự nhả sau IDLE_MS không thao tác, khi
 * phiên dừng, hoặc khi người dùng bấm Dừng. Thuần logic (đồng hồ truyền vào), có unit test.
 */

export const LOCK_IDLE_MS = 2 * 60_000

export interface LockHolder {
  agentId: string
  agentName: string
  sessionId: string
  workspaceId: string
  /** Lúc lấy khoá / lần thao tác gần nhất (ms). */
  since: number
  last: number
}

export class ComputerLock {
  private holder: LockHolder | null = null

  constructor(
    private now: () => number = Date.now,
    private idleMs = LOCK_IDLE_MS
  ) {}

  /** Người đang giữ (đã bỏ khoá quá hạn). */
  current(): LockHolder | null {
    if (this.holder && this.now() - this.holder.last > this.idleMs) this.holder = null
    return this.holder
  }

  /**
   * Lấy / giữ khoá cho phiên này. Trả `{ ok: true, fresh }` (fresh = vừa lấy, không phải đang giữ), hoặc người khác
   * đang giữ.
   */
  acquire(who: Omit<LockHolder, 'since' | 'last'>): { ok: true; fresh: boolean } | { ok: false; holder: LockHolder } {
    const cur = this.current()
    const t = this.now()
    if (cur && cur.sessionId !== who.sessionId) return { ok: false, holder: cur }
    if (cur) {
      cur.last = t
      return { ok: true, fresh: false }
    }
    this.holder = { ...who, since: t, last: t }
    return { ok: true, fresh: true }
  }

  /** Nhả khoá nếu phiên này (hoặc bất kỳ ai khi không truyền) đang giữ. Trả người vừa nhả. */
  release(sessionId?: string): LockHolder | null {
    const cur = this.current()
    if (!cur || (sessionId && cur.sessionId !== sessionId)) return null
    this.holder = null
    return cur
  }

  /** Ms còn lại tới lúc khoá tự nhả; null = không ai giữ. */
  remainingMs(): number | null {
    const cur = this.current()
    return cur ? Math.max(0, this.idleMs - (this.now() - cur.last)) : null
  }
}
