import { describe, expect, it } from 'vitest'
import type { VaultActivity } from '@shared/types'
import { agentColor, touchesByNote } from './activity'
import { syncAction, wikilinkQuery } from './editSync'

describe('syncAction', () => {
  it('không ai sửa bên ngoài / chính lần lưu của mình', () => {
    expect(syncAction('a', 'a', 'a')).toBe('same')
    expect(syncAction('a', 'a', 'a đang gõ')).toBe('same')
  })
  it('bên ngoài đổi đúng thành chữ đang soạn → coi như đã lưu', () => {
    expect(syncAction('b', 'a', 'b')).toBe('adopt')
  })
  it('bên ngoài đổi, mình chưa gõ → nạp bản mới', () => {
    expect(syncAction('b', 'a', 'a')).toBe('reload')
  })
  it('cả hai cùng đổi, hoặc file bị xoá → hỏi', () => {
    expect(syncAction('b', 'a', 'c')).toBe('conflict')
    expect(syncAction(null, 'a', 'a')).toBe('conflict')
    expect(syncAction(null, 'a', 'c')).toBe('conflict')
  })
})

describe('wikilinkQuery', () => {
  it('đang gõ trong [[…', () => {
    expect(wikilinkQuery('xem [[Kan')).toBe('Kan')
    expect(wikilinkQuery('xem [[')).toBe('')
    expect(wikilinkQuery('xem [[Kanban]] và')).toBeNull()
    expect(wikilinkQuery('xem [[Kanban|bảng')).toBeNull()
    expect(wikilinkQuery('không có link')).toBeNull()
  })
})

describe('touchesByNote', () => {
  const ev = (agentId: string, rel: string, kind: 'read' | 'write', at: string): VaultActivity => ({ agentId, agentName: agentId.toUpperCase(), rel, kind, at })

  it('mỗi agent một dòng mỗi note; lần ghi giữ chỗ trước lần đọc sau; mới nhất trước; khoá chữ thường', () => {
    const m = touchesByNote([
      ev('a', '_INDEX.md', 'read', '2026-10-09T10:00:00Z'),
      ev('a', '_INDEX.md', 'write', '2026-10-09T10:01:00Z'),
      ev('a', '_index.md', 'read', '2026-10-09T10:02:00Z'),
      ev('b', '_INDEX.md', 'read', '2026-10-09T10:03:00Z')
    ])
    expect(m.get('_index.md')).toEqual([
      { agentId: 'b', agentName: 'B', kind: 'read', at: '2026-10-09T10:03:00Z' },
      { agentId: 'a', agentName: 'A', kind: 'write', at: '2026-10-09T10:01:00Z' }
    ])
  })

  it('lọc theo mốc thời gian', () => {
    const m = touchesByNote([ev('a', 'x.md', 'read', '2026-10-09T10:00:00Z')], Date.parse('2026-10-09T11:00:00Z'))
    expect(m.size).toBe(0)
  })

  it('agentColor ổn định theo id', () => {
    expect(agentColor('abc')).toBe(agentColor('abc'))
    expect(agentColor('abc')).toMatch(/^hsl\(\d+, 70%, 62%\)$/)
  })
})
