import { describe, expect, it } from 'vitest'
import { SessionTokens } from './sessionTokens'

describe('SessionTokens', () => {
  it('token của phiên → đúng agent / phiên', () => {
    const t = new SessionTokens()
    const a = t.issue('a1', 's1')
    const b = t.issue('a2', 's2')
    expect(a).not.toBe(b)
    expect(t.resolve(`Bearer ${a}`, 'a1')).toEqual({ agentId: 'a1', sessionId: 's1' })
    expect(t.resolve(`Bearer ${b}`)).toEqual({ agentId: 'a2', sessionId: 's2' })
  })

  it('không giả được agent khác bằng header X-Stag-Agent', () => {
    const t = new SessionTokens()
    const a = t.issue('a1', 's1')
    t.issue('a2', 's2')
    expect(t.resolve(`Bearer ${a}`, 'a2')).toBeNull()
  })

  it('sai / thiếu token, hoặc token đã thu hồi → null', () => {
    const t = new SessionTokens()
    const a = t.issue('a1', 's1')
    expect(t.resolve(undefined, 'a1')).toBeNull()
    expect(t.resolve('Bearer nope', 'a1')).toBeNull()
    expect(t.resolve(a, 'a1')).toBeNull()
    t.revoke(a)
    expect(t.resolve(`Bearer ${a}`, 'a1')).toBeNull()
    t.revoke(undefined)
  })

  it('clear thu hồi tất cả', () => {
    const t = new SessionTokens()
    const a = t.issue('a1', 's1')
    t.clear()
    expect(t.resolve(`Bearer ${a}`)).toBeNull()
  })
})
