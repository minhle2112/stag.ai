// stag.ai — chế độ Soi: gắn data-stag-src="file:dòng:cột" vào thẻ HTML thật (thẻ chữ thường) trong mã nguồn,
// để khi rê chuột trên trang trong stag.ai biết phần tử đến từ đâu. Chỉ dùng khi chạy dev server; không phụ thuộc gì.
// Dùng bởi stag-inspect-vite.mjs (Vite) và stag-inspect-next-loader.cjs (Next.js / webpack / Turbopack).

export const ATTR = 'data-stag-src'

/** Bảng đầu dòng để đổi vị trí ký tự → dòng:cột (đếm từ 1). */
function lineIndex(code) {
  const starts = [0]
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1)
  return (off) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return `${lo + 1}:${off - starts[lo] + 1}`
  }
}

function apply(code, ins) {
  if (!ins.length) return null
  let out = ''
  let last = 0
  for (const [at, text] of ins) {
    out += code.slice(last, at) + text
    last = at
  }
  return out + code.slice(last)
}

const ident = (c) => /[A-Za-z0-9_$]/.test(c || '')
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r'

/**
 * JSX / TSX: thêm thuộc tính vào thẻ HTML viết trực tiếp (div, button…), bỏ qua component (chữ hoa, a.b), fragment,
 * thẻ đã có thuộc tính. Trả về mã mới, hoặc null nếu không đổi gì. Một bộ phân tích JSX nhỏ: biết chuỗi, chú thích,
 * template literal, biểu thức {…}, chữ trong JSX (dấu ' trong chữ không làm hỏng việc dò).
 */
export function tagJsx(code, file) {
  const n = code.length
  const pos = lineIndex(code)
  const ins = []
  let i = 0

  const skipLineComment = () => {
    while (i < n && code[i] !== '\n') i++
  }
  const skipBlockComment = () => {
    const end = code.indexOf('*/', i + 2)
    i = end < 0 ? n : end + 2
  }
  const skipString = (q) => {
    i++
    while (i < n && code[i] !== q) {
      if (code[i] === '\\') i++
      else if (code[i] === '\n') return
      i++
    }
    i++
  }
  const skipTemplate = () => {
    i++
    while (i < n && code[i] !== '`') {
      if (code[i] === '\\') i += 2
      else if (code[i] === '$' && code[i + 1] === '{') {
        i += 2
        codeMode(true)
      } else i++
    }
    i++
  }

  /** Có thể bắt đầu JSX ở `<` này không: ký tự / từ đứng trước cho biết đang ở chỗ một biểu thức. */
  const jsxAllowed = () => {
    let j = i - 1
    while (j >= 0 && isSpace(code[j])) j--
    if (j < 0) return true
    const c = code[j]
    if ('(,=:?&|{[}>;!'.includes(c)) return true
    if (ident(c)) {
      let k = j
      while (k >= 0 && ident(code[k])) k--
      const word = code.slice(k + 1, j + 1)
      return word === 'return' || word === 'yield' || word === 'default' || word === 'case' || word === 'await'
    }
    return false
  }

  const codeMode = (untilBrace) => {
    let depth = 0
    while (i < n) {
      const c = code[i]
      if (c === '/' && code[i + 1] === '/') skipLineComment()
      else if (c === '/' && code[i + 1] === '*') skipBlockComment()
      else if (c === '"' || c === "'") skipString(c)
      else if (c === '`') skipTemplate()
      else if (c === '{') {
        depth++
        i++
      } else if (c === '}') {
        i++
        if (untilBrace && depth === 0) return
        depth--
      } else if (c === '<' && jsxAllowed() && element()) {
        // đã đọc xong cả phần tử
      } else i++
    }
  }

  /** Đọc một phần tử JSX bắt đầu ở `<`. false = không phải JSX (vd. generic `<T,>`), vị trí giữ nguyên. */
  const element = () => {
    const start = i
    let j = i + 1
    if (code[j] === '>') {
      // fragment <>…</>
      i = j + 1
      children()
      return true
    }
    if (!/[A-Za-z]/.test(code[j] || '')) return false
    while (j < n && /[\w.:-]/.test(code[j])) j++
    const name = code.slice(i + 1, j)
    if (!(isSpace(code[j]) || code[j] === '>' || code[j] === '/' || code[j] === '{')) return false
    const intrinsic = /^[a-z][a-z0-9-]*$/.test(name)
    i = j
    let has = false
    // thuộc tính
    while (i < n) {
      const c = code[i]
      if (c === '"' || c === "'") {
        i++
        while (i < n && code[i] !== c) i++
        i++
      } else if (c === '{') {
        i++
        codeMode(true)
      } else if (c === '/' && code[i + 1] === '>') {
        if (intrinsic && !has) ins.push([j, ` ${ATTR}="${file}:${pos(start)}"`])
        i += 2
        return true
      } else if (c === '>') {
        if (intrinsic && !has) ins.push([j, ` ${ATTR}="${file}:${pos(start)}"`])
        i++
        children()
        return true
      } else {
        if (code.startsWith(ATTR, i) && isSpace(code[i - 1])) has = true
        i++
      }
    }
    return true
  }

  const children = () => {
    while (i < n) {
      const c = code[i]
      if (c === '<' && code[i + 1] === '/') {
        const end = code.indexOf('>', i)
        i = end < 0 ? n : end + 1
        return
      }
      if (c === '<') {
        if (!element()) i++
      } else if (c === '{') {
        i++
        codeMode(true)
      } else i++
    }
  }

  codeMode(false)
  ins.sort((a, b) => a[0] - b[0])
  return apply(code, ins)
}

