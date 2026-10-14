import { describe, expect, it } from 'vitest'
import { totpCode, totpLeft } from './totp'

// RFC 6238, phụ lục B (khoá ASCII "1234567890…" theo độ dài của từng thuật toán, mã 8 số).
const SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA'
const SHA512 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA'

describe('totpCode (RFC 6238)', () => {
  const cases: Array<[number, string, string, string]> = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1234567890, '89005924', '91819424', '93441116'],
    [20000000000, '65353130', '77737706', '47863826']
  ]
  for (const [t, s1, s256, s512] of cases)
    it(`T=${t}`, () => {
      expect(totpCode({ secret: SHA1, algorithm: 'SHA1', digits: 8, period: 30 }, t * 1000)).toBe(s1)
      expect(totpCode({ secret: SHA256, algorithm: 'SHA256', digits: 8, period: 30 }, t * 1000)).toBe(s256)
      expect(totpCode({ secret: SHA512, algorithm: 'SHA512', digits: 8, period: 30 }, t * 1000)).toBe(s512)
    })

  it('6 số giữ số 0 đầu; giây còn lại', () => {
    expect(totpCode({ secret: SHA1, algorithm: 'SHA1', digits: 6, period: 30 }, 1111111109 * 1000)).toBe('081804')
    expect(totpLeft(30, 59_000)).toBe(1)
    expect(totpLeft(30, 60_000)).toBe(30)
  })
})
