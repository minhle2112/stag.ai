import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApprovalQueue } from './approvals'
import { isWebUrl, OAuthService } from './oauth'
import { SecretStore, type Cipher } from './secrets'

const plain: Cipher = { available: () => true, encrypt: (s) => Buffer.from(s, 'utf8'), decrypt: (b) => b.toString('utf8') }

/** Máy chủ MCP + máy chủ xác thực giả: PRM (RFC 9728), metadata (RFC 8414), đăng ký (RFC 7591), PKCE, refresh. */
let server: Server
let base = ''
const log: string[] = []
let challenge = ''
let registered = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', base)
    log.push(`${req.method} ${u.pathname}`)
    const json = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (u.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['read'] })
      if (u.pathname.startsWith('/.well-known/oauth-authorization-server'))
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256']
        })
      if (u.pathname === '/register') {
        registered++
        return json(201, { client_id: 'cid-1', ...JSON.parse(body) })
      }
      if (u.pathname === '/authorize') {
        challenge = u.searchParams.get('code_challenge') ?? ''
        expect(u.searchParams.get('client_id')).toBe('cid-1')
        expect(u.searchParams.get('scope')).toBe('read')
        expect(u.searchParams.get('resource')).toBe(`${base}/mcp`)
        const back = new URL(u.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', 'code-xyz')
        back.searchParams.set('state', u.searchParams.get('state')!)
        res.writeHead(302, { Location: back.href })
        return res.end()
      }
      if (u.pathname === '/token') {
        const p = new URLSearchParams(body)
        if (p.get('grant_type') === 'authorization_code') {
          const ok = p.get('code') === 'code-xyz' && createHash('sha256').update(p.get('code_verifier')!).digest('base64url') === challenge
          return ok ? json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 60, token_type: 'Bearer' }) : json(400, { error: 'invalid_grant' })
        }
        if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'rt-1') return json(200, { access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' })
        return json(400, { error: 'invalid_grant' })
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

/** "Trình duyệt": theo chuyển hướng tới cổng nhận mã của app. */
const browser = async (url: string): Promise<void> => {
  await fetch(url)
}

describe('OAuthService', () => {
  it('tự đăng ký client, PKCE, đổi mã, cất token mã hoá, làm mới khi sắp hết hạn', async () => {
    const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'stag-oauth-')), 's.json'), plain)
    const oauth = new OAuthService(secrets, browser)
    await oauth.login('OAUTH_DEMO', { serverUrl: `${base}/mcp` })
    expect(registered).toBe(1)
    const saved = JSON.parse(secrets.get('OAUTH_DEMO')!)
    expect(saved.tokens).toMatchObject({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(saved.client.client_id).toBe('cid-1')
    // Còn 60 s (< 5 phút) → làm mới; gọi song song chỉ làm mới một lần (refresh token xoay vòng dùng được một lần).
    const posts = log.length
    expect(await Promise.all([oauth.accessToken('OAUTH_DEMO'), oauth.accessToken('OAUTH_DEMO'), oauth.fresh([{ name: 'OAUTH_DEMO', label: 'demo' }])])).toEqual([
      'at-2',
      'at-2',
      new Map([['OAUTH_DEMO', 'at-2']])
    ])
    expect(log.length - posts).toBe(1)
    expect(JSON.parse(secrets.get('OAUTH_DEMO')!).tokens).toMatchObject({ access_token: 'at-2', refresh_token: 'rt-1' })
    // Đã có hạn dài → dùng luôn, không gọi máy chủ.
    const before = log.length
    expect((await oauth.fresh([{ name: 'OAUTH_DEMO', label: 'demo' }, { name: 'PLAIN_KEY', label: 'x' }])).get('OAUTH_DEMO')).toBe('at-2')
    expect(log.length).toBe(before)
  })

  it('chưa đăng nhập / máy chủ không hỗ trợ OAuth → lỗi rõ', async () => {
    const secrets = new SecretStore(join(mkdtempSync(join(tmpdir(), 'stag-oauth-')), 's.json'), plain)
    const oauth = new OAuthService(secrets, browser)
    await expect(oauth.accessToken('OAUTH_NONE', 'Linear')).rejects.toThrow(/Linear.*chưa đăng nhập/)
    await expect(oauth.login('OAUTH_X', { serverUrl: 'http://127.0.0.1:9/mcp' })).rejects.toThrow(/không công bố cách đăng nhập/)
  })
})

describe('ApprovalQueue', () => {
  it('giữ câu hỏi tới khi trả lời / hết giờ / phiên đóng', async () => {
    const changes: number[] = []
    const q = new ApprovalQueue((l) => changes.push(l.length))
    const base = { workspaceId: 'w', agentId: 'a', agentName: 'Lead', connectorId: 'gh', tool: 'create_issue', input: { title: 'x' } }
    const p1 = q.ask(base)
    expect(q.list()[0]).toMatchObject({ tool: 'create_issue', input: '{\n  "title": "x"\n}' })
    q.answer(q.list()[0].id, 'always')
    expect(await p1).toBe('always')
    expect(await q.ask(base, 10)).toBe('timeout')
    const p3 = q.ask({ ...base, agentId: 'b' })
    q.cancelAgent('b')
    expect(await p3).toBe('deny')
    expect(changes).toEqual([1, 0, 1, 0, 1, 0])
  })
})

describe('isWebUrl (địa chỉ đăng nhập do máy chủ MCP khai báo)', () => {
  it('chỉ nhận https, hoặc http tới chính máy này', () => {
    expect(isWebUrl(new URL('https://auth.example.com/authorize'))).toBe(true)
    expect(isWebUrl(new URL('http://127.0.0.1:8080/authorize'))).toBe(true)
    expect(isWebUrl(new URL('http://localhost/authorize'))).toBe(true)
    expect(isWebUrl(new URL('http://auth.example.com/authorize'))).toBe(false)
    expect(isWebUrl(new URL('file://host/share/x.exe'))).toBe(false)
    expect(isWebUrl(new URL('search-ms:query=x'))).toBe(false)
    expect(isWebUrl(new URL('ms-settings:privacy'))).toBe(false)
  })
})
