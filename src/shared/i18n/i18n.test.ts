import { afterEach, describe, expect, it } from 'vitest'
import { vi as viDict } from './vi'
import { en as enDict } from './en'
import { fmtRelative, localeFromSystem, setLocale, t, translate } from '.'
import type { Entry } from './types'

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const forms = (e: Entry): string[] => (typeof e === 'string' ? [e] : [e.one, e.other])

describe('i18n dictionaries', () => {
  afterEach(() => setLocale('vi'))

  it('English has exactly the Vietnamese namespaces and keys', () => {
    expect(Object.keys(enDict).sort()).toEqual(Object.keys(viDict).sort())
    const missing: string[] = []
    for (const [ns, keys] of Object.entries(viDict)) {
      const enNs = (enDict as Record<string, Record<string, Entry>>)[ns]
      for (const k of Object.keys(keys)) if (!(k in enNs)) missing.push(`${ns}.${k}`)
      for (const k of Object.keys(enNs)) if (!(k in keys)) missing.push(`extra ${ns}.${k}`)
    }
    expect(missing).toEqual([])
  })

  it('every English string uses the same {placeholders} and is not empty', () => {
    const bad: string[] = []
    for (const [ns, keys] of Object.entries(viDict) as [string, Record<string, string>][]) {
      const enNs = (enDict as Record<string, Record<string, Entry>>)[ns]
      for (const [k, v] of Object.entries(keys)) {
        const e = enNs[k]
        if (e === undefined) continue
        const want = placeholders(v)
        for (const f of forms(e)) {
          if (!f.trim()) bad.push(`${ns}.${k}: empty`)
          // Dạng số ít tiếng Anh được bỏ {count} ("1 reply" viết thẳng số 1 cũng được), dạng khác thì phải đủ.
          const got = placeholders(f)
          const need = typeof e !== 'string' && f === e.one ? want.filter((p) => p !== 'count') : want
          if (need.some((p) => !got.includes(p)) || got.some((p) => !want.includes(p))) bad.push(`${ns}.${k}: {${got}} vs vi {${want}}`)
        }
        if (typeof e !== 'string' && !want.includes('count')) bad.push(`${ns}.${k}: plural needs {count} in the Vietnamese string`)
      }
    }
    expect(bad).toEqual([])
  })

  it('translates with params, English plurals and locale numbers', () => {
    expect(t('common.errorWith', { message: 'x' })).toBe('Lỗi: x')
    setLocale('en')
    expect(t('common.errorWith', { message: 'x' })).toBe('Error: x')
    expect(translate('en', 'missing.key')).toBe('missing.key')
    expect(fmtRelative(Date.now() - 5 * 60_000)).toBe('5 minutes ago')
    setLocale('vi')
    expect(fmtRelative(Date.now() - 5 * 60_000)).toBe('5 phút trước')
    expect(fmtRelative(Date.now())).toBe('vừa xong')
  })

  it('picks the default language of a new install from Windows', () => {
    expect(localeFromSystem(['vi-VN', 'en-US'])).toBe('vi')
    expect(localeFromSystem(['en-DE'])).toBe('en')
    expect(localeFromSystem([])).toBe('en')
  })
})
