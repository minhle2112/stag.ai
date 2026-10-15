import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, nativeImage, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  classifyStep,
  CRED_IPC,
  formatCode,
  hostMatches,
  hostOf,
  insecurePage,
  isTotpError,
  nameFromHost,
  needsAsk,
  normalizeDomain,
  parseImport,
  parseTotp,
  qrTarget,
  scrubSecrets,
  TWOFA_LABEL,
  visibleTo,
  type CapturedLogin,
  type CredAct,
  type CredBubble,
  type CredCmdBody,
  type CredentialInput,
  type CredentialNotice,
  type CredentialPatch,
  type CredentialView,
  type CredPageUi,
  type DetectResult,
  type FillResult,
  type ImportKind,
  type ImportPreview,
  type ImportRow,
  type PageSeen,
  type TotpParams,
  type TotpPreview,
  type TwoFaKind
} from '@shared/credentials'
import { agentColor } from '@shared/inspect'
import { getLocale, onLocaleChange, t as tr } from '@shared/i18n'
import { uiName } from '@shared/i18n/uiNames'
import type { AgentRequestInput } from '@shared/agentApi'
import type { Agent } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { AgentRequestAnswer } from './agentRequests'
import type { BrowserService, PageTab } from './browser'
import type { CredentialStore } from './credentialStore'
import { decodeQr } from './qr'
import { totpCode, totpLeft } from './totp'

/** "Cho phép 1 lần" = một lượt đăng nhập (gồm bước 2FA) trong chừng này. */
export const GRANT_MS = 2 * 60_000
/** Mật khẩu bạn vừa gõ chỉ giữ trong RAM tới khi bạn chọn, tối đa chừng này. */
export const CAPTURE_MS = 5 * 60_000
/** Agent vừa nhận credential_list rỗng cho một tên miền: coi là đang chờ trang đó chừng này. */
const WAITING_MS = 30 * 60_000
/** "Mở trang bảo mật để lấy mã QR": chờ mã QR trên trang chừng này. */
const QR_WATCH_MS = 10 * 60_000
const CLIP_CLEAR_MS = 30_000
/** Tên người làm trong nhật ký khi là bạn (không có agentId): Cài đặt → Mật khẩu hiện "Bạn" / "You" theo ngôn ngữ. */
const USER = 'user'
const PAGE_REPLY_MS = 2500

export interface CredentialDeps {
  store: CredentialStore
  browser: BrowserService
  /** Thẻ hỏi trong app. Không theo công tắc "Hỏi bạn trước…" của Agent API: mật khẩu theo cài đặt riêng của mục. */
  ask(agent: Agent, req: AgentRequestInput): Promise<AgentRequestAnswer>
  /** Agent (không phải ô terminal) của workspace: chọn trong bong bóng Lưu. */
  team(workspaceId: string): Array<{ id: string; name: string }>
  /** Gõ một dòng của app vào phiên agent (khi rảnh). */
  tell(agentId: string, text: string): void
  notice(n: CredentialNotice): void
}

/** Lần bạn tự đăng nhập đang chờ bạn chọn Lưu / Để sau (chỉ trong RAM). */
interface Pending {
  wsId: string
  tabId: string
  host: string
  username: string
  password: string
  /** Mục cùng tên miền + tên đăng nhập mà mật khẩu khác ("Cập nhật mật khẩu?"). */
  updateId?: string
  /** Agent đang chờ trang này (tích sẵn, được báo khi xong). */
  waiting: string[]
  /** Trang đã hỏi mã 2FA trong lượt đăng nhập này. */
  saw2fa: boolean
  shown: boolean
  /** Mục vừa lưu (bước hỏi khoá 2FA). */
  savedId?: string
  timer: NodeJS.Timeout
}

interface TabCred {
  wsId: string
  /** Giá trị app đã điền / biết trên tab này: che trong bản đọc trang. */
  secrets: string[]
  /** Trang đang hiện khoá 2FA (QR / chữ): từ chối chụp màn hình, che chuỗi base32. */
  secretOnScreen: boolean
  /** Lần thấy trang gần nhất. */
  seen?: PageSeen
  ui: CredPageUi
  pending?: Pending
  /** Mã QR 2FA đọc được trên trang đang hiện. */
  qr?: { raw: string; params: TotpParams; targetId?: string; savedId?: string }
  /** Chuỗi otpauth đã đọc / bỏ qua (không đọc lại mỗi lần trang đổi). */
  handled: Set<string>
  /** Vùng ảnh đã thử đọc QR trên trang này. */
  tried: Set<string>
  /** Tên đăng nhập bạn vừa gõ ở bước chỉ hỏi tên (trang hỏi mật khẩu ở bước sau). */
  lastUser?: { host: string; username: string; at: number }
}

type Reply = (v: unknown) => void

/**
 * Kho mật khẩu cho agent: tool credential_list / credential_fill (app tự điền trang trong ô Browser, agent không thấy
 * giá trị), khoá theo tên miền thật của webContents, thẻ hỏi quyền, nhật ký; bắt lần bạn tự đăng nhập để hỏi lưu;
 * nhận mã QR 2FA trên trang; che bí mật khỏi browser_snapshot / browser_screenshot.
 */
