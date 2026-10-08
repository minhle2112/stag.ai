// Kiểm tra tên agent, dùng chung cho main (quyết định cuối) và renderer (báo lỗi ngay khi gõ).
// Tên agent cũng là tên note bộ nhớ `60 Agents/<tên>.md` trong vault, nên phải hợp lệ làm tên file trên Windows.

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
const MAX_LENGTH = 100

/** Lý do tên không dùng được (null = dùng được). `name` đã được trim. */
export function agentNameProblem(name: string): string | null {
  if (!name) return 'Agent cần có tên'
  if (INVALID_CHARS.test(name)) return 'Tên không được chứa các ký tự < > : " / \\ | ? *'
  if (name.endsWith('.')) return 'Tên không được kết thúc bằng dấu chấm'
  if (RESERVED.test(name)) return `"${name}" là tên dành riêng của Windows, không dùng làm tên file được`
  if (name.length > MAX_LENGTH) return `Tên dài quá ${MAX_LENGTH} ký tự`
  return null
}

/** Hai tên agent trùng nhau (không phân biệt hoa thường, giống hệ thống file của Windows). */
export function sameAgentName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
