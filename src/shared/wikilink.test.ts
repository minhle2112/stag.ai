import { describe, expect, it } from 'vitest'
import { extractLinks, isAttachment, parseNoteMeta, resolveNote, splitFrontmatter, splitWikilink } from './wikilink'

describe('splitWikilink', () => {
  it('tách đích, heading, bí danh', () => {
    expect(splitWikilink('Browser')).toEqual({ target: 'Browser', heading: null, alias: null })
    expect(splitWikilink('_INDEX|stag.ai memory')).toEqual({ target: '_INDEX', heading: null, alias: 'stag.ai memory' })
    expect(splitWikilink('Kanban#Esc')).toEqual({ target: 'Kanban', heading: 'Esc', alias: null })
    expect(splitWikilink('40 Log/_Template|Log template')).toEqual({ target: '40 Log/_Template', heading: null, alias: 'Log template' })
    expect(splitWikilink('#Mục')).toEqual({ target: '', heading: 'Mục', alias: null })
  })

  it('`\\|` trong bảng là dấu tách bí danh', () => {
    expect(splitWikilink('Browser\\|trình duyệt')).toEqual({ target: 'Browser', heading: null, alias: 'trình duyệt' })
  })
})

describe('splitFrontmatter / parseNoteMeta', () => {
  it('tách frontmatter và tính dòng bắt đầu phần thân', () => {
    const md = '---\ntype: feature\nupdated: 2026-10-08\n---\n# Tiêu đề\n'
    const r = splitFrontmatter(md)
    expect(r.frontmatter).toBe('type: feature\nupdated: 2026-10-08')
    expect(r.body).toBe('# Tiêu đề\n')
    expect(r.bodyLine).toBe(5)
  })

  it('không có frontmatter', () => {
    expect(splitFrontmatter('# A\n---\nb: c\n---\n')).toEqual({ frontmatter: null, body: '# A\n---\nb: c\n---\n', bodyLine: 1 })
  })

  it('CRLF', () => {
    const r = splitFrontmatter('---\r\ntype: log\r\n---\r\nThân')
    expect(r.frontmatter).toBe('type: log')
    expect(r.body).toBe('Thân')
  })

  it('đọc type, aliases, tags ở các kiểu viết', () => {
    expect(parseNoteMeta('type: decision\naliases: [Quyết định A, "B"]\ntags: a, #b')).toEqual({
      type: 'decision',
      aliases: ['Quyết định A', 'B'],
      tags: ['a', 'b']
    })
    expect(parseNoteMeta('type: "feature"\naliases:\n  - Một\n  - \'Hai\'\ntags:\n- x')).toEqual({
      type: 'feature',
      aliases: ['Một', 'Hai'],
      tags: ['x']
    })
    expect(parseNoteMeta(null)).toEqual({ type: null, aliases: [], tags: [] })
    expect(parseNoteMeta('type:\nupdated: x')).toEqual({ type: null, aliases: [], tags: [] })
  })
})

describe('extractLinks', () => {
  it('lấy wikilink, nhúng và link markdown tới file trong vault, kèm số dòng', () => {
    const md = [
      '---',
      'related: "[[Kanban]]"',
      '---',
      'Xem [[Browser]] và [[Kanban#Esc|mục Esc]].',
      '![[sơ đồ.png]] ![ảnh](img/a.png)',
      '[note](../30%20Features/Browser.md#Kỹ%20thuật) [web](https://example.com) [mail](mailto:a@b.c)'
    ].join('\n')
    expect(extractLinks(md)).toEqual([
      { target: 'Kanban', heading: null, alias: null, embed: false, kind: 'wiki', line: 2 },
      { target: 'Browser', heading: null, alias: null, embed: false, kind: 'wiki', line: 4 },
      { target: 'Kanban', heading: 'Esc', alias: 'mục Esc', embed: false, kind: 'wiki', line: 4 },
      { target: 'sơ đồ.png', heading: null, alias: null, embed: true, kind: 'wiki', line: 5 },
      { target: 'img/a.png', heading: null, alias: null, embed: true, kind: 'md', line: 5 },
      { target: '../30 Features/Browser.md', heading: 'Kỹ thuật', alias: null, embed: false, kind: 'md', line: 6 }
    ])
  })

  it('bỏ qua link trong khối code và `code`', () => {
    const md = ['```md', '[[Trong khối]]', '```', 'Có `[[trong code]]` và [[Ngoài]]', '~~~', '[[Cũng trong khối]]', '~~~'].join('\n')
    expect(extractLinks(md).map((l) => l.target)).toEqual(['Ngoài'])
  })

  it('khối code mở bằng ```` chỉ đóng bằng ```` trở lên', () => {
    const md = ['````', '```', '[[Vẫn trong khối]]', '````', '[[Ngoài]]'].join('\n')
    expect(extractLinks(md).map((l) => l.target)).toEqual(['Ngoài'])
  })
})

