import { describe, expect, it } from 'vitest'
import { agentApiRules, handoffBody, handoffMessage, handoffOpening, permissionAbove } from './agentApi'
import { normalizeAgentApi, normalizeOverrides, normalizeSettings, patchApp, resolveAgentApi } from './settings'
import { DEFAULT_SETTINGS } from './types'

describe('Cài đặt Agent API', () => {
  it('mặc định bật hết; giá trị sai → mặc định', () => {
    expect(normalizeAgentApi({})).toEqual({ manage: true, message: true, confirmCreate: true })
    expect(normalizeAgentApi({ manage: 'no', message: false })).toEqual({ manage: true, message: false, confirmCreate: true })
    expect(normalizeSettings({ version: 2 }).app.agentApi).toEqual({ manage: true, message: true, confirmCreate: true })
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
    expect(resolveAgentApi(s, 'w1', 'a1')).toEqual({ manage: true, message: false, confirmCreate: false })
    expect(resolveAgentApi(s, 'w1', 'a2')).toEqual({ manage: false, message: true, confirmCreate: false })
    expect(resolveAgentApi(s, null, null)).toEqual({ manage: true, message: true, confirmCreate: false })
  })

  it('patchApp sửa từng khoá', () => {
    expect(patchApp(DEFAULT_SETTINGS.app, { agentApi: { message: false } }).agentApi).toEqual({ manage: true, message: false, confirmCreate: true })
  })
})

describe('agentApiRules / permissionAbove', () => {
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
