import { describe, expect, it } from 'vitest'
import type { ChatBlock, ChatItem } from '@shared/chat'
import {
  appendText,
  applyEvent,
  checkImage,
  ctxInfo,
  dataUrlToImage,
  emptySlice,
  firstPendingAsk,
  formatCost,
  formatDuration,
  buildRows,
  chatZoom,
  stepsActive,
  stepsSummary,
  historyStep,
  isImeKey,
  jsonEqual,
  nearBottom,
  pushHistory,
  quotaLabel,
  shortModel,
  shouldSubmit,
  showWorking,
  turnLine,
  upsertItem,
  type ChatSlice
} from './chatLogic'

const user = (id: string, text: string, origin: 'user' | 'agent' | 'app' = 'user'): ChatItem => ({ kind: 'user', id, at: 't', text, origin })
const asst = (id: string, blocks: ChatBlock[], streaming = false): ChatItem => ({ kind: 'assistant', id, at: 't', blocks, streaming })
const ask = (id: string, state: 'pending' | 'allowed' = 'pending', tool = 'Bash'): ChatItem => ({
  kind: 'ask',
  id,
  at: 't',
  requestId: `r-${id}`,
  tool,
  input: {},
  canRemember: false,
  state
})

describe('upsertItem', () => {
  it('thêm mục mới ở cuối', () => {
    const a = [user('1', 'a')]
    const out = upsertItem(a, user('2', 'b'))
    expect(out.map((i) => i.id)).toEqual(['1', '2'])
    expect(a).toHaveLength(1)
  })

  it('thay mục cùng id, giữ tham chiếu các mục khác', () => {
    const one = user('1', 'a')
    const two = asst('2', [{ type: 'text', text: 'x' }], true)
    const out = upsertItem([one, two], asst('2', [{ type: 'text', text: 'xy' }]))
    expect(out[0]).toBe(one)
    expect((out[1] as Extract<ChatItem, { kind: 'assistant' }>).blocks).toEqual([{ type: 'text', text: 'xy' }])
    expect(out).toHaveLength(2)
  })
})

describe('applyEvent', () => {
  const state = { phase: 'idle' as const }

  it('reset tạo ô và đánh dấu đã nạp', () => {
    const m = applyEvent({}, { type: 'reset', agentId: 'a', items: [user('1', 'hi')], state })
    expect(m.a.loaded).toBe(true)
    expect(m.a.items).toHaveLength(1)
  })

  it('upsert / state bị bỏ qua khi chưa nạp snapshot (snapshot sẽ phủ lên)', () => {
    const m: Record<string, ChatSlice> = { a: emptySlice() }
    expect(applyEvent(m, { type: 'upsert', agentId: 'a', item: user('1', 'x') })).toBe(m)
    expect(applyEvent(m, { type: 'state', agentId: 'a', state })).toBe(m)
    expect(applyEvent({}, { type: 'upsert', agentId: 'zz', item: user('1', 'x') })).toEqual({})
  })

  it('upsert thay mục và xoá tin xếp hàng khi main phát lại đúng tin đó', () => {
    const m: Record<string, ChatSlice> = { a: { ...emptySlice(), loaded: true, queued: ['làm đi', 'tiếp'] } }
    const out = applyEvent(m, { type: 'upsert', agentId: 'a', item: user('9', ' làm đi ') })
    expect(out.a.queued).toEqual(['tiếp'])
    expect(out.a.items.map((i) => i.id)).toEqual(['9'])
  })

  it('tin của agent / app không xoá hàng đợi', () => {
    const m: Record<string, ChatSlice> = { a: { ...emptySlice(), loaded: true, queued: ['x'] } }
    expect(applyEvent(m, { type: 'upsert', agentId: 'a', item: user('9', 'x', 'agent') }).a.queued).toEqual(['x'])
  })

  it('state: hết bận thì xoá hàng đợi, đang bận thì giữ', () => {
    const m: Record<string, ChatSlice> = { a: { ...emptySlice(), loaded: true, queued: ['x'] } }
    expect(applyEvent(m, { type: 'state', agentId: 'a', state: { phase: 'busy' } }).a.queued).toEqual(['x'])
    expect(applyEvent(m, { type: 'state', agentId: 'a', state: { phase: 'idle' } }).a.queued).toEqual([])
  })
})

