import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCOPE, type Agent, type ScopeLockSettings, type Workspace } from '@shared/types'
import { Board } from './board'
import { editTargets, looksLikeWrite, ScopeGuard, withoutDataHeredocs, type ScopeConflict } from './scopeGuard'
import { overlapWarning } from './mcp'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => {
      throw new Error('không dùng template')
    },
    getPath: () => {
      throw new Error('không dùng userData')
    }
  }
}))
// mcp.ts (cảnh báo task_start) kéo theo trình duyệt; ở đây chỉ cần tên phím.
vi.mock('./browser', () => ({ BROWSER_KEYS: ['Enter'] }))

let root: string
let ws: Workspace
let board: Board
let guard: ScopeGuard
let cfg: ScopeLockSettings

const agent = (id: string): Agent => ({
  id,
  workspaceId: 'ws1',
  name: `Agent ${id}`,
  role: '',
  permissionMode: 'default',
  createdAt: '2026-01-01T00:00:00.000Z'
})
const A = agent('a')
const B = agent('b')

const edit = (file: string, event = 'PreToolUse') => ({ hook_event_name: event, tool_name: 'Edit', tool_input: { file_path: file } })

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-scope-'))
  ws = { id: 'ws1', name: 'Demo', path: root, vaultPath: join(root, 'Demo memory'), createdAt: '2026-01-01T00:00:00.000Z' }
  board = new Board(() => {})
  cfg = { ...DEFAULT_SCOPE }
  guard = new ScopeGuard(board, () => cfg)
  await board.startTask(ws, A, 's1', 'Đăng nhập', 'src/auth/')
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(root, { recursive: true, force: true })
})

describe('editTargets', () => {
  it('tool sửa file của Claude Code', () => {
    expect(editTargets({ tool_name: 'Write', tool_input: { file_path: 'C:\\p\\a.ts' } })).toEqual(['C:\\p\\a.ts'])
    expect(editTargets({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } })).toEqual(['n.ipynb'])
    expect(editTargets({ tool_name: 'Read', tool_input: { file_path: 'a.ts' } })).toBeNull()
    expect(editTargets({ tool_name: 'Bash', tool_input: { command: 'echo > a.ts' } })).toBeNull()
  })

  it('apply_patch của Codex: mọi file trong bản vá', () => {
    const command = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-x',
      '+y',
      '*** Add File: src/new.ts',
      '+hi',
      '*** Delete File: old.ts',
      '*** Update File: src/b.ts',
      '*** Move to: src/c.ts',
      '*** End Patch'
    ].join('\n')
    expect(editTargets({ tool_name: 'apply_patch', tool_input: { command } })).toEqual(['src/a.ts', 'src/new.ts', 'old.ts', 'src/b.ts', 'src/c.ts'])
  })
})

describe('ScopeGuard — Claude Code', () => {
  it('sửa file trong phạm vi agent khác → hỏi (ask) kèm lý do', async () => {
    const r = await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'auth', 'login.ts')))
    expect(r?.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('src/auth/login.ts')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('Agent a')
  })

  it('báo onConflict (plugin: scope.conflict) mỗi lần hỏi, không báo khi không đụng', async () => {
    const seen: unknown[] = []
    guard.onConflict = (c) => seen.push({ ws: c.ws.id, agent: c.agent.id, hits: c.hits, owner: c.owner.agentName, task: c.owner.title, entry: c.entry, decision: c.decision })
    await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'auth', 'login.ts')))
    await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'ui', 'x.ts')))
    await guard.preToolUse(ws, A, 'claude', edit(join(root, 'src', 'auth', 'x.ts')))
    expect(seen).toEqual([{ ws: 'ws1', agent: 'b', hits: ['src/auth/login.ts'], owner: 'Agent a', task: 'Đăng nhập', entry: 'src/auth/', decision: 'ask' }])
  })

  it('không hỏi: chính chủ, ngoài vùng khoá, vault, tool không sửa file', async () => {
    expect(await guard.preToolUse(ws, A, 'claude', edit(join(root, 'src', 'auth', 'x.ts')))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'ui', 'x.ts')))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', edit(join(ws.vaultPath, '40 Log', 'x.md')))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'auth', 'x.ts') } })).toBeUndefined()
  })

  it('người dùng cho qua (tool đã chạy) → không hỏi lại file đó trong phiên này', async () => {
    const f = join(root, 'src', 'auth', 'login.ts')
    await guard.postToolUse(ws, B, edit(f, 'PostToolUse'))
    expect(await guard.preToolUse(ws, B, 'claude', edit(f))).toBeUndefined()
    // File khác trong vùng khoá vẫn hỏi.
    expect(await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'auth', 'other.ts')))).toBeDefined()
    guard.endSession('b')
    expect(await guard.preToolUse(ws, B, 'claude', edit(f))).toBeDefined()
  })

  it('file đã sửa ngoài phạm vi khai → vào vùng khoá của việc', async () => {
    await guard.postToolUse(ws, A, edit(join(root, 'src', 'util', 'date.ts'), 'PostToolUse'))
    await guard.postToolUse(ws, A, edit(join(root, 'src', 'auth', 'in-scope.ts'), 'PostToolUse'))
    await guard.postToolUse(ws, A, edit(join(ws.vaultPath, 'x.md'), 'PostToolUse'))
    expect((await board.openTask(ws, 'a'))?.files).toEqual(['src/util/date.ts'])
    const r = await guard.preToolUse(ws, B, 'claude', edit('src/util/date.ts'))
    expect(r?.hookSpecificOutput.permissionDecision).toBe('ask')
    // Việc xong → nhả khoá.
    await board.finishTask(ws, 'a', 'xong')
    expect(await guard.preToolUse(ws, B, 'claude', edit('src/util/date.ts'))).toBeUndefined()
  })
})

