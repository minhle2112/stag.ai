import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatSession } from './session'

let open: ChatSession[] = []

/** Phiên chat với một tiến trình node đứng chờ; ghi lại những gì app gửi vào stdin. */
function session(): { s: ChatSession; writes: Array<Record<string, unknown>> } {
  const s = new ChatSession({ command: process.execPath, args: ['-e', 'process.stdin.resume()'], cwd: tmpdir(), env: process.env, emit: () => {}, onExit: () => {} })
  const writes: Array<Record<string, unknown>> = []
  ;(s as unknown as { write: (o: Record<string, unknown>) => void }).write = (o) => writes.push(o)
  open.push(s)
  return { s, writes }
}

const ask = {
  type: 'control_request',
  request_id: 'REQ1',
  request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt', content: 'x' }, permission_suggestions: [], tool_use_id: 'toolu_1' }
}

afterEach(() => {
  for (const s of open) s.kill()
  open = []
})

describe('ChatSession: không mở được tiến trình', () => {
  it('hiện thông báo lỗi trong hội thoại', async () => {
    const events: Array<{ type: string; item?: { kind: string; level?: string; text?: string } }> = []
    const exited = new Promise<void>((done) => {
      const s = new ChatSession({ command: 'stag-khong-co-lenh-nay', args: [], cwd: tmpdir(), env: process.env, emit: (e) => events.push(e as never), onExit: () => done() })
      open.push(s)
      s.start([], 'sid')
    })
    await exited
    expect(events.some((e) => e.type === 'upsert' && e.item?.kind === 'notice' && e.item.level === 'error' && /ENOENT/.test(e.item.text ?? ''))).toBe(true)
  })
})

describe('ChatSession.interrupt', () => {
  it('thẻ xin quyền đang chờ: trả lời deny cho Claude trước khi gửi interrupt', () => {
    const { s, writes } = session()
    s.start([], 'sid')
    s.send('làm đi')
    ;(s as unknown as { onLine: (ev: unknown) => void }).onLine(ask)
    expect(s.hasPendingAsk()).toBe(true)
    writes.length = 0
    s.interrupt()
    expect(writes.map((w) => (w.type === 'control_response' ? `res:${(w.response as { request_id: string }).request_id}` : `req:${(w.request as { subtype: string }).subtype}`))).toEqual([
      'res:REQ1',
      'req:interrupt'
    ])
    expect(((writes[0].response as { response: { behavior: string } }).response).behavior).toBe('deny')
    expect(s.hasPendingAsk()).toBe(false)
  })

  it('không có lượt đang chạy: không gửi gì', () => {
    const { s, writes } = session()
    s.start([], 'sid', true)
    s.interrupt()
    expect(writes).toEqual([])
  })
})
