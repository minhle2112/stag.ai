import { randomBytes } from 'node:crypto'

/** Phiên agent mà một token đại diện. */
export interface SessionIdentity {
  agentId: string
  sessionId: string
}

/**
 * Token riêng của từng phiên agent: cấp lúc mở phiên, thu hồi khi phiên đóng. Người gọi hub là ai lấy theo token,
 * không theo header `X-Stag-Agent` (header chỉ để kiểm tra khớp), nên agent này không giả được agent khác.
 */
export class SessionTokens {
  private byToken = new Map<string, SessionIdentity>()

  issue(agentId: string, sessionId: string): string {
    const token = randomBytes(24).toString('hex')
    this.byToken.set(token, { agentId, sessionId })
    return token
  }

  revoke(token: string | undefined): void {
    if (token) this.byToken.delete(token)
  }

  /**
   * Header `Authorization: Bearer <token>` → phiên; null = không có / sai token, hoặc `X-Stag-Agent` không khớp
   * agent của token. Header agent vắng thì chỉ theo token.
   */
  resolve(authorization: string | undefined, agentHeader?: string): SessionIdentity | null {
    const m = /^Bearer (\S+)$/.exec(authorization ?? '')
    const id = m ? this.byToken.get(m[1]) : undefined
    if (!id) return null
    if (agentHeader && agentHeader !== id.agentId) return null
    return id
  }

  clear(): void {
    this.byToken.clear()
  }
}
