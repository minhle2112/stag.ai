import data from './connectorCatalog.json'
import type { CatalogEntry, CatalogMethod } from './types'
import { t, type PlainKey } from './i18n'

/** Danh mục connector (tạo bằng scripts/import-connector-catalog.mjs từ định nghĩa app của Paperclip, MIT). */
export const CATALOG: CatalogEntry[] = (data as { entries: CatalogEntry[] }).entries

export function findCatalog(slug: string, method?: string): { entry: CatalogEntry; method: CatalogMethod } | null {
  const entry = CATALOG.find((e) => e.slug === slug)
  const m = entry?.methods.find((x) => x.key === method) ?? (method ? undefined : entry?.methods[0])
  return entry && m ? { entry, method: m } : null
}

/** Điền `{field}` trong URL mẫu; thiếu / sai mẫu → lỗi theo ngôn ngữ giao diện. */
export function fillServerUrl(m: CatalogMethod, fields: Record<string, string>): string {
  if (!m.serverUrlTemplate) return m.serverUrl ?? ''
  for (const f of m.fields) {
    const v = (fields[f.key] ?? '').trim()
    if (!v) throw new Error(t('connectors.catalog.fieldRequired', { label: f.label }))
    if (f.pattern && !new RegExp(f.pattern).test(v)) throw new Error(t('connectors.catalog.fieldPattern', { label: f.label, example: f.placeholder }))
  }
  return m.serverUrlTemplate.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent((fields[k] ?? '').trim()))
}

/** Mô tả riêng (khoá từ điển) cho các dịch vụ không dùng câu mẫu "Connect X's provider-hosted MCP server.". */
const DESC: Record<string, PlainKey> = {
  context7: 'connectors.catalog.desc.context7',
  filesystem: 'connectors.catalog.desc.filesystem',
  github: 'connectors.catalog.desc.github',
  gmail: 'connectors.catalog.desc.gmail',
  'google-calendar': 'connectors.catalog.desc.google-calendar',
  'google-chat': 'connectors.catalog.desc.google-chat',
  'google-docs': 'connectors.catalog.desc.google-docs',
  'google-drive': 'connectors.catalog.desc.google-drive',
  'google-people': 'connectors.catalog.desc.google-people',
  'google-sheets': 'connectors.catalog.desc.google-sheets',
  'google-slides': 'connectors.catalog.desc.google-slides',
  'google-workspace-search': 'connectors.catalog.desc.google-workspace-search',
  linear: 'connectors.catalog.desc.linear',
  notion: 'connectors.catalog.desc.notion',
  playwright: 'connectors.catalog.desc.playwright',
  posthog: 'connectors.catalog.desc.posthog',
  sentry: 'connectors.catalog.desc.sentry',
  shopify: 'connectors.catalog.desc.shopify',
  slack: 'connectors.catalog.desc.slack',
  vercel: 'connectors.catalog.desc.vercel',
  zapier: 'connectors.catalog.desc.zapier'
}

/** Hướng dẫn riêng (khoá từ điển) của một cách kết nối, theo `<slug>:<method>`. */
const GUIDE: Record<string, PlainKey> = {
  'filesystem:local': 'connectors.catalog.guide.filesystem'
}

/** Mô tả của một dịch vụ trong danh mục, theo ngôn ngữ giao diện. */
export function catalogDescription(e: CatalogEntry): string {
  if (DESC[e.slug]) return t(DESC[e.slug])
  return /provider-hosted MCP server\.?$/.test(e.description) ? t('connectors.catalog.official', { name: e.name }) : e.description
}

/** Hướng dẫn của một cách kết nối (rỗng = không có). */
export function methodGuide(e: CatalogEntry, m: CatalogMethod): string {
  const k = GUIDE[`${e.slug}:${m.key}`]
  return k ? t(k) : m.guide
}

/** Nhãn cách kết nối. */
export function methodLabel(e: CatalogEntry, m: CatalogMethod): string {
  const base =
    m.kind === 'oauth'
      ? t('connectors.method.oauth', { name: e.name })
      : m.kind === 'oauth-app'
        ? t('connectors.method.oauthApp')
        : m.kind === 'key'
          ? m.label && !/^Use an? API key$/i.test(m.label)
            ? m.label
            : t('connectors.method.key')
          : m.kind === 'url'
            ? t('connectors.method.url')
            : m.kind === 'stdio'
              ? t('connectors.method.stdio')
              : m.label || t('connectors.method.none')
  return m.capability ? `${base} — ${m.capability.label}` : base
}
