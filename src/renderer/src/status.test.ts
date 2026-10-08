import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@shared/types'
import { ago, contextView, formatTokens, localDay, statusView } from './status'

const st = (s: Partial<AgentStatus>): AgentStatus => ({ agentId: 'a', activity: 'working', since: '2026-01-01T00:00:00.000Z', ...s })

describe('contextView / formatTokens', () => {
  const settings = { autoHandoff: true, handoffPercent: 80 }
  const ctx = (used: number, size: number | null) => st({ context: { used, size, at: '' } })

  it('định dạng số token', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(85382)).toBe('85k')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })

  it('chưa có số → không hiện', () => {
    expect(contextView(st({}), settings)).toBeNull()
    expect(contextView(undefined, settings)).toBeNull()
  })

  it('% theo cửa sổ, màu theo khoảng cách tới ngưỡng', () => {
    expect(contextView(ctx(100_000, 1_000_000), settings)).toMatchObject({ text: '10%', tone: 'normal' })
    expect(contextView(ctx(140_000, 200_000), settings)).toMatchObject({ text: '70%', tone: 'warn' })
    expect(contextView(ctx(161_000, 200_000), settings)).toMatchObject({ text: '80%', tone: 'full' })
    // Tắt tự bàn giao: không đỏ (không có gì sắp xảy ra), vẫn vàng khi gần ngưỡng.
    expect(contextView(ctx(190_000, 200_000), { ...settings, autoHandoff: false })).toMatchObject({ tone: 'warn' })
  })

  it('chưa biết kích thước cửa sổ → số token, không màu', () => {
    expect(contextView(ctx(85382, null), settings)).toMatchObject({ text: '85k', tone: 'normal' })
  })

  it('bàn giao hỏng → đánh dấu', () => {
    expect(contextView(st({ handoff: 'failed', context: { used: 1, size: 10, at: '' } }), settings)?.failed).toBe(true)
  })
})

describe('statusView', () => {
  it('đang bàn giao / đang chuyển sang phiên mới (kể cả lúc phiên cũ đã thoát)', () => {
    expect(statusView(true, false, st({ activity: 'working', handoff: 'asking' })).label).toBe('đang viết bàn giao')
    expect(statusView(false, false, st({ activity: 'stopped', handoff: 'restarting' })).label).toBe('đang chuyển sang phiên mới')
    expect(statusView(true, false, st({ activity: 'waiting', reason: 'turn', handoff: 'failed' })).label).toBe('chờ bạn trả lời')
  })

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
