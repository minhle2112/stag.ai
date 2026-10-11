import { promises as fs } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import {
  commandLabel,
  commandLine,
  detectLaunch,
  devCellName,
  LAUNCH_FILE,
  launchProblem,
  launchUrl,
  parseLaunch,
  sameName,
  splitCommand,
  startupFailure,
  terminalLines,
  upsertLaunch,
  type DevServerEntry,
  type DevServerList,
  type LaunchConfig
} from '@shared/launch'
import type { DevServerApproval } from '@shared/agentApi'
import type { Workspace } from '@shared/types'
import type { AgentService } from './agents'
import type { BrowserService } from './browser'
import { readText } from './fsutil'
import type { WorkspaceStore } from './workspace'

export interface DevServerAgentApi {
  list(): Promise<string>
  start(input: { name?: string; command?: string; port?: number; url?: string }): Promise<string>
  logs(input: { name: string; lines?: number; search?: string }): Promise<string>
  stop(input: { name: string }): Promise<string>
}

/** Chờ cổng mở tối đa chừng này (cài gói lần đầu / build lớn có thể lâu). */
const START_TIMEOUT = 3 * 60_000
const POLL_MS = 500
/** Ô terminal chưa mở phiên sau chừng này (workspace chưa từng được mở trong app…) thì báo lỗi. */
const OPEN_TIMEOUT = 30_000
const CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'astro.config.mjs', 'astro.config.ts']

/** Cổng có server nghe không (thử cả IPv4 và IPv6: Vite mặc định chỉ nghe `localhost` = ::1 trên Node mới). */
export function portOpen(port: number, timeout = 400): Promise<boolean> {
  const one = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const sock = connect({ host, port })
      const done = (ok: boolean): void => {
        sock.removeAllListeners()
        sock.destroy()
        resolve(ok)
      }
      sock.setTimeout(timeout, () => done(false))
      sock.once('connect', () => done(true))
      sock.once('error', () => done(false))
    })
  return Promise.all([one('127.0.0.1'), one('::1')]).then(([a, b]) => a || b)
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Starting {
  promise: Promise<string>
  cancel: () => void
}

export interface StartOptions {
  /** Ô terminal mới đặt cạnh ô này (agent gọi preview_start). */
  near?: string | null
  /** Ghi vào `.stag/launch.json` (mặc định có). */
  save?: boolean
  /** Báo tiến độ (đã có ô terminal). */
  onCell?: (agentId: string) => void
}

/**
 * Dev server của các workspace: Tab mới của browser và tool preview_* của agent. Lệnh chạy trong một ô terminal thường
 * trên canvas ("Dev · <tên>") để người dùng thấy log và tự dừng; app chỉ đợi cổng mở rồi báo URL.
 */
export class DevServerService {
  private starting = new Map<string, Starting>()
  /** Ô terminal đã chạy server nào (workspace + tên → id agent). */
  private cells = new Map<string, string>()
  /** Lệnh người dùng đã duyệt (hoặc tự bấm chạy) trong lần chạy app này: workspace + cấu hình. */
  private approved = new Set<string>()

  constructor(
    private workspaces: WorkspaceStore,
    private agents: AgentService,
    private browser: BrowserService
  ) {}

  private ws(wsId: string): Workspace {
    const ws = this.workspaces.get(wsId)
    if (!ws) throw new Error('Workspace không tồn tại')
    return ws
  }

  private key(wsId: string, name: string): string {
    return `${wsId}\0${name.trim().toLowerCase()}`
  }

  private approvalKey(wsId: string, cfg: LaunchConfig): string {
    return JSON.stringify([this.key(wsId, cfg.name), cfg.runtimeExecutable, cfg.runtimeArgs ?? [], cfg.port])
  }

  private async saved(ws: Workspace): Promise<LaunchConfig[]> {
    return parseLaunch(await readText(join(ws.path, LAUNCH_FILE)))
  }

