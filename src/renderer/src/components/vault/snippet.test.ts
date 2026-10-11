import { describe, expect, it } from 'vitest'
import { cleanLine, snippetAt } from './snippet'

describe('cleanLine', () => {
  it('bỏ đầu danh sách, ký hiệu đậm / code, wikilink lấy chữ hiện', () => {
    expect(cleanLine('- [x] Xem **[[Shipping rules|phí ship]]** ở `src/lib.ts`')).toBe('Xem phí ship ở src/lib.ts')
    expect(cleanLine('## Module: [[Orders module#Pieces]]')).toBe('Module: Orders module')
    expect(cleanLine('  1. a   b')).toBe('a b')
  })
})

describe('snippetAt', () => {
  it('đúng dòng (từ 1), chịu CRLF, ngoài phạm vi → rỗng', () => {
    const t = '---\r\na: 1\r\n---\r\n- Dùng [[Kiên]]\r\n'
    expect(snippetAt(t, 4)).toBe('Dùng Kiên')
    expect(snippetAt(t, 99)).toBe('')
  })
})
