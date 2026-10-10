import { describe, expect, it } from 'vitest'
import { agentApiRules, permissionAbove } from './agentApi'
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
