// Kiểm tra tên agent, dùng chung cho main (quyết định cuối) và renderer (báo lỗi ngay khi gõ).
// Tên agent cũng là tên note bộ nhớ `60 Agents/<tên>.md` trong vault, nên phải hợp lệ làm tên file trên Windows.
import { getLocale, translate, type Locale, type TKey } from './i18n'

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const MAX_LENGTH = 100

/**
 * Lý do tên không dùng được (null = dùng được). `name` đã được trim. `locale`: ngôn ngữ của câu báo lỗi (mặc định:
 * ngôn ngữ giao diện); đường trả lỗi cho agent (tool MCP) truyền 'en'.
 */
export function agentNameProblem(name: string, locale: Locale = getLocale()): string | null {
  const m = (key: TKey, params?: Record<string, string | number>): string => translate(locale, key, params)
  if (!name) return m('agents.name.empty')
  if (INVALID_CHARS.test(name)) return m('agents.name.invalidChars', { chars: '< > : " / \\ | ? *' })
  if (name.endsWith('.')) return m('agents.name.endsWithDot')
  if (RESERVED.test(name)) return m('agents.name.reserved', { name })
  if (name.length > MAX_LENGTH) return m('agents.name.tooLong', { count: MAX_LENGTH })
  // Tên nằm trong wikilink [[tên]] của nhật ký; `#` / `^` cắt thành tiêu đề / khối, `[ ]` làm vỡ link.
  if (/[[\]#^]/.test(name)) return m('agents.name.invalidChars', { chars: '[ ] # ^' })
  // Note cất việc cũ của agent X là `60 Agents/X archive.md`: agent tên "X archive" sẽ dùng chung file đó.
  if (/\sarchive$/i.test(name)) return m('agents.name.archive')
  return null
}

/**
 * Hai tên agent trùng nhau (không phân biệt hoa thường, giống hệ thống file của Windows). Chuẩn hoá NFC trước: "Kiểm thử"
 * gõ kiểu tổ hợp (Unikey "Unicode tổ hợp") và kiểu dựng sẵn trông y hệt nhau.
 */
export function sameAgentName(a: string, b: string): boolean {
  return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()
}
