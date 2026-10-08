import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Agent, AgentActivity, AgentStatus, BoardSnapshot, ContextUsage, HandoffState, ScopeAsk, Task, WaitReason, Workspace } from '@shared/types'
import { readText } from './fsutil'
import { ensureIgnored } from './workspace'

interface TasksFile {
  version: 1
  tasks: Task[]
}

/** Phần dữ liệu hook Claude Code gửi về mà bảng cần (xem docs Claude Code: hooks). */
export interface HookPayload {
  hook_event_name?: string
  session_id?: string
  /** Transcript JSONL của phiên (để phát hiện người dùng bấm Esc ngắt, xem transcript.ts). */
  transcript_path?: string
  tool_name?: string
  /** Tham số của tool (PreToolUse / PostToolUse), để biết file nào sắp bị sửa (xem scopeGuard.ts). */
  tool_input?: Record<string, unknown>
  /** Thư mục làm việc của phiên (đường dẫn tương đối trong tool_input tính từ đây). */
  cwd?: string
  notification_type?: string
}

/** Số file tối đa ghi vào một việc (vùng khoá); quá thì bỏ các file cũ nhất. */
const MAX_TASK_FILES = 300

/** Tool chờ người dùng trả lời ngay trong terminal. */
const QUESTION_TOOLS = new Set(['AskUserQuestion'])

/**
 * Trạng thái kanban: việc của agent (lưu file trong dự án) + agent đang làm gì (chỉ trong bộ nhớ,
 * suy ra từ hook). Mọi thay đổi báo ra ngoài qua `notify(workspaceId)`.
 */
export class Board {
  private status = new Map<string, AgentStatus & { workspaceId: string }>()
  private lists = new Map<string, Promise<Task[]>>()
  private writing = new Map<string, Promise<void>>()
  private ignored = new Set<string>()
  private pending = new Map<string, NodeJS.Timeout>()
  /** Lần cuối người dùng gửi lời nhắn cho agent (ms, theo hook UserPromptSubmit). */
  private prompted = new Map<string, number>()
  /** Câu hỏi khoá phạm vi đang chờ người dùng (agent Codex, xem scopeGuard.ts). */
  private asks = new Map<string, { ask: ScopeAsk; workspaceId: string; done: (allow: boolean) => void }>()

  constructor(private notify: (workspaceId: string) => void) {}

  // ---- hoạt động của agent ----

  setActivity(agent: Agent, activity: AgentActivity, extra: { reason?: WaitReason; tool?: string } = {}): void {
    const cur = this.status.get(agent.id)
    if (cur && cur.activity === activity && cur.reason === extra.reason && cur.tool === extra.tool) return
    this.status.set(agent.id, {
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      activity,
      reason: activity === 'waiting' ? extra.reason : undefined,
      tool: activity === 'working' ? extra.tool : undefined,
      since: cur?.activity === activity ? cur.since : new Date().toISOString(),
      // Độ dài context thuộc về phiên: phiên đóng thì bỏ (phiên sau đo lại từ đầu).
      context: activity === 'stopped' || activity === 'starting' ? undefined : cur?.context,
      handoff: cur?.handoff
    })
    this.notifySoon(agent.workspaceId)
  }

  /** Trạng thái hiện tại của agent (chỉ đọc). */
  statusOf(agentId: string): AgentStatus | undefined {
    return this.status.get(agentId)
  }

  /** Độ dài context mới của phiên đang chạy. Agent chưa có trạng thái (phiên chưa mở) thì bỏ qua. */
  setContext(agent: Agent, context: ContextUsage | undefined): void {
    const cur = this.status.get(agent.id)
    if (!cur || cur.activity === 'stopped' || cur.context === context) return
    this.status.set(agent.id, { ...cur, context })
    this.notifySoon(agent.workspaceId)
  }

  setHandoff(agent: Agent, handoff: HandoffState | undefined): void {
    const cur = this.status.get(agent.id)
    if (!cur || cur.handoff === handoff) return
    this.status.set(agent.id, { ...cur, handoff })
    this.notifySoon(agent.workspaceId)
  }

  /** Đổi sự kiện hook thành trạng thái. Sự kiện không liên quan thì bỏ qua. */
  hook(agent: Agent, p: HookPayload): void {
    switch (p.hook_event_name) {
      case 'UserPromptSubmit':
        this.prompted.set(agent.id, Date.now())
        return this.setActivity(agent, 'working')
      case 'PostToolUse':
        return this.setActivity(agent, 'working')
      case 'PreToolUse':
        if (p.tool_name && QUESTION_TOOLS.has(p.tool_name)) return this.setActivity(agent, 'waiting', { reason: 'question' })
        return this.setActivity(agent, 'working', { tool: p.tool_name })
      case 'PermissionRequest':
        return this.setActivity(agent, 'waiting', { reason: 'permission' })
      case 'Notification':
        if (p.notification_type === 'permission_prompt') return this.setActivity(agent, 'waiting', { reason: 'permission' })
        if (p.notification_type === 'elicitation_dialog' || p.notification_type === 'agent_needs_input')
          return this.setActivity(agent, 'waiting', { reason: 'question' })
        // idle_prompt: đã ở trạng thái chờ từ lúc Stop, chỉ đánh dấu là lâu rồi chưa ai trả lời.
        // Giữ nhãn "bạn đã ngắt": cho biết vì sao agent dừng, có ích hơn "chờ lâu".
        if (p.notification_type === 'idle_prompt') {
          const cur = this.status.get(agent.id)
          if (cur?.activity === 'waiting' && cur.reason !== 'interrupted')
            return this.setActivity(agent, 'waiting', { reason: 'idle' })
        }
        return
      case 'Stop':
        return this.setActivity(agent, 'waiting', { reason: 'turn' })
      // Codex: người dùng bấm Esc giữa lượt (Claude Code không có sự kiện này, xem transcript.ts).
      case 'Interrupt':
        return this.interrupted(agent, new Date().toISOString())
    }
  }

