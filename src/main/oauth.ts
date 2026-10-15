import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationFull, OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { OAUTH_SECRET_PREFIX } from '@shared/connectors'
import type { SecretStore } from './secrets'
import { getLocale, t } from '@shared/i18n'

/**
 * Đăng nhập OAuth cho connector HTTP (máy chủ MCP của nhà cung cấp: Notion, Linear, Sentry…), làm ngay trong app
 * để Claude Code, Codex và adapter ngoài cùng dùng một lần đăng nhập:
 * - tìm máy chủ xác thực (RFC 9728 / RFC 8414), hoặc dùng endpoint danh mục ghi sẵn;
 * - client: tự đăng ký (RFC 7591) hoặc OAuth app của người dùng (client id / secret);
 * - mở trình duyệt mặc định, nhận mã ở http://127.0.0.1:47621/oauth/callback (PKCE + state);
 * - token + client cất thành một bí mật `OAUTH_<ID>` (mã hoá như mọi bí mật); làm mới trước mỗi phiên agent.
 */

export const OAUTH_PORT = 47621
export const OAUTH_REDIRECT = `http://127.0.0.1:${OAUTH_PORT}/oauth/callback`
const LOGIN_TIMEOUT = 5 * 60_000
/** Làm mới khi token còn dưới chừng này. */
const REFRESH_MARGIN = 5 * 60_000

export interface OAuthLogin {
  serverUrl: string
  /** OAuth app của người dùng; không có = tự đăng ký client. */
  client?: { id: string; secret: string }
  endpoints?: { authorizationEndpoint?: string; tokenEndpoint?: string }
  scopes?: string[]
  params?: Record<string, string>
}

/** Nội dung bí mật OAUTH_<ID> (JSON). */
interface OAuthState {
  version: 1
  login: OAuthLogin
  authServerUrl: string
  metadata: OAuthMetadata
  client: OAuthClientInformationFull
  resource?: string
  scope?: string
  tokens: { access_token: string; refresh_token?: string; expires_at?: number; token_type?: string }
}

export class OAuthService {
  private pending: { cancel: () => void } | null = null

  constructor(
    private secrets: SecretStore,
    private openBrowser: (url: string) => Promise<void>
  ) {}

