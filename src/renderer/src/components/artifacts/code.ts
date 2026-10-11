// Khung xem code của Artifacts: tô màu cú pháp nhẹ (từng dòng, không cần parser) và trích "cấu trúc" của file
// (hàm, class, tiêu đề…) để hiện ở cột bên phải. Thuần logic → test được trong Node.
import { extOf } from './stacks'

// ---------- tô màu ----------

type LangId = 'c' | 'py' | 'sh' | 'cfg' | 'sql' | 'css' | 'json'

interface Lang {
  /** Mở đầu chú thích tới hết dòng. */
  line: string | null
  /** Cặp mở / đóng chú thích nhiều dòng. */
  block: [string, string] | null
  /** Ký tự mở / đóng chuỗi. */
  quotes: string
  words: ReadonlySet<string>
  /** Từ khoá không phân biệt hoa thường (SQL). */
  ci: boolean
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean))

const LANGS: Record<LangId, Lang> = {
  c: {
    line: '//',
    block: ['/*', '*/'],
    quotes: '"\'`',
    ci: false,
    words: words(
      'abstract as async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null private protected public readonly return static super switch this throw true try type typeof undefined var void while with yield package namespace declare fn func impl mod pub struct trait use mut match loop self final override virtual using'
    )
  },
  py: {
    line: '#',
    block: null,
    quotes: '"\'',
    ci: false,
    words: words(
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self'
    )
  },
  sh: {
    line: '#',
    block: null,
    quotes: '"\'',
    ci: false,
    words: words('if then else elif fi for while do done case esac function in return exit export local set unset source echo true false')
  },
  cfg: { line: '#', block: null, quotes: '"\'', ci: false, words: words('true false null') },
  sql: {
    line: '--',
    block: ['/*', '*/'],
    quotes: '"\'',
    ci: true,
    words: words(
      'select insert update delete from where join left right inner outer on group by order having limit offset create alter drop table index unique primary key foreign references column add constraint default not null and or in as values into set begin commit rollback view if exists distinct union all case when then else end with returning cascade'
    )
  },
  css: { line: null, block: ['/*', '*/'], quotes: '"\'', ci: false, words: new Set() },
  json: { line: null, block: null, quotes: '"', ci: false, words: words('true false null') }
}

const LANG_BY_EXT: Record<string, LangId> = {}
for (const [lang, exts] of Object.entries({
  c: 'ts tsx js jsx mjs cjs mts cts java kt cs go rs c h cpp hpp cc swift php dart scala prisma',
  py: 'py pyw',
  sh: 'sh bash zsh',
  cfg: 'yml yaml toml ini conf env properties',
  sql: 'sql',
  css: 'css scss less',
  json: 'json jsonc json5'
} as Record<LangId, string>))
  for (const e of exts.split(' ')) LANG_BY_EXT[e] = lang as LangId

/** Màu theo bản thiết kế (design/v2/1-xuong.html: .kw .s .nu .cm). Chuỗi lớp nằm trong mã nguồn để Tailwind sinh. */
const CLS = {
  kw: 'text-[#c792ea]',
  str: 'text-[#c3e88d]',
  num: 'text-[#f78c6c]',
  cm: 'text-[#5c646e] italic'
}

