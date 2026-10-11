import { promises as fs, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MEMORY, type MemorySettings, type Task, type Workspace } from '@shared/types'
import {
  insertInSection,
  localDate,
  logLine,
  memoryRules,
  MemoryKeeper,
  NoteWriter,
  addToIndexArchive,
  newIndexArchive,
  splitIndexDone,
  splitWorkDone,
  touchUpdated,
  workDoneLine,
  type ClosedTask
} from './workLog'

const task = (o: Partial<Task> = {}): Task => ({
  id: 't1',
  agentId: 'a1',
  agentName: 'Tester',
  sessionId: 's',
  title: 'Sửa lỗi\nđăng nhập',
  scope: 'src/auth/',
  status: 'done',
  createdAt: '2026-10-10T08:00:00.000Z',
  doneAt: '2026-10-10T09:05:00.000Z',
  summary: 'Đã sửa',
  ...o
})

describe('dòng nhật ký', () => {
  it('task_done có log: tên việc một dòng trong ngoặc kép, liên kết agent, giờ, log, phạm vi + file', () => {
    const c: ClosedTask = { task: task({ log: 'Added retry', files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] }), how: 'done' }
    const l = logLine(c)
    expect(l).toMatch(/^- \[x\] "Sửa lỗi đăng nhập" — \[\[Tester\]\] — done \d\d:\d\d — Added retry · scope: src\/auth\/ \+ a\.ts, b\.ts, c\.ts \(\+1\)$/)
    expect(workDoneLine(c)).toBe(`- ${localDate(c.task.doneAt!)} — "Sửa lỗi đăng nhập" — Added retry`)
  })

  it('bàn giao: ghi agent nhận, lấy dòng đầu bản bàn giao làm ghi chú; người dùng đánh dấu xong', () => {
    const h: ClosedTask = { task: task({ summary: 'Handed off to Coder:\n\nGoal: tests\nLeft: x', scope: '' }), how: 'handoff', to: 'Coder' }
    expect(logLine(h)).toMatch(/— \[\[Tester\]\] — handed off to \[\[Coder\]\] \d\d:\d\d — Goal: tests$/)
    expect(workDoneLine(h)).toContain('— handed off to [[Coder]] — Goal: tests')
    expect(logLine({ task: task({ summary: undefined }), how: 'manual' })).toMatch(/— marked done by the user \d\d:\d\d · scope: src\/auth\/$/)
  })
})

describe('insertInSection', () => {
  it('chèn vào cuối mục (trước mục kế tiếp, bỏ qua dòng trống cuối mục)', () => {
    const text = '# Log\n\n## Agent work (auto)\n- one\n\n## Other\n- x\n'
    expect(insertInSection(text, 'Agent work (auto)', ['- two'])).toBe('# Log\n\n## Agent work (auto)\n- one\n- two\n\n## Other\n- x\n')
  })

  it('mục ở cuối file, giữ xuống dòng cuối và kiểu CRLF', () => {
    expect(insertInSection('a\r\n## Work done\r\n- 1\r\n', 'Work done', ['- 2'])).toBe('a\r\n## Work done\r\n- 1\r\n- 2\r\n')
  })

  it('chưa có mục → thêm mục ở cuối file', () => {
    expect(insertInSection('# Log\n\n- [ ] agent line\n\n', 'Agent work (auto)', ['- x'])).toBe('# Log\n\n- [ ] agent line\n\n## Agent work (auto)\n- x\n')
  })

  it('tiêu đề cấp 3 trong mục không cắt mục', () => {
    expect(insertInSection('## Work done\n### old\n- 1\n## Personal notes\n', 'work done', ['- 2'])).toBe('## Work done\n### old\n- 1\n- 2\n## Personal notes\n')
  })
})

