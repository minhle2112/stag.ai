// Kho mật khẩu cho agent: kiểu dữ liệu + hàm thuần dùng chung giữa main, lớp trang của ô Browser và renderer.
// Nguyên tắc: agent không bao giờ thấy mật khẩu hay mã 2FA. App tự điền vào trang trong ô Browser, chỉ trên đúng tên miền.
import { t, type Locale, type PlainKey } from './i18n'

/** Khi agent muốn dùng mục: hỏi mỗi lần / hỏi lần đầu của mỗi agent / không hỏi (agent đã chọn) / agent không được dùng. */
export type CredentialPolicy = 'ask' | 'first' | 'auto' | 'off'

/** Khoá từ điển của nhãn chế độ hỏi: gọi `t(POLICY_LABEL[p])` lúc vẽ. */
export const POLICY_LABEL: Record<CredentialPolicy, PlainKey> = {
  ask: 'passwords.policy.ask',
  first: 'passwords.policy.first',
  auto: 'passwords.policy.auto',
  off: 'passwords.policy.off'
}
export const POLICIES: CredentialPolicy[] = ['ask', 'first', 'auto', 'off']

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/** Khoá 2FA (TOTP, RFC 6238). `secret` = base32 đã chuẩn hoá (chữ hoa, không cách, không '='). */
export interface TotpParams {
  secret: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  issuer?: string
  account?: string
}

/** Một mục như renderer thấy: không có mật khẩu, không có khoá 2FA. */
export interface CredentialView {
  id: string
  name: string
  /** Tên miền được điền: host chính xác, hoặc `*.domain` cho mọi tên miền con. */
  domains: string[]
  username: string
  /** Tên đăng nhập che một phần (agent chỉ thấy cái này). */
  hint: string
  hasPassword: boolean
  hasTotp: boolean
  /** Agent được chọn dùng mục (id). */
  agents: string[]
  /** Agent bạn đã bấm "Luôn cho agent này" (chế độ hỏi lần đầu). */
  approved: string[]
  /** Workspace được dùng mục; null = mọi workspace. */
  workspaces: string[] | null
  policy: CredentialPolicy
  createdAt: string
  updatedAt: string
  lastUsed?: { at: string; agentName: string }
}

export interface CredentialsState {
  /** Windows cho mã hoá (safeStorage) không; không thì không lưu được gì. */
  available: boolean
  items: CredentialView[]
  /** Tên miền bạn chọn "Không bao giờ" (không hỏi lưu mật khẩu). */
  never: string[]
}

/** Thêm / sửa mục từ Cài đặt. `password` / `totp` vắng = giữ nguyên; `totp: null` = bỏ 2FA. */
export interface CredentialInput {
  id?: string
  name: string
  domains: string[]
  username: string
  password?: string
  totp?: string | null
  agents?: string[]
  workspaces?: string[] | null
  policy?: CredentialPolicy
}

export type CredentialPatch = Partial<Pick<CredentialView, 'name' | 'domains' | 'agents' | 'approved' | 'workspaces' | 'policy'>>

export type CredentialAction =
  | 'login'
  | 'username'
  | 'password'
  | 'totp'
  | 'blocked'
  | 'denied'
  | 'needs_user'
  | 'saved'
  | 'updated'
  | 'imported'
  | 'totp_saved'

/** Một dòng nhật ký dùng (credentials-log.jsonl). Không bao giờ có giá trị bí mật. */
export interface CredentialLogEntry {
  at: string
  itemId: string
  itemName: string
  agentId?: string
  agentName: string
  host: string
  action: CredentialAction
  /** Vì sao được điền: bạn cho 1 lần / luôn cho / mục không hỏi / trong lượt đã cho. */
  how?: 'once' | 'always' | 'auto' | 'grant'
  detail?: string
}

/** Main báo renderer: agent bị chặn điền (toast góc dưới trái). */
export interface CredentialNotice {
  kind: 'blocked'
  workspaceId: string
  agentName: string
  itemId: string
  itemName: string
  host: string
  allowed: string[]
}

/** Kết quả kiểm khoá 2FA bạn dán / quét (chưa lưu): mã hiện tại để so với app trên điện thoại. */
export interface TotpPreview {
  ok: boolean
  error?: string
  /** Chuỗi đã chuẩn hoá để lưu (otpauth:// hoặc khoá). */
  value?: string
  code?: string
  left?: number
  issuer?: string
  account?: string
}

