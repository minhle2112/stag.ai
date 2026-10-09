// Khoá phạm vi (M7): mỗi việc đang mở của một agent giữ một vùng code (phạm vi khai lúc task_start /
// task_update + các file agent đó đã sửa). Agent khác sắp sửa file trong vùng đó → app hỏi người dùng.
// Dùng chung main (quyết định ở hook) và renderer (dấu ⚠ trên kanban).

import type { Task } from './types'

/** Một mục phạm vi: thư mục/file (so theo ranh giới thư mục) hoặc mẫu glob. */
export interface ScopeEntry {
  /** Đường dẫn tương đối so với thư mục dự án, '/' và chữ thường; '' = cả dự án. Glob: phần trước ký tự đại diện đầu tiên. */
  key: string
  /** Chữ gốc để hiện cho người dùng / agent. */
  label: string
  glob?: RegExp
}

const WILDCARD = /[*?[{]/

/** Thư mục chung không bao giờ khoá: dữ liệu của app và git. Vault được thêm riêng (xem `unlocked`). */
export const ALWAYS_SHARED: readonly string[] = ['.sessions', '.stag', '.git']

const norm = (p: string): string => p.replace(/\\/g, '/')
const isAbs = (p: string): boolean => /^[a-z]:\//i.test(p) || p.startsWith('/')

/**
 * Đường dẫn (tuyệt đối hoặc tương đối với `base`, mặc định thư mục dự án) → đường dẫn tương đối so với
 * thư mục dự án, '/' và chữ thường (Windows không phân biệt hoa thường). null = nằm ngoài dự án.
 */
export function projectRel(path: string, root: string, base = root): string | null {
  let p = norm(path.trim())
  if (!p) return null
  const r = norm(root).replace(/\/+$/, '').toLowerCase()
  if (!isAbs(p)) p = `${norm(base).replace(/\/+$/, '')}/${p}`
  // Gộp `.` và `..` (không đụng ổ đĩa).
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '.' || (seg === '' && out.length > 0)) continue
    if (seg === '..') {
      if (out.length <= 1) return null
      out.pop()
    } else out.push(seg)
  }
  const abs = out.join('/').toLowerCase()
  if (abs === r) return ''
  return abs.startsWith(`${r}/`) ? abs.slice(r.length + 1) : null
}

/** `a` chứa `b` (cùng là đường dẫn tương đối đã chuẩn hoá, '' = cả dự án). */
export function contains(a: string, b: string): boolean {
  return a === '' || a === b || b.startsWith(`${a}/`)
}

