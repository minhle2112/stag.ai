import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { fmtNumber, getLocale, onLocaleChange, t, translate, type Locale, type TKey, type TParams } from '@shared/i18n'

export { t, fmtDate, fmtDateTime, fmtDuration, fmtNumber, fmtRelative, fmtTime } from '@shared/i18n'

/** Ngôn ngữ giao diện đang chọn; component vẽ lại khi đổi. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale)
}

/**
 * `const t = useT()` trong component: trả về hàm `t` và vẽ lại component khi đổi ngôn ngữ (đổi là áp dụng ngay,
 * không tải lại). Hàm thường (không phải component) gọi thẳng `t` từ '@shared/i18n' / './i18n'.
 */
export function useT(): typeof t {
  useLocale()
  return t
}

/**
 * Chuỗi có phần tử React ở chỗ tham số, vd. `tx('agents.deleteAsk', { name: <b>{name}</b> })` với 'Xoá {name}?'.
 * Tham số `count` là số thì còn dùng để chọn dạng số nhiều tiếng Anh (như t()).
 */
export function tx<K extends TKey>(key: K, params: Record<TParams<K>, ReactNode>): ReactNode {
  const p = params as Record<string, ReactNode>
  const raw = translate(getLocale(), key, typeof p.count === 'number' ? { count: p.count } : undefined)
  return raw.split(/\{(\w+)\}/g).map((part, i) => {
    if (i % 2 === 0) return part
    const v = p[part]
    return <Fragment key={i}>{v === undefined ? `{${part}}` : typeof v === 'number' ? fmtNumber(v) : v}</Fragment>
  })
}