export class CredentialService {
  private tabs = new Map<string, TabCred>()
  private grants = new Map<string, number>()
  private waiting = new Map<string, { wsId: string; host: string; at: number }>()
  private reqs = new Map<string, Reply>()
  private imports = new Map<string, { rows: ImportRow[]; at: number }>()
  private watch: { itemId: string; host: string; until: number; tabId: string } | null = null
  private toastSeq = 0

  constructor(private d: CredentialDeps) {}

  // ---------- trạng thái tab ----------

  private tab(tabId: string, wsId: string): TabCred {
    let t = this.tabs.get(tabId)
    if (!t) {
      t = { wsId, secrets: [], secretOnScreen: false, ui: { bubble: null }, handled: new Set(), tried: new Set() }
      this.tabs.set(tabId, t)
    }
    return t
  }

  /** Chữ tool browser trả cho agent (snapshot, URL, console…): che giá trị bí mật. */
  scrub(tabId: string, text: string): string {
    const t = this.tabs.get(tabId)
    return scrubSecrets(text, t ? [...t.secrets, ...(t.pending ? [t.pending.password] : [])] : [], !!t?.secretOnScreen)
  }

  /** browser_screenshot: từ chối khi trang đang hiện khoá 2FA. */
  screenshotRefusal(tabId: string): string | null {
    const t = this.tabs.get(tabId)
    if (t?.secretOnScreen)
      return 'Refused: the page is showing a 2FA secret (QR code / setup key), so stag.ai does not take screenshots until the page changes. Use browser_snapshot (secrets are hidden there) or ask the user.'
    return null
  }

  /** Trang của tab vừa đổi (tải trang mới hoặc đổi trong trang). */
  navigated(wsId: string, tabId: string, _url: string, inPage: boolean): void {
    const t = this.tabs.get(tabId)
    if (!t) return
    if (!inPage) {
      t.secretOnScreen = false
      t.seen = undefined
      t.tried.clear()
      if (t.qr && !t.qr.savedId) t.qr = undefined
      if (t.ui.bubble?.kind === 'qr') this.setUi(tabId, { bubble: null })
    }
    // Bạn vừa bấm đăng nhập rồi trang chuyển đi: có vẻ đăng nhập được → hỏi lưu.
    const p = t.pending
    if (p && !p.shown) setTimeout(() => this.showSave(tabId), 700)
  }

  closed(tabId: string): void {
    const t = this.tabs.get(tabId)
    if (t?.pending) clearTimeout(t.pending.timer)
    this.tabs.delete(tabId)
  }

  private setUi(tabId: string, ui: CredPageUi): void {
    const t = this.tabs.get(tabId)
    if (!t) return
    t.ui = ui
    const p = this.d.browser.page(t.wsId, tabId)
    // Kèm ngôn ngữ giao diện: lớp trang (preload của tab) vẽ bong bóng theo ngôn ngữ của app.
    if (p && !p.wc.isDestroyed()) p.wc.send(CRED_IPC.ui, { ...ui, locale: getLocale() })
  }

  private bubble(tabId: string, b: CredBubble | null): void {
    const t = this.tabs.get(tabId)
    if (t) this.setUi(tabId, { bubble: b })
  }

  private toast(tabId: string, text: string): void {
    const t = this.tabs.get(tabId)
    if (t) this.setUi(tabId, { bubble: t.ui.bubble, toast: text, toastId: ++this.toastSeq })
  }

  // ---------- trang ↔ main ----------

  register(): void {
    // Đổi ngôn ngữ giao diện: vẽ lại bong bóng đang mở trên các trang theo ngôn ngữ mới.
    onLocaleChange(() => {
      for (const [id, tc] of this.tabs) if (tc.ui.bubble) this.setUi(id, tc.ui)
    })
    const page = (e: IpcMainEvent | IpcMainInvokeEvent): PageTab | null => {
      // Chỉ khung chính của tab browser của app.
      if (e.senderFrame && e.senderFrame.parent) return null
      return this.d.browser.pageTab(e.sender)
    }
    ipcMain.handle(CRED_IPC.hello, (e) => {
      const p = page(e)
      if (!p) return { bubble: null, locale: getLocale() }
      return { ...(this.tabs.get(p.tabId)?.ui ?? { bubble: null }), locale: getLocale() }
    })
    ipcMain.on(CRED_IPC.res, (e, msg: { reqId?: unknown; value?: unknown }) => {
      if (!page(e) || !msg) return
      const r = this.reqs.get(String(msg.reqId))
      if (r) {
        this.reqs.delete(String(msg.reqId))
        r(msg.value)
      }
    })
    ipcMain.on(CRED_IPC.captured, (e, c: CapturedLogin) => {
      const p = page(e)
      if (p && c && typeof c.password === 'string' && typeof c.url === 'string') void this.onCaptured(p, c)
    })
    ipcMain.on(CRED_IPC.seen, (e, s: PageSeen) => {
      const p = page(e)
      if (p && s && typeof s === 'object') void this.onSeen(p, s)
    })
    ipcMain.handle(CRED_IPC.act, (e, a: CredAct) => {
      const p = page(e)
      if (!p || !a || typeof a !== 'object') return null
      return this.onAct(p, a)
    })
  }

