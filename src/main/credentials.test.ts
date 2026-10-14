import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CredCmd, DetectResult, FillResult, PageSeen } from '@shared/credentials'
import type { AgentRequestInput } from '@shared/agentApi'
import type { Agent } from '@shared/types'
import type { Cipher } from './secrets'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {} },
  clipboard: { writeText: () => {}, readText: () => '', clear: () => {} },
  desktopCapturer: { getSources: async () => [] },
  dialog: {},
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
  screen: { getAllDisplays: () => [] },
  BrowserWindow: { fromWebContents: () => null }
}))

const { CredentialService } = await import('./credentials')
const { CredentialStore } = await import('./credentialStore')
const { totpCode } = await import('./totp')

const fake: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join('')
}
const agent: Agent = { id: 'ag1', workspaceId: 'ws1', name: 'Dev', role: '', permissionMode: 'default', createdAt: '' }
const LOGIN: DetectResult = { url: '', user: true, pass: true, otp: false, text: 'Sign in', frames: false }
const OTP: DetectResult = { url: '', user: false, pass: false, otp: true, text: 'Enter the code from your authenticator app', frames: false }
const DASH: DetectResult = { url: '', user: false, pass: false, otp: false, text: 'Dashboard', frames: false }

/** Trang giả trong tab của agent: trả lời lệnh detect / fill theo `steps`, điền xong thì sang bước sau. */
let url = 'https://admin.shop-abc.vn/login'
let steps: DetectResult[] = []
let fills: Array<Extract<CredCmd, { op: 'fill' }>> = []
let clicks = 0
let enters = 0
/** Bấm gửi: trang sang bước tiếp theo. */
function advance(): void {
  steps.shift()
  if (steps[0] === OTP) url = 'https://admin.shop-abc.vn/login/2fa'
  else if (!steps.length) url = 'https://admin.shop-abc.vn/dashboard'
}
let svc: InstanceType<typeof CredentialService>
let store: InstanceType<typeof CredentialStore>
let asks: AgentRequestInput[] = []
let answer: 'allow' | 'always' | 'deny' = 'allow'
let notices: unknown[] = []
let told: Array<[string, string]> = []

const page = {
  wsId: 'ws1',
  tabId: 'tab1',
  owner: { kind: 'agent' as const, agentId: 'ag1', agentName: 'Dev' },
  inspect: false,
  viewport: 'desk' as const,
  wc: {
    isDestroyed: () => false,
    getURL: () => url,
    send: (ch: string, c: CredCmd) => {
      // Bong bóng (CRED_IPC.ui) không phải lệnh.
      if (ch !== 'stag-cred:cmd') return
      let value: unknown = null
      if (c.op === 'detect') value = { ...(steps[0] ?? DASH), url }
      else {
        fills.push(c)
        // Trang bấm nút gửi bằng DOM: sang bước tiếp theo.
        clicks++
        advance()
        value = { ok: true, filled: c.code ? ['otp'] : ['username', 'password'], clicked: true, formSubmitted: false, remember: false } satisfies FillResult
      }
      queueMicrotask(() => (svc as unknown as { reqs: Map<string, (v: unknown) => void> }).reqs.get(c.reqId)?.(value))
    }
  }
}
const browser = {
  agentPage: () => page,
  page: () => page,
  pageTab: () => page,
  pressEnter: async () => {
    enters++
  },
  settleTab: async () => {},
  capture: async () => null
}

beforeEach(async () => {
  url = 'https://admin.shop-abc.vn/login'
  steps = [LOGIN, OTP]
  fills = []
  clicks = 0
  enters = 0
  asks = []
  answer = 'allow'
  notices = []
  told = []
  const dir = mkdtempSync(join(tmpdir(), 'stag-credsvc-'))
  store = new CredentialStore(join(dir, 'c.json'), join(dir, 'log.jsonl'), fake)
  await store.load()
  svc = new CredentialService({
    store,
    browser: browser as never,
    ask: async (_a, req) => {
      asks.push(req)
      return answer
    },
    team: () => [{ id: 'ag1', name: 'Dev' }],
    tell: (id, text) => told.push([id, text]),
    notice: (n) => notices.push(n)
  })
})

const addItem = (policy: 'ask' | 'first' | 'auto' | 'off' = 'ask', extra: object = {}) =>
  store.save({ name: 'Shop ABC · admin', domains: ['admin.shop-abc.vn'], username: 'admin@shop-abc.vn', password: 'Hx7!pQ2-vR9mT#4w', totp: 'JBSWY3DPEHPK3PXP', policy, ...extra })

