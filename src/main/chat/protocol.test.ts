import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { ChatModel, resultText } from './protocol'

const stream = (event: unknown, extra: Record<string, unknown> = {}): unknown => ({ type: 'stream_event', event, ...extra })
const feed = (m: ChatModel, evs: unknown[]): void => {
  for (const e of evs) m.ingest(e)
}
const assistants = (m: ChatModel): Array<Extract<ChatItem, { kind: 'assistant' }>> => m.items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant')

/** Chuỗi sự kiện bắt chước lần chạy thật: thinking rỗng → tool Write xin quyền → kết quả → câu trả lời. */
function writeRun(): unknown[] {
  return [
    { type: 'system', subtype: 'init', session_id: 'S1', model: 'claude-haiku-5-5' },
    { type: 'system', subtype: 'status', status: 'requesting' },
    stream({ type: 'message_start', message: { id: 'msg_A', model: 'claude-haiku-5-5', usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000 } } }),
    stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
    stream({ type: 'content_block_stop', index: 0 }),
    stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Write', input: {} } }),
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path": "a.txt", ' } }),
    stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"content": "x"}' } }),
    { type: 'assistant', message: { id: 'msg_A', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: 'a.txt', content: 'x' } }] } },
    stream({ type: 'content_block_stop', index: 1 }),
    stream({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000 } }),
    stream({ type: 'message_stop' }),
    {
      type: 'control_request',
      request_id: 'REQ1',
      request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'a.txt', content: 'x' }, description: 'a.txt', permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], tool_use_id: 'toolu_1' }
    }
  ]
}

describe('ChatModel — luồng một lượt có xin quyền', () => {
  it('dựng assistant từ stream, bỏ thinking rỗng, parse input tool, rồi xin quyền', () => {
    const m = new ChatModel()
    m.patchState({ phase: 'starting' })
    feed(m, writeRun())
    expect(m.state.sessionId).toBe('S1')
    expect(m.state.model).toBe('claude-haiku-5-5')
    expect(m.state.contextUsed).toBe(3002)
    const [a] = assistants(m)
    expect(a.id).toBe('msg_A')
    expect(a.streaming).toBe(false)
    expect(a.blocks).toHaveLength(1)
    expect(a.blocks[0]).toMatchObject({ type: 'tool', name: 'Write', toolUseId: 'toolu_1', state: 'running', input: { file_path: 'a.txt', content: 'x' } })
    const ask = m.items.find((i) => i.kind === 'ask')
    expect(ask).toMatchObject({ requestId: 'REQ1', tool: 'Write', state: 'pending', canRemember: true, toolUseId: 'toolu_1' })
    expect(m.state.phase).toBe('waiting')
  })

  it('kết quả tool, câu trả lời stream, result đóng lượt', () => {
    const m = new ChatModel()
    feed(m, writeRun())
    m.resolveAsk('REQ1', 'allowed')
    feed(m, [
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'File created', is_error: false }] },
        tool_result_meta: [{ id: 'toolu_1', permission_decision: { decision: 'accept', source: 'user_temporary' } }]
      },
      stream({ type: 'message_start', message: { id: 'msg_B', usage: { input_tokens: 1, cache_read_input_tokens: 4000 } } }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Đã tạo ' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'file.' } }),
      stream({ type: 'content_block_stop', index: 0 }),
      stream({ type: 'message_stop' }),
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 3200, total_cost_usd: 0.0054, modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000 } } }
    ])
    const [a, b] = assistants(m)
    expect(a.blocks[0]).toMatchObject({ type: 'tool', state: 'ok', output: 'File created' })
    expect(b.blocks).toEqual([{ type: 'text', text: 'Đã tạo file.' }])
    expect(b.streaming).toBe(false)
    const turn = m.items.find((i) => i.kind === 'turn')
    expect(turn).toMatchObject({ outcome: 'success', durationMs: 3200, costUsd: 0.0054 })
    expect(m.state).toMatchObject({ phase: 'idle', contextSize: 1000000, costUsd: 0.0054, contextUsed: 4001 })
  })

  it('từ chối: permission_denied + tool_result bị từ chối → denied', () => {
    const m = new ChatModel()
    feed(m, writeRun())
    feed(m, [
      { type: 'system', subtype: 'permission_denied', tool_name: 'Write', tool_use_id: 'toolu_1' },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Claude requested permissions…', is_error: true }] },
        tool_result_meta: [{ id: 'toolu_1', non_execution_kind: 'user-rejected' }]
      }
    ])
    expect(assistants(m)[0].blocks[0]).toMatchObject({ state: 'denied' })
  })
})

