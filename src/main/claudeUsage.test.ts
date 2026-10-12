import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeUsageState } from '@shared/claudeUsage'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))
const { ClaudeUsageService } = await import('./claudeUsage')

const TOKEN = 'sk-ant-oat01-test-token'
const USAGE = {
  five_hour: { utilization: 42, resets_at: '2026-10-12T16:00:00Z', locked_reason: null },
  seven_day: { utilization: 18, resets_at: '2026-10-17T21:00:00Z', locked_reason: null }
}
const PROFILE = { account: { email: 'me@example.com' } }

let dir: string
let creds: string
const now = Date.parse('2026-10-12T14:00:00Z')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stag-usage-'))
  creds = join(dir, '.credentials.json')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const writeCreds = (o: Record<string, unknown>): Promise<void> => writeFile(creds, JSON.stringify({ claudeAiOauth: o }))

function make(respond: (url: string) => Response | Promise<Response>, enabled = true) {
  const states: ClaudeUsageState[] = []
  const calls: Array<{ url: string; auth: string | null }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
    return respond(url)
  })
  const svc = new ClaudeUsageService({
    enabled: () => enabled,
    changed: (s) => states.push(s),
    version: '0.0.0',
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => now,
    credentialsPath: () => creds
  })
  return { svc, states, calls }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

describe('ClaudeUsageService', () => {
  it('reads usage + account with the OAuth token and never exposes the token', async () => {
    await writeCreds({ accessToken: TOKEN, expiresAt: now + 3600_000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' })
    const { svc, states, calls } = make((url) => json(url.endsWith('/usage') ? USAGE : PROFILE))
    await svc.refresh(true)
    expect(calls.map((c) => c.url)).toEqual(['https://api.anthropic.com/api/oauth/usage', 'https://api.anthropic.com/api/oauth/profile'])
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true)
    const s = svc.get()
    expect(s.status).toBe('ok')
    expect(s.usage?.session?.percent).toBe(42)
    expect(s.account).toEqual({ email: 'me@example.com', plan: 'Max 5×' })
    expect(s.fetchedAt).toBe(now)
    expect(JSON.stringify(states)).not.toContain(TOKEN)
  })

  it('is signed out without credentials, and does not call the API with an expired token', async () => {
    const a = make(() => json(USAGE))
    await a.svc.refresh(true)
    expect(a.svc.get().status).toBe('signedOut')
    expect(a.calls).toHaveLength(0)

    await writeCreds({ accessToken: TOKEN, expiresAt: now - 1 })
    const b = make(() => json(USAGE))
    await b.svc.refresh(true)
    expect(b.svc.get().status).toBe('signedOut')
    expect(b.calls).toHaveLength(0)
  })

  it('treats 401 as signed out and keeps the last numbers on other errors', async () => {
    await writeCreds({ accessToken: TOKEN, expiresAt: now + 3600_000 })
    let status = 200
    const { svc } = make((url) => (status === 200 ? json(url.endsWith('/usage') ? USAGE : PROFILE) : json({ error: {} }, status)))
    await svc.refresh(true)
    status = 500
    await svc.refresh(true)
    expect(svc.get()).toMatchObject({ status: 'ok', usage: { session: { percent: 42 } }, error: 'Claude trả lỗi 500.' })
    status = 401
    await svc.refresh(true)
    expect(svc.get()).toMatchObject({ status: 'signedOut', usage: null })
  })

  it('reports an error when nothing has been read yet and the response is unreadable', async () => {
    await writeCreds({ accessToken: TOKEN })
    const { svc } = make(() => json({ something: 'else' }))
    await svc.refresh(true)
    expect(svc.get().status).toBe('error')
  })

  it('does nothing while turned off and spaces out non-forced refreshes', async () => {
    await writeCreds({ accessToken: TOKEN })
    const off = make(() => json(USAGE), false)
    await off.svc.refresh(true)
    expect(off.calls).toHaveLength(0)

    const on = make((url) => json(url.endsWith('/usage') ? USAGE : PROFILE))
    await on.svc.refresh()
    await on.svc.refresh()
    expect(on.calls.filter((c) => c.url.endsWith('/usage'))).toHaveLength(1)
  })
})
