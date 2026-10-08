import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentStatus, AppSettings } from '@shared/types'
import {
  claudeConfigDir,
  contextPercent,
  HANDOFF_SETTLE_MS,
  HANDOFF_TYPING_MS,
  handoffDue,
  handoffPrompt,
  userStatusLine,
  mergeContext,
  parseStatusLine
} from './context'
import { normalizeSettings } from './settings'

describe('parseStatusLine', () => {
  // Rút gọn theo schema trong docs statusline của Claude Code.
  const body = {
    session_id: 's1',
    model: { id: 'claude-opus-5-5', display_name: 'Opus' },
    context_window: {
      total_input_tokens: 85382,
      context_window_size: 1000000,
      used_percentage: 8,
      current_usage: { input_tokens: 2, output_tokens: 1289, cache_creation_input_tokens: 4560, cache_read_input_tokens: 80820 }
    }
  }

  it('lấy kích thước cửa sổ và token đầu vào (không tính output)', () => {
    expect(parseStatusLine(body)).toEqual({ sessionId: 's1', used: 85382, size: 1000000 })
  })

  it('current_usage null (trước lượt đầu / sau /compact): chỉ có kích thước', () => {
    const b = { ...body, context_window: { context_window_size: 200000, current_usage: null } }
    expect(parseStatusLine(b)).toEqual({ sessionId: 's1', used: null, size: 200000 })
  })

  it('dữ liệu lạ không làm hỏng', () => {
    expect(parseStatusLine(null)).toEqual({ sessionId: null, used: null, size: null })
    expect(parseStatusLine({ context_window: { context_window_size: 'x' } })).toEqual({ sessionId: null, used: null, size: null })
  })
})

describe('mergeContext / contextPercent', () => {
  it('nhận số đo mới hơn, giữ kích thước khi nguồn mới không có', () => {
    const a = mergeContext(undefined, { size: 1000000, used: null, at: '2026-10-08T10:00:00Z' })
    expect(a).toBeUndefined() // chưa có số token thì chưa có gì để hiện
    const b = mergeContext(undefined, { used: 5000, at: '2026-10-08T10:00:00Z' })
    expect(b).toEqual({ used: 5000, size: null, at: '2026-10-08T10:00:00Z' })
    const c = mergeContext(b, { size: 200000, used: null, at: '2026-10-08T10:00:05Z' })
    expect(c).toEqual({ used: 5000, size: 200000, at: '2026-10-08T10:00:00Z' })
    const d = mergeContext(c, { used: 9000, at: '2026-10-08T10:00:06Z' })
    expect(d).toEqual({ used: 9000, size: 200000, at: '2026-10-08T10:00:06Z' })
  })

  it('bỏ số đo cũ hơn số đang có (nguồn tới lệch nhau)', () => {
    const cur = { used: 9000, size: 200000, at: '2026-10-08T10:00:06Z' }
    expect(mergeContext(cur, { used: 100, at: '2026-10-08T09:00:00Z' })).toBe(cur)
  })

  it('% theo kích thước cửa sổ', () => {
    expect(contextPercent({ used: 50000, size: 200000, at: '' })).toBe(25)
    expect(contextPercent({ used: 50000, size: null, at: '' })).toBeNull()
    expect(contextPercent(undefined)).toBeNull()
    expect(contextPercent({ used: 300000, size: 200000, at: '' })).toBe(100)
  })
})

describe('userStatusLine', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'stag-ctx-'))
    await fs.mkdir(join(dir, 'home'), { recursive: true })
    await fs.mkdir(join(dir, 'proj', '.claude'), { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('không file nào có statusLine → null; file hỏng bỏ qua', async () => {
    await fs.writeFile(join(dir, 'home', 'settings.json'), '{"model":"opus"}')
    await fs.writeFile(join(dir, 'proj', '.claude', 'settings.json'), '{hỏng')
    expect(await userStatusLine(join(dir, 'proj'), join(dir, 'home'))).toBeNull()
  })

  it('lấy lệnh theo thứ tự ưu tiên local > dự án > user', async () => {
    const sl = (command: string): string => JSON.stringify({ statusLine: { type: 'command', command } })
    await fs.writeFile(join(dir, 'home', 'settings.json'), sl('user'))
    expect(await userStatusLine(join(dir, 'proj'), join(dir, 'home'))).toBe('user')
    await fs.writeFile(join(dir, 'proj', '.claude', 'settings.json'), sl('project'))
    expect(await userStatusLine(join(dir, 'proj'), join(dir, 'home'))).toBe('project')
    await fs.writeFile(join(dir, 'proj', '.claude', 'settings.local.json'), sl('local'))
    expect(await userStatusLine(join(dir, 'proj'), join(dir, 'home'))).toBe('local')
  })

  it('CLAUDE_CONFIG_DIR đổi thư mục cấu hình', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'D:\\cfg' }, 'C:\\home')).toBe('D:\\cfg')
    expect(claudeConfigDir({}, 'C:\\home')).toBe(join('C:\\home', '.claude'))
  })
})

