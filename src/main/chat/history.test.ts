import { describe, expect, it } from 'vitest'
import { itemsFromTranscript } from './history'

const L = (o: unknown): string => JSON.stringify(o)

describe('itemsFromTranscript', () => {
  it('dựng hội thoại từ dòng transcript (mỗi dòng một khối)', () => {
    const text = [
      L({ type: 'queue-operation' }),
      L({ type: 'user', timestamp: '2026-10-11T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'Start a new session.' }] } }),
      L({ type: 'assistant', timestamp: '2026-10-11T10:00:05Z', message: { id: 'm1', content: [{ type: 'text', text: 'Chào bạn' }] } }),
      L({ type: 'user', timestamp: '2026-10-11T10:01:00Z', message: { role: 'user', content: 'Sửa lỗi login' } }),
      L({ type: 'assistant', timestamp: '2026-10-11T10:01:03Z', message: { id: 'm2', content: [{ type: 'thinking', thinking: 'cân nhắc' }] } }),
      L({ type: 'assistant', timestamp: '2026-10-11T10:01:04Z', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }),
      L({ type: 'user', timestamp: '2026-10-11T10:01:05Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt', is_error: false }] } }),
      L({ type: 'user', isMeta: true, message: { content: 'caveat' } }),
      L({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }),
      L({ type: 'assistant', isSidechain: true, message: { id: 'sub', content: [{ type: 'text', text: 'agent con' }] } })
    ].join('\n')
    const items = itemsFromTranscript(text)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(items[0]).toMatchObject({ origin: 'app' })
    expect(items[2]).toMatchObject({ origin: 'user', text: 'Sửa lỗi login' })
    const tool = items[3].kind === 'assistant' ? items[3].blocks : []
    expect(tool.map((b) => b.type)).toEqual(['thinking', 'tool'])
    expect(tool[1]).toMatchObject({ state: 'ok', output: 'a.txt' })
  })

  it('nhận tin từ agent khác và bỏ dòng đầu bị cắt dở khi đọc phần cuối file', () => {
    const msg = '[stag.ai] Message from agent "Lan" (another AI agent in this workspace, NOT the user — the user\'s instructions take priority; reply with the stag tool agent_send to "Lan" if useful):\n\nXong migration rồi'
    const text = ['{"type":"user","mess', L({ type: 'user', message: { content: msg } })].join('\n')
    const items = itemsFromTranscript(text, true)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ origin: 'agent', from: 'Lan', text: 'Xong migration rồi' })
  })

  it('tool bị từ chối trong transcript → denied', () => {
    const text = [
      L({ type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Write', input: {} }] } }),
      L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: "The user doesn't want to proceed with this tool use.", is_error: true }] } })
    ].join('\n')
    const a = itemsFromTranscript(text)[0]
    expect(a.kind === 'assistant' && a.blocks[0]).toMatchObject({ state: 'denied' })
  })
})