describe('ChatModel — chi tiết', () => {
  it('không có stream: dựng từ nhiều sự kiện assistant cùng message.id', () => {
    const m = new ChatModel()
    feed(m, [
      { type: 'assistant', message: { id: 'msg_X', content: [{ type: 'text', text: 'Xin chào' }] } },
      { type: 'assistant', message: { id: 'msg_X', content: [{ type: 'tool_use', id: 't9', name: 'Read', input: { file_path: 'a' } }] } }
    ])
    const [a] = assistants(m)
    expect(a.blocks).toHaveLength(2)
    expect(a.blocks[1]).toMatchObject({ type: 'tool', name: 'Read' })
  })

  it('bỏ qua tin của agent con (parent_tool_use_id)', () => {
    const m = new ChatModel()
    feed(m, [
      { type: 'assistant', parent_tool_use_id: 'task1', message: { id: 'sub', content: [{ type: 'text', text: 'ruột agent con' }] } },
      stream({ type: 'message_start', message: { id: 'sub2' } }, { parent_tool_use_id: 'task1' })
    ])
    expect(m.items).toHaveLength(0)
  })

  it('rate_limit_event → quota 5h / 7d', () => {
    const m = new ChatModel()
    feed(m, [
      { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.25, resetsAt: 100 }, seven_day: { utilization: 0.04, resetsAt: 200 } } } }
    ])
    expect(m.state.quota).toEqual({ fiveHour: { utilization: 0.25, resetsAt: 100 }, sevenDay: { utilization: 0.04, resetsAt: 200 } })
  })

  it('control_cancel_request huỷ thẻ xin quyền; closeAll đóng phần dang dở', () => {
    const m = new ChatModel()
    feed(m, writeRun())
    m.ingest({ type: 'control_cancel_request', request_id: 'REQ1' })
    expect(m.items.find((i) => i.kind === 'ask')).toMatchObject({ state: 'cancelled' })
    const changed = m.closeAll()
    expect(m.state.phase).toBe('off')
    expect(changed.some((i) => i.kind === 'assistant')).toBe(true)
    expect(assistants(m)[0].blocks[0]).toMatchObject({ state: 'error' })
  })

  it('result lỗi do người dùng ngắt → outcome interrupted, không thêm thông báo lỗi', () => {
    const m = new ChatModel()
    m.beginTurn()
    m.ingest({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Request interrupted by user' })
    expect(m.items.find((i) => i.kind === 'turn')).toMatchObject({ outcome: 'interrupted' })
    expect(m.items.some((i) => i.kind === 'notice')).toBe(false)
  })

  it('ngắt chủ động: result lỗi kế tiếp là interrupted', () => {
    const m = new ChatModel()
    m.beginTurn()
    m.markInterrupt()
    m.ingest({ type: 'result', subtype: 'error_during_execution', is_error: true })
    expect(m.items.find((i) => i.kind === 'turn')).toMatchObject({ outcome: 'interrupted' })
    // Cờ chỉ có tác dụng một lần.
    m.beginTurn()
    m.ingest({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' })
    expect(m.items.filter((i) => i.kind === 'turn')[1]).toMatchObject({ outcome: 'error_during_execution' })
  })

  it('output tool dài bị cắt', () => {
    const m = new ChatModel()
    feed(m, [
      { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(30_000) }] } }
    ])
    const b = assistants(m)[0].blocks[0]
    expect(b.type === 'tool' && b.output?.length).toBe(20_000)
    expect(b.type === 'tool' && b.truncated).toBe(true)
  })

  it('resultText ghép mảng khối', () => {
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\n[ảnh]\nb')
  })
})