describe('touchUpdated / splitWorkDone', () => {
  it('đổi updated trong frontmatter, không đụng phần thân', () => {
    expect(touchUpdated('---\ntype: agent\nupdated: 2026-01-01\n---\nupdated: keep\n', '2026-10-10')).toBe('---\ntype: agent\nupdated: 2026-10-10\n---\nupdated: keep\n')
    expect(touchUpdated('no frontmatter', '2026-10-10')).toBe('no frontmatter')
  })

  it('giữ N mục mới nhất (mục nhiều dòng đi cùng nhau), thêm dòng trỏ sang note cất một lần', () => {
    const note = '# T\n\n## Work done\n- 1\n- 2\n  more of 2\n- 3\n- 4\n\n## Personal notes\n- p\n'
    const r = splitWorkDone(note, 2, 'T archive')
    expect(r.moved).toEqual(['- 1', '- 2\n  more of 2'])
    expect(r.note).toBe('# T\n\n## Work done\nOlder items: [[T archive]]\n- 3\n- 4\n\n## Personal notes\n- p\n')
    const again = splitWorkDone(r.note.replace('- 4', '- 4\n- 5'), 2, 'T archive')
    expect(again.moved).toEqual(['- 3'])
    expect(again.note.match(/Older items/g)).toHaveLength(1)
    expect(splitWorkDone(note, 10, 'T archive')).toEqual({ note, moved: [] })
  })
})

describe('memoryRules', () => {
  it('nói app tự ghi gì; note quá hạn mức thì nhờ agent viết gọn', () => {
    const ok = memoryRules(DEFAULT_MEMORY, { kb: 3, archive: 'T archive' })
    expect(ok).toContain('40 Log/<date>.md')
    expect(ok).toContain('[[T archive]]')
    expect(ok).not.toContain('condense it yourself')
    const over = memoryRules({ ...DEFAULT_MEMORY, workLog: false, agentWorkDone: false }, { kb: 12.5, archive: 'T archive' })
    expect(over).not.toContain('40 Log')
    expect(over).toContain('12.5 KB now, over its 8 KB budget')
  })
})

