import { describe, expect, it } from 'vitest'
import { checkCreateInput, parseKind } from './agentApi'

const defaults = (): 'acceptEdits' => 'acceptEdits'

describe('parseKind', () => {
  it('nhận claude / codex / terminal / external:<id>', () => {
    expect(parseKind('Claude Code')).toEqual({ kind: 'claude' })
    expect(parseKind(' codex ')).toEqual({ kind: 'codex' })
    expect(parseKind('terminal')).toEqual({ kind: 'terminal' })
    expect(parseKind('external:aider')).toEqual({ kind: 'external', adapterId: 'aider' })
    expect(parseKind('gemini')).toBeNull()
  })
})

describe('checkCreateInput', () => {
  it('chuẩn hoá: quyền mặc định theo adapter, mở ô mặc định', () => {
    const r = checkCreateInput({ name: ' Tester ', role: ' Viết test ', kind: 'codex', model: 'gpt-5.6-terra', effort: 'HIGH', task: ' viết test cho src/x ' }, defaults)
    expect(r).toEqual({
      draft: { name: 'Tester', role: 'Viết test', kind: 'codex', model: 'gpt-5.6-terra', effort: 'high', permissionMode: 'acceptEdits', task: 'viết test cho src/x', open: true }
    })
  })

  it('quyền ghi rõ thắng mặc định; sai tên quyền → lỗi', () => {
    const ok = checkCreateInput({ name: 'A', kind: 'claude', permission_mode: 'plan' }, defaults)
    expect('draft' in ok && ok.draft.permissionMode).toBe('plan')
    expect(checkCreateInput({ name: 'A', kind: 'claude', permission_mode: 'yolo' }, defaults)).toHaveProperty('error')
  })

  it('terminal: không model, không việc, không vai trò', () => {
    expect(checkCreateInput({ name: 'Sh', kind: 'terminal', task: 'npm test' }, defaults)).toHaveProperty('error')
    expect(checkCreateInput({ name: 'Sh', kind: 'terminal', model: 'opus' }, defaults)).toHaveProperty('error')
    const r = checkCreateInput({ name: 'Sh', kind: 'terminal', role: 'shell' }, defaults)
    expect(r).toEqual({ draft: expect.objectContaining({ kind: 'terminal', role: '', permissionMode: 'default' }) })
  })

  it('loại / model / effort sai, quá dài → lỗi', () => {
    expect(checkCreateInput({ name: 'A', kind: 'gemini' }, defaults)).toHaveProperty('error')
    expect(checkCreateInput({ name: 'A', kind: 'claude', model: 'op us' }, defaults)).toHaveProperty('error')
    expect(checkCreateInput({ name: 'A', kind: 'claude', effort: 'very-high' }, defaults)).toHaveProperty('error')
    expect(checkCreateInput({ name: 'A', kind: 'external:aider', model: 'x' }, defaults)).toHaveProperty('error')
    expect(checkCreateInput({ name: 'A', kind: 'claude', role: 'x'.repeat(301) }, defaults)).toHaveProperty('error')
  })
})
