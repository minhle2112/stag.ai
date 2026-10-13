import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} }, nativeTheme: { themeSource: 'system', shouldUseDarkColors: true, on: () => {} } }))

import { parseAppsUseLightTheme, planClaudeTheme, setJsonKey } from './theme'
import { flipTheme, resolveTheme, themeState } from '@shared/theme'

describe('planClaudeTheme', () => {
  it('lần đầu bật, terminal sáng: ghi light-ansi và nhớ theme cũ (chưa đặt)', () => {
    expect(planClaudeTheme(null, null, true, 'light')).toEqual({ write: 'light-ansi', backup: { original: null, applied: 'light-ansi' } })
  })

  it('terminal tối và người dùng chưa đặt / đang dùng theme tối: không đụng file', () => {
    expect(planClaudeTheme(null, null, true, 'dark')).toEqual({ backup: { original: null, applied: null } })
    expect(planClaudeTheme('dark-daltonized', null, true, 'dark')).toEqual({ backup: { original: 'dark-daltonized', applied: 'dark-daltonized' } })
    // `auto` theo nền terminal: giữ, kể cả khi người dùng tự đặt sau lần app ghi light-ansi.
    expect(planClaudeTheme('auto', { original: null, applied: 'light-ansi' }, true, 'dark')).toEqual({ backup: { original: 'auto', applied: 'auto' } })
  })

  it('terminal tối nhưng theme cũ là sáng: dark-ansi', () => {
    expect(planClaudeTheme('light', null, true, 'dark')).toEqual({ write: 'dark-ansi', backup: { original: 'light', applied: 'dark-ansi' } })
  })

  it('sáng rồi tối: trả lại theme cũ (xoá khoá nếu trước đó chưa đặt)', () => {
    const b = { original: null, applied: 'light-ansi' }
    expect(planClaudeTheme('light-ansi', b, true, 'dark')).toEqual({ write: null, backup: { original: null, applied: null } })
  })

  it('người dùng tự đổi theme sau lần ghi trước: lấy giá trị đó làm theme cũ', () => {
    const b = { original: null, applied: 'light-ansi' }
    expect(planClaudeTheme('light-daltonized', b, true, 'light')).toEqual({
      write: 'light-ansi',
      backup: { original: 'light-daltonized', applied: 'light-ansi' }
    })
  })

  it('tắt: trả lại theme cũ, chỉ khi khoá vẫn là giá trị app đã ghi', () => {
    const b = { original: 'dark', applied: 'light-ansi' }
    expect(planClaudeTheme('light-ansi', b, false, 'light')).toEqual({ write: 'dark', backup: null })
    expect(planClaudeTheme('light', b, false, 'light')).toEqual({ backup: null })
    expect(planClaudeTheme(null, null, false, 'light')).toEqual({ backup: null })
  })
})

describe('setJsonKey', () => {
  it('giữ thứ tự khoá, thụt lề 2 và dòng trống cuối', () => {
    const text = '{\n  "numStartups": 3,\n  "theme": "dark",\n  "projects": {\n    "a": 1\n  }\n}\n'
    expect(setJsonKey(text, 'theme', 'light-ansi')).toBe('{\n  "numStartups": 3,\n  "theme": "light-ansi",\n  "projects": {\n    "a": 1\n  }\n}\n')
  })

  it('thêm khoá mới ở cuối, xoá khoá khi null, giữ CRLF và file không thụt lề', () => {
    expect(setJsonKey('{\r\n  "a": 1\r\n}', 'theme', 'light-ansi')).toBe('{\r\n  "a": 1,\r\n  "theme": "light-ansi"\r\n}')
    expect(setJsonKey('{"a":1,"theme":"x"}', 'theme', null)).toBe('{"a":1}')
  })

  it('không phải object → ném lỗi (không ghi đè file lạ)', () => {
    expect(() => setJsonKey('[1]', 'theme', 'x')).toThrow()
    expect(() => setJsonKey('{bad', 'theme', 'x')).toThrow()
  })
})

describe('màu Windows / chế độ', () => {
  it('đọc AppsUseLightTheme', () => {
    expect(parseAppsUseLightTheme('\r\nHKEY_CURRENT_USER\\...\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    0x1\r\n')).toBe(false)
    expect(parseAppsUseLightTheme('    AppsUseLightTheme    REG_DWORD    0x0')).toBe(true)
    expect(parseAppsUseLightTheme('ERROR')).toBeNull()
  })

  it('Theo Windows, terminal luôn tối, đổi nhanh', () => {
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
    expect(themeState('light', true, false)).toEqual({ pref: 'light', theme: 'light', windowsDark: true, terminal: 'dark' })
    expect(themeState('system', false, true).terminal).toBe('light')
    expect(flipTheme('dark')).toBe('light')
    expect(flipTheme('light')).toBe('dark')
  })
})
