import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { codexAnswer, CodexChatModel, commandText } from './codexProtocol'

type Json = Record<string, unknown>
const T = 'turn-1'
const n = (method: string, params: Json): Json => ({ method, params: { threadId: 'th', ...params } })
const started = (item: Json): Json => n('item/started', { item, turnId: T })
const completed = (item: Json): Json => n('item/completed', { item, turnId: T })
const feed = (m: CodexChatModel, evs: Json[]): void => {
  for (const e of evs) m.ingestCodex(e)
}
const assistants = (m: CodexChatModel): Array<Extract<ChatItem, { kind: 'assistant' }>> =>
  m.items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant')

const PS = '"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command'
const exec = (id: string, script: string, extra: Json = {}): Json => ({
  type: 'commandExecution',
  id,
  command: `${PS} '${script}'`,
  cwd: 'C:\\proj',
  status: 'inProgress',
  commandActions: [{ type: 'unknown', command: script }],
  aggregatedOutput: null,
  exitCode: null,
  ...extra
})

/** Bắt chước lần chạy thật (codex-cli 0.162.0): lời dẫn → lệnh chạy ngay → lệnh xin duyệt → câu trả lời cuối. */
function run(): Json[] {
  return [
    n('turn/started', { turn: { id: T, status: 'inProgress', items: [] } }),
    started({ type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Run echo hello', text_elements: [] }] }),
    started({ type: 'agentMessage', id: 'msg_1', text: '', phase: 'commentary' }),
    n('item/agentMessage/delta', { itemId: 'msg_1', turnId: T, delta: 'Tôi sẽ chạy ' }),
    n('item/agentMessage/delta', { itemId: 'msg_1', turnId: T, delta: '`echo hello`.' }),
    completed({ type: 'agentMessage', id: 'msg_1', text: 'Tôi sẽ chạy `echo hello`.', phase: 'commentary' }),
    started(exec('exec-1', 'echo hello')),
    n('item/commandExecution/outputDelta', { itemId: 'exec-1', turnId: T, delta: 'hello' }),
    n('item/commandExecution/outputDelta', { itemId: 'exec-1', turnId: T, delta: '\r\n' }),
    completed(exec('exec-1', 'echo hello', { status: 'completed', aggregatedOutput: 'hello\r\n', exitCode: 0 })),
    n('thread/tokenUsage/updated', { turnId: T, tokenUsage: { total: { totalTokens: 900 }, last: { totalTokens: 14448 }, modelContextWindow: 258400 } }),
    started({ type: 'reasoning', id: 'rs_1', summary: [], content: [] }),
    completed({ type: 'reasoning', id: 'rs_1', summary: [], content: [] }),
    started(exec('exec-2', "Set-Content a.txt 'hi'")),
    {
      method: 'item/commandExecution/requestApproval',
      id: 0,
      params: {
        threadId: 'th',
        turnId: T,
        itemId: 'exec-2',
        reason: 'May I create a.txt?',
        command: `${PS} "Set-Content a.txt 'hi'"`,
        cwd: 'C:\\proj',
        commandActions: [{ type: 'unknown', command: "Set-Content a.txt 'hi'" }],
        availableDecisions: ['accept', 'acceptForSession', 'cancel']
      }
    }
  ]
}

describe('CodexChatModel — một lượt có xin duyệt lệnh', () => {
  it('gom các item của lượt vào một mục assistant, lệnh hiện script thật, output stream, xin duyệt', () => {
    const m = new CodexChatModel()
    m.askPrefix = 'p-'
    m.patchState({ phase: 'idle' })
    feed(m, run())
    expect(m.turnId).toBe(T)
    expect(m.state).toMatchObject({ phase: 'waiting', contextUsed: 14448, contextSize: 258400 })
    // userMessage không thêm mục (app tự thêm lúc gửi); reasoning rỗng bị bỏ.
    expect(m.items.map((i) => i.kind)).toEqual(['assistant', 'ask'])
    const [a] = assistants(m)
    expect(a.blocks.map((b) => b.type)).toEqual(['text', 'tool', 'tool'])
    expect(a.blocks[0]).toEqual({ type: 'text', text: 'Tôi sẽ chạy `echo hello`.' })
    expect(a.blocks[1]).toMatchObject({ toolUseId: 'exec-1', name: 'Bash', input: { command: 'echo hello' }, state: 'ok', output: 'hello\r\n' })
    expect(a.blocks[2]).toMatchObject({ toolUseId: 'exec-2', state: 'running' })
    // Tool đang chạy: không nháy "đang gõ" (renderer hiện "đang làm…").
    expect(a.streaming).toBe(false)
    const ask = m.items[1]
    expect(ask).toMatchObject({ kind: 'ask', id: 'ask-p-0', requestId: 'p-0', tool: 'Bash', input: { command: "Set-Content a.txt 'hi'" }, reason: 'May I create a.txt?', canRemember: true, state: 'pending' })
  })

  it('khối sau thẻ xin quyền vào mục assistant mới; hết lượt → dòng tổng kết, idle', () => {
    const m = new CodexChatModel()
    m.patchState({ phase: 'idle' })
    feed(m, run())
    m.resolveAsk('0', 'allowed')
    feed(m, [
      completed(exec('exec-2', "Set-Content a.txt 'hi'", { status: 'completed', exitCode: 0 })),
      started({ type: 'agentMessage', id: 'msg_2', text: '', phase: 'final_answer' }),
      n('item/agentMessage/delta', { itemId: 'msg_2', turnId: T, delta: 'done' }),
      completed({ type: 'agentMessage', id: 'msg_2', text: 'done', phase: 'final_answer' }),
      n('turn/completed', { turn: { id: T, status: 'completed', durationMs: 7629, error: null } })
    ])
    expect(m.items.map((i) => i.kind)).toEqual(['assistant', 'ask', 'assistant', 'turn'])
    const [first, second] = assistants(m)
    expect(first.blocks[2]).toMatchObject({ toolUseId: 'exec-2', state: 'ok' })
    expect(second.blocks).toEqual([{ type: 'text', text: 'done' }])
    expect(second.streaming).toBe(false)
    expect(m.items[3]).toMatchObject({ kind: 'turn', durationMs: 7629, outcome: 'success' })
    expect(m.state.phase).toBe('idle')
    expect(m.turnId).toBeUndefined()
  })

  it('ngắt lượt: outcome interrupted, tool dở thành lỗi, thẻ chờ bị huỷ', () => {
    const m = new CodexChatModel()
    m.patchState({ phase: 'idle' })
    feed(m, run())
    m.markInterrupt()
    feed(m, [n('turn/completed', { turn: { id: T, status: 'interrupted', durationMs: 1200, error: null } })])
    expect(m.items.find((i) => i.kind === 'turn')).toMatchObject({ outcome: 'interrupted' })
    expect(m.items.find((i) => i.kind === 'ask')).toMatchObject({ state: 'cancelled' })
    expect(assistants(m)[0].blocks[2]).toMatchObject({ state: 'error' })
  })

  it('serverRequest/resolved huỷ thẻ còn chờ (Codex tự trả lời / lượt bị ngắt)', () => {
    const m = new CodexChatModel()
    m.askPrefix = 'x-'
    m.patchState({ phase: 'idle' })
    feed(m, run())
    const r = m.ingestCodex(n('serverRequest/resolved', { requestId: 0 }))
    expect(r.changed[0]).toMatchObject({ kind: 'ask', state: 'cancelled' })
    expect(m.state.phase).toBe('busy')
  })

  it('suy nghĩ stream (summary) thành khối thinking; lượt lỗi báo thông báo', () => {
    const m = new CodexChatModel()
    m.patchState({ phase: 'idle' })
    feed(m, [
      n('turn/started', { turn: { id: T } }),
      started({ type: 'reasoning', id: 'rs_2', summary: [], content: [] }),
      n('item/reasoning/summaryTextDelta', { itemId: 'rs_2', turnId: T, delta: '**Plan**', summaryIndex: 0 }),
      n('item/reasoning/summaryPartAdded', { itemId: 'rs_2', turnId: T, summaryIndex: 1 }),
      n('item/reasoning/summaryTextDelta', { itemId: 'rs_2', turnId: T, delta: 'step', summaryIndex: 1 }),
      completed({ type: 'reasoning', id: 'rs_2', summary: ['**Plan**', 'step'], content: [] }),
      n('error', { error: { message: 'stream disconnected' }, willRetry: true, turnId: T }),
      n('turn/completed', { turn: { id: T, status: 'failed', durationMs: 50, error: { message: 'Quota exceeded', additionalDetails: null } } })
    ])
    expect(assistants(m)[0].blocks).toEqual([{ type: 'thinking', text: '**Plan**\n\nstep' }])
    const notices = m.items.filter((i) => i.kind === 'notice')
    expect(notices.map((x) => (x.kind === 'notice' ? x.level : ''))).toEqual(['warn', 'error'])
    expect(m.items.find((i) => i.kind === 'turn')).toMatchObject({ outcome: 'error_during_execution' })
  })

  it('fileChange, mcpToolCall, webSearch → tên tool kiểu Claude để thẻ tool vẽ đúng', () => {
    const m = new CodexChatModel()
    feed(m, [
      completed({ type: 'fileChange', id: 'p1', status: 'completed', changes: [{ path: 'C:\\proj\\a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-hi\n+hello\n' }] }),
      completed({ type: 'mcpToolCall', id: 'm1', server: 'stag', tool: 'task_list', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: '- Coder: no task' }] }, error: null }),
      completed({ type: 'mcpToolCall', id: 'm2', server: 'stag', tool: 'task_start', status: 'failed', arguments: { title: 'x' }, result: null, error: { message: 'boom' } }),
      completed({ type: 'webSearch', id: 'w1', query: 'codex app-server', action: null }),
      completed(exec('e9', 'exit 3', { status: 'completed', exitCode: 3, aggregatedOutput: '' }))
    ])
    const blocks = assistants(m)[0].blocks
    expect(blocks[0]).toMatchObject({ name: 'ApplyPatch', input: { changes: [{ path: 'C:\\proj\\a.txt', kind: 'update', diff: '@@ -1 +1 @@\n-hi\n+hello\n' }] }, state: 'ok' })
    expect(blocks[1]).toMatchObject({ name: 'mcp__stag__task_list', state: 'ok', output: '- Coder: no task' })
    expect(blocks[2]).toMatchObject({ name: 'mcp__stag__task_start', state: 'error', output: 'boom' })
    expect(blocks[3]).toMatchObject({ name: 'WebSearch', input: { query: 'codex app-server' } })
    expect(blocks[4]).toMatchObject({ name: 'Bash', state: 'error' })
  })

  it('thẻ xin sửa file lấy nội dung sửa từ khối fileChange; thẻ "declined" → denied', () => {
    const m = new CodexChatModel()
    const change = { type: 'fileChange', id: 'p2', status: 'inProgress', changes: [{ path: 'b.txt', kind: { type: 'add' }, diff: 'x\n' }] }
    feed(m, [started(change), { method: 'item/fileChange/requestApproval', id: 5, params: { threadId: 'th', turnId: T, itemId: 'p2', reason: null, grantRoot: null } }])
    const ask = m.items.find((i) => i.kind === 'ask')
    expect(ask).toMatchObject({ tool: 'ApplyPatch', input: { changes: [{ path: 'b.txt', kind: 'add' }] } })
    feed(m, [completed({ ...change, status: 'declined' })])
    expect(assistants(m)[0].blocks[0]).toMatchObject({ state: 'denied' })
  })

  it('hạn mức: cửa sổ ≤ 6 giờ là "5 giờ", cửa sổ dài là "tuần"', () => {
    const m = new CodexChatModel()
    m.ingestCodex(n('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 100 }, secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 200 } } }))
    expect(m.state.quota).toEqual({ fiveHour: { utilization: 0.3, resetsAt: 100 }, sevenDay: { utilization: 0.05, resetsAt: 200 } })
    m.ingestCodex(n('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 3, windowDurationMins: 43200, resetsAt: 300 }, secondary: null } }))
    expect(m.state.quota).toEqual({ sevenDay: { utilization: 0.03, resetsAt: 300 } })
  })

  it('yêu cầu app không hỗ trợ: trả lời ngay (không treo lượt)', () => {
    const m = new CodexChatModel()
    expect(m.ingestCodex({ method: 'item/tool/call', id: 9, params: {} }).reply).toMatchObject({ rpcId: 9, error: expect.any(String) })
    expect(m.ingestCodex({ method: 'execCommandApproval', id: 10, params: {} }).reply).toEqual({ rpcId: 10, result: { decision: 'denied' } })
    const form = m.ingestCodex({ method: 'mcpServer/elicitation/request', id: 11, params: { serverName: 'x', mode: 'form', message: 'Điền', requestedSchema: {} } })
    expect(form.reply).toMatchObject({ rpcId: 11, result: { action: 'decline' } })
    expect(m.items.some((i) => i.kind === 'ask')).toBe(false)
  })
})

describe('codexAnswer', () => {
  const base = (method: string, params: Json = {}, input: unknown = {}): Parameters<typeof codexAnswer>[0] => ({
    method,
    params,
    item: { kind: 'ask', id: 'a', at: '', requestId: 'r', tool: 't', input, canRemember: true, state: 'pending' }
  })

  it('lệnh / sửa file: accept, acceptForSession (Luôn cho phép), decline', () => {
    expect(codexAnswer(base('item/commandExecution/requestApproval'), 'allow', false)).toEqual({ decision: 'accept' })
    expect(codexAnswer(base('item/fileChange/requestApproval'), 'allow', true)).toEqual({ decision: 'acceptForSession' })
    expect(codexAnswer(base('item/commandExecution/requestApproval'), 'deny', false)).toEqual({ decision: 'decline' })
  })

  it('câu hỏi: nhãn đã chọn theo id câu hỏi', () => {
    const input = { questions: [{ id: 'q1', question: 'Màu?', header: 'Màu', options: [{ label: 'Đỏ' }, { label: 'Xanh' }] }] }
    expect(codexAnswer(base('item/tool/requestUserInput', {}, input), 'allow', false, { ...input, answers: { 'Màu?': 'Xanh' } })).toEqual({ answers: { q1: { answers: ['Xanh'] } } })
    expect(codexAnswer(base('item/tool/requestUserInput', {}, input), 'deny', false)).toEqual({ answers: {} })
  })

  it('thêm quyền: cấp đúng phần được xin, theo lượt hoặc cả phiên', () => {
    const params = { permissions: { network: { enabled: true }, fileSystem: null } }
    expect(codexAnswer(base('item/permissions/requestApproval', params), 'allow', false)).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn' })
    expect(codexAnswer(base('item/permissions/requestApproval', params), 'deny', true)).toEqual({ permissions: {}, scope: 'session' })
  })
})

describe('commandText', () => {
  it('ưu tiên script trong commandActions, rồi tới lệnh (chuỗi hoặc argv)', () => {
    expect(commandText({ command: 'pwsh -c ls', commandActions: [{ command: 'ls' }] })).toBe('ls')
    expect(commandText({ command: 'pwsh -c "a; b"', commandActions: [{ command: 'a' }, { command: 'b' }] })).toBe('pwsh -c "a; b"')
    expect(commandText({ command: ['git', 'status'] })).toBe('git status')
  })
})
