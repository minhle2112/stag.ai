import { describe, expect, it } from 'vitest'
import {
  formatAgo,
  formatDuration,
  formatReset,
  msBeforeReset,
  pacePercent,
  parseUsage,
  planLabel,
  SESSION_MS,
  usageLevel,
  usageWarning,
  WEEK_MS,
  type ClaudeUsage
} from './claudeUsage'

// Rút gọn từ câu trả lời thật của /api/oauth/usage (2026-10-12).
const REAL = {
  five_hour: { utilization: 22, resets_at: '2026-10-12T16:19:59.646698+00:00', limit_dollars: null, locked_reason: null },
  seven_day: { utilization: 17, resets_at: '2026-10-17T20:59:59.646725+00:00', limit_dollars: null, locked_reason: null },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  iguana_necktie: { utilization: 0, resets_at: '2026-11-05T07:59:00+00:00', limit_dollars: 250 },
  extra_usage: { is_enabled: false },
  limits: [
    { kind: 'session', group: 'session', percent: 22, severity: 'normal', resets_at: '2026-10-12T16:19:59.646698+00:00', scope: null },
    { kind: 'weekly_all', group: 'weekly', percent: 17, severity: 'normal', resets_at: '2026-10-17T20:59:59.646725+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: 0,
      severity: 'normal',
      resets_at: '2026-10-17T21:00:00+00:00',
      scope: { model: { id: null, display_name: 'Fable' }, surface: null }
    }
  ]
}

describe('parseUsage', () => {
  it('reads the real response shape', () => {
    expect(parseUsage(REAL)).toEqual({
      session: { percent: 22, resetsAt: Date.parse('2026-10-12T16:19:59.646Z'), locked: false },
      week: { percent: 17, resetsAt: Date.parse('2026-10-17T20:59:59.646Z'), locked: false },
      models: [{ label: 'Fable', percent: 0, resetsAt: Date.parse('2026-10-17T21:00:00Z'), locked: false }]
    })
  })

  it('reads seven_day_opus / sonnet and does not duplicate a model also in limits', () => {
    const u = parseUsage({
      ...REAL,
      seven_day_opus: { utilization: 64.4, resets_at: '2026-10-17T21:00:00Z', locked_reason: null },
      limits: [{ kind: 'weekly_scoped', percent: 64, resets_at: '2026-10-17T21:00:00Z', scope: { model: { display_name: 'opus' } } }]
    })
    expect(u?.models).toEqual([{ label: 'Opus', percent: 64, resetsAt: Date.parse('2026-10-17T21:00:00Z'), locked: false }])
  })

  it('falls back to the limits array when the old fields are missing', () => {
    const u = parseUsage({ limits: REAL.limits })
    expect(u?.session?.percent).toBe(22)
    expect(u?.week?.percent).toBe(17)
  })

  it('clamps percent, marks locked windows and tolerates bad dates', () => {
    const u = parseUsage({ five_hour: { utilization: 130, resets_at: 'nope', locked_reason: 'rate_limited' }, seven_day: null })
    expect(u).toEqual({ session: { percent: 100, resetsAt: null, locked: true }, week: null, models: [] })
  })

  it('returns null for anything unreadable', () => {
    expect(parseUsage(null)).toBeNull()
    expect(parseUsage([])).toBeNull()
    expect(parseUsage({ error: { type: 'authentication_error' } })).toBeNull()
    expect(parseUsage({ five_hour: { utilization: '22' } })).toBeNull()
  })
})

describe('planLabel', () => {
  it('names Max with its multiplier, Pro and unknowns', () => {
    expect(planLabel('max', 'default_claude_max_5x')).toBe('Max 5×')
    expect(planLabel('max', 'default_claude_max_20x')).toBe('Max 20×')
    expect(planLabel('max', undefined)).toBe('Max')
    expect(planLabel('pro', 'default_claude_ai')).toBe('Pro')
    expect(planLabel(undefined, undefined)).toBe('')
  })
})

describe('usageLevel', () => {
  it('uses teal below 70, amber 70–89, red from 90', () => {
    expect(usageLevel(0)).toBe('ok')
    expect(usageLevel(69)).toBe('ok')
    expect(usageLevel(70)).toBe('high')
    expect(usageLevel(89)).toBe('high')
    expect(usageLevel(90)).toBe('max')
    expect(usageLevel(100)).toBe('max')
    expect(usageLevel(null)).toBe('na')
  })
})

