import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { CODE_EXT, isCodeTerm } from '@shared/voiceVocab'

/**
 * Gõ bằng giọng nói (V2): từ vựng của workspace để gợi ý cho máy nhận dạng — tên file, tên hàm / class / kiểu khai báo
 * trong mã nguồn, thư viện trong package.json. Quét lúc người dùng bắt đầu nói (chạy nền, có giới hạn), giữ trong RAM vài
 * phút. Chỉ đọc, không ghi gì vào dự án.
 */

/** Tối đa số file mã nguồn đọc nội dung, kích thước mỗi file, tổng số từ trả về. */
const MAX_READ = 1500
const MAX_FILE = 256 * 1024
/** Tổng dung lượng đọc mỗi lần quét (repo lớn: chỉ đọc phần sửa gần đây nhất). */
const MAX_TOTAL = 24 * 1024 * 1024
const MAX_LIST = 20000
const MAX_TERMS = 400
/** Sửa trong 7 ngày gần đây: đang làm, hay được nhắc tới. */
const RECENT_MS = 7 * 24 * 3600_000
const TTL_MS = 3 * 60_000

const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|cs|swift|dart|rb|php)$/i
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'coverage', '.cache', '.turbo'])

/**
 * Tên khai báo ở cấp cao nhất của file (đầu dòng, không thụt lề): hàm, class, kiểu, hằng / biến (JS/TS), def/class (Python,
 * cả method thụt 4 dấu cách), func/type (Go), fn/struct/trait (Rust). Biến cục bộ trong hàm thì bỏ: ít khi được nhắc tên.
 */
const DECL =
  /^(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:function\*?|class|interface|type|enum|const|let|var|def|func|fn|struct|trait)\s+(?:\([^)]*\)\s*)?([A-Za-z_$][\w$]*)|^ {4}(?:async\s+)?def\s+([A-Za-z_]\w*)/gm
const WORD = /[A-Za-z_$][\w$]{3,}/g

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, windowsHide: true, maxBuffer: 64 << 20, timeout: 15_000 }, (err, out) => (err ? reject(err) : resolve(out)))
  )
}

/** File của dự án (tương đối, '/'): `git ls-files` (bỏ file bị .gitignore), không phải repo git thì tự duyệt thư mục. */
async function listFiles(root: string): Promise<string[]> {
  try {
    const out = await run('git', ['ls-files', '-co', '--exclude-standard', '-z'], root)
    return out.split('\0').filter(Boolean).slice(0, MAX_LIST)
  } catch {
    const out: string[] = []
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > 8 || out.length >= MAX_LIST) return
      let items: import('node:fs').Dirent[]
      try {
        items = await fs.readdir(join(root, rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const it of items) {
        if (out.length >= MAX_LIST) return
        const r = rel ? `${rel}/${it.name}` : it.name
        if (it.isDirectory()) {
          if (!SKIP_DIR.has(it.name) && !it.name.startsWith('.')) await walk(r, depth + 1)
        } else if (it.isFile()) out.push(r)
      }
    }
    await walk('', 0)
    return out
  }
}

/** Thư viện trong package.json gốc (`@xterm/xterm` → xterm). */
async function packageDeps(root: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    const names = ['dependencies', 'devDependencies'].flatMap((k) => Object.keys((pkg[k] as Record<string, string>) ?? {}))
    const libs = names.filter((n) => !n.startsWith('@types/')).map((n) => n.split('/').pop()!)
    return [...new Set(libs.filter((n) => /^[a-z][\w.-]{2,30}$/i.test(n)))]
  } catch {
    return []
  }
}

/** Quét một thư mục dự án → từ vựng, quan trọng nhất trước. */
export async function scanVocab(root: string, now = Date.now()): Promise<string[]> {
  const files = await listFiles(root)
  const score = new Map<string, { term: string; s: number }>()
  const bump = (term: string, s: number): void => {
    const k = term.toLowerCase()
    const cur = score.get(k)
    if (cur) cur.s += s
    else score.set(k, { term, s })
  }

  // Tên file: chỉ file mã / tài liệu (đọc ra được), không tính file sinh tự động.
  const names = new Map<string, string>()
  for (const f of files) {
    const b = basename(f)
    if (CODE_EXT.test(b) && !/\.(d\.ts|min\.js|lock|map)$/i.test(b) && b.length <= 40) names.set(b.toLowerCase(), b)
  }
  for (const b of names.values()) bump(b, 1)

  // Mã nguồn: file sửa gần đây đọc trước.
  const sources = files.filter((f) => SOURCE_EXT.test(f) && !/\.d\.ts$|\.min\.js$|(^|\/)(dist|out|build|vendor)\//i.test(f))
  const stats = await Promise.all(
    sources.slice(0, MAX_LIST).map(async (f) => {
      try {
        const st = await fs.stat(join(root, f))
        return { f, size: st.size, mtime: st.mtimeMs }
      } catch {
        return null
      }
    })
  )
  const pick = stats
    .filter((x): x is { f: string; size: number; mtime: number } => !!x && x.size <= MAX_FILE)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_READ)

  const declared = new Map<string, { term: string; recent: boolean }>()
  const refs = new Map<string, number>()
  let total = 0
  for (const { f, mtime, size } of pick) {
    total += size
    if (total > MAX_TOTAL) break
    let text: string
    try {
      text = await fs.readFile(join(root, f), 'utf8')
    } catch {
      continue
    }
    const recent = now - mtime < RECENT_MS
    if (recent) bump(basename(f), 2)
    for (const m of text.matchAll(DECL)) {
      const t = m[1] ?? m[2]
      // Tên code (camelCase…) hoặc tên component / class một khúc đủ dài (Sidebar, Kanban). Hằng VIẾT_HOA thì ít khi đọc ra.
      if (/^[A-Z0-9_$]+$/.test(t) || (!isCodeTerm(t) && !/^[A-Z][a-z]{4,}$/.test(t))) continue
      const prev = declared.get(t)
      declared.set(t, { term: t, recent: recent || !!prev?.recent })
    }
    for (const m of text.matchAll(WORD)) refs.set(m[0], (refs.get(m[0]) ?? 0) + 1)
  }
  for (const [t, d] of declared) {
    const n = refs.get(t) ?? 1
    bump(t, 1 + Math.log2(1 + n) + (d.recent ? 2 : 0) + (isCodeTerm(t) ? 0.5 : 0))
  }
  for (const dep of await packageDeps(root)) bump(dep, 3)

  return [...score.values()]
    .sort((a, b) => b.s - a.s || a.term.localeCompare(b.term))
    .slice(0, MAX_TERMS)
    .map((x) => x.term)
}

/** Bộ nhớ đệm theo thư mục dự án: trả bản cũ ngay rồi quét lại nền nếu đã quá TTL. */
export class VocabCache {
  private items = new Map<string, { at: number; terms: string[]; job: Promise<string[]> | null }>()

  constructor(private scan: (root: string) => Promise<string[]> = scanVocab) {}

  get(root: string): Promise<string[]> {
    const it = this.items.get(root)
    if (it && Date.now() - it.at < TTL_MS) return Promise.resolve(it.terms)
    if (it?.job) return it.terms.length ? Promise.resolve(it.terms) : it.job
    const job = this.scan(root)
      .catch(() => [] as string[])
      .then((terms) => {
        this.items.set(root, { at: Date.now(), terms, job: null })
        return terms
      })
    this.items.set(root, { at: it?.at ?? 0, terms: it?.terms ?? [], job })
    return it?.terms.length ? Promise.resolve(it.terms) : job
  }
}
