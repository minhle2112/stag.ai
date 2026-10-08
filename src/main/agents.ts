import { randomUUID } from 'node:crypto'
import { promises as fs, rmSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { app, shell, type WebContents } from 'electron'
import type { Agent, AgentRun, AgentsSnapshot, CreateAgentRequest, LayoutNode, StartAgentRequest, Task, Workspace } from '@shared/types'
import type { Board, HookPayload } from './board'
import type { BrowserService } from './browser'
import { exists, readText, today, writeIfMissing } from './fsutil'
import type { StatusHub } from './hub'
import { createStagMcp } from './mcp'
import type { PtyManager } from './pty'
import { readTemplate } from './templates'
import { TranscriptWatcher, transcriptPath } from './transcript'
import { ensureIgnored, type WorkspaceStore } from './workspace'
import { agentNameProblem, sameAgentName } from '@shared/agentName'

interface StoreFile {
  agents: Agent[]
  layouts: Record<string, LayoutNode | null>
}

interface Running extends AgentRun {
  sessionFile: string
  /** Biến template của phiên, để ghi lại file phiên khi việc đổi. */
  vars: Record<string, string>
  /** Theo dõi transcript để biết người dùng bấm Esc ngắt (Claude Code không có hook cho việc này). */
  transcript: TranscriptWatcher
}

/**
 * Tìm file chạy thật của Claude Code. Gọi thẳng claude.exe thay vì claude.cmd để tham số
 * (luật phiên nhiều dòng, có thể chứa chữ ngoài ASCII) không phải đi qua cách tách tham số của cmd.exe.
 */
async function resolveClaude(): Promise<string> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const exe = join(dir, 'claude.exe')
    if (await exists(exe)) return exe
  }
  for (const dir of dirs) {
    const shim = await readText(join(dir, 'claude.cmd'))
    const target = shim && /"%dp0%\\?([^"]+?\.exe)"/i.exec(shim)
    if (target && (await exists(join(dir, target[1])))) return join(dir, target[1])
  }
  throw new Error('Không tìm thấy Claude Code (claude) trong PATH. Cài bằng: npm install -g @anthropic-ai/claude-code')
}

/** Phần gửi được qua IPC (Running còn giữ watcher, biến template… chỉ dùng trong main). */
function publicRun({ agentId, sessionId, ptyId, startedAt }: Running): AgentRun {
  return { agentId, sessionId, ptyId, startedAt }
}

/** Biến cấu hình Claude Code của người dùng — luôn giữ. */
const USER_CLAUDE_CONFIG = /^CLAUDE_CODE_(USE_|MAX_OUTPUT_TOKENS|GIT_BASH_PATH|SHELL|DISABLE_NONESSENTIAL|SKIP_)/

/**
 * Nếu stag.ai được mở từ bên trong một phiên Claude Code (vd. terminal của Claude desktop), môi trường
 * mang dấu "phiên con" (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, token/socket của host…). Agent kế thừa
 * những biến này sẽ tưởng mình là phiên con và tắt lưu transcript (hỏng "tiếp tục phiên trước").
 * Agent của stag.ai là phiên độc lập, nên bỏ các biến đó, giữ biến cấu hình của người dùng.
 */
export function independentSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.CLAUDECODE && !env.CLAUDE_CODE_CHILD_SESSION) return env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const hostMarker =
      /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)$/.test(key) ||
      /^(CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)/.test(key) ||
      (key.startsWith('CLAUDE_CODE_') && !USER_CLAUDE_CONFIG.test(key))
    if (!hostMarker) out[key] = value
  }
  return out
}

export class AgentService {
  private file = join(app.getPath('userData'), 'agents.json')
  private data: StoreFile = { agents: [], layouts: {} }
  private running = new Map<string, Running>()

  private hub: StatusHub | null = null

  constructor(
    private ptys: PtyManager,
    private workspaces: WorkspaceStore,
    private board: Board,
    private browser: BrowserService
  ) {}

  /** Gắn máy chủ trạng thái (hook + MCP) sau khi nó đã chạy. */
  attachHub(hub: StatusHub): void {
    this.hub = hub
  }

