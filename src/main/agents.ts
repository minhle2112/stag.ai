import { randomUUID } from 'node:crypto'
import { promises as fs, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, BrowserWindow, shell, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import {
  agentApiRules,
  agentMessage,
  checkCreateInput,
  firstTaskOpening,
  isCliKind,
  MESSAGE_MAX,
  parsePermission,
  permissionAbove,
  ROLE_MAX,
  TASK_MAX,
  type AgentApiEvent,
  type AgentCreateDraft,
  type AgentCreatedEvent,
  type AgentCreateInput,
  type AgentRequestInput,
  type AgentTargetInfo,
  type AgentUpdateInput
} from '@shared/agentApi'
import {
  type Agent,
  type AgentRun,
  type AgentsSnapshot,
  agentKind,
  type CreateAgentRequest,
  type LayoutNode,
  type PermissionMode,
  type StartAgentRequest,
  type Task,
  type Workspace
} from '@shared/types'
import type { Board, HookPayload } from './board'
import type { BrowserService } from './browser'
import { ADAPTER_LABEL, independentSessionEnv, type AdapterService } from './adapters'
import { codexArgs, findCodexRollout, parseCodexContext } from './codex'
import { externalArgs, spawnSpec, type ExternalAdapterStore } from './externalAdapters'
import { claudeServers, claudeSettingsExtra, codexConfiguredServers, codexConnectorArgs, connectorEnv, resolveCommands } from './connectors'
import type { SecretStore } from './secrets'
import type { OAuthService } from './oauth'
import type { ApprovalQueue } from './approvals'
import { claudeSkillSettings, codexSkillArgs, scanClaudeSkills, skillInstructions, type SkillLibrary } from './skills'
import { reply as hookReply, type PreToolUseReply } from './scopeGuard'
import { contextPercent, findGitBash, handoffDue, handoffPrompt, mergeContext, parseStatusLine, userStatusLine } from './context'
import { exists, readText, today, writeIfMissing } from './fsutil'
import type { StatusHub } from './hub'
import { AgentMail, mailReady } from './agentMail'
import { AgentRequestQueue, type AgentRequestAnswer } from './agentRequests'
import { createStagMcp, type AdapterInfo, type AgentInfo, type ExtraTool } from './mcp'
import { browserToolsOn } from '@shared/settings'
import { ScopeGuard } from './scopeGuard'
import type { ArtifactLog } from './artifacts'
import type { VaultActivityLog } from './vaultActivity'
import type { PtyManager } from './pty'
import type { SettingsStore } from './settings'
import { resolveShell } from './shells'
import { readTemplate } from './templates'
import { TranscriptWatcher, transcriptPath } from './transcript'
import { ensureIgnored, type WorkspaceStore } from './workspace'
import { normalizeLayout } from './agentLayout'
import { agentNameProblem, sameAgentName } from '@shared/agentName'
import { effectiveConnectors, toolPolicy } from '@shared/connectors'
import { effectiveSkills } from '@shared/skills'
import { MODEL_RE, resolveAgentApi, resolveModel, resolveScope } from '@shared/settings'

/** Bản bàn giao agent viết (tool session_handoff), chờ phiên sau đọc. */
interface Handoff {
  summary: string
  fromSessionId: string
  at: string
}

interface StoreFile {
  agents: Agent[]
  layouts: Record<string, LayoutNode | null>
  /** Theo agentId. Lưu file để app tắt giữa chừng thì phiên sau vẫn nhận được bản bàn giao. */
  handoffs?: Record<string, Handoff>
}

interface Running extends AgentRun {
  owner: WebContents
  /** null = ô terminal thường (không có file phiên, không theo dõi transcript). */
  sessionFile: string | null
  /** Biến template của phiên, để ghi lại file phiên khi việc đổi. */
  vars: Record<string, string>
  /**
   * Theo dõi transcript: người dùng bấm Esc ngắt (Claude Code không có hook cho việc này) và số token
   * context (có ngay khi tiếp tục phiên cũ, trước lần chạy statusLine đầu tiên; xem context.ts).
   */
  transcript: TranscriptWatcher | null
  /** Codex: đã theo đúng file rollout chưa (đường dẫn chỉ biết sau hook SessionStart / lần ghi đầu). */
  rolloutKnown?: boolean
  /** Token hub của phiên (thu hồi khi phiên đóng). */
  token?: string
  /** Đang nhờ agent bàn giao: lúc gõ lời nhờ, và Claude Code đã nhận lời nhờ đó chưa (UserPromptSubmit). */
  handoffAsk?: { at: number; submitted: boolean }
}

/** Lời nhờ bàn giao chưa được gửi đi / agent chưa xong sau chừng này thì coi là hỏng. */
const HANDOFF_TIMEOUT_MS = 15 * 60_000
/** Chờ sau khi agent gọi session_handoff rồi mới đóng phiên (để kết quả tool kịp về và ghi transcript). */
const HANDOFF_CLOSE_DELAY_MS = 2500

/** Phần gửi được qua IPC (Running còn giữ watcher, biến template… chỉ dùng trong main). */
function publicRun({ agentId, sessionId, ptyId, startedAt }: Running): AgentRun {
  return { agentId, sessionId, ptyId, startedAt }
}

export class AgentService {
  private file = join(app.getPath('userData'), 'agents.json')
  private data: StoreFile = { agents: [], layouts: {} }
  private running = new Map<string, Running>()

  private hub: StatusHub | null = null
  /** Yêu cầu của agent chờ người dùng xác nhận (Agent API: agent_create…); renderer nhận qua IPC.agentRequests. */
  readonly requests = new AgentRequestQueue((list) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.agentRequests, list)
  })
  /** Việc đầu tiên agent khác giao cho agent mới tạo (agent_create): thành lời mở của phiên mới đầu tiên. */
  private firstTasks = new Map<string, { from: string; task: string; created: boolean }>()
  /** Tin nhắn giữa agent (agent_send) chờ gõ vào terminal của agent nhận. */
  private mail = new AgentMail()
  private handoffTimer: NodeJS.Timeout | null = null
  private guard: ScopeGuard

  constructor(
    private ptys: PtyManager,
    private workspaces: WorkspaceStore,
    private board: Board,
    private browser: BrowserService,
    private settings: SettingsStore,
    private activity: VaultActivityLog,
    private artifacts: ArtifactLog,
    private adapters: AdapterService,
    private external: ExternalAdapterStore,
    private secrets: SecretStore,
    private oauth: OAuthService,
    private approvals: ApprovalQueue,
    private skills: SkillLibrary
  ) {
    // Đọc cài đặt khoá phạm vi mỗi lần gọi tool: đổi trong Settings là có tác dụng ngay, không cần mở lại phiên.
    this.guard = new ScopeGuard(board, (ws, a) => resolveScope(this.settings.get(), ws.id, a.id))
  }

  /** Plugin (Cài đặt → Plugin): báo phiên mở / đóng, thêm tool vào máy chủ MCP stag. */
  private pluginHooks: {
    onSession?: (type: 'agent.session.started' | 'agent.session.stopped', agent: Agent) => void
    tools?: (agent: Agent, ws: Workspace) => ExtraTool[]
    onHandoff?: (agent: Agent, data: { percent: number | null; fromSessionId: string; summary: string }) => void
    onScopeConflict?: ScopeGuard['onConflict']
  } = {}

  attachPlugins(hooks: AgentService['pluginHooks']): void {
    this.pluginHooks = hooks
    this.guard.onConflict = hooks.onScopeConflict
  }

  /** Mọi agent + phiên đang chạy (cho plugin có quyền agents.read). */
  pluginView(): Array<{ agent: Agent; running: boolean; activity: string | null }> {
    return this.data.agents.map((a) => ({ agent: a, running: this.running.has(a.id), activity: this.board.statusOf(a.id)?.activity ?? null }))
  }

  /** Gõ chữ vào terminal của agent đang chạy (plugin có quyền agent.sessions.send). */
  typeInto(agentId: string, text: string): void {
    const run = this.running.get(agentId)
    if (!run) throw new Error('Agent này không có phiên đang chạy.')
    this.ptys.write(run.ptyId, text, false)
  }

  /** Gắn máy chủ trạng thái (hook + MCP) sau khi nó đã chạy. */
  attachHub(hub: StatusHub): void {
    this.hub = hub
    if (!this.handoffTimer) {
      this.handoffTimer = setInterval(() => {
        this.checkHandoffs()
        this.deliverMail()
      }, 1500)
      this.handoffTimer.unref?.()
    }
  }

  async load(): Promise<void> {
    const raw = await readText(this.file)
    if (raw) this.data = JSON.parse(raw) as StoreFile
    // Lưới ô (agent + widget plugin): bỏ nút hỏng do sửa tay / bản cũ.
    const layouts: StoreFile['layouts'] = {}
    for (const [wsId, l] of Object.entries(this.data.layouts ?? {})) layouts[wsId] = normalizeLayout(l)
    this.data.layouts = layouts
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
    const terminal = req.kind === 'terminal'
    if (req.kind === 'external' && !this.external.get(req.adapterId ?? '')) throw new Error('Adapter ngoài này không còn, cài lại ở Cài đặt → Adapter')
    const agent: Agent = {
      id: randomUUID(),
      workspaceId: req.workspaceId,
      kind: req.kind,
      name,
      role: terminal ? '' : req.role.trim(),
      permissionMode: terminal || req.kind === 'external' ? 'default' : req.permissionMode,
      createdAt: new Date().toISOString(),
      ...(req.kind === 'external' ? { adapterId: req.adapterId } : {})
    }
    this.data.agents.push(agent)
    await this.save()
    return agent
  }

  /** Mở một phiên CLI (Claude Code / Codex) cho agent trong terminal thật. */
  async start(owner: WebContents, req: StartAgentRequest): Promise<AgentRun> {
    const agent = this.data.agents.find((a) => a.id === req.agentId)
    if (!agent) throw new Error('Agent không tồn tại')
    const existing = this.running.get(agent.id)
    if (existing) return publicRun(existing)
    const ws = this.workspaces.get(agent.workspaceId)
    if (!ws) throw new Error('Workspace của agent không còn trong app')
    if (agentKind(agent) === 'terminal') return this.startTerminal(owner, agent, ws, req)

    if (!this.hub) throw new Error('Máy chủ trạng thái của app chưa sẵn sàng')
    const kind = agentKind(agent)
    const ext = kind === 'external' ? this.external.get(agent.adapterId ?? '') : undefined
    if (kind === 'external' && !ext) throw new Error(`Adapter "${agent.adapterId}" của agent này đã bị gỡ. Cài lại ở Cài đặt → Adapter.`)
    if (kind !== 'claude' && kind !== 'codex' && !ext) throw new Error('Loại agent này chưa được hỗ trợ')
    const exe = ext ? await this.external.exe(ext) : (await this.adapters.exe(kind as 'claude' | 'codex')).path
    // Connector (MCP) bật cho agent này; thiếu bí mật → báo lỗi ngay, trước khi ghi gì.
    const conn = effectiveConnectors(this.settings.get(), agent.workspaceId, agent.id)
    // Connector đăng nhập OAuth: làm mới token trước (hết hạn mà không làm mới được → báo lỗi, không mở phiên).
    const fresh = await this.oauth.fresh(conn.servers.filter((c) => c.oauth).map((c) => ({ name: c.bearerSecret, label: c.label || c.id })))
    const connEnv = connectorEnv(conn.servers, (n) => fresh.get(n) ?? this.secrets.get(n))
    const connCmds = await resolveCommands(conn.servers, ws.path)
    // Adapter ngoài không có cách tiếp tục phiên (chưa biết id phiên của CLI đó).
    const resume = req.resume && !!agent.lastSessionId && !ext
    const open = await this.board.openTask(ws, agent.id)
    // Phiên trước đã bàn giao: phiên mới (không phải tiếp tục phiên cũ) làm tiếp từ bản bàn giao.
    const handoff = resume ? undefined : this.data.handoffs?.[agent.id]
    const first = resume || handoff ? undefined : this.firstTasks.get(agent.id)
    // Claude Code: id phiên của app = id phiên Claude (đặt trước được). Codex tự sinh thread id (biết qua
    // hook SessionStart, lưu vào lastSessionId để resume), nên phiên của app luôn có id riêng.
    const sessionId = resume && kind === 'claude' ? agent.lastSessionId! : randomUUID()
    const codexResume = resume && kind === 'codex' ? agent.lastSessionId : undefined
    // Skill bật cho agent: bản chép riêng của phiên (Claude nạp qua --add-dir, CLI khác đọc theo luật phiên).
    const sk = effectiveSkills(this.settings.get(), await this.skills.usable(), agent.workspaceId, agent.id)
    // Claude tắt skill theo tên (skillOverrides) nên không tách được hai skill cùng tên: trùng với skill Claude Code
    // tự nạp (user / claude.ai / project) thì phiên Claude dùng bản của Claude Code, không chép bản thư viện.
    const claudeOwn = kind === 'claude' ? new Set((await scanClaudeSkills(ws.path)).filter((s) => s.scope !== 'plugin').map((s) => s.name)) : null
    const sessionSkills = await this.skills.prepareSession(sessionId, claudeOwn ? sk.library.filter((n) => !claudeOwn.has(n)) : sk.library)
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
      OPENING: first
        ? firstTaskOpening(first.from, first.task, first.created)
        : handoff
          ? `This session continues from your previous session, which handed off because its context was getting full. Read the Handoff section of your session file${open ? ` — your task "${open.title}" (scope: ${open.scope}) is still open, do not call task_start again` : ''}. Tell the user in one sentence that you are continuing from the handoff, then continue the work right away without waiting for an answer.`
          : open
            ? `You have unfinished work: "${open.title}" (scope: ${open.scope}). Greet briefly, mention it and ask the user whether to continue. If continuing, no need to call task_start again; if not, call task_done with a summary of what was done, then ask what they want help with in this workspace.`
            : 'Greet briefly and ask the user what they want you to help with in this workspace. Do nothing else until the user answers.',
      PREVIOUS_HANDOFF: handoff ? `From session ${handoff.fromSessionId} (${handoff.at}):\n\n${handoff.summary}` : '',
      AGENT_API: agentApiRules(resolveAgentApi(this.settings.get(), ws.id, agent.id)),
      USER_LANGUAGE: userLanguage(),
      DATE: today(),
      NOW: new Date().toISOString()
    }

    await this.writeSessionFile(sessionFile, vars, open)
    await writeIfMissing(agentNote, await readTemplate('agent/agent-note.md', vars))
    await ensureIgnored(ws.path, ['.sessions/'], 'stag.ai agent sessions')

    const rules = await readTemplate('agent/rules.md', vars)
    const skillText = skillInstructions(sessionSkills.skills)
    const opening = handoff ? 'Continue from the handoff of the previous session.' : 'Start a new session.'
    let command = exe
    let args: string[] | string
    let statusEnv: Record<string, string> = {}
    // Biến người dùng thêm ở Cài đặt → Adapter (adapter ngoài: cả biến chứa đường dẫn luật phiên).
    let userEnv: Record<string, string> = ext ? {} : this.adapters.env(kind as 'claude' | 'codex')
    // Transcript đoán trước. Codex: rollout của phiên cũ khi resume; phiên mới thì chưa có (theo sau, xem codexHook).
    let transcriptFile: string | null
    if (ext) {
      // Luật phiên vào một file cạnh file phiên; CLI nhận qua cờ hoặc biến môi trường (stagAdapter.rules).
      const rulesFile = sessionFile.replace(/\.md$/, '.rules.md')
      const note = ext.manifest.mcpConfigFlag ? '' : '\n\nNOTE: this CLI has no access to the stag MCP tools mentioned above (kanban, browser, handoff). Skip those steps.\n'
      await fs.writeFile(rulesFile, rules + skillText + note, 'utf8')
      const own = ext.manifest.mcpConfigFlag
        ? await this.hub.writeSessionConfigs(sessionFile.replace(/\.md$/, ''), claudeServers(conn.servers, connCmds), { allow: [], ask: [], deny: [], deniedMcpServers: [] })
        : { mcpFile: undefined }
      const l = externalArgs(ext, { rulesFile, prompt: opening, mcpFile: own.mcpFile ?? this.hub.mcpConfigFile() })
      const spec = spawnSpec(exe, l.args)
      command = spec.command
      args = spec.args
      userEnv = l.env
      transcriptFile = null
    } else if (kind === 'codex') {
      args = codexArgs({
        rules: rules + skillText,
        ...this.hub.endpoints(),
        permissionMode: agent.permissionMode,
        resumeId: codexResume,
        prompt: opening,
        userArgs: [
          ...codexConnectorArgs(conn, connCmds, await codexConfiguredServers(ws.path), connEnv),
          ...(await codexSkillArgs(sk.denied.codex, ws.path)),
          ...this.adapters.launchArgs('codex', agent)
        ]
      })
      transcriptFile = (codexResume && (await findCodexRollout(codexResume))) || join(ws.path, '.sessions', `${sessionId}.rollout-pending`)
    } else {
      args = resume ? ['--resume', sessionId] : ['--session-id', sessionId]
      args.push('--name', agent.name, '--append-system-prompt', rules)
      // Có connector / tắt máy chủ, skill có sẵn → file --settings / --mcp-config riêng của phiên.
      const own = await this.hub.writeSessionConfigs(sessionFile.replace(/\.md$/, ''), claudeServers(conn.servers, connCmds), {
        ...claudeSettingsExtra(conn),
        ...claudeSkillSettings(sk)
      })
      args.push(...this.hub.claudeArgs(own))
      if (sessionSkills.dir) args.push('--add-dir', sessionSkills.dir)
      if (agent.permissionMode !== 'default') args.push('--permission-mode', agent.permissionMode)
      // Model, mức suy nghĩ, tham số thêm (Cài đặt → Adapter).
      args.push(...this.adapters.launchArgs('claude', agent))
      // `--` trước lời mở: `--mcp-config` nhận nhiều giá trị, không chặn lại thì nuốt luôn lời mở làm tên file.
      if (!resume) args.push('--', opening)
      // statusLine của app (cho biết kích thước cửa sổ context) thay statusLine của người dùng trong phiên
      // agent; script của app chạy tiếp lệnh của họ để nó vẫn hiện như cũ (xem statusScript trong hub.ts).
      const ownStatusLine = await userStatusLine(ws.path)
      if (ownStatusLine) statusEnv = { STAG_USER_STATUSLINE: ownStatusLine, STAG_USER_STATUSLINE_BASH: (await findGitBash()) ?? '' }
      transcriptFile = transcriptPath(ws.path, sessionId)
    }
    const hubToken = this.hub.issueToken(agent.id, sessionId)
    let ptyId: string
    try {
      ptyId = this.ptys.spawn(
        owner,
        { command, args, cwd: ws.path, cols: req.cols, rows: req.rows },
        {
          env: {
            // Đặt trước để không đè được biến của app.
            ...userEnv,
            // Bí mật của connector (xem connectors.ts): sau biến người dùng để không bị đè nhầm.
            ...connEnv,
            ...hubToken.env,
            STAG_AGENT_ID: agent.id,
            STAG_AGENT_NAME: agent.name,
            STAG_SESSION_ID: sessionId,
            STAG_WORKSPACE: ws.path,
            ...statusEnv
          },
          filterEnv: independentSessionEnv,
          onExit: () => this.finish(agent.id, ptyId)
        }
      )
    } catch (e) {
      this.hub.revokeToken(hubToken.token)
      throw e
    }
    // Chỉ đọc phần ghi từ lúc này: `--resume` giữ nguyên transcript cũ, trong đó có thể đã có dòng ngắt
    // của lần trước. (Mở chỉ tốn một lần stat, xong trước khi claude kịp khởi động.)
    const transcript =
      transcriptFile === null
        ? null
        : TranscriptWatcher.open(transcriptFile, {
            onInterrupt: (i) => this.onInterrupt(agent.id, ptyId, i.at),
            onContext: (c) => this.onContext(agent.id, ptyId, { used: c.used, size: c.size, at: c.at }),
            contextParser: kind === 'codex' ? parseCodexContext : undefined
          })
    const run: Running = {
      agentId: agent.id,
      sessionId,
      ptyId,
      startedAt: new Date().toISOString(),
      owner,
      sessionFile,
      vars,
      transcript,
      token: hubToken.token,
      rolloutKnown: kind === 'codex' ? !transcriptFile!.endsWith('.rollout-pending') : undefined
    }
    this.running.set(agent.id, run)
    if (first) this.firstTasks.delete(agent.id)
    // Phiên mới: chờ hook đầu tiên (lời mở đầu). Tiếp tục phiên: Claude Code đứng chờ người dùng gõ.
    if (resume) this.board.setActivity(agent, 'waiting', { reason: 'turn' })
    else this.board.setActivity(agent, 'starting')
    this.board.setHandoff(agent, undefined)
    if (kind === 'claude') agent.lastSessionId = sessionId
    // Bản bàn giao đã chép vào file phiên mới: dùng một lần.
    if (handoff) delete this.data.handoffs![agent.id]
    await this.save()
    this.pluginHooks.onSession?.('agent.session.started', agent)
    return publicRun(run)
  }

  /**
   * Ô terminal thường: shell chọn ở Settings → Chung (mặc định PowerShell) trong thư mục dự án. Không luật phiên, không hook, không bộ nhớ,
   * không lên kanban; bỏ biến "phiên con" như agent để chạy claude bên trong vẫn là phiên độc lập.
   */
  private async startTerminal(owner: WebContents, agent: Agent, ws: Workspace, req: StartAgentRequest): Promise<AgentRun> {
    const sh = await resolveShell(this.settings.get().app.adapters.terminal.shell)
    const ptyId = this.ptys.spawn(
      owner,
      { command: sh.path, args: sh.args, cwd: ws.path, cols: req.cols, rows: req.rows },
      { filterEnv: independentSessionEnv, onExit: () => this.finish(agent.id, ptyId) }
    )
    const run: Running = {
      agentId: agent.id,
      sessionId: randomUUID(),
      ptyId,
      startedAt: new Date().toISOString(),
      owner,
      sessionFile: null,
      vars: {},
      transcript: null
    }
    this.running.set(agent.id, run)
    return publicRun(run)
  }

  /** Phiên kết thúc (agent tự thoát hoặc bị dừng): xoá file phiên. */
  private finish(agentId: string, ptyId: string): void {
    const run = this.running.get(agentId)
    if (!run || run.ptyId !== ptyId) return
    this.running.delete(agentId)
    this.hub?.revokeToken(run.token)
    this.requests.cancelAgent(agentId)
    this.guard.endSession(agentId)
    this.approvals.cancelAgent(agentId)
    run.transcript?.stop()
    if (run.sessionFile) {
      removeSessionFiles(run.sessionFile)
      void this.skills.cleanSession(run.sessionId)
    }
    const agent = this.data.agents.find((a) => a.id === agentId)
    if (!agent || agentKind(agent) === 'terminal') return
    this.board.setActivity(agent, 'stopped')
    this.pluginHooks.onSession?.('agent.session.stopped', agent)
    // Đóng vì đã bàn giao: nhờ giao diện mở phiên mới trong cùng ô (sau khi nó nhận sự kiện thoát
    // của terminal cũ, PtyManager gửi sự kiện đó ngay sau khi gọi hàm này).
    if (this.board.statusOf(agentId)?.handoff === 'restarting' && this.data.handoffs?.[agentId]) {
      setImmediate(() => {
        if (!run.owner.isDestroyed()) run.owner.send(IPC.agentRestart, agentId)
      })
    }
  }

  /** File phiên phản ánh việc đang mở (hoặc việc vừa xong) của agent. */
  private async writeSessionFile(file: string, vars: Record<string, string>, task: Task | undefined): Promise<void> {
    const content = await readTemplate('agent/session.md', {
      ...vars,
      STATUS: !task ? 'asking' : task.status === 'open' ? 'working' : 'done',
      TASK: task?.title ?? '_(not known yet — the agent is asking the user)_',
      SCOPE: task?.scope ?? '_(folders/files the agent may edit)_',
      HANDOFF: task?.summary ?? vars.PREVIOUS_HANDOFF ?? ''
    })
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, content, 'utf8')
  }

  private context(agentId: string): { agent: Agent; ws: Workspace; run?: Running } | null {
    const agent = this.data.agents.find((a) => a.id === agentId)
    const ws = agent && this.workspaces.get(agent.workspaceId)
    return agent && ws ? { agent, ws, run: this.running.get(agentId) } : null
  }

  /**
   * Tool connector ở mức "Hỏi trước" (Claude Code): giữ hook PreToolUse lại, hỏi người dùng ở Cài đặt → Connector →
   * Duyệt. Hết giờ thì trả 'ask' để Claude hỏi trong terminal như thường. Codex tự hỏi trong terminal của nó.
   */
  private async connectorApproval(agent: Agent, p: HookPayload): Promise<PreToolUseReply | undefined> {
    const m = /^mcp__(.+?)__(.+)$/.exec(p.tool_name ?? '')
    if (!m || m[1] === 'stag') return undefined
    const c = effectiveConnectors(this.settings.get(), agent.workspaceId, agent.id).servers.find((x) => x.id === m[1])
    if (!c || toolPolicy(c, m[2]) !== 'ask') return undefined
    this.board.setActivity(agent, 'waiting', { reason: 'permission', tool: p.tool_name })
    const d = await this.approvals.ask({
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      agentName: agent.name,
      connectorId: c.id,
      tool: m[2],
      input: p.tool_input
    })
    if (this.running.has(agent.id)) this.board.setActivity(agent, 'working', { tool: p.tool_name })
    if (d === 'timeout') return hookReply('ask', 'stag.ai: chưa ai duyệt trong app (Cài đặt → Connector → Duyệt) — hỏi ở đây.')
    if (d === 'deny')
      return hookReply('deny', 'The user declined this tool call in stag.ai (Connectors → Review). Do not retry it or work around it; tell the user and ask what to do instead.')
    if (d === 'always') {
      const cur = this.settings.get().app.connectors.items.find((x) => x.id === c.id)
      if (cur) await this.settings.saveConnector({ ...cur, toolPolicy: { ...cur.toolPolicy, [m[2]]: 'allow' } }).catch(() => {})
    }
    return hookReply('allow', 'stag.ai: người dùng đã cho phép trong app.')
  }

  /**
   * Hook từ phiên Claude Code / Codex của agent. Hook tới muộn sau khi phiên đã đóng thì bỏ qua.
   * Trả về câu trả lời cho hook (PreToolUse: khoá phạm vi, xem scopeGuard.ts) hoặc undefined = không can thiệp.
   */
  async onHook(agentId: string, payload: HookPayload): Promise<unknown> {
    const ctx = this.context(agentId)
    if (!ctx?.run) return undefined
    // Soi dữ liệu hook khi phát triển (CLI đổi dạng payload giữa các phiên bản).
    if (process.env.STAG_DEBUG_HOOKS) void fs.appendFile(process.env.STAG_DEBUG_HOOKS, `${JSON.stringify({ agent: ctx.agent.name, ...payload })}\n`).catch(() => {})
    // Đường dẫn transcript thật (đoán sai lúc mở, hoặc /clear sang phiên mới) → theo file đó.
    if (payload.transcript_path) void ctx.run.transcript?.follow(payload.transcript_path)
    if (agentKind(ctx.agent) === 'codex') void this.codexHook(ctx.agent, ctx.run, payload)
    this.board.hook(ctx.agent, payload)
    const ask = ctx.run.handoffAsk
    if (ask && this.board.statusOf(agentId)?.handoff === 'asking') {
      if (payload.hook_event_name === 'UserPromptSubmit') ask.submitted = true
      else if (payload.hook_event_name === 'Interrupt') this.handoffFailed(ctx.agent, ctx.run)
      // Hết lượt sau lời nhờ mà chưa gọi session_handoff (gọi rồi thì trạng thái đã là 'restarting').
      else if (payload.hook_event_name === 'Stop' && ask.submitted) this.handoffFailed(ctx.agent, ctx.run)
    }
    try {
      if (payload.hook_event_name === 'PreToolUse') {
        const approval = agentKind(ctx.agent) === 'claude' ? await this.connectorApproval(ctx.agent, payload) : undefined
        if (approval) return approval
        return await this.guard.preToolUse(ctx.ws, ctx.agent, agentKind(ctx.agent), payload)
      }
      if (payload.hook_event_name === 'PostToolUse') {
        this.activity.onToolUse(ctx.ws, ctx.agent, payload)
        void this.artifacts.onToolUse(ctx.ws, ctx.agent, payload).catch((e) => console.error('[artifacts]', e))
        await this.guard.postToolUse(ctx.ws, ctx.agent, payload)
      }
    } catch (e) {
      // Lỗi đọc kanban… không được chặn agent: bỏ qua khoá lần này.
      console.error('[scope]', e)
    }
    return undefined
  }

  /**
   * Codex: SessionStart cho biết thread id (để lần sau `codex resume`). Rollout chỉ được tạo khi Codex ghi
   * lần đầu và hook có thể không có transcript_path → tìm theo thread id ở các hook sau cho tới khi thấy.
   */
  private async codexHook(agent: Agent, run: Running, payload: HookPayload): Promise<void> {
    const threadId = payload.session_id
    if (payload.hook_event_name === 'SessionStart' && threadId && agent.lastSessionId !== threadId) {
      agent.lastSessionId = threadId
      await this.save()
    }
    if (payload.transcript_path) run.rolloutKnown = true
    if (run.rolloutKnown || !threadId) return
    const file = await findCodexRollout(threadId)
    if (file && this.running.get(agent.id) === run && !run.rolloutKnown) {
      run.rolloutKnown = true
      await run.transcript?.follow(file)
    }
  }

  /** Transcript có dòng "người dùng ngắt" của đúng phiên đang chạy. */
  private onInterrupt(agentId: string, ptyId: string, at: string): void {
    const ctx = this.context(agentId)
    if (ctx?.run?.ptyId !== ptyId) return
    this.board.interrupted(ctx.agent, at)
    // Người dùng ngắt giữa lúc agent đang bàn giao: thôi, không tự nhờ lại trong phiên này.
    if (this.board.statusOf(agentId)?.handoff === 'asking') this.handoffFailed(ctx.agent, ctx.run)
  }

  // ---- độ dài context + bàn giao (xem context.ts) ----

  /** Số đo context mới (transcript hoặc statusLine) của đúng phiên đang chạy. */
  private onContext(agentId: string, ptyId: string, next: { used?: number | null; size?: number | null; at: string }): void {
    const ctx = this.context(agentId)
    if (ctx?.run?.ptyId !== ptyId) return
    const cur = this.board.statusOf(agentId)?.context
    this.board.setContext(ctx.agent, mergeContext(cur, next))
  }

  /** JSON statusLine của phiên agent (qua hub). */
  onStatusLine(agentId: string, body: unknown): void {
    const run = this.running.get(agentId)
    if (!run) return
    const info = parseStatusLine(body)
    this.onContext(agentId, run.ptyId, { used: info.used, size: info.size, at: new Date().toISOString() })
  }

  /** Định kỳ: phiên nào tới ngưỡng thì nhờ bàn giao; lời nhờ treo quá lâu thì coi là hỏng. */
  private checkHandoffs(): void {
    const now = Date.now()
    for (const run of this.running.values()) {
      const agent = this.data.agents.find((a) => a.id === run.agentId)
      if (!agent) continue
      const status = this.board.statusOf(agent.id)
      if (status?.handoff === 'asking' && run.handoffAsk && now - run.handoffAsk.at > HANDOFF_TIMEOUT_MS) {
        this.handoffFailed(agent, run)
      } else if (handoffDue(this.settings.handoffFor(agent), status, this.ptys.lastInputAt(run.ptyId), now)) {
        this.askHandoff(agent, run, false)
      }
    }
  }

  /** Số agent / terminal đang có phiên chạy (hỏi lại trước khi thoát app). */
  runningCount(): number {
    return this.running.size
  }

  /**
   * Người dùng bấm "Bàn giao sang phiên mới". Chỉ khi agent đang chờ người dùng (hết lượt / bị ngắt):
   * lúc agent đang làm hay đang hỏi, chữ gõ vào sẽ lẫn với việc đang diễn ra.
   */
  handoffNow(agentId: string): void {
    const ctx = this.context(agentId)
    if (!ctx?.run) throw new Error('Agent không có phiên đang chạy')
    const status = this.board.statusOf(agentId)
    if (status?.handoff === 'asking' || status?.handoff === 'restarting') return
    if (status?.activity !== 'waiting' || status.reason === 'permission' || status.reason === 'question')
      throw new Error('Chờ agent hết lượt (đang chờ bạn trả lời) rồi hãy bàn giao')
    this.askHandoff(ctx.agent, ctx.run, true)
  }

  /** Gõ lời nhờ bàn giao vào terminal của agent rồi Enter (gửi riêng, để Claude Code không coi Enter là dòng mới trong đoạn dán). */
  private askHandoff(agent: Agent, run: Running, manual: boolean): void {
    const status = this.board.statusOf(agent.id)
    const pct = contextPercent(status?.context)
    run.handoffAsk = { at: Date.now(), submitted: false }
    this.board.setHandoff(agent, 'asking')
    this.ptys.write(run.ptyId, handoffPrompt(manual ? null : pct, manual ? null : this.settings.handoffFor(agent).handoffPercent), false)
    setTimeout(() => {
      if (this.running.get(agent.id) === run) this.ptys.write(run.ptyId, '\r', false)
    }, 400)
  }

  private handoffFailed(agent: Agent, run: Running): void {
    run.handoffAsk = undefined
    this.board.setHandoff(agent, 'failed')
  }

  /**
   * Agent gọi session_handoff: lưu bản bàn giao, đóng phiên; khi tiến trình thoát, giao diện mở phiên mới
   * (xem finish) và phiên mới đọc bản bàn giao trong file phiên.
   */
  private async completeHandoff(agentId: string, summary: string): Promise<void> {
    const ctx = this.context(agentId)
    if (!ctx?.run) throw new Error('Session is not running')
    const run = ctx.run
    this.data.handoffs = { ...this.data.handoffs, [agentId]: { summary, fromSessionId: run.sessionId, at: new Date().toISOString() } }
    await this.save()
    run.handoffAsk = undefined
    this.board.setHandoff(ctx.agent, 'restarting')
    const pct = contextPercent(this.board.statusOf(agentId)?.context)
    this.pluginHooks.onHandoff?.(ctx.agent, { percent: pct == null ? null : Math.round(pct), fromSessionId: run.sessionId, summary })
    setTimeout(() => {
      if (this.running.get(agentId) === run) this.ptys.kill(run.ptyId)
    }, HANDOFF_CLOSE_DELAY_MS)
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
      scope: () => resolveScope(this.settings.get(), ws.id, agent.id),
      browser: this.browser,
      teammates: () =>
        this.data.agents.filter((a) => a.workspaceId === ws.id && agentKind(a) !== 'terminal').map((a) => ({ agent: a, running: this.running.has(a.id) })),
      handoff: (summary) => this.completeHandoff(agent.id, summary),
      extraTools: this.pluginHooks.tools?.(agent, ws) ?? [],
      team: {
        agents: () => this.teamInfo(ws),
        adapters: () => this.adapterInfo(ws),
        create: (input) => this.apiCreate(agent, ws, input),
        update: (input) => this.apiUpdate(agent, ws, input),
        open: (input) => this.apiOpen(agent, ws, input),
        stop: (input) => this.apiStop(agent, ws, input),
        send: (input) => this.apiSend(agent, ws, input),
        remove: (input) => this.apiDelete(agent, ws, input)
      },
      // Đọc mỗi yêu cầu MCP: tắt giữa phiên thì lần gọi sau báo lỗi; phiên mở sau đó không thấy tool.
      browserTools: browserToolsOn(this.settings.get(), ws.id, agent.id),
      agentApi: resolveAgentApi(this.settings.get(), ws.id, agent.id),
      syncSessionFile: async () => {
        const cur = this.running.get(agent.id)
        if (!cur?.sessionFile) return
        const tasks = (await this.board.snapshot(ws)).tasks.filter((t) => t.agentId === agent.id)
        // Việc đang mở; không có thì việc vừa xong trong phiên này (để giữ phần Bàn giao).
        const task =
          tasks.find((t) => t.status === 'open') ??
          tasks.filter((t) => t.sessionId === cur.sessionId && t.status === 'done').at(-1)
        await this.writeSessionFile(cur.sessionFile, cur.vars, task)
      }
    })
  }

  // ---- Agent API (tool agent_list / adapter_models trong máy chủ MCP stag) ----

  /** Mọi agent / ô terminal của workspace, theo thứ tự trong danh sách bên trái. */
  private teamInfo(ws: Workspace): AgentInfo[] {
    const s = this.settings.get()
    return this.data.agents
      .filter((a) => a.workspaceId === ws.id)
      .map((a) => {
        const kind = agentKind(a)
        const ext = kind === 'external' ? this.external.get(a.adapterId ?? '') : undefined
        const m = isCliKind(kind) ? resolveModel(s, kind, ws.id, a.id) : null
        return {
          id: a.id,
          name: a.name,
          role: a.role,
          kind: kind === 'external' ? `external:${a.adapterId ?? ''}` : kind,
          kindLabel: this.kindLabel(a),
          model: m ? m.model : ext ? ext.model : null,
          effort: m?.effort || null,
          permissionMode: a.permissionMode,
          running: this.running.has(a.id),
          activity: kind === 'terminal' ? null : (this.board.statusOf(a.id)?.activity ?? null)
        }
      })
  }

  /** Loại agent tạo được trên máy này + model mặc định của workspace (kiểm tra CLI, không gọi model). */
  private async adapterInfo(ws: Workspace): Promise<AdapterInfo[]> {
    const s = this.settings.get()
    const cli = await Promise.all(
      (['claude', 'codex'] as const).map(async (id): Promise<AdapterInfo> => {
        const st = await this.adapters.check(id)
        const m = resolveModel(s, id, ws.id, null)
        const login = st.login.state === 'in' ? 'logged in' : st.login.state === 'out' ? 'NOT logged in' : ''
        return {
          kind: id,
          label: ADAPTER_LABEL[id],
          available: !!st.path && !st.error,
          detail: st.error ?? [st.version, login].filter(Boolean).join(', '),
          defaultModel: m.model || st.configModel || '',
          defaultEffort: m.effort || null,
          models: st.models
        }
      })
    )
    const terminal: AdapterInfo = {
      kind: 'terminal',
      label: 'Terminal',
      available: true,
      detail: 'a plain shell in the project folder, no memory, not on the kanban',
      defaultModel: null,
      defaultEffort: null,
      models: []
    }
    const ext = await Promise.all(
      this.external.list().map(async (a): Promise<AdapterInfo> => {
        const problem = !a.enabled ? 'turned off in Settings → Adapter' : await this.external.exe(a).then(() => '', (e: Error) => e.message)
        return {
          kind: `external:${a.manifest.id}`,
          label: a.manifest.label,
          available: !problem,
          detail: problem || `external adapter ${a.version}`,
          defaultModel: a.model,
          defaultEffort: null,
          models: []
        }
      })
    )
    return [...cli, terminal, ...ext]
  }

  /**
   * Tool agent_create: agent xin tạo agent mới thay người dùng. Kiểm tra trước (để người dùng không duyệt một yêu cầu
   * hỏng), hỏi người dùng trong app, tạo, đặt model / effort, rồi nhờ giao diện thêm ô cạnh ô của agent đã xin và mở phiên.
   * Việc đầu tiên (nếu có) thành lời mở của phiên đầu tiên của agent mới. Trả về câu trả lời cho agent (tiếng Anh).
   */
  private async apiCreate(caller: Agent, ws: Workspace, input: AgentCreateInput): Promise<string> {
    const run = this.running.get(caller.id)
    if (!run) throw new Error('Your session is not running in stag.ai.')
    const s = this.settings.get()
    const checked = checkCreateInput(input, (k) => s.app.adapters[k].defaultPermission)
    if ('error' in checked) throw new Error(checked.error)
    const d = checked.draft
    const nameProblem = agentNameProblem(d.name)
    if (nameProblem) throw new Error(`Invalid name: ${nameProblem}`)
    if (this.data.agents.some((a) => a.workspaceId === ws.id && sameAgentName(a.name, d.name)))
      throw new Error(`An agent named "${d.name}" already exists in this workspace (see agent_list). Pick another name.`)
    let kindLabel = d.kind === 'terminal' ? 'Terminal' : ''
    if (isCliKind(d.kind)) {
      kindLabel = ADAPTER_LABEL[d.kind]
      await this.adapters.exe(d.kind).catch((e: Error) => {
        throw new Error(`${kindLabel} is not available on this machine: ${e.message}`)
      })
    } else if (d.kind === 'external') {
      const ext = this.external.get(d.adapterId ?? '')
      if (!ext) throw new Error(`No external adapter "${d.adapterId}" is installed (see adapter_models).`)
      kindLabel = ext.manifest.label
    }
    const draft: AgentCreateDraft = { ...d, kindLabel }

    // Cài đặt → Agent API tắt "hỏi trước khi tạo": vẫn hỏi nếu agent mới được quyền cao hơn agent đang xin.
    const ask = resolveAgentApi(s, ws.id, caller.id).confirmCreate || (isCliKind(draft.kind) && permissionAbove(draft.permissionMode, caller.permissionMode))
    const answer = ask
      ? await this.confirm(caller, 'agent_create', { workspaceId: ws.id, fromAgentId: caller.id, fromName: caller.name, action: 'create', create: draft })
      : 'allow'
    if (answer === 'deny') return `The user declined creating agent "${draft.name}". Do not retry; ask the user what they want instead.`
    if (answer === 'timeout') return `Nobody confirmed creating agent "${draft.name}" in stag.ai in time. Tell the user to look at the confirm card, or try again when they are ready.`

    const agent = await this.create({
      workspaceId: ws.id,
      kind: draft.kind,
      adapterId: draft.adapterId,
      name: draft.name,
      role: draft.role,
      permissionMode: draft.permissionMode
    })
    if (isCliKind(draft.kind) && (draft.model || draft.effort)) {
      const one = { ...(draft.model ? { model: draft.model } : {}), ...(draft.effort ? { effort: draft.effort } : {}) }
      await this.settings.setOverrides('agent', agent.id, { models: { [draft.kind]: one } })
    }
    if (draft.task) this.firstTasks.set(agent.id, { from: caller.name, task: draft.task, created: true })
    const event: AgentCreatedEvent = { agent, nearAgentId: caller.id, open: draft.open }
    if (!run.owner.isDestroyed()) run.owner.send(IPC.agentCreated, event)

    const m = isCliKind(draft.kind) ? this.settings.modelFor(draft.kind, agent) : null
    const what = `${draft.kindLabel}${m ? `, model ${m.model || 'default (CLI config)'}${m.effort ? `, effort ${m.effort}` : ''}` : ''}, permission ${agent.permissionMode}`
    const opened = draft.open
      ? ' Its cell was added next to yours and its session starts now (if the user is looking at another workspace, it starts when they open this one).'
      : ' Its cell is not open; the user (or agent_open later) can open it from the agent list.'
    const task = draft.task ? ' It will start with the task you gave it.' : ''
    return `Created agent "${agent.name}" (${what}).${opened}${task} Tell the user.`
  }

  // ---- Agent API A3: đổi / mở / dừng / nhắn / xoá agent khác (tool agent_update, agent_open, agent_stop, agent_send, agent_delete) ----

  private kindLabel(a: Agent): string {
    const kind = agentKind(a)
    if (isCliKind(kind)) return ADAPTER_LABEL[kind]
    if (kind === 'terminal') return 'Terminal'
    return this.external.get(a.adapterId ?? '')?.manifest.label ?? a.adapterId ?? 'external'
  }

  /** Agent tên `name` trong workspace (không phân biệt hoa thường); không có thì lỗi kèm danh sách tên. */
  private byName(ws: Workspace, name: string): Agent {
    const all = this.data.agents.filter((a) => a.workspaceId === ws.id)
    const a = all.find((x) => sameAgentName(x.name, name.trim()))
    if (!a) throw new Error(`No agent named "${name}" in this workspace. Agents: ${all.map((x) => `"${x.name}"`).join(', ') || '(none)'}.`)
    return a
  }

  private targetInfo(a: Agent): AgentTargetInfo {
    return { id: a.id, name: a.name, kindLabel: this.kindLabel(a), running: this.running.has(a.id) }
  }

  /** Báo mọi cửa sổ thay đổi do Agent API (cập nhật danh sách / lưới). */
  private apiEvent(e: AgentApiEvent): void {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.agentApiEvent, e)
  }

  /** Hỏi người dùng trong app; trong lúc chờ, agent đã xin hiện "chờ duyệt" (thông báo chờ như thường). */
  private async confirm(caller: Agent, tool: string, req: AgentRequestInput): Promise<AgentRequestAnswer> {
    const run = this.running.get(caller.id)
    this.board.setActivity(caller, 'waiting', { reason: 'permission', tool })
    const answer = await this.requests.ask(req)
    if (run && this.running.get(caller.id) === run) this.board.setActivity(caller, 'working', { tool })
    return answer
  }

  private static declined(answer: AgentRequestAnswer, what: string): string {
    return answer === 'deny'
      ? `The user declined: ${what}. Do not retry; ask the user what they want instead.`
      : `Nobody confirmed in stag.ai in time: ${what}. Tell the user to look at the confirm card, or try again when they are ready.`
  }

  private async apiUpdate(caller: Agent, ws: Workspace, input: AgentUpdateInput): Promise<string> {
    const target = this.byName(ws, input.name)
    const kind = agentKind(target)
    const role = input.role?.trim()
    const model = input.model?.trim()
    const effort = input.effort?.trim().toLowerCase()
    const newName = input.new_name?.trim()
    if (role !== undefined && role.length > ROLE_MAX) throw new Error(`role is too long (max ${ROLE_MAX} characters).`)
    if (role !== undefined && kind === 'terminal') throw new Error('A terminal cell has no role.')
    if ((model !== undefined || effort !== undefined) && !isCliKind(kind)) throw new Error(`model / effort only apply to Claude Code and Codex agents, not ${this.kindLabel(target)}.`)
    // '' / "default" = bỏ ghi đè, theo mặc định workspace / app.
    const clear = (v: string | undefined): boolean => v === '' || v === 'default'
    if (model !== undefined && !clear(model) && !MODEL_RE.test(model)) throw new Error(`Invalid model id "${model}".`)
    if (effort !== undefined && !clear(effort) && !/^[a-z]{1,20}$/.test(effort)) throw new Error(`Invalid effort "${effort}".`)
    let perm: PermissionMode | undefined
    if (input.permission_mode !== undefined) {
      const p = parsePermission(input.permission_mode)
      if (!p) throw new Error(`Invalid permission_mode "${input.permission_mode}". Use one of: default, acceptEdits, auto, plan.`)
      if (!isCliKind(kind)) throw new Error('permission_mode only applies to Claude Code and Codex agents.')
      if (p !== target.permissionMode) perm = p
    }
    if (newName !== undefined) {
      const problem = agentNameProblem(newName)
      if (problem) throw new Error(`Invalid name: ${problem}`)
      if (this.data.agents.some((a) => a.id !== target.id && a.workspaceId === ws.id && sameAgentName(a.name, newName)))
        throw new Error(`An agent named "${newName}" already exists in this workspace.`)
    }
    if (role === undefined && model === undefined && effort === undefined && perm === undefined && (newName === undefined || newName === target.name))
      return `Nothing to change for "${target.name}".`

    // Đổi quyền là việc nhạy cảm: hỏi người dùng (các thay đổi khác trong cùng lần gọi chờ theo).
    if (perm) {
      const answer = await this.confirm(caller, 'agent_update', {
        workspaceId: ws.id,
        fromAgentId: caller.id,
        fromName: caller.name,
        action: 'permission',
        target: this.targetInfo(target),
        from: target.permissionMode,
        to: perm
      })
      if (answer !== 'allow') return AgentService.declined(answer, `changing the permission mode of "${target.name}" (nothing was changed)`)
    }

    const done: string[] = []
    if (newName !== undefined && newName !== target.name) {
      const old = target.name
      await this.rename(target.id, newName)
      done.push(`renamed "${old}" → "${newName}"`)
    }
    if (role !== undefined || perm) {
      if (role !== undefined) target.role = role
      if (perm) target.permissionMode = perm
      await this.save()
      if (role !== undefined) done.push(`role: ${role || '(none)'}`)
      if (perm) done.push(`permission: ${perm}`)
    }
    if (isCliKind(kind) && (model !== undefined || effort !== undefined)) {
      const cur = { ...this.settings.get().agents[target.id]?.models?.[kind] }
      if (model !== undefined) {
        if (clear(model)) delete cur.model
        else cur.model = model
      }
      if (effort !== undefined) {
        if (clear(effort)) delete cur.effort
        else cur.effort = effort
      }
      const models = { ...this.settings.get().agents[target.id]?.models }
      if (Object.keys(cur).length) models[kind] = cur
      else delete models[kind]
      await this.settings.setOverrides('agent', target.id, { models: Object.keys(models).length ? models : null })
      const m = this.settings.modelFor(kind, target)
      done.push(`model ${m.model || 'default (CLI config)'}${m.effort ? `, effort ${m.effort}` : ''}`)
    }
    this.apiEvent({ type: 'updated', agent: { ...target } })
    const later = this.running.has(target.id) && (role !== undefined || perm || model !== undefined || effort !== undefined)
    return `Updated "${target.name}": ${done.join('; ')}.${later ? ' Its running session keeps the old settings; they apply from its next session (agent_stop then agent_open, with the user’s OK).' : ''}`
  }

  private async apiOpen(caller: Agent, ws: Workspace, input: { name: string; task?: string }): Promise<string> {
    const target = this.byName(ws, input.name)
    if (target.id === caller.id) throw new Error('That is you.')
    const task = input.task?.trim() ?? ''
    if (task.length > TASK_MAX) throw new Error(`task is too long (max ${TASK_MAX} characters).`)
    if (this.running.has(target.id)) {
      if (task) throw new Error(`"${target.name}" is already running. Use agent_send to give it the task.`)
      this.apiEvent({ type: 'open', workspaceId: ws.id, agentId: target.id, nearAgentId: caller.id })
      return `"${target.name}" is already running; its cell is shown to the user.`
    }
    if (task && agentKind(target) === 'terminal') throw new Error('A terminal cell cannot receive a task.')
    if (task) this.firstTasks.set(target.id, { from: caller.name, task, created: false })
    this.apiEvent({ type: 'open', workspaceId: ws.id, agentId: target.id, nearAgentId: caller.id })
    return `Opening "${target.name}" in a new session next to your cell${task ? ', starting with your task' : ''} (if the user is looking at another workspace, it starts when they open this one).`
  }

  private async apiStop(caller: Agent, ws: Workspace, input: { name: string }): Promise<string> {
    const target = this.byName(ws, input.name)
    if (target.id === caller.id) throw new Error('You cannot stop your own session. Finish your turn instead.')
    if (!this.running.has(target.id)) return `"${target.name}" has no running session.`
    const answer = await this.confirm(caller, 'agent_stop', { workspaceId: ws.id, fromAgentId: caller.id, fromName: caller.name, action: 'stop', target: this.targetInfo(target) })
    if (answer !== 'allow') return AgentService.declined(answer, `stopping "${target.name}"`)
    this.stop(target.id)
    return `Stopped the session of "${target.name}". Its open task (if any) stays open; agent_open starts a new session.`
  }

  private async apiSend(caller: Agent, ws: Workspace, input: { name: string; text: string }): Promise<string> {
    const target = this.byName(ws, input.name)
    if (target.id === caller.id) throw new Error('That is you.')
    if (agentKind(target) === 'terminal') throw new Error(`"${target.name}" is a plain terminal, not an AI agent; agent_send cannot type into it.`)
    if (!this.running.has(target.id)) throw new Error(`"${target.name}" has no running session. Use agent_open with a task instead.`)
    const text = input.text.trim()
    if (!text) throw new Error('text is empty.')
    if (text.length > MESSAGE_MAX) throw new Error(`text is too long (max ${MESSAGE_MAX} characters).`)
    this.mail.enqueue(target.id, { fromId: caller.id, fromName: caller.name, text, at: Date.now() })
    this.deliverMail()
    const left = this.mail.pending(target.id)
    return left
      ? `Queued for "${target.name}" (it is busy or the user is typing there): it will be typed into its session when it finishes its turn${left > 1 ? ` (${left} messages waiting)` : ''}. Do not resend.`
      : `Delivered: typed into the session of "${target.name}". It will answer in its own cell; it can reply to you with agent_send.`
  }

  private async apiDelete(caller: Agent, ws: Workspace, input: { name: string }): Promise<string> {
    const target = this.byName(ws, input.name)
    if (target.id === caller.id) throw new Error('You cannot delete yourself.')
    const answer = await this.confirm(caller, 'agent_delete', { workspaceId: ws.id, fromAgentId: caller.id, fromName: caller.name, action: 'delete', target: this.targetInfo(target) })
    if (answer !== 'allow') return AgentService.declined(answer, `deleting "${target.name}"`)
    await this.remove(target.id)
    await this.settings.forget('agent', [target.id])
    this.apiEvent({ type: 'removed', workspaceId: ws.id, agentId: target.id })
    return `Deleted agent "${target.name}" (its session was stopped, its memory note moved to the Recycle Bin, its unfinished task card dropped).`
  }

  /** Gõ tin nhắn đang chờ vào terminal của agent nhận nào đang rảnh (gọi định kỳ + ngay khi có tin mới). */
  private deliverMail(): void {
    const now = Date.now()
    for (const id of this.mail.targets()) {
      const run = this.running.get(id)
      const agent = this.data.agents.find((a) => a.id === id)
      if (!run || !agent) continue
      const item = this.mail.next(id, mailReady(this.board.statusOf(id), this.ptys.lastInputAt(run.ptyId), now), now)
      if (!item) continue
      const msg = agentMessage(item.fromName, item.text)
      // Claude Code / Codex bật bracketed paste: dán cả khối (nhiều dòng không bị gửi giữa chừng), Enter gửi riêng.
      this.ptys.write(run.ptyId, isCliKind(agentKind(agent)) ? `\x1b[200~${msg}\x1b[201~` : msg.replace(/\s*\r?\n\s*/g, ' '), false)
      setTimeout(() => {
        if (this.running.get(id) === run) this.ptys.write(run.ptyId, '\r', false)
      }, 400)
    }
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
    if (this.data.handoffs) delete this.data.handoffs[agentId]
    this.mail.forget(agentId)
    this.firstTasks.delete(agentId)
    this.requests.dropTarget(agentId)
    await this.save()
  }

  /** Workspace bị bỏ khỏi app: dừng và bỏ mọi agent của nó (note trong vault giữ nguyên). */
  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const a of this.data.agents) {
      if (a.workspaceId !== workspaceId) continue
      this.stop(a.id)
      if (this.data.handoffs) delete this.data.handoffs[a.id]
    }
    this.data.agents = this.data.agents.filter((a) => a.workspaceId !== workspaceId)
    delete this.data.layouts[workspaceId]
    this.board.forgetWorkspace(workspaceId)
    this.activity.forgetWorkspace(workspaceId)
    this.artifacts.forgetWorkspace(workspaceId)
    this.browser.closeWorkspace(workspaceId)
    await this.save()
  }

  async saveLayout(workspaceId: string, layout: LayoutNode | null): Promise<void> {
    this.data.layouts[workspaceId] = normalizeLayout(layout)
    await this.save()
  }

  /** Thoát app: dừng mọi phiên và xoá file phiên ngay (không chờ sự kiện thoát). */
  shutdown(): void {
    for (const run of this.running.values()) {
      run.transcript?.stop()
      this.ptys.kill(run.ptyId)
      if (run.sessionFile) removeSessionFiles(run.sessionFile)
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
    // Terminal không có note bộ nhớ trong vault.
    if (ws && agentKind(agent) !== 'terminal') {
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
    this.activity.renameAgent(agent.id, name)
    void this.artifacts.renameAgent(agent.id, name)
    this.browser.renameAgent(agent.id, name)
    // File phiên (agent khác đọc trong .sessions/) ghi tên mới và đường dẫn note mới.
    const run = this.running.get(agent.id)
    if (run?.sessionFile && ws) {
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

/** File phiên trong .sessions/: file phiên + luật phiên (adapter ngoài) + cấu hình MCP / settings riêng (connector). */
function removeSessionFiles(sessionFile: string): void {
  for (const ext of ['.md', '.rules.md', '.mcp.json', '.settings.json']) rmSync(sessionFile.replace(/\.md$/, ext), { force: true })
}