/** Thẻ không gắn (không phải phần tử hiển thị, hoặc không nên đụng). */
const SKIP = new Set(['html', 'head', 'meta', 'link', 'title', 'script', 'style', 'template', 'slot', 'base', 'noscript', 'svelte'])

/**
 * Markup (HTML, phần <template> của Vue, phần giao diện của Svelte): thêm thuộc tính vào thẻ mở chữ thường.
 * `from` / `to` = chỉ xét đoạn này. Bỏ qua chú thích, <script>, <style>, giá trị thuộc tính có dấu nháy hoặc {…}.
 * Trả về mã mới hoặc null.
 */
export function tagMarkup(code, file, from = 0, to = code.length) {
  const pos = lineIndex(code)
  const ins = []
  let i = from
  while (i < to) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4)
      i = end < 0 ? to : end + 3
      continue
    }
    if (code[i] !== '<' || !/[a-z]/.test(code[i + 1] || '')) {
      i++
      continue
    }
    const start = i
    let j = i + 1
    while (j < to && /[a-z0-9-]/.test(code[j])) j++
    const name = code.slice(i + 1, j)
    if (!(isSpace(code[j]) || code[j] === '>' || code[j] === '/')) {
      i = j
      continue
    }
    i = j
    let has = false
    let depth = 0
    while (i < to) {
      const c = code[i]
      if (depth === 0 && (c === '"' || c === "'")) {
        const end = code.indexOf(c, i + 1)
        i = end < 0 ? to : end + 1
      } else if (c === '{') {
        depth++
        i++
      } else if (c === '}') {
        depth = Math.max(0, depth - 1)
        i++
      } else if (depth === 0 && c === '>') break
      else {
        if (code.startsWith(ATTR, i) && isSpace(code[i - 1])) has = true
        i++
      }
    }
    if (!SKIP.has(name) && !has) ins.push([j, ` ${ATTR}="${file}:${pos(start)}"`])
    i++
    if (name === 'script' || name === 'style') {
      const end = code.indexOf(`</${name}`, i)
      i = end < 0 ? to : end
    }
  }
  return apply(code, ins)
}

/** File .vue: chỉ phần <template> ngoài cùng. */
export function tagVue(code, file) {
  const open = /<template(\s[^>]*)?>/.exec(code)
  if (!open) return null
  const from = open.index + open[0].length
  const to = code.lastIndexOf('</template>')
  if (to < from) return null
  return tagMarkup(code, file, from, to)
}

/** File .svelte: phần giao diện (mọi thứ ngoài <script> / <style>). */
export function tagSvelte(code, file) {
  return tagMarkup(code, file)
}

/** Chọn cách gắn theo đuôi file. `rel` = đường dẫn tương đối dự án (dấu /). */
export function tagSource(code, rel) {
  const clean = rel.split('?')[0]
  if (/\.(jsx|tsx)$/.test(clean)) return tagJsx(code, clean)
  // .js có JSX (Create React App, Next.js): chỉ khi thấy dấu hiệu JSX.
  if (/\.js$/.test(clean) && /<[a-z][\w-]*[\s>]/.test(code) && /return\s*\(?\s*</.test(code)) return tagJsx(code, clean)
  if (/\.vue$/.test(clean)) return tagVue(code, clean)
  if (/\.svelte$/.test(clean)) return tagSvelte(code, clean)
  if (/\.html?$/.test(clean)) {
    const body = /<body[\s>]/i.exec(code)
    return tagMarkup(code, clean, body ? body.index : 0)
  }
  return null
}