function globRegex(rel: string): RegExp {
  let re = ''
  for (let i = 0; i < rel.length; i++) {
    const c = rel[i]
    if (c === '*') {
      if (rel[i + 1] === '*') {
        i++
        if (rel[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = rel.indexOf('}', i)
      if (end < 0) re += '\\{'
      else {
        re += `(?:${rel
          .slice(i + 1, end)
          .split(',')
          .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&'))
          .join('|')})`
        i = end
      }
    } else re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&')
  }
  // Mẫu khớp một thư mục thì mọi thứ bên trong cũng thuộc phạm vi.
  return new RegExp(`^${re}(?:/.*)?$`)
}

/** Tách theo dấu phẩy, chấm phẩy, xuống dòng; dấu phẩy trong `{a,b}` của glob thì giữ. */
function splitList(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '{') depth++
    else if (c === '}') depth = Math.max(0, depth - 1)
    if ((c === ',' && depth === 0) || c === ';' || c === '\n') {
      out.push(cur)
      cur = ''
      depth = 0
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Chữ nhìn giống đường dẫn (khi phạm vi viết lẫn với chữ thường, vd. "sửa src/auth/ và tests"). */
const pathLike = (t: string): boolean => /[/\\*]/.test(t) || /\.[a-z0-9]{1,8}$/i.test(t)

/**
 * Tách phạm vi agent khai (chữ tự do, vd. "src/auth/, tests/auth/*.test.ts (đăng nhập)") thành các mục.
 * Phân cách bằng dấu phẩy, chấm phẩy, xuống dòng; ghi chú trong ngoặc tròn bị bỏ; `…` (backtick) giữ nguyên
 * cả khoảng trắng. Một cụm có khoảng trắng chỉ giữ các chữ trông như đường dẫn. "." / "*" = cả dự án.
 */
export function parseScope(scope: string, root: string): ScopeEntry[] {
  const tokens: string[] = []
  const rest = scope.replace(/`([^`]+)`/g, (_m, inner: string) => {
    tokens.push(inner.trim())
    return ','
  })
  for (const piece of splitList(rest.replace(/\([^)]*\)/g, ' '))) {
    const t = piece.trim().replace(/^["']|["']$/g, '').trim()
    if (!t) continue
    if (/\s/.test(t)) tokens.push(...t.split(/\s+/).filter(pathLike))
    else tokens.push(t)
  }
  const entries: ScopeEntry[] = []
  for (const label of tokens) {
    const t = norm(label).replace(/^["']|["']$/g, '')
    if (/^(\.|\.\/|\*|\*\*|\*\*\/\*|\/)$/.test(t)) {
      entries.push({ key: '', label })
      continue
    }
    const wild = t.search(WILDCARD)
    if (wild < 0) {
      const key = projectRel(t.replace(/\/+$/, ''), root)
      if (key !== null) entries.push({ key, label })
      continue
    }
    const full = projectRel(t, root)
    if (full === null) continue
    const head = norm(t).slice(0, wild)
    const prefix = head.includes('/') ? head.slice(0, head.lastIndexOf('/')) : ''
    const key = prefix ? projectRel(prefix, root) : projectRel('.', root)
    if (key === null) continue
    entries.push({ key, label, glob: globRegex(full) })
  }
  return entries
}

export function entryHas(e: ScopeEntry, rel: string): boolean {
  return e.glob ? e.glob.test(rel) : contains(e.key, rel)
}

/** Hai mục có thể đè nhau (glob so theo phần đầu cố định: thà báo thừa còn hơn bỏ sót). */
export function entriesOverlap(a: ScopeEntry, b: ScopeEntry): boolean {
  if (a.glob && !b.glob) return entriesOverlap(b, a)
  if (!contains(a.key, b.key) && !contains(b.key, a.key)) return false
  // Một file cụ thể đối với một glob: thử thẳng mẫu.
  if (!a.glob && b.glob && contains(b.key, a.key) && looksLikeFile(a.key)) return b.glob.test(a.key)
  return true
}

const looksLikeFile = (rel: string): boolean => /\.[a-z0-9]{1,8}$/i.test(rel.slice(rel.lastIndexOf('/') + 1))

/** Vùng khoá của một việc đang mở. */
export interface ScopeLock {
  task: Task
  entries: ScopeEntry[]
}

/** Khoá của mọi việc đang mở: phạm vi đã khai + file đã sửa. */
export function scopeLocks(tasks: Task[], root: string): ScopeLock[] {
  return tasks
    .filter((t) => t.status === 'open')
    .map((task) => ({
      task,
      entries: [
        ...parseScope(task.scope, root),
        ...(task.files ?? []).flatMap((f) => {
          const key = projectRel(f, root)
          return key === null ? [] : [{ key, label: f }]
        })
      ]
    }))
}

/**
 * Chỗ không bao giờ khoá trong dự án: dữ liệu app, git, vault nếu vault nằm trong dự án, cộng các mẫu miễn khoá
 * trong Cài đặt → Khoá phạm vi (`exempt`, cú pháp như phạm vi việc). Mẫu "cả dự án" bị bỏ (muốn vậy thì tắt khoá).
 */
export function unlocked(root: string, vaultPath?: string, exempt: readonly string[] = []): ScopeEntry[] {
  const vault = vaultPath ? projectRel(vaultPath, root) : null
  const fixed = vault ? [...ALWAYS_SHARED, vault] : ALWAYS_SHARED
  return [
    ...fixed.map((key) => ({ key, label: key })),
    ...exempt.flatMap((p) => parseScope(p, root)).filter((e) => e.key !== '' || e.glob)
  ]
}

/** Tên ảo để thử một mẫu glob có phủ mọi thứ bên trong một thư mục không (không file thật nào có tên này). */
const ANY_INSIDE = '\0/\0'

/** Mục không khoá `s` phủ hết mục phạm vi `e` (phạm vi đó coi như không khoá gì). */
export function covers(s: ScopeEntry, e: ScopeEntry): boolean {
  if (!s.glob) return contains(s.key, e.key)
  if (e.glob && s.glob.source === e.glob.source) return true
  return (!e.glob && s.glob.test(e.key)) || s.glob.test(e.key ? `${e.key}/${ANY_INSIDE}` : ANY_INSIDE)
}

/** File `rel` nằm trong chỗ không khoá. */
export const isUnlocked = (rel: string, free: ScopeEntry[]): boolean => free.some((s) => entryHas(s, rel))

/** Việc của agent khác đang giữ file `rel`, hoặc undefined. Chỗ không khoá (`free`, xem `unlocked`) thì không bao giờ. */
export function lockHolder(locks: ScopeLock[], agentId: string, rel: string, free: ScopeEntry[]): { lock: ScopeLock; entry: ScopeEntry } | undefined {
  if (rel === '' || isUnlocked(rel, free)) return undefined
  for (const lock of locks) {
    if (lock.task.agentId === agentId) continue
    const entry = lock.entries.find((e) => entryHas(e, rel))
    if (entry) return { lock, entry }
  }
  return undefined
}

export interface ScopeOverlap {
  /** Việc của agent khác. */
  other: Task
  /** Chữ gốc của các mục đè nhau (của việc này). */
  labels: string[]
}

/** Việc `task` đè phạm vi với các việc đang mở nào của agent khác. Phạm vi nằm hẳn trong chỗ không khoá (vault, thư mục chung, mẫu miễn khoá) thì bỏ qua. */
export function overlapsOf(task: Task, locks: ScopeLock[], root: string, free: ScopeEntry[]): ScopeOverlap[] {
  const mine = locks.find((l) => l.task.id === task.id)?.entries ?? scopeLocks([{ ...task, status: 'open' }], root)[0].entries
  const own = mine.filter((e) => !free.some((s) => covers(s, e)))
  const out: ScopeOverlap[] = []
  for (const lock of locks) {
    if (lock.task.agentId === task.agentId) continue
    const labels = own.filter((e) => lock.entries.some((o) => !free.some((s) => covers(s, o)) && entriesOverlap(e, o))).map((e) => e.label)
    if (labels.length) out.push({ other: lock.task, labels: [...new Set(labels)] })
  }
  return out
}