describe('credential_list', () => {
  it('chỉ id / tên / tên miền / tên che một phần; không có mật khẩu', async () => {
    await addItem()
    await store.save({ name: 'Off', domains: ['x.vn'], username: 'u', password: 'p', policy: 'off' })
    await store.save({ name: 'Other ws', domains: ['y.vn'], username: 'u', password: 'p', workspaces: ['ws2'] })
    const out = svc.list(agent)
    expect(JSON.parse(out)).toEqual([{ id: 'shop-abc-admin', name: 'Shop ABC · admin', domains: ['admin.shop-abc.vn'], username_hint: 'ad•••@shop-abc.vn', has_totp: true }])
    expect(out).not.toContain('Hx7')
    expect(svc.list(agent, 'https://admin.shop-abc.vn/login')).toContain('shop-abc-admin')
    expect(svc.list(agent, 'other.vn')).toMatch(/^\[\]/)
  })
})

describe('credential_fill', () => {
  it('hỏi bạn, điền đăng nhập rồi mã 2FA trong cùng lượt đã cho (không hỏi lại); không trả giá trị', async () => {
    await addItem('ask')
    const r1 = await svc.fill(agent, 'shop-abc-admin')
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ action: 'credential', credential: { id: 'shop-abc-admin', host: 'admin.shop-abc.vn', step: 'login', canAlways: false } })
    expect(fills[0]).toMatchObject({ op: 'fill', host: 'admin.shop-abc.vn', username: 'admin@shop-abc.vn', password: 'Hx7!pQ2-vR9mT#4w' })
    expect(clicks).toBe(1)
    expect(enters).toBe(0)
    expect(r1).not.toContain('Hx7')
    expect(JSON.parse(r1)).toMatchObject({ filled: 'login', submitted: true, url: 'https://admin.shop-abc.vn/login/2fa', next: expect.stringMatching(/2FA code/) })

    const r2 = await svc.fill(agent, 'shop-abc-admin')
    expect(asks).toHaveLength(1)
    expect(fills[1].code).toMatch(/^\d{6}$/)
    expect([totpCode({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 }), totpCode({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 }, Date.now() - 3000)]).toContain(fills[1].code)
    expect(r2).not.toContain(fills[1].code!)
    expect(JSON.parse(r2)).toMatchObject({ filled: 'totp', url: 'https://admin.shop-abc.vn/dashboard' })
    // Bản đọc trang của agent không còn mật khẩu / mã vừa điền.
    expect(svc.scrub('tab1', `x Hx7!pQ2-vR9mT#4w ${fills[1].code} y`)).not.toMatch(/Hx7|\d{6}/)
    expect((await store.readLog('shop-abc-admin')).map((e) => [e.action, e.how])).toEqual([
      ['totp', 'grant'],
      ['login', 'once']
    ])
  })

  it('form gửi bằng GET: URL trả về không có mật khẩu (dạng mã hoá URL)', async () => {
    await addItem('auto')
    // Trang giả giữ nguyên URL sau khi gửi (bước sau là DASH): URL đã chứa mật khẩu như form GET để lại.
    steps = [LOGIN, DASH]
    url = 'https://admin.shop-abc.vn/welcome?email=admin%40shop-abc.vn&password=Hx7%21pQ2-vR9mT%234w'
    const r = await svc.fill(agent, 'shop-abc-admin')
    expect(JSON.parse(r)).toMatchObject({ filled: 'login', url: expect.stringContaining('/welcome?email=') })
    expect(r).not.toContain('Hx7')
  })

  it('trang http:// ngoài máy: không điền, không hỏi, ghi nhật ký', async () => {
    await addItem('auto', { agents: ['ag1'] })
    url = 'http://admin.shop-abc.vn/login'
    await expect(svc.fill(agent, 'shop-abc-admin')).rejects.toThrow(/insecure_page/)
    expect(fills).toEqual([])
    expect(asks).toEqual([])
    expect((await store.readLog('shop-abc-admin'))[0]).toMatchObject({ action: 'blocked', detail: 'insecure_page' })
  })

  it('từ chối: không điền gì, báo agent dừng', async () => {
    await addItem('ask')
    answer = 'deny'
    await expect(svc.fill(agent, 'shop-abc-admin')).rejects.toThrow(/denied/)
    expect(fills).toEqual([])
  })

  it('tên miền không khớp: chặn, báo bạn, ghi nhật ký, không hỏi / không điền', async () => {
    await addItem('auto', { agents: ['ag1'] })
    url = 'https://shop-abc-admin.login-verify.xyz/session'
    await expect(svc.fill(agent, 'shop-abc-admin')).rejects.toThrow(/domain_mismatch/)
    expect(fills).toEqual([])
    expect(asks).toEqual([])
    expect(notices).toEqual([expect.objectContaining({ kind: 'blocked', host: 'shop-abc-admin.login-verify.xyz', allowed: ['admin.shop-abc.vn'] })])
    expect((await store.readLog())[0]).toMatchObject({ action: 'blocked', host: 'shop-abc-admin.login-verify.xyz' })
  })

  it('"Luôn cho agent này" (hỏi lần đầu): lần sau không hỏi', async () => {
    await addItem('first')
    answer = 'always'
    await svc.fill(agent, 'shop-abc-admin')
    expect(store.get('shop-abc-admin')).toMatchObject({ agents: ['ag1'], approved: ['ag1'] })
    expect(asks[0]).toMatchObject({ credential: { canAlways: true } })
    // Hết lượt 2 phút vẫn không hỏi.
    ;(svc as unknown as { grants: Map<string, number> }).grants.clear()
    steps = [LOGIN]
    url = 'https://admin.shop-abc.vn/login'
    await svc.fill(agent, 'shop-abc-admin')
    expect(asks).toHaveLength(1)
  })

  it('2FA kho không làm được (SMS): needs_user, không hỏi, không điền', async () => {
    await addItem('ask')
    steps = [{ ...OTP, text: 'We sent a code to your phone ending in 42' }]
    const out = JSON.parse(await svc.fill(agent, 'shop-abc-admin'))
    expect(out).toMatchObject({ status: 'needs_user', twofa: 'sms' })
    expect(asks).toEqual([])
    expect(fills).toEqual([])
  })

  it('mục chỉ để bạn dùng (off) hoặc workspace khác: agent không dùng được', async () => {
    await addItem('off')
    await expect(svc.fill(agent, 'shop-abc-admin')).rejects.toThrow(/No password item/)
  })
})