  /**
   * Người dùng bấm Esc ngắt agent (thấy trong transcript, Claude Code không bắn hook Stop lúc này).
   * `at` = thời điểm ghi dòng ngắt. Transcript được đọc chậm hơn hook một chút: nếu người dùng đã gửi
   * lời nhắn mới sau lúc ngắt thì agent đang làm tiếp, bỏ qua.
   */
  interrupted(agent: Agent, at: string): void {
    const cur = this.status.get(agent.id)
    if (!cur || cur.activity === 'stopped') return
    const t = Date.parse(at)
    if (Number.isFinite(t) && (this.prompted.get(agent.id) ?? 0) > t) return
    this.setActivity(agent, 'waiting', { reason: 'interrupted' })
  }

  forget(agentId: string): void {
    this.prompted.delete(agentId)
    const cur = this.status.get(agentId)
    if (!cur) return
    this.status.delete(agentId)
    this.notifySoon(cur.workspaceId)
  }

  /** Hook tới dồn dập (mỗi tool một lần): gộp lại rồi mới báo giao diện. */
  private notifySoon(workspaceId: string): void {
    if (this.pending.has(workspaceId)) return
    this.pending.set(
      workspaceId,
      setTimeout(() => {
        this.pending.delete(workspaceId)
        this.notify(workspaceId)
      }, 120)
    )
  }

  // ---- việc (task) ----

  private file(ws: Workspace): string {
    return join(ws.path, '.stag', 'tasks.json')
  }

  private tasks(ws: Workspace): Promise<Task[]> {
    let list = this.lists.get(ws.id)
    if (!list) {
      list = this.read(ws)
      this.lists.set(ws.id, list)
      // Đọc lỗi thì bỏ khỏi cache để lần sau đọc lại, không giữ mãi promise lỗi.
      const failed = list
      failed.catch(() => {
        if (this.lists.get(ws.id) === failed) this.lists.delete(ws.id)
      })
    }
    return list
  }

  private async read(ws: Workspace): Promise<Task[]> {
    const file = this.file(ws)
    const raw = await readText(file)
    if (!raw) return []
    let data: Partial<TasksFile> | null = null
    try {
      data = JSON.parse(raw) as Partial<TasksFile> | null
    } catch {
      data = null
    }
    if (data && typeof data === 'object' && Array.isArray(data.tasks)) return data.tasks
    // File hỏng (không phải JSON, hoặc JSON nhưng thiếu mảng `tasks`): cất sang bên cạnh để lần ghi sau
    // không đè mất lịch sử, rồi bắt đầu danh sách mới. Không cất được thì báo lỗi, không ghi đè.
    const aside = `${file}.broken-${Date.now()}`
    try {
      await fs.rename(file, aside)
    } catch (e) {
      throw new Error(`File kanban ${file} bị hỏng và không cất sang ${aside} được: ${(e as Error).message}`)
    }
    return []
  }

