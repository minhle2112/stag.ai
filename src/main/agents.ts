import { randomUUID } from 'node:crypto'
import { promises as fs, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { app, type WebContents } from 'electron'
import type { Agent, AgentRun, AgentsSnapshot, CreateAgentRequest, LayoutNode, StartAgentRequest } from '@shared/types'
import { exists, readText, today, writeIfMissing } from './fsutil'
import type { PtyManager } from './pty'
import { readTemplate } from './templates'
import { ensureIgnored, safeName, type WorkspaceStore } from './workspace'

interface StoreFile {
  agents: Agent[]
  layouts: Record<string, LayoutNode | null>
}

interface Running extends AgentRun {
  sessionFile: string
}

/**
 * Tìm file chạy thật của Claude Code. Gọi thẳng claude.exe thay vì claude.cmd để tham số
 * (luật phiên nhiều dòng, tiếng Việt) không phải đi qua cách tách tham số của cmd.exe.
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

  constructor(
    private ptys: PtyManager,
    private workspaces: WorkspaceStore
  ) {}

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
      .map(({ agentId, sessionId, ptyId, startedAt }) => ({ agentId, sessionId, ptyId, startedAt }))
    return { agents, layout: this.data.layouts[workspaceId] ?? null, running }
  }

  async create(req: CreateAgentRequest): Promise<Agent> {
    if (!this.workspaces.get(req.workspaceId)) throw new Error('Workspace không tồn tại')
    const name = safeName(req.name)
    if (!name) throw new Error('Agent cần có tên')
    const taken = this.data.agents.some((a) => a.workspaceId === req.workspaceId && a.name.toLowerCase() === name.toLowerCase())
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
    if (existing) return existing
    const ws = this.workspaces.get(agent.workspaceId)
    if (!ws) throw new Error('Workspace của agent không còn trong app')

    const exe = await resolveClaude()
    const resume = req.resume && !!agent.lastSessionId
    const sessionId = resume ? agent.lastSessionId! : randomUUID()
    const sessionFile = join(ws.path, '.sessions', `${sessionId}.md`)
    const agentNote = join(ws.vaultPath, '60 Agents', `${agent.name}.md`)
    const structured = await exists(join(ws.vaultPath, '_INDEX.md'))
    const vars: Record<string, string> = {
      AGENT: agent.name,
      ROLE: agent.role,
      ROLE_SUFFIX: agent.role ? ` (vai trò: ${agent.role})` : '',
      ROLE_LINE: agent.role || '_(chưa ghi vai trò)_',
      WORKSPACE: ws.name,
      PROJECT_PATH: ws.path,
      VAULT_PATH: ws.vaultPath,
      SESSION_ID: sessionId,
      SESSION_FILE: sessionFile,
      AGENT_NOTE: agentNote,
      RECALL: structured ? `đọc ${join(ws.vaultPath, '_INDEX.md')}` : 'tìm và đọc các note liên quan trong vault',
      DATE: today(),
      NOW: new Date().toISOString()
    }

    await writeIfMissing(sessionFile, await readTemplate('agent/session.md', vars))
    await writeIfMissing(agentNote, await readTemplate('agent/agent-note.md', vars))
    await ensureIgnored(ws.path, ['.sessions/'], 'Phiên agent của stag.ai')

    const args = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
    args.push('--name', agent.name, '--append-system-prompt', await readTemplate('agent/rules.md', vars))
    if (agent.permissionMode !== 'default') args.push('--permission-mode', agent.permissionMode)
    if (!resume) args.push('Bắt đầu phiên mới.')

    const ptyId = this.ptys.spawn(
      owner,
      { command: exe, args, cwd: ws.path, cols: req.cols, rows: req.rows },
      {
        env: { STAG_AGENT_ID: agent.id, STAG_AGENT_NAME: agent.name, STAG_SESSION_ID: sessionId, STAG_WORKSPACE: ws.path },
        filterEnv: independentSessionEnv,
        onExit: () => this.finish(agent.id, ptyId)
      }
    )
    const run: Running = { agentId: agent.id, sessionId, ptyId, startedAt: new Date().toISOString(), sessionFile }
    this.running.set(agent.id, run)
    agent.lastSessionId = sessionId
    await this.save()
    return run
  }

  /** Phiên kết thúc (agent tự thoát hoặc bị dừng): xoá file phiên. */
  private finish(agentId: string, ptyId: string): void {
    const run = this.running.get(agentId)
    if (!run || run.ptyId !== ptyId) return
    this.running.delete(agentId)
    rmSync(run.sessionFile, { force: true })
  }

  stop(agentId: string): void {
    const run = this.running.get(agentId)
    if (run) this.ptys.kill(run.ptyId)
  }

  /** Bỏ agent khỏi workspace. Note bộ nhớ trong vault được giữ lại. */
  async remove(agentId: string): Promise<void> {
    this.stop(agentId)
    this.data.agents = this.data.agents.filter((a) => a.id !== agentId)
    await this.save()
  }

  /** Workspace bị bỏ khỏi app: dừng và bỏ mọi agent của nó (note trong vault giữ nguyên). */
  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const a of this.data.agents) if (a.workspaceId === workspaceId) this.stop(a.id)
    this.data.agents = this.data.agents.filter((a) => a.workspaceId !== workspaceId)
    delete this.data.layouts[workspaceId]
    await this.save()
  }

  async saveLayout(workspaceId: string, layout: LayoutNode | null): Promise<void> {
    this.data.layouts[workspaceId] = layout
    await this.save()
  }

  /** Thoát app: dừng mọi phiên và xoá file phiên ngay (không chờ sự kiện thoát). */
  shutdown(): void {
    for (const run of this.running.values()) {
      this.ptys.kill(run.ptyId)
      rmSync(run.sessionFile, { force: true })
    }
    this.running.clear()
  }
}