export type ImportKind = 'bitwarden-json' | 'bitwarden-csv' | 'chrome-csv'

export interface ImportRow {
  name: string
  domains: string[]
  username: string
  password: string
  /** otpauth:// hoặc khoá base32 ('' = không có). */
  totp: string
}

/** Bản xem trước file nhập gửi sang renderer: không có mật khẩu / khoá. */
export interface ImportPreview {
  token: string
  file: string
  rows: Array<{ name: string; domains: string[]; username: string; hasPassword: boolean; hasTotp: boolean; duplicate: boolean }>
  errors: string[]
}

// ---------- tên miền ----------

/** "https://Admin.Shop.vn:8443/login" → "admin.shop.vn"; "*.shop.vn" giữ dấu *. null = không phải tên miền. */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase()
  if (!s) return null
  const wild = s.startsWith('*.')
  if (wild) s = s.slice(2)
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`
  let host: string
  try {
    host = new URL(s).hostname
  } catch {
    return null
  }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || !/^[a-z0-9.:-]+$/.test(host)) return null
  if (wild && publicSuffix(host)) return null
  return wild ? `*.${host}` : host
}

/** Đuôi tên miền công cộng (`com`, `co.uk`, `com.vn`…): `*.com` sẽ khớp mọi site → không nhận. Ước lượng, không có danh sách PSL. */
function publicSuffix(host: string): boolean {
  const parts = host.split('.')
  if (parts.length === 1) return !isLocalHost(host)
  return parts.length === 2 && parts[1].length === 2 && /^(co|com|net|org|gov|edu|ac|or|ne|go|biz|info|gob|nic|mil|ltd|plc)$/.test(parts[0])
}

/** Host của URL trang ('' nếu không đọc được / không phải http(s)). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/\.$/, '') : ''
  } catch {
    return ''
  }
}

/** Host khớp danh sách: đúng host, hoặc `*.d` khớp mọi tên miền con của d (không gồm chính d). */
export function hostMatches(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h) return false
  return domains.some((d) => {
    const x = d.toLowerCase()
    if (x.startsWith('*.')) return h.endsWith(x.slice(1)) && h.length > x.length - 1
    return h === x
  })
}

/** Trang http:// ngoài máy mình (mật khẩu đi qua mạng không mã hoá). */
export function insecurePage(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && !isLocalHost(u.hostname)
  } catch {
    return false
  }
}

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h) || h.endsWith('.local') || h.endsWith('.test')
}

/** Tên đăng nhập che một phần: "admin@shop-abc.vn" → "ad•••@shop-abc.vn", "editor" → "ed•••". */
export function usernameHint(u: string): string {
  const s = u.trim()
  if (!s) return ''
  const at = s.indexOf('@')
  const local = at > 0 ? s.slice(0, at) : s
  const rest = at > 0 ? s.slice(at) : ''
  const head = local.length <= 2 ? '' : local.slice(0, 2)
  return `${head}•••${rest}`
}

// ---------- 2FA (TOTP) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Khoá base32 chuẩn hoá ("jbsw y3dp-ehpk 3pxp==" → "JBSWY3DPEHPK3PXP"); null = không phải base32 dùng được. */
export function cleanBase32(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  if (s.length < 16 || s.length > 256 || !/^[A-Z2-7]+$/.test(s)) return null
  return s
}

export function base32Decode(s: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const ch of s) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('not base32')
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

/** Đọc khoá 2FA bạn dán: khoá base32 hoặc link `otpauth://totp/...`. */
export function parseTotp(raw: string): TotpParams | { error: string } {
  const s = raw.trim()
  if (!s) return { error: t('passwords.totp.empty') }
  if (/^otpauth:/i.test(s)) {
    let u: URL
    try {
      u = new URL(s)
    } catch {
      return { error: t('passwords.totp.badLink') }
    }
    if (u.host.toLowerCase() !== 'totp') return { error: u.host.toLowerCase() === 'hotp' ? t('passwords.totp.hotp') : t('passwords.totp.notTotp') }
    const secret = cleanBase32(u.searchParams.get('secret') ?? '')
    if (!secret) return { error: t('passwords.totp.badSecret') }
    const alg = (u.searchParams.get('algorithm') ?? 'SHA1').toUpperCase().replace('-', '')
    if (alg !== 'SHA1' && alg !== 'SHA256' && alg !== 'SHA512') return { error: t('passwords.totp.badAlg', { alg }) }
    const digits = Number(u.searchParams.get('digits') ?? 6)
    const period = Number(u.searchParams.get('period') ?? 30)
    if (![6, 7, 8].includes(digits)) return { error: t('passwords.totp.badDigits') }
    if (!Number.isInteger(period) || period < 10 || period > 300) return { error: t('passwords.totp.badPeriod') }
    let label = ''
    try {
      label = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
    } catch {
      label = u.pathname.replace(/^\/+/, '')
    }
    const [pre, acc] = label.includes(':') ? [label.slice(0, label.indexOf(':')), label.slice(label.indexOf(':') + 1)] : ['', label]
    const issuer = (u.searchParams.get('issuer') ?? pre).trim()
    return { secret, algorithm: alg, digits, period, ...(issuer ? { issuer } : {}), ...(acc.trim() ? { account: acc.trim() } : {}) }
  }
  const secret = cleanBase32(s)
  if (!secret) return { error: t('passwords.totp.badKey') }
  return { secret, algorithm: 'SHA1', digits: 6, period: 30 }
}