describe('handoffDue', () => {
  const now = Date.parse('2026-10-08T10:00:00Z')
  const settings: AppSettings = { autoHandoff: true, handoffPercent: 80 }
  const status = (over: Partial<AgentStatus> = {}): AgentStatus => ({
    agentId: 'a',
    activity: 'waiting',
    reason: 'turn',
    since: new Date(now - HANDOFF_SETTLE_MS).toISOString(),
    context: { used: 170000, size: 200000, at: '' },
    ...over
  })
  const idleSince = now - HANDOFF_TYPING_MS

  it('vượt ngưỡng, hết lượt, chờ đủ lâu, không ai gõ → bàn giao', () => {
    expect(handoffDue(settings, status(), idleSince, now)).toBe(true)
    expect(handoffDue(settings, status({ reason: 'idle' }), idleSince, now)).toBe(true)
  })

  it('chưa tới ngưỡng / chưa biết kích thước / tắt tự động → không', () => {
    expect(handoffDue(settings, status({ context: { used: 150000, size: 200000, at: '' } }), idleSince, now)).toBe(false)
    expect(handoffDue(settings, status({ context: { used: 170000, size: null, at: '' } }), idleSince, now)).toBe(false)
    expect(handoffDue({ ...settings, autoHandoff: false }, status(), idleSince, now)).toBe(false)
  })

  it('agent đang làm / đang hỏi / xin quyền / bị ngắt → không chen vào', () => {
    expect(handoffDue(settings, status({ activity: 'working', reason: undefined }), idleSince, now)).toBe(false)
    for (const reason of ['question', 'permission', 'interrupted'] as const)
      expect(handoffDue(settings, status({ reason }), idleSince, now)).toBe(false)
  })

  it('vừa hết lượt, hoặc người dùng vừa gõ phím → chờ thêm', () => {
    expect(handoffDue(settings, status({ since: new Date(now - 1000).toISOString() }), idleSince, now)).toBe(false)
    expect(handoffDue(settings, status(), now - 2000, now)).toBe(false)
  })

  it('đang / đã bàn giao (kể cả hỏng) trong phiên này → không nhờ lại', () => {
    for (const handoff of ['asking', 'restarting', 'failed'] as const)
      expect(handoffDue(settings, status({ handoff }), idleSince, now)).toBe(false)
  })
})

describe('handoffPrompt', () => {
  it('một dòng, nêu % và ngưỡng, nhắc tool session_handoff', () => {
    const p = handoffPrompt(83.4, 80)
    expect(p).not.toMatch(/[\r\n]/)
    expect(p).toContain('83% full (handoff threshold 80%)')
    expect(p).toContain('session_handoff')
    expect(handoffPrompt(null, null)).toContain('the user asked')
  })
})

describe('normalizeSettings', () => {
  it('thiếu / sai kiểu → mặc định; % kẹp trong khoảng và làm tròn', () => {
    expect(normalizeSettings(undefined)).toEqual({ autoHandoff: true, handoffPercent: 80 })
    expect(normalizeSettings({ autoHandoff: 'yes', handoffPercent: '50' })).toEqual({ autoHandoff: true, handoffPercent: 80 })
    expect(normalizeSettings({ autoHandoff: false, handoffPercent: 99 })).toEqual({ autoHandoff: false, handoffPercent: 95 })
    expect(normalizeSettings({ handoffPercent: 5 }).handoffPercent).toBe(20)
    expect(normalizeSettings({ handoffPercent: 66.6 }).handoffPercent).toBe(67)
  })
})