describe('pace', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')

  it('is the elapsed share of the window', () => {
    expect(pacePercent(now + 2.5 * 3600_000, SESSION_MS, now)).toBe(50)
    expect(pacePercent(now + WEEK_MS, WEEK_MS, now)).toBe(0)
    expect(pacePercent(now - 1000, SESSION_MS, now)).toBe(100)
    expect(pacePercent(null, SESSION_MS, now)).toBeNull()
  })

  it('projects how early the limit is hit at the current rate', () => {
    // 1 giờ đã trôi, dùng 40% → chạm 100% sau 1.5 giờ nữa, reset sau 4 giờ → chạm sớm 2.5 giờ.
    expect(msBeforeReset({ percent: 40, resetsAt: now + 4 * 3600_000, locked: false }, SESSION_MS, now)).toBe(2.5 * 3600_000)
    // Dùng chậm hơn nhịp → không chạm.
    expect(msBeforeReset({ percent: 10, resetsAt: now + 4 * 3600_000, locked: false }, SESSION_MS, now)).toBeNull()
    expect(msBeforeReset({ percent: 100, resetsAt: now + 3600_000, locked: false }, SESSION_MS, now)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(30_000)).toBe('dưới 1 phút')
    expect(formatDuration(47 * 60_000)).toBe('47 phút')
    expect(formatDuration(2 * 3600_000 + 13 * 60_000)).toBe('2 giờ 13 phút')
    expect(formatDuration(3 * 3600_000)).toBe('3 giờ')
    expect(formatDuration(3 * 86400_000 + 4 * 3600_000)).toBe('3 ngày 4 giờ')
  })

  it('formats reset times: relative under a day, weekday + local time beyond', () => {
    const now = new Date(2026, 9, 12, 17, 0).getTime() // CN 12/10
    expect(formatReset(now + 47 * 60_000, now)).toBe('sau 47 phút')
    expect(formatReset(new Date(2026, 9, 15, 9, 0).getTime(), now)).toBe('T5 09:00')
    expect(formatReset(now - 1, now)).toBe('đang reset')
    expect(formatReset(null, now)).toBe('')
  })

  it('formats the last update', () => {
    const now = Date.now()
    expect(formatAgo(now - 10_000, now)).toBe('Cập nhật vừa xong')
    expect(formatAgo(now - 3 * 60_000, now)).toBe('Cập nhật 3 phút trước')
    expect(formatAgo(null, now)).toBe('Chưa cập nhật')
  })
})

describe('usageWarning', () => {
  const now = Date.parse('2026-10-12T12:00:00Z')
  const w = (percent: number, resetIn: number, locked = false): ClaudeUsage['session'] => ({ percent, resetsAt: now + resetIn, locked })

  it('warns in red when a limit is hit', () => {
    expect(usageWarning({ session: w(100, 18 * 60_000), week: w(92, WEEK_MS / 2), models: [] }, now)).toEqual({
      tone: 'danger',
      text: expect.stringContaining('Đã chạm giới hạn phiên 5 giờ (reset sau 18 phút)')
    })
    expect(usageWarning({ session: w(40, 3600_000), week: w(60, 86400_000, true), models: [] }, now)?.text).toContain('giới hạn tuần')
    expect(usageWarning({ session: w(10, 3600_000), week: w(10, 86400_000), models: [{ label: 'Opus', ...w(100, 86400_000)! }] }, now)?.text).toContain(
      'Opus'
    )
  })

  it('warns in amber from 70% when running ahead of pace', () => {
    // 3 giờ đã trôi, 83% → chạm sau ~37 phút, reset sau 2 giờ.
    const r = usageWarning({ session: w(83, 2 * 3600_000), week: w(20, WEEK_MS / 2), models: [] }, now)
    expect(r?.tone).toBe('amber')
    expect(r?.text).toContain('phiên 5 giờ trước giờ reset khoảng 1 giờ')
  })

  it('stays quiet when on pace or under 70%', () => {
    expect(usageWarning({ session: w(72, 30 * 60_000), week: w(20, WEEK_MS / 2), models: [] }, now)).toBeNull()
    expect(usageWarning({ session: w(50, 4 * 3600_000), week: null, models: [] }, now)).toBeNull()
  })
})