describe('lệnh shell', () => {
  const sh = (command: string, event = 'PreToolUse') => ({ hook_event_name: event, tool_name: 'Bash', tool_input: { command }, cwd: root })

  it('looksLikeWrite', () => {
    for (const c of [
      'Add-Content -LiteralPath hello.txt -Value x',
      'echo hi > src/a.ts',
      'echo hi >> src/a.ts',
      'rm -rf src/auth',
      "sed -i 's/a/b/' src/a.ts",
      'git checkout -- src/a.ts',
      '[IO.File]::WriteAllText("src/a.ts", "x")',
      'Remove-Item src\\auth\\x.ts'
    ])
      expect(looksLikeWrite(c), c).toBe(true)
    for (const c of ['cat src/a.ts', 'Get-Content src/a.ts', 'npm test 2>&1', 'git diff src/a.ts', 'rg "a => b" src', 'node -e "x>=1"'])
      expect(looksLikeWrite(c), c).toBe(false)
  })

  it('lệnh ghi nhắc tới đường dẫn bị khoá → hỏi; lệnh đọc hoặc chỗ khác → không', async () => {
    const r = await guard.preToolUse(ws, B, 'claude', sh('Set-Content -Path src\\auth\\login.ts -Value x'))
    expect(r?.hookSpecificOutput.permissionDecision).toBe('ask')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('Lệnh này có thể sửa src/auth/')
    expect(await guard.preToolUse(ws, B, 'claude', sh('Get-Content src/auth/login.ts'))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/authz/x.ts'))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', sh(`rm ${join(root, 'src', 'auth', 'x.ts')}`))).toBeDefined()
    // Chính chủ thì không hỏi.
    expect(await guard.preToolUse(ws, A, 'claude', sh('rm src/auth/x.ts'))).toBeUndefined()
  })

  it('thân heredoc của cat / tee là dữ liệu: nhắc tới đường dẫn khoá trong đó thì không hỏi', async () => {
    const note = "cat > \"Demo memory/50 Decisions/x.md\" <<'EOF'\nTests in `src/auth/login.ts` must change.\nEOF\nsed -i 's/a/b/' _INDEX.md"
    expect(await guard.preToolUse(ws, B, 'claude', sh(note))).toBeUndefined()
    // Heredoc đưa vào trình thông dịch / qua ống: vẫn là code.
    for (const c of ["bash <<'EOF'\nrm src/auth/x.ts\nEOF", "cat <<EOF | sh\nrm src/auth/x.ts\nEOF", 'cat > src/auth/x.ts <<EOF\nhi\nEOF'])
      expect(await guard.preToolUse(ws, B, 'claude', sh(c)), c).toBeDefined()
    expect(withoutDataHeredocs("a\ncat <<-END > f\n\tsrc/auth\n\tEND\nrm src/auth/x")).toBe('a\ncat <<-END > f\n\tEND\nrm src/auth/x')
  })

  it('đã chạy (người dùng cho) → không hỏi lại mục đó', async () => {
    await guard.postToolUse(ws, B, sh('rm src/auth/x.ts', 'PostToolUse'))
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/auth/y.ts'))).toBeUndefined()
  })

  it('Codex: hỏi trong app, kèm lệnh', async () => {
    const pending = guard.preToolUse(ws, B, 'codex', sh('Add-Content src/auth/login.ts x'))
    await vi.waitFor(async () => expect((await board.snapshot(ws)).scopeAsks).toHaveLength(1))
    const [ask] = (await board.snapshot(ws)).scopeAsks
    expect(ask).toMatchObject({ file: 'src/auth/', command: 'Add-Content src/auth/login.ts x' })
    board.answerScope(ask.id, false)
    expect((await pending)?.hookSpecificOutput.permissionDecisionReason).toContain('run this command')
  })
})