export function isTotpError(p: TotpParams | { error: string }): p is { error: string } {
  return 'error' in p
}

// ---------- quyền ----------

/** Mục có hiện cho agent của workspace này không (credential_list / credential_fill). */
export function visibleTo(item: Pick<CredentialView, 'policy' | 'workspaces'>, workspaceId: string): boolean {
  return item.policy !== 'off' && (item.workspaces === null || item.workspaces.includes(workspaceId))
}

/** Có phải hỏi bạn trước khi điền cho agent này không. `granted` = đang trong lượt bạn đã cho (2 phút). */
export function needsAsk(item: Pick<CredentialView, 'policy' | 'agents' | 'approved'>, agentId: string, granted: boolean): boolean {
  if (granted) return false
  switch (item.policy) {
    case 'ask':
      return true
    case 'first':
      return !item.approved.includes(agentId)
    case 'auto':
      return !item.agents.includes(agentId)
    default:
      return true
  }
}

/**
 * Mã QR 2FA trên trang: lưu vào mục nào (undefined = mục mới). Đúng tên đăng nhập trong QR thì lấy mục đó; QR ghi tài
 * khoản khác mọi mục thì chỉ nhận mục chưa có tên đăng nhập lẫn khoá 2FA (tránh thay khoá 2FA của tài khoản khác);
 * QR không ghi tài khoản thì ưu tiên mục chưa có khoá.
 */
export function qrTarget<T extends Pick<CredentialView, 'username' | 'hasTotp'>>(items: readonly T[], account?: string): T | undefined {
  const acc = account?.trim().toLowerCase()
  if (acc) return items.find((v) => v.username.toLowerCase() === acc) ?? items.find((v) => !v.username && !v.hasTotp)
  return items.find((v) => !v.hasTotp) ?? items[0]
}

// ---------- bước đăng nhập trên trang ----------

/** 2FA mà kho không tự điền được: bạn phải làm (mã SMS / email, bấm xác nhận trên điện thoại, passkey). */
export type TwoFaKind = 'sms' | 'email' | 'push' | 'passkey' | 'code'

export type PageStep =
  | { kind: 'login' | 'username' | 'password' | 'none' }
  | { kind: 'otp'; via: 'app' | 'sms' | 'email' | 'unknown' }
  | { kind: 'needs_user'; how: TwoFaKind }

const APP_RE = /authenticator|authentication app|auth app|app xác thực|ứng dụng xác thực|totp|google auth|authy|2fa app|two-factor app|mã từ ứng dụng/ // i18n-ignore: matches Vietnamese text on web pages
const SMS_RE = /\bsms\b|text message|texted|sent (?:a |the )?code to (?:your )?(?:phone|mobile|number|\+|\*)|tin nhắn|số điện thoại/ // i18n-ignore: matches Vietnamese text on web pages
const EMAIL_RE = /(?:sent|emailed).{0,40}(?:e-?mail|inbox)|check your (?:e-?mail|inbox)|code.{0,30}e-?mail|e-?mail.{0,30}code|mã.{0,30}email|email.{0,30}mã/ // i18n-ignore: matches Vietnamese text on web pages
const PUSH_RE = /check your phone|approve (?:the |this )?(?:sign[- ]?in|login|request)|tap (?:yes|approve)|sent (?:a )?(?:push|notification)|duo push|xác nhận trên điện thoại|phê duyệt (?:đăng nhập|trên)/ // i18n-ignore: matches Vietnamese text on web pages
const PASSKEY_RE = /passkey|security key|khóa bảo mật|khoá bảo mật|windows hello|touch id|face id|use your fingerprint|vân tay/ // i18n-ignore: matches Vietnamese text on web pages

