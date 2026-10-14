import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  classifyStep,
  cleanBase32,
  hostMatches,
  hostOf,
  insecurePage,
  isTotpError,
  needsAsk,
  normalizeDomain,
  parseCsv,
  parseImport,
  parseTotp,
  scrubSecrets,
  slugId,
  usernameHint,
  visibleTo
} from './credentials'

describe('tên miền', () => {
  it('chuẩn hoá tên miền / URL, giữ *.', () => {
    expect(normalizeDomain('https://Admin.Shop-ABC.vn:8443/login?x=1')).toBe('admin.shop-abc.vn')
    expect(normalizeDomain(' admin.shop-abc.vn ')).toBe('admin.shop-abc.vn')
    expect(normalizeDomain('*.shop-abc.vn')).toBe('*.shop-abc.vn')
    expect(normalizeDomain('localhost:5173')).toBe('localhost')
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('a b')).toBeNull()
  })

  it('không nhận *.<đuôi công cộng>', () => {
    for (const d of ['*.com', '*.vn', '*.co.uk', '*.com.vn', '*.org.au']) expect(normalizeDomain(d)).toBeNull()
    expect(normalizeDomain('*.shop.co.uk')).toBe('*.shop.co.uk')
    expect(normalizeDomain('*.github.io')).toBe('*.github.io')
    expect(normalizeDomain('*.localhost')).toBe('*.localhost')
  })

  it('khớp đúng host, *.d chỉ khớp tên miền con', () => {
    expect(hostMatches('admin.shop-abc.vn', ['admin.shop-abc.vn'])).toBe(true)
    expect(hostMatches('ADMIN.shop-abc.vn.', ['admin.shop-abc.vn'])).toBe(true)
    expect(hostMatches('shop-abc-admin.login-verify.xyz', ['admin.shop-abc.vn'])).toBe(false)
    expect(hostMatches('admin.shop-abc.vn.evil.com', ['admin.shop-abc.vn'])).toBe(false)
    expect(hostMatches('a.shop-abc.vn', ['*.shop-abc.vn'])).toBe(true)
    expect(hostMatches('x.y.shop-abc.vn', ['*.shop-abc.vn'])).toBe(true)
    expect(hostMatches('shop-abc.vn', ['*.shop-abc.vn'])).toBe(false)
    expect(hostMatches('evilshop-abc.vn', ['*.shop-abc.vn'])).toBe(false)
    expect(hostMatches('', ['*.shop-abc.vn'])).toBe(false)
  })

  it('host của trang chỉ với http(s); trang http ngoài máy là không an toàn', () => {
    expect(hostOf('https://a.b/c')).toBe('a.b')
    expect(hostOf('file:///c:/x.html')).toBe('')
    expect(insecurePage('http://shop.vn/login')).toBe(true)
    expect(insecurePage('http://localhost:8080/wp-login.php')).toBe(false)
    expect(insecurePage('http://127.0.0.1/')).toBe(false)
    expect(insecurePage('https://shop.vn/')).toBe(false)
  })

  it('che một phần tên đăng nhập', () => {
    expect(usernameHint('admin@shop-abc.vn')).toBe('ad•••@shop-abc.vn')
    expect(usernameHint('editor')).toBe('ed•••')
    expect(usernameHint('ab')).toBe('•••')
    expect(usernameHint('')).toBe('')
  })
})