describe('MemoryKeeper (trên đĩa)', () => {
  let root: string
  let ws: Workspace
  let cfg: MemorySettings
  const vault = (...p: string[]): string => join(ws.vaultPath, ...p)
  const read = (...p: string[]): Promise<string> => fs.readFile(vault(...p), 'utf8')

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'stag-worklog-'))
    ws = { id: 'w', name: 'Demo', path: root, vaultPath: join(root, 'Demo memory'), createdAt: '' }
    await fs.mkdir(vault('60 Agents'), { recursive: true })
    await fs.writeFile(vault('_INDEX.md'), '# idx\n')
    await fs.writeFile(vault('60 Agents', 'Tester.md'), '---\ntype: agent\nupdated: 2026-01-01\n---\n# Tester\n\n## Work done\n- 2026-01-01 — Agent created in stag.ai.\n\n## Personal notes\n- none\n')
    cfg = { ...DEFAULT_MEMORY }
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('việc xong: tạo nhật ký ngày, thêm Work done; gọi lại không ghi trùng', async () => {
    const k = new MemoryKeeper(() => cfg)
    const c: ClosedTask = { task: task({ log: 'Added retry' }), how: 'done' }
    await k.taskClosed(ws, c)
    await k.taskClosed(ws, c)
    const date = localDate(c.task.doneAt!)
    const log = await read('40 Log', `${date}.md`)
    expect(log).toContain(`type: log\ndate: ${date}`)
    expect(log.match(/Added retry/g)).toHaveLength(1)
    const note = await read('60 Agents', 'Tester.md')
    expect(note).toContain(`updated: ${date}`)
    expect(note).toContain(`- ${date} — "Sửa lỗi đăng nhập" — Added retry\n\n## Personal notes`)
    expect(note.match(/Added retry/g)).toHaveLength(1)
  })

  it('nhật ký ngày đã có (agent ghi): chèn vào mục auto, không đụng dòng của agent', async () => {
    const date = localDate(task().doneAt!)
    await fs.mkdir(vault('40 Log'))
    await fs.writeFile(vault('40 Log', `${date}.md`), `# Log\n\n- [x] Agent wrote this\n`)
    await new MemoryKeeper(() => cfg).taskClosed(ws, { task: task(), how: 'manual' })
    const log = await read('40 Log', `${date}.md`)
    expect(log.startsWith('# Log\n\n- [x] Agent wrote this\n\n## Agent work (auto)\n- [x] "Sửa lỗi đăng nhập"')).toBe(true)
  })

  it('tắt trong cài đặt → không ghi; vault không có cấu trúc stag.ai → không tạo 40 Log', async () => {
    cfg = { ...DEFAULT_MEMORY, workLog: false, agentWorkDone: false }
    await new MemoryKeeper(() => cfg).taskClosed(ws, { task: task(), how: 'done' })
    await expect(fs.stat(vault('40 Log'))).rejects.toThrow()
    expect(await read('60 Agents', 'Tester.md')).not.toContain('Sửa lỗi')
    cfg = { ...DEFAULT_MEMORY }
    await fs.rm(vault('_INDEX.md'))
    await new MemoryKeeper(() => cfg).taskClosed(ws, { task: task(), how: 'done' })
    await expect(fs.stat(vault('40 Log'))).rejects.toThrow()
    expect(await read('60 Agents', 'Tester.md')).toContain('Sửa lỗi')
  })

  it('note quá hạn mức → cất Work done cũ sang note cất (cũ trước), giữ N mục mới nhất', async () => {
    cfg = { ...DEFAULT_MEMORY, noteBudgetKb: 2, keepWorkDone: 3 }
    const lines = Array.from({ length: 30 }, (_, i) => `- 2026-01-${String(i + 1).padStart(2, '0')} — "task ${i + 1}" — ${'x'.repeat(60)}`)
    await fs.writeFile(vault('60 Agents', 'Tester.md'), `---\ntype: agent\nupdated: 2026-01-01\n---\n# Tester\n\n## Work done\n${lines.join('\n')}\n\n## Personal notes\n- p\n`)
    const k = new MemoryKeeper(() => cfg)
    const r = await k.compact(ws, 'Tester', cfg)
    expect(r!.kb).toBeLessThan(2)
    const note = await read('60 Agents', 'Tester.md')
    expect(note).toContain('Older items: [[Tester archive]]')
    expect(note).toContain('"task 28"')
    expect(note).not.toContain('"task 27"')
    const archive = await read('60 Agents', 'Tester archive.md')
    expect(archive).toContain('Back to: [[Tester]]')
    expect(archive.indexOf('"task 1"')).toBeLessThan(archive.indexOf('"task 27"'))
    // Lần sau: thêm vào note cất, không tạo lại.
    await fs.writeFile(vault('60 Agents', 'Tester.md'), note.replace('- p', `- p\n${'y'.repeat(3000)}`))
    const r2 = await k.compact(ws, 'Tester', cfg)
    expect(r2!.kb).toBeGreaterThan(2)
    expect(memoryRules(cfg, r2)).toContain('condense it yourself')
  })

  it('ghi note cất hỏng → note agent giữ nguyên, không mất mục Work done nào', async () => {
    cfg = { ...DEFAULT_MEMORY, noteBudgetKb: 2, keepWorkDone: 3 }
    const lines = Array.from({ length: 30 }, (_, i) => `- 2026-01-${String(i + 1).padStart(2, '0')} — "task ${i + 1}" — ${'x'.repeat(60)}`)
    const before = `---\ntype: agent\nupdated: 2026-01-01\n---\n# Tester\n\n## Work done\n${lines.join('\n')}\n`
    await fs.writeFile(vault('60 Agents', 'Tester.md'), before)
    // Chỗ của note cất là một thư mục: ghi vào đó lỗi.
    await fs.mkdir(vault('60 Agents', 'Tester archive.md'))
    await expect(new MemoryKeeper(() => cfg).compact(ws, 'Tester', cfg)).rejects.toThrow()
    expect(await read('60 Agents', 'Tester.md')).toBe(before)
  })

  it('_INDEX quá hạn mức: dời mục đã xong cũ sang 00 Meta/_INDEX archive.md (ghi note cất trước); tắt / chưa quá thì thôi', async () => {
    const old = Array.from({ length: 60 }, (_, i) => `- [x] Done item ${i} (2026-09-01): ${'x'.repeat(60)}`)
    const index = `---\ntype: index\n---\n# INDEX\n\n## Open items\n\n${old.join('\n')}\n- [ ] Still open (2026-09-01)\n- [x] Fresh (2026-10-10)\n`
    await fs.writeFile(vault('_INDEX.md'), index)
    await fs.mkdir(vault('00 Meta'))
    const k = new MemoryKeeper(() => cfg)
    const now = new Date(2026, 9, 11, 12)
    expect(await k.compactIndex(ws, { ...cfg, indexArchive: false }, now)).toBe(0)
    expect(await k.compactIndex(ws, { ...cfg, indexBudgetKb: 64 }, now)).toBe(0)
    expect(await read('_INDEX.md')).toBe(index)
    // Chỗ của note cất là thư mục: ghi lỗi → _INDEX giữ nguyên.
    await fs.mkdir(vault('00 Meta', '_INDEX archive.md'))
    await expect(k.compactIndex(ws, { ...cfg, indexBudgetKb: 4 }, now)).rejects.toThrow()
    expect(await read('_INDEX.md')).toBe(index)
    await fs.rm(vault('00 Meta', '_INDEX archive.md'), { recursive: true })

    expect(await k.compactIndex(ws, { ...cfg, indexBudgetKb: 4 }, now)).toBe(60)
    const after = await read('_INDEX.md')
    expect(after).toContain('Older done items: [[_INDEX archive]]')
    expect(after).toContain('- [ ] Still open (2026-09-01)')
    expect(after).toContain('- [x] Fresh (2026-10-10)')
    expect(after).not.toContain('Done item 0 ')
    const archive = await read('00 Meta', '_INDEX archive.md')
    expect(archive).toContain('Back to: [[_INDEX]]')
    expect(archive.match(/Done item \d+ /g)).toHaveLength(60)
    expect(archive.match(/## 2026-09-01/g)).toHaveLength(1)
  })

  it('việc xong cũng dọn _INDEX (theo cài đặt cấp workspace)', async () => {
    const old = Array.from({ length: 150 }, (_, i) => `- [x] Old ${i} (2026-01-01) ${'y'.repeat(80)}`)
    await fs.writeFile(vault('_INDEX.md'), `# INDEX\n\n## Open items\n${old.join('\n')}\n`)
    const seen: Array<string | null> = []
    await new MemoryKeeper((_ws, agentId) => {
      seen.push(agentId)
      return cfg
    }).taskClosed(ws, { task: task(), how: 'done' })
    expect(seen).toContain(null)
    expect(await read('_INDEX archive.md')).toContain('- [x] Old 149 ')
    expect(await read('_INDEX.md')).not.toContain('- [x] Old 0 ')
  })

  it('đổi tên agent: đổi tên note cất và liên kết hai chiều', async () => {
    await fs.writeFile(vault('60 Agents', 'Tester archive.md'), '# Tester archive\n\nBack to: [[Tester]]\n')
    await fs.writeFile(vault('60 Agents', 'QA.md'), 'Older items: [[Tester archive]]\n')
    await new MemoryKeeper(() => cfg).renameAgent(ws, 'Tester', 'QA')
    expect(await read('60 Agents', 'QA archive.md')).toBe('# QA archive\n\nBack to: [[QA]]\n')
    expect(await read('60 Agents', 'QA.md')).toBe('Older items: [[QA archive]]\n')
  })
})