  private async detected(ws: Workspace): Promise<LaunchConfig[]> {
    const files = await fs.readdir(ws.path).catch(() => [] as string[])
    let pkg: { scripts?: Record<string, unknown> } | null = null
    try {
      const raw = await readText(join(ws.path, 'package.json'))
      if (raw) pkg = JSON.parse(raw) as typeof pkg
    } catch {
      pkg = null
    }
    const env = (await Promise.all(['.env', '.env.local'].filter((f) => files.includes(f)).map((f) => readText(join(ws.path, f))))).join('\n')
    const config = (await Promise.all(CONFIG_FILES.filter((f) => files.includes(f)).map((f) => readText(join(ws.path, f))))).join('\n')
    return detectLaunch({ pkg, files, env, config })
  }

  /** Cách chạy đã lưu + đoán được, kèm cổng nào đang mở. */
  async list(wsId: string): Promise<DevServerList> {
    const ws = this.ws(wsId)
    const saved = await this.saved(ws)
    const detected = (await this.detected(ws)).filter((d) => !saved.some((s) => sameName(s.name, d.name)))
    const entry = async (c: LaunchConfig): Promise<DevServerEntry> => ({ ...c, command: commandLabel(c), running: await portOpen(c.port) })
    return { saved: await Promise.all(saved.map(entry)), detected: await Promise.all(detected.map(entry)) }
  }

  /** Tìm cấu hình theo tên (đã lưu trước, rồi đoán được); không có tên mà chỉ có một cách chạy thì lấy nó. */
  async resolve(wsId: string, name?: string): Promise<LaunchConfig> {
    const ws = this.ws(wsId)
    const all = [...(await this.saved(ws)), ...(await this.detected(ws))]
    if (!name) {
      if (all.length === 1) return all[0]
      if (!all.length) throw new Error(`No dev server found: no ${LAUNCH_FILE} and nothing runnable in package.json.`)
      throw new Error(`Several dev servers: ${all.map((c) => c.name).join(', ')}. Pass one name.`)
    }
    const c = all.find((x) => sameName(x.name, name))
    if (!c) throw new Error(`No dev server named "${name}". Known: ${all.map((x) => x.name).join(', ') || '(none)'}.`)
    return c
  }

  /** Ghi (thêm / thay cùng tên) vào `.stag/launch.json` của dự án. */
  async save(wsId: string, cfg: LaunchConfig): Promise<void> {
    const problem = launchProblem(cfg)
    if (problem) throw new Error(`Invalid dev server config: ${problem}`)
    const file = join(this.ws(wsId).path, LAUNCH_FILE)
    const next = upsertLaunch(await readText(file), cfg)
    await fs.mkdir(dirname(file), { recursive: true })
    await fs.writeFile(file, next, 'utf8')
  }

