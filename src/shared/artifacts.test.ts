import { describe, expect, it } from 'vitest'
import {
  anchorLabel,
  assignBlockIds,
  blockDiff,
  dayBucket,
  diffStats,
  inboxOf,
  failureReason,
  initials,
  isDocFile,
  locateQuote,
  plainBlock,
  splitBlocks,
  wordDiff,
  type ArtifactComment,
  type ArtifactRecord,
  type DocBlock
} from './artifacts'

const ids = (): (() => string) => {
  let n = 0
  return () => `b${++n}`
}

describe('splitBlocks', () => {
  it('splits markdown into headings, paragraphs, list items, code, tables, quotes', () => {
    const md = [
      '# Title',
      'Intro line one',
      'intro line two',
      '',
      '- item a',
      '  continued',
      '- item b',
      '  - sub item',
      '1. first',
      '',
      '```ts',
      'const a = 1',
      '',
      'const b = 2',
      '```',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '> quote',
      '> more',
      '---',
      'End.'
    ].join('\r\n')
    expect(splitBlocks(md, true)).toEqual([
      '# Title',
      'Intro line one\nintro line two',
      '- item a\n  continued',
      '- item b',
      '  - sub item',
      '1. first',
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '> quote\n> more',
      '---',
      'End.'
    ])
  })

  it('keeps frontmatter as one block and plain text splits on blank lines', () => {
    expect(splitBlocks('---\na: 1\n---\n# H', true)).toEqual(['---\na: 1\n---', '# H'])
    expect(splitBlocks('a\nb\n\n\nc\n', false)).toEqual(['a\nb', 'c'])
  })

  it('unterminated fence runs to the end', () => {
    expect(splitBlocks('```\ncode\nmore', true)).toEqual(['```\ncode\nmore'])
  })
})

describe('assignBlockIds', () => {
  it('first version gets fresh ids', () => {
    expect(assignBlockIds([], ['# A', 'b'], ids())).toEqual([
      { id: 'b1', text: '# A' },
      { id: 'b2', text: 'b' }
    ])
  })

  it('keeps ids of unchanged and edited blocks, new ids for inserted ones', () => {
    const prev: DocBlock[] = [
      { id: 'h', text: '# Report' },
      { id: 'p', text: 'The archive item is duplicated when the file uses CRLF.' },
      { id: 'x', text: 'Note: not tried on a clean machine.' },
      { id: 'k', text: '## Conclusion' }
    ]
    const next = assignBlockIds(
      prev,
      ['# Report', 'The archive item is duplicated when the file uses CRLF (low, workLog.ts:283).', 'Repro: switch to CRLF, clean twice.', '## Conclusion'],
      () => 'new'
    )
    expect(next.map((b) => b.id)).toEqual(['h', 'p', 'new', 'k'])
  })

  it('does not pair blocks of different kinds', () => {
    const next = assignBlockIds([{ id: 'h', text: '## Results' }], ['Results'], () => 'n')
    expect(next[0].id).toBe('n')
  })
})

describe('blockDiff', () => {
  it('places deleted blocks where they were and marks changes', () => {
    const old: DocBlock[] = [
      { id: 'a', text: 'A' },
      { id: 'x', text: 'X' },
      { id: 'b', text: 'B' }
    ]
    const cur: DocBlock[] = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B2' },
      { id: 'c', text: 'C' }
    ]
    const rows = blockDiff(old, cur)
    expect(rows.map((r) => `${r.kind}:${r.block.id}`)).toEqual(['eq:a', 'del:x', 'chg:b', 'ins:c'])
    expect(diffStats(rows)).toEqual({ add: 1, chg: 1, del: 1 })
  })

  it('deleted first block comes first', () => {
    expect(blockDiff([{ id: 'x', text: 'X' }, { id: 'a', text: 'A' }], [{ id: 'a', text: 'A' }]).map((r) => r.kind)).toEqual(['del', 'eq'])
  })
})

describe('wordDiff', () => {
  it('marks inserted and deleted words', () => {
    const ops = wordDiff('Có thể build bản 0.1.2.', 'Có thể build bản 0.1.2. Sửa lỗi CRLF ở bản sau.')
    expect(ops[0]).toEqual({ op: 'eq', text: 'Có thể build bản 0.1.2.' })
    expect(ops.slice(1).map((o) => o.op)).toEqual(['ins'])
    expect(ops.map((o) => (o.op === 'del' ? '' : o.text)).join('')).toBe('Có thể build bản 0.1.2. Sửa lỗi CRLF ở bản sau.')
  })

  it('rebuilds both sides', () => {
    const a = 'Hỏi mỗi 5 phút.'
    const b = 'Hỏi mỗi 3 phút và ngay khi agent hết lượt.'
    const ops = wordDiff(a, b)
    expect(ops.filter((o) => o.op !== 'ins').map((o) => o.text).join('')).toBe(a)
    expect(ops.filter((o) => o.op !== 'del').map((o) => o.text).join('')).toBe(b)
  })
})

