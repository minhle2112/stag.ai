import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, AgentStatus, Workspace } from '@shared/types'
import { Board, quoteSpacedPaths, type HookPayload } from './board'

// board.ts → workspace.ts có import `app` của Electron (không dùng tới trong các phép ở đây).
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => {
      throw new Error('board test không được đụng template')
    },
    getPath: () => {
      throw new Error('board test không được đụng userData')
    }
  }
}))

let root: string
let ws: Workspace

const agent = (id: string, workspaceId = 'ws1'): Agent => ({
  id,
  workspaceId,
  name: `Agent ${id}`,
  role: 'Dev',
  permissionMode: 'default',
  createdAt: '2026-01-01T00:00:00.000Z'
})

const tasksFile = (): string => join(ws.path, '.stag', 'tasks.json')

async function statusOf(board: Board, agentId: string): Promise<Omit<AgentStatus, 'since'> | undefined> {
  const s = (await board.snapshot(ws)).statuses.find((x) => x.agentId === agentId)
  if (!s) return undefined
  const { since: _since, ...rest } = s
  return rest
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-board-'))
  ws = { id: 'ws1', name: 'Demo', path: root, vaultPath: join(root, 'Demo memory'), createdAt: '2026-01-01T00:00:00.000Z' }
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(root, { recursive: true, force: true })
})