  /** Đăng nhập rồi cất token vào bí mật `name`. Ném lỗi tiếng Việt. */
  async login(name: string, opts: OAuthLogin): Promise<void> {
    if (this.pending) throw new Error(t('connectors.oauth.busy'))
    const serverUrl = new URL(opts.serverUrl)
    // 1. Máy chủ xác thực.
    let authServerUrl = new URL('/', serverUrl).href
    let metadata: OAuthMetadata | undefined
    let resource: string | undefined
    let scopesSupported: string[] | undefined
    try {
      const info = await discoverOAuthServerInfo(serverUrl)
      authServerUrl = String(info.authorizationServerUrl)
      metadata = info.authorizationServerMetadata as OAuthMetadata | undefined
      if (info.resourceMetadata) {
        resource = info.resourceMetadata.resource ? String(info.resourceMetadata.resource) : serverUrl.href
        scopesSupported = info.resourceMetadata.scopes_supported
      }
    } catch {
      /* dùng endpoint ghi sẵn (nếu có) */
    }
    if (!metadata && opts.endpoints?.authorizationEndpoint && opts.endpoints.tokenEndpoint) {
      authServerUrl = new URL('/', opts.endpoints.authorizationEndpoint).href
      metadata = {
        issuer: authServerUrl,
        authorization_endpoint: opts.endpoints.authorizationEndpoint,
        token_endpoint: opts.endpoints.tokenEndpoint,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256']
      } as OAuthMetadata
    }
    if (!metadata) throw new Error(t('connectors.oauth.noMetadata'))

    const scope = (opts.scopes?.length ? opts.scopes : scopesSupported)?.join(' ') || undefined
    // 2. Client.
    let client: OAuthClientInformationFull
    if (opts.client) {
      client = {
        client_id: opts.client.id,
        ...(opts.client.secret ? { client_secret: opts.client.secret } : {}),
        redirect_uris: [OAUTH_REDIRECT]
      } as OAuthClientInformationFull
    } else {
      if (!metadata.registration_endpoint) throw new Error(t('connectors.oauth.noRegistration'))
      try {
        client = await registerClient(authServerUrl, {
          metadata,
          clientMetadata: {
            client_name: 'stag.ai',
            redirect_uris: [OAUTH_REDIRECT],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none'
          },
          scope
        })
      } catch (e) {
        throw new Error(t('connectors.oauth.registerFailed', { message: (e as Error).message }))
      }
    }

    // 3. Trình duyệt → mã.
    const state = randomBytes(16).toString('hex')
    const { authorizationUrl, codeVerifier } = await startAuthorization(authServerUrl, {
      metadata,
      clientInformation: client,
      redirectUrl: OAUTH_REDIRECT,
      scope,
      state,
      resource: resource ? new URL(resource) : undefined
    })
    for (const [k, v] of Object.entries(opts.params ?? {})) authorizationUrl.searchParams.set(k, v)
    // Địa chỉ trang đăng nhập do máy chủ MCP (bên ngoài) khai báo: chỉ mở trang web. `file:`, `search-ms:`, `ms-…:` qua
    // shell.openExternal sẽ chạy chương trình / file trên máy người dùng.
    if (!isWebUrl(authorizationUrl)) throw new Error(t('connectors.oauth.badAuthUrl', { protocol: authorizationUrl.protocol }))
    const code = await this.waitForCode(authorizationUrl.href, state)

    // 4. Đổi mã lấy token.
    let tokens
    try {
      tokens = await exchangeAuthorization(authServerUrl, {
        metadata,
        clientInformation: client,
        authorizationCode: code,
        codeVerifier,
        redirectUri: OAUTH_REDIRECT,
        resource: resource ? new URL(resource) : undefined
      })
    } catch (e) {
      throw new Error(t('connectors.oauth.exchangeFailed', { message: (e as Error).message }))
    }
    const saved: OAuthState = {
      version: 1,
      login: opts,
      authServerUrl,
      metadata,
      client,
      resource,
      scope,
      tokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined
      }
    }
    await this.secrets.setMany([{ name, value: JSON.stringify(saved) }])
  }

  /** Đăng nhập lại với cấu hình đã lưu (token hết hạn / bị thu hồi). */
  async relogin(name: string): Promise<void> {
    const st = this.read(name)
    if (!st) throw new Error(t('connectors.oauth.unreadable', { name }))
    await this.login(name, st.login)
  }

  /** Huỷ lần đăng nhập đang chờ trình duyệt. */
  cancel(): void {
    this.pending?.cancel()
  }

  /** Lần làm mới đang chạy theo tên bí mật: nhiều phiên cùng xin token thì dùng chung một lần (refresh token xoay vòng chỉ dùng được một lần). */
  private refreshing = new Map<string, Promise<string>>()

  /** Access token còn hạn của bí mật OAuth (làm mới nếu sắp hết). Ném lỗi nếu phải đăng nhập lại. */
  accessToken(name: string, label = name): Promise<string> {
    const cur = this.refreshing.get(name)
    if (cur) return cur
    const p = this.doAccessToken(name, label).finally(() => {
      if (this.refreshing.get(name) === p) this.refreshing.delete(name)
    })
    this.refreshing.set(name, p)
    return p
  }

  private async doAccessToken(name: string, label: string): Promise<string> {
    const st = this.read(name)
    if (!st) throw new Error(t('connectors.oauth.notSignedIn', { label }))
    const exp = st.tokens.expires_at
    if (!exp || exp - Date.now() > REFRESH_MARGIN) return st.tokens.access_token
    if (!st.tokens.refresh_token) throw new Error(t('connectors.oauth.expired', { label }))
    try {
      const tok = await refreshAuthorization(st.authServerUrl, {
        metadata: st.metadata,
        clientInformation: st.client,
        refreshToken: st.tokens.refresh_token,
        resource: st.resource ? new URL(st.resource) : undefined
      })
      st.tokens = {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? st.tokens.refresh_token,
        token_type: tok.token_type,
        expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined
      }
      await this.secrets.setMany([{ name, value: JSON.stringify(st) }])
      return st.tokens.access_token
    } catch (e) {
      throw new Error(t('connectors.oauth.refreshFailed', { label, message: (e as Error).message }))
    }
  }

  /** Token mới cho mọi bí mật OAuth trong danh sách: map tên bí mật → access token. */
  async fresh(list: Array<{ name: string; label: string }>): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    for (const { name, label } of list) if (name.startsWith(OAUTH_SECRET_PREFIX)) out.set(name, await this.accessToken(name, label))
    return out
  }

  private read(name: string): OAuthState | null {
    const raw = this.secrets.get(name)
    if (!raw) return null
    try {
      const j = JSON.parse(raw) as OAuthState
      return j?.version === 1 && j.tokens?.access_token ? j : null
    } catch {
      return null
    }
  }

  /** Mở trình duyệt và chờ trang đăng nhập chuyển về cổng cục bộ. */
  private waitForCode(url: string, state: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let server: Server | null = null
      let timer: NodeJS.Timeout | undefined
      const finish = (err: Error | null, code?: string): void => {
        clearTimeout(timer)
        server?.close()
        server = null
        this.pending = null
        if (err) reject(err)
        else resolve(code!)
      }
      this.pending = { cancel: () => finish(new Error(t('connectors.oauth.cancelled'))) }
      server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', OAUTH_REDIRECT)
        if (u.pathname !== '/oauth/callback') {
          res.writeHead(404).end()
          return
        }
        // Sai state: không phải lượt đăng nhập này (trang / chương trình khác gọi vào cổng) → bỏ qua, chờ tiếp.
        if (u.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(t('connectors.oauth.page.stateMismatch')))
          return
        }
        const err = u.searchParams.get('error')
        const ok = !err && !!u.searchParams.get('code')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(page(ok ? t('connectors.oauth.page.ok') : err ? t('connectors.oauth.page.failedWith', { error: err }) : t('connectors.oauth.page.failed')))
        if (ok) finish(null, u.searchParams.get('code')!)
        else finish(new Error(err ? t('connectors.oauth.denied', { error: u.searchParams.get('error_description') ?? err }) : t('connectors.oauth.noCode')))
      })
      server.once('error', (e: NodeJS.ErrnoException) =>
        finish(new Error(e.code === 'EADDRINUSE' ? t('connectors.oauth.portBusy', { port: String(OAUTH_PORT) }) : e.message))
      )
      server.listen(OAUTH_PORT, '127.0.0.1', () => {
        timer = setTimeout(() => finish(new Error(t('connectors.oauth.timeout'))), LOGIN_TIMEOUT)
        this.openBrowser(url).catch((e) => finish(e as Error))
      })
    })
  }
}

/** https, hoặc http chỉ tới chính máy này (máy chủ thử nghiệm cục bộ). */
export function isWebUrl(u: URL): boolean {
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
}

const page = (msg: string): string =>
  `<!doctype html><html lang="${getLocale()}"><meta charset="utf-8"><title>stag.ai</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>${msg.replace(/</g, '&lt;')}</p>`