describe('locateQuote', () => {
  const text = 'Mục _INDEX archive bị lặp lại mỗi lần dọn khi file dùng xuống dòng CRLF (mức thấp).'
  it('exact at the stored offset, else nearest occurrence', () => {
    expect(locateQuote(text, { off: 19, quote: 'bị lặp lại' })).toEqual({ mode: 'exact', s: 19, e: 29 })
    expect(locateQuote(text, { off: 0, quote: 'bị lặp lại' })).toEqual({ mode: 'exact', s: 19, e: 29 })
  })
  it('fuzzy on head or tail words when the quote was edited', () => {
    const r = locateQuote(text, { off: 21, quote: 'bị lặp lại mỗi lần dọn khi file dùng xuống dòng CRLF.' })
    expect(r.mode).toBe('fuzzy')
  })
  it('whole block when nothing matches', () => {
    expect(locateQuote('khác hẳn', { off: 0, quote: 'không có chữ này đâu' })).toEqual({ mode: 'whole' })
  })
})

const comment = (over: Partial<ArtifactComment>): ArtifactComment => ({
  id: 'c1',
  v: 1,
  no: 1,
  anchor: { type: 'general' },
  state: 'sent',
  thread: [{ by: 'user', text: 'x', at: '2026-10-12T10:00:00Z' }],
  createdAt: '2026-10-12T10:00:00Z',
  updatedAt: '2026-10-12T10:00:00Z',
  ...over
})

const art = (over: Partial<ArtifactRecord>): ArtifactRecord => ({
  id: 'a1',
  rel: 'docs/r.md',
  title: 'R',
  description: '',
  agentId: 'ag',
  agentName: 'Tester',
  taskId: 't1',
  taskTitle: 'T',
  createdAt: '2026-10-12T09:00:00Z',
  updatedAt: '2026-10-12T09:00:00Z',
  versions: [{ v: 1, at: '2026-10-12T09:00:00Z', note: '', snapshot: '.stag/artifacts/a1/v1.md', size: 1, sha256: 'x', agentId: 'ag', agentName: 'Tester', taskId: 't1' }],
  seen: 1,
  comments: [],
  ...over
})

describe('inboxOf', () => {
  it('lists new versions, questions and fixes; skips quiet and hidden artifacts', () => {
    const v2 = { ...art({}).versions[0], v: 2, note: 'Sửa theo góp ý' }
    const items = inboxOf([
      art({ id: 'quiet' }),
      art({ id: 'hid', hidden: true, seen: 0 }),
      art({ id: 'new', versions: [...art({}).versions, v2] }),
      art({
        id: 'ask',
        comments: [comment({ id: 'c5', state: 'you', thread: [{ by: 'user', text: 'q', at: '' }, { by: 'agent', name: 'Tester', text: 'Giao luôn?', at: '' }], updatedAt: '2026-10-12T11:00:00Z' })]
      }),
      art({ id: 'fix', comments: [comment({ id: 'c7', state: 'fixed', fixedIn: 2 })] })
    ])
    expect(items.map((i) => i.artifactId)).toEqual(['ask', 'fix', 'new'])
    expect(items[0]).toMatchObject({ asks: 1, focus: 'c5', sub: 'Tester: Giao luôn?' })
    expect(items[1]).toMatchObject({ fixed: 1, focus: 'c7', sub: 'Kiểm tra ở v2' })
    expect(items[2]).toMatchObject({ newVersions: 1, focus: null, sub: 'Sửa theo góp ý' })
  })
})

describe('helpers', () => {
  it('dayBucket: tuần này là tuần lịch từ thứ Hai', () => {
    // 15/10/2026 là thứ Năm.
    const thu = new Date(2026, 9, 15, 15, 0)
    const done = (d: number, h = 9): { status: string; createdAt: string; doneAt: string } => ({ status: 'done', createdAt: '', doneAt: new Date(2026, 9, d, h).toISOString() })
    expect(dayBucket({ status: 'open', createdAt: '' }, thu)).toBe('run')
    expect(dayBucket(done(15, 8), thu)).toBe('today')
    expect(dayBucket(done(14, 23), thu)).toBe('yday')
    expect(dayBucket(done(12, 0), thu)).toBe('week')
    expect(dayBucket(done(11, 22), thu)).toBe('older')
    expect(dayBucket({ status: 'dropped', createdAt: new Date(2026, 8, 1).toISOString() }, thu)).toBe('older')
    // Thứ Hai: hôm qua (Chủ nhật) là "hôm qua", thứ Sáu trước đó đã sang "cũ hơn".
    const mon = new Date(2026, 9, 12, 10, 0)
    expect(dayBucket(done(11), mon)).toBe('yday')
    expect(dayBucket(done(9), mon)).toBe('older')
  })
  it('failureReason', () => {
    expect(failureReason('File "x.json" does not exist in the project. Write it first, then publish.')).toBe('file không có trong dự án')
    expect(failureReason('You have no open task in the task list. Call task_start first: …')).toBe('agent chưa mở việc nào (task_start)')
    expect(failureReason('weird')).toMatch(/lỗi khác/)
  })
  it('initials, doc files, plain text, labels', () => {
    expect(initials('Dev Thực Chiến')).toBe('DT')
    expect(initials('Tester')).toBe('TE')
    expect(isDocFile('a/B.MD')).toBe(true)
    expect(isDocFile('x.png')).toBe(false)
    expect(plainBlock('- [x] **Kanban**: `pass` [link](u)')).toBe('Kanban: pass link')
    expect(anchorLabel({ type: 'time', t: 71 })).toBe('at 1:11')
    expect(anchorLabel({ type: 'text', block: 'b', off: 0, quote: 'a '.repeat(60) }, 20)).toMatch(/…"$/)
  })
})
