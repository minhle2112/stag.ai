import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Agent, AgentActivity, AgentStatus, BoardSnapshot, Task, WaitReason, Workspace } from '@shared/types'
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
  notification_type?: string
}

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
      since: cur?.activity === activity ? cur.since : new Date().toISOString()
    })
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
    }
    return list
  }

  private async read(ws: Workspace): Promise<Task[]> {
    const file = this.file(ws)
    const raw = await readText(file)
    if (!raw) return []
    try {
      const data = JSON.parse(raw) as TasksFile
      return Array.isArray(data.tasks) ? data.tasks : []
    } catch {
      // File hỏng: cất sang bên cạnh để không ghi đè mất lịch sử, bắt đầu danh sách mới.
      await fs.rename(file, `${file}.broken-${Date.now()}`)
      return []
    }
  }

  private async save(ws: Workspace): Promise<void> {
    const list = await this.tasks(ws)
    const file = this.file(ws)
    const prev = this.writing.get(ws.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      await fs.mkdir(dirname(file), { recursive: true })
      if (!this.ignored.has(ws.id)) {
        await ensureIgnored(ws.path, ['.stag/'], 'Dữ liệu kanban của stag.ai')
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
    return { statuses, tasks: await this.tasks(ws) }
  }

  async openTask(ws: Workspace, agentId: string): Promise<Task | undefined> {
    return (await this.tasks(ws)).find((t) => t.agentId === agentId && t.status === 'open')
  }

  async startTask(ws: Workspace, agent: Agent, sessionId: string, title: string, scope: string): Promise<Task> {
    const open = await this.openTask(ws, agent.id)
    if (open)
      throw new Error(
        `Bạn đang có việc chưa xong: "${open.title}". Gọi task_done cho việc đó trước, hoặc task_update nếu chỉ đổi tiêu đề/phạm vi.`
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
    if (!task) throw new Error('Bạn chưa có việc nào đang mở. Gọi task_start trước.')
    if (change.title?.trim()) task.title = change.title.trim()
    if (change.scope?.trim()) task.scope = change.scope.trim()
    await this.save(ws)
    return task
  }

  /** Agent báo xong việc đang mở của mình. */
  async finishTask(ws: Workspace, agentId: string, summary: string): Promise<Task> {
    const task = await this.openTask(ws, agentId)
    if (!task) throw new Error('Bạn chưa có việc nào đang mở. Gọi task_start khi nhận việc mới.')
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
}