describe('isAttachment', () => {
  it('nhận ra file đính kèm, không nhầm tên note có dấu chấm', () => {
    expect(isAttachment('a.PNG')).toBe(true)
    expect(isAttachment('x/y.pdf')).toBe(true)
    expect(isAttachment('stag.ai')).toBe(false)
    expect(isAttachment('Bản 0.1.0')).toBe(false)
    expect(isAttachment('Note.md')).toBe(false)
  })
})

describe('resolveNote', () => {
  const notes = [
    { rel: '_INDEX.md' },
    { rel: '10 stag.ai/stag.ai.md' },
    { rel: '30 Features/Browser.md' },
    { rel: '30 Features/Kanban.md' },
    { rel: '40 Log/_Template.md' },
    { rel: '50 Decisions/_Template.md' },
    { rel: 'a/b/Trùng.md' },
    { rel: 'c/Trùng.md' }
  ]

  it('theo tên file, không phân biệt hoa thường', () => {
    expect(resolveNote('Browser', '_INDEX.md', notes)).toBe('30 Features/Browser.md')
    expect(resolveNote('kanban', '_INDEX.md', notes)).toBe('30 Features/Kanban.md')
    expect(resolveNote('stag.ai', '_INDEX.md', notes)).toBe('10 stag.ai/stag.ai.md')
    expect(resolveNote('Browser.md', '_INDEX.md', notes)).toBe('30 Features/Browser.md')
  })

  it('có thư mục thì khớp đường dẫn', () => {
    expect(resolveNote('40 Log/_Template', '_INDEX.md', notes)).toBe('40 Log/_Template.md')
    expect(resolveNote('50 Decisions/_Template', '_INDEX.md', notes)).toBe('50 Decisions/_Template.md')
    expect(resolveNote('b/Trùng', '_INDEX.md', notes)).toBe('a/b/Trùng.md')
  })

  it('trùng tên: ưu tiên cùng thư mục, rồi đường dẫn ngắn nhất', () => {
    expect(resolveNote('Trùng', 'a/b/Khác.md', notes)).toBe('a/b/Trùng.md')
    expect(resolveNote('Trùng', '_INDEX.md', notes)).toBe('c/Trùng.md')
    expect(resolveNote('_Template', '50 Decisions/x.md', notes)).toBe('50 Decisions/_Template.md')
  })

  it('đường dẫn tương đối', () => {
    expect(resolveNote('../30 Features/Browser.md', '10 stag.ai/stag.ai.md', notes)).toBe('30 Features/Browser.md')
    expect(resolveNote('./Kanban.md', '30 Features/Browser.md', notes)).toBe('30 Features/Kanban.md')
    expect(resolveNote('../../x.md', '_INDEX.md', notes)).toBeNull()
  })

  it('đích rỗng = chính note; chưa có note hoặc là file đính kèm → null', () => {
    expect(resolveNote('', '30 Features/Kanban.md', notes)).toBe('30 Features/Kanban.md')
    expect(resolveNote('Vault Viewer', '_INDEX.md', notes)).toBeNull()
    expect(resolveNote('sơ đồ.png', '_INDEX.md', notes)).toBeNull()
  })

  it('đường dẫn viết bằng \\', () => {
    expect(resolveNote('30 Features\\Kanban', '_INDEX.md', notes)).toBe('30 Features/Kanban.md')
  })
})