describe('Board.hook: trạng thái agent theo payload hook', () => {
  const cases: Array<[string, HookPayload, Omit<AgentStatus, 'since' | 'agentId'>]> = [
    ['UserPromptSubmit → đang làm', { hook_event_name: 'UserPromptSubmit' }, { activity: 'working' }],
    ['PostToolUse → đang làm', { hook_event_name: 'PostToolUse', tool_name: 'Edit' }, { activity: 'working' }],
    ['PreToolUse → đang làm, ghi tên tool', { hook_event_name: 'PreToolUse', tool_name: 'Bash' }, { activity: 'working', tool: 'Bash' }],
    [
      'PreToolUse AskUserQuestion → đang hỏi bạn',
      { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' },
      { activity: 'waiting', reason: 'question' }
    ],
    ['PermissionRequest → cần duyệt quyền', { hook_event_name: 'PermissionRequest' }, { activity: 'waiting', reason: 'permission' }],
    [
      'Notification permission_prompt → cần duyệt quyền',
      { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
      { activity: 'waiting', reason: 'permission' }
    ],
    [
      'Notification elicitation_dialog → đang hỏi bạn',
      { hook_event_name: 'Notification', notification_type: 'elicitation_dialog' },
      { activity: 'waiting', reason: 'question' }
    ],
    [
      'Notification agent_needs_input → đang hỏi bạn',
      { hook_event_name: 'Notification', notification_type: 'agent_needs_input' },
      { activity: 'waiting', reason: 'question' }
    ],
    ['Stop → chờ bạn trả lời', { hook_event_name: 'Stop' }, { activity: 'waiting', reason: 'turn' }]
  ]

  it.each(cases)('%s', async (_name, payload, want) => {
    const board = new Board(() => {})
    board.hook(agent('a'), payload)
    expect(await statusOf(board, 'a')).toEqual({ agentId: 'a', ...want })
  })

  it('sự kiện không liên quan / thiếu tên sự kiện → bỏ qua', async () => {
    const board = new Board(() => {})
    board.hook(agent('a'), { hook_event_name: 'SessionEnd' })
    board.hook(agent('a'), {})
    board.hook(agent('a'), { hook_event_name: 'Notification', notification_type: 'khác' })
    expect(await statusOf(board, 'a')).toBeUndefined()
  })

  it('idle_prompt chỉ đổi lý do khi agent đang chờ', async () => {
    const board = new Board(() => {})
    const a = agent('a')
    board.hook(a, { hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(await statusOf(board, 'a')).toBeUndefined()

    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    board.hook(a, { hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(await statusOf(board, 'a')).toEqual({ agentId: 'a', activity: 'working' })

    board.hook(a, { hook_event_name: 'Stop' })
    board.hook(a, { hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(await statusOf(board, 'a')).toEqual({ agentId: 'a', activity: 'waiting', reason: 'idle' })
  })

  it('đổi sang đang làm thì bỏ lý do chờ; đổi tool giữ mốc since, đổi activity thì mốc mới', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'))
    const board = new Board(() => {})
    const a = agent('a')

    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Read' })
    vi.setSystemTime(new Date('2026-01-01T10:05:00.000Z'))
    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Edit' })
    let s = (await board.snapshot(ws)).statuses[0]
    expect(s).toMatchObject({ activity: 'working', tool: 'Edit', since: '2026-01-01T10:00:00.000Z' })

    vi.setSystemTime(new Date('2026-01-01T10:06:00.000Z'))
    board.hook(a, { hook_event_name: 'Stop' })
    s = (await board.snapshot(ws)).statuses[0]
    expect(s).toEqual({ agentId: 'a', activity: 'waiting', reason: 'turn', tool: undefined, since: '2026-01-01T10:06:00.000Z' })

    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    s = (await board.snapshot(ws)).statuses[0]
    expect(s.reason).toBeUndefined()
    expect(s.activity).toBe('working')
  })

  it('setActivity starting/stopped và forget', async () => {
    const board = new Board(() => {})
    board.setActivity(agent('a'), 'starting')
    expect(await statusOf(board, 'a')).toEqual({ agentId: 'a', activity: 'starting' })
    // reason chỉ giữ khi waiting, tool chỉ giữ khi working
    board.setActivity(agent('a'), 'stopped', { reason: 'turn', tool: 'Bash' })
    expect(await statusOf(board, 'a')).toEqual({ agentId: 'a', activity: 'stopped' })
    board.forget('a')
    expect(await statusOf(board, 'a')).toBeUndefined()
  })

  it('snapshot chỉ lấy agent của workspace đó; forgetWorkspace bỏ hết', async () => {
    const board = new Board(() => {})
    board.hook(agent('a', 'ws1'), { hook_event_name: 'Stop' })
    board.hook(agent('b', 'ws2'), { hook_event_name: 'Stop' })
    expect((await board.snapshot(ws)).statuses.map((s) => s.agentId)).toEqual(['a'])
    board.forgetWorkspace('ws1')
    expect((await board.snapshot(ws)).statuses).toEqual([])
  })

  it('hook dồn dập được gộp lại thành một lần báo; trạng thái không đổi thì không báo', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const notify = vi.fn()
    const board = new Board(notify)
    const a = agent('a')
    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Read' })
    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Edit' })
    expect(notify).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('ws1')

    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Edit' }) // y hệt → không báo
    vi.advanceTimersByTime(200)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('Board: việc (task)', () => {
  it('task_start → task_done, lưu vào .stag/tasks.json và đọc lại được', async () => {
    const notify = vi.fn()
    const board = new Board(notify)
    const a = agent('a')

    const t = await board.startTask(ws, a, 'sess-1', '  Sửa lỗi đăng nhập ', ' src/auth ')
    expect(t).toMatchObject({ agentId: 'a', agentName: 'Agent a', sessionId: 'sess-1', title: 'Sửa lỗi đăng nhập', scope: 'src/auth', status: 'open' })
    expect(await board.openTask(ws, 'a')).toEqual(t)
    expect(notify).toHaveBeenCalledWith('ws1')

    const onDisk = JSON.parse(await fs.readFile(tasksFile(), 'utf8'))
    expect(onDisk).toEqual({ version: 1, tasks: [t] })
    // Ghi qua file tạm rồi rename → không còn .tmp
    expect(await fs.readdir(join(root, '.stag'))).toEqual(['tasks.json'])

    const done = await board.finishTask(ws, 'a', ' Đã sửa ')
    expect(done).toMatchObject({ status: 'done', summary: 'Đã sửa' })
    expect(done.doneAt).toBeTruthy()
    expect(await board.openTask(ws, 'a')).toBeUndefined()

    // Board mới (app khởi động lại) đọc lại từ file.
    const fresh = new Board(() => {})
    expect((await fresh.snapshot(ws)).tasks).toEqual([done])
  })

  it('agent của project: việc ghi thư mục project (base) và project; bàn giao giữ base, nhận project của người nhận', async () => {
    const board = new Board(() => {})
    const pws: Workspace = {
      ...ws,
      projects: [
        { id: 'pw', name: 'web', folder: 'apps/web', goal: '', color: 0, note: '70 Projects/web/web.md', createdAt: '' },
        { id: 'pm', name: 'mobile', folder: 'apps/mobile', goal: '', color: 1, note: '70 Projects/mobile/mobile.md', createdAt: '' }
      ]
    }
    const a = { ...agent('a'), projectId: 'pw' }
    const b = { ...agent('b'), projectId: 'pm' }
    const t = await board.startTask(pws, a, 's', 'Giỏ hàng', 'src/cart/')
    expect(t).toMatchObject({ scope: 'src/cart/', base: 'apps/web', projectId: 'pw' })
    const moved = await board.transferTask(pws, 'a', b, 's2', 'tiếp đi')
    expect(moved).toMatchObject({ agentId: 'b', base: 'apps/web', projectId: 'pm' })
    // Agent ở Chung: không có base / projectId.
    const c = await board.startTask(pws, agent('c'), 's', 'Docs', 'docs/')
    expect(c.base).toBeUndefined()
    expect(c.projectId).toBeUndefined()
  })

  it('hai task_start song song của cùng agent: chỉ mở được một việc', async () => {
    const board = new Board(() => {})
    const a = agent('a')
    const r = await Promise.allSettled([board.startTask(ws, a, 's', 'Một', 'src/'), board.startTask(ws, a, 's', 'Hai', 'lib/')])
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await board.snapshot(ws)).tasks.filter((t) => t.agentId === 'a' && t.status === 'open')).toHaveLength(1)
  })

  it('việc đóng → báo cho nhật ký việc: task_done (kèm log), bàn giao, người dùng đánh dấu xong; bỏ thì không', async () => {
    const closed = vi.fn()
    const board = new Board(() => {}, () => {}, closed)
    const a = agent('a')
    const b = agent('b')
    await board.startTask(ws, a, 's', 'Một', 'src/')
    await board.finishTask(ws, 'a', 'xong', '  Added X  ')
    expect(closed).toHaveBeenLastCalledWith(ws, { task: expect.objectContaining({ title: 'Một', log: 'Added X', status: 'done' }), how: 'done' })
    await board.startTask(ws, a, 's', 'Hai', '')
    await board.transferTask(ws, 'a', b, 's2', 'Done: x')
    expect(closed).toHaveBeenLastCalledWith(ws, { task: expect.objectContaining({ title: 'Hai', agentId: 'a' }), how: 'handoff', to: 'Agent b' })
    const open = await board.openTask(ws, 'b')
    await board.closeTask(ws, open!.id, 'done')
    expect(closed).toHaveBeenLastCalledWith(ws, { task: expect.objectContaining({ agentId: 'b', manual: true }), how: 'manual' })
    await board.startTask(ws, a, 's', 'Ba', '')
    await board.closeTask(ws, (await board.openTask(ws, 'a'))!.id, 'dropped')
    expect(closed).toHaveBeenCalledTimes(3)
  })

  it('task_start khi còn việc mở → lỗi; task_done/task_update khi chưa có việc → lỗi', async () => {
    const board = new Board(() => {})
    const a = agent('a')
    await expect(board.finishTask(ws, 'a', 'x')).rejects.toThrow('You have no open task')
    await expect(board.updateTask(ws, 'a', { title: 'x' })).rejects.toThrow('You have no open task')
    await board.startTask(ws, a, 's', 'Việc 1', '')
    await expect(board.startTask(ws, a, 's', 'Việc 2', '')).rejects.toThrow('Việc 1')
  })

  it('task_update chỉ đổi trường có nội dung', async () => {
    const board = new Board(() => {})
    await board.startTask(ws, agent('a'), 's', 'Cũ', 'phạm vi cũ')
    const t = await board.updateTask(ws, 'a', { title: '  ', scope: ' mới ' })
    expect(t).toMatchObject({ title: 'Cũ', scope: 'mới' })
  })

  it('người dùng đánh dấu xong / bỏ thẻ; việc đã đóng thì không đóng lại', async () => {
    const board = new Board(() => {})
    const t = await board.startTask(ws, agent('a'), 's', 'Việc', '')
    const closed = await board.closeTask(ws, t.id, 'dropped')
    expect(closed).toMatchObject({ status: 'dropped', manual: true })
    expect(await board.closeTask(ws, t.id, 'done')).toBeUndefined()
    expect(await board.closeTask(ws, 'không-có', 'done')).toBeUndefined()
  })

  it('dropAgentTasks bỏ việc đang mở, giữ lịch sử việc xong', async () => {
    const board = new Board(() => {})
    const a = agent('a')
    await board.startTask(ws, a, 's', 'Xong rồi', '')
    await board.finishTask(ws, 'a', 'ok')
    await board.startTask(ws, a, 's', 'Đang dở', '')
    await board.dropAgentTasks(ws, 'a')
    expect((await board.snapshot(ws)).tasks.map((t) => [t.title, t.status])).toEqual([
      ['Xong rồi', 'done'],
      ['Đang dở', 'dropped']
    ])
  })

  it('nhiều agent ghi cùng lúc → file có đủ việc', async () => {
    const board = new Board(() => {})
    await Promise.all(['a', 'b', 'c', 'd'].map((id) => board.startTask(ws, agent(id), 's', `Việc ${id}`, '')))
    const onDisk = JSON.parse(await fs.readFile(tasksFile(), 'utf8')) as { tasks: Array<{ title: string }> }
    expect(onDisk.tasks.map((t) => t.title).sort()).toEqual(['Việc a', 'Việc b', 'Việc c', 'Việc d'])
  })

  it('repo git → thêm .stag/ vào .gitignore một lần', async () => {
    await fs.mkdir(join(root, '.git'))
    const board = new Board(() => {})
    await board.startTask(ws, agent('a'), 's', 'Việc', '')
    await board.finishTask(ws, 'a', 'ok')
    const gi = await fs.readFile(join(root, '.gitignore'), 'utf8')
    expect(gi.match(/^\.stag\/$/gm)).toHaveLength(1)
  })

  it('tasks.json hỏng → cất sang tasks.json.broken-<ms>, bắt đầu danh sách mới', async () => {
    await fs.mkdir(join(root, '.stag'))
    await fs.writeFile(tasksFile(), '{ "version": 1, "tasks": [ hỏng', 'utf8')

    const board = new Board(() => {})
    expect((await board.snapshot(ws)).tasks).toEqual([])

    const files = await fs.readdir(join(root, '.stag'))
    const broken = files.filter((f) => /^tasks\.json\.broken-\d+$/.test(f))
    expect(broken).toHaveLength(1)
    expect(files).not.toContain('tasks.json')
    expect(await fs.readFile(join(root, '.stag', broken[0]), 'utf8')).toBe('{ "version": 1, "tasks": [ hỏng')

    // Ghi việc mới không đụng tới bản hỏng đã cất.
    await board.startTask(ws, agent('a'), 's', 'Mới', '')
    expect((await fs.readdir(join(root, '.stag'))).sort()).toEqual([broken[0], 'tasks.json'].sort())
  })

  it.each([
    ['{}', '{}'],
    ['null', 'null'],
    ['mảng', '[]'],
    ['tasks không phải mảng', '{ "version": 1, "tasks": {} }']
  ])('tasks.json là JSON nhưng thiếu mảng tasks (%s) → cũng cất sang bên cạnh, không bị ghi đè', async (_label, raw) => {
    await fs.mkdir(join(root, '.stag'))
    await fs.writeFile(tasksFile(), raw, 'utf8')

    const board = new Board(() => {})
    expect((await board.snapshot(ws)).tasks).toEqual([])
    await board.startTask(ws, agent('a'), 's', 'Mới', '')

    const files = await fs.readdir(join(root, '.stag'))
    const broken = files.filter((f) => /^tasks\.json\.broken-\d+$/.test(f))
    expect(broken).toHaveLength(1)
    expect(await fs.readFile(join(root, '.stag', broken[0]), 'utf8')).toBe(raw)
  })

  it('tasks.json hỏng mà không cất được → báo lỗi, không ghi đè, lần sau đọc lại', async () => {
    await fs.mkdir(join(root, '.stag'))
    await fs.writeFile(tasksFile(), '{}', 'utf8')
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(new Error('EBUSY'))

    const board = new Board(() => {})
    await expect(board.snapshot(ws)).rejects.toThrow(/không cất sang .* được: EBUSY/)
    await expect(board.startTask(ws, agent('a'), 's', 'Mới', '')).rejects.toThrow(/EBUSY/)
    expect(await fs.readFile(tasksFile(), 'utf8')).toBe('{}')
    rename.mockRestore()

    // Promise lỗi không nằm lại trong cache: lần sau đọc lại, cất được thì chạy bình thường.
    expect((await board.snapshot(ws)).tasks).toEqual([])
    const files = await fs.readdir(join(root, '.stag'))
    expect(files.filter((f) => /^tasks\.json\.broken-\d+$/.test(f))).toHaveLength(1)
  })

  it('chưa có tasks.json → danh sách rỗng, không tạo file khi chỉ đọc', async () => {
    const board = new Board(() => {})
    expect(await board.snapshot(ws)).toEqual({ statuses: [], tasks: [], scopeAsks: [] })
    await expect(fs.access(join(root, '.stag'))).rejects.toThrow()
  })
})

describe('Board: sự kiện để báo người dùng (thông báo Windows)', () => {
  it('báo một lần khi agent chuyển sang chờ bạn (hết lượt / hỏi / xin quyền)', () => {
    const events = vi.fn()
    const board = new Board(() => {}, events)
    const a = agent('a')
    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    board.hook(a, { hook_event_name: 'Stop' })
    expect(events).toHaveBeenCalledTimes(1)
    expect(events).toHaveBeenLastCalledWith({ kind: 'waiting', workspaceId: 'ws1', agentId: 'a', agentName: 'Agent a', reason: 'turn' })
    // Vẫn đang chờ: "chờ lâu" (idle_prompt) không báo lại.
    board.hook(a, { hook_event_name: 'Notification', notification_type: 'idle_prompt' })
    expect(events).toHaveBeenCalledTimes(1)
    board.hook(a, { hook_event_name: 'PreToolUse', tool_name: 'Bash' })
    board.hook(a, { hook_event_name: 'PermissionRequest' })
    expect(events).toHaveBeenCalledTimes(2)
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'waiting', reason: 'permission' }))
  })

  it('không báo khi chính người dùng ngắt (Esc) hoặc lúc app đang tự bàn giao', () => {
    const events = vi.fn()
    const board = new Board(() => {}, events)
    const a = agent('a')
    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    board.hook(a, { hook_event_name: 'Interrupt' })
    expect(events).not.toHaveBeenCalled()
    board.hook(a, { hook_event_name: 'UserPromptSubmit' })
    board.setHandoff(a, 'asking')
    board.hook(a, { hook_event_name: 'Stop' })
    expect(events).not.toHaveBeenCalled()
  })

  it('task_done → báo xong việc (đóng thẻ bằng tay thì không)', async () => {
    const events = vi.fn()
    const board = new Board(() => {}, events)
    const a = agent('a')
    await board.startTask(ws, a, 's', 'Sửa lỗi', '')
    await board.finishTask(ws, 'a', 'xong')
    expect(events).toHaveBeenCalledWith({ kind: 'taskDone', workspaceId: 'ws1', agentId: 'a', agentName: 'Agent a', title: 'Sửa lỗi' })
    const t2 = await board.startTask(ws, a, 's', 'Việc 2', '')
    events.mockClear()
    await board.closeTask(ws, t2.id, 'done')
    expect(events).not.toHaveBeenCalled()
  })
})

describe('Board.transferTask (agent_handoff)', () => {
  it('việc của người gửi xong, thẻ mới cùng tên / phạm vi / file mở cho người nhận', async () => {
    const events = vi.fn()
    const board = new Board(() => {}, events)
    const a = agent('a')
    const b = agent('b')
    await board.startTask(ws, a, 'sa', 'Sửa divide', 'src/math.js')
    await board.touch(ws, 'a', ['src/util.js'])
    events.mockClear()
    const moved = await board.transferTask(ws, 'a', b, 'sb', ' Left: tests ', 'Cập nhật test')
    expect(moved).toMatchObject({ agentId: 'b', agentName: 'Agent b', sessionId: 'sb', title: 'Cập nhật test', scope: 'src/math.js', files: ['src/util.js'], status: 'open' })
    expect(await board.openTask(ws, 'a')).toBeUndefined()
    const done = (await board.snapshot(ws)).tasks.find((t) => t.agentId === 'a')!
    expect(done).toMatchObject({ status: 'done', summary: 'Handed off to Agent b:\nLeft: tests' })
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: 'taskDone', agentId: 'a' }))
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ kind: 'taskStarted', agentId: 'b', title: 'Cập nhật test' }))
    // Không đổi tên → giữ tên việc cũ.
    const c = agent('c')
    expect((await board.transferTask(ws, 'b', c, '', 'x'))?.title).toBe('Cập nhật test')
  })

  it('người gửi không có việc mở → undefined; người nhận còn việc → lỗi, không đổi gì', async () => {
    const board = new Board(() => {})
    const a = agent('a')
    const b = agent('b')
    expect(await board.transferTask(ws, 'a', b, '', 's')).toBeUndefined()
    await board.startTask(ws, a, '', 'A', 'src/a')
    await board.startTask(ws, b, '', 'B', 'src/b')
    await expect(board.transferTask(ws, 'a', b, '', 's')).rejects.toThrow(/still has an open task "B"/)
    expect((await board.openTask(ws, 'a'))?.title).toBe('A')
  })
})

