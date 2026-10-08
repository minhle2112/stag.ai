import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@shared/types'
import { ago, localDay, statusView } from './status'

const st = (s: Partial<AgentStatus>): AgentStatus => ({ agentId: 'a', activity: 'working', since: '2026-01-01T00:00:00.000Z', ...s })

describe('statusView', () => {
  it('đang mở phiên ưu tiên hơn mọi thứ', () => {
    expect(statusView(false, true, st({ activity: 'waiting' }))).toMatchObject({ label: 'đang mở phiên', waiting: false })
  })

  it('không chạy → phiên đã dừng (bỏ qua trạng thái cũ còn sót)', () => {
    expect(statusView(false, false, st({ activity: 'waiting', reason: 'turn' }))).toMatchObject({
      label: 'phiên đã dừng',
      waiting: false
    })
  })

  it('đang khởi động (chưa có hook)', () => {
    expect(statusView(true, false, st({ activity: 'starting' }))).toMatchObject({ label: 'đang khởi động', waiting: false })
  })

  it('đang chờ: nhãn theo lý do, mặc định là chờ trả lời', () => {
    expect(statusView(true, false, st({ activity: 'waiting', reason: 'turn' })).label).toBe('chờ bạn trả lời')
    expect(statusView(true, false, st({ activity: 'waiting', reason: 'permission' })).label).toBe('cần bạn duyệt quyền')
    expect(statusView(true, false, st({ activity: 'waiting', reason: 'question' })).label).toBe('đang hỏi bạn')
    expect(statusView(true, false, st({ activity: 'waiting', reason: 'idle' })).label).toBe('chờ bạn lâu rồi')
    expect(statusView(true, false, st({ activity: 'waiting' }))).toMatchObject({ label: 'chờ bạn trả lời', waiting: true })
  })

  it('đang làm: có tên tool thì hiện, tool MCP rút gọn', () => {
    expect(statusView(true, false, undefined)).toMatchObject({ label: 'đang làm', waiting: false })
    expect(statusView(true, false, st({ tool: 'Bash' })).label).toBe('đang chạy Bash')
    expect(statusView(true, false, st({ tool: 'mcp__stag__task_done' })).label).toBe('đang chạy stag · task_done')
    expect(statusView(true, false, st({ tool: 'mcp__a__b__c' })).label).toBe('đang chạy a · b__c')
  })
})

describe('ago', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z')
  const before = (sec: number): string => new Date(now - sec * 1000).toISOString()

  it('các mốc', () => {
    expect(ago(before(0), now)).toBe('vừa xong')
    expect(ago(before(44), now)).toBe('vừa xong')
    expect(ago(before(45), now)).toBe('1 phút')
    expect(ago(before(5 * 60), now)).toBe('5 phút')
    expect(ago(before(2 * 3600), now)).toBe('2 giờ')
    expect(ago(before(3 * 86400), now)).toBe('3 ngày')
  })

  it('mốc ở tương lai (lệch đồng hồ) → vừa xong', () => {
    expect(ago(before(-600), now)).toBe('vừa xong')
  })
})

describe('localDay', () => {
  it('ngày theo giờ địa phương, nhận cả chuỗi ISO và Date', () => {
    const d = new Date(2026, 0, 5, 23, 59)
    expect(localDay(d)).toBe('2026-01-05')
    expect(localDay(d.toISOString())).toBe('2026-01-05')
  })
})
