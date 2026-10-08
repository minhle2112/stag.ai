import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  JsonlTail,
  parseContext,
  parseInterrupt,
  projectDirName,
  TranscriptWatcher,
  transcriptPath,
  type ContextSample,
  type Interrupt
} from './transcript'

// Cấu trúc dòng lấy theo transcript thật của Claude Code (đã bỏ nội dung).
const userLine = (content: unknown, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    type: 'user',
    message: { role: 'user', content },
    uuid: 'u',
    timestamp: '2026-10-08T10:00:00.000Z',
    userType: 'external',
    entrypoint: 'cli',
    version: '2.1.293',
    ...extra
  })

const INTERRUPT = userLine([{ type: 'text', text: '[Request interrupted by user]' }])
const INTERRUPT_TOOL = userLine([{ type: 'text', text: '[Request interrupted by user for tool use]' }])

describe('projectDirName / transcriptPath', () => {
  it('mọi ký tự ngoài chữ và số thành "-"', () => {
    expect(projectDirName('C:\\Users\\piopy\\Desktop\\stag.ai')).toBe('C--Users-piopy-Desktop-stag-ai')
    expect(projectDirName('D:\\dự án\\a_b')).toBe('D--d---n-a-b')
  })

  it('ghép đường dẫn trong ~/.claude/projects', () => {
    const p = transcriptPath('C:\\x\\y.z', 'abc', 'C:\\home')
    expect(p.replace(/\\/g, '/')).toBe('C:/home/.claude/projects/C--x-y-z/abc.jsonl')
  })
})

describe('parseInterrupt', () => {
  it('nhận hai kiểu dòng ngắt', () => {
    expect(parseInterrupt(INTERRUPT)).toEqual({ at: '2026-10-08T10:00:00.000Z', forToolUse: false })
    expect(parseInterrupt(INTERRUPT_TOOL)).toEqual({ at: '2026-10-08T10:00:00.000Z', forToolUse: true })
  })

  it('nhận cả nội dung dạng chuỗi', () => {
    expect(parseInterrupt(userLine('[Request interrupted by user]'))?.forToolUse).toBe(false)
  })

  it('thiếu timestamp thì lấy giờ hiện tại', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } })
    expect(parseInterrupt(line, () => 'NOW')?.at).toBe('NOW')
  })

  it('bỏ qua dòng của subagent, bản tóm tắt compact, dòng meta', () => {
    const c = [{ type: 'text', text: '[Request interrupted by user]' }]
    expect(parseInterrupt(userLine(c, { isSidechain: true, agentId: 'a1' }))).toBeNull()
    expect(parseInterrupt(userLine(c, { isCompactSummary: true }))).toBeNull()
    expect(parseInterrupt(userLine(c, { isMeta: true }))).toBeNull()
  })

  it('bỏ qua chỗ chỉ nhắc tới chuỗi ngắt', () => {
    // Người dùng dán chuỗi vào lời nhắn.
    expect(parseInterrupt(userLine('xem lỗi [Request interrupted by user] này'))).toBeNull()
    // Kết quả tool (vd. grep transcript) có chứa chuỗi.
    expect(
      parseInterrupt(
        userLine([{ type: 'tool_result', tool_use_id: 't', content: '[Request interrupted by user]', is_error: false }])
      )
    ).toBeNull()
    // Lời của assistant.
    const assistant = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '[Request interrupted by user]' }] }
    })
    expect(parseInterrupt(assistant)).toBeNull()
  })

  it('dòng không phải JSON hoặc không liên quan', () => {
    expect(parseInterrupt('[Request interrupted by user]')).toBeNull()
    expect(parseInterrupt('{"type":"user",')).toBeNull()
    expect(parseInterrupt(userLine('xin chào'))).toBeNull()
  })
})

// Dòng assistant / compact_boundary theo transcript thật (Claude Code 2.1.293), đã bỏ nội dung.
const assistantLine = (cacheRead: number, extra: Record<string, unknown> = {}, model = 'claude-opus-5-5'): string =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    type: 'assistant',
    message: {
      model,
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead - 2, output_tokens: 999 }
    },
    timestamp: '2026-10-08T11:00:00.000Z',
    ...extra
  })

const compactLine = (postTokens: number): string =>
  JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    isSidechain: false,
    compactMetadata: { trigger: 'auto', preTokens: 900000, postTokens },
    timestamp: '2026-10-08T12:00:00.000Z'
  })

describe('parseContext', () => {
  it('cộng input + cache tạo + cache đọc, không tính output', () => {
    const line = JSON.stringify({
      type: 'assistant',
      isSidechain: false,
      timestamp: 'T',
      message: { model: 'm', usage: { input_tokens: 2, cache_creation_input_tokens: 4560, cache_read_input_tokens: 80820, output_tokens: 1289 } }
    })
    expect(parseContext(line)).toEqual({ used: 85382, model: 'm', at: 'T' })
  })

  it('dòng compact_boundary cho độ dài sau compact', () => {
    expect(parseContext(compactLine(18700))).toEqual({ used: 18700, model: null, at: '2026-10-08T12:00:00.000Z', compacted: true })
  })

  it('bỏ qua subagent, tin <synthetic>, dòng user, dòng không phải JSON', () => {
    expect(parseContext(assistantLine(5000, { isSidechain: true }))).toBeNull()
    expect(parseContext(assistantLine(5000, {}, '<synthetic>'))).toBeNull()
    expect(parseContext(userLine('"usage" compact_boundary'))).toBeNull()
    expect(parseContext('{"usage": ')).toBeNull()
    expect(parseContext(JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0 } } }))).toBeNull()
  })
})

