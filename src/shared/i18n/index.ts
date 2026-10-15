import { vi } from './vi'
import { en } from './en'
import type { Entry, Locale } from './types'

export type { Entry, Locale, Plural, EnNamespace } from './types'
export { LOCALES } from './types'

/**
 * Chuỗi giao diện theo ngôn ngữ đang chọn. Từ điển tiếng Việt (`vi/`) là nguồn, tiếng Anh (`en/`) phải đủ khoá
 * (typecheck + i18n.test.ts). Khoá = `<namespace>.<khoá>`, tham số `{tên}` lấy từ chuỗi tiếng Việt nên có kiểu.
 * Chuỗi gửi cho agent (kết quả tool MCP, tin [stag.ai] …) KHÔNG đi qua đây: luôn viết thẳng tiếng Anh.
 */

type Dict = typeof vi
type Ns = keyof Dict & string

export type TKey = { [N in Ns]: `${N}.${keyof Dict[N] & string}` }[Ns]

type ValueOf<K extends string> = K extends `${infer N}.${infer R}`
  ? N extends Ns
    ? R extends keyof Dict[N]
      ? Dict[N][R]
      : never
    : never
  : never

type Placeholders<S> = S extends `${string}{${infer P}}${infer R}` ? P | Placeholders<R> : never

export type TParams<K extends TKey> = Placeholders<ValueOf<K>>
/** Khoá không có tham số: dùng cho bảng tra (`{ name: PlainKey }`) rồi gọi `t(o.name)`. */
export type PlainKey = { [K in TKey]: [TParams<K>] extends [never] ? K : never }[TKey]
export type TArgs<K extends TKey> = [TParams<K>] extends [never] ? [params?: undefined] : [params: Record<TParams<K>, string | number>]

let current: Locale = 'vi'
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  for (const f of [...listeners]) f()
}

/** Gọi `fn` mỗi lần đổi ngôn ngữ; trả về hàm huỷ. */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const flat: Partial<Record<Locale, Map<string, Entry>>> = {}
function table(l: Locale): Map<string, Entry> {
  let m = flat[l]
  if (!m) {
    m = new Map()
    for (const [ns, keys] of Object.entries(l === 'vi' ? vi : en) as [string, Record<string, Entry>][])
      for (const [k, v] of Object.entries(keys)) m.set(`${ns}.${k}`, v)
    flat[l] = m
  }
  return m
}

const pluralRules: Partial<Record<Locale, Intl.PluralRules>> = {}

/** Chuỗi của `key` ở ngôn ngữ `l` (thiếu thì lấy tiếng Việt, rồi chính khoá). */
export function translate(l: Locale, key: string, params?: Record<string, string | number>): string {
  const e = table(l).get(key) ?? table('vi').get(key) ?? key
  let s: string
  if (typeof e === 'string') s = e
  else {
    const n = Number(params?.count ?? 0)
    const rules = (pluralRules[l] ??= new Intl.PluralRules(l))
    s = rules.select(n) === 'one' ? e.one : e.other
  }
  return params ? s.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? fmtParam(params[p]) : m)) : s
}

function fmtParam(v: string | number): string {
  return typeof v === 'number' ? fmtNumber(v) : v
}

/** Chuỗi giao diện ở ngôn ngữ đang chọn. Số trong tham số được định dạng theo ngôn ngữ (1.234 / 1,234). */
export function t<K extends TKey>(key: K, ...args: TArgs<K>): string {
  return translate(current, key, args[0] as Record<string, string | number> | undefined)
}

/** Tên locale cho Intl. */
export function intlLocale(l: Locale = current): string {
  return l === 'vi' ? 'vi-VN' : 'en-US'
}

export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(intlLocale(), opts)
}

/** Ngày giờ theo ngôn ngữ đang chọn (mặc định: ngày + giờ ngắn). */
export function fmtDateTime(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }): string {
  return new Date(d).toLocaleString(intlLocale(), opts)
}

export function fmtDate(d: Date | number | string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Date(d).toLocaleDateString(intlLocale(), opts)
}

/** Giờ:phút (thêm giây khi `seconds`). */
export function fmtTime(d: Date | number | string, seconds = false): string {
  return new Date(d).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
}

/** Khoảng thời gian gọn không có "trước": "45 giây" / "5 phút" / "2 giờ" / "3 ngày" ("45 sec" / "5 min" / "2 hr" / "3 days"). */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const unit = (n: number, u: 'second' | 'minute' | 'hour' | 'day'): string =>
    new Intl.NumberFormat(intlLocale(), { style: 'unit', unit: u, unitDisplay: u === 'day' ? 'long' : 'short' }).format(n)
  if (s < 60) return unit(s, 'second')
  if (s < 3600) return unit(Math.round(s / 60), 'minute')
  if (s < 86400) return unit(Math.round(s / 3600), 'hour')
  return unit(Math.round(s / 86400), 'day')
}

/** "vừa xong" / "5 phút trước" / "hôm qua" ("just now" / "5 minutes ago" / "yesterday"). */
export function fmtRelative(at: Date | number | string, now = Date.now()): string {
  const diff = (new Date(at).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return t('common.justNow')
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' })
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return fmtDate(at)
}

/** Ngôn ngữ mặc định cho bản cài mới: Windows tiếng Việt → vi, còn lại → en. */
export function localeFromSystem(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}
