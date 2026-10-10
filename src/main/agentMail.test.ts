import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@shared/types'
import { AgentMail, MAIL_GAP_MS, MAIL_PER_MINUTE, MAIL_QUEUE_MAX, mailReady } from './agentMail'

const T = Date.parse('2026-10-10T10:00:00Z')
const st = (p: Partial<AgentStatus>): AgentStatus => ({ agentId: 'b', activity: 'waiting', reason: 'turn', since: new Date(T - 60_000).toISOString(), ...p })
const item = (fromId: string, at = T, text = 'hi') => ({ fromId, fromName: fromId, text, at })

describe('mailReady', () => {
  it('chỉ khi hết lượt / để lâu, đã chờ đủ, người dùng không gõ, không bàn giao', () => {
    expect(mailReady(st({}), 0, T)).toBe(true)
    expect(mailReady(st({ reason: 'idle' }), 0, T)).toBe(true)
    expect(mailReady(st({ activity: 'working', reason: undefined }), 0, T)).toBe(false)
    expect(mailReady(st({ reason: 'permission' }), 0, T)).toBe(false)
    expect(mailReady(st({ reason: 'question' }), 0, T)).toBe(false)
    expect(mailReady(st({ reason: 'interrupted' }), 0, T)).toBe(false)
    expect(mailReady(st({ since: new Date(T - 1000).toISOString() }), 0, T)).toBe(false)
    expect(mailReady(st({}), T - 2000, T)).toBe(false)
    expect(mailReady(st({ handoff: 'asking' }), 0, T)).toBe(false)
    expect(mailReady(undefined, 0, T)).toBe(false)
  })
})

describe('AgentMail', () => {
  it('gõ lần lượt khi rảnh, nghỉ giữa hai tin', () => {
    const m = new AgentMail()
    expect(m.enqueue('b', item('a', T, '1'))).toBe(1)
    expect(m.enqueue('b', item('a', T, '2'))).toBe(2)
    expect(m.next('b', false, T)).toBeUndefined()
    expect(m.next('b', true, T)?.text).toBe('1')
    expect(m.next('b', true, T + 1000)).toBeUndefined()
    expect(m.next('b', true, T + MAIL_GAP_MS)?.text).toBe('2')
    expect(m.targets()).toEqual([])
  })

  it('giới hạn tin mỗi phút của người gửi và hàng chờ của người nhận', () => {
    const m = new AgentMail()
    for (let i = 0; i < MAIL_QUEUE_MAX; i++) m.enqueue('b', item('x' + i))
    expect(() => m.enqueue('b', item('y'))).toThrow(/undelivered/)
    const n = new AgentMail()
    for (let i = 0; i < MAIL_PER_MINUTE; i++) n.enqueue('t' + i, item('a'))
    expect(() => n.enqueue('z', item('a'))).toThrow(/last minute/)
    expect(n.enqueue('z', item('a', T + 61_000))).toBe(1)
  })

  it('forget bỏ hàng chờ của agent', () => {
    const m = new AgentMail()
    m.enqueue('b', item('a'))
    m.forget('b')
    expect(m.pending('b')).toBe(0)
  })
})

describe('AgentMail.check', () => {
  it('báo lỗi trước khi gửi mà không ghi nhận gì', () => {
    const m = new AgentMail()
    expect(m.check('b', 'a', T)).toBeNull()
    for (let i = 0; i < MAIL_PER_MINUTE; i++) m.enqueue('c' + i, item('a'))
    expect(m.check('b', 'a', T)).toMatch(/in the last minute/)
    expect(m.check('b', 'a', T + 61_000)).toBeNull()
    expect(m.pending('b')).toBe(0)
  })
})
