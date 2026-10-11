import { describe, expect, it } from 'vitest'
import { findSection, frontmatterKeys, headings, outlineText, patchSection, readField, readSection, rewriteLinks, writeField } from './noteSections'

const NOTE = `---
type: feature
tags: [a, b]
aliases:
  - Old name
---
# Title

Intro.

## Goal
Do X.

\`\`\`
## not a heading
\`\`\`

## Phases
### Phase 1
One.
### Phase 2
Two.

## Notes
- n1
`

describe('heading', () => {
  it('liệt kê heading, bỏ frontmatter và khối code', () => {
    expect(headings(NOTE).map((h) => `${h.level}:${h.text}`)).toEqual(['1:Title', '2:Goal', '2:Phases', '3:Phase 1', '3:Phase 2', '2:Notes'])
    expect(outlineText(NOTE)).toContain('    ### Phase 1')
  })

  it('đọc phần dưới heading (gồm heading con), không phân biệt hoa thường, có `#`', () => {
    expect(readSection(NOTE, 'goal')).toBe('Do X.\n\n```\n## not a heading\n```')
    expect(readSection(NOTE, '## Phases')).toBe('### Phase 1\nOne.\n### Phase 2\nTwo.')
    expect(readSection(NOTE, 'Phases > Phase 2')).toBe('Two.')
    expect(readSection(NOTE, 'Missing')).toBeNull()
  })

  it('tên trùng mà không chỉ rõ cha → lỗi', () => {
    const md = '# A\n## X\n1\n# B\n## X\n2\n'
    expect(() => findSection(md, 'X')).toThrow(/Several headings/)
    expect(readSection(md, 'B > X')).toBe('2')
  })

  it('patch replace / append / prepend giữ heading và dòng trống trước heading sau', () => {
    const r = patchSection(NOTE, 'Goal', 'replace', 'Do Y.')
    expect(readSection(r, 'Goal')).toBe('Do Y.')
    expect(r).toContain('Do Y.\n\n## Phases')
    expect(readSection(patchSection(NOTE, 'Notes', 'append', '- n2'), 'Notes')).toBe('- n1\n\n- n2')
    expect(readSection(patchSection(NOTE, 'Phase 1', 'prepend', 'Zero.'), 'Phase 1')).toBe('Zero.\n\nOne.')
    expect(patchSection(NOTE, 'Notes', 'append', '- n2').endsWith('- n2\n')).toBe(true)
  })

  it('heading chưa có: lỗi, hoặc tạo cuối note khi create', () => {
    expect(() => patchSection(NOTE, 'Nope', 'append', 'x')).toThrow(/memory_outline/)
    const r = patchSection('# T\n', 'Learnings', 'append', '- l1', true)
    expect(r).toBe('# T\n\n## Learnings\n\n- l1\n')
  })

  it('giữ CRLF', () => {
    const md = '# T\r\n## A\r\nold\r\n## B\r\nb\r\n'
    expect(patchSection(md, 'A', 'replace', 'new')).toBe('# T\r\n## A\r\n\r\nnew\r\n\r\n## B\r\nb\r\n')
  })
})

describe('frontmatter', () => {
  it('đọc khoá và giá trị (cả danh sách nhiều dòng)', () => {
    expect(frontmatterKeys(NOTE)).toEqual(['type', 'tags', 'aliases'])
    expect(readField(NOTE, 'type')).toBe('feature')
    expect(readField(NOTE, 'TAGS')).toBe('[a, b]')
    expect(readField(NOTE, 'aliases')).toBe('- Old name')
    expect(readField(NOTE, 'status')).toBeNull()
  })

  it('ghi / thay (cả danh sách nhiều dòng) / xoá trường; tạo frontmatter nếu chưa có', () => {
    expect(readField(writeField(NOTE, 'status', 'done'), 'status')).toBe('done')
    const r = writeField(NOTE, 'aliases', '[X]')
    expect(r).toContain('aliases: [X]\n---')
    expect(r).not.toContain('Old name')
    expect(frontmatterKeys(writeField(NOTE, 'tags', null))).toEqual(['type', 'aliases'])
    expect(writeField('# T\n', 'type', 'log')).toBe('---\ntype: log\n---\n# T\n')
    expect(() => writeField(NOTE, 'bad key', 'x')).toThrow()
  })
})

describe('rewriteLinks', () => {
  const notes = [{ rel: 'a/Old.md' }, { rel: 'b/Src.md' }, { rel: 'c/Other.md' }]

  it('sửa link wiki (giữ heading / bí danh / nhúng) và link markdown, bỏ qua code', () => {
    const md = 'See [[Old]], [[Old#Goal|the goal]], ![[a/Old]], [md](../a/Old.md#x), `[[Old]]`, [[Other]]\n```\n[[Old]]\n```\n'
    const r = rewriteLinks(md, 'b/Src.md', 'a/Old.md', 'd/New name.md', notes)
    expect(r.count).toBe(4)
    expect(r.text).toBe(
      'See [[New name]], [[New name#Goal|the goal]], ![[d/New name]], [md](../d/New%20name.md#x), `[[Old]]`, [[Other]]\n```\n[[Old]]\n```\n'
    )
  })

  it('tên mới trùng note khác → dùng đường dẫn đầy đủ; không có link → giữ nguyên', () => {
    expect(rewriteLinks('[[Old]]', 'b/Src.md', 'a/Old.md', 'a/Other.md', notes).text).toBe('[[a/Other]]')
    const same = 'nothing here'
    expect(rewriteLinks(same, 'b/Src.md', 'a/Old.md', 'a/New.md', notes)).toEqual({ text: same, count: 0 })
  })
})