describe('buildRows / firstPendingAsk / showWorking', () => {
  const tool = (id: string, state: 'running' | 'ok' | 'error' = 'ok', name = 'Bash', input: unknown = {}): ChatBlock => ({ type: 'tool', toolUseId: id, name, input, state })
  const turn = (id: string): ChatItem => ({ kind: 'turn', id, at: 't', durationMs: 102_000, costUsd: 0.21, outcome: 'success' })
  const types = (rows: ReturnType<typeof buildRows>): string[] => rows.map((r) => r.type)

  it('gom tool + suy nghĩ liên tiếp qua nhiều tin assistant và thẻ xin quyền đã trả lời thành một khối', () => {
    const rows = buildRows(
      [
        user('u', 'làm đi'),
        asst('a1', [{ type: 'thinking', text: 'nghĩ' }, tool('1')]),
        ask('k1', 'allowed'),
        asst('a2', [tool('2', 'ok', 'Edit', { file_path: 'x.ts', old_string: 'a', new_string: 'b' })]),
        asst('a3', [{ type: 'text', text: 'Xong.' }, tool('3')]),
        turn('t')
      ],
      'idle'
    )
    expect(types(rows)).toEqual(['user', 'steps', 'text', 'steps', 'files', 'meta'])
    const s = rows[1].type === 'steps' ? rows[1].entries.map((e) => e.type) : []
    expect(s).toEqual(['thinking', 'tool', 'ask', 'tool'])
    expect(rows[4].type === 'files' && rows[4].tools.map((t) => t.toolUseId)).toEqual(['2'])
    expect(rows[5].type === 'meta' && rows[5].copyText).toBe('Xong.')
  })

  it('thẻ xin quyền đang chờ, thông báo và chữ cắt khối; chữ rỗng thì không', () => {
    const rows = buildRows(
      [asst('a1', [tool('1'), { type: 'text', text: '  ' }, tool('2')]), ask('k', 'pending'), asst('a2', [tool('3', 'running')])],
      'waiting'
    )
    expect(types(rows)).toEqual(['steps', 'ask', 'steps'])
    expect(rows[0].type === 'steps' && rows[0].entries).toHaveLength(2)
  })

  it('tool đang chờ duyệt không nằm trong khối bước (thẻ xin quyền đã hiện nó)', () => {
    const pending: ChatItem = { kind: 'ask', id: 'k', at: 't', requestId: 'r', toolUseId: '2', tool: 'Bash', input: {}, canRemember: false, state: 'pending' }
    const rows = buildRows([asst('a', [tool('1'), { type: 'text', text: 'x' }, tool('2', 'running')]), pending], 'waiting')
    expect(types(rows)).toEqual(['steps', 'text', 'ask'])
  })

  it('lượt đang chạy chưa có thẻ file / meta; dừng giữa chừng thì có (turn = null)', () => {
    const items = [user('u', 'x'), asst('a', [tool('1', 'ok', 'Write', { file_path: 'a.md', content: 'x' }), { type: 'text', text: 'ok' }])]
    expect(types(buildRows(items, 'busy'))).toEqual(['user', 'steps', 'text'])
    const idle = buildRows(items, 'idle')
    expect(types(idle)).toEqual(['user', 'steps', 'text', 'files', 'meta'])
    expect(idle[4].type === 'meta' && idle[4].turn).toBeNull()
  })

  it('tin mới khi lượt trước chưa đóng thì đóng lượt đó; file lỗi không vào thẻ file', () => {
    const rows = buildRows([user('u1', 'a'), asst('a', [tool('1', 'error', 'Edit', { file_path: 'x' }), { type: 'text', text: 'hỏng' }]), user('u2', 'b')], 'idle')
    expect(types(rows)).toEqual(['user', 'steps', 'text', 'meta', 'user'])
  })

  it('assistant đang stream chưa có khối → answering; suy nghĩ đang stream là bước đang chạy', () => {
    expect(types(buildRows([user('u', 'x'), asst('a', [], true)], 'busy'))).toEqual(['user', 'answering'])
    const rows = buildRows([asst('a', [{ type: 'thinking', text: '' }], true)], 'busy')
    expect(rows[0].type === 'steps' && stepsActive(rows[0].entries)).toBe(true)
  })

  it('tóm tắt khối bước: số bước, suy nghĩ, chip không trùng, lỗi, tool đang chạy', () => {
    const rows = buildRows([asst('a', [{ type: 'thinking', text: 'x' }, tool('1'), tool('2', 'error'), tool('3', 'running', 'mcp__stag__task_done')])], 'busy')
    const entries = rows[0].type === 'steps' ? rows[0].entries : []
    const s = stepsSummary(entries)
    expect(s.label).toBe('Đã làm 3 bước · có suy nghĩ')
    expect(s.chips).toEqual(['Bash', 'task_done'])
    expect(s.failed).toBe(1)
    expect(s.running?.toolUseId).toBe('3')
    expect(stepsSummary([{ type: 'thinking', key: 'k', text: 'x', active: false }]).label).toBe('Suy nghĩ')
  })

  it('thẻ xin quyền chờ đầu tiên', () => {
    expect(firstPendingAsk([ask('a', 'allowed'), ask('b'), ask('c')])?.id).toBe('b')
    expect(firstPendingAsk([user('1', 'x')])).toBeUndefined()
  })

  it('dòng "đang làm" chỉ khi bận mà chưa có gì đang chạy', () => {
    expect(showWorking([], 'idle')).toBe(false)
    expect(showWorking([user('1', 'x')], 'busy')).toBe(true)
    expect(showWorking([asst('2', [{ type: 'text', text: 'x' }], true)], 'busy')).toBe(false)
    expect(showWorking([asst('2', [tool('t', 'running')])], 'busy')).toBe(false)
    expect(showWorking([asst('2', [{ type: 'text', text: 'x' }])], 'busy')).toBe(true)
    expect(showWorking([ask('a')], 'waiting')).toBe(false)
  })
})