describe('khoá 2FA', () => {
  it('base32: chuẩn hoá và giải mã', () => {
    expect(cleanBase32('jbsw y3dp-ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP')
    expect(cleanBase32('JBSWY3DPEHPK3PXP====')).toBe('JBSWY3DPEHPK3PXP')
    expect(cleanBase32('JBSW1Y3DPEHPK3PXP')).toBeNull()
    expect(cleanBase32('ABC')).toBeNull()
    expect([...base32Decode('JBSWY3DPEHPK3PXP')]).toEqual([...Buffer.from('Hello!'), 0xde, 0xad, 0xbe, 0xef])
    expect(Buffer.from(base32Decode('GEZDGNBVGY3TQOJQ')).toString('utf8')).toBe('1234567890')
  })

  it('đọc khoá thô và link otpauth', () => {
    const k = parseTotp('JBSW Y3DP EHPK 3PXP')
    expect(k).toEqual({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 })
    const u = parseTotp('otpauth://totp/Shop%20ABC:admin%40shop-abc.vn?secret=JBSWY3DPEHPK3PXP&issuer=Shop%20ABC&digits=8&period=60&algorithm=SHA256')
    expect(u).toEqual({ secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA256', digits: 8, period: 60, issuer: 'Shop ABC', account: 'admin@shop-abc.vn' })
    const noIssuer = parseTotp('otpauth://totp/GitHub:stag-bot?secret=JBSWY3DPEHPK3PXP')
    expect(!isTotpError(noIssuer) && noIssuer.issuer).toBe('GitHub')
    expect(isTotpError(parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1'))).toBe(true)
    expect(isTotpError(parseTotp('otpauth://totp/x?secret=bad!'))).toBe(true)
    expect(isTotpError(parseTotp('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=5'))).toBe(true)
    expect(isTotpError(parseTotp('123456'))).toBe(true)
    expect(isTotpError(parseTotp(''))).toBe(true)
  })
})

describe('quyền', () => {
  const base = { agents: ['a1'], approved: ['a1'], workspaces: null as string[] | null }
  it('mục hiện cho workspace nào', () => {
    expect(visibleTo({ policy: 'ask', workspaces: null }, 'w1')).toBe(true)
    expect(visibleTo({ policy: 'ask', workspaces: ['w2'] }, 'w1')).toBe(false)
    expect(visibleTo({ policy: 'off', workspaces: null }, 'w1')).toBe(false)
  })
  it('hỏi theo chế độ của mục', () => {
    expect(needsAsk({ ...base, policy: 'ask' }, 'a1', false)).toBe(true)
    expect(needsAsk({ ...base, policy: 'ask' }, 'a1', true)).toBe(false)
    expect(needsAsk({ ...base, policy: 'first' }, 'a1', false)).toBe(false)
    expect(needsAsk({ ...base, policy: 'first' }, 'a2', false)).toBe(true)
    expect(needsAsk({ ...base, approved: [], policy: 'first' }, 'a1', false)).toBe(true)
    expect(needsAsk({ ...base, approved: [], policy: 'auto' }, 'a1', false)).toBe(false)
    expect(needsAsk({ ...base, policy: 'auto' }, 'a2', false)).toBe(true)
  })
})

describe('bước đăng nhập', () => {
  const f = (o: Partial<{ user: boolean; pass: boolean; otp: boolean; text: string }>) => classifyStep({ user: false, pass: false, otp: false, text: '', ...o })
  it('form đăng nhập / chỉ mật khẩu / chỉ tên', () => {
    expect(f({ user: true, pass: true })).toEqual({ kind: 'login' })
    expect(f({ pass: true })).toEqual({ kind: 'password' })
    expect(f({ user: true })).toEqual({ kind: 'username' })
    expect(f({})).toEqual({ kind: 'none' })
  })
  it('ô 2FA: app xác thực / SMS / email', () => {
    expect(f({ otp: true, text: 'Enter the code from your authenticator app' })).toEqual({ kind: 'otp', via: 'app' })
    expect(f({ otp: true, text: 'We sent a code to your phone ending in 42' })).toEqual({ kind: 'otp', via: 'sms' })
    expect(f({ otp: true, text: 'Nhập mã gồm 6 số trong tin nhắn SMS' })).toEqual({ kind: 'otp', via: 'sms' })
    expect(f({ otp: true, text: 'Check your email for a 6-digit code' })).toEqual({ kind: 'otp', via: 'email' })
    expect(f({ otp: true, text: 'Mã xác thực' })).toEqual({ kind: 'otp', via: 'unknown' })
  })
  it('2FA bạn phải tự làm: bấm trên điện thoại / passkey', () => {
    expect(f({ text: 'Check your phone. Tap Yes on the notification to sign in.' })).toEqual({ kind: 'needs_user', how: 'push' })
    expect(f({ text: 'Use your passkey to sign in' })).toEqual({ kind: 'needs_user', how: 'passkey' })
  })
})

describe('che bí mật trong bản đọc trang', () => {
  it('che giá trị đã biết, otpauth, và chuỗi base32 khi trang hiện khoá', () => {
    const text = 'pw Hx7!pQ2-vR9mT#4w code 482913 link otpauth://totp/x?secret=JBSWY3DPEHPK3PXP key JBSW Y3DP EHPK 3PXP end'
    const out = scrubSecrets(text, ['Hx7!pQ2-vR9mT#4w', '482913'], true)
    expect(out).not.toContain('Hx7!pQ2')
    expect(out).not.toContain('482913')
    expect(out).not.toContain('JBSWY3DPEHPK3PXP')
    expect(out).not.toContain('JBSW Y3DP')
    expect(out).toContain('end')
    // Trang thường: chữ hoa dài không bị che.
    expect(scrubSecrets('WELCOME TO OUR SITE TODAY', [], false)).toBe('WELCOME TO OUR SITE TODAY')
    // Giá trị quá ngắn (≤ 3 ký tự) không che (tránh xoá chữ thường).
    expect(scrubSecrets('abc', ['ab'], false)).toBe('abc')
    // Khoá in chữ thường / có '-': che; câu chữ thường không có chữ số 2–7: giữ.
    expect(scrubSecrets('key jbswy3dp-ehpk-3pxp end', [], true)).toBe('key •••••• (hidden by stag.ai) end')
    expect(scrubSecrets('k: jbsw y3dp ehpk 3pxp', [], true)).not.toContain('jbsw')
    expect(scrubSecrets('k: jbswy3dpehpk3pxp', [], true)).not.toContain('jbsw')
    expect(scrubSecrets('this page will help you set', [], true)).toBe('this page will help you set')
  })

  it('che cả dạng mã hoá URL (form GET), form "+", hex thường, mã hoá hai lần, chuỗi JSON', () => {
    const pw = 'Hx7!pQ2-vR9mT#4w'
    const lines = [
      'URL: http://localhost:8796/welcome?email=a%40b.vn&password=Hx7%21pQ2-vR9mT%234w',
      'uri: ' + encodeURIComponent(pw),
      'hexlow: Hx7%21pQ2-vR9mT%234w'.replace(/%2[13]/g, (m) => m.toLowerCase()),
      'twice: /login?next=%2Fwelcome%3Fpassword%3DHx7%2521pQ2-vR9mT%25234w',
      'json: ' + JSON.stringify({ password: pw })
    ]
    const out = scrubSecrets(lines.join('\n'), [pw], false)
    expect(out).not.toMatch(/Hx7/)
    expect(scrubSecrets('q=a+b+c+d', ['a b c d'], false)).toBe('q=•••••• (hidden by stag.ai)')
    expect(scrubSecrets('{"p":"a\\"b\\\\cd"}', ['a"b\\cd'], false)).not.toContain('cd')
  })
})

describe('nhập file', () => {
  it('CSV có ngoặc kép, dấu phẩy và xuống dòng trong ô', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi""\nok"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nok']
    ])
  })

  it('Bitwarden JSON (bỏ mục không phải đăng nhập, file mã hoá báo lỗi)', () => {
    const json = JSON.stringify({
      encrypted: false,
      items: [
        { type: 1, name: 'Shop ABC', login: { username: 'admin@shop-abc.vn', password: 'pw1', totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://admin.shop-abc.vn/login' }] } },
        { type: 2, name: 'Note', secureNote: {} },
        { type: 1, name: 'No url', login: { username: 'u', password: 'p', uris: [] } }
      ]
    })
    const r = parseImport('bitwarden-json', json)
    expect(r.rows).toEqual([{ name: 'Shop ABC', domains: ['admin.shop-abc.vn'], username: 'admin@shop-abc.vn', password: 'pw1', totp: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }])
    expect(r.errors).toHaveLength(1)
    expect(parseImport('bitwarden-json', JSON.stringify({ encrypted: true, items: [] })).errors[0]).toMatch(/mã hoá/)
  })

  it('Bitwarden CSV và Chrome CSV', () => {
    const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,GitHub,,,0,https://github.com/login,stag-bot,gh-pw,JBSWY3DPEHPK3PXP\n,,note,X,,,0,,,,\n'
    expect(parseImport('bitwarden-csv', bw).rows).toEqual([{ name: 'GitHub', domains: ['github.com'], username: 'stag-bot', password: 'gh-pw', totp: 'JBSWY3DPEHPK3PXP' }])
    const chrome = 'name,url,username,password,note\nstripe.com,https://dashboard.stripe.com/login,dev@shop.vn,"p,w",\n'
    expect(parseImport('chrome-csv', chrome).rows).toEqual([{ name: 'stripe.com', domains: ['dashboard.stripe.com'], username: 'dev@shop.vn', password: 'p,w', totp: '' }])
    expect(parseImport('chrome-csv', 'a,b\n1,2').errors[0]).toMatch(/Chrome/)
  })
})

it('id mục từ tên, không trùng', () => {
  expect(slugId('Shop ABC · admin', new Set())).toBe('shop-abc-admin')
  expect(slugId('Đăng nhập', new Set())).toBe('dang-nhap')
  expect(slugId('Shop ABC · admin', new Set(['shop-abc-admin']))).toBe('shop-abc-admin-2')
  expect(slugId('···', new Set())).toBe('item')
})