/** Trang đang hỏi gì, từ các ô tìm thấy + chữ trên trang. */
export function classifyStep(f: { user: boolean; pass: boolean; otp: boolean; text: string }): PageStep {
  const t = f.text.toLowerCase()
  if (f.pass) return { kind: f.user ? 'login' : 'password' }
  if (f.otp) {
    if (APP_RE.test(t)) return { kind: 'otp', via: 'app' }
    if (SMS_RE.test(t)) return { kind: 'otp', via: 'sms' }
    if (EMAIL_RE.test(t)) return { kind: 'otp', via: 'email' }
    return { kind: 'otp', via: 'unknown' }
  }
  if (PASSKEY_RE.test(t)) return { kind: 'needs_user', how: 'passkey' }
  if (PUSH_RE.test(t)) return { kind: 'needs_user', how: 'push' }
  if (f.user) return { kind: 'username' }
  return { kind: 'none' }
}

export const TWOFA_LABEL: Record<TwoFaKind, string> = {
  sms: 'a code sent by SMS',
  email: 'a code sent by email',
  push: 'approving the sign-in on their phone',
  passkey: 'a passkey / security key',
  code: 'a verification code stag.ai does not have'
}

// ---------- che bí mật trong chữ agent đọc ----------

const HIDDEN = '•••••• (hidden by stag.ai)'
const BASE32_RUN = /(?<![A-Za-z0-9])(?:[A-Z2-7]{2,8}[ -]){1,15}[A-Z2-7]{2,8}(?![A-Za-z0-9])|(?<![A-Za-z0-9])[A-Z2-7]{16,}(?![A-Za-z0-9])/g
/**
 * Khoá in chữ thường / lẫn hoa thường: nhóm 4 cách nhau bằng dấu cách (`jbsw y3dp …`), nhóm nối bằng `-`
 * (`jbswy3dp-ehpk-3pxp`) hoặc liền. Phải có chữ số 2–7 để không che câu chữ thường.
 */
const BASE32_ANYCASE =
  /(?<![A-Za-z0-9])(?:[a-z2-7]{4} ){3,15}[a-z2-7]{2,4}(?![A-Za-z0-9])|(?<![A-Za-z0-9-])(?:[a-z2-7]{2,8}-){1,15}[a-z2-7]{2,8}(?![A-Za-z0-9-])|(?<![A-Za-z0-9])[a-z2-7]{16,}(?![A-Za-z0-9])/gi

const lowHex = (s: string): string => s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())

/**
 * Các dạng một bí mật có thể hiện ra trong chữ agent đọc: nguyên văn, mã hoá URL (form gửi bằng GET → `?password=…%21`,
 * `+` thay khoảng trắng; cả hex thường, cả mã hoá hai lần khi URL nằm trong tham số `next=`), và chuỗi JSON (trang
 * console.log một object).
 */
export function secretForms(s: string): string[] {
  const out = [s, JSON.stringify(s).slice(1, -1)]
  try {
    const uri = encodeURIComponent(s)
    const form = new URLSearchParams({ x: s }).toString().slice(2)
    for (const e of [uri, form, encodeURI(s), encodeURIComponent(uri), encodeURIComponent(form)]) out.push(e, lowHex(e))
  } catch {
    // Chuỗi có surrogate lẻ: không mã hoá URL được, chỉ che bản nguyên văn.
  }
  return out
}

/**
 * Che bí mật trong mọi chữ tool browser trả cho agent (snapshot, URL, tiêu đề, console): các giá trị app biết (mật
 * khẩu, mã vừa điền, khoá 2FA — kể cả dạng mã hoá URL / JSON), mọi link `otpauth://`, và (trang đang hiện khoá 2FA)
 * chuỗi base32 dài ≥ 16 ký tự.
 */
