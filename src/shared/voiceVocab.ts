// Gõ bằng giọng nói (V2): từ vựng của workspace → gợi ý cho máy nhận dạng, và sửa chữ sau khi nhận dạng
// (ghép tên hàm bị tách, sửa hoa thường, luật thay từ của người dùng, lệnh "xuống dòng"). Thuần, dùng cho cả main và renderer.
import type { VoiceReplacement } from './types'

// ---------- nhận dạng "từ code" ----------

/** Đuôi file đáng gợi ý (tên file người dùng hay đọc ra). */
export const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|cs|cpp|cc|c|h|hpp|rb|php|swift|dart|lua|sh|ps1|sql|json|ya?ml|toml|md|css|scss|html)$/i

/** Từ trông như code: camelCase / PascalCase nhiều khúc / snake_case / VIẾT_HOA / tên file. Từ tiếng Anh thường thì máy tự nhận được. */
export function isCodeTerm(t: string): boolean {
  if (t.length < 3 || t.length > 60 || /\s/.test(t)) return false
  if (CODE_EXT.test(t) && /^[\w.-]+$/.test(t)) return true
  if (!/^[A-Za-z_$][\w$]*$/.test(t)) return false
  if (/^[A-Z][A-Z0-9]{2,}$/.test(t)) return true
  return /[a-z0-9][A-Z]|[A-Z]{2}[a-z]/.test(t) || /[A-Za-z]_[A-Za-z]/.test(t)
}

