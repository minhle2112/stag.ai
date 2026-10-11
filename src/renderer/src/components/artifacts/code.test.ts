import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightLines, splitLines, symbolsOf } from './code'

describe('splitLines', () => {
  it('chịu CRLF và bỏ dòng rỗng cuối', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([''])
    expect(splitLines('x\n\ny')).toEqual(['x', '', 'y'])
  })
})

describe('highlightLines', () => {
  it('đuôi lạ: chỉ escape HTML', () => {
    expect(highlightLines(['<b>&</b>'], 'a.xyz')).toEqual(['&lt;b&gt;&amp;&lt;/b&gt;'])
    expect(escapeHtml('a<b')).toBe('a&lt;b')
  })

  it('tô từ khoá, chuỗi, số, chú thích; nội dung luôn được escape', () => {
    const [l] = highlightLines(["const a = '<x>' // 5 < 6"], 'a.ts')
    expect(l).toContain('>const</span>')
    expect(l).toContain('&lt;x&gt;')
    expect(l).not.toContain('<x>')
    expect(l).toContain('italic">// 5 &lt; 6</span>')
  })

  it('chú thích khối kéo qua nhiều dòng; // trong URL không phải chú thích', () => {
    const out = highlightLines(['/* a', 'b */ let x = 1', "const u = 'http://x'"], 'a.ts')
    expect(out[0]).toContain('italic">/* a</span>')
    expect(out[1]).toContain('italic">b */</span>')
    expect(out[1]).toContain('>let</span>')
    expect(out[1]).toContain('>1</span>')
    expect(out[2]).not.toContain('italic')
  })

  it('# là chú thích của python / yaml chỉ khi đứng đầu hoặc sau khoảng trắng', () => {
    const [a, b] = highlightLines(['x = 1 # note', 'url = "a#b"'], 'a.py')
    expect(a).toContain('italic"># note</span>')
    expect(b).not.toContain('italic')
  })

  it('không bị chậm với dòng dài nhiều dấu nháy chưa đóng', () => {
    const line = "'a ".repeat(50_000)
    const t = Date.now()
    highlightLines([line], 'a.ts')
    expect(Date.now() - t).toBeLessThan(1500)
  })
})

describe('symbolsOf', () => {
  it('TS: hàm / const / interface ở cột đầu, bỏ phần thụt lề', () => {
    const lines = ['import x from "y"', 'export async function load() {', '  const inner = 1', '}', 'export const A = 1', 'interface Props {}']
    expect(symbolsOf(lines, 'a.tsx').map((s) => [s.line, s.name])).toEqual([
      [2, 'load'],
      [5, 'A'],
      [6, 'Props']
    ])
  })

  it('markdown: tiêu đề mức 1–3, bỏ qua trong khối code', () => {
    const lines = ['# Một', 'text', '```', '# not heading', '```', '## Hai ##', '#### Bốn']
    expect(symbolsOf(lines, 'n.md')).toEqual([
      { line: 1, name: 'Một', depth: 0 },
      { line: 6, name: 'Hai', depth: 1 }
    ])
  })

  it('python, sql, prisma; đuôi lạ không có cấu trúc', () => {
    expect(symbolsOf(['def f():', '    def g(): pass', 'class K:'], 'a.py').map((s) => s.name)).toEqual(['f', 'K'])
    expect(symbolsOf(['CREATE UNIQUE INDEX idx_a ON t(a);', 'alter table "orders" add x int;'], 'm.sql').map((s) => s.name)).toEqual(['idx_a', 'orders'])
    expect(symbolsOf(['model Order {', '}'], 'schema.prisma').map((s) => s.name)).toEqual(['Order'])
    expect(symbolsOf(['function f() {}'], 'a.xyz')).toEqual([])
  })
})
