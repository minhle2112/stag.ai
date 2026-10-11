import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { entriesOverlap, entryHas, lockHolder, overlapsOf, parseScope, projectRel, scopeLocks, unlocked, covers } from './scope'

const ROOT = 'C:\\Users\\a\\Proj'

const task = (id: string, agentId: string, scope: string, extra: Partial<Task> = {}): Task => ({
  id,
  agentId,
  agentName: `Agent ${agentId}`,
  sessionId: 's',
  title: `Việc ${id}`,
  scope,
  status: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const keys = (scope: string): string[] => parseScope(scope, ROOT).map((e) => e.key)

describe('projectRel', () => {
  it('đường dẫn tuyệt đối trong dự án → tương đối, chữ thường, "/"', () => {
    expect(projectRel('C:\\Users\\a\\Proj\\src\\Auth\\Login.ts', ROOT)).toBe('src/auth/login.ts')
    expect(projectRel('c:/users/A/proj/src', ROOT)).toBe('src')
    expect(projectRel(ROOT, ROOT)).toBe('')
    // Git Bash: /c/... = C:/...
    expect(projectRel('/c/Users/a/Proj/src/x.ts', ROOT)).toBe('src/x.ts')
    expect(projectRel('x.ts', ROOT, '/c/Users/a/Proj/lib')).toBe('lib/x.ts')
  })

  it('tương đối tính từ base (cwd của phiên), gộp . và ..', () => {
    expect(projectRel('./src/a.ts', ROOT)).toBe('src/a.ts')
    expect(projectRel('../b.ts', ROOT, `${ROOT}\\src\\x`)).toBe('src/b.ts')
    expect(projectRel('src//a.ts', ROOT)).toBe('src/a.ts')
  })

  it('ngoài dự án → null (kể cả thư mục trùng phần đầu tên)', () => {
    expect(projectRel('C:\\Users\\a\\Project2\\x.ts', ROOT)).toBeNull()
    expect(projectRel('..\\other\\x.ts', ROOT)).toBeNull()
    expect(projectRel('', ROOT)).toBeNull()
  })
})

describe('parseScope', () => {
  it('danh sách phân cách bằng dấu phẩy / chấm phẩy / xuống dòng', () => {
    expect(keys('src/auth/, tests/auth;docs\nREADME.md')).toEqual(['src/auth', 'tests/auth', 'docs', 'readme.md'])
  })

  it('bỏ ghi chú trong ngoặc, chỉ giữ chữ giống đường dẫn trong một câu', () => {
    expect(keys('src/auth/ (luồng đăng nhập), sửa thêm tests/login.test.ts nếu cần')).toEqual(['src/auth', 'tests/login.test.ts'])
  })

  it('`backtick` giữ nguyên khoảng trắng', () => {
    expect(keys('`my folder/x.ts`, src')).toEqual(['my folder/x.ts', 'src'])
  })

  it('"." hay "*" = cả dự án; đường dẫn tuyệt đối ngoài dự án bị bỏ', () => {
    expect(keys('.')).toEqual([''])
    expect(keys('*')).toEqual([''])
    expect(keys('D:\\khac\\x.ts, src')).toEqual(['src'])
  })

  it('glob: key là phần đầu cố định, mẫu khớp đúng file', () => {
    const [e] = parseScope('src/**/*.test.ts', ROOT)
    expect(e.key).toBe('src')
    expect(entryHas(e, 'src/a/b.test.ts')).toBe(true)
    expect(entryHas(e, 'src/b.test.ts')).toBe(true)
    expect(entryHas(e, 'src/b.ts')).toBe(false)
    const [md] = parseScope('*.md', ROOT)
    expect(entryHas(md, 'readme.md')).toBe(true)
    expect(entryHas(md, 'docs/a.md')).toBe(false)
    const [brace] = parseScope('src/{a,b}.ts', ROOT)
    expect(entryHas(brace, 'src/a.ts')).toBe(true)
    expect(entryHas(brace, 'src/c.ts')).toBe(false)
  })

  it('glob: ký tự đại diện và ngoặc lồng bên trong {…} không làm hỏng regex', () => {
    const [e] = parseScope('src/{*.ts,lib}', ROOT)
    expect(entryHas(e, 'src/a.ts')).toBe(true)
    expect(entryHas(e, 'src/lib/x.js')).toBe(true)
    expect(entryHas(e, 'src/a.js')).toBe(false)
    const [q] = parseScope('src/{a?,b/**/*.md}', ROOT)
    expect(entryHas(q, 'src/ab')).toBe(true)
    expect(entryHas(q, 'src/b/x/y.md')).toBe(true)
    const [n] = parseScope('src/{a,{b,c}d}.ts', ROOT)
    expect(entryHas(n, 'src/cd.ts')).toBe(true)
    expect(entryHas(n, 'src/c.ts')).toBe(false)
    const [open] = parseScope('src/{a*.ts', ROOT)
    expect(entryHas(open, 'src/{ab.ts')).toBe(true)
  })

  it('thư mục chứa file theo ranh giới thư mục', () => {
    const [e] = parseScope('src/auth', ROOT)
    expect(entryHas(e, 'src/auth/login.ts')).toBe(true)
    expect(entryHas(e, 'src/auth')).toBe(true)
    expect(entryHas(e, 'src/authz/x.ts')).toBe(false)
  })
})

describe('entriesOverlap', () => {
  const e = (s: string) => parseScope(s, ROOT)[0]
  it('thư mục cha / con đè nhau, anh em thì không', () => {
    expect(entriesOverlap(e('src'), e('src/auth/x.ts'))).toBe(true)
    expect(entriesOverlap(e('src/auth/x.ts'), e('src'))).toBe(true)
    expect(entriesOverlap(e('src/auth'), e('src/ui'))).toBe(false)
  })
  it('glob đối với file cụ thể: thử mẫu; với thư mục: báo đè (thà thừa)', () => {
    expect(entriesOverlap(e('src/a.ts'), e('src/**/*.css'))).toBe(false)
    expect(entriesOverlap(e('src/**/*.css'), e('src/a.css'))).toBe(true)
    expect(entriesOverlap(e('src/ui'), e('src/**/*.css'))).toBe(true)
    expect(entriesOverlap(e('docs'), e('src/**/*.css'))).toBe(false)
  })
})

describe('khoá', () => {
  const vault = `${ROOT}\\Proj memory`
  const shared = unlocked(ROOT, vault)

  it('việc đang mở giữ phạm vi đã khai + file đã sửa; việc xong thì nhả', () => {
    const locks = scopeLocks(
      [task('1', 'a', 'src/auth', { files: ['src/util/date.ts'] }), task('2', 'c', 'src/ui', { status: 'done' })],
      ROOT
    )
    expect(lockHolder(locks, 'b', 'src/auth/login.ts', shared)?.lock.task.id).toBe('1')
    expect(lockHolder(locks, 'b', 'src/util/date.ts', shared)?.entry.label).toBe('src/util/date.ts')
    expect(lockHolder(locks, 'b', 'src/ui/button.tsx', shared)).toBeUndefined()
  })

  it('không khoá chính mình, vault và thư mục của app', () => {
    const locks = scopeLocks([task('1', 'a', '.')], ROOT)
    expect(lockHolder(locks, 'a', 'src/x.ts', shared)).toBeUndefined()
    expect(lockHolder(locks, 'b', 'src/x.ts', shared)).toBeDefined()
    expect(lockHolder(locks, 'b', 'proj memory/40 log/2026-10-09.md', shared)).toBeUndefined()
    expect(lockHolder(locks, 'b', '.sessions/x.md', shared)).toBeUndefined()
    expect(lockHolder(locks, 'b', '.stag/tasks.json', shared)).toBeUndefined()
  })

  it('overlapsOf: liệt kê việc của agent khác bị đè, bỏ qua vault', () => {
    const tasks = [task('1', 'a', 'src/auth, Proj memory/'), task('2', 'b', 'src, `Proj memory/40 Log`'), task('3', 'c', 'docs')]
    const locks = scopeLocks(tasks, ROOT)
    const o = overlapsOf(tasks[0], locks, ROOT, shared)
    expect(o.map((x) => x.other.id)).toEqual(['2'])
    expect(o[0].labels).toEqual(['src/auth'])
    expect(overlapsOf(tasks[2], locks, ROOT, shared)).toEqual([])
  })
})

describe('mẫu miễn khoá (Cài đặt → Khoá phạm vi)', () => {
  const vault = `${ROOT}\\Proj memory`
  const free = unlocked(ROOT, vault, ['docs/**', '**/*.lock', 'README.md', '.', '*'])
  const e = (s: string) => parseScope(s, ROOT)[0]

  it('unlocked: thư mục có sẵn + vault + mẫu; bỏ mẫu "cả dự án"', () => {
    expect(free.map((x) => x.label)).toEqual(['.sessions', '.stag', '.git', 'proj memory', 'docs/**', '**/*.lock', 'README.md'])
  })

  it('lockHolder bỏ qua file khớp mẫu miễn khoá, không phân biệt hoa thường', () => {
    const locks = scopeLocks([task('1', 'a', '.')], ROOT)
    expect(lockHolder(locks, 'b', 'docs/a/b.md', free)).toBeUndefined()
    expect(lockHolder(locks, 'b', 'src/deep/yarn.lock', free)).toBeUndefined()
    expect(lockHolder(locks, 'b', projectRel('Readme.MD', ROOT)!, free)).toBeUndefined()
    expect(lockHolder(locks, 'b', 'src/a.ts', free)?.lock.task.id).toBe('1')
    expect(lockHolder(locks, 'b', 'docsx/a.md', free)).toBeDefined()
  })

  it('covers: mẫu phủ hết một mục phạm vi', () => {
    const [docsAll, lock] = [e('docs/**'), e('**/*.lock')]
    expect(covers(docsAll, e('docs/'))).toBe(true)
    expect(covers(docsAll, e('docs/api/x.md'))).toBe(true)
    expect(covers(docsAll, e('docs/**/*.md'))).toBe(true)
    expect(covers(docsAll, e('src/'))).toBe(false)
    expect(covers(lock, e('package.lock'))).toBe(true)
    expect(covers(lock, e('src/'))).toBe(false)
    expect(covers(e('docs/*x'), e('docs/'))).toBe(false)
    expect(covers(e('*.md'), e('*.md'))).toBe(true)
    expect(covers(e('docs'), e('docs/**/*.md'))).toBe(true)
  })

  it('overlapsOf bỏ qua phạm vi nằm hẳn trong chỗ miễn khoá', () => {
    const tasks = [task('1', 'a', 'docs/, src/a.ts'), task('2', 'b', 'docs/guide, src/')]
    const locks = scopeLocks(tasks, ROOT)
    expect(overlapsOf(tasks[0], locks, ROOT, unlocked(ROOT, vault))[0].labels).toEqual(['docs/', 'src/a.ts'])
    expect(overlapsOf(tasks[0], locks, ROOT, free)[0].labels).toEqual(['src/a.ts'])
    expect(overlapsOf(tasks[0], scopeLocks([tasks[0], task('3', 'c', 'docs/x')], ROOT), ROOT, free)).toEqual([])
  })
})
