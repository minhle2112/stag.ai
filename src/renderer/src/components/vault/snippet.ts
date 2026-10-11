// Dòng ngữ cảnh ngắn cho cột "Liên kết ngược": lấy đúng dòng chứa link trong note nguồn, bỏ ký hiệu markdown.
import { splitWikilink } from '@shared/wikilink'

/** `- [x] Xem **[[Note|bí danh]]** ở \`code\`` → `Xem bí danh ở code`. */
export function cleanLine(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/!?\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
      const w = splitWikilink(inner)
      return w.alias ?? (w.target || w.heading || inner)
    })
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Dòng `line` (từ 1, tính cả frontmatter) của `text`, đã làm sạch; rỗng nếu không có. */
export function snippetAt(text: string, line: number): string {
  const l = text.split('\n')[line - 1]
  return l === undefined ? '' : cleanLine(l.replace(/\r$/, ''))
}