describe('splitIndexDone / addToIndexArchive', () => {
  const INDEX = [
    '---',
    'type: index',
    '---',
    '# INDEX',
    '',
    '## Map',
    '- [x] not in Open items (2020-01-01)',
    '',
    '## Open items',
    '',
    '- [x] Old done (2026-10-01): done',
    '  - child line of old done',
    '- [ ] Old open (2026-10-01): waiting',
    '- [x] Recent done (2026-10-01): reopened 2026-10-10, done',
    '- [x] No date at all',
    '',
    '- [X] Upper-case done (2026-09-30)',
    'Some free text',
    ''
  ].join('\n')

  it('dời mục [x] cũ (cả dòng con, mục không ngày), giữ [ ], mục mới, chữ khác và mục ngoài Open items', () => {
    const r = splitIndexDone(INDEX, 3, '2026-10-11')
    expect(r.moved).toEqual([
      { date: '2026-10-01', text: '- [x] Old done (2026-10-01): done\n  - child line of old done' },
      { date: null, text: '- [x] No date at all' },
      { date: '2026-09-30', text: '- [X] Upper-case done (2026-09-30)' }
    ])
    expect(r.note).toBe(
      [
        '---',
        'type: index',
        '---',
        '# INDEX',
        '',
        '## Map',
        '- [x] not in Open items (2020-01-01)',
        '',
        '## Open items',
        '',
        'Older done items: [[_INDEX archive]]',
        '',
        '- [ ] Old open (2026-10-01): waiting',
        '- [x] Recent done (2026-10-01): reopened 2026-10-10, done',
        '',
        'Some free text',
        ''
      ].join('\n')
    )
    // Lần sau: dòng trỏ đã có, không thêm lần nữa; không còn gì để dời thì giữ nguyên.
    const again = splitIndexDone(r.note, 3, '2026-10-20')
    expect(again.moved.map((m) => m.date)).toEqual(['2026-10-10'])
    expect(again.note.match(/_INDEX archive/g)).toHaveLength(1)
    expect(splitIndexDone(again.note, 3, '2026-10-20')).toEqual({ note: again.note, moved: [] })
  })

  it('giữ CRLF; không có mục Open items → giữ nguyên', () => {
    const crlf = INDEX.replace(/\n/g, '\r\n')
    expect(splitIndexDone(crlf, 3, '2026-10-11').note).not.toMatch(/[^\r]\n/)
    expect(splitIndexDone('# x\n- [x] a\n', 0, '2026-10-11')).toEqual({ note: '# x\n- [x] a\n', moved: [] })
  })

  it('note cất: nhóm theo ngày (cũ trước, Undated đầu), không trùng', () => {
    const items = [
      { date: '2026-10-05', text: '- [x] B' },
      { date: null, text: '- [x] U' },
      { date: '2026-10-01', text: '- [x] A\n  - a child' }
    ]
    const a = addToIndexArchive(newIndexArchive('2026-10-11'), items, '2026-10-11')!
    const order = ['## Undated', '- [x] U', '## 2026-10-01', '- [x] A', '  - a child', '## 2026-10-05', '- [x] B'].map((s) => a.indexOf(s))
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true)
    expect(addToIndexArchive(a, items, '2026-10-12')).toBeNull()
    const b = addToIndexArchive(a, [{ date: '2026-10-01', text: '- [x] A2' }], '2026-10-12')!
    expect(b.indexOf('- [x] A2')).toBeLessThan(b.indexOf('## 2026-10-05'))
    expect(b).toContain('updated: 2026-10-12')
  })
})

describe('NoteWriter', () => {
  it('file đổi giữa lúc đọc và lúc ghi → đọc lại, không đè thay đổi đó', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'stag-notewriter-'))
    const file = join(dir, 'n.md')
    await fs.writeFile(file, 'a\n')
    let first = true
    await new NoteWriter().update(file, (text) => {
      if (first) {
        first = false
        // Agent sửa file ngay sau lần đọc đầu.
        writeFileSync(file, 'a\nagent edit\n')
      }
      return `${text}app line\n`
    })
    expect(await fs.readFile(file, 'utf8')).toBe('a\nagent edit\napp line\n')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