const NUM = /(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/y
const IDENT_CHAR = /[\w$]/
const IDENT_START = /[A-Za-z_$]/
const DIGIT = /\d/

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Tô một dòng; `st.block` nhớ việc đang ở trong chú thích nhiều dòng giữa các dòng. Kết quả đã escape HTML. */
function scan(line: string, lang: Lang, st: { block: boolean }): string {
  let out = ''
  let plain = 0
  const n = line.length
  const span = (from: number, to: number, cls: string): void => {
    if (from > plain) out += escapeHtml(line.slice(plain, from))
    out += `<span class="${cls}">${escapeHtml(line.slice(from, to))}</span>`
    plain = to
  }
  let i = 0
  while (i < n) {
    if (lang.block && (st.block || line.startsWith(lang.block[0], i))) {
      const close = lang.block[1]
      const from = st.block ? i : i + lang.block[0].length
      const end = line.indexOf(close, from)
      if (end < 0) {
        st.block = true
        span(i, n, CLS.cm)
        i = n
      } else {
        st.block = false
        span(i, end + close.length, CLS.cm)
        i = end + close.length
      }
      continue
    }
    const c = line[i]
    if (lang.line && line.startsWith(lang.line, i)) {
      const prev = i > 0 ? line[i - 1] : ' '
      // `#` chỉ là chú thích khi đứng đầu dòng / sau khoảng trắng; `//` không tính trong URL (http://).
      const ok = lang.line === '#' ? /\s/.test(prev) : lang.line === '//' ? prev !== ':' : true
      if (ok) {
        span(i, n, CLS.cm)
        i = n
        continue
      }
    }
    if (lang.quotes.includes(c)) {
      let j = i + 1
      while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1
      if (j < n) {
        span(i, j + 1, CLS.str)
        i = j + 1
        continue
      }
      // Không đóng trong dòng này (chuỗi nhiều dòng / dấu nháy trong văn xuôi): để như chữ thường.
      i++
      continue
    }
    if (DIGIT.test(c)) {
      NUM.lastIndex = i
      const m = NUM.exec(line)
      if (m) {
        span(i, i + m[0].length, CLS.num)
        i += m[0].length
        continue
      }
    }
    if (IDENT_START.test(c)) {
      let j = i + 1
      while (j < n && IDENT_CHAR.test(line[j])) j++
      const w = line.slice(i, j)
      if (lang.words.has(lang.ci ? w.toLowerCase() : w)) span(i, j, CLS.kw)
      i = j
      continue
    }
    i++
  }
  if (plain < n) out += escapeHtml(line.slice(plain))
  return out
}

/** HTML (đã escape) của từng dòng; đuôi file lạ → chỉ escape. */
export function highlightLines(lines: readonly string[], rel: string): string[] {
  const id = LANG_BY_EXT[extOf(rel)]
  if (!id) return lines.map(escapeHtml)
  const lang = LANGS[id]
  const st = { block: false }
  return lines.map((l) => scan(l, lang, st))
}

// ---------- cấu trúc ----------

export interface CodeSymbol {
  /** Số dòng, từ 1. */
  line: number
  name: string
  /** Mức lồng (chỉ tiêu đề markdown): 0, 1, 2. */
  depth: number
}

const SYM_TS = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|type|interface|class|enum|namespace|struct)\s+([A-Za-z_$][\w$]*)/
const SYM_PY = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/
const SYM_GO = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^type\s+([A-Za-z_]\w*)/
const SYM_RS = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl|mod|type)\s+([A-Za-z_]\w*)/
const SYM_SQL = /^(?:ALTER|CREATE)\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|FUNCTION)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([\w.]+)/i
const SYM_PRISMA = /^(?:model|enum|type|datasource|generator)\s+(\w+)/
const SYM_MD = /^(#{1,3})\s+(.+?)\s*#*\s*$/

const MAX_SYMBOLS = 500

/** Hàm / class / bảng / tiêu đề ở cột đầu của file (chỉ mức trên cùng). Rỗng = không có hoặc không nhận ra loại file. */
export function symbolsOf(lines: readonly string[], rel: string): CodeSymbol[] {
  const ext = extOf(rel)
  const out: CodeSymbol[] = []
  const push = (line: number, name: string | undefined, depth = 0): void => {
    if (name && out.length < MAX_SYMBOLS) out.push({ line, name, depth })
  }
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') {
    let fence = false
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence
      if (fence) return
      const m = SYM_MD.exec(l)
      if (m) push(i + 1, m[2], m[1].length - 1)
    })
    return out
  }
  let re: RegExp | null = null
  if (ext === 'py') re = SYM_PY
  else if (ext === 'go') re = SYM_GO
  else if (ext === 'rs') re = SYM_RS
  else if (ext === 'sql') re = SYM_SQL
  else if (ext === 'prisma') re = SYM_PRISMA
  else if (LANG_BY_EXT[ext] === 'c') re = SYM_TS
  if (!re) return out
  lines.forEach((l, i) => {
    const m = re.exec(l)
    if (m) push(i + 1, m[1] ?? m[2])
  })
  return out
}

/** Tách văn bản thành dòng (chịu CRLF), bỏ dòng rỗng cuối do dấu xuống dòng kết thúc file. */
export function splitLines(text: string): string[] {
  const ls = text.split(/\r?\n/)
  if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop()
  return ls
}
