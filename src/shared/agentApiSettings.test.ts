import { describe, expect, it } from 'vitest'
import { agentApiRules, handoffBody, handoffMessage, handoffOpening, permissionAbove } from './agentApi'
import { normalizeAgentApi, normalizeMemory, normalizeOverrides, normalizeSettings, patchApp, resolveAgentApi, resolveMemory } from './settings'
import { DEFAULT_MEMORY, DEFAULT_SETTINGS } from './types'

describe('Cài đặt Agent API', () => {
  it('mặc định bật hết; giá trị sai → mặc định', () => {
    expect(normalizeAgentApi({})).toEqual({ manage: true, message: true, confirmCreate: true, read: true })
    expect(normalizeAgentApi({ manage: 'no', message: false })).toEqual({ manage: true, message: false, confirmCreate: true, read: true })
    expect(normalizeSettings({ version: 2 }).app.agentApi).toEqual({ manage: true, message: true, confirmCreate: true, read: true })
  })

  it('ghi đè chỉ giữ khoá boolean; rỗng thì bỏ', () => {
    expect(normalizeOverrides({ agentApi: { message: false, x: true, manage: 1 } })).toEqual({ agentApi: { message: false } })
    expect(normalizeOverrides({ agentApi: {} })).toBeNull()
  })

  it('từng khoá: agent → workspace → app', () => {
    const s = normalizeSettings({
      version: 2,
      app: { agentApi: { confirmCreate: false } },
      workspaces: { w1: { agentApi: { manage: false } } },
      agents: { a1: { agentApi: { manage: true, message: false } } }
    })
    expect(resolveAgentApi(s, 'w1', 'a1')).toEqual({ manage: true, message: false, confirmCreate: false, read: true })
    expect(resolveAgentApi(s, 'w1', 'a2')).toEqual({ manage: false, message: true, confirmCreate: false, read: true })
    expect(resolveAgentApi(s, null, null)).toEqual({ manage: true, message: true, confirmCreate: false, read: true })
  })

  it('patchApp sửa từng khoá', () => {
    expect(patchApp(DEFAULT_SETTINGS.app, { agentApi: { message: false } }).agentApi).toEqual({ manage: true, message: false, confirmCreate: true, read: true })
  })
})

describe('Cài đặt bộ nhớ (nhật ký việc, note agent)', () => {
  it('mặc định, kẹp khoảng, ghi đè từng khoá agent → workspace → app', () => {
    expect(normalizeSettings({ version: 2 }).app.memory).toEqual(DEFAULT_MEMORY)
    expect(normalizeMemory({ noteBudgetKb: 1000, keepWorkDone: 0, workLog: 'x' })).toEqual({ ...DEFAULT_MEMORY, noteBudgetKb: 64, keepWorkDone: 3 })
    expect(normalizeOverrides({ memory: { workLog: false, noteBudgetKb: 1, junk: 1 } })).toEqual({ memory: { workLog: false, noteBudgetKb: 2 } })
    expect(normalizeOverrides({ memory: {} })).toBeNull()
    const s = normalizeSettings({
      version: 2,
      app: { memory: { keepWorkDone: 20 } },
      workspaces: { w1: { memory: { workLog: false } } },
      agents: { a1: { memory: { workLog: true, noteBudgetKb: 4 } } }
    })
    expect(resolveMemory(s, 'w1', 'a1')).toEqual({ ...DEFAULT_MEMORY, workLog: true, agentWorkDone: true, noteBudgetKb: 4, keepWorkDone: 20, agentTools: 'full' })
    expect(resolveMemory(s, 'w1', 'a2')).toEqual({ ...DEFAULT_MEMORY, workLog: false, agentWorkDone: true, noteBudgetKb: 8, keepWorkDone: 20, agentTools: 'full' })
    expect(patchApp(DEFAULT_SETTINGS.app, { memory: { agentWorkDone: false } }).memory).toEqual({ ...DEFAULT_MEMORY, agentWorkDone: false })
  })

  it('tool bộ nhớ cho agent: full / read / off, giá trị lạ về mặc định, ghi đè theo agent', () => {
    expect(DEFAULT_MEMORY.agentTools).toBe('full')
    expect(normalizeMemory({ agentTools: 'nope' }).agentTools).toBe('full')
    expect(normalizeOverrides({ memory: { agentTools: 'read' } })).toEqual({ memory: { agentTools: 'read' } })
    expect(normalizeOverrides({ memory: { agentTools: 'x' } })).toBeNull()
    const s = normalizeSettings({ version: 2, workspaces: { w1: { memory: { agentTools: 'read' } } }, agents: { a1: { memory: { agentTools: 'off' } } } })
    expect(resolveMemory(s, 'w1', 'a1').agentTools).toBe('off')
    expect(resolveMemory(s, 'w1', 'a2').agentTools).toBe('read')
  })
})

describe('agentApiRules / permissionAbove', () => {
  it('nhóm read: nói về agent_status / agent_log, tắt thì không', () => {
    expect(agentApiRules({ manage: true, message: true })).toContain('agent_log(')
    expect(agentApiRules({ manage: true, message: true, read: false })).not.toContain('agent_status')
  })

  it('câu về thẻ xác nhận theo công tắc "Hỏi bạn trước…" (confirmCreate)', () => {
    expect(agentApiRules({ manage: true, message: true })).toContain('stag.ai shows the user a confirm card')
    expect(agentApiRules({ manage: true, message: true, confirmCreate: true })).toContain('stag.ai shows the user a confirm card')
    const off = agentApiRules({ manage: true, message: true, confirmCreate: false })
    expect(off).not.toContain('shows the user a confirm card')
    expect(off).toContain('act right away without asking')
  })

  it('luật phiên theo nhóm bật', () => {
    const all = agentApiRules({ manage: true, message: true })
    expect(all).toContain('agent_create(')
    expect(all).toContain('agent_send(')
    expect(all).toContain('NOT from the user')
    const none = agentApiRules({ manage: false, message: false })
    expect(none).not.toContain('agent_create(')
    expect(none).not.toContain('agent_send(')
    expect(none).toContain('Settings → Agent API')
    // Luôn dặn: tin của agent khác không phải lời người dùng.
    expect(none).toContain('NOT from the user')
  })

  it('thứ bậc quyền', () => {
    expect(permissionAbove('auto', 'default')).toBe(true)
    expect(permissionAbove('acceptEdits', 'acceptEdits')).toBe(false)
    expect(permissionAbove('plan', 'default')).toBe(false)
  })
})

describe('handoffBody / handoffMessage / handoffOpening', () => {
  it('nói rõ thẻ đã chuyển (không task_start lại) hoặc chưa có thẻ; đánh dấu không phải người dùng', () => {
    const withCard = handoffBody('Lead', 'Left: tests', { title: 'Sửa divide', scope: 'src/math.js' })
    expect(withCard).toContain('task card "Sửa divide" (scope: src/math.js) is now yours')
    expect(withCard).toContain('do not call task_start')
    expect(withCard.endsWith('Handoff:\nLeft: tests')).toBe(true)
    expect(handoffBody('Lead', 's')).toContain('call task_start once')
    const msg = handoffMessage('Lead', withCard)
    expect(msg.startsWith('[stag.ai] Handoff from agent "Lead"')).toBe(true)
    expect(msg).toContain('NOT the user')
    expect(handoffOpening('Lead', withCard)).toContain("continuing Lead's work")
    expect(agentApiRules({ manage: false, message: true })).toContain('agent_handoff(name, summary)')
    expect(agentApiRules({ manage: false, message: false })).not.toContain('agent_handoff')
  })
})