  async load(): Promise<void> {
    const raw = await readText(this.file)
    if (raw) this.data = JSON.parse(raw) as StoreFile
    // Lúc khởi động chưa phiên nào chạy: file phiên còn lại là do app bị tắt đột ngột (crash, kill).
    for (const agent of this.data.agents) {
      const ws = this.workspaces.get(agent.workspaceId)
      if (ws && agent.lastSessionId) rmSync(join(ws.path, '.sessions', `${agent.lastSessionId}.md`), { force: true })
    }
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8')
  }

  snapshot(workspaceId: string): AgentsSnapshot {
    const agents = this.data.agents.filter((a) => a.workspaceId === workspaceId)
    const running = [...this.running.values()]
      .filter((r) => agents.some((a) => a.id === r.agentId))
      .map(publicRun)
    return { agents, layout: this.data.layouts[workspaceId] ?? null, running }
  }

  async create(req: CreateAgentRequest): Promise<Agent> {
    if (!this.workspaces.get(req.workspaceId)) throw new Error('Workspace không tồn tại')
    const name = req.name.trim()
    const problem = agentNameProblem(name)
    if (problem) throw new Error(problem)
    const taken = this.data.agents.some((a) => a.workspaceId === req.workspaceId && sameAgentName(a.name, name))
    if (taken) throw new Error(`Đã có agent tên "${name}" trong workspace này`)
    const agent: Agent = {
      id: randomUUID(),
      workspaceId: req.workspaceId,
      name,
      role: req.role.trim(),
      permissionMode: req.permissionMode,
      createdAt: new Date().toISOString()
    }
    this.data.agents.push(agent)
    await this.save()
    return agent
  }

  /** Mở một phiên Claude Code cho agent trong terminal thật. */
  async start(owner: WebContents, req: StartAgentRequest): Promise<AgentRun> {
    const agent = this.data.agents.find((a) => a.id === req.agentId)
    if (!agent) throw new Error('Agent không tồn tại')
    const existing = this.running.get(agent.id)
    if (existing) return publicRun(existing)
    const ws = this.workspaces.get(agent.workspaceId)
    if (!ws) throw new Error('Workspace của agent không còn trong app')

    if (!this.hub) throw new Error('Máy chủ trạng thái của app chưa sẵn sàng')
    const exe = await resolveClaude()
    const resume = req.resume && !!agent.lastSessionId
    const open = await this.board.openTask(ws, agent.id)
    const sessionId = resume ? agent.lastSessionId! : randomUUID()
    const sessionFile = join(ws.path, '.sessions', `${sessionId}.md`)
    const agentNote = join(ws.vaultPath, '60 Agents', `${agent.name}.md`)
    const structured = await exists(join(ws.vaultPath, '_INDEX.md'))
    const vars: Record<string, string> = {
      AGENT: agent.name,
      ROLE: agent.role,
      ROLE_SUFFIX: agent.role ? ` (role: ${agent.role})` : '',
      ROLE_LINE: agent.role || '_(no role set)_',
      WORKSPACE: ws.name,
      PROJECT_PATH: ws.path,
      VAULT_PATH: ws.vaultPath,
      SESSION_ID: sessionId,
      SESSION_FILE: sessionFile,
      AGENT_NOTE: agentNote,
      RECALL: structured ? `read ${join(ws.vaultPath, '_INDEX.md')}` : 'find and read the related notes in the vault',
      OPENING: open
        ? `You have unfinished work: "${open.title}" (scope: ${open.scope}). Greet briefly, mention it and ask the user whether to continue. If continuing, no need to call task_start again; if not, call task_done with a summary of what was done, then ask what they want help with in this workspace.`
        : 'Greet briefly and ask the user what they want you to help with in this workspace. Do nothing else until the user answers.',
      USER_LANGUAGE: userLanguage(),
      DATE: today(),
      NOW: new Date().toISOString()
    }

    await this.writeSessionFile(sessionFile, vars, open)
    await writeIfMissing(agentNote, await readTemplate('agent/agent-note.md', vars))
    await ensureIgnored(ws.path, ['.sessions/'], 'stag.ai agent sessions')

    const args = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    args.push('--name', agent.name, '--append-system-prompt', await readTemplate('agent/rules.md', vars))
    args.push(...this.hub.claudeArgs())
    if (agent.permissionMode !== 'default') args.push('--permission-mode', agent.permissionMode)
    // `--` trước lời mở: `--mcp-config` nhận nhiều giá trị, không chặn lại thì nuốt luôn lời mở làm tên file.
    if (!resume) args.push('--', 'Start a new session.')

    const ptyId = this.ptys.spawn(
      owner,
      { command: exe, args, cwd: ws.path, cols: req.cols, rows: req.rows },
      {
        env: {
          ...this.hub.env(),
          STAG_AGENT_ID: agent.id,
          STAG_AGENT_NAME: agent.name,
          STAG_SESSION_ID: sessionId,
          STAG_WORKSPACE: ws.path
        },
        filterEnv: independentSessionEnv,
        onExit: () => this.finish(agent.id, ptyId)
      }
    )
    // Chỉ đọc phần ghi từ lúc này: `--resume` giữ nguyên transcript cũ, trong đó có thể đã có dòng ngắt
    // của lần trước. (Mở chỉ tốn một lần stat, xong trước khi claude kịp khởi động.)
    const transcript = TranscriptWatcher.open(transcriptPath(ws.path, sessionId), (i) =>
      this.onInterrupt(agent.id, ptyId, i.at)
    )
    const run: Running = {
      agentId: agent.id,
      sessionId,
      ptyId,
      startedAt: new Date().toISOString(),
      sessionFile,
      vars,
      transcript
    }
    this.running.set(agent.id, run)
    // Phiên mới: chờ hook đầu tiên (lời mở đầu). Tiếp tục phiên: Claude Code đứng chờ người dùng gõ.
    if (resume) this.board.setActivity(agent, 'waiting', { reason: 'turn' })
    else this.board.setActivity(agent, 'starting')
    agent.lastSessionId = sessionId
    await this.save()
    return publicRun(run)
  }

