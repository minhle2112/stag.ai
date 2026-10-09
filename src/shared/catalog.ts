import data from './connectorCatalog.json'
import type { CatalogEntry, CatalogMethod } from './types'

/** Danh mục connector (tạo bằng scripts/import-connector-catalog.mjs từ định nghĩa app của Paperclip, MIT). */
export const CATALOG: CatalogEntry[] = (data as { entries: CatalogEntry[] }).entries

export function findCatalog(slug: string, method?: string): { entry: CatalogEntry; method: CatalogMethod } | null {
  const entry = CATALOG.find((e) => e.slug === slug)
  const m = entry?.methods.find((x) => x.key === method) ?? (method ? undefined : entry?.methods[0])
  return entry && m ? { entry, method: m } : null
}

/** Điền `{field}` trong URL mẫu; thiếu / sai mẫu → lỗi tiếng Việt. */
export function fillServerUrl(m: CatalogMethod, fields: Record<string, string>): string {
  if (!m.serverUrlTemplate) return m.serverUrl ?? ''
  for (const f of m.fields) {
    const v = (fields[f.key] ?? '').trim()
    if (!v) throw new Error(`Cần điền "${f.label}".`)
    if (f.pattern && !new RegExp(f.pattern).test(v)) throw new Error(`"${f.label}" không đúng dạng (vd. ${f.placeholder}).`)
  }
  return m.serverUrlTemplate.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent((fields[k] ?? '').trim()))
}

/** Mô tả tiếng Việt cho các dịch vụ không dùng câu mẫu "Connect X's provider-hosted MCP server.". */
const VI: Record<string, string> = {
  context7: 'Tra tài liệu mới nhất của thư viện / framework.',
  github: 'Repo, issue, pull request: đọc code, bình luận, mở PR.',
  gmail: 'Tìm và đọc thư Gmail, tạo thư nháp (không gửi được thư).',
  'google-calendar': 'Đọc lịch và quản lý sự kiện Google Calendar.',
  'google-chat': 'Tìm, đọc hội thoại Google Chat và gửi tin.',
  'google-docs': 'Đọc và sửa tài liệu Google Docs.',
  'google-drive': 'Tìm, đọc, tạo và chép file trong Google Drive.',
  'google-people': 'Tìm danh bạ và hồ sơ trong tổ chức (Google People).',
  'google-sheets': 'Đọc và sửa bảng tính Google Sheets.',
  'google-slides': 'Đọc và sửa bản trình chiếu Google Slides.',
  'google-workspace-search': 'Tìm trong Gmail, Drive, Calendar và Chat bằng một tool chỉ đọc.',
  linear: 'Tạo, sửa và đọc issue Linear.',
  notion: 'Đọc và sửa trang trong workspace Notion.',
  posthog: 'Phân tích sử dụng sản phẩm, lỗi, feature flag và thử nghiệm trên PostHog.',
  sentry: 'Điều tra lỗi, bản phát hành và sự cố production.',
  shopify: 'Tìm sản phẩm, chính sách của cửa hàng và quản lý giỏ hàng.',
  slack: 'Cho agent dùng tool Slack: đọc, tìm và gửi tin.',
  vercel: 'Xem project, deployment và log khi chạy.',
  zapier: 'Nối tới hàng nghìn app qua tài khoản Zapier của bạn.'
}

/** Mô tả tiếng Việt của một dịch vụ trong danh mục. */
export function catalogDescription(e: CatalogEntry): string {
  if (VI[e.slug]) return VI[e.slug]
  return /provider-hosted MCP server\.?$/.test(e.description) ? `Máy chủ MCP chính thức của ${e.name}.` : e.description
}

/** Nhãn cách kết nối. */
export function methodLabel(e: CatalogEntry, m: CatalogMethod): string {
  const base =
    m.kind === 'oauth'
      ? `Đăng nhập ${e.name} trong trình duyệt`
      : m.kind === 'oauth-app'
        ? 'Đăng nhập bằng OAuth app của bạn'
        : m.kind === 'key'
          ? m.label && !/^Use an? API key$/i.test(m.label)
            ? m.label
            : 'Dùng API key'
          : m.kind === 'url'
            ? 'Dán URL máy chủ đã tạo'
            : m.kind === 'stdio'
              ? 'Chạy trên máy (npx)'
              : m.label || 'Không cần đăng nhập'
  return m.capability ? `${base} — ${m.capability.label}` : base
}