  private request<T>(p: PageTab, cmd: CredCmdBody, ms = PAGE_REPLY_MS): Promise<T | null> {
    if (p.wc.isDestroyed()) return Promise.resolve(null)
    const reqId = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.reqs.delete(reqId)
        resolve(null)
      }, ms)
      this.reqs.set(reqId, (v) => {
        clearTimeout(timer)
        resolve(v as T)
      })
      p.wc.send(CRED_IPC.cmd, { ...cmd, reqId })
    })
  }

  /** Dò bước đăng nhập trên trang, chờ trang mới tải / form hiện ra (tối đa ~`ms`). */
  private async detect(p: PageTab, ms = 6000): Promise<DetectResult | null> {
    const until = Date.now() + ms
    let last: DetectResult | null = null
    while (Date.now() < until) {
      const page = this.d.browser.page(p.wsId, p.tabId)
      if (!page) return null
      last = await this.request<DetectResult>(page, { op: 'detect' }, 1500)
      if (last && (last.user || last.pass || last.otp)) return last
      await delay(500)
    }
    return last
  }

  // ---------- tool của agent ----------

  /** credential_list: chỉ id, tên, tên miền, tên đăng nhập che một phần, có 2FA không. */
  list(agent: Agent, domain?: string): string {
    const want = domain ? normalizeDomain(domain) : null
    if (domain && !want) throw new Error(`"${domain}" is not a domain name.`)
    const host = want?.replace(/^\*\./, '') ?? ''
    const items = this.d.store
      .state()
      .items.filter((v) => visibleTo(v, agent.workspaceId))
      .filter((v) => !host || hostMatches(host, v.domains))
    if (!items.length) {
      if (host) this.waiting.set(agent.id, { wsId: agent.workspaceId, host, at: Date.now() })
      return host
        ? `[]   (no saved login for ${host}. Ask the user to log in by hand in the "${uiName.browser()}" pane — stag.ai will offer to save it — then continue; or ask them to add it in ${uiName.settings('passwords')}.)`
        : '[]   (the password vault has no item you may use.)'
    }
    return JSON.stringify(
      items.map((v) => ({ id: v.id, name: v.name, domains: v.domains, username_hint: v.hint, has_totp: v.hasTotp })),
      null,
      2
    )
  }

  private granted(agentId: string, itemId: string): boolean {
    const k = `${agentId}|${itemId}`
    const until = this.grants.get(k)
    if (until && until > Date.now()) return true
    if (until) this.grants.delete(k)
    return false
  }

  /** credential_fill: app tự điền trang trong tab của agent. Không bao giờ trả giá trị. */
  async fill(agent: Agent, id: string): Promise<string> {
    const { store, browser } = this.d
    const item = store.get(id)
    if (!item || !visibleTo(item, agent.workspaceId))
      throw new Error(`No password item "${id}" you may use. Call credential_list to see the items.`)
    const p = browser.agentPage(agent)
    if (!p) throw new Error('You have no Browser tab yet. Open the login page with browser_navigate first.')
    const url = p.wc.getURL()
    const host = hostOf(url)
    if (!hostMatches(host, item.domains)) return this.block(agent, item, host || url)
    if (insecurePage(url)) return this.insecure(agent, item, host)

    const step = await this.detect(p, 4000)
    if (!step) throw new Error('The page did not answer (still loading?). Wait a moment and call credential_fill again.')
    const kind = classifyStep(step)
    if (kind.kind === 'none')
      throw new Error(
        step.frames
          ? `No login form on this page itself: it may be inside a frame from another site, which stag.ai does not fill. Ask the user to log in by hand in the "${uiName.browser()}" pane.`
          : 'No login form or 2FA field found on this page. Open the login page first (browser_snapshot to check), then call credential_fill again.'
      )
    if (kind.kind === 'needs_user') return this.needsUser(agent, item, host, kind.how)
    if (kind.kind === 'otp') {
      if (kind.via === 'sms' || kind.via === 'email') return this.needsUser(agent, item, host, kind.via)
      if (!item.hasTotp) return this.needsUser(agent, item, host, 'code')
    }
    if ((kind.kind === 'login' || kind.kind === 'password') && !item.hasPassword)
      throw new Error(`Item "${id}" has no password saved (only a 2FA key). Ask the user to log in by hand in the "${uiName.browser()}" pane.`)

    // Hỏi bạn (theo cài đặt của mục).
    let how: 'once' | 'always' | 'auto' | 'grant' = this.granted(agent.id, item.id) ? 'grant' : 'auto'
    if (needsAsk(item, agent.id, how === 'grant')) {
      const answer = await this.d.ask(agent, {
        workspaceId: agent.workspaceId,
        fromAgentId: agent.id,
        fromName: agent.name,
        action: 'credential',
        credential: { id: item.id, name: item.name, username: item.username, hasTotp: item.hasTotp, host, step: kind.kind === 'otp' ? 'totp' : 'login', canAlways: item.policy !== 'ask' }
      })
      if (answer !== 'allow' && answer !== 'always') {
        await store.log({ itemId: item.id, itemName: item.name, agentId: agent.id, agentName: agent.name, host, action: 'denied', detail: answer })
        throw new Error(
          answer === 'timeout'
            ? `denied: the user did not answer in time. Ask the user before trying "${id}" again.`
            : `denied: the user did not allow using "${id}". Stop here; the user can log in by hand in the "${uiName.browser()}" pane and you continue from there.`
        )
      }
      how = answer === 'always' ? 'always' : 'once'
      if (answer === 'always') await store.approve(item.id, agent.id)
      this.grants.set(`${agent.id}|${item.id}`, Date.now() + GRANT_MS)
    }

    // Trang có thể đã đổi trong lúc chờ bạn: kiểm lại tên miền ngay trước khi điền.
    const now = browser.agentPage(agent)
    if (!now) throw new Error('Your Browser tab was closed.')
    const host2 = hostOf(now.wc.getURL())
    if (!hostMatches(host2, item.domains)) return this.block(agent, item, host2 || now.wc.getURL())
    if (insecurePage(now.wc.getURL())) return this.insecure(agent, item, host2)
    const sec = store.secret(item.id)
    if (!sec) throw new Error('stag.ai could not decrypt this item (vault copied from another Windows account?). Tell the user.')

    const fresh = (await this.detect(now, 3000)) ?? step
    const k2 = classifyStep(fresh)
    const t = this.tab(now.tabId, now.wsId)
    let filled: string
    let res: FillResult | null
    if (k2.kind === 'otp') {
      if (!sec.totp) return this.needsUser(agent, item, host2, 'code')
      // Mã sắp hết hạn: chờ mã mới (tránh gửi mã vừa hết hạn).
      if (totpLeft(sec.totp.period) <= 2) await delay(2500)
      const code = totpCode(sec.totp)
      t.secrets.push(code)
      res = await this.request<FillResult>(now, { op: 'fill', host: host2, code }, 4000)
      filled = 'totp'
    } else if (k2.kind === 'login' || k2.kind === 'password' || k2.kind === 'username') {
      t.secrets.push(sec.password)
      res = await this.request<FillResult>(
        now,
        { op: 'fill', host: host2, ...(k2.kind !== 'password' ? { username: sec.username } : {}), ...(k2.kind !== 'username' ? { password: sec.password } : {}) },
        4000
      )
      filled = k2.kind
    } else {
      throw new Error('The page changed while waiting for the user and has no login form now. Call browser_snapshot, then credential_fill again.')
    }
    if (!res?.ok) throw new Error(`Could not fill the form: ${res?.error ?? 'the page did not answer'}. Try again, or ask the user to log in by hand.`)

    // Trang đã bấm nút gửi / requestSubmit; không có cả hai thì nhấn Enter (ô vừa điền đang giữ con trỏ).
    if (!res.clicked && !res.formSubmitted) await browser.pressEnter(now.wsId, now.tabId)
    const submitted = true
    await browser.settleTab(now.wsId, now.tabId)
    await store.log({ itemId: item.id, itemName: item.name, agentId: agent.id, agentName: agent.name, host: host2, action: filled === 'totp' ? 'totp' : 'login', how })
    await store.touch(item.id, agent.name)

    const after = browser.agentPage(agent)
    const out: Record<string, unknown> = { filled, submitted, url: after?.wc.getURL() ?? '' }
    if (res.remember) out.remember_device = true
    if (after) {
      const next = await this.detect(after, 2500)
      const n = next ? classifyStep(next) : null
      if (n?.kind === 'otp')
        out.next =
          n.via === 'sms' || n.via === 'email'
            ? `the page asks for ${TWOFA_LABEL[n.via]}: ask the user to type it in the "${uiName.browser()}" pane, and do other work while you wait`
            : item.hasTotp
              ? 'the page now asks for the 2FA code — call credential_fill again'
              : `the page asks for ${TWOFA_LABEL.code}: ask the user to type it in the "${uiName.browser()}" pane`
      else if (n?.kind === 'password') out.next = 'the page now asks for the password — call credential_fill again'
      else if (n?.kind === 'needs_user') out.next = `the page asks for ${TWOFA_LABEL[n.how]}: ask the user to do it in the "${uiName.browser()}" pane, and do other work while you wait`
      else if (n?.kind === 'login' && filled !== 'totp') out.next = 'the login form is still shown: the login may have failed (wrong password?). Check with browser_snapshot and tell the user.'
    }
    // URL sau khi gửi có thể chứa mật khẩu (form method=GET): che như mọi chữ tool browser.
    return this.scrub(now.tabId, JSON.stringify(out, null, 2))
  }

  private async block(agent: Agent, item: CredentialView, host: string): Promise<never> {
    await this.d.store.log({ itemId: item.id, itemName: item.name, agentId: agent.id, agentName: agent.name, host, action: 'blocked', detail: 'domain_mismatch' })
    this.d.notice({ kind: 'blocked', workspaceId: agent.workspaceId, agentName: agent.name, itemId: item.id, itemName: item.name, host, allowed: item.domains })
    throw new Error(
      `refused: domain_mismatch\n  page: ${host}\n  item only for: ${item.domains.join(', ')}\n  Nothing was filled. The user has been told. If you reached this page from a link, it may be a fake login page: do not log in there.`
    )
  }

  /** Trang http:// ngoài máy: mật khẩu đi bản rõ qua mạng (có thể bị chen giữa) → không điền. */
  private async insecure(agent: Agent, item: CredentialView, host: string): Promise<never> {
    await this.d.store.log({ itemId: item.id, itemName: item.name, agentId: agent.id, agentName: agent.name, host, action: 'blocked', detail: 'insecure_page' })
    throw new Error(
      `refused: insecure_page\n  page: http://${host} (not encrypted)\n  Nothing was filled: stag.ai only fills https:// pages (or this computer). Try the https:// address of the same page; if there is none, ask the user to log in by hand.`
    )
  }

  private async needsUser(agent: Agent, item: CredentialView, host: string, how: TwoFaKind): Promise<string> {
    await this.d.store.log({ itemId: item.id, itemName: item.name, agentId: agent.id, agentName: agent.name, host, action: 'needs_user', detail: how })
    return JSON.stringify(
      {
        status: 'needs_user',
        twofa: how,
        message: `The page needs ${TWOFA_LABEL[how]}, which stag.ai cannot do for you. Ask the user to finish this step in the "${uiName.browser()}" pane (your tab), and do other work while you wait. Do not ask for the code in chat.`
      },
      null,
      2
    )
  }

  // ---------- bạn tự đăng nhập trong ô Browser ----------

  private async onCaptured(p: PageTab, captured: CapturedLogin): Promise<void> {
    let c = captured
    const { store } = this.d
    const url = p.wc.getURL()
    const host = hostOf(url)
    if (!host || host !== hostOf(c.url) || String(c.password ?? '').length > 4000) return
    const t = this.tab(p.tabId, p.wsId)
    // Bước chỉ hỏi tên đăng nhập (mật khẩu ở trang sau): nhớ tên cho lần bắt mật khẩu tới.
    if (!c.password) {
      if (c.username) t.lastUser = { host, username: String(c.username).slice(0, 300), at: Date.now() }
      return
    }
    // Mật khẩu bạn gõ: che trong mọi chữ agent đọc từ tab này (form GET đưa nó vào URL), kể cả khi không hỏi lưu.
    if (!t.secrets.includes(c.password)) t.secrets.push(c.password)
    if (!c.username && t.lastUser && t.lastUser.host === host && Date.now() - t.lastUser.at < CAPTURE_MS) c = { ...c, username: t.lastUser.username }
    if (insecurePage(url)) return this.toast(p.tabId, tr('passwords.page.insecure'))
    if (store.isNever(host) || !store.available()) return
    // (Giá trị app vừa tự điền: lớp trang tự bỏ qua; mục đã có đúng tên + mật khẩu: bỏ qua ngay dưới.)
    const username = String(c.username ?? '').slice(0, 300)
    const same = store.matching(host).find((v) => v.username.toLowerCase() === username.toLowerCase())
    if (same && store.secret(same.id)?.password === c.password) return
    if (t.pending) clearTimeout(t.pending.timer)
    const now = Date.now()
    const waiting = [...this.waiting.entries()].filter(([, w]) => w.wsId === p.wsId && w.host === host && now - w.at < WAITING_MS).map(([id]) => id)
    if (p.owner.kind === 'agent' && !waiting.includes(p.owner.agentId) && this.waiting.get(p.owner.agentId)?.host === host) waiting.push(p.owner.agentId)
    t.pending = {
      wsId: p.wsId,
      tabId: p.tabId,
      host,
      username,
      password: c.password,
      ...(same ? { updateId: same.id } : {}),
      waiting,
      saw2fa: false,
      shown: false,
      timer: setTimeout(() => this.dropPending(p.tabId), CAPTURE_MS)
    }
    // Trang không chuyển đi (SPA): sau vài giây mà ô mật khẩu đã mất thì cũng coi là đăng nhập được.
    setTimeout(() => {
      const cur = this.tabs.get(p.tabId)?.pending
      if (!cur || cur.shown) return
      const page = this.d.browser.page(p.wsId, p.tabId)
      if (!page) return
      void this.request<DetectResult>(page, { op: 'detect' }, 1500).then((r) => {
        if (r && !r.pass) this.showSave(p.tabId)
      })
    }, 4000)
  }

  private dropPending(tabId: string): void {
    const t = this.tabs.get(tabId)
    if (!t?.pending) return
    clearTimeout(t.pending.timer)
    t.pending = undefined
    if (t.ui.bubble?.kind === 'save' || t.ui.bubble?.kind === '2fa') this.bubble(tabId, null)
  }

  private showSave(tabId: string): void {
    const t = this.tabs.get(tabId)
    const p = t?.pending
    if (!t || !p || p.shown) return
    p.shown = true
    const team = this.d.team(p.wsId)
    const item = p.updateId ? this.d.store.get(p.updateId) : undefined
    this.bubble(tabId, {
      kind: 'save',
      update: !!p.updateId,
      host: p.host,
      username: p.username,
      ...(item ? { itemName: item.name } : {}),
      agents: team.map((a) => ({ id: a.id, name: a.name, color: agentColor(a.name), on: p.waiting.includes(a.id) })),
      waiting: team.filter((a) => p.waiting.includes(a.id)).map((a) => a.name)
    })
  }

  /** Lượt bạn tự đăng nhập xong: báo agent đang chờ trang đó. */
  private finish(tabId: string, saved?: { id: string; totp: boolean }): void {
    const t = this.tabs.get(tabId)
    const p = t?.pending
    if (!t || !p) return
    clearTimeout(p.timer)
    t.pending = undefined
    for (const id of p.waiting) {
      this.waiting.delete(id)
      this.d.tell(
        id,
        `[stag.ai] The user logged in to ${p.host} in the "${uiName.browser()}" pane.` +
          (saved ? ` New password item "${saved.id}"${saved.totp ? ' (with 2FA)' : ''}: next time call credential_fill("${saved.id}") to log in yourself.` : '') +
          ' Continue your task.'
      )
    }
  }

  private async onSeen(p: PageTab, s: PageSeen): Promise<void> {
    const t = this.tab(p.tabId, p.wsId)
    if (hostOf(s.url) !== hostOf(p.wc.getURL())) return
    t.seen = s
    if (s.otp && t.pending) t.pending.saw2fa = true
    if (s.secretText) t.secretOnScreen = true
    if (t.qr) return
    // Link otpauth:// trong trang, hoặc thử đọc QR trong vài ảnh vuông.
    let raw = s.otpauth.find((x) => /^otpauth:\/\/totp\//i.test(x) && !t.handled.has(x))
    if (!raw) {
      for (const r of s.qr.slice(0, 4)) {
        const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`
        if (t.tried.has(key)) continue
        t.tried.add(key)
        const png = await this.d.browser.capture(p.wsId, p.tabId, r, s.scroll)
        const data = png ? decodeQr(nativeImage.createFromBuffer(png)) : null
        if (data && /^otpauth:\/\/totp\//i.test(data) && !t.handled.has(data)) {
          raw = data
          break
        }
      }
    }
    if (!raw) return
    const params = parseTotp(raw)
    if (isTotpError(params)) return
    t.secretOnScreen = true
    t.secrets.push(params.secret)
    const host = hostOf(s.url)
    const w = this.watch && this.watch.until > Date.now() && this.watch.host === host ? this.watch : null
    const target = (w && this.d.store.get(w.itemId)) || qrTarget(this.d.store.matching(host), params.account)
    t.qr = { raw, params, ...(target ? { targetId: target.id } : {}) }
    this.bubble(p.tabId, {
      kind: 'qr',
      target: target?.name ?? nameFromHost(params.issuer || host),
      isNew: !target,
      ...(params.account ? { account: params.account } : {}),
      ...(target?.hasTotp ? { replace: true, ...(target.hint ? { targetUser: target.hint } : {}) } : {}),
      saved: false,
      canFill: !!s.otp
    })
  }

  private async onAct(p: PageTab, a: CredAct): Promise<unknown> {
    const { store } = this.d
    const t = this.tab(p.tabId, p.wsId)
    const pend = t.pending
    switch (a.a) {
      case 'reveal':
        return pend?.password ?? null
      case 'save': {
        if (!pend) return null
        try {
          let savedId: string
          let hasTotp = false
          if (pend.updateId) {
            await store.setPassword(pend.updateId, pend.password)
            savedId = pend.updateId
            hasTotp = !!store.get(savedId)?.hasTotp
            await store.log({ itemId: savedId, itemName: store.get(savedId)?.name ?? savedId, agentName: USER, host: pend.host, action: 'updated' })
          } else {
            const agents = (Array.isArray(a.agents) ? a.agents : []).map(String).filter((id) => this.d.team(pend.wsId).some((x) => x.id === id))
            const v = await store.save({ name: nameFromHost(pend.host), domains: [pend.host], username: pend.username, password: pend.password, agents, policy: 'first' })
            // Agent bạn tích ở đây coi như đã cho luôn (không hỏi lần đầu).
            if (agents.length) await store.patch(v.id, { approved: agents })
            savedId = v.id
            await store.log({ itemId: v.id, itemName: v.name, agentName: USER, host: pend.host, action: 'saved' })
          }
          pend.savedId = savedId
          this.toast(p.tabId, pend.updateId ? tr('passwords.page.updated') : tr('passwords.page.saved', { name: store.get(savedId)?.name ?? savedId }))
          // Trang vừa hỏi 2FA mà mục chưa có khoá: hỏi lưu khoá 2FA.
          if ((pend.saw2fa || t.seen?.otp) && !hasTotp) {
            this.bubble(p.tabId, { kind: '2fa', itemName: store.get(savedId)?.name ?? savedId, paste: false })
            return true
          }
          this.bubble(p.tabId, null)
          this.finish(p.tabId, { id: savedId, totp: hasTotp })
        } catch (e) {
          this.toast(p.tabId, tr('passwords.page.saveFailed', { message: (e as Error).message }))
        }
        return true
      }
      case 'later':
        this.bubble(p.tabId, null)
        this.finish(p.tabId)
        return true
      case 'never':
        if (pend) await store.addNever(pend.host)
        this.bubble(p.tabId, null)
        if (pend) this.toast(p.tabId, tr('passwords.page.never', { host: pend.host }))
        this.finish(p.tabId)
        return true
      case '2fa-qr': {
        if (!pend?.savedId) return null
        this.watch = { itemId: pend.savedId, host: pend.host, until: Date.now() + QR_WATCH_MS, tabId: p.tabId }
        this.bubble(p.tabId, null)
        this.toast(p.tabId, tr('passwords.page.watchQr'))
        // Agent đang chờ chờ thêm tới khi bạn lưu / bỏ qua mã QR (hoặc hết 10 phút).
        clearTimeout(pend.timer)
        pend.timer = setTimeout(() => this.finish(p.tabId, { id: pend.savedId!, totp: false }), QR_WATCH_MS)
        return true
      }
      case '2fa-paste':
        if (t.ui.bubble?.kind === '2fa') this.bubble(p.tabId, { ...t.ui.bubble, paste: true, error: undefined })
        return true
      case '2fa-key': {
        if (!pend?.savedId || t.ui.bubble?.kind !== '2fa') return null
        const params = parseTotp(String(a.key ?? ''))
        if (isTotpError(params)) {
          this.bubble(p.tabId, { ...t.ui.bubble, paste: true, error: params.error })
          return false
        }
        await store.setTotp(pend.savedId, params)
        await store.log({ itemId: pend.savedId, itemName: store.get(pend.savedId)?.name ?? '', agentName: USER, host: pend.host, action: 'totp_saved' })
        this.bubble(p.tabId, null)
        this.toast(p.tabId, tr('passwords.page.totpSaved', { code: formatCode(totpCode(params)) }))
        this.finish(p.tabId, { id: pend.savedId, totp: true })
        return true
      }
      case '2fa-skip':
        this.bubble(p.tabId, null)
        this.finish(p.tabId, pend?.savedId ? { id: pend.savedId, totp: false } : undefined)
        return true
      case 'qr-save': {
        const q = t.qr
        if (!q) return null
        const host = hostOf(p.wc.getURL())
        try {
          let id = a.asNew ? undefined : q.targetId
          if (id && store.get(id)) await store.setTotp(id, q.params)
          else {
            const base = nameFromHost(q.params.issuer || host)
            const v = await store.save({
              name: q.params.account && store.matching(host).length ? `${base} · ${q.params.account}` : base,
              domains: [host],
              username: q.params.account ?? '',
              totp: q.raw
            })
            id = v.id
          }
          q.savedId = id
          t.handled.add(q.raw)
          if (this.watch?.itemId === id) this.watch = null
          await store.log({ itemId: id, itemName: store.get(id)?.name ?? id, agentName: USER, host, action: 'totp_saved' })
          if (t.ui.bubble?.kind === 'qr') this.bubble(p.tabId, { ...t.ui.bubble, saved: true, isNew: false, target: store.get(id)?.name ?? id, canFill: !!t.seen?.otp })
        } catch (e) {
          if (t.ui.bubble?.kind === 'qr') this.bubble(p.tabId, { ...t.ui.bubble, error: (e as Error).message })
        }
        return true
      }
      case 'code': {
        const params = t.qr?.params
        return params ? { code: formatCode(totpCode(params)), left: totpLeft(params.period) } : null
      }
      case 'qr-fill': {
        const q = t.qr
        if (!q) return null
        const code = totpCode(q.params)
        t.secrets.push(code)
        const res = await this.request<FillResult>(p, { op: 'fill', host: hostOf(p.wc.getURL()), code }, 4000)
        if (res?.ok && !res.clicked && !res.formSubmitted) await this.d.browser.pressEnter(p.wsId, p.tabId)
        this.closeQr(p.tabId)
        return !!res?.ok
      }
      case 'qr-skip':
        if (t.qr) t.handled.add(t.qr.raw)
        this.closeQr(p.tabId)
        return true
      case 'close':
        this.bubble(p.tabId, null)
        return true
    }
    return null
  }

  private closeQr(tabId: string): void {
    const t = this.tabs.get(tabId)
    if (!t) return
    const saved = t.qr?.savedId
    this.bubble(tabId, null)
    // Lượt đăng nhập đang chờ mã QR (bước "Mở trang bảo mật"): xong.
    const p = t.pending ?? [...this.tabs.values()].find((x) => x.pending?.savedId && x.pending.savedId === saved)?.pending
    if (p) this.finish(p.tabId, p.savedId ? { id: p.savedId, totp: !!(p.savedId && this.d.store.get(p.savedId)?.hasTotp) } : undefined)
  }

  /** Nút chìa khoá của ô Browser: hiện lại bong bóng Lưu đang chờ của tab (nếu có). */
  reopen(tabId: string): boolean {
    const t = this.tabs.get(tabId)
    if (!t?.pending) return false
    t.pending.shown = false
    this.showSave(tabId)
    return true
  }

  hasPending(tabId: string): boolean {
    return !!this.tabs.get(tabId)?.pending
  }

  // ---------- Cài đặt → Mật khẩu (renderer) ----------

  registerUi(): void {
    const { store } = this.d
    ipcMain.handle(IPC.credList, () => store.state())
    ipcMain.handle(IPC.credSave, async (_e, input: CredentialInput) => {
      const v = await store.save(input)
      await store.log({ itemId: v.id, itemName: v.name, agentName: USER, host: v.domains[0] ?? '', action: input.id ? 'updated' : 'saved' })
      return v
    })
    ipcMain.handle(IPC.credPatch, (_e, id: string, patch: CredentialPatch) => store.patch(String(id), patch ?? {}))
    ipcMain.handle(IPC.credRemove, (_e, id: string) => store.remove(String(id)))
    ipcMain.handle(IPC.credNeverRemove, (_e, host: string) => store.removeNever(String(host)))
    ipcMain.handle(IPC.credReveal, (_e, id: string) => store.secret(String(id))?.password ?? null)
    ipcMain.handle(IPC.credCode, (_e, id: string) => {
      const totp = store.secret(String(id))?.totp
      return totp ? { code: totpCode(totp), left: totpLeft(totp.period), period: totp.period } : null
    })
    ipcMain.handle(IPC.credCopy, (_e, id: string, field: 'username' | 'password' | 'totp') => {
      const sec = store.secret(String(id))
      if (!sec) return false
      const v = field === 'username' ? sec.username : field === 'password' ? sec.password : sec.totp ? totpCode(sec.totp) : ''
      if (!v) return false
      clipboard.writeText(v)
      // Mật khẩu / mã: tự xoá khỏi clipboard sau 30 giây (nếu vẫn là nó).
      if (field !== 'username')
        setTimeout(() => {
          void Promise.resolve(clipboard.readText()).then((cur) => {
            if (cur === v) clipboard.clear()
          })
        }, CLIP_CLEAR_MS)
      return true
    })
    ipcMain.handle(IPC.credLog, (_e, id?: string) => store.readLog(id ? String(id) : undefined))
    ipcMain.handle(IPC.credTotpPreview, (_e, raw: string) => previewTotp(String(raw ?? '')))
    ipcMain.handle(IPC.credScanScreen, () => this.scanScreen())
    ipcMain.handle(IPC.credScanImage, async (e, dataUrl?: string) => {
      let img: Electron.NativeImage
      if (dataUrl) img = nativeImage.createFromDataURL(String(dataUrl))
      else {
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
        const opts: Electron.OpenDialogOptions = {
          title: tr('passwords.dialog.pickQr'),
          properties: ['openFile'],
          filters: [{ name: tr('passwords.dialog.images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
        }
        const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
        if (r.canceled || !r.filePaths[0]) return null
        img = nativeImage.createFromPath(r.filePaths[0])
      }
      const data = decodeQr(img)
      return data ? previewTotp(data) : { ok: false, error: tr('passwords.scan.noQrImage') }
    })
    ipcMain.handle(IPC.credImport, (e, kind: ImportKind) => this.importFile(e, kind))
    ipcMain.handle(IPC.credImportCommit, (_e, token: string, rows: number[]) => this.importCommit(String(token), Array.isArray(rows) ? rows.map(Number) : []))
    ipcMain.handle(IPC.credReopen, (_e, tabId: string) => this.reopen(String(tabId)))
  }

  /** Quét mã QR trên mọi màn hình. */
  private async scanScreen(): Promise<TotpPreview> {
    const sizes = screen.getAllDisplays().map((d) => ({ w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor) }))
    const width = Math.max(...sizes.map((s) => s.w), 1920)
    const height = Math.max(...sizes.map((s) => s.h), 1080)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
    for (const s of sources) {
      const data = decodeQr(s.thumbnail)
      if (data) return previewTotp(data)
    }
    return { ok: false, error: tr('passwords.scan.noQrScreen') }
  }

  private async importFile(e: IpcMainInvokeEvent, kind: ImportKind): Promise<ImportPreview | null> {
    const ext = kind === 'bitwarden-json' ? ['json'] : ['csv']
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const opts = { title: tr('passwords.dialog.pickExport'), properties: ['openFile' as const], filters: [{ name: kind === 'bitwarden-json' ? 'JSON' : 'CSV', extensions: ext }] }
    const r = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    const st = await fs.stat(file)
    if (st.size > 20 * 1024 * 1024) return { token: '', file, rows: [], errors: [tr('passwords.import.tooBig')] }
    const { rows, errors } = parseImport(kind, await fs.readFile(file, 'utf8'))
    const token = randomUUID()
    for (const [k, v] of this.imports) if (Date.now() - v.at > 10 * 60_000) this.imports.delete(k)
    this.imports.set(token, { rows, at: Date.now() })
    return {
      token,
      file,
      rows: rows.map((x) => ({ name: x.name, domains: x.domains, username: x.username, hasPassword: !!x.password, hasTotp: !!x.totp, duplicate: !!this.d.store.duplicateOf(x) })),
      errors
    }
  }

  private async importCommit(token: string, pick: number[]): Promise<{ added: number; updated: number; errors: string[] }> {
    const imp = this.imports.get(token)
    if (!imp) throw new Error(tr('passwords.import.expired'))
    this.imports.delete(token)
    const rows = pick.filter((i) => Number.isInteger(i) && i >= 0 && i < imp.rows.length).map((i) => imp.rows[i])
    const r = await this.d.store.importRows(rows)
    if (r.added + r.updated)
      await this.d.store.log({ itemId: '', itemName: `${r.added + r.updated} items`, agentName: USER, host: '', action: 'imported', detail: `+${r.added} / ~${r.updated}` })
    return r
  }

  /** Agent bị xoá: bỏ lượt cho phép / chờ của nó. */
  forgetAgent(agentId: string): void {
    this.waiting.delete(agentId)
    for (const k of [...this.grants.keys()]) if (k.startsWith(`${agentId}|`)) this.grants.delete(k)
  }
}

export function previewTotp(raw: string): TotpPreview {
  const p = parseTotp(raw)
  if (isTotpError(p)) return { ok: false, error: p.error }
  return {
    ok: true,
    value: raw.trim(),
    code: formatCode(totpCode(p)),
    left: totpLeft(p.period),
    ...(p.issuer ? { issuer: p.issuer } : {}),
    ...(p.account ? { account: p.account } : {})
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
