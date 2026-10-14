// Kho mật khẩu: phần chạy trong trang của ô Browser (cùng preload thế giới cô lập với lớp Soi, trang không đọc được).
// - Dò bước đăng nhập (form đăng nhập / ô 2FA) và điền giá trị main gửi (chỉ khi trang vẫn đúng tên miền).
// - Bắt lần bạn tự đăng nhập (giá trị gửi main, main chỉ giữ trong RAM tới khi bạn chọn Lưu / Để sau).
// - Tìm mã QR / khoá 2FA trên trang (main đọc mã QR và che bí mật khỏi tool của agent).
// - Vẽ bong bóng "Lưu mật khẩu?" / "Lưu khoá 2FA?" trong một shadow root đóng gắn vào <html> (ngoài <body>):
//   bản đọc trang của agent (browser_snapshot) không bao giờ đọc vào đó.
import { ipcRenderer } from 'electron'
import { CRED_IPC, type CapturedLogin, type CredAct, type CredBubble, type CredCmd, type CredPageUi, type DetectResult, type FillResult, type PageRect, type PageSeen } from '@shared/credentials'
import { ICONS, type IconName } from '../renderer/src/components/icons'

let host: HTMLElement | null = null
let root: ShadowRoot
let bubbleEl: HTMLDivElement
let toastEl: HTMLDivElement
let ui: CredPageUi = { bubble: null }
let lastToast = 0
/** Mật khẩu / mã app vừa điền (không hỏi lưu lại cái app tự điền). */
const filledByStag = new Set<string>()
/** Ô mật khẩu app đã điền: giữ type=password (nút "hiện mật khẩu" của trang không làm lộ cho agent chụp màn hình). */
const guarded = new WeakSet<HTMLInputElement>()
let lastCapture = ''
let lastSeen = ''
let revealTimer = 0
let codeTimer = 0

/** Phần tử gốc của lớp kho mật khẩu (lớp Soi bỏ qua bấm chuột vào đây). */
export function credHost(): HTMLElement | null {
  return host
}

export function startCredentials(): void {
  ipcRenderer.on(CRED_IPC.cmd, (_e, c: CredCmd) => void onCmd(c))
  ipcRenderer.on(CRED_IPC.ui, (_e, u: CredPageUi) => render(u))
  const ready = (): void => {
    void ipcRenderer
      .invoke(CRED_IPC.hello, location.href)
      .then((u: CredPageUi) => render(u))
      .catch(() => {})
    document.addEventListener('submit', (e) => onSubmitLike(e, e.target), true)
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target instanceof Element ? e.target.closest('button,input[type=submit],input[type=button],input[type=image],[role=button],a') : null
        if (t && submitLike(t)) onSubmitLike(e, t)
      },
      true
    )
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !e.isComposing) onSubmitLike(e, e.target)
      },
      true
    )
    scheduleSeen()
    new MutationObserver(() => scheduleSeen()).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class', 'hidden'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
}

// ---------- tìm ô ----------

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
}

function usable(el: HTMLInputElement): boolean {
  return !el.disabled && !el.readOnly && shown(el)
}

const TEXTY = new Set(['text', 'email', 'tel', 'number', ''])
const USER_HINT = /user|e-?mail|login|account|identifier|phone|tên đăng nhập|tài khoản|số điện thoại/i
const OTP_HINT = /otp|totp|mfa|2fa|two.?factor|one.?time|verif|security.?code|auth.?code|pin.?code|\bcode\b|\btoken\b|mã/i

function attrs(el: HTMLInputElement): string {
  return [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.labels?.[0]?.innerText].filter(Boolean).join(' ')
}

