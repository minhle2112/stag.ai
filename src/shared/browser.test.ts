import { describe, expect, it } from 'vitest'
import { addressOf, browserPartition, homePageInput, isLocalUrl, originDecision, originInput, searchUrl, toUrl } from './browser'

describe('toUrl', () => {
  it('đoán địa chỉ: localhost → http, tên miền → https, có giao thức giữ nguyên', () => {
    expect(toUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(toUrl('127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x')
    expect(toUrl('github.com/foo')).toBe('https://github.com/foo')
    expect(toUrl('http://example.com')).toBe('http://example.com')
    expect(toUrl('  ')).toBe('about:blank')
  })

  it('chữ không phải địa chỉ → tìm bằng máy tìm kiếm đã chọn (mặc định Google)', () => {
    expect(toUrl('react hooks')).toBe('https://www.google.com/search?q=react%20hooks')
    expect(toUrl('react hooks', 'duckduckgo')).toBe('https://duckduckgo.com/?q=react%20hooks')
    expect(toUrl('a&b', 'bing')).toBe('https://www.bing.com/search?q=a%26b')
    expect(searchUrl('google', 'x y')).toBe('https://www.google.com/search?q=x%20y')
  })

  it('addressOf trả null cho chữ thường', () => {
    expect(addressOf('xin chào')).toBeNull()
    expect(addressOf('docs.rs')).toBe('https://docs.rs')
  })
})

describe('homePageInput', () => {
  it('trống = trang trống; địa chỉ → URL đầy đủ; sai → null', () => {
    expect(homePageInput('')).toBe('')
    expect(homePageInput('localhost:3000')).toBe('http://localhost:3000/')
    expect(homePageInput('github.com')).toBe('https://github.com/')
    expect(homePageInput('https://a.dev/x?y=1')).toBe('https://a.dev/x?y=1')
    expect(homePageInput('hello world')).toBeNull()
    expect(homePageInput('file:///C:/x.html')).toBeNull()
    expect(homePageInput('https://bad host')).toBeNull()
  })
})

describe('originInput', () => {
  it('chuẩn hoá về origin; localhost → http; tên máy sai → null', () => {
    expect(originInput('Example.ORG/some/path')).toBe('https://example.org')
    expect(originInput('localhost:3000')).toBe('http://localhost:3000')
    expect(originInput('http://192.168.1.5:8080/x')).toBe('http://192.168.1.5:8080')
    expect(originInput('bad host here')).toBeNull()
    expect(originInput('ftp://x.com')).toBeNull()
    expect(originInput('mailto:a@b.c')).toBeNull()
    expect(originInput('  ')).toBeNull()
  })
})

describe('isLocalUrl', () => {
  it('localhost, *.localhost, 127.x, ::1', () => {
    for (const u of ['http://localhost:1', 'http://app.localhost', 'http://127.0.0.5', 'http://[::1]:3000']) expect(isLocalUrl(new URL(u))).toBe(true)
    expect(isLocalUrl(new URL('https://localhost.example.com'))).toBe(false)
    for (const u of ['http://127.evil.com', 'http://127.0.0.1.nip.io', 'http://127.0.0.1x']) expect(isLocalUrl(new URL(u))).toBe(false)
  })
})

describe('originDecision', () => {
  const ask = { externalPages: 'ask' as const, allowedOrigins: ['https://github.com'] }

  it('localhost và about: luôn mở; giao thức lạ / URL hỏng = invalid', () => {
    expect(originDecision('http://localhost:5173/a', { ...ask, externalPages: 'deny' })).toBe('open')
    expect(originDecision('about:blank', { ...ask, externalPages: 'deny' })).toBe('open')
    expect(originDecision('file:///C:/a', ask)).toBe('invalid')
    expect(originDecision('not a url', ask)).toBe('invalid')
  })

  it('origin luôn cho mở được ở mọi chính sách', () => {
    for (const externalPages of ['ask', 'allow', 'deny'] as const)
      expect(originDecision('https://github.com/x/y', { ...ask, externalPages })).toBe('open')
  })

  it('chính sách: hỏi / luôn cho / luôn chặn', () => {
    expect(originDecision('https://example.com', ask)).toBe('ask')
    expect(originDecision('https://example.com', { ...ask, externalPages: 'allow' })).toBe('open')
    expect(originDecision('https://example.com', { ...ask, externalPages: 'deny' })).toBe('deny')
  })

  it('origin đã cho trong lần chạy này chỉ tính khi chính sách là hỏi', () => {
    const now = (o: string): boolean => o === 'https://example.com'
    expect(originDecision('https://example.com/p', ask, now)).toBe('open')
    expect(originDecision('https://example.com/p', { ...ask, externalPages: 'deny' }, now)).toBe('deny')
    expect(originDecision('https://other.com', ask, now)).toBe('ask')
  })
})

describe('browserPartition', () => {
  it('giữ cookie → partition persist:', () => {
    expect(browserPartition('w1', false)).toBe('stag-browser-w1')
    expect(browserPartition('w1', true)).toBe('persist:stag-browser-w1')
  })
})
