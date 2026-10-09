import { describe, expect, it } from 'vitest'
import {
  applyReplacements,
  contextTerms,
  fixTerms,
  formatReplacements,
  isCodeTerm,
  parseReplacements,
  pickHotwords,
  postProcess,
  spokenCommands,
  termWords
} from './voiceVocab'

describe('từ code', () => {
  it('isCodeTerm: camelCase / PascalCase nhiều khúc / snake / VIẾT HOA / tên file; từ thường thì không', () => {
    for (const t of ['handleClick', 'AgentGrid', 'user_id', 'README', 'App.tsx', 'package.json', 'XMLParser']) expect(isCodeTerm(t)).toBe(true)
    for (const t of ['zustand', 'Settings', 'test', 'ab', 'pull request', 'a.b', 'xin chào']) expect(isCodeTerm(t)).toBe(false)
  })

  it('termWords tách đúng chữ', () => {
    expect(termWords('normalizeOrigin')).toEqual(['normalize', 'origin'])
    expect(termWords('XMLParser')).toEqual(['xml', 'parser'])
    expect(termWords('App.tsx')).toEqual(['app', 'tsx'])
    expect(termWords('user_id')).toEqual(['user', 'id'])
  })

  it('contextTerms: từ code trong terminal, mới nhất trước, không trùng; bỏ mã băm, lấy tên file trong đường dẫn', () => {
    const screen = 'Đã sửa handleClick trong src/App.tsx\n● Update(src/main/voice.ts) commit 3f9a2b1c\nGọi lại handleClick, xem AgentGrid'
    expect(contextTerms(screen)).toEqual(['AgentGrid', 'handleClick', 'voice.ts', 'App.tsx'])
    expect(contextTerms('a1b2c3d4e5 deadbeef42 thing')).toEqual([])
  })
})

describe('chọn gợi ý', () => {
  const base = { manual: [], agents: [], context: [], workspace: [], general: [] }

  it('thứ tự: tự thêm → tên agent → trong ô → từ chung → workspace; bỏ trùng không phân biệt hoa thường, bỏ dấu phẩy', () => {
    const out = pickHotwords({
      manual: ['zustand', 'a,b'],
      agents: ['Kiến trúc sư'],
      context: ['handleClick', 'ZUSTAND'],
      general: ['commit'],
      workspace: ['AgentGrid', 'handleclick']
    })
    expect(out).toEqual(['zustand', 'a b', 'Kiến trúc sư', 'handleClick', 'commit', 'AgentGrid'])
  })

  it('giới hạn tổng số mục; từ trong ô tối đa 20 để còn chỗ cho từ chung', () => {
    const many = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${p}${i}x`)
    const out = pickHotwords({ ...base, context: many('ctxItem', 40), general: many('gen', 40), workspace: many('ws', 40) }, 60)
    expect(out).toHaveLength(60)
    expect(out.filter((t) => t.startsWith('ctxItem'))).toHaveLength(20)
    expect(out.filter((t) => t.startsWith('gen')).length).toBeGreaterThanOrEqual(25)
  })
})

describe('sửa chữ sau nhận dạng', () => {
  const terms = ['handleClick', 'normalizeOrigin', 'README', 'GitHub', 'App.tsx', 'JSON', 'user_id']

  it('ghép tên bị tách, sửa hoa thường', () => {
    expect(fixTerms('sửa hàm handle click trong app.tsx', terms)).toBe('sửa hàm handleClick trong App.tsx')
    expect(fixTerms('viết test cho Normalize-Origin, đọc readme rồi push lên git hub', terms)).toBe('viết test cho normalizeOrigin, đọc README rồi push lên GitHub')
    expect(fixTerms('đổi user id thành handleclick.', terms)).toBe('đổi user_id thành handleClick.')
  })

  it('không đụng vào một phần của tên file / từ khác, không đụng từ thường', () => {
    expect(fixTerms('cập nhật package.json và file json', terms)).toBe('cập nhật package.json và file JSON')
    expect(fixTerms('handleClicks và rehandle click', terms)).toBe('handleClicks và rehandle click')
    expect(fixTerms('Sidebar settings', ['Sidebar', 'settings'])).toBe('Sidebar settings')
  })

  it('luật thay từ: khớp trọn cụm, không phân biệt hoa thường, cụm dài trước, giữ chữ có dấu', () => {
    const rules = [
      { from: 'hen đồ click', to: 'handleClick' },
      { from: 'đồ', to: 'X' },
      { from: 'su ta', to: 'zustand' }
    ]
    expect(applyReplacements('Sửa Hen  Đồ Click rồi cài su ta', rules)).toBe('Sửa handleClick rồi cài zustand')
    expect(applyReplacements('đồ chơi', rules)).toBe('X chơi')
    expect(applyReplacements('susu tata', rules)).toBe('susu tata')
    // Chữ NFD (tổ hợp dấu) vẫn khớp.
    expect(applyReplacements('hen đồ click'.normalize('NFD'), rules)).toBe('handleClick')
  })

  it('"xuống dòng" → xuống dòng thật; giữ khi nói về ký tự xuống dòng', () => {
    expect(spokenCommands('Dòng một, xuống dòng. dòng hai')).toBe('Dòng một\nDòng hai')
    expect(spokenCommands('Thêm ký tự xuống dòng vào cuối')).toBe('Thêm ký tự xuống dòng vào cuối')
    expect(spokenCommands('bỏ dấu xuống dòng')).toBe('bỏ dấu xuống dòng')
    expect(spokenCommands('xuống dòng tiếp theo')).toBe('\nTiếp theo')
  })

  it('postProcess: luật người dùng thắng, rồi sửa từ code, lệnh nói tắt được', () => {
    const o = { terms, rules: [{ from: 'hen đồ click', to: 'handleClick' }], commands: true }
    expect(postProcess('sửa hen đồ click xuống dòng rồi chạy normalize origin', o)).toBe('sửa handleClick\nRồi chạy normalizeOrigin')
    expect(postProcess('a xuống dòng b', { ...o, commands: false })).toBe('a xuống dòng b')
  })

  it('luật dạng chữ trong Cài đặt: "sai → đúng" (cả -> và =>), bỏ dòng hỏng', () => {
    const rules = parseReplacements('hen đồ click → handleClick\nsu ta -> zustand\n  \nkhông có mũi tên\n => x\na=>b')
    expect(rules).toEqual([
      { from: 'hen đồ click', to: 'handleClick' },
      { from: 'su ta', to: 'zustand' },
      { from: 'a', to: 'b' }
    ])
    expect(parseReplacements(formatReplacements(rules))).toEqual(rules)
  })
})