describe('bạn tự đăng nhập trong ô Browser', () => {
  const priv = () => svc as unknown as { onCaptured(p: unknown, c: unknown): Promise<void>; onAct(p: unknown, a: unknown): Promise<unknown>; onSeen(p: unknown, s: PageSeen): Promise<void> }

  it('hỏi lưu sau khi trang chuyển đi, agent đang chờ được chọn sẵn và được báo', async () => {
    svc.list(agent, 'admin.shop-abc.vn')
    url = 'https://admin.shop-abc.vn/login'
    await priv().onCaptured(page, { url, username: 'admin@shop-abc.vn', password: 'typed-pw' })
    expect(svc.hasPending('tab1')).toBe(true)
    // Bản đọc trang không có mật khẩu bạn vừa gõ.
    expect(svc.scrub('tab1', 'value typed-pw')).not.toContain('typed-pw')
    vi.useFakeTimers()
    svc.navigated('ws1', 'tab1', 'https://admin.shop-abc.vn/dashboard', false)
    vi.advanceTimersByTime(800)
    vi.useRealTimers()
    const ui = (svc as unknown as { tabs: Map<string, { ui: { bubble: { kind: string; agents: Array<{ id: string; on: boolean }> } } }> }).tabs.get('tab1')!.ui
    expect(ui.bubble).toMatchObject({ kind: 'save', update: false, agents: [{ id: 'ag1', on: true }] })
    await priv().onAct(page, { a: 'save', agents: ['ag1'] })
    const v = store.matching('admin.shop-abc.vn')[0]
    expect(v).toMatchObject({ username: 'admin@shop-abc.vn', agents: ['ag1'], approved: ['ag1'], policy: 'first' })
    expect(store.secret(v.id)?.password).toBe('typed-pw')
    expect(told).toEqual([['ag1', expect.stringContaining(`credential_fill("${v.id}")`)]])
    expect(svc.hasPending('tab1')).toBe(false)
  })

  it('đúng mục đã lưu / trang http / "Không bao giờ": không hỏi; mật khẩu khác bản đã lưu: hỏi cập nhật', async () => {
    await addItem('ask')
    await priv().onCaptured(page, { url, username: 'admin@shop-abc.vn', password: 'Hx7!pQ2-vR9mT#4w' })
    expect(svc.hasPending('tab1')).toBe(false)
    await priv().onCaptured(page, { url, username: 'admin@shop-abc.vn', password: 'changed' })
    expect(svc.hasPending('tab1')).toBe(true)
    expect((svc as unknown as { tabs: Map<string, { pending: { updateId?: string } }> }).tabs.get('tab1')!.pending.updateId).toBe('shop-abc-admin')
    await priv().onAct(page, { a: 'save', agents: [] })
    expect(store.secret('shop-abc-admin')?.password).toBe('changed')

    url = 'http://shop.example.com/login'
    await priv().onCaptured(page, { url, username: 'u', password: 'p' })
    expect(svc.hasPending('tab1')).toBe(false)
    url = 'https://never.vn/login'
    await store.addNever('never.vn')
    await priv().onCaptured(page, { url, username: 'u', password: 'p' })
    expect(svc.hasPending('tab1')).toBe(false)
  })

  it('mật khẩu bạn gõ được che trong chữ agent đọc, kể cả khi không hỏi lưu (trang http / form GET)', async () => {
    url = 'http://shop.example.com/login'
    await priv().onCaptured(page, { url, username: 'u', password: 'p@ss w0rd!' })
    expect(svc.hasPending('tab1')).toBe(false)
    expect(svc.scrub('tab1', 'URL: http://shop.example.com/welcome?u=u&password=p%40ss+w0rd%21')).not.toContain('w0rd')
  })

  it('bước chỉ hỏi tên đăng nhập: nhớ tên cho bước mật khẩu', async () => {
    await priv().onCaptured(page, { url, username: 'me@x.vn', password: '' })
    await priv().onCaptured(page, { url, username: '', password: 'pw2' })
    expect((svc as unknown as { tabs: Map<string, { pending: { username: string } }> }).tabs.get('tab1')!.pending.username).toBe('me@x.vn')
  })

  it('trang hiện khoá 2FA: che base32 trong bản đọc và từ chối chụp màn hình tới khi trang đổi', async () => {
    await priv().onSeen(page, { url, otp: false, secretText: true, qr: [], otpauth: [], scroll: { x: 0, y: 0 } })
    expect(svc.screenshotRefusal('tab1')).toMatch(/2FA secret/)
    expect(svc.scrub('tab1', 'Key: JBSW Y3DP EHPK 3PXP')).not.toContain('JBSW')
    svc.navigated('ws1', 'tab1', 'https://admin.shop-abc.vn/other', false)
    expect(svc.screenshotRefusal('tab1')).toBeNull()
  })

  it('link otpauth trên trang: hỏi lưu khoá 2FA vào mục cùng tên miền', async () => {
    await store.save({ name: 'Shop', domains: ['admin.shop-abc.vn'], username: 'admin@shop-abc.vn', password: 'p' })
    await priv().onSeen(page, { url, otp: true, secretText: false, qr: [], otpauth: ['otpauth://totp/Shop:admin%40shop-abc.vn?secret=JBSWY3DPEHPK3PXP'], scroll: { x: 0, y: 0 } })
    expect(svc.screenshotRefusal('tab1')).toBeTruthy()
    await priv().onAct(page, { a: 'qr-save' })
    expect(store.get('shop')?.hasTotp).toBe(true)
    await priv().onAct(page, { a: 'qr-fill' })
    expect(fills.at(-1)?.code).toMatch(/^\d{6}$/)
  })

  it('mã QR của tài khoản khác: không thay khoá 2FA của mục đang có; mục đã có khoá thì hỏi thay / lưu mục mới', async () => {
    await addItem('ask')
    const bubble = () => (svc as unknown as { tabs: Map<string, { ui: { bubble: Record<string, unknown> | null } }> }).tabs.get('tab1')!.ui.bubble
    await priv().onSeen(page, { url, otp: false, secretText: false, qr: [], otpauth: ['otpauth://totp/QRTest:qr%40test.dev?secret=KRSXG5CTMVRXEZLU'], scroll: { x: 0, y: 0 } })
    expect(bubble()).toMatchObject({ kind: 'qr', isNew: true, account: 'qr@test.dev' })
    expect(bubble()?.replace).toBeUndefined()
    await priv().onAct(page, { a: 'qr-save' })
    expect(store.secret('shop-abc-admin')?.totp?.secret).toBe('JBSWY3DPEHPK3PXP')
    expect(store.state().items.map((v) => v.username)).toContain('qr@test.dev')

    // Cùng tài khoản, mục đã có khoá: bong bóng nói rõ là thay; "Lưu thành mục mới" giữ khoá cũ.
    svc.navigated('ws1', 'tab1', url, false)
    ;(svc as unknown as { tabs: Map<string, { qr?: unknown }> }).tabs.get('tab1')!.qr = undefined
    await priv().onSeen(page, { url, otp: false, secretText: false, qr: [], otpauth: ['otpauth://totp/Shop:admin%40shop-abc.vn?secret=KRSXG5CTMVRXEZLU'], scroll: { x: 0, y: 0 } })
    expect(bubble()).toMatchObject({ kind: 'qr', isNew: false, replace: true, targetUser: 'ad•••@shop-abc.vn' })
    await priv().onAct(page, { a: 'qr-save', asNew: true })
    expect(store.secret('shop-abc-admin')?.totp?.secret).toBe('JBSWY3DPEHPK3PXP')
  })
})