  private async save(ws: Workspace): Promise<void> {
    const list = await this.tasks(ws)
    const file = this.file(ws)
    const prev = this.writing.get(ws.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      await fs.mkdir(dirname(file), { recursive: true })
      if (!this.ignored.has(ws.id)) {
        await ensureIgnored(ws.path, ['.stag/'], 'stag.ai kanban data')
        this.ignored.add(ws.id)
      }
      const data: TasksFile = { version: 1, tasks: list }
      await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(`${file}.tmp`, file)
    })
    this.writing.set(
      ws.id,
      next.catch(() => {})
    )
    await next
    this.notify(ws.id)
  }

  async snapshot(ws: Workspace): Promise<BoardSnapshot> {
    const statuses = [...this.status.values()]
      .filter((s) => s.workspaceId === ws.id)
      .map(({ workspaceId: _ws, ...s }) => s)
    const scopeAsks = [...this.asks.values()].filter((a) => a.workspaceId === ws.id).map((a) => a.ask)
    return { statuses, tasks: await this.tasks(ws), scopeAsks }
  }

  async openTask(ws: Workspace, agentId: string): Promise<Task | undefined> {
    return (await this.tasks(ws)).find((t) => t.agentId === agentId && t.status === 'open')
  }

  async startTask(ws: Workspace, agent: Agent, sessionId: string, title: string, scope: string): Promise<Task> {
    const open = await this.openTask(ws, agent.id)
    if (open)
      throw new Error(
        `You still have an unfinished task: "${open.title}". Call task_done for it first, or task_update if you only change the title/scope.`
      )
    const task: Task = {
      id: randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      sessionId,
      title: title.trim(),
      scope: scope.trim(),
      status: 'open',
      createdAt: new Date().toISOString()
    }
    ;(await this.tasks(ws)).push(task)
    await this.save(ws)
    return task
  }

  async updateTask(ws: Workspace, agentId: string, change: { title?: string; scope?: string }): Promise<Task> {
    const task = await this.openTask(ws, agentId)
    if (!task) throw new Error('You have no open task. Call task_start first.')
    if (change.title?.trim()) task.title = change.title.trim()
    if (change.scope?.trim()) task.scope = change.scope.trim()
    await this.save(ws)
    return task
  }

  /** Ghi các file agent vừa sửa vào việc đang mở của nó (thành một phần vùng khoá). */
  async touch(ws: Workspace, agentId: string, files: string[]): Promise<void> {
    const task = await this.openTask(ws, agentId)
    if (!task) return
    const list = task.files ?? []
    const fresh = files.filter((f) => !list.some((x) => x.toLowerCase() === f.toLowerCase()))
    if (!fresh.length) return
    task.files = [...list, ...fresh].slice(-MAX_TASK_FILES)
    await this.save(ws)
  }

  // ---- khoá phạm vi: hỏi người dùng thay cho agent Codex ----

  /**
   * Hỏi người dùng có cho agent sửa file trong vùng khoá của agent khác. Trong lúc chờ, thẻ agent hiện
   * "cần duyệt quyền". Hết hạn (SCOPE_ASK_MS) hoặc phiên đóng → từ chối.
   */
  askScope(ws: Workspace, agent: Agent, q: Pick<ScopeAsk, 'file' | 'command' | 'holder'>, timeoutMs = 280_000): Promise<boolean> {
    const ask: ScopeAsk = {
      id: randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      ...q,
      until: new Date(Date.now() + timeoutMs).toISOString()
    }
    const before = this.status.get(agent.id)
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.answerScope(ask.id, false), timeoutMs)
      this.asks.set(ask.id, {
        ask,
        workspaceId: ws.id,
        done: (allow) => {
          clearTimeout(timer)
          this.asks.delete(ask.id)
          // Trả lời xong: agent làm tiếp (nếu trạng thái vẫn là lúc hỏi).
          const cur = this.status.get(agent.id)
          if (cur?.activity === 'waiting' && cur.reason === 'permission') this.setActivity(agent, 'working', { tool: before?.tool })
          this.notifySoon(ws.id)
          resolve(allow)
        }
      })
      this.setActivity(agent, 'waiting', { reason: 'permission' })
      this.notifySoon(ws.id)
    })
  }

  answerScope(askId: string, allow: boolean): void {
    this.asks.get(askId)?.done(allow)
  }

  cancelScopeAsks(agentId: string): void {
    for (const a of [...this.asks.values()]) if (a.ask.agentId === agentId) a.done(false)
  }

  /** Agent báo xong việc đang mở của mình. */
  async finishTask(ws: Workspace, agentId: string, summary: string): Promise<Task> {
    const task = await this.openTask(ws, agentId)
    if (!task) throw new Error('You have no open task. Call task_start when you take a new task.')
    task.status = 'done'
    task.doneAt = new Date().toISOString()
    task.summary = summary.trim()
    await this.save(ws)
    return task
  }

  /** Người dùng đánh dấu xong / bỏ thẻ bằng tay. */
  async closeTask(ws: Workspace, taskId: string, status: 'done' | 'dropped'): Promise<Task | undefined> {
    const task = (await this.tasks(ws)).find((t) => t.id === taskId && t.status === 'open')
    if (!task) return undefined
    task.status = status
    task.doneAt = new Date().toISOString()
    task.manual = true
    await this.save(ws)
    return task
  }

  /** Agent bị xoá: việc đang mở của nó thành "bỏ". Lịch sử việc xong giữ nguyên. */
  async dropAgentTasks(ws: Workspace, agentId: string): Promise<void> {
    const open = await this.openTask(ws, agentId)
    if (open) await this.closeTask(ws, open.id, 'dropped')
  }

  forgetWorkspace(workspaceId: string): void {
    this.lists.delete(workspaceId)
    this.ignored.delete(workspaceId)
    for (const [id, s] of this.status) if (s.workspaceId === workspaceId) this.status.delete(id)
  }

  /** Agent đổi tên: thẻ việc của nó (cả lịch sử đã xong) hiện tên mới. */
  async renameAgent(ws: Workspace, agentId: string, name: string): Promise<void> {
    const mine = (await this.tasks(ws)).filter((t) => t.agentId === agentId && t.agentName !== name)
    if (!mine.length) return
    for (const t of mine) t.agentName = name
    await this.save(ws)
  }
}
