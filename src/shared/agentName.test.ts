import { describe, expect, it } from 'vitest'
import { agentNameProblem, sameAgentName } from './agentName'

describe('agentNameProblem', () => {
  it('tên thường dùng được', () => {
    for (const n of ['Tester', 'Dev Thực Chiến', 'Chuyên Gia FIx Bug', 'Dev · web-shop', 'Archivist']) expect(agentNameProblem(n), n).toBeNull()
  })
  it('từ chối tên trùng note lưu trữ của agent khác ("X archive")', () => {
    expect(agentNameProblem('Tester archive')).toMatch(/archive/)
    expect(agentNameProblem('Tester Archive')).toMatch(/archive/)
  })
  it('từ chối ký tự làm vỡ wikilink', () => {
    for (const n of ['C#', 'a[b]', 'x^y']) expect(agentNameProblem(n), n).toMatch(/\[ \] # \^/)
  })
})

describe('sameAgentName', () => {
  it('không phân biệt hoa thường và kiểu gõ dấu (NFC / NFD)', () => {
    expect(sameAgentName('Kiểm thử', 'kiểm THỬ')).toBe(true)
    expect(sameAgentName('Kiểm thử'.normalize('NFD'), 'Kiểm thử'.normalize('NFC'))).toBe(true)
    expect(sameAgentName('Tester', 'Tester 2')).toBe(false)
  })
})
