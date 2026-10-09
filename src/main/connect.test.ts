import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOG, catalogDescription, fillServerUrl, findCatalog, methodLabel } from '@shared/catalog'
import { connectFromCatalog } from './connect'
import type { OAuthService } from './oauth'
import { SecretStore, type Cipher } from './secrets'
import { SettingsStore } from './settings'

const plain: Cipher = { available: () => true, encrypt: (s) => Buffer.from([...s].reverse().join('')), decrypt: (b) => [...b.toString()].reverse().join('') }

async function deps(): Promise<{ settings: SettingsStore; secrets: SecretStore; oauth: OAuthService; logins: string[]; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'stag-connect-'))
  const settings = new SettingsStore(join(dir, 'settings.json'))
  await settings.load()
  const secrets = new SecretStore(join(dir, 'secrets.json'), plain)
  const logins: string[] = []
  const oauth = {
    login: async (name: string, o: { serverUrl: string; client?: { id: string } }) => {
      logins.push(`${name} ${o.serverUrl} ${o.client?.id ?? 'dcr'}`)
      await secrets.setMany([{ name, value: '{}' }])
    }
  } as unknown as OAuthService
  return { settings, secrets, oauth, logins, file: join(dir, 'settings.json') }
}

describe('danh mục', () => {
  it('có các dịch vụ quen thuộc, mỗi mục có ít nhất một cách kết nối', () => {
    for (const slug of ['notion', 'linear', 'github', 'supabase', 'zapier', 'context7', 'playwright']) expect(findCatalog(slug)).not.toBeNull()
    expect(CATALOG.every((e) => e.methods.length > 0)).toBe(true)
    // Cách chỉ dùng được qua Paperclip Cloud bị bỏ (GitHub chỉ còn token).
    expect(findCatalog('github')!.entry.methods.map((m) => m.kind)).toEqual(['key'])
  })
  it('nhãn, mô tả, URL mẫu', () => {
    const notion = findCatalog('notion')!
    expect(methodLabel(notion.entry, notion.method)).toBe('Đăng nhập Notion trong trình duyệt')
    expect(catalogDescription(findCatalog('airtable')!.entry)).toBe('Máy chủ MCP chính thức của Airtable.')
    const shop = findCatalog('shopify', 'storefront-mcp')!.method
    expect(fillServerUrl(shop, { storeDomain: 'demo.myshopify.com' })).toBe('https://demo.myshopify.com/api/mcp')
    expect(() => fillServerUrl(shop, { storeDomain: 'demo.com' })).toThrow(/không đúng dạng/)
    expect(() => fillServerUrl(shop, {})).toThrow(/Cần điền/)
  })
})

