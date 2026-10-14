import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CredentialStore } from './credentialStore'
import type { Cipher } from './secrets'

/** "Mã hoá" giả: đảo chuỗi (đủ để thấy file không chứa giá trị gốc). */
const fake = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join('')
})

function setup(now = () => Date.now()): { store: CredentialStore; file: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'stag-cred-'))
  const file = join(dir, 'credentials.json')
  const log = join(dir, 'credentials-log.jsonl')
  return { store: new CredentialStore(file, log, fake(), () => {}, now), file, log }
}

describe('CredentialStore', () => {
  it('lưu mã hoá: file không có mật khẩu / tên đăng nhập / khoá; danh sách không có mật khẩu', async () => {
    const { store, file } = setup()
    await store.load()
    const v = await store.save({ name: 'Shop ABC · admin', domains: ['https://admin.shop-abc.vn/login'], username: 'admin@shop-abc.vn', password: 'Hx7!pQ2-vR9mT#4w', totp: 'JBSW Y3DP EHPK 3PXP' })
    expect(v).toMatchObject({ id: 'shop-abc-admin', domains: ['admin.shop-abc.vn'], hint: 'ad•••@shop-abc.vn', hasPassword: true, hasTotp: true, policy: 'ask', agents: [] })
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('Hx7!pQ2')
    expect(raw).not.toContain('JBSWY3DPEHPK3PXP')
    expect(raw).not.toContain('admin@shop-abc.vn')
    expect(JSON.stringify(store.state())).not.toContain('Hx7!pQ2')
    expect(store.secret(v.id)).toEqual({ username: 'admin@shop-abc.vn', password: 'Hx7!pQ2-vR9mT#4w', totp: { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 } })

    const again = new CredentialStore(file, join(file, '..', 'log.jsonl'), fake())
    await again.load()
    expect(again.get(v.id)?.username).toBe('admin@shop-abc.vn')
    expect(again.matching('admin.shop-abc.vn').map((x) => x.id)).toEqual([v.id])
  })

  it('sửa: mật khẩu vắng = giữ nguyên, totp null = bỏ; kiểm dữ liệu', async () => {
    const { store } = setup()
    await store.load()
    const v = await store.save({ name: 'A', domains: ['a.vn'], username: 'u', password: 'p1', totp: 'JBSWY3DPEHPK3PXP' })
    await store.save({ id: v.id, name: 'A2', domains: ['a.vn', '*.a.vn'], username: 'u2' })
    expect(store.secret(v.id)?.password).toBe('p1')
    expect(store.secret(v.id)?.totp).toBeTruthy()
    await store.save({ id: v.id, name: 'A2', domains: ['a.vn'], username: 'u2', totp: null })
    expect(store.get(v.id)?.hasTotp).toBe(false)
    await expect(store.save({ name: '', domains: ['a.vn'], username: '', password: 'x' })).rejects.toThrow(/tên/)
    await expect(store.save({ name: 'B', domains: ['???'], username: '', password: 'x' })).rejects.toThrow(/tên miền/)
    await expect(store.save({ name: 'B', domains: ['*.co.uk'], username: '', password: 'x' })).rejects.toThrow(/\*\.co\.uk.*quá nhiều trang/)
    await expect(store.save({ name: 'B', domains: ['b.vn'], username: '', password: '' })).rejects.toThrow(/mật khẩu hoặc khoá/)
    await expect(store.save({ name: 'B', domains: ['b.vn'], username: '', password: 'x', totp: 'nope' })).rejects.toThrow(/base32/)
    const off = new CredentialStore(join(mkdtempSync(join(tmpdir(), 'stag-cred-')), 'c.json'), 'x.jsonl', fake(false))
    await expect(off.save({ name: 'B', domains: ['b.vn'], username: '', password: 'x' })).rejects.toThrow(/safeStorage/)
  })

  it('agent / "Luôn cho": bỏ chọn agent thì bỏ luôn "Luôn cho"', async () => {
    const { store } = setup()
    await store.load()
    const v = await store.save({ name: 'A', domains: ['a.vn'], username: 'u', password: 'p', policy: 'first' })
    await store.approve(v.id, 'ag1')
    expect(store.get(v.id)).toMatchObject({ agents: ['ag1'], approved: ['ag1'] })
    await store.patch(v.id, { agents: [] })
    expect(store.get(v.id)).toMatchObject({ agents: [], approved: [] })
    await store.patch(v.id, { policy: 'off', workspaces: ['w1'] })
    expect(store.get(v.id)).toMatchObject({ policy: 'off', workspaces: ['w1'] })
  })

  it('nhập: trùng tên miền + tên đăng nhập thì cập nhật', async () => {
    const { store } = setup()
    await store.load()
    await store.save({ name: 'GitHub', domains: ['github.com'], username: 'stag-bot', password: 'old' })
    const r = await store.importRows([
      { name: 'GitHub', domains: ['github.com'], username: 'Stag-Bot', password: 'new', totp: '' },
      { name: 'Stripe', domains: ['dashboard.stripe.com'], username: 'dev', password: 's', totp: 'JBSWY3DPEHPK3PXP' },
      { name: 'Bad', domains: ['bad.vn'], username: 'x', password: 'p', totp: 'not-a-key' }
    ])
    expect(r).toMatchObject({ added: 1, updated: 1 })
    expect(r.errors).toHaveLength(1)
    expect(store.secret('github')?.password).toBe('new')
    expect(store.get('stripe')?.hasTotp).toBe(true)
  })

  it('danh sách "Không bao giờ"', async () => {
    const { store } = setup()
    await store.load()
    await store.addNever('Shop.vn')
    expect(store.isNever('shop.vn')).toBe(true)
    await store.removeNever('shop.vn')
    expect(store.state().never).toEqual([])
  })

  it('nhật ký: mới nhất trước, lọc theo mục, bỏ dòng cũ hơn 90 ngày khi mở', async () => {
    let t = Date.parse('2026-10-14T10:00:00Z')
    const { store, file, log } = setup(() => t)
    writeFileSync(log, JSON.stringify({ at: '2026-06-01T00:00:00Z', itemId: 'old', itemName: 'Old', agentName: 'X', host: 'h', action: 'login' }) + '\n')
    await store.load()
    await store.log({ itemId: 'a', itemName: 'A', agentName: 'Dev', host: 'a.vn', action: 'login', how: 'once' })
    t += 1000
    await store.log({ itemId: 'b', itemName: 'B', agentName: 'Dev', host: 'b.vn', action: 'blocked' })
    expect((await store.readLog()).map((e) => e.itemId)).toEqual(['b', 'a'])
    expect((await store.readLog('a')).map((e) => e.action)).toEqual(['login'])
    expect(readFileSync(log, 'utf8')).not.toContain('"old"')
    expect(file).toBeTruthy()
  })
})