  /**
   * Chạy dev server (nếu cổng chưa mở) trong ô terminal "Dev · <tên>" và chờ cổng mở. Trả về URL.
   * Cùng server đang khởi động thì chờ chung lần đó.
   */
  async start(wsId: string, cfg: LaunchConfig, o: StartOptions = {}): Promise<string> {
    const problem = launchProblem(cfg)
    if (problem) throw new Error(`Invalid dev server config: ${problem}`)
    const url = launchUrl(cfg)
    const key = this.key(wsId, cfg.name)
    const cur = this.starting.get(key)
    if (cur) {
      const id = this.cells.get(key)
      if (id) o.onCell?.(id)
      return cur.promise
    }

    let cancelled = false
    // Đăng ký lần khởi động ngay (trước mọi await): hai lần gọi song song dùng chung, không mở hai ô terminal.
    const run = async (): Promise<string> => {
      if (o.save !== false) {
        const saved = (await this.saved(this.ws(wsId))).find((s) => sameName(s.name, cfg.name))
        if (!saved || JSON.stringify(saved) !== JSON.stringify(cfg)) await this.save(wsId, cfg)
      }
      if (await portOpen(cfg.port)) return url
      // Chỉ xét chữ in ra sau lần gõ lệnh này (ô dùng lại có thể còn lỗi của lần trước). Đo trước khi gõ.
      const prev = this.cellOf(wsId, cfg.name)
      const skip = prev && this.agents.isRunning(prev) ? this.agents.terminalOutput(prev).length : 0
      const agentId = await this.agents.devTerminal(wsId, devCellName(cfg.name), commandLine(cfg, process.platform), o.near ?? null)
      this.cells.set(key, agentId)
      o.onCell?.(agentId)
      const t0 = Date.now()
      let ran = false
      for (;;) {
        if (cancelled) throw new Error('Đã huỷ.')
        if (await portOpen(cfg.port)) return url
        if (!this.agents.has(agentId)) throw new Error('Ô terminal của dev server đã bị xoá.')
        const running = this.agents.isRunning(agentId)
        if (running) ran = true
        else if (ran) throw new Error(`Terminal đã đóng trước khi cổng ${cfg.port} mở. ${this.tail(agentId)}`.trim())
        else if (Date.now() - t0 > OPEN_TIMEOUT)
          throw new Error('Ô terminal chưa mở được (mở workspace này ở tab Agent một lần rồi thử lại).')
        if (running) {
          const bad = startupFailure(terminalLines(this.agents.terminalOutput(agentId).slice(skip)).slice(-200))
          if (bad) throw new Error(`Lệnh lỗi: ${bad}`)
        }
        if (Date.now() - t0 > START_TIMEOUT)
          throw new Error(`Chờ ${START_TIMEOUT / 60_000} phút mà cổng ${cfg.port} chưa mở. Xem log trong ô terminal; cổng trong ${LAUNCH_FILE} có đúng không?`)
        await delay(POLL_MS)
      }
    }
    const promise = run().finally(() => this.starting.delete(key))
    this.starting.set(key, {
      promise,
      cancel: () => {
        cancelled = true
      }
    })
    return promise
  }

  /** Vài dòng cuối của ô terminal (cho thông báo lỗi). */
  private tail(agentId: string, n = 3): string {
    return terminalLines(this.agents.terminalOutput(agentId))
      .filter((l) => l.trim())
      .slice(-n)
      .join(' | ')
  }

  /** Log của dev server (chữ ô terminal, đã bỏ mã màu). */
  logs(wsId: string, name: string, o: { lines?: number; search?: string } = {}): string {
    const agentId = this.cellOf(wsId, name)
    if (!agentId) throw new Error(`Dev server "${name}" was not started from stag.ai in this run, so there is no log. Start it with preview_start.`)
    let lines = terminalLines(this.agents.terminalOutput(agentId))
    while (lines.length && !lines.at(-1)!.trim()) lines.pop()
    if (o.search) {
      const q = o.search.toLowerCase()
      lines = lines.filter((l) => l.toLowerCase().includes(q))
    }
    const n = Math.min(Math.max(o.lines ?? 80, 1), 1000)
    const out = lines.slice(-n)
    const state = this.agents.isRunning(agentId) ? 'terminal running' : 'terminal closed'
    return `[${state}] last ${out.length} line(s)${o.search ? ` matching "${o.search}"` : ''}:\n${out.join('\n') || '(empty)'}`
  }

  /** Ô terminal của server (lần chạy này), còn tồn tại. */
  cellOf(wsId: string, name: string): string | null {
    const id = this.cells.get(this.key(wsId, name))
    return id && this.agents.has(id) ? id : null
  }

  /** Dừng: huỷ lần chờ đang có và đóng phiên terminal (tắt cả lệnh trong đó). Trả về false nếu không có gì để dừng. */
  stop(wsId: string, name: string): boolean {
    const key = this.key(wsId, name)
    const s = this.starting.get(key)
    s?.cancel()
    const id = this.cellOf(wsId, name)
    if (id && this.agents.isRunning(id)) {
      this.agents.stop(id)
      return true
    }
    return !!s
  }

  /**
   * Người dùng bấm "Dùng cái này" ở Tab mới: tab hiện trạng thái chờ, server lên thì mở trang trong tab đó.
   * Không chờ: kết quả báo qua trạng thái tab.
   */
  startInTab(wsId: string, cfg: LaunchConfig, tabId?: string): void {
    this.approved.add(this.approvalKey(wsId, cfg))
    const dev = { name: cfg.name, port: cfg.port, command: commandLabel(cfg), agentId: this.cellOf(wsId, cfg.name) }
    const tab = this.browser.devTab(wsId, tabId, dev)
    this.start(wsId, cfg, { onCell: (agentId) => this.browser.devUpdate(wsId, tab, { agentId }) }).then(
      (url) => this.browser.devOpen(wsId, tab, url),
      (e: Error) => this.browser.devUpdate(wsId, tab, { error: e.message })
    )
  }