describe('chatZoom', () => {
  it('theo cỡ chữ terminal; mặc định 13px thì ô chat to hơn một chút', () => {
    expect(chatZoom(12)).toBe(1)
    expect(chatZoom(13)).toBe(1.083)
    expect(chatZoom(18)).toBe(1.5)
    expect(chatZoom(9)).toBe(0.75)
    expect(chatZoom(undefined)).toBe(1.083)
    expect(chatZoom(0)).toBe(1.083)
    expect(chatZoom(Number.NaN)).toBe(1.083)
  })
})

describe('jsonEqual', () => {
  it('so sánh sâu', () => {
    expect(jsonEqual({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(jsonEqual([1], { 0: 1 })).toBe(false)
    expect(jsonEqual(null, {})).toBe(false)
  })
})

describe('shortModel', () => {
  it('rút gọn tên model', () => {
    expect(shortModel('claude-opus-4-5-20251101')).toBe('Opus 4.5')
    expect(shortModel('claude-sonnet-4-5')).toBe('Sonnet 4.5')
    expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(shortModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(shortModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(shortModel('claude-opus-4-1')).toBe('Opus 4.1')
    expect(shortModel('claude-sonnet-4-20250514')).toBe('Sonnet 4')
    expect(shortModel('claude-opus-4-5[1m]')).toBe('Opus 4.5 · 1M')
  })

  it('model lạ giữ nguyên, rỗng thì rỗng', () => {
    expect(shortModel('gpt-x')).toBe('gpt-x')
    expect(shortModel(undefined)).toBe('')
  })
})

describe('định dạng số liệu', () => {
  it('thời lượng', () => {
    expect(formatDuration(0)).toBe('')
    expect(formatDuration(400)).toBe('<1s')
    expect(formatDuration(12_300)).toBe('12s')
    expect(formatDuration(102_000)).toBe('1m 42s')
    expect(formatDuration(3_900_000)).toBe('1h 05m')
  })

  it('chi phí', () => {
    expect(formatCost(undefined)).toBe('')
    expect(formatCost(0)).toBe('')
    expect(formatCost(0.004)).toBe('<$0,01')
    expect(formatCost(0.0312)).toBe('$0,03')
  })

  it('dòng tổng kết lượt', () => {
    expect(turnLine({ durationMs: 12_000, costUsd: 0.03, outcome: 'success' })).toBe('12s · $0,03')
    expect(turnLine({ durationMs: 0, outcome: 'success' })).toBeNull()
    expect(turnLine({ durationMs: 3000, outcome: 'interrupted' })).toBe('đã ngắt · 3s')
    expect(turnLine({ durationMs: 0, outcome: 'error_max_turns' })).toBe('hết lượt')
    expect(turnLine({ durationMs: 0, outcome: 'error_something_odd' })).toBe('something odd')
  })

  it('ctx: phần trăm, màu theo ngưỡng', () => {
    expect(ctxInfo(undefined, 200_000, 85)).toBeNull()
    expect(ctxInfo(84_000, 200_000, 85)).toMatchObject({ text: '42%', tone: 'normal' })
    expect(ctxInfo(160_000, 200_000, 85)).toMatchObject({ text: '80%', tone: 'warn' })
    expect(ctxInfo(180_000, 200_000, 85)).toMatchObject({ text: '90%', tone: 'full' })
    expect(ctxInfo(85_382, undefined, 85)).toMatchObject({ pct: null, text: '85k' })
  })

  it('hạn mức: nhãn + tooltip', () => {
    const now = Date.UTC(2026, 9, 11, 0, 0, 0)
    const q = quotaLabel({ utilization: 0.254, resetsAt: now / 1000 + 90 * 60 }, '5h', now)
    expect(q?.text).toBe('5h 25%')
    expect(q?.title).toContain('1 giờ 30 phút')
    expect(quotaLabel(undefined, '5h')).toBeNull()
  })
})

describe('phím gửi (IME)', () => {
  it('Enter gửi, Shift+Enter không', () => {
    expect(shouldSubmit({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(shouldSubmit({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(shouldSubmit({ key: 'a', shiftKey: false })).toBe(false)
  })

  it('đang gõ IME (isComposing hoặc keyCode 229) thì không bao giờ gửi', () => {
    expect(shouldSubmit({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(shouldSubmit({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false)
    expect(isImeKey({ keyCode: 229 })).toBe(true)
    expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false)
  })
})

describe('lịch sử ↑', () => {
  it('đẩy tin vào lịch sử, bỏ trùng liền kề và tin rỗng', () => {
    let h: string[] = []
    h = pushHistory(h, 'a')
    h = pushHistory(h, 'a')
    h = pushHistory(h, '  ')
    h = pushHistory(h, 'b')
    expect(h).toEqual(['a', 'b'])
  })

  it('giới hạn 50 tin gần nhất', () => {
    let h: string[] = []
    for (let i = 0; i < 60; i++) h = pushHistory(h, `m${i}`)
    expect(h).toHaveLength(50)
    expect(h[0]).toBe('m10')
  })

  it('duyệt lên / xuống và quay về bản nháp', () => {
    const h = ['một', 'hai', 'ba']
    let r = historyStep(h, null, 'up', 'nháp')
    expect(r).toEqual({ index: 2, text: 'ba' })
    r = historyStep(h, r.index, 'up', 'nháp')
    expect(r).toEqual({ index: 1, text: 'hai' })
    r = historyStep(h, 0, 'up', 'nháp')
    expect(r).toEqual({ index: 0, text: 'một' })
    r = historyStep(h, 1, 'down', 'nháp')
    expect(r).toEqual({ index: 2, text: 'ba' })
    r = historyStep(h, 2, 'down', 'nháp')
    expect(r).toEqual({ index: null, text: 'nháp' })
    expect(historyStep(h, null, 'down', 'nháp')).toEqual({ index: null, text: null })
    expect(historyStep([], null, 'up', '')).toEqual({ index: null, text: null })
  })
})

describe('ảnh dán', () => {
  it('kiểm loại, dung lượng, số lượng', () => {
    expect(checkImage({ type: 'image/png', size: 1000 }, 0)).toEqual({ ok: true })
    expect(checkImage({ type: 'image/png', size: 1000 }, 4)).toMatchObject({ ok: false })
    expect(checkImage({ type: 'image/svg+xml', size: 10 }, 0)).toMatchObject({ ok: false })
    expect(checkImage({ type: 'image/jpeg', size: 6 * 1024 * 1024 }, 0)).toMatchObject({ ok: false })
    expect(checkImage({ type: 'image/webp', size: 5 * 1024 * 1024 }, 3)).toEqual({ ok: true })
  })

  it('data URL → ChatImage', () => {
    expect(dataUrlToImage('data:image/png;base64,QUJD')).toEqual({ mediaType: 'image/png', data: 'QUJD' })
    expect(dataUrlToImage('http://x')).toBeNull()
  })
})

describe('appendText / nearBottom', () => {
  it('ghép chữ giọng nói', () => {
    expect(appendText('', 'xin chào')).toBe('xin chào')
    expect(appendText('làm', 'đi')).toBe('làm đi')
    expect(appendText('làm ', 'đi')).toBe('làm đi')
    expect(appendText('làm', '\nđi')).toBe('làm\nđi')
    expect(appendText('x', '')).toBe('x')
  })

  it('cách đáy ≤ 40px là đang ở đáy', () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 })).toBe(true)
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(false)
  })
})