  /** Phiên kết thúc (agent tự thoát hoặc bị dừng): xoá file phiên. */
  private finish(agentId: string, ptyId: string): void {
    const run = this.running.get(agentId)
    if (!run || run.ptyId !== ptyId) return
    this.running.delete(agentId)
    run.transcript.stop()
    rmSync(run.sessionFile, { force: true })
    const agent = this.data.agents.find((a) => a.id === agentId)
    if (agent) this.board.setActivity(agent, 'stopped')
  }

  /** File phiên phản ánh việc đang mở (hoặc việc vừa xong) của agent. */
  private async writeSessionFile(file: string, vars: Record<string, string>, task: Task | undefined): Promise<void> {
    const content = await readTemplate('agent/session.md', {
      ...vars,
      STATUS: !task ? 'asking' : task.status === 'open' ? 'working' : 'done',
      TASK: task?.title ?? '_(not known yet — the agent is asking the user)_',
      SCOPE: task?.scope ?? '_(folders/files the agent may edit)_',
      HANDOFF: task?.summary ?? ''
    })
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, content, 'utf8')
  }

  private context(agentId: string): { agent: Agent; ws: Workspace; run?: Running } | null {
    const agent = this.data.agents.find((a) => a.id === agentId)
    const ws = agent && this.workspaces.get(agent.workspaceId)
    return agent && ws ? { agent, ws, run: this.running.get(agentId) } : null
  }

  /** Hook từ phiên Claude Code của agent. Hook tới muộn sau khi phiên đã đóng thì bỏ qua. */
  onHook(agentId: string, payload: HookPayload): void {
    const ctx = this.context(agentId)
    if (!ctx?.run) return
    // Đường dẫn transcript thật (đoán sai lúc mở, hoặc /clear sang phiên mới) → theo file đó.
    if (payload.transcript_path) void ctx.run.transcript.follow(payload.transcript_path)
    this.board.hook(ctx.agent, payload)
  }

  /** Transcript có dòng "người dùng ngắt" của đúng phiên đang chạy. */
  private onInterrupt(agentId: string, ptyId: string, at: string): void {
    const ctx = this.context(agentId)
    if (ctx?.run?.ptyId === ptyId) this.board.interrupted(ctx.agent, at)
  }

  /** Máy chủ MCP "stag" cho agent đang gọi. */
  mcpFor(agentId: string): ReturnType<typeof createStagMcp> | null {
    const ctx = this.context(agentId)
    if (!ctx) return null
    const { agent, ws, run } = ctx
    return createStagMcp({
      agent,
      workspace: ws,
      sessionId: run?.sessionId,
      board: this.board,
      browser: this.browser,
      teammates: () =>
        this.data.agents.filter((a) => a.workspaceId === ws.id).map((a) => ({ agent: a, running: this.running.has(a.id) })),
      syncSessionFile: async () => {
        const cur = this.running.get(agent.id)
        if (!cur) return
        const tasks = (await this.board.snapshot(ws)).tasks.filter((t) => t.agentId === agent.id)
        // Việc đang mở; không có thì việc vừa xong trong phiên này (để giữ phần Bàn giao).
        const task =
          tasks.find((t) => t.status === 'open') ??
          tasks.filter((t) => t.sessionId === cur.sessionId && t.status === 'done').at(-1)
        await this.writeSessionFile(cur.sessionFile, cur.vars, task)
      }
    })
  }

  stop(agentId: string): void {
    const run = this.running.get(agentId)
    if (run) this.ptys.kill(run.ptyId)
  }

  /**
   * Xoá agent: dừng phiên, chuyển note bộ nhớ `60 Agents/<tên>.md` vào Thùng rác (khôi phục được),
   * bỏ thẻ việc đang dở. Lịch sử việc đã xong trên kanban được giữ.
   */
  async remove(agentId: string): Promise<void> {
    const ctx = this.context(agentId)
    if (ctx) {
      // Chuyển note trước: không chuyển được (bị khoá…) thì báo lỗi và chưa xoá gì cả.
      const note = join(ctx.ws.vaultPath, '60 Agents', `${ctx.agent.name}.md`)
      if (await exists(note)) {
        try {
          await shell.trashItem(note)
        } catch (e) {
          throw new Error(`Không chuyển được note ${note} vào Thùng rác: ${(e as Error).message}`)
        }
      }
    }
    this.stop(agentId)
    if (ctx) await this.board.dropAgentTasks(ctx.ws, agentId)
    this.board.forget(agentId)
    this.browser.closeAgentTabs(agentId)
    this.data.agents = this.data.agents.filter((a) => a.id !== agentId)
    await this.save()
  }

  /** Workspace bị bỏ khỏi app: dừng và bỏ mọi agent của nó (note trong vault giữ nguyên). */
  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const a of this.data.agents) if (a.workspaceId === workspaceId) this.stop(a.id)
    this.data.agents = this.data.agents.filter((a) => a.workspaceId !== workspaceId)
    delete this.data.layouts[workspaceId]
    this.board.forgetWorkspace(workspaceId)
    this.browser.closeWorkspace(workspaceId)
    await this.save()
  }

  async saveLayout(workspaceId: string, layout: LayoutNode | null): Promise<void> {
    this.data.layouts[workspaceId] = layout
    await this.save()
  }

  /** Thoát app: dừng mọi phiên và xoá file phiên ngay (không chờ sự kiện thoát). */
  shutdown(): void {
    for (const run of this.running.values()) {
      run.transcript.stop()
      this.ptys.kill(run.ptyId)
      rmSync(run.sessionFile, { force: true })
    }
    this.running.clear()
  }

  /**
   * Đổi tên agent: đổi tên note `60 Agents/<tên cũ>.md` → `<tên mới>.md` trong vault (nếu có),
   * rồi cập nhật agents.json, tên trên thẻ việc, nhãn tab browser và file phiên đang mở.
   * Không sửa wikilink trỏ tới note cũ trong các note khác.
   * Phiên đang chạy giữ tên cũ (`--name`, STAG_AGENT_NAME, luật phiên) tới phiên sau.
   */
  async rename(agentId: string, rawName: string): Promise<Agent> {
    const agent = this.data.agents.find((a) => a.id === agentId)
    if (!agent) throw new Error('Agent không tồn tại')
    const name = rawName.trim()
    const problem = agentNameProblem(name)
    if (problem) throw new Error(problem)
    if (name === agent.name) return agent
    const taken = this.data.agents.some((a) => a.id !== agent.id && a.workspaceId === agent.workspaceId && sameAgentName(a.name, name))
    if (taken) throw new Error(`Đã có agent tên "${name}" trong workspace này`)

    const ws = this.workspaces.get(agent.workspaceId)
    if (ws) {
      const dir = join(ws.vaultPath, '60 Agents')
      const from = join(dir, `${agent.name}.md`)
      const to = join(dir, `${name}.md`)
      // Chỉ đổi hoa/thường: trên Windows hai đường dẫn là một file, không coi là "đã tồn tại".
      if (!sameAgentName(agent.name, name) && (await exists(to)))
        throw new Error(`Trong vault đã có note ${to}. Đổi tên note đó trước, hoặc chọn tên khác. Chưa đổi gì cả.`)
      if (await exists(from)) {
        try {
          await fs.rename(from, to)
        } catch (e) {
          throw new Error(`Không đổi tên được note ${from}: ${(e as Error).message}. Chưa đổi gì cả.`)
        }
        // Tiêu đề note theo template là "# <tên agent>": đổi theo nếu còn đúng như cũ.
        const text = await readText(to)
        const heading = `# ${agent.name}`
        if (text && text.split(/\r?\n/).includes(heading))
          await fs.writeFile(to, text.replace(new RegExp(`^${escapeRegExp(heading)}$`, 'm'), () => `# ${name}`), 'utf8')
      }
    }

    agent.name = name
    await this.save()
    if (ws) await this.board.renameAgent(ws, agent.id, name)
    this.browser.renameAgent(agent.id, name)
    // File phiên (agent khác đọc trong .sessions/) ghi tên mới và đường dẫn note mới.
    const run = this.running.get(agent.id)
    if (run && ws) {
      run.vars = { ...run.vars, AGENT: name, AGENT_NOTE: join(ws.vaultPath, '60 Agents', `${name}.md`) }
      const tasks = (await this.board.snapshot(ws)).tasks.filter((t) => t.agentId === agent.id)
      const task =
        tasks.find((t) => t.status === 'open') ?? tasks.filter((t) => t.sessionId === run.sessionId && t.status === 'done').at(-1)
      await this.writeSessionFile(run.sessionFile, run.vars, task)
    }
    return agent
  }

  /** Sắp xếp lại agent của một workspace theo `orderedIds` (thứ tự ở thanh bên). Agent workspace khác giữ nguyên chỗ. */
  async reorder(workspaceId: string, orderedIds: string[]): Promise<void> {
    const mine = this.data.agents.filter((a) => a.workspaceId === workspaceId)
    const rank = (a: Agent): number => {
      const i = orderedIds.indexOf(a.id)
      return i === -1 ? orderedIds.length + mine.indexOf(a) : i
    }
    const sorted = [...mine].sort((x, y) => rank(x) - rank(y))
    let k = 0
    this.data.agents = this.data.agents.map((a) => (a.workspaceId === workspaceId ? sorted[k++] : a))
    await this.save()
  }
}

/**
 * Ngôn ngữ hệ thống của người dùng, vd. "English (en-US)" — agent dùng cho câu hỏi mở phiên
 * (lúc người dùng chưa viết gì); sau đó agent theo ngôn ngữ người dùng viết hoặc CLAUDE.md của dự án.
 */
function userLanguage(): string {
  const tag = app.getPreferredSystemLanguages()[0] || app.getLocale() || 'en'
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag)
    return name && name !== tag ? `${name} (${tag})` : tag
  } catch {
    return tag
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