describe('quoteSpacedPaths: phạm vi có đường dẫn chứa khoảng trắng', () => {
  it('bọc đường dẫn có thật (hoặc thư mục chứa nó có thật), chữ tự do giữ nguyên', async () => {
    await fs.mkdir(join(root, 'Demo memory', '40 Log'), { recursive: true })
    await fs.mkdir(join(root, 'src'), { recursive: true })
    const q = (s: string) => quoteSpacedPaths(s, root)
    expect(await q('Demo memory/40 Log/2026-10-10.md, src/a.ts')).toBe('`Demo memory/40 Log/2026-10-10.md`, src/a.ts')
    expect(await q('Demo memory/40 Log/ (log)')).toBe('`Demo memory/40 Log/` (log)')
    expect(await q('"Demo memory/**/*.md"')).toBe('`Demo memory/**/*.md`')
    expect(await q('src/new file.ts')).toBe('`src/new file.ts`')
    for (const s of ['src/a.ts tests/b.ts', 'sửa src/a.ts', 'a.ts b.ts', '`Demo memory/x.md`', 'src/{a,b}.ts', 'Nope dir/x.ts'])
      expect(await q(s), s).toBe(s)
  })

  it('task_start / task_update lưu phạm vi đã bọc', async () => {
    await fs.mkdir(join(root, 'Demo memory', '40 Log'), { recursive: true })
    const board = new Board(() => {})
    const t = await board.startTask(ws, agent('a'), '', 'Log', 'Demo memory/40 Log/x.md')
    expect(t.scope).toBe('`Demo memory/40 Log/x.md`')
    expect((await board.updateTask(ws, 'a', { scope: 'src, Demo memory/40 Log/' })).scope).toBe('src, `Demo memory/40 Log/`')
  })
})

describe('tasks.json đổi trên đĩa (bản app khác / git checkout)', () => {
  it('đọc lại trước khi dùng: không ghi đè mất việc của bên kia, object việc đang giữ vẫn đúng', async () => {
    const a = new Board(() => {})
    const b = new Board(() => {})
    await a.snapshot(ws)
    await b.snapshot(ws)
    const ta = await a.startTask(ws, agent('a'), 's1', 'Việc A', 'src')
    // B đã nạp danh sách rỗng từ trước: vẫn thấy việc A, mở việc B không làm mất việc A.
    expect((await b.openTask(ws, 'a'))?.id).toBe(ta.id)
    await b.startTask(ws, agent('b'), 's2', 'Việc B', 'docs')
    // A đóng việc của mình: giữ việc B do bản kia ghi.
    await a.finishTask(ws, 'a', 'xong')
    const onDisk = JSON.parse(await fs.readFile(tasksFile(), 'utf8')).tasks as Array<{ title: string; status: string }>
    expect(onDisk.map((t) => [t.title, t.status])).toEqual([
      ['Việc A', 'done'],
      ['Việc B', 'open']
    ])
    expect((await b.snapshot(ws)).tasks.map((t) => t.status)).toEqual(['done', 'open'])
  })
})
