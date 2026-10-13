import { describe, expect, it } from 'vitest'
import { isSoftNewlineKey, SOFT_NEWLINE, wantsSoftNewline } from './terminalKeys'

const key = (over: Partial<KeyboardEvent> = {}) => ({
  key: 'Enter',
  shiftKey: true,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  ...over
})

describe('isSoftNewlineKey', () => {
  it('Shift+Enter → xuống dòng', () => {
    expect(isSoftNewlineKey(key())).toBe(true)
  })

  it('Enter thường vẫn gửi tin', () => {
    expect(isSoftNewlineKey(key({ shiftKey: false }))).toBe(false)
  })

  it('kèm Ctrl / Alt / Win thì bỏ qua', () => {
    expect(isSoftNewlineKey(key({ ctrlKey: true }))).toBe(false)
    expect(isSoftNewlineKey(key({ altKey: true }))).toBe(false)
    expect(isSoftNewlineKey(key({ metaKey: true }))).toBe(false)
  })

  it('đang gõ bộ gõ (IME) thì để xterm xử lý', () => {
    expect(isSoftNewlineKey(key({ isComposing: true }))).toBe(false)
  })

  it('phím khác không phải Enter', () => {
    expect(isSoftNewlineKey(key({ key: 'a' }))).toBe(false)
  })
})

describe('wantsSoftNewline', () => {
  it('chỉ ô Claude Code / Codex', () => {
    expect(wantsSoftNewline('claude')).toBe(true)
    expect(wantsSoftNewline('codex')).toBe(true)
    expect(wantsSoftNewline('terminal')).toBe(false)
    expect(wantsSoftNewline('external')).toBe(false)
  })
})

it('chuỗi gửi đi là Alt+Enter (ESC CR)', () => {
  expect(SOFT_NEWLINE).toBe('\x1b\r')
})
