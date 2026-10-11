import { describe, expect, it } from 'vitest'
import {
  answersInput,
  answersOf,
  askHeadline,
  clipLines,
  countLines,
  describeTool,
  diffStats,
  fileChanges,
  lineDiff,
  mergeFileChanges,
  parseMcpName,
  parseQuestions,
  patchRows,
  readRange,
  rememberLabel,
  shortenPath,
  stepName,
  stepResult
} from './toolSummary'

describe('shortenPath', () => {
  it('đổi \\ thành / và bỏ thư mục dự án', () => {
    expect(shortenPath('C:\\Users\\x\\proj\\src\\a.ts', 'C:\\Users\\x\\proj')).toBe('src/a.ts')
    expect(shortenPath('c:/users/x/proj/src/a.ts', 'C:/Users/X/proj/')).toBe('src/a.ts')
    expect(shortenPath('/other/place/a.ts', 'C:/proj')).toBe('/other/place/a.ts')
  })

  it('đường dẫn dài: giữ phần cuối, luôn giữ tên file', () => {
    const p = 'src/renderer/src/components/chat/deeply/nested/folder/ChatCell.tsx'
    const s = shortenPath(p, undefined, 40)
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s.startsWith('…/')).toBe(true)
    expect(s.endsWith('ChatCell.tsx')).toBe(true)
  })

  it('tên file dài hơn giới hạn thì cắt đầu', () => {
    expect(shortenPath('a/' + 'x'.repeat(100), undefined, 20)).toHaveLength(20)
  })
})

describe('clipLines / countLines / readRange', () => {
  it('cắt dòng', () => {
    expect(clipLines('a\nb\nc', 2)).toEqual({ head: 'a\nb', hidden: 1, total: 3 })
    expect(clipLines('a\nb\n', 5)).toEqual({ head: 'a\nb', hidden: 0, total: 2 })
  })

  it('đếm dòng', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('khoảng dòng của Read', () => {
    expect(readRange(12, 50)).toBe('L12–61')
    expect(readRange(12, null)).toBe('từ L12')
    expect(readRange(null, 200)).toBe('200 dòng đầu')
    expect(readRange(null, null)).toBe('')
  })
})

describe('lineDiff', () => {
  it('giữ dòng giống nhau làm ngữ cảnh, chỉ đánh dấu phần đổi', () => {
    const rows = lineDiff('a\nb\nc', 'a\nB\nc')
    expect(rows).toEqual([
      { t: ' ', s: 'a' },
      { t: '-', s: 'b' },
      { t: '+', s: 'B' },
      { t: ' ', s: 'c' }
    ])
    expect(diffStats(rows)).toEqual({ add: 1, del: 1 })
  })

  it('chèn / xoá thuần', () => {
    expect(lineDiff('', 'x\ny')).toEqual([
      { t: '+', s: 'x' },
      { t: '+', s: 'y' }
    ])
    expect(diffStats(lineDiff('x\ny', ''))).toEqual({ add: 0, del: 2 })
  })

  it('LCS tìm ra dòng chung nằm giữa', () => {
    const rows = lineDiff('1\n2\n3\n4', '2\nX\n4')
    expect(diffStats(rows)).toEqual({ add: 1, del: 2 })
    expect(rows.filter((r) => r.t === ' ').map((r) => r.s)).toEqual(['2', '4'])
  })

  it('khối rất lớn: bỏ LCS, hiện cả cũ rồi cả mới (không treo)', () => {
    const a = Array.from({ length: 500 }, (_, i) => `a${i}`).join('\n')
    const b = Array.from({ length: 500 }, (_, i) => `b${i}`).join('\n')
    const rows = lineDiff(a, b)
    expect(diffStats(rows)).toEqual({ add: 500, del: 500 })
  })
})

describe('describeTool', () => {
  it('Bash: dòng đầu của lệnh', () => {
    const v = describeTool('Bash', { command: '\n  npm test -- --run\nsecond', description: 'Chạy test' })
    expect(v.summary).toBe('npm test -- --run')
    expect(v.detail).toMatchObject({ kind: 'bash', description: 'Chạy test' })
    expect(v.label).toBe('Chạy lệnh')
  })

  it('Read: đường dẫn rút gọn + khoảng dòng', () => {
    const v = describeTool('Read', { file_path: 'C:\\p\\src\\a.ts', offset: 10, limit: 20 }, { root: 'C:/p' })
    expect(v.summary).toBe('src/a.ts · L10–29')
  })

  it('Edit: diff + số liệu', () => {
    const v = describeTool('Edit', { file_path: '/p/a.ts', old_string: 'const a = 1', new_string: 'const a = 2\nconst b = 3' })
    expect(v.stats).toEqual({ add: 2, del: 1 })
    expect(v.detail).toMatchObject({ kind: 'edit', edits: 1, replaceAll: false })
  })

  it('MultiEdit: ngăn giữa các chỗ sửa', () => {
    const v = describeTool('MultiEdit', {
      file_path: '/p/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd', replace_all: true }
      ]
    })
    expect(v.detail.kind === 'edit' && v.detail.rows.some((r) => r.t === '~')).toBe(true)
    expect(v.detail).toMatchObject({ edits: 2, replaceAll: true })
    expect(v.stats).toEqual({ add: 2, del: 2 })
  })

  it('Write: số dòng', () => {
    const v = describeTool('Write', { file_path: 'x/y.md', content: 'a\nb\nc\n' })
    expect(v.summary).toBe('x/y.md · 3 dòng')
    expect(v.stats).toEqual({ add: 3, del: 0 })
  })

  it('Glob / Grep / WebFetch / WebSearch / Task', () => {
    expect(describeTool('Glob', { pattern: '**/*.ts', path: 'src' }).summary).toBe('**/*.ts trong src')
    expect(describeTool('Grep', { pattern: 'foo' }).summary).toBe('foo')
    expect(describeTool('WebFetch', { url: 'https://example.com/a', prompt: 'p' }).summary).toBe('example.com/a')
    expect(describeTool('WebSearch', { query: 'electron 44' }).summary).toBe('electron 44')
    expect(describeTool('Task', { description: 'Tìm lỗi', prompt: 'long', subagent_type: 'explore' }).summary).toBe('Tìm lỗi')
  })

  it('TodoWrite: đếm xong / tổng + việc đang làm', () => {
    const v = describeTool('TodoWrite', {
      todos: [
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'in_progress' },
        { content: 'C', status: 'pending' }
      ]
    })
    expect(v.summary).toBe('1/3 · B')
    expect(v.detail.kind === 'todo' && v.detail.items.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  })

  it('tool stag', () => {
    expect(describeTool('mcp__stag__task_start', { title: 'Sửa lỗi đăng nhập', scope: 'src/auth' }).summary).toBe('Sửa lỗi đăng nhập')
    expect(describeTool('mcp__stag__task_done', { summary: 'Xong phần A\nchi tiết' }).summary).toBe('Xong phần A')
    expect(describeTool('mcp__stag__task_start', { title: 'T' }).label).toBe('Bắt đầu việc')
    expect(describeTool('mcp__stag__task_list', {}).summary).toBe('')
  })

  it('MCP khác và tool lạ', () => {
    const m = describeTool('mcp__context7__query-docs', { libraryId: '/x/y', query: 'hooks' })
    expect(m.label).toBe('context7 · query-docs')
    expect(m.summary).toBe('/x/y')
    const u = describeTool('Whatever', { a: 1 })
    expect(u.label).toBe('Whatever')
    expect(u.summary).toBe('{"a":1}')
    expect(u.detail.kind).toBe('json')
  })

  it('input chưa đủ (đang stream) không làm hỏng', () => {
    expect(describeTool('Edit', {}).summary).toBe('')
    expect(describeTool('Bash', undefined).summary).toBe('')
    expect(describeTool('Read', null).summary).toBe('')
  })
})

