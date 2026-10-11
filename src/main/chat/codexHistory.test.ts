import { describe, expect, it } from 'vitest'
import { itemsFromRollout, normalizeRolloutItem } from './codexHistory'

const L = (o: unknown): string => JSON.stringify(o)
const ev = (ts: string, payload: unknown): string => L({ timestamp: ts, type: 'event_msg', payload })
const done = (ts: string, turn: string, item: unknown): string => ev(ts, { type: 'item_completed', thread_id: 'th', turn_id: turn, item })

describe('itemsFromRollout', () => {
  it('dựng hội thoại từ item_completed của rollout (codex 0.162)', () => {
    const text = [
      L({ timestamp: '2026-10-11T20:29:55Z', type: 'session_meta', payload: { id: 'th' } }),
      ev('2026-10-11T20:29:55Z', { type: 'task_started', turn_id: 't1' }),
      L({ timestamp: '2026-10-11T20:29:56Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Start a new session.' }] } }),
      done('2026-10-11T20:29:56Z', 't1', { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'Start a new session.', text_elements: [] }] }),
      done('2026-10-11T20:29:58Z', 't1', { type: 'AgentMessage', id: 'msg_1', content: [{ type: 'Text', text: 'Chào bạn' }], phase: 'commentary' }),
      done('2026-10-11T20:29:59Z', 't1', {
        type: 'CommandExecution',
        id: 'exec-1',
        command: ['C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-Command', 'echo hello'],
        cwd: 'file:///C:/proj',
        parsed_cmd: [{ type: 'unknown', cmd: 'echo hello' }],
        status: 'completed',
        aggregated_output: 'hello\r\n',
        exit_code: 0
      }),
      done('2026-10-11T20:30:00Z', 't1', { type: 'Reasoning', id: 'rs_1', summary_text: [], raw_content: [] }),
      done('2026-10-11T20:30:01Z', 't1', { type: 'McpToolCall', id: 'm1', server: 'stag', tool: 'task_list', arguments: {}, status: 'completed', result: { content: [{ type: 'text', text: 'no task' }] } }),
      done('2026-10-11T20:30:02Z', 't1', { type: 'FileChange', id: 'p1', changes: { 'C:\\proj\\a.txt': { type: 'add', content: 'hello world\n' } }, status: 'completed' }),
      ev('2026-10-11T20:30:03Z', { type: 'task_complete', turn_id: 't1', duration_ms: 7629 }),
      ev('2026-10-11T20:31:00Z', { type: 'task_started', turn_id: 't2' }),
      done('2026-10-11T20:31:00Z', 't2', {
        type: 'UserMessage',
        id: 'u2',
        content: [{ type: 'text', text: '[stag.ai] Message from agent "Lan" (another AI agent):\n\nXong rồi' }]
      }),
      ev('2026-10-11T20:31:02Z', { type: 'turn_aborted', turn_id: 't2', reason: 'interrupted', duration_ms: 1500 })
    ].join('\n')
    const items = itemsFromRollout(text)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'turn', 'user', 'turn'])
    expect(items[0]).toMatchObject({ origin: 'app', text: 'Start a new session.', at: '2026-10-11T20:29:56Z' })
    const blocks = items[1].kind === 'assistant' ? items[1].blocks : []
    expect(blocks.map((b) => (b.type === 'tool' ? b.name : b.type))).toEqual(['text', 'Bash', 'mcp__stag__task_list', 'ApplyPatch'])
    expect(blocks[1]).toMatchObject({ input: { command: 'echo hello', cwd: 'C:/proj' }, state: 'ok', output: 'hello\r\n' })
    expect(blocks[3]).toMatchObject({ input: { changes: [{ path: 'C:\\proj\\a.txt', kind: 'add', diff: 'hello world\n' }] } })
    expect(items[2]).toMatchObject({ durationMs: 7629, outcome: 'success' })
    expect(items[3]).toMatchObject({ origin: 'agent', from: 'Lan', text: 'Xong rồi' })
    expect(items[4]).toMatchObject({ outcome: 'interrupted' })
  })

  it('rollout bản cũ (user_message / agent_message), bỏ dòng đầu cắt dở', () => {
    const text = [
      '{"timestamp":"cắt dở',
      ev('2026-04-13T08:41:36Z', { type: 'user_message', message: 'Sửa lỗi đặt bàn', images: [] }),
      ev('2026-04-13T08:41:44Z', { type: 'agent_message', message: 'Mình xem nhé.' }),
      ev('2026-04-13T08:42:00Z', { type: 'task_complete', duration_ms: 20 })
    ].join('\n')
    const items = itemsFromRollout(text, true)
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'turn'])
    expect(items[0]).toMatchObject({ origin: 'user', text: 'Sửa lỗi đặt bàn' })
  })
})

describe('normalizeRolloutItem', () => {
  it('FileChange dạng mảng (app-server) giữ nguyên', () => {
    const changes = [{ path: 'a', kind: { type: 'update', move_path: null }, diff: '@@' }]
    expect(normalizeRolloutItem({ type: 'FileChange', id: 'x', changes, status: 'completed' })).toEqual({ type: 'fileChange', id: 'x', changes, status: 'completed' })
  })
})