function passwordField(scope: ParentNode = document): HTMLInputElement | null {
  const all = [...scope.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(usable)
  return all.find((x) => x.autocomplete === 'current-password') ?? all[0] ?? null
}

function otpFields(): HTMLInputElement[] {
  const all = [...document.querySelectorAll<HTMLInputElement>('input')].filter((x) => usable(x) && x.type !== 'password' && x.type !== 'hidden')
  const one = all.find((x) => x.autocomplete === 'one-time-code')
  if (one) {
    // Ô tách rời có thể cùng gắn one-time-code.
    const group = all.filter((x) => x.autocomplete === 'one-time-code')
    return group.length >= 4 && group.every((x) => x.maxLength === 1) ? group : [one]
  }
  // Ô 6 số tách rời: 4–8 ô maxlength=1 cạnh nhau.
  const singles = all.filter((x) => x.maxLength === 1 && TEXTY.has(x.type))
  if (singles.length >= 4 && singles.length <= 8 && singles.every((x) => x.parentElement?.parentElement === singles[0].parentElement?.parentElement || x.parentElement === singles[0].parentElement))
    return singles
  const hinted = all.find((x) => TEXTY.has(x.type) && OTP_HINT.test(attrs(x)) && !USER_HINT.test(attrs(x)) && (x.maxLength <= 0 || x.maxLength <= 10 || x.inputMode === 'numeric'))
  return hinted ? [hinted] : []
}

function userField(pass: HTMLInputElement | null): HTMLInputElement | null {
  const scope: ParentNode = pass?.form ?? document
  const all = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((x) => usable(x) && TEXTY.has(x.type) && x.type !== 'number')
  const auto = all.find((x) => /username|email/.test(x.autocomplete))
  if (auto) return auto
  const typed = all.find((x) => x.type === 'email' || USER_HINT.test(attrs(x)))
  if (typed && !OTP_HINT.test(attrs(typed))) return typed
  if (!pass) return null
  // Ô chữ đứng ngay trước ô mật khẩu.
  const before = all.filter((x) => x.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING)
  const cand = before.at(-1)
  return cand && !/search|tìm/i.test(attrs(cand)) && cand.type !== 'search' ? cand : null
}

function crossFrames(): boolean {
  return [...document.querySelectorAll('iframe')].some((f) => {
    if (!shown(f)) return false
    try {
      return new URL(f.src, location.href).origin !== location.origin
    } catch {
      return false
    }
  })
}

function detect(): DetectResult {
  const pass = passwordField()
  return {
    url: location.href,
    pass: !!pass,
    user: !!userField(pass),
    otp: otpFields().length > 0,
    text: (document.body?.innerText ?? '').slice(0, 4000),
    frames: crossFrames()
  }
}

// ---------- điền ----------

/** Gõ giá trị như người dùng (React / Vue / Angular nhận sự kiện input); không được thì gán thẳng + bắn sự kiện. */
function put(el: HTMLInputElement, v: string): void {
  el.focus()
  try {
    el.select()
  } catch {
    /* ô number không select được */
  }
  let ok = false
  try {
    ok = document.execCommand('insertText', false, v)
  } catch {
    ok = false
  }
  if (!ok || el.value !== v) {
    el.value = v
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function markSecret(el: HTMLInputElement): void {
  el.setAttribute('data-stag-secret', '')
  if (el.type !== 'password' || guarded.has(el)) return
  guarded.add(el)
  new MutationObserver(() => {
    if (el.type !== 'password') el.type = 'password'
  }).observe(el, { attributes: true, attributeFilter: ['type'] })
}

const REMEMBER = /remember|keep me|stay signed|trust (?:this )?(?:device|browser|computer)|don'?t ask (?:again|on this)|ghi nhớ|nhớ (?:tôi|thiết bị|đăng nhập|mật khẩu)|tin cậy thiết bị|không hỏi lại/i

function tickRemember(scope: ParentNode): boolean {
  let ticked = false
  for (const c of scope.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
    if (c.checked || c.disabled) continue
    const text = [c.name, c.id, c.getAttribute('aria-label'), c.labels?.[0]?.innerText, c.closest('label')?.innerText].filter(Boolean).join(' ')
    if (!REMEMBER.test(text)) continue
    const label = c.labels?.[0] ?? c.closest('label')
    if (label && shown(label)) label.click()
    else c.click()
    if (!c.checked) {
      c.checked = true
      c.dispatchEvent(new Event('change', { bubbles: true }))
    }
    ticked = true
  }
  return ticked
}

const SUBMIT_TEXT = /^\s*(?:log ?in|sign ?in|đăng nhập|continue|next|tiếp tục|tiếp theo|tiếp|submit|verify|xác nhận|xác minh|confirm|gửi)\b/i

function submitLike(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.type === 'submit' || el.type === 'image' || ((el.type === 'button') && SUBMIT_TEXT.test(el.value))
  if (el instanceof HTMLButtonElement) return el.type === 'submit' || (!!el.form && !el.getAttribute('type')) || SUBMIT_TEXT.test(el.innerText)
  return SUBMIT_TEXT.test((el as HTMLElement).innerText ?? '')
}

function findSubmit(field: HTMLInputElement): HTMLElement | null {
  const ok = (b: Element): b is HTMLElement => b instanceof HTMLElement && shown(b) && !(b as HTMLButtonElement).disabled
  const form = field.form
  if (form) {
    const inForm = [...form.querySelectorAll('button[type=submit],input[type=submit],input[type=image],button:not([type])')].filter(ok)
    if (inForm.length) return inForm[0]
  }
  const near = [...document.querySelectorAll('button,[role=button],input[type=button],input[type=submit]')].filter(ok)
  return near.find((b) => submitLike(b)) ?? null
}

async function fill(c: Extract<CredCmd, { op: 'fill' }>): Promise<FillResult> {
  const res: FillResult = { ok: false, filled: [], clicked: false, formSubmitted: false, remember: false }
  // Trang đã đổi giữa lúc main kiểm tên miền và lúc điền: không điền gì.
  if (location.hostname.toLowerCase() !== c.host.toLowerCase()) return { ...res, error: 'the page changed to another domain' }
  let last: HTMLInputElement | null = null
  if (c.code) {
    const boxes = otpFields()
    if (!boxes.length) return { ...res, error: 'no 2FA code field on the page' }
    if (boxes.length > 1) boxes.forEach((b, i) => put(b, c.code![i] ?? ''))
    else put(boxes[0], c.code)
    boxes.forEach(markSecret)
    filledByStag.add(c.code)
    res.filled.push('otp')
    last = boxes[boxes.length - 1]
  } else {
    const pass = passwordField()
    const user = userField(pass)
    if (c.username !== undefined && user) {
      put(user, c.username)
      res.filled.push('username')
      last = user
    }
    if (c.password !== undefined) {
      if (!pass) return { ...res, error: 'no password field on the page' }
      put(pass, c.password)
      markSecret(pass)
      filledByStag.add(c.password)
      res.filled.push('password')
      last = pass
    }
    if (!res.filled.length) return { ...res, error: 'no username or password field on the page' }
  }
  res.remember = tickRemember(last?.form ?? document)
  // Nút gửi có thể chỉ bật sau khi framework nhận giá trị: chờ chút.
  let btn: HTMLElement | null = null
  for (let i = 0; i < 8 && !btn; i++) {
    await sleep(120)
    btn = last ? findSubmit(last) : null
  }
  // Bấm bằng DOM: chạy cả khi view đang ẩn / cửa sổ bị che (chuột CDP khi đó bị Chromium bỏ).
  if (btn) {
    btn.click()
    res.clicked = true
  } else if (last?.form) {
    try {
      last.form.requestSubmit()
      res.formSubmitted = true
    } catch {
      /* form không gửi được */
    }
  } else last?.focus()
  res.ok = true
  return res
}

async function onCmd(c: CredCmd): Promise<void> {
  let value: unknown = null
  try {
    if (c.op === 'detect') value = detect()
    else if (c.op === 'fill') value = await fill(c)
  } catch (e) {
    value = c.op === 'fill' ? { ok: false, filled: [], clicked: false, formSubmitted: false, remember: false, error: String((e as Error)?.message ?? e) } : null
  }
  ipcRenderer.send(CRED_IPC.res, { reqId: c.reqId, value })
}

// ---------- bạn tự đăng nhập ----------

function onSubmitLike(e: Event, t: EventTarget | null): void {
  if (!e.isTrusted || !(t instanceof Element)) return
  if (host && e.composedPath().includes(host)) return
  const scope: ParentNode = (t instanceof HTMLFormElement ? t : (t as HTMLInputElement).form) ?? document
  const pass = passwordField(scope) ?? passwordField()
  const user = userField(pass)
  // Bước chỉ có tên đăng nhập (trang hỏi mật khẩu ở bước sau): báo main nhớ tên.
  const c: CapturedLogin = { url: location.href, username: user?.value ?? '', password: pass?.value ?? '' }
  if (!c.password && !c.username) return
  if (c.password && filledByStag.has(c.password)) return
  const key = `${c.username}\u0000${c.password}`
  if (key === lastCapture) return
  lastCapture = key
  setTimeout(() => {
    if (lastCapture === key) lastCapture = ''
  }, 3000)
  ipcRenderer.send(CRED_IPC.captured, c)
}

// ---------- mã QR / khoá 2FA trên trang ----------

const KW = /authenticator|two-factor|2fa|2-step|two-step|mfa|totp|qr code|qr-code|scan (?:this|the) (?:qr|code)|mã qr|quét mã|xác thực hai|xác minh 2 bước|xác thực 2 bước|app xác thực|ứng dụng xác thực|otpauth/i
const B32 = /(?<![A-Za-z0-9])(?:[A-Z2-7]{2,8}[ -]){1,15}[A-Z2-7]{2,8}(?![A-Za-z0-9])|(?<![A-Za-z0-9])[A-Z2-7]{16,}(?![A-Za-z0-9])/g
let seenTimer = 0

function scheduleSeen(): void {
  if (seenTimer) return
  seenTimer = window.setTimeout(() => {
    seenTimer = 0
    sendSeen()
  }, 800)
}

function sendSeen(): void {
  const text = document.body?.innerText ?? ''
  const kw = KW.test(text) || KW.test(document.title)
  const s: PageSeen = { url: location.href, otp: otpFields().length > 0, secretText: false, qr: [], otpauth: [], scroll: { x: window.scrollX, y: window.scrollY } }
  if (kw) {
    s.secretText = (text.match(B32) ?? []).some((m) => m.replace(/[ -]/g, '').length >= 16)
    const html = document.documentElement.outerHTML
    s.otpauth = [...new Set(html.match(/otpauth:\/\/[^\s"'<>]+/gi) ?? [])].map((x) => x.replace(/&amp;/g, '&')).slice(0, 4)
    const rects: PageRect[] = []
    for (const el of document.querySelectorAll('img,canvas,svg')) {
      if (rects.length >= 6 || (host && host.contains(el))) break
      const r = el.getBoundingClientRect()
      if (r.width < 64 || r.width > 640 || Math.abs(r.width - r.height) > r.width * 0.15) continue
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth || !shown(el)) continue
      // Chừa lề trắng quanh mã (bộ đọc cần vùng lặng).
      const pad = 8
      rects.push({ x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), w: r.width + pad * 2, h: r.height + pad * 2 })
    }
    s.qr = rects
  }
  const sig = JSON.stringify([s.url, s.otp, s.secretText, s.otpauth, s.qr.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.w)])])
  if (sig === lastSeen) return
  lastSeen = sig
  ipcRenderer.send(CRED_IPC.seen, s)
}

// ---------- bong bóng của stag ----------

function ensureHost(): void {
  if (host) {
    if (!host.isConnected) document.documentElement.appendChild(host)
    return
  }
  host = document.createElement('stag-cred')
  host.setAttribute('style', 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block')
  root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  root.appendChild(style)
  bubbleEl = document.createElement('div')
  bubbleEl.className = 'bub'
  bubbleEl.hidden = true
  toastEl = document.createElement('div')
  toastEl.className = 'toast'
  root.append(bubbleEl, toastEl)
  for (const t of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut'] as const) host.addEventListener(t, (e) => e.stopPropagation())
  document.documentElement.appendChild(host)
}

function icon(name: IconName, cls = ''): string {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function act(a: CredAct): Promise<unknown> {
  return ipcRenderer.invoke(CRED_IPC.act, a).catch(() => null)
}

function render(u: CredPageUi): void {
  if (!u) return
  const toastChanged = !!u.toast && u.toastId !== lastToast
  ui = u
  if (!u.bubble && !toastChanged && !host) return
  ensureHost()
  clearInterval(codeTimer)
  clearTimeout(revealTimer)
  const b = u.bubble
  bubbleEl.hidden = !b
  bubbleEl.innerHTML = b ? bubbleHtml(b) : ''
  if (b) wire(b)
  if (toastChanged) {
    lastToast = u.toastId ?? 0
    toastEl.textContent = u.toast ?? ''
    toastEl.classList.add('on')
    setTimeout(() => toastEl.classList.remove('on'), 4200)
  }
}

function bubbleHtml(b: CredBubble): string {
  const x = `<button class="x" data-x title="Đóng">${icon('x')}</button>`
  if (b.kind === 'save') {
    const agents = b.update
      ? ''
      : `<div class="who">Agent được dùng</div><div class="ags">${b.agents
          .map((a) => `<button class="ag${a.on ? '' : ' off'}" data-ag="${esc(a.id)}"><span class="av" style="background:${a.color}">${esc(a.name.slice(0, 1).toUpperCase())}</span>${esc(a.name)}${icon('check', 'chk')}</button>`)
          .join('')}</div>${b.waiting.length ? `<div class="sub">${esc(b.waiting.join(', '))} được chọn sẵn vì đang chờ trang này.</div>` : ''}`
    return `${x}<h4>${icon('key')}${b.update ? 'Cập nhật mật khẩu?' : 'Lưu mật khẩu cho trang này?'}</h4>
      <div class="sub">${b.update ? `Mật khẩu bạn vừa dùng khác bản đã lưu trong “${esc(b.itemName ?? '')}”.` : `Bạn vừa đăng nhập ${esc(b.host)} trong ô Browser.`}</div>
      <div class="fr"><span class="k">Tên đăng nhập</span><span class="v">${esc(b.username) || '<i>(không thấy)</i>'}</span></div>
      <div class="fr"><span class="k">Mật khẩu</span><span class="v mono" data-pw>••••••••••••</span><button class="ib" data-eye title="Hiện 20 giây">${icon('eye')}</button></div>
      ${agents}
      <div class="acts"><button class="btn pri" data-save>${b.update ? 'Cập nhật' : 'Lưu'}</button><button class="btn" data-later>Để sau</button><span class="sp"></span><button class="btn ghost" data-never>Không bao giờ cho trang này</button></div>`
  }
  if (b.kind === '2fa') {
    return `${x}<h4>${icon('qr')}Trang này có 2FA. Lưu cả khoá 2FA?</h4>
      <div class="why">Mã 6 số bạn vừa gõ chỉ dùng được một lần. Để agent tự đăng nhập lần sau, stag cần <b>khoá bí mật</b>: thứ trang chỉ hiện lúc bật hoặc thiết lập lại 2FA.</div>
      <button class="opt" data-qr>${icon('monitor')}<div><b>Mở trang bảo mật để lấy mã QR</b><span>Thiết lập lại app xác thực trong ô Browser. stag tự nhận mã QR trên trang.</span></div></button>
      ${
        b.paste
          ? `<div class="paste"><input class="mono" data-key placeholder="Khoá bí mật hoặc otpauth://…" spellcheck="false" autocomplete="off"><button class="btn pri" data-keysave>Lưu</button></div>${b.error ? `<div class="err">${esc(b.error)}</div>` : ''}`
          : `<button class="opt" data-paste>${icon('key')}<div><b>Dán khoá bí mật</b><span>Nếu bạn còn giữ khoá lúc bật 2FA (hoặc có trong Bitwarden / Authy export).</span></div></button>`
      }
      <div class="acts"><span class="sp"></span><button class="btn ghost" data-skip>Để sau, agent nhờ tôi gõ mã</button></div>`
  }
  if (b.saved)
    return `${x}<h4>${icon('check', 'ok')}Đã lưu khoá 2FA vào “${esc(b.target)}”</h4>
      <div class="code"><span data-code>…</span><span class="left" data-left></span></div>
      <div class="sub">Trang hỏi mã xác nhận thì bạn gõ, hoặc để stag điền giúp.</div>
      <div class="acts">${b.canFill ? '<button class="btn pri" data-fill>stag điền mã xác nhận</button>' : ''}<span class="sp"></span><button class="btn" data-qrdone>Xong</button></div>`
  if (b.replace)
    return `${x}<h4>${icon('qr')}stag thấy mã QR 2FA trên trang</h4>
    <div class="sub">Mã QR${b.account ? ` của <b>${esc(b.account)}</b>` : ''}. “${esc(b.target)}”${b.targetUser ? ` (${esc(b.targetUser)})` : ''} <b>đã có khoá 2FA</b>: thay thì khoá cũ mất hẳn, không lấy lại được. Chỉ thay khi bạn vừa thiết lập lại 2FA cho đúng tài khoản này.</div>
    ${b.error ? `<div class="err">${esc(b.error)}</div>` : ''}
    <div class="acts"><button class="btn" data-qrsave>Thay khoá 2FA</button><button class="btn" data-qrnew>Lưu thành mục mới</button><span class="sp"></span><button class="btn ghost" data-qrskip>Bỏ qua</button></div>`
  return `${x}<h4>${icon('qr')}stag thấy mã QR 2FA trên trang</h4>
    <div class="sub">${b.isNew ? `Lưu thành mục mới “${esc(b.target)}”${b.account ? ` (${esc(b.account)})` : ''}?` : `Lưu vào “${esc(b.target)}”?`} Nhớ quét cùng mã này bằng điện thoại: thiết lập lại làm mã cũ trên điện thoại hết hiệu lực.</div>
    ${b.error ? `<div class="err">${esc(b.error)}</div>` : ''}
    <div class="acts"><button class="btn pri" data-qrsave>Lưu khoá 2FA</button><button class="btn ghost" data-qrskip>Bỏ qua</button></div>`
}

function wire(b: CredBubble): void {
  const q = <T extends Element = HTMLElement>(sel: string): T | null => bubbleEl.querySelector<T>(sel)
  const on = (sel: string, fn: () => void): void => {
    const el = q(sel)
    if (el) el.addEventListener('click', (e) => (e.stopPropagation(), fn()))
  }
  on('[data-x]', () => void act(b.kind === 'save' ? { a: 'later' } : b.kind === '2fa' ? { a: '2fa-skip' } : b.saved ? { a: 'close' } : { a: 'qr-skip' }))
  if (b.kind === 'save') {
    for (const el of bubbleEl.querySelectorAll<HTMLElement>('[data-ag]')) el.addEventListener('click', () => el.classList.toggle('off'))
    on('[data-eye]', async () => {
      const pw = q('[data-pw]')
      if (!pw) return
      if (pw.dataset.shown) {
        pw.textContent = '••••••••••••'
        delete pw.dataset.shown
        return
      }
      const v = (await act({ a: 'reveal' })) as string | null
      if (!v) return
      pw.textContent = v
      pw.dataset.shown = '1'
      revealTimer = window.setTimeout(() => {
        pw.textContent = '••••••••••••'
        delete pw.dataset.shown
      }, 20_000)
    })
    on('[data-save]', () => void act({ a: 'save', agents: [...bubbleEl.querySelectorAll<HTMLElement>('[data-ag]:not(.off)')].map((x) => x.dataset.ag!) }))
    on('[data-later]', () => void act({ a: 'later' }))
    on('[data-never]', () => void act({ a: 'never' }))
  } else if (b.kind === '2fa') {
    on('[data-qr]', () => void act({ a: '2fa-qr' }))
    on('[data-paste]', () => void act({ a: '2fa-paste' }))
    on('[data-skip]', () => void act({ a: '2fa-skip' }))
    const key = q<HTMLInputElement>('[data-key]')
    if (key) {
      key.focus()
      const send = (): void => void act({ a: '2fa-key', key: key.value })
      on('[data-keysave]', send)
      key.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) send()
      })
    }
  } else if (b.saved) {
    const tick = async (): Promise<void> => {
      const r = (await act({ a: 'code' })) as { code: string; left: number } | null
      const c = q('[data-code]')
      const l = q('[data-left]')
      if (r && c && l) {
        c.textContent = r.code
        l.textContent = `${r.left}s`
      }
    }
    void tick()
    codeTimer = window.setInterval(() => void tick(), 1000)
    on('[data-fill]', () => void act({ a: 'qr-fill' }))
    on('[data-qrdone]', () => void act({ a: 'qr-skip' }))
  } else {
    on('[data-qrsave]', () => void act({ a: 'qr-save' }))
    on('[data-qrnew]', () => void act({ a: 'qr-save', asNew: true }))
    on('[data-qrskip]', () => void act({ a: 'qr-skip' }))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const STYLE = `
:host{all:initial}
*{box-sizing:border-box}
.bub,.toast{font:13px/1.45 'Segoe UI Variable','Segoe UI',system-ui,sans-serif;color:#dde1e6;
  --accent:#2de2c0;--accentOn:#03201a;--panel2:#16191d;--panel3:#1d2126;--line2:#2a2f36;--muted:#99a0aa;--dim:#7d858f;--fg:#dde1e6;--danger:#f87171}
.bub{position:fixed;top:10px;right:10px;width:min(340px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto;pointer-events:auto;background:var(--panel2);
  border:1px solid var(--line2);border-left:3px solid var(--accent);border-radius:10px;box-shadow:0 16px 44px rgba(0,0,0,.5);padding:12px 12px 10px;cursor:default}
.bub[hidden]{display:none}
.ic{width:16px;height:16px;flex:none}
h4{margin:0 22px 4px 0;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:7px}
h4 .ic{color:var(--accent)}
h4 .ic.ok{color:#4ade80}
.x{position:absolute;top:8px;right:8px;width:24px;height:24px;border:0;border-radius:6px;background:none;color:var(--dim);display:grid;place-items:center;cursor:pointer}
.x:hover{background:var(--panel3);color:var(--fg)}
.x .ic{width:14px;height:14px}
.sub{color:var(--muted);font-size:12px;margin:2px 0 8px}
.why{color:var(--muted);font-size:12px;margin:2px 0 10px}
.why b{color:var(--fg);font-weight:600}
.fr{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid var(--line2);border-radius:7px;margin-bottom:5px;background:#0f1114}
.fr .k{color:var(--dim);font-size:11.5px;width:92px;flex:none}
.fr .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mono{font-family:'JetBrains Mono',Consolas,monospace;font-size:12px}
.ib{border:0;background:none;color:var(--dim);width:24px;height:24px;border-radius:6px;display:grid;place-items:center;cursor:pointer}
.ib:hover{background:var(--panel3);color:var(--fg)}
.who{color:var(--dim);font-size:11.5px;margin:8px 0 5px}
.ags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}
.ag{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--accent);background:rgba(45,226,192,.1);color:var(--fg);border-radius:999px;padding:2px 8px 2px 3px;font:inherit;font-size:12px;cursor:pointer}
.ag.off{border-color:var(--line2);background:none;color:var(--muted)}
.ag .chk{width:12px;height:12px;color:var(--accent)}
.ag.off .chk{display:none}
.av{width:17px;height:17px;border-radius:50%;display:grid;place-items:center;font-size:9.5px;font-weight:700;color:#0b0d10}
.acts{display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap}
.sp{flex:1}
.btn{border:1px solid var(--line2);background:var(--panel3);color:var(--fg);border-radius:7px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer}
.btn:hover{border-color:#3a414a}
.btn.pri{background:var(--accent);border-color:var(--accent);color:var(--accentOn);font-weight:600}
.btn.ghost{background:none;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{color:var(--fg)}
.opt{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:1px solid var(--line2);background:#0f1114;color:var(--fg);border-radius:8px;padding:8px 10px;margin-bottom:6px;font:inherit;cursor:pointer}
.opt:hover{border-color:var(--accent)}
.opt .ic{color:var(--accent);margin-top:2px}
.opt b{display:block;font-weight:600;font-size:12.5px}
.opt span{display:block;color:var(--muted);font-size:11.5px}
.paste{display:flex;gap:6px;margin-bottom:6px}
.paste input{flex:1;min-width:0;background:#0f1114;border:1px solid var(--line2);border-radius:7px;color:var(--fg);padding:6px 8px;outline:0}
.paste input:focus{border-color:var(--accent)}
.err{color:var(--danger);font-size:12px;margin-bottom:6px}
.code{display:flex;align-items:baseline;gap:10px;font:600 20px 'JetBrains Mono',Consolas,monospace;letter-spacing:1px;margin:4px 0}
.code .left{font:12px 'Segoe UI',system-ui,sans-serif;color:var(--dim);letter-spacing:0}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(16px);background:var(--panel3);border:1px solid var(--line2);border-radius:8px;
  padding:8px 13px;font-size:12.5px;opacity:0;transition:.2s;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:calc(100vw - 32px)}
.toast.on{opacity:1;transform:translateX(-50%)}
`