  /**
   * Tool preview_* của một agent: trả lời bằng tiếng Anh cho agent. `confirm` hỏi người dùng trước khi chạy một lệnh
   * chưa được duyệt (lệnh chạy trong ô terminal của app, ngoài sandbox / chế độ quyền của agent).
   */
  agentApi(wsId: string, agentId: string, confirm?: (dev: DevServerApproval) => Promise<'allow' | 'deny' | 'timeout'>): DevServerAgentApi {
    return {
      list: async () => {
        const { saved, detected } = await this.list(wsId)
        if (!saved.length && !detected.length)
          return `No dev server found (no ${LAUNCH_FILE}, nothing runnable in package.json). Call preview_start with name, command and port to add one.`
        const line = (e: DevServerEntry, how: string): string =>
          `- ${e.name}: "${e.command}" → ${launchUrl(e)} (${how}${e.running ? ', RUNNING now' : ''}${this.cellOf(wsId, e.name) ? `, terminal cell "${devCellName(e.name)}"` : ''})`
        return [...saved.map((e) => line(e, `saved in ${LAUNCH_FILE}`)), ...detected.map((e) => line(e, 'guessed from the project, not saved yet'))].join('\n')
      },
      start: async (input) => {
        let cfg: LaunchConfig
        let source: DevServerApproval['source'] = 'agent'
        if (input.command) {
          if (!input.name || !input.port) throw new Error('To add a dev server, pass name, command and port together.')
          const parts = splitCommand(input.command)
          if (!parts) throw new Error('command is empty.')
          cfg = { name: input.name, ...parts, port: input.port, ...(input.url ? { url: input.url } : {}) }
        } else {
          cfg = await this.resolve(wsId, input.name)
          source = (await this.saved(this.ws(wsId))).some((s) => sameName(s.name, cfg.name)) ? 'saved' : 'detected'
          if (input.port) cfg = { ...cfg, port: input.port }
        }
        const approval = this.approvalKey(wsId, cfg)
        if (confirm && !this.approved.has(approval) && !this.starting.has(this.key(wsId, cfg.name)) && !(await portOpen(cfg.port))) {
          const answer = await confirm({ name: cfg.name, command: commandLabel(cfg), port: cfg.port, source })
          if (answer === 'deny') return `The user declined to run dev server "${cfg.name}" (${commandLabel(cfg)}). Do not retry; ask the user what they want instead.`
          if (answer === 'timeout')
            return `Nobody confirmed running dev server "${cfg.name}" in stag.ai in time. Tell the user to look at the confirm card, or try again when they are ready.`
          this.approved.add(approval)
        }
        const url = await this.start(wsId, cfg, { near: agentId }).catch((e: Error) => {
          throw new Error(`Dev server "${cfg.name}" did not start: ${e.message} Read preview_logs for details.`)
        })
        const cell = this.cellOf(wsId, cfg.name)
        return `Dev server "${cfg.name}" is up at ${url}${cell ? ` (running in the terminal cell "${devCellName(cfg.name)}"; config saved in ${LAUNCH_FILE})` : ' (its port was already open)'}. Open it with browser_navigate; read its output with preview_logs.`
      },
      logs: async (input) => this.logs(wsId, input.name, input),
      stop: async ({ name }) =>
        this.stop(wsId, name) ? `Stopped dev server "${name}" (its terminal cell stays; the user can restart it).` : `Dev server "${name}" is not running from stag.ai.`
    }
  }

  /** Huỷ ở Tab mới: bỏ trạng thái chờ của tab và dừng server đang khởi động. */
  cancelInTab(wsId: string, tabId: string, name: string): void {
    this.browser.devClear(wsId, tabId)
    const key = this.key(wsId, name)
    if (this.starting.has(key)) this.stop(wsId, name)
  }
}