export function scrubSecrets(text: string, secrets: readonly string[], base32: boolean): string {
  let out = text
  const all = new Set(secrets.filter((x) => x.length >= 4).flatMap(secretForms))
  for (const s of [...all].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join(HIDDEN)
  out = out.replace(/otpauth:\/\/[^\s"'<>)]+/gi, `otpauth://${HIDDEN}`)
  if (base32) {
    out = out.replace(BASE32_RUN, (m) => (m.replace(/[ -]/g, '').length >= 16 ? HIDDEN : m))
    out = out.replace(BASE32_ANYCASE, (m) => (m.replace(/[ -]/g, '').length >= 16 && /[2-7]/.test(m) ? HIDDEN : m))
  }
  return out
}

// ---------- nhập file ----------

/** CSV (RFC 4180): dấu phẩy, ngoặc kép, xuống dòng trong ngoặc. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

function domainsOf(uris: string[]): string[] {
  const out: string[] = []
  for (const u of uris) {
    const h = hostOf(u.includes('://') ? u : `https://${u}`)
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

/** Đọc file export (Bitwarden JSON không mã hoá / Bitwarden CSV / Chrome-Edge CSV) thành các mục đăng nhập. */
export function parseImport(kind: ImportKind, text: string): { rows: ImportRow[]; errors: string[] } {
  const rows: ImportRow[] = []
  const errors: string[] = []
  const push = (name: string, uris: string[], username: string, password: string, totp: string): void => {
    const domains = domainsOf(uris)
    if (!password && !totp) return
    if (!domains.length) {
      errors.push(t('passwords.import.noUrl', { name: name || username }))
      return
    }
    rows.push({ name: name.trim() || domains[0], domains, username: username.trim(), password, totp: totp.trim() })
  }
  if (kind === 'bitwarden-json') {
    let data: unknown
    try {
      data = JSON.parse(text.replace(/^﻿/, ''))
    } catch {
      return { rows, errors: [t('passwords.import.notJson')] }
    }
    const d = data as { encrypted?: boolean; items?: unknown }
    if (d?.encrypted) return { rows, errors: [t('passwords.import.encrypted')] }
    if (!Array.isArray(d?.items)) return { rows, errors: [t('passwords.import.noItems')] }
    for (const it of d.items as Array<Record<string, unknown>>) {
      const login = it?.login as { username?: string; password?: string; totp?: string; uris?: Array<{ uri?: string }> } | undefined
      if (it?.type !== 1 || !login) continue
      push(String(it.name ?? ''), (login.uris ?? []).map((u) => String(u?.uri ?? '')).filter(Boolean), String(login.username ?? ''), String(login.password ?? ''), String(login.totp ?? ''))
    }
    return { rows, errors }
  }
  const table = parseCsv(text)
  if (!table.length) return { rows, errors: [t('passwords.import.emptyCsv')] }
  const head = table[0].map((h) => h.trim().toLowerCase())
  const col = (n: string): number => head.indexOf(n)
  if (kind === 'bitwarden-csv') {
    const [iType, iName, iUri, iUser, iPass, iTotp] = ['type', 'name', 'login_uri', 'login_username', 'login_password', 'login_totp'].map(col)
    if (iUri < 0 || iPass < 0) return { rows, errors: [t('passwords.import.notBitwardenCsv')] }
    for (const r of table.slice(1)) {
      if (iType >= 0 && r[iType] && r[iType] !== 'login') continue
      push(r[iName] ?? '', (r[iUri] ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean), r[iUser] ?? '', r[iPass] ?? '', iTotp >= 0 ? (r[iTotp] ?? '') : '')
    }
    return { rows, errors }
  }
  const [iName, iUrl, iUser, iPass] = ['name', 'url', 'username', 'password'].map(col)
  if (iUrl < 0 || iPass < 0) return { rows, errors: [t('passwords.import.notChromeCsv')] }
  for (const r of table.slice(1)) push(r[iName] ?? '', [r[iUrl] ?? ''].filter(Boolean), iUser >= 0 ? (r[iUser] ?? '') : '', r[iPass] ?? '', '')
  return { rows, errors }
}

// ---------- khác ----------

/** id mục từ tên: "Shop ABC · admin" → "shop-abc-admin" (thêm -2, -3… nếu trùng). */
export function slugId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd') // i18n-ignore: folds Vietnamese letters into ASCII ids
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

/** Tên gợi ý cho mục mới từ tên miền: "admin.shop-abc.vn" → "admin.shop-abc.vn" (bỏ www.). */
export function nameFromHost(host: string): string {
  return host.replace(/^www\./, '')
}

/** "123456" → "123 456" (mã 6 số); 8 số → "1234 5678". */
export function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}

// ---------- lớp trang trong ô Browser (preload thế giới cô lập) ↔ main ----------

export const CRED_IPC = {
  /** invoke(url) → CredPageUi: trang vừa tải xin trạng thái bong bóng của tab */
  hello: 'stag-cred:hello',
  /** main → trang: CredPageUi */
  ui: 'stag-cred:ui',
  /** main → trang: CredCmd */
  cmd: 'stag-cred:cmd',
  /** send({ reqId, value }): trả lời CredCmd */
  res: 'stag-cred:res',
  /** send(CapturedLogin): bạn vừa bấm đăng nhập trên trang */
  captured: 'stag-cred:captured',
  /** send(PageSeen): trang có ô 2FA / mã QR 2FA / khoá 2FA bằng chữ */
  seen: 'stag-cred:seen',
  /** invoke(CredAct) → kết quả: bấm nút trong bong bóng / thanh của stag */
  act: 'stag-cred:act'
} as const

export interface PageRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CapturedLogin {
  url: string
  username: string
  password: string
}

export interface PageSeen {
  url: string
  /** Có ô nhập mã 2FA. */
  otp: boolean
  /** Có chuỗi giống khoá 2FA (base32 dài) cạnh chữ nói về 2FA / QR. */
  secretText: boolean
  /** Ảnh / canvas / svg vuông có thể là mã QR (px CSS trong khung nhìn). */
  qr: PageRect[]
  /** Link otpauth:// thấy trong trang (thuộc tính / chữ). */
  otpauth: string[]
  scroll: { x: number; y: number }
}

export interface BubbleAgent {
  id: string
  name: string
  color: string
  on: boolean
}

export type CredBubble =
  | { kind: 'save'; update: boolean; host: string; username: string; itemName?: string; agents: BubbleAgent[]; waiting: string[] }
  | { kind: '2fa'; itemName: string; paste: boolean; error?: string }
  | {
      kind: 'qr'
      target: string
      isNew: boolean
      account?: string
      /** Mục đích đã có khoá 2FA: lưu là thay khoá cũ (mất hẳn) → hỏi rõ, kèm lựa chọn lưu thành mục mới. */
      replace?: boolean
      /** Tên đăng nhập của mục đích (che một phần), để so với tài khoản trong mã QR. */
      targetUser?: string
      saved: boolean
      canFill: boolean
      error?: string
    }

export interface CredPageUi {
  bubble: CredBubble | null
  /** Thông báo ngắn trên trang (tự ẩn). */
  toast?: string
  /** Đổi khi main gửi lại cùng một thông báo (để trang hiện lại). */
  toastId?: number
  /** Ngôn ngữ giao diện của app (main gắn vào mỗi lần gửi): lớp trang vẽ chữ theo nó. */
  locale?: Locale
}

export type CredAct =
  | { a: 'save'; agents: string[] }
  | { a: 'later' }
  | { a: 'never' }
  | { a: 'reveal' }
  | { a: '2fa-qr' }
  | { a: '2fa-paste' }
  | { a: '2fa-key'; key: string }
  | { a: '2fa-skip' }
  | { a: 'qr-save'; asNew?: boolean }
  | { a: 'qr-skip' }
  | { a: 'qr-fill' }
  | { a: 'code' }
  | { a: 'close' }

export type CredCmdBody =
  | { op: 'detect' }
  /** Điền: chỉ khi trang vẫn đúng `host` (trang đổi giữa chừng thì không điền). */
  | { op: 'fill'; host: string; username?: string; password?: string; code?: string }

export type CredCmd = { reqId: string } & CredCmdBody

export interface DetectResult {
  url: string
  user: boolean
  pass: boolean
  otp: boolean
  /** Chữ trên trang (cắt ngắn) để đoán loại 2FA. */
  text: string
  /** Có iframe khác tên miền đang hiện (form có thể nằm trong đó: không điền). */
  frames: boolean
}

export interface FillResult {
  ok: boolean
  error?: string
  /** Ô đã điền: 'username' | 'password' | 'otp' */
  filled: string[]
  /**
   * Đã bấm nút gửi bằng DOM. (Không dùng chuột CDP: view đang ẩn / bị hộp thoại che / cửa sổ bị che thì Chromium bỏ cú
   * bấm.)
   */
  clicked: boolean
  /** Không thấy nút: đã gửi form bằng requestSubmit. */
  formSubmitted: boolean
  /** Đã tích ô "ghi nhớ thiết bị / remember me". */
  remember: boolean
}