describe('ScopeGuard — Codex (app hỏi)', () => {
  const patch = (file: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n*** End Patch` }, cwd: root })

  it('người dùng cho sửa → không chặn, lần sau không hỏi', async () => {
    const pending = guard.preToolUse(ws, B, 'codex', patch('src/auth/login.ts'))
    await vi.waitFor(async () => expect((await board.snapshot(ws)).scopeAsks).toHaveLength(1))
    const [ask] = (await board.snapshot(ws)).scopeAsks
    expect(ask).toMatchObject({ agentId: 'b', file: 'src/auth/login.ts', holder: { agentName: 'Agent a', title: 'Đăng nhập', entry: 'src/auth/' } })
    expect(board.statusOf('b')).toMatchObject({ activity: 'waiting', reason: 'permission' })
    board.answerScope(ask.id, true)
    expect(await pending).toBeUndefined()
    expect((await board.snapshot(ws)).scopeAsks).toEqual([])
    expect(board.statusOf('b')?.activity).toBe('working')
    expect(await guard.preToolUse(ws, B, 'codex', patch('src/auth/login.ts'))).toBeUndefined()
  })

  it('người dùng từ chối / phiên đóng → deny kèm lý do cho agent', async () => {
    const p1 = guard.preToolUse(ws, B, 'codex', patch('src/auth/login.ts'))
    await vi.waitFor(async () => expect((await board.snapshot(ws)).scopeAsks).toHaveLength(1))
    board.answerScope((await board.snapshot(ws)).scopeAsks[0].id, false)
    const r = await p1
    expect(r?.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('src/auth/login.ts')

    const p2 = guard.preToolUse(ws, B, 'codex', patch('src/auth/login.ts'))
    await vi.waitFor(async () => expect((await board.snapshot(ws)).scopeAsks).toHaveLength(1))
    guard.endSession('b')
    expect((await p2)?.hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('Cài đặt khoá phạm vi', () => {
  const login = () => edit(join(root, 'src', 'auth', 'login.ts'))
  const sh = (command: string, event = 'PreToolUse') => ({ hook_event_name: event, tool_name: 'Bash', tool_input: { command }, cwd: root })
  const patch = (file: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${file}\n*** End Patch` }, cwd: root })
  let seen: ScopeConflict['decision'][]
  beforeEach(() => {
    seen = []
    guard.onConflict = (c) => seen.push(c.decision)
  })

  it('off: không xét gì, không báo', async () => {
    cfg.mode = 'off'
    expect(await guard.preToolUse(ws, B, 'claude', login())).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'codex', patch('src/auth/login.ts'))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/auth/x.ts'))).toBeUndefined()
    expect(seen).toEqual([])
    expect((await board.snapshot(ws)).scopeAsks).toEqual([])
  })

  it('warn: cho qua, báo "warned" mỗi chỗ một lần mỗi phiên', async () => {
    cfg.mode = 'warn'
    expect(await guard.preToolUse(ws, B, 'claude', login())).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', login())).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'codex', patch('src/auth/other.ts'))).toBeUndefined()
    expect((await board.snapshot(ws)).scopeAsks).toEqual([])
    expect(seen).toEqual(['warned', 'warned'])
    guard.endSession('b')
    await guard.preToolUse(ws, B, 'claude', login())
    expect(seen).toHaveLength(3)
    // Không tính là cho qua: đổi sang hỏi thì vẫn hỏi.
    cfg.mode = 'ask'
    expect((await guard.preToolUse(ws, B, 'claude', login()))?.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('block: chặn thẳng (Claude và Codex, không hộp thoại), cả chỗ đã cho qua trước đó', async () => {
    await guard.postToolUse(ws, B, edit(join(root, 'src', 'auth', 'login.ts'), 'PostToolUse'))
    expect(await guard.preToolUse(ws, B, 'claude', login())).toBeUndefined()
    cfg.mode = 'block'
    const r = await guard.preToolUse(ws, B, 'claude', login())
    expect(r?.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('set to block')
    expect(r?.hookSpecificOutput.permissionDecisionReason).toContain('Agent a')
    const c = await guard.preToolUse(ws, B, 'codex', patch('src/auth/x.ts'))
    expect(c?.hookSpecificOutput.permissionDecision).toBe('deny')
    expect((await board.snapshot(ws)).scopeAsks).toEqual([])
    expect((await guard.preToolUse(ws, B, 'codex', sh('rm src/auth/x.ts')))?.hookSpecificOutput.permissionDecisionReason).toContain('run this command')
    expect(seen).toEqual(['blocked', 'blocked', 'blocked'])
    // Chính chủ và chỗ ngoài vùng khoá vẫn sửa được.
    expect(await guard.preToolUse(ws, A, 'claude', login())).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'ui', 'x.ts')))).toBeUndefined()
  })

  it('đổi cài đặt có tác dụng ngay ở lần gọi tool sau', async () => {
    cfg.mode = 'off'
    expect(await guard.preToolUse(ws, B, 'claude', login())).toBeUndefined()
    cfg.mode = 'ask'
    expect((await guard.preToolUse(ws, B, 'claude', login()))?.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('guessShell tắt: bỏ qua lệnh shell, tool sửa file vẫn xét', async () => {
    cfg.guessShell = false
    expect(await guard.preToolUse(ws, B, 'claude', sh('Set-Content -Path src/auth/login.ts -Value x'))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'codex', sh('rm src/auth/x.ts'))).toBeUndefined()
    expect((await guard.preToolUse(ws, B, 'claude', login()))?.hookSpecificOutput.permissionDecision).toBe('ask')
    // Lệnh đã chạy không bị coi là người dùng cho qua.
    await guard.postToolUse(ws, B, sh('rm src/auth/x.ts', 'PostToolUse'))
    cfg.guessShell = true
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/auth/y.ts'))).toBeDefined()
  })

  it('exempt: file khớp mẫu không bị khoá (cả lệnh shell chỉ đụng file miễn), không vào vùng khoá của việc', async () => {
    cfg.exempt = ['src/auth/**/*.md', 'GEN/']
    expect(await guard.preToolUse(ws, B, 'claude', edit(join(root, 'src', 'auth', 'notes', 'README.md')))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/auth/notes/a.md'))).toBeUndefined()
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm src/auth/a.md src/auth/b.ts'))).toBeDefined()
    expect((await guard.preToolUse(ws, B, 'claude', login()))?.hookSpecificOutput.permissionDecision).toBe('ask')
    // Agent A sửa file trong thư mục miễn khoá → không thành vùng khoá.
    await guard.postToolUse(ws, A, edit(join(root, 'gen', 'out.ts'), 'PostToolUse'))
    await guard.postToolUse(ws, A, edit(join(root, 'lib', 'x.ts'), 'PostToolUse'))
    expect((await board.openTask(ws, 'a'))?.files).toEqual(['lib/x.ts'])
    // Cả phạm vi khai nằm trong chỗ miễn → lệnh shell nhắc tới nó không bị hỏi.
    await board.startTask(ws, agent('c'), 's3', 'Sinh code', 'gen/')
    expect(await guard.preToolUse(ws, B, 'claude', sh('rm -rf gen/'))).toBeUndefined()
  })
})

describe('cảnh báo task_start / task_update theo cài đặt', () => {
  const C = agent('c')
  it('off: không cảnh báo; ask / block / warn: câu cuối nói app sẽ làm gì; exempt bỏ chỗ trùng được miễn', async () => {
    const task = await board.startTask(ws, C, 's3', 'Sửa auth', 'src/auth/login.ts')
    expect(await overlapWarning(board, ws, task, { ...DEFAULT_SCOPE, mode: 'off' })).toBe('')
    const ask = await overlapWarning(board, ws, task)
    expect(ask).toContain('WARNING — your scope overlaps')
    expect(ask).toContain('asks the user for permission')
    expect(await overlapWarning(board, ws, task, { ...DEFAULT_SCOPE, mode: 'block' })).toContain('blocks your edits')
    expect(await overlapWarning(board, ws, task, { ...DEFAULT_SCOPE, mode: 'warn' })).toContain('will not stop you')
    expect(await overlapWarning(board, ws, task, { ...DEFAULT_SCOPE, exempt: ['src/auth/login.ts'] })).toBe('')
  })
})
