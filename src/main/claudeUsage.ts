import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { parseUsage, planLabel, type ClaudeAccount, type ClaudeUsageState } from '@shared/claudeUsage'
import { claudeConfigDir } from './context'

/**
 * Hỏi usage của tài khoản Claude đang đăng nhập trong Claude Code (mục "Claude" ở thanh trạng thái).
 * Dùng token OAuth trong `<CLAUDE_CONFIG_DIR | ~/.claude>/.credentials.json`, gọi endpoint của lệnh `/usage`.
 * Token chỉ nằm trong hàm `fetchUsage`: không lưu lại, không ghi log, không gửi sang renderer.
 * Token hết hạn thì KHÔNG tự làm mới (làm mới sẽ xoay refresh token, Claude Code đang giữ bản cũ sẽ bị đăng xuất):
 * chờ Claude Code tự làm mới ở lượt sau, tới đó hiện "chưa đăng nhập".
 */

const API = 'https://api.anthropic.com'
const POLL_MS = 3 * 60_000
/** Server trả 429 → nghỉ lâu hơn. */
const BACKOFF_MS = 10 * 60_000
/** Agent hết lượt → hỏi lại sau chừng này (để server kịp cộng lượt vừa xong), không dày hơn MIN_GAP_MS. */
const POKE_DELAY_MS = 15_000
const MIN_GAP_MS = 60_000
const TIMEOUT_MS = 15_000

interface OAuthCreds {
  token: string
  expiresAt: number | null
  plan: string
}

type Fetch = typeof fetch

export interface ClaudeUsageDeps {
  /** Bật trong Cài đặt → Chung. */
  enabled: () => boolean
  changed: (s: ClaudeUsageState) => void
  version: string
  fetch?: Fetch
  now?: () => number
  credentialsPath?: () => string
}

class AuthError extends Error {}
class RateLimited extends Error {}

export class ClaudeUsageService {
  private state: ClaudeUsageState = { status: 'loading', usage: null, account: null, fetchedAt: null }
  private timer: NodeJS.Timeout | null = null
  private pokeTimer: NodeJS.Timeout | null = null
  private inflight: Promise<void> | null = null
  private lastAttempt = 0
  private pausedUntil = 0
  private email = ''
  private fetch: Fetch
  private now: () => number

  constructor(private deps: ClaudeUsageDeps) {
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? Date.now
  }

  get(): ClaudeUsageState {
    return this.state
  }

  /** Theo cài đặt: bật thì hỏi ngay + hẹn giờ hỏi đều; tắt thì dừng. Gọi lúc mở app và mỗi lần cài đặt đổi. */
  sync(): void {
    if (!this.deps.enabled()) {
      this.stopTimers()
      if (this.state.status !== 'off') this.set({ status: 'off', usage: null, account: null, fetchedAt: null })
      return
    }
    if (this.timer) return
    if (this.state.status === 'off') this.set({ status: 'loading', usage: null, account: null, fetchedAt: null })
    this.timer = setInterval(() => void this.refresh(), POLL_MS)
    this.timer.unref?.()
    void this.refresh(true)
  }

  /** Một agent Claude vừa hết lượt: hỏi lại sau ít giây. */
  poke(): void {
    if (!this.timer || this.pokeTimer) return
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null
      void this.refresh()
    }, POKE_DELAY_MS)
    this.pokeTimer.unref?.()
  }

  /** `force` = người dùng bấm Làm mới (bỏ qua khoảng cách tối thiểu và thời gian nghỉ sau 429). */
  refresh(force = false): Promise<void> {
    if (!this.deps.enabled()) return Promise.resolve()
    if (this.inflight) return this.inflight
    const now = this.now()
    if (!force && (now - this.lastAttempt < MIN_GAP_MS || now < this.pausedUntil)) return Promise.resolve()
    this.lastAttempt = now
    this.inflight = this.run(force).finally(() => (this.inflight = null))
    return this.inflight
  }

  shutdown(): void {
    this.stopTimers()
  }

  private stopTimers(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.pokeTimer) clearTimeout(this.pokeTimer)
    this.timer = this.pokeTimer = null
  }

  private set(s: ClaudeUsageState): void {
    this.state = s
    this.deps.changed(s)
  }

  private async run(force: boolean): Promise<void> {
    const creds = await this.readCreds()
    if (!creds) return this.signedOut('Không thấy tài khoản Claude Code trên máy.')
    if (creds.expiresAt !== null && creds.expiresAt <= this.now()) return this.signedOut('Phiên đăng nhập Claude Code đã hết hạn.')
    try {
      const raw = await this.request(creds.token, '/api/oauth/usage')
      const usage = parseUsage(raw)
      if (!usage) throw new Error('Không đọc được dữ liệu usage (Claude đổi dạng trả về?).')
      if (!this.email || force) this.email = await this.request(creds.token, '/api/oauth/profile').then(profileEmail, () => this.email)
      if (!this.deps.enabled()) return
      const account: ClaudeAccount = { email: this.email, plan: creds.plan }
      this.set({ status: 'ok', usage, account, fetchedAt: this.now() })
    } catch (e) {
      if (!this.deps.enabled()) return
      if (e instanceof AuthError) return this.signedOut('Claude từ chối phiên đăng nhập hiện tại.')
      if (e instanceof RateLimited) this.pausedUntil = this.now() + BACKOFF_MS
      // Giữ số lần trước (nếu có), chỉ báo lỗi.
      this.set({ ...this.state, status: this.state.usage ? 'ok' : 'error', error: e instanceof Error ? e.message : 'Lỗi không rõ.' })
    }
  }

  private signedOut(error: string): void {
    if (!this.deps.enabled()) return
    this.email = ''
    this.set({ status: 'signedOut', usage: null, account: null, fetchedAt: null, error })
  }

  private async readCreds(): Promise<OAuthCreds | null> {
    const path = this.deps.credentialsPath?.() ?? join(claudeConfigDir(), '.credentials.json')
    try {
      const o = (JSON.parse(await readFile(path, 'utf8')) as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth
      if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return null
      return {
        token: o.accessToken,
        expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : null,
        plan: planLabel(o.subscriptionType, o.rateLimitTier)
      }
    } catch {
      return null
    }
  }

  private async request(token: string, path: string): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetch(API + path, {
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': `stag.ai/${this.deps.version}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      throw new Error('Không kết nối được tới Claude.')
    }
    if (res.status === 401 || res.status === 403) throw new AuthError()
    if (res.status === 429) throw new RateLimited('Claude đang giới hạn số lần hỏi, thử lại sau ít phút.')
    if (!res.ok) throw new Error(`Claude trả lỗi ${res.status}.`)
    return res.json()
  }
}

function profileEmail(raw: unknown): string {
  const acc = raw && typeof raw === 'object' ? (raw as { account?: { email?: unknown } }).account : undefined
  return typeof acc?.email === 'string' ? acc.email : ''
}

export function registerClaudeUsageIpc(svc: ClaudeUsageService): void {
  ipcMain.handle(IPC.claudeUsageGet, () => svc.get())
  ipcMain.handle(IPC.claudeUsageRefresh, async () => {
    await svc.refresh(true)
    return svc.get()
  })
}