describe('parseMcpName', () => {
  it('tách tên MCP', () => {
    expect(parseMcpName('mcp__stag__task_done')).toEqual({ server: 'stag', tool: 'task_done' })
    expect(parseMcpName('Bash')).toBeNull()
  })
})

describe('AskUserQuestion / ExitPlanMode', () => {
  const input = {
    questions: [
      { question: 'Dùng thư viện nào?', header: 'Thư viện', options: [{ label: 'zustand', description: 'nhẹ' }, { label: 'redux' }], multiSelect: false },
      { question: 'Bật tính năng nào?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] },
      { question: '' }
    ]
  }

  it('đọc câu hỏi, bỏ câu rỗng', () => {
    const qs = parseQuestions(input)
    expect(qs).toHaveLength(2)
    expect(qs[0]).toMatchObject({ header: 'Thư viện', multiSelect: false })
    expect(qs[0].options).toEqual([
      { label: 'zustand', description: 'nhẹ' },
      { label: 'redux', description: '' }
    ])
    expect(qs[1].multiSelect).toBe(true)
    expect(parseQuestions({})).toEqual([])
  })

  it('tạo tham số trả lời: giữ input, nối nhiều nhãn bằng ", "', () => {
    const out = answersInput(input, { 'Dùng thư viện nào?': ['zustand'], 'Bật tính năng nào?': ['A', 'B'], 'Bỏ trống': [] })
    expect(out.questions).toBe(input.questions)
    expect(out.answers).toEqual({ 'Dùng thư viện nào?': 'zustand', 'Bật tính năng nào?': 'A, B' })
    expect(answersOf(out)).toEqual({ 'Dùng thư viện nào?': 'zustand', 'Bật tính năng nào?': 'A, B' })
  })

  it('mô tả tool', () => {
    expect(describeTool('AskUserQuestion', input).summary).toBe('Dùng thư viện nào?')
    const p = describeTool('ExitPlanMode', { plan: '# Kế hoạch\n- bước 1' })
    expect(p.summary).toBe('Kế hoạch')
    expect(p.detail).toMatchObject({ kind: 'plan', plan: '# Kế hoạch\n- bước 1' })
  })
})

describe('ApplyPatch (Codex fileChange)', () => {
  it('unified diff → dòng +/-, nhiều hunk ngăn bằng ~, bỏ phần đầu diff', () => {
    const diff = 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -9 +9 @@\n-x\n+y\n\\ No newline at end of file\n'
    expect(patchRows('update', diff)).toEqual([
      { t: ' ', s: 'a' },
      { t: '-', s: 'b' },
      { t: '+', s: 'c' },
      { t: '~', s: '' },
      { t: '-', s: 'x' },
      { t: '+', s: 'y' }
    ])
    expect(patchRows('add', 'x\ny\n')).toEqual([{ t: '+', s: 'x' }, { t: '+', s: 'y' }])
    expect(patchRows('delete', 'x')).toEqual([{ t: '-', s: 'x' }])
  })

  it('mô tả: một file / nhiều file, tạo file', () => {
    const one = describeTool('ApplyPatch', { changes: [{ path: 'C:\\p\\src\\a.ts', kind: 'update', diff: '@@ -1 +1 @@\n-a\n+b\n' }] }, { root: 'C:\\p' })
    expect(one).toMatchObject({ label: 'Sửa file', summary: 'src/a.ts', stats: { add: 1, del: 1 } })
    const add = describeTool('ApplyPatch', { changes: [{ path: 'n.txt', kind: 'add', diff: 'hi' }] })
    expect(add).toMatchObject({ label: 'Tạo file', icon: 'pen' })
    const two = describeTool('ApplyPatch', { changes: [{ path: 'a', kind: 'add', diff: 'x' }, { path: 'b', kind: 'delete', diff: 'y' }] })
    expect(two.summary).toBe('2 file: a, b')
    expect(two.detail).toMatchObject({ kind: 'edit', rows: [{ t: '+' }, { t: '~' }, { t: '-' }] })
  })
})

describe('giao diện Hội thoại: bước, file, thẻ xin quyền', () => {
  it('tên bước bỏ tiền tố mcp', () => {
    expect(stepName('mcp__stag__task_done')).toBe('task_done')
    expect(stepName('Bash')).toBe('Bash')
  })

  it('kết quả ngắn của một bước', () => {
    expect(stepResult('Bash', 'running')).toBeNull()
    expect(stepResult('Bash', 'ok', 'x')).toEqual({ text: '✓', tone: 'ok' })
    expect(stepResult('Bash', 'error', 'boom')).toEqual({ text: '✗', tone: 'err' })
    expect(stepResult('Edit', 'denied')).toMatchObject({ tone: 'err' })
    expect(stepResult('Read', 'ok', 'a\nb\nc\n')?.text).toBe('3 dòng')
    expect(stepResult('Grep', 'ok', 'No matches found')?.text).toBe('0 kết quả')
    expect(stepResult('Grep', 'ok', 'Found 4 files\na\nb\nc\nd')?.text).toBe('4 kết quả')
    expect(stepResult('Glob', 'ok', 'a.ts\nb.ts')?.text).toBe('2 kết quả')
  })

  it('file đã sửa theo tool và gộp theo đường dẫn', () => {
    expect(fileChanges('Bash', { command: 'ls' })).toEqual([])
    const e = fileChanges('Edit', { file_path: 'C:\\p\\a.ts', old_string: 'x', new_string: 'y\nz' })
    expect(e).toEqual([{ path: 'C:\\p\\a.ts', rows: [{ t: '-', s: 'x' }, { t: '+', s: 'y' }, { t: '+', s: 'z' }] }])
    const w = fileChanges('Write', { file_path: 'c:/p/a.ts', content: 'q\n' })
    const ap = fileChanges('ApplyPatch', { changes: [{ path: 'b.ts', kind: 'add', diff: 'n' }] })
    const m = mergeFileChanges([...e, ...w, ...ap])
    expect(m.map((f) => [f.path, f.add, f.del])).toEqual([
      ['C:\\p\\a.ts', 3, 1],
      ['b.ts', 1, 0]
    ])
    expect(m[0].rows.some((r) => r.t === '~')).toBe(true)
  })

  it('tiêu đề thẻ xin quyền và nhãn Luôn cho phép', () => {
    expect(askHeadline('Tester', 'Bash')).toBe('Tester muốn chạy lệnh')
    expect(askHeadline('Tester', 'Edit')).toBe('Tester muốn sửa file')
    expect(askHeadline('Tester', 'mcp__stag__task_done')).toBe('Tester muốn dùng stag · task_done')
    expect(askHeadline('Tester', 'AskUserQuestion')).toBe('Tester hỏi bạn')
    expect(rememberLabel('Bash', { command: 'npm run dev\nnext' })).toBe('Luôn cho phép “npm run dev”')
    expect(rememberLabel('Edit', {})).toBe('Luôn cho phép trong phiên')
  })
})
