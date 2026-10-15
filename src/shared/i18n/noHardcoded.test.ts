import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Chặn chuỗi tiếng Việt viết cứng trong code: chữ người dùng thấy phải nằm trong từ điển `src/shared/i18n/vi/`, chữ
 * gửi cho agent thì viết tiếng Anh. Bỏ qua comment, file test và từ điển. Chỗ cố ý giữ tiếng Việt (từ khoá giọng nói
 * tiếng Việt, câu mẫu cho AI sửa chính tả tiếng Việt…) đánh dấu `i18n-ignore` trong comment cùng dòng, hoặc
 * `i18n-ignore-file` ở đầu file.
 */

const ROOT = join(__dirname, '..', '..', '..')
const VI = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹĐ]/i

function files(dir: string): string[] {
  const out: string[] = []
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name)
    if (d.isDirectory()) out.push(...files(p))
    else if (/\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) && !d.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** Dòng còn chữ tiếng Việt sau khi bỏ comment (`//…`, `/* … *\/`, `{/* … *\/}`). Quét theo dòng, đủ cho code ở repo này. */
function vietnameseLines(text: string): { line: number; text: string }[] {
  if (/i18n-ignore-file/.test(text.slice(0, 2000))) return []
  const out: { line: number; text: string }[] = []
  let inBlock = false
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.includes('i18n-ignore')) return
    let s = raw
    let code = ''
    while (s.length) {
      if (inBlock) {
        const end = s.indexOf('*/')
        if (end < 0) {
          s = ''
          break
        }
        s = s.slice(end + 2)
        inBlock = false
        continue
      }
      const start = s.indexOf('/*')
      if (start < 0) {
        code += s
        break
      }
      code += s.slice(0, start)
      s = s.slice(start + 2)
      inBlock = true
    }
    // `//` đứng đầu dòng hoặc sau khoảng trắng mở comment (https:// thì đứng sau ':').
    code = code.replace(/(^|\s)\/\/.*$/, '$1')
    if (VI.test(code)) out.push({ line: i + 1, text: raw.trim() })
  })
  return out
}

describe('no hard-coded Vietnamese', () => {
  it('the scanner ignores comments and markers', () => {
    expect(vietnameseLines("const a = 1 // chú thích\n/* khối\n chú thích */ const b = 'x'\n{/* Ghi chú */}")).toEqual([])
    expect(vietnameseLines("const s = 'Lưu'")).toHaveLength(1)
    expect(vietnameseLines("const s = 'Lưu' // i18n-ignore: từ khoá giọng nói")).toEqual([])
    expect(vietnameseLines("const u = 'https://x.y/đ'")).toHaveLength(1)
  })

  it('user-facing text lives in src/shared/i18n/vi, agent-facing text is English', () => {
    const found: string[] = []
    for (const f of files(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).split(sep).join('/')
      if (rel.startsWith('src/shared/i18n/vi/')) continue
      for (const l of vietnameseLines(readFileSync(f, 'utf8'))) found.push(`${rel}:${l.line}  ${l.text.slice(0, 120)}`)
    }
    expect(found).toEqual([])
  })
})