/** Các chữ của một từ code, viết thường: `normalizeOrigin` → normalize origin, `XMLParser` → xml parser, `App.tsx` → app tsx. */
export function termWords(t: string): string[] {
  return t
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/** Mã băm / uuid / số dài: không phải thứ người ta đọc ra. */
const NOISE = /\d{3,}|^[0-9a-f]{7,}$/i

/**
 * Từ code trong một đoạn chữ (vd. những gì đang hiện trong ô agent), từ cuối lên đầu (mới nhất trước), không trùng.
 * Đường dẫn chỉ lấy tên file.
 */
export function contextTerms(text: string, max = 30): string[] {
  const found = text.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z0-9]+)?/g) ?? []
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = found.length - 1; i >= 0 && out.length < max; i--) {
    const t = found[i]
    const k = t.toLowerCase()
    if (seen.has(k) || NOISE.test(t) || !isCodeTerm(t)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/**
 * Từ hay nói khi làm việc với agent viết code mà máy nhận dạng tiếng Việt hay nghe sai (viết đúng chính tả muốn ra).
 * Danh sách chung, không theo dự án nào.
 */
export const GENERAL_TERMS: readonly string[] = [
  'commit', 'push', 'pull request', 'merge', 'branch', 'rebase', 'git status', 'diff', 'GitHub',
  'npm', 'npm install', 'pnpm', 'test', 'unit test', 'build', 'deploy', 'debug', 'log', 'bug', 'fix', 'refactor', 'review',
  'file', 'folder', 'README', 'component', 'function', 'API', 'endpoint', 'token', 'localhost', 'terminal', 'server', 'database',
  'TypeScript', 'JavaScript', 'React', 'Python', 'Node', 'JSON', 'config', 'env', 'error', 'fail', 'timeout', 'cache', 'UI', 'CSS'
]

// ---------- chọn danh sách gợi ý ----------

export interface HotwordSources {
  /** Người dùng tự thêm (Cài đặt → Giọng nói). */
  manual: readonly string[]
  /** Tên agent của workspace. */
  agents: readonly string[]
  /** Từ code đang hiện trong ô agent (mới nhất trước). */
  context: readonly string[]
  /** Từ vựng của workspace, quan trọng nhất trước (main quét: tên file, hàm, class, thư viện). */
  workspace: readonly string[]
  general: readonly string[]
}

/**
 * Qwen3 chỉ chứa ~512 token cho cả gợi ý + âm thanh + chữ ra, và danh sách dài dễ bị chép vào câu (V0: 60 mục ≈ 89 token).
 * Chọn theo thứ tự: người dùng thêm → tên agent → từ đang hiện trong ô (mới nhất trước) → từ chung → từ workspace.
 */
export const HOTWORD_MAX = 60
const CONTEXT_MAX = 20
const GENERAL_MAX = 25

export function pickHotwords(src: HotwordSources, max = HOTWORD_MAX): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (list: readonly string[], limit = Infinity): void => {
    let n = 0
    for (const raw of list) {
      if (out.length >= max || n >= limit) return
      const t = raw.replace(/[,\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
      const k = t.toLowerCase()
      if (!t || t.length > 60 || seen.has(k)) continue
      seen.add(k)
      out.push(t)
      n++
    }
  }
  add(src.manual)
  add(src.agents)
  add(src.context, CONTEXT_MAX)
  add(src.general, GENERAL_MAX)
  add(src.workspace)
  add(src.general)
  return out
}

// ---------- sửa chữ sau nhận dạng ----------

/** Ranh giới từ theo Unicode (\b của JS chỉ hiểu chữ ASCII, không hiểu "dòng", "sửa"). */
// Không khớp một phần của tên file / đường dẫn: "json" trong `package.json`, "app" trong `app.tsx`.
const L = '(?<![\\p{L}\\p{N}_$]|[\\p{L}\\p{N}][./\\\\-])'
const R = '(?![\\p{L}\\p{N}_$]|[./\\\\-][\\p{L}\\p{N}])'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Đưa từ code về đúng dạng: máy nhận dạng hay tách `normalizeOrigin` thành "normalize origin", viết `handleclick`,
 * `readme`, "git hub"… Chỉ sửa khi khớp trọn các chữ của một từ code trong danh sách (không đoán).
 */
export function fixTerms(text: string, terms: readonly string[]): string {
  const byKey = new Map<string, string>()
  const pats: Array<{ p: string; len: number }> = []
  for (const t of terms) {
    if (!isCodeTerm(t)) continue
    const words = termWords(t)
    const key = words.join('')
    if (key.length < 4 && !/^[A-Z]{3}$/.test(t)) continue
    if (byKey.has(key)) continue
    byKey.set(key, t)
    pats.push({ p: words.map(esc).join('[ \\t._-]*'), len: key.length })
  }
  if (!pats.length) return text
  pats.sort((a, b) => b.len - a.len)
  const re = new RegExp(`${L}(?:${pats.map((x) => x.p).join('|')})${R}`, 'giu')
  return text.replace(re, (m) => byKey.get(m.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? m)
}

/** Luật thay từ của người dùng ("hen đồ click" → `handleClick`): khớp trọn cụm, không phân biệt hoa thường; cụm dài trước. */
export function applyReplacements(text: string, rules: readonly VoiceReplacement[]): string {
  const list = rules
    .map((r) => ({ from: r.from.normalize('NFC').trim(), to: r.to.normalize('NFC') }))
    .filter((r) => r.from)
    .sort((a, b) => b.from.length - a.from.length)
  if (!list.length) return text
  const map = new Map(list.map((r) => [r.from.toLowerCase().replace(/\s+/g, ' '), r.to]))
  const re = new RegExp(`${L}(?:${list.map((r) => r.from.split(/\s+/).map(esc).join('\\s+')).join('|')})${R}`, 'giu')
  return text.normalize('NFC').replace(re, (m) => map.get(m.toLowerCase().replace(/\s+/g, ' ')) ?? m)
}

/**
 * Lệnh nói: "xuống dòng" → xuống dòng thật (bỏ dấu câu máy chèn quanh nó). Giữ nguyên khi đang nói về ký tự xuống dòng
 * ("thêm ký tự xuống dòng", "dấu xuống dòng"). Xuống dòng ở đầu / cuối được giữ để lần nói sau nối đúng dòng (chèn thì bỏ).
 */
export function spokenCommands(text: string): string {
  return text
    .replace(new RegExp(`[ \\t,.;:]*${L}(?<!(?:ký tự|kí tự|dấu)\\s*)xuống dòng${R}[ \\t,.;:]*`, 'giu'), '\n')
    .replace(/\n(\p{Ll})/gu, (_m, c: string) => `\n${c.toUpperCase()}`)
}

export interface PostOptions {
  /** Từ code để sửa dạng (gợi ý đã gửi + từ vựng workspace). */
  terms: readonly string[]
  rules: readonly VoiceReplacement[]
  /** Bật lệnh nói ("xuống dòng"). */
  commands: boolean
}

/** Sửa chữ sau nhận dạng: luật của người dùng trước (thắng), rồi dạng từ code, rồi lệnh nói. */
export function postProcess(text: string, o: PostOptions): string {
  let t = applyReplacements(text.normalize('NFC'), o.rules)
  t = fixTerms(t, o.terms)
  if (o.commands) t = spokenCommands(t)
  return t
}

// ---------- luật thay từ dạng chữ (Cài đặt) ----------

/** "sai → đúng" mỗi dòng (cũng nhận "->", "=>"). Dòng không có mũi tên bị bỏ. */
export function parseReplacements(text: string): VoiceReplacement[] {
  const out: VoiceReplacement[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+?)\s*(?:→|->|=>)\s*(.+)$/.exec(line.trim())
    if (m && m[1].trim() && m[2].trim()) out.push({ from: m[1].trim(), to: m[2].trim() })
  }
  return out
}

export function formatReplacements(rules: readonly VoiceReplacement[]): string {
  return rules.map((r) => `${r.from} → ${r.to}`).join('\n')
}
