import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatEntries, parseClaudeLog, parseCodexLog, readTailLines, redact, secretParts, toolSummary, type LogEntry } from './sessionLog'

const j = (o: unknown): string => JSON.stringify(o)
const T = '2026-10-10T09:05:00.000Z'

describe('parseClaudeLog', () => {
  it('lời người dùng / agent, tool (khi xin), lỗi tool luôn có; bỏ subagent, meta, tóm tắt compact, lệnh slash', () => {
    const tools = { tools: true }
    expect(parseClaudeLog(j({ type: 'user', timestamp: T, message: { role: 'user', content: 'Sửa lỗi đăng nhập' } }), tools)).toEqual([
      { at: T, who: 'user', text: 'Sửa lỗi đăng nhập' }
    ])
    const asst = j({
      type: 'assistant',
      timestamp: T,
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'secret thoughts' },
          { type: 'text', text: 'Mình sẽ sửa.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'x' } }
        ]
      }
    })
    expect(parseClaudeLog(asst, tools)).toEqual([
      { at: T, who: 'agent', text: 'Mình sẽ sửa.' },
      { at: T, who: 'tool', text: 'Edit src/a.ts' }
    ])
    expect(parseClaudeLog(asst, { tools: false })).toHaveLength(1)
    const err = j({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'Exit code 1\nFAIL test' }] } })
    expect(parseClaudeLog(err, { tools: false })).toEqual([{ at: '', who: 'error', text: 'Exit code 1\nFAIL test' }])
    const okResult = j({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'big output' }] } })
    expect(parseClaudeLog(okResult, tools)).toEqual([])
    for (const skip of [
      { type: 'user', isSidechain: true, message: { role: 'user', content: 'sub' } },
      { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
      { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
      { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { type: 'system', content: 'x' }
    ])
      expect(parseClaudeLog(j(skip), tools)).toEqual([])
    expect(parseClaudeLog('not json', tools)).toEqual([])
  })
})

describe('parseCodexLog', () => {
  it('tin user / assistant (bỏ tin Codex tự chèn và developer), tool call khi xin', () => {
    const msg = (role: string, text: string): string =>
      j({ timestamp: T, type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } })
    expect(parseCodexLog(msg('user', 'Start a new session.'), { tools: false })).toEqual([{ at: T, who: 'user', text: 'Start a new session.' }])
    expect(parseCodexLog(msg('assistant', 'Chào bạn'), { tools: false })).toEqual([{ at: T, who: 'agent', text: 'Chào bạn' }])
    expect(parseCodexLog(msg('user', '# AGENTS.md instructions for C:\\x\n<INSTRUCTIONS>'), { tools: false })).toEqual([])
    expect(parseCodexLog(msg('user', '<environment_context>\n</environment_context>'), { tools: false })).toEqual([])
    expect(parseCodexLog(msg('developer', 'rules'), { tools: false })).toEqual([])
    const call = j({ timestamp: T, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":"npm test"}' } })
    expect(parseCodexLog(call, { tools: true })).toEqual([{ at: T, who: 'tool', text: 'shell npm test' }])
    expect(parseCodexLog(call, { tools: false })).toEqual([])
    const custom = j({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"ls"})' } })
    expect(parseCodexLog(custom, { tools: true })[0].text).toBe('exec const r = await tools.exec_command({cmd:"ls"})')
    expect(parseCodexLog(j({ type: 'event_msg', payload: { type: 'user_message', message: 'x' } }), { tools: true })).toEqual([])
  })
})

describe('toolSummary / redact', () => {
  it('tool + đối số chính, gọn một dòng', () => {
    expect(toolSummary('Bash', { command: 'npm   test\n-- --run' })).toBe('Bash npm test -- --run')
    expect(toolSummary('mcp__stag__task_list', {})).toBe('mcp__stag__task_list')
  })

  it('che key / token / mật khẩu và giá trị thật trong kho bí mật', () => {
    const t = redact(
      'key sk-ant-api03-abcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz12 Authorization: Bearer abc.def.ghijklmnop API_KEY=hunter2hunter my-own-value-123 max_tokens: 4096',
      ['my-own-value-123']
    )
    expect(t).not.toMatch(/sk-ant|ghp_|abc\.def|hunter2|my-own-value/)
    expect(t).toContain('Bearer [redacted]')
    expect(t).toContain('API_KEY=[redacted]')
    expect(t).toContain('max_tokens: 4096')
  })
})

describe('formatEntries', () => {
  const e = (i: number, who: LogEntry['who'] = 'agent'): LogEntry => ({ at: `2026-10-10T09:${String(i).padStart(2, '0')}:00Z`, who, text: `turn ${i} ${i % 2 ? 'Lỗi' : 'ok'}` })
  const all = Array.from({ length: 30 }, (_, i) => e(i))

  it('lấy N lượt mới nhất, cũ trước, có giờ + người nói', () => {
    const r = formatEntries(all, { last: 3, maxChars: 10_000 })
    expect(r.lines).toEqual(['[09:27 AGENT] turn 27 Lỗi', '[09:28 AGENT] turn 28 ok', '[09:29 AGENT] turn 29 Lỗi'])
    expect(r.skipped).toBe(27)
  })

  it('lọc theo query không phân biệt hoa thường / dấu; giới hạn ký tự giữ lượt mới nhất', () => {
    expect(formatEntries(all, { last: 100, query: 'LOI', maxChars: 10_000 }).lines).toHaveLength(15)
    const r = formatEntries(all, { last: 100, maxChars: 60 })
    expect(r.lines.at(-1)).toContain('turn 29')
    expect(r.lines.length).toBeLessThan(4)
  })
})

describe('readTailLines', () => {
  it('đọc phần cuối file, bỏ dòng đầu bị cắt dở', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag-sessionlog-'))
    const file = join(dir, 't.jsonl')
    await fs.writeFile(file, ['{"a":1}', '{"b":2}', '{"c":3}', ''].join('\n'))
    expect(await readTailLines(file)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
    expect(await readTailLines(file, 12)).toEqual(['{"c":3}'])
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('secretParts', () => {
  it('bí mật OAuth (JSON): che cả token trần bên trong', () => {
    const blob = JSON.stringify({ version: 1, tokens: { access_token: 'at-123456789', refresh_token: 'rt-987654321' }, client: { client_id: 'cid' } })
    const known = secretParts([blob, 'plain-key-123'])
    expect(known).toEqual([blob, 'at-123456789', 'rt-987654321', 'plain-key-123'])
    expect(redact('Authorization uses at-123456789 here', known)).toBe('Authorization uses [redacted] here')
  })
})
