/** Ngôn ngữ giao diện (Cài đặt → Giao diện → Ngôn ngữ). */
export type Locale = 'vi' | 'en'
export const LOCALES: readonly Locale[] = ['vi', 'en']

/** Dạng số nhiều tiếng Anh, chọn theo tham số `count` (Intl.PluralRules). Tiếng Việt không cần. */
export interface Plural {
  one: string
  other: string
}
export type Entry = string | Plural

/** Một namespace tiếng Anh: đủ đúng các khoá của bản tiếng Việt (thiếu / thừa khoá = lỗi typecheck). */
export type EnNamespace<V> = { [K in keyof V]: Entry }
