import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatItem, ChatSnapshot } from '@shared/chat'

// Store ô chat đọc window.stag lúc nạp module: giả lập phần chat của preload.
let emit: (ev: ChatEvent) => void = () => {}
const pending: Array<(s: ChatSnapshot) => void> = []
const stub = {
  chat: {
    onEvent: (cb: (ev: ChatEvent) => void) => {
      emit = cb
      return () => {}
    },
    snapshot: () => new Promise<ChatSnapshot>((res) => pending.push(res)),
    send: async () => {},
    interrupt: async () => {},
    permission: async () => {}
  }
}

let useChat: (typeof import('./chat'))['useChat']
beforeAll(async () => {
  vi.stubGlobal('window', { stag: stub })
  useChat = (await import('./chat')).useChat
})

const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, at: '2026-10-14T00:00:00Z', text, origin: 'user' })
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('useChat.ensure', () => {
  it('snapshot về sau reset của phiên mới thì bị bỏ (A8)', async () => {
    useChat.getState().ensure('a1')
    expect(pending).toHaveLength(1)
    // Phiên mới mở trong lúc main còn đọc transcript cũ.
    emit({ type: 'reset', agentId: 'a1', items: [user('n1', 'mới')], state: { phase: 'idle' } })
    pending.shift()!({ items: [user('o1', 'cũ')], state: { phase: 'off' } })
    await tick()
    const slice = useChat.getState().byAgent.a1
    expect(slice.loaded).toBe(true)
    expect(slice.items.map((i) => i.id)).toEqual(['n1'])
    expect(slice.state.phase).toBe('idle')
  })

  it('không có reset thì áp snapshot', async () => {
    useChat.getState().ensure('a2')
    pending.shift()!({ items: [user('o1', 'cũ')], state: { phase: 'off' } })
    await tick()
    const slice = useChat.getState().byAgent.a2
    expect(slice.loaded).toBe(true)
    expect(slice.items.map((i) => i.id)).toEqual(['o1'])
  })
})
