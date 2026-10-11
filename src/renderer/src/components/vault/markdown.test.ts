import { describe, expect, it } from 'vitest'
import { headingKey, parseProps, renderNote, type NoteRenderCtx } from './markdown'
import { highlight } from './highlight'

const notes = [{ rel: '_INDEX.md' }, { rel: '10 stag.ai/stag.ai.md' }, { rel: '10 stag.ai/Kế hoạch xương sống.md' }, { rel: '20 Workflow/Learnings.md' }]
const ctx = { current: '_INDEX.md', notes }
const html = (src: string, c: NoteRenderCtx = ctx): string => renderNote(src, c).html

describe('wikilink', () => {
  it('link tới note có sẵn: class, data-target, chữ hiện', () => {
    const h = html('Xem [[Learnings]] nhé')
    expect(h).toContain('<a class="wikilink" data-target="Learnings" title="20 Workflow/Learnings.md">Learnings</a>')
  })

  it('note chưa có → "ma" kèm tooltip', () => {
    const h = html('[[Chưa viết]]')
    expect(h).toContain('class="wikilink ghost"')
    expect(h).toContain('title="Chưa có note"')
  })

  it('bí danh và heading', () => {
    expect(html('[[Kế hoạch xương sống#M2 agent|kế hoạch]]')).toContain(
      'data-target="Kế hoạch xương sống" data-heading="M2 agent" title="10 stag.ai/Kế hoạch xương sống.md">kế hoạch</a>'
    )
    expect(html('[[Learnings#Lỗi]]')).toContain('>Learnings &gt; Lỗi</a>')
    // `[[#heading]]` trong cùng note
    expect(html('[[#Bản đồ vault]]')).toContain('data-target="" data-heading="Bản đồ vault" title="_INDEX.md">Bản đồ vault</a>')
  })

  it('\\| trong bảng là dấu tách bí danh', () => {
    const h = html('| a | b |\n|---|---|\n| [[Learnings\\|bài học]] | x |')
    expect(h).toContain('>bài học</a>')
    expect(h).toContain('<table data-line="1">')
  })

  it('bỏ qua [[...]] trong code', () => {
    const h = html('`[[Learnings]]`\n\n```\n[[Learnings]]\n```')
    expect(h).not.toContain('class="wikilink')
    expect(h).toContain('<code>[[Learnings]]</code>')
  })

  it('chưa có chỉ mục thì chưa đánh dấu "ma"', () => {
    expect(html('[[Gì đó]]', { current: '_INDEX.md', notes: null })).not.toContain('ghost')
  })
})

describe('nhúng', () => {
  it('nhúng note → chip ↪', () => {
    expect(html('![[Learnings]]')).toContain('<a class="md-embed md-embed-note" data-target="Learnings" title="20 Workflow/Learnings.md">↪ Learnings</a>')
    expect(html('![[Không có]]')).toContain('class="md-embed md-embed-note ghost"')
  })

  it('ảnh/file → chip tên file, không tải ảnh', () => {
    const h = html('![[ảnh/sơ đồ.png]] và ![mô tả](a/b.jpg)')
    expect(h).toContain('<span class="md-embed md-file" title="ảnh/sơ đồ.png">sơ đồ.png</span>')
    expect(h).toContain('<span class="md-embed md-file" title="a/b.jpg">mô tả</span>')
    expect(h).not.toContain('<img')
  })
})

describe('link markdown', () => {
  it('link tới note .md trong vault bấm được, không có href', () => {
    const h = html('[kế hoạch](10%20stag.ai/K%E1%BA%BF%20ho%E1%BA%A1ch%20x%C6%B0%C6%A1ng%20s%E1%BB%91ng.md#M3)')
    expect(h).toContain('class="wikilink" data-target="10 stag.ai/Kế hoạch xương sống.md" data-heading="M3"')
    expect(h).not.toContain('href=')
    expect(html('[x](./khong-co.md)')).toContain('class="wikilink ghost"')
  })

  it('link ngoài: data-href, không href; linkify chỉ với http(s)', () => {
    const h = html('[web](https://example.com/a) và https://x.org cùng stag.ai')
    expect(h).toContain('<a class="md-ext" data-href="https://example.com/a" title="https://example.com/a">web</a>')
    expect(h).toContain('data-href="https://x.org"')
    expect(h).not.toContain(' href="')
    expect(h).toContain('cùng stag.ai')
  })

  it('javascript: không thành link', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('<a')
  })
})

