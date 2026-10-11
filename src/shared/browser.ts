import type { ExternalPagePolicy, SearchEngine } from './types'

/** Logic thuần của trình duyệt trong app (địa chỉ, tìm kiếm, quyền mở trang của agent), dùng chung main và renderer. */

const SEARCH: Record<SearchEngine, string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
}

export const SEARCH_ENGINE_LABELS: Record<SearchEngine, string> = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' }

export function searchUrl(engine: SearchEngine, query: string): string {
  return (SEARCH[engine] ?? SEARCH.google) + encodeURIComponent(query)
}

/** localhost, 127.x.x.x (đúng dạng IPv4, không phải tên miền `127.evil.com`), ::1, *.localhost — agent dùng tự do. */
export function isLocalUrl(url: URL): boolean {
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h)
}

/**
 * Chuỗi gõ vào thanh địa chỉ → URL nếu trông giống địa chỉ (`localhost:5173` → http, `github.com` → https,
 * có giao thức thì giữ nguyên), không thì null.
 */
export function addressOf(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^localhost:\d/i.test(s)) return s
  if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(s)) return `http://${s}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s)) return `https://${s}`
  return null
}

/** Chuỗi gõ vào thanh địa chỉ → URL. Không giống địa chỉ thì tìm bằng máy tìm kiếm đã chọn. */
export function toUrl(input: string, engine: SearchEngine = 'google'): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  return addressOf(s) ?? searchUrl(engine, s)
}

/**
 * Tên máy hợp lệ. Cần kiểm riêng: URL của Chromium (renderer) nhận cả tên có dấu cách (`bad%20host`) trong khi Node
 * (main) từ chối, nên giao diện tưởng lưu được mà main lặng lẽ bỏ.
 */
const HOST_RE = /^([a-z0-9-]+\.)*[a-z0-9-]+$|^\[[0-9a-f:.]+\]$/i

/**
 * Ô "Trang tab mới" trong Cài đặt: '' = trang trống; địa chỉ http(s) → URL đầy đủ để lưu;
 * không phải địa chỉ web → null (báo lỗi, không lưu).
 */
export function homePageInput(input: string): string | null {
  const s = input.trim()
  if (!s) return ''
  const url = addressOf(s)
  if (!url) return null
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && HOST_RE.test(u.hostname) ? u.href : null
  } catch {
    return null
  }
}

/** Ô thêm "Trang luôn cho phép": `github.com`, `localhost:3000`, `https://a.dev/x` → origin; sai → null. */
export function originInput(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : (addressOf(s) ?? `https://${s}`))
    return (u.protocol === 'http:' || u.protocol === 'https:') && HOST_RE.test(u.hostname) ? u.origin : null
  } catch {
    return null
  }
}

export interface OriginPolicy {
  externalPages: ExternalPagePolicy
  allowedOrigins: readonly string[]
}

/**
 * Agent có được mở `raw` không: `open` = mở luôn, `ask` = hỏi người dùng, `deny` = chặn không hỏi (Cài đặt chặn
 * trang ngoài), `invalid` = không phải trang http(s).
 * Thứ tự: localhost / about: → origin luôn cho (Cài đặt) → chính sách. Origin người dùng đã cho trong lần chạy này
 * (`allowedNow`) chỉ tính khi chính sách là hỏi.
 */
export function originDecision(raw: string, policy: OriginPolicy, allowedNow: (origin: string) => boolean = () => false): 'open' | 'ask' | 'deny' | 'invalid' {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'invalid'
  }
  if (url.protocol === 'about:') return 'open'
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid'
  if (isLocalUrl(url) || policy.allowedOrigins.includes(url.origin)) return 'open'
  if (policy.externalPages === 'allow') return 'open'
  if (policy.externalPages === 'deny') return 'deny'
  return allowedNow(url.origin) ? 'open' : 'ask'
}

/** Tên partition (session Electron) của trình duyệt một workspace: `persist:` = cookie lưu xuống đĩa. */
export function browserPartition(workspaceId: string, keepCookies: boolean): string {
  return `${keepCookies ? 'persist:' : ''}stag-browser-${workspaceId}`
}

/** Lỗi tool browser_* trả cho agent khi Cài đặt tắt "Cho agent dùng trình duyệt" giữa phiên. */
export const BROWSER_TOOLS_OFF = 'The user turned off the in-app browser for this agent in stag.ai settings.'
