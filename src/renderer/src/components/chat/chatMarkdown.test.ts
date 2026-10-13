import { describe, expect, it } from 'vitest'
import { codeBlockHtml, renderChatMarkdown, withCaret } from './chatMarkdown'

describe('renderChatMarkdown', () => {
  it('không để HTML thô lọt qua', () => {
    const html = renderChatMarkdown('<img src=x onerror=alert(1)> và <script>x</script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
  })

  it('đoạn, đậm, nghiêng, code dòng, danh sách', () => {
    const html = renderChatMarkdown('Xin **chào** *bạn* `x`\n\n- một\n- hai')
    expect(html).toContain('<strong>chào</strong>')
    expect(html).toContain('<em>bạn</em>')
    expect(html).toContain('<code>x</code>')
    expect(html).toContain('<li>hai</li>')
  })

  it('khối code: nhãn ngôn ngữ, nút Sao chép, tô màu, escape', () => {
    const html = renderChatMarkdown('```ts\nconst a = "<b>"\n```')
    expect(html).toContain('data-copy')
    expect(html).toContain('>ts</span>')
    expect(html).toContain('text-code-kw')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('khối diff tô theo dấu đầu dòng', () => {
    const html = codeBlockHtml('+thêm\n-bớt\n giữ', 'diff')
    expect(html).toContain('text-work">+thêm')
    expect(html).toContain('text-danger">-bớt')
  })

  it('ngôn ngữ lạ chỉ escape', () => {
    const html = codeBlockHtml('a < b', 'whatever')
    expect(html).toContain('a &lt; b')
    expect(html).not.toContain('<span class="text-')
  })

  it('link http(s) có data-href, không có href; link khác chỉ là chữ', () => {
    const html = renderChatMarkdown('[a](https://x.dev/p) [b](src/a.ts) [c](javascript:alert(1))')
    expect(html).toContain('data-href="https://x.dev/p"')
    expect(html).not.toMatch(/\shref="/)
    // markdown-it không tạo link cho javascript: — chỉ còn là chữ thường.
    expect(html).not.toContain('data-href="javascript')
    expect(html).toContain('md-link-other')
  })

  it('link trần được nhận, "index.ts" không bị biến thành link', () => {
    const html = renderChatMarkdown('xem https://example.com và index.ts')
    expect(html).toContain('data-href="https://example.com"')
    expect(html).not.toContain('data-href="http://index.ts"')
  })

  it('bảng nằm trong khung cuộn ngang', () => {
    const html = renderChatMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<div class="my-2 overflow-x-auto"><table>')
    expect(html).toContain('</table></div>')
  })

  it('việc cần làm thành ô tick chỉ đọc', () => {
    const html = renderChatMarkdown('- [x] xong\n- [ ] chưa')
    expect(html).toContain('type="checkbox" class="md-task" disabled checked')
    expect(html.match(/md-task/g)).toHaveLength(2)
  })

  it('ảnh markdown thành chip chữ', () => {
    const html = renderChatMarkdown('![sơ đồ](http://x/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('sơ đồ')
  })
})

describe('con trỏ stream', () => {
  it('chèn trước thẻ đóng của đoạn cuối', () => {
    const html = renderChatMarkdown('Xin chào', { caret: true })
    expect(html).toMatch(/Xin chào<span class="cc-caret[^"]*"><\/span><\/p>/)
  })

  it('chèn vào mục danh sách cuối', () => {
    const html = withCaret(renderChatMarkdown('- a\n- b'))
    expect(html).toMatch(/b<span class="cc-caret[^"]*"><\/span><\/li>/)
  })

  it('cuối là khối code: thêm sau cùng, không vỡ HTML', () => {
    const html = renderChatMarkdown('```js\nx\n```', { caret: true })
    expect(html.endsWith('</span>')).toBe(true)
    expect(html.indexOf('cc-caret')).toBeGreaterThan(html.indexOf('</pre>'))
  })

  it('không bật thì không có con trỏ', () => {
    expect(renderChatMarkdown('a')).not.toContain('cc-caret')
  })
})