describe('an toàn', () => {
  it('không render HTML thô', () => {
    const h = html('<script>alert(1)</script>\n\nchữ <b onclick="x()">đậm</b>')
    expect(h).not.toContain('<script>')
    expect(h).not.toContain('<b ')
    expect(h).toContain('&lt;script&gt;')
  })

  it('escape thuộc tính của wikilink', () => {
    const h = html('[["><img src=x>]]')
    expect(h).not.toContain('<img')
    expect(h).toContain('data-target="&quot;&gt;&lt;img src=x&gt;"')
  })
})

describe('frontmatter', () => {
  const src = '---\ntype: index\nupdated: 2026-10-08\ntags: [a, "b"]\naliases:\n  - Mục lục\n  - Index\nrelated: "[[Learnings]]"\n---\n# Tiêu đề\n'

  it('thành bảng thuộc tính, không in thô', () => {
    const r = renderNote(src, ctx)
    expect(r.props).toEqual([
      { key: 'type', value: 'index' },
      { key: 'updated', value: '2026-10-08' },
      { key: 'tags', value: 'a, b' },
      { key: 'aliases', value: 'Mục lục, Index' },
      { key: 'related', value: '[[Learnings]]' }
    ])
    expect(r.html).toContain('<table class="md-props" data-line="1">')
    expect(r.html).toContain('<tr><th>type</th><td>index</td></tr>')
    expect(r.html).toContain('<a class="wikilink" data-target="Learnings"')
    expect(r.html).not.toContain('---')
  })

  it('propsBox: hộp thu gọn <details> có dòng tóm tắt, không in thô', () => {
    const h = renderNote(src, { ...ctx, propsBox: 'closed' }).html
    expect(h).toContain('<details class="md-propsbox')
    expect(h).not.toMatch(/<details[^>]* open/)
    expect(h).toContain('data-line="1"')
    // Dòng tóm tắt: khoá: giá trị, link wikilink bỏ ngoặc.
    expect(h).toContain('type: index · updated: 2026-10-08 · tags: a, b · aliases: Mục lục, Index · related: Learnings')
    expect(h).toContain('<tr><th>type</th><td>index</td></tr>')
    expect(h).toContain('<a class="wikilink" data-target="Learnings"')
    expect(h).not.toContain('---')
    expect(renderNote(src, { ...ctx, propsBox: 'open' }).html).toMatch(/<details[^>]* open>/)
  })

  it('propsBox: không có frontmatter thì không có hộp', () => {
    expect(renderNote('# A', { ...ctx, propsBox: 'closed' }).html).not.toContain('<details')
  })

  it('không có frontmatter thì không có bảng', () => {
    expect(renderNote('# A', ctx).props).toEqual([])
    expect(parseProps(null)).toEqual([])
  })
})

describe('data-line', () => {
  it('tính từ 1 trong cả file, kể cả frontmatter', () => {
    const h = html('---\ntype: x\n---\n# Tiêu đề\n\nĐoạn một\ndòng hai\n\n- mục a\n- mục b\n\n```js\ncode\n```\n')
    expect(h).toContain('<h1 id="tiêu-đề" data-heading="Tiêu đề" data-line="4">')
    expect(h).toContain('<p data-line="6">')
    expect(h).toContain('<li data-line="9">')
    expect(h).toContain('<li data-line="10">')
    expect(h).toContain('data-line="12"')
  })

  it('heading trùng tên có id khác nhau', () => {
    const h = html('## Việc\n\n## Việc')
    expect(h).toContain('id="việc"')
    expect(h).toContain('id="việc-1"')
  })
})

describe('việc cần làm', () => {
  it('checkbox chỉ đọc', () => {
    const h = html('- [ ] chưa\n- [x] xong [[Learnings]]\n- [link](x) thường')
    expect(h).toContain('<ul class="task-list" data-line="1">')
    expect(h).toContain('<li class="task" data-line="1"><input type="checkbox" class="md-task" disabled> chưa</li>')
    expect(h).toContain('<input type="checkbox" class="md-task" disabled checked> xong <a class="wikilink"')
    expect(h).not.toContain('[ ]')
  })
})

describe('headingKey', () => {
  it('không phân biệt hoa thường và dấu câu', () => {
    expect(headingKey('M2: Agent + lưới')).toBe(headingKey('m2 agent lưới'))
  })
})

describe('highlight', () => {
  it('so khớp bỏ dấu, giữ chữ gốc', () => {
    expect(highlight('Kế hoạch xương sống', 'ke HOACH')).toEqual([
      { text: 'Kế', hit: true },
      { text: ' ', hit: false },
      { text: 'hoạch', hit: true },
      { text: ' xương sống', hit: false }
    ])
    expect(highlight('Đường đi', 'duong')).toEqual([
      { text: 'Đường', hit: true },
      { text: ' đi', hit: false }
    ])
    expect(highlight('abc', '')).toEqual([{ text: 'abc', hit: false }])
  })
})
