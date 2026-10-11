import { describe, expect, it } from 'vitest'
import type { ArtifactEvent } from '@shared/types'
import { buildStacks, categoryOf, fileUrl, filterStacks, groupRows, markerOf, previewKind, rowTime, timeBucket } from './stacks'

const ev = (agentId: string, rel: string, kind: ArtifactEvent['kind'], at: string): ArtifactEvent => ({
  agentId,
  agentName: agentId === 'a' ? 'Lan' : 'Đức',
  rel,
  kind,
  tool: 'Write',
  at: `2026-10-09T10:${at}:00.000Z`
})

describe('categoryOf / previewKind', () => {
  it('phân loại theo đuôi file', () => {
    expect(categoryOf('out/Chart.PNG')).toBe('image')
    expect(categoryOf('demo.mp4')).toBe('video')
    expect(categoryOf('spec.pdf')).toBe('document')
    expect(categoryOf('README.md')).toBe('text')
    expect(categoryOf('src/app.ts')).toBe('file')
    expect(categoryOf('Makefile')).toBe('file')
    expect(previewKind('a.SVG')).toBe('image')
    expect(previewKind('deck.pptx')).toBe('pptx')
    expect(previewKind('data.csv')).toBe('sheet')
    expect(previewKind('page.html')).toBe('html')
    expect(previewKind('notes.md')).toBe('markdown')
    expect(previewKind('app.exe')).toBe('other')
    expect(previewKind('src/main.rs')).toBe('text')
    expect(previewKind('Dockerfile')).toBe('text')
  })
})

describe('buildStacks', () => {
  it('gom theo file (không phân biệt hoa thường), mới nhất trước', () => {
    const stacks = buildStacks([ev('a', 'out/a.png', 'write', '01'), ev('b', 'src/x.ts', 'edit', '02'), ev('b', 'OUT/A.png', 'edit', '03'), ev('a', 'src/x.ts', 'delete', '04')])
    expect(stacks.map((s) => [s.rel, s.events.length, s.agents.map((a) => a.id), s.deleted])).toEqual([
      ['src/x.ts', 2, ['a', 'b'], true],
      ['OUT/A.png', 2, ['b', 'a'], false]
    ])
    expect(stacks[1]).toMatchObject({ name: 'A.png', dir: 'OUT', category: 'image' })
  })
})

describe('filterStacks', () => {
  const stacks = buildStacks([ev('a', 'out/a.png', 'write', '01'), ev('b', 'docs/Hướng dẫn.md', 'write', '02')])
  it('lọc theo loại, agent, chữ tìm không dấu', () => {
    expect(filterStacks(stacks, 'image', '').map((s) => s.rel)).toEqual(['out/a.png'])
    expect(filterStacks(stacks, 'all', 'huong dan').map((s) => s.rel)).toEqual(['docs/Hướng dẫn.md'])
    expect(filterStacks(stacks, 'all', 'duc').map((s) => s.rel)).toEqual(['docs/Hướng dẫn.md'])
    expect(filterStacks(stacks, 'all', '', 'a').map((s) => s.rel)).toEqual(['out/a.png'])
  })
})

describe('fileUrl', () => {
  it('mã hoá từng đoạn đường dẫn', () => {
    expect(fileUrl('ws1', 'out/my chart#1.png', '2026')).toBe('stag-file://ws1/out/my%20chart%231.png?v=2026')
  })
})

describe('groupRows', () => {
  const stacks = buildStacks([
    ev('a', 'src/a.ts', 'write', '01'),
    ev('b', 'src/b.ts', 'edit', '02'),
    ev('b', 'README.md', 'write', '03'),
    ev('a', 'src/b.ts', 'edit', '04')
  ])
  const rows = stacks.map((stack) => ({ stack }))

  it('gom theo thư mục, giữ thứ tự mới → cũ, thư mục gốc có nhãn riêng', () => {
    const g = groupRows(rows, 'dir')
    expect(g.map((x) => [x.label, x.rows.map((r) => r.stack.rel)])).toEqual([
      ['src/', ['src/b.ts', 'src/a.ts']],
      ['(thư mục gốc)', ['README.md']]
    ])
  })

  it('gom theo agent: file nhiều agent nằm ở nhóm của từng agent; onlyAgent giữ một nhóm', () => {
    const g = groupRows(rows, 'agent')
    expect(g.map((x) => [x.agent?.id, x.rows.map((r) => r.stack.rel)])).toEqual([
      ['a', ['src/b.ts', 'src/a.ts']],
      ['b', ['src/b.ts', 'README.md']]
    ])
    expect(groupRows(rows, 'agent', { onlyAgent: 'b' }).map((x) => x.agent?.id)).toEqual(['b'])
  })

  it('gom theo giờ địa phương', () => {
    const now = new Date(2026, 9, 11, 15, 30)
    const at = (d: Date): string => d.toISOString()
    expect(timeBucket(at(new Date(2026, 9, 11, 14, 5)), now)).toMatchObject({ label: 'Hôm nay · 14:00 – 15:00' })
    expect(timeBucket(at(new Date(2026, 9, 10, 23, 59)), now)).toMatchObject({ label: 'Hôm qua · 23:00 – 00:00' })
    expect(timeBucket(at(new Date(2026, 9, 3, 9, 0)), now)).toMatchObject({ label: '03/10 · 09:00 – 10:00' })
    expect(timeBucket('hỏng', now).key).toBe('unknown')
  })
})

describe('markerOf', () => {
  it('+ tạo mới, ~ đã sửa, - đã xoá', () => {
    const [created, edited, removed] = buildStacks([
      ev('a', 'n.txt', 'write', '01'),
      ev('a', 'e.txt', 'edit', '02'),
      ev('a', 'd.txt', 'write', '03'),
      ev('a', 'd.txt', 'delete', '04')
    ]).sort((x, y) => x.rel.localeCompare(y.rel)).reverse()
    expect([created.rel, markerOf({ stack: created })]).toEqual(['n.txt', 'add'])
    expect([edited.rel, markerOf({ stack: edited })]).toEqual(['e.txt', 'mod'])
    expect([removed.rel, markerOf({ stack: removed })]).toEqual(['d.txt', 'del'])
    expect(markerOf({ stack: edited, event: { ...edited.events[0], kind: 'write' } })).toBe('add')
  })
})

describe('markerOf / rowTime nhìn từ một agent', () => {
  // a tạo file lúc :01, b sửa lúc :05 → file "mới tạo" với a, "đã sửa" với b.
  const [stack] = buildStacks([ev('a', 'x.ts', 'write', '01'), ev('b', 'x.ts', 'edit', '05')])
  it('dấu và giờ theo agent', () => {
    expect(markerOf({ stack })).toBe('add')
    expect(markerOf({ stack }, 'a')).toBe('add')
    expect(markerOf({ stack }, 'b')).toBe('mod')
    expect(rowTime({ stack }, 'a')).toBe('2026-10-09T10:01:00.000Z')
    expect(rowTime({ stack }, 'b')).toBe(stack.last)
    expect(rowTime({ stack })).toBe(stack.last)
  })
})