describe('connectFromCatalog', () => {
  it('API key Bearer → bearerSecret; bật cho mọi agent', async () => {
    const d = await deps()
    const id = await connectFromCatalog({ slug: 'supabase', method: 'mcp-api-key', access: { mode: 'all' }, fields: {}, value: 'sbp_123' }, d)
    const c = d.settings.get().app.connectors.items.find((x) => x.id === id)!
    expect(c).toMatchObject({ id: 'supabase', transport: 'http', url: 'https://mcp.supabase.com/mcp', bearerSecret: 'SUPABASE_KEY', enabled: true, catalog: { slug: 'supabase', method: 'mcp-api-key' } })
    expect(d.secrets.get('SUPABASE_KEY')).toBe('sbp_123')
    expect(readFileSync(d.file, 'utf8')).not.toContain('sbp_123')
  })

  it('header có tiền tố riêng (PagerDuty "Token token="), chỉ bật cho agent đã chọn', async () => {
    const d = await deps()
    const id = await connectFromCatalog({ slug: 'pagerduty', method: 'mcp-api-key-eu', access: { mode: 'agents', agentIds: ['a1', 'a2'] }, fields: {}, value: 'pd' }, d)
    const c = d.settings.get().app.connectors.items[0]
    expect(c.headers).toEqual({ Authorization: { secret: 'PAGERDUTY_KEY', prefix: 'Token token=' } })
    expect(c.url).toBe('https://mcp.eu.pagerduty.com/mcp')
    expect(c.enabled).toBe(false)
    expect(d.settings.get().agents.a1?.connectors).toEqual({ [id]: true })
    expect(d.settings.get().agents.a2?.connectors).toEqual({ [id]: true })
  })

  it('URL có token (Zapier) → bí mật, cài đặt chỉ giữ bản rút gọn; bật theo workspace', async () => {
    const d = await deps()
    const url = 'https://mcp.zapier.com/api/mcp/s/SECRET-TOKEN/mcp'
    const id = await connectFromCatalog({ slug: 'zapier', method: 'generated-url', access: { mode: 'workspace', workspaceId: 'w1' }, fields: {}, value: url }, d)
    const c = d.settings.get().app.connectors.items[0]
    expect(c).toMatchObject({ url: 'https://mcp.zapier.com/…', urlSecret: 'ZAPIER_URL' })
    expect(d.secrets.get('ZAPIER_URL')).toBe(url)
    expect(readFileSync(d.file, 'utf8')).not.toContain('SECRET-TOKEN')
    expect(d.settings.get().workspaces.w1?.connectors).toEqual({ [id]: true })
  })

  it('OAuth: đăng nhập rồi gắn bí mật OAUTH_<ID>; id trùng thêm hậu tố', async () => {
    const d = await deps()
    await connectFromCatalog({ slug: 'notion', method: 'mcp-oauth', access: { mode: 'all' }, fields: {} }, d)
    const id2 = await connectFromCatalog({ slug: 'notion', method: 'mcp-oauth', access: { mode: 'all' }, fields: {} }, d)
    expect(id2).toBe('notion-2')
    expect(d.logins).toEqual(['OAUTH_NOTION https://mcp.notion.com/mcp dcr', 'OAUTH_NOTION_2 https://mcp.notion.com/mcp dcr'])
    expect(d.settings.get().app.connectors.items[1]).toMatchObject({ oauth: true, bearerSecret: 'OAUTH_NOTION_2', label: 'Notion (notion-2)' })
  })

  it('OAuth app riêng cần Client ID; stdio dùng lệnh của danh mục', async () => {
    const d = await deps()
    await connectFromCatalog({ slug: 'linear', method: 'mcp-oauth', access: { mode: 'all' }, fields: {} }, d)
    await connectFromCatalog({ slug: 'linear', method: 'mcp-oauth', access: { mode: 'all' }, fields: {}, client: { id: 'lin-app', secret: 's' } }, d)
    expect(d.logins).toEqual(['OAUTH_LINEAR https://mcp.linear.app/mcp dcr', 'OAUTH_LINEAR_2 https://mcp.linear.app/mcp lin-app'])
    await connectFromCatalog({ slug: 'playwright', method: 'local', access: { mode: 'all' }, fields: {} }, d)
    expect(d.settings.get().app.connectors.items.find((c) => c.id === 'playwright')).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] })
  })

  it('lỗi rõ khi thiếu key / URL sai', async () => {
    const d = await deps()
    await expect(connectFromCatalog({ slug: 'stripe', method: 'mcp-api-key', access: { mode: 'all' }, fields: {}, value: ' ' }, d)).rejects.toThrow(/Stripe API key/)
    await expect(connectFromCatalog({ slug: 'zapier', method: 'generated-url', access: { mode: 'all' }, fields: {}, value: 'http://x' }, d)).rejects.toThrow(/https/)
    await expect(connectFromCatalog({ slug: 'nope', method: 'x', access: { mode: 'all' }, fields: {} }, d)).rejects.toThrow(/danh mục/)
    expect(d.settings.get().app.connectors.items).toEqual([])
  })
})
