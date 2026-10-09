import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, type Cipher } from './secrets'

/** "Mã hoá" giả: đảo chuỗi (đủ để thấy file không chứa giá trị gốc). */
const fake = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join('')
})

describe('SecretStore', () => {
  it('lưu mã hoá, đọc lại, xoá', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stag-sec-')), 'secrets.json')
    const changes: number[] = []
    const s = new SecretStore(file, fake(), (l) => changes.push(l.items.length))
    await s.load()
    await s.set('GITHUB_TOKEN', 'ghp_abc123')
    expect(readFileSync(file, 'utf8')).not.toContain('ghp_abc123')
    expect(s.get('GITHUB_TOKEN')).toBe('ghp_abc123')
    expect(s.list().items.map((x) => x.name)).toEqual(['GITHUB_TOKEN'])

    const again = new SecretStore(file, fake())
    await again.load()
    expect(again.get('GITHUB_TOKEN')).toBe('ghp_abc123')

    await s.remove('GITHUB_TOKEN')
    expect(s.has('GITHUB_TOKEN')).toBe(false)
    expect(changes).toEqual([1, 0])
  })

  it('từ chối tên sai, giá trị trống, khi không mã hoá được', async () => {
    const s = new SecretStore(join(mkdtempSync(join(tmpdir(), 'stag-sec-')), 's.json'), fake())
    await expect(s.set('1BAD', 'x')).rejects.toThrow(/không hợp lệ/)
    await expect(s.set('OK', '')).rejects.toThrow(/trống/)
    const off = new SecretStore(join(mkdtempSync(join(tmpdir(), 'stag-sec-')), 's.json'), fake(false))
    await expect(off.set('OK', 'x')).rejects.toThrow(/safeStorage/)
  })

  it('giải mã lỗi → undefined (không ném)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stag-sec-')), 's.json')
    const s = new SecretStore(file, fake())
    await s.set('A', 'v')
    const broken = new SecretStore(file, { ...fake(), decrypt: () => { throw new Error('bad key') } })
    await broken.load()
    expect(broken.get('A')).toBeUndefined()
    expect(broken.list().items).toHaveLength(1)
  })
})
