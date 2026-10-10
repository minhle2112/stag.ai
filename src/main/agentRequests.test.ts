import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRequest } from '@shared/agentApi'
import { AgentRequestQueue } from './agentRequests'

const req = (from = 'a1'): Omit<AgentRequest, 'id' | 'until'> => ({
  workspaceId: 'w1',
  fromAgentId: from,
  fromName: 'Lead',
  action: 'create',
  create: { name: 'Tester', role: '', kind: 'codex', kindLabel: 'Codex', model: null, effort: null, permissionMode: 'default', task: '', open: true }
})

afterEach(() => vi.useRealTimers())

describe('AgentRequestQueue', () => {
  it('đồng ý / từ chối, báo renderer mỗi lần đổi', async () => {
    const notify = vi.fn()
    const q = new AgentRequestQueue(notify)
    const p = q.ask(req())
    expect(q.list()).toHaveLength(1)
    expect(notify).toHaveBeenLastCalledWith([expect.objectContaining({ fromName: 'Lead' })])
    q.answer(q.list()[0].id, true)
    expect(await p).toBe('allow')
    expect(notify).toHaveBeenLastCalledWith([])
    const p2 = q.ask(req())
    q.answer(q.list()[0].id, false)
    expect(await p2).toBe('deny')
  })

  it('hết hạn → timeout; trả lời sau đó không làm gì', async () => {
    vi.useFakeTimers()
    const q = new AgentRequestQueue(() => {})
    const p = q.ask(req(), 1000)
    const id = q.list()[0].id
    vi.advanceTimersByTime(1001)
    expect(await p).toBe('timeout')
    q.answer(id, true)
    expect(q.list()).toEqual([])
  })

  it('phiên agent đóng → bỏ yêu cầu của agent đó', async () => {
    const q = new AgentRequestQueue(() => {})
    const mine = q.ask(req('a1'))
    q.ask(req('a2'))
    q.cancelAgent('a1')
    expect(await mine).toBe('deny')
    expect(q.list().map((r) => r.fromAgentId)).toEqual(['a2'])
  })
})
