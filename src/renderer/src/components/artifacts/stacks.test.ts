import { describe, expect, it } from 'vitest'
import type { ArtifactEvent } from '@shared/types'
import { buildStacks, categoryOf, fileUrl, filterStacks, previewKind } from './stacks'

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