describe('JsonlTail', () => {
  it('giữ dòng dở dang tới lần sau', () => {
    const t = new JsonlTail()
    expect(t.push(Buffer.from('{"a":1}\n{"b"'))).toEqual(['{"a":1}'])
    expect(t.push(Buffer.from(':2}\n'))).toEqual(['{"b":2}'])
    expect(t.push(Buffer.from('\r\n\n'))).toEqual([])
  })

  it('không làm vỡ ký tự UTF-8 bị cắt giữa hai lần đọc', () => {
    const t = new JsonlTail()
    const bytes = Buffer.from('"việc"\n', 'utf8')
    const cut = bytes.indexOf(0xbb) // giữa chữ "ệ" (e1 bb 87)
    expect(t.push(bytes.subarray(0, cut))).toEqual([])
    expect(t.push(bytes.subarray(cut))).toEqual(['"việc"'])
  })

  it('bỏ hẳn dòng quá dài rồi đọc tiếp bình thường', () => {
    const t = new JsonlTail()
    expect(t.push(Buffer.from('x'.repeat(300 * 1024)))).toEqual([])
    expect(t.push(Buffer.from('y'.repeat(1000)))).toEqual([])
    expect(t.push(Buffer.from(`zzz\n${INTERRUPT}\n`))).toEqual([INTERRUPT])
  })
})

describe('TranscriptWatcher', () => {
  let dir: string
  const watchers: TranscriptWatcher[] = []

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'stag-transcript-'))
  })

  afterEach(async () => {
    for (const w of watchers.splice(0)) w.stop()
    await fs.rm(dir, { recursive: true, force: true })
  })

  const open = async (file: string, got: Interrupt[]): Promise<TranscriptWatcher> => {
    // Chu kỳ dài: test tự gọi poll() cho chắc chắn.
    const w = TranscriptWatcher.open(file, { onInterrupt: (i) => got.push(i) }, 60_000)
    watchers.push(w)
    return w
  }

  it('file chưa có (phiên mới): đọc từ đầu khi file xuất hiện', async () => {
    const file = join(dir, 'new.jsonl')
    const got: Interrupt[] = []
    const w = await open(file, got)
    expect(await w.poll()).toEqual([])
    await fs.writeFile(file, `${userLine('làm việc X')}\n`)
    expect(await w.poll()).toEqual([])
    await fs.appendFile(file, `${INTERRUPT_TOOL}\n`)
    expect(await w.poll()).toHaveLength(1)
    expect(got).toEqual([{ at: '2026-10-08T10:00:00.000Z', forToolUse: true }])
  })

  it('--resume: bỏ qua dòng ngắt cũ, chỉ báo dòng mới', async () => {
    const file = join(dir, 'resume.jsonl')
    await fs.writeFile(file, `${INTERRUPT}\n${userLine('cũ')}\n`)
    const got: Interrupt[] = []
    const w = await open(file, got)
    expect(await w.poll()).toEqual([])
    // Dòng ngắt được ghi làm hai lần (đang ghi dở lúc đọc).
    await fs.appendFile(file, INTERRUPT.slice(0, 40))
    expect(await w.poll()).toEqual([])
    await fs.appendFile(file, `${INTERRUPT.slice(40)}\n`)
    expect(await w.poll()).toHaveLength(1)
    expect(got).toHaveLength(1)
  })

  it('follow: chuyển sang transcript khác, tính từ cuối file đó', async () => {
    const a = join(dir, 'a.jsonl')
    const b = join(dir, 'b.jsonl')
    await fs.writeFile(b, `${INTERRUPT}\n`)
    const got: Interrupt[] = []
    const w = await open(a, got)
    await w.follow(b)
    expect(w.path).toBe(b)
    expect(await w.poll()).toEqual([])
    await fs.appendFile(a, `${INTERRUPT}\n`) // file cũ không còn theo
    await fs.appendFile(b, `${INTERRUPT_TOOL}\n`)
    expect(await w.poll()).toEqual([{ at: '2026-10-08T10:00:00.000Z', forToolUse: true }])
  })

  it('độ dài context: lấy mẫu mới nhất có sẵn khi mở (tiếp tục phiên), rồi mẫu mới nhất của mỗi lần đọc', async () => {
    const file = join(dir, 'ctx.jsonl')
    await fs.writeFile(file, `${assistantLine(1000)}\n${assistantLine(5000)}\n${userLine('x')}\n`)
    const got: ContextSample[] = []
    const w = TranscriptWatcher.open(file, { onContext: (c) => got.push(c) }, 60_000)
    watchers.push(w)
    await vi.waitFor(() => expect(got.map((c) => c.used)).toEqual([5000]))
    await fs.appendFile(file, `${assistantLine(6000)}\n${assistantLine(7000, { isSidechain: true })}\n${assistantLine(8000)}\n`)
    await w.poll()
    expect(got.map((c) => c.used)).toEqual([5000, 8000])
    await fs.appendFile(file, `${compactLine(1200)}\n`)
    await w.poll()
    expect(got.at(-1)).toMatchObject({ used: 1200, compacted: true })
  })

  it('đã stop thì không báo nữa', async () => {
    const file = join(dir, 'stop.jsonl')
    const got: Interrupt[] = []
    const w = await open(file, got)
    w.stop()
    await fs.writeFile(file, `${INTERRUPT}\n`)
    expect(await w.poll()).toEqual([])
    expect(got).toEqual([])
  })
})
