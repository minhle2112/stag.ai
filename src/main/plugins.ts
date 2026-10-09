import { fork } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import {
  fillSlotUrl,
  newCapabilities,
  normalizePluginConfig,
  parsePluginManifest,
  pluginToolName,
  type InstalledPlugin,
  type PluginCapability,
  type PluginEvent,
  type PluginInstallRequest,
  type PluginLog,
  type PluginManifest,
  type PluginStatus,
  type PluginTool
} from '@shared/plugins'
import { pluginOn } from '@shared/settings'
import type { Settings } from '@shared/types'
import { npmInstall, npmUninstall } from './externalAdapters'
import { readText } from './fsutil'

/**
 * Plugin của stag.ai (alpha, Cài đặt → Plugin). Mỗi plugin có worker chạy trong tiến trình riêng (Electron
 * utilityProcess; test dùng Node fork), nói JSON-RPC 2.0 qua kênh tin nhắn của tiến trình (SDK:
 * examples/stag-plugin-sdk). Plugin chỉ chạy sau khi người dùng duyệt quyền; cập nhật xin thêm quyền → chờ duyệt lại.
 * Quyền giới hạn những gì plugin làm **qua stag.ai** (API host); worker vẫn là chương trình chạy với quyền của bạn.
 *
 * userData/plugins/registry.json — danh sách đã cài (manifest, nguồn, quyền đã duyệt, cấu hình)
 * userData/plugins/npm/          — gói cài từ npm (`--ignore-scripts`)
 * userData/plugins/state/<id>.json — dữ liệu riêng của plugin (ctx.state)
 */

/** Một worker đang chạy, che khác biệt giữa utilityProcess (app) và child_process.fork (test). */
export interface WorkerProc {
  readonly pid: number | undefined
  send(m: unknown): void
  onMessage(fn: (m: unknown) => void): void
  onExit(fn: (code: number | null) => void): void
  onOutput(fn: (text: string, err: boolean) => void): void
  kill(): void
}
export type SpawnWorker = (script: string, o: { cwd: string; env: NodeJS.ProcessEnv; name: string }) => WorkerProc

/** Node fork: dùng trong test (và chạy được ngoài Electron). */
export const forkWorker: SpawnWorker = (script, o) => {
  const c = fork(script, [], { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json' })
  return {
    get pid() {
      return c.pid
    },
    send: (m) => {
      if (c.connected) c.send(m as object)
    },
    onMessage: (fn) => c.on('message', fn),
    onExit: (fn) => c.on('exit', (code) => fn(code)),
    onOutput: (fn) => {
      c.stdout?.on('data', (d) => fn(String(d), false))
      c.stderr?.on('data', (d) => fn(String(d), true))
    },
    kill: () => c.kill()
  }
}

/** Những gì plugin được làm qua stag.ai (main cài đặt, kiểm quyền ở PluginHost). */
export interface PluginHostApi {
  agents(): {
    workspaces: Array<{ id: string; name: string; path: string }>
    agents: Array<{ id: string; name: string; role: string; kind: string; workspaceId: string; running: boolean; activity: string | null }>
  }
  sendToAgent(agentId: string, text: string): Promise<void>
  board(workspaceId: string): Promise<unknown[]>
  vaultRead(workspaceId: string, rel: string): Promise<string | null>
  vaultWrite(workspaceId: string, rel: string, content: string): Promise<void>
  notify(title: string, body: string): void
}

/** Ngữ cảnh một lần gọi (workspace / agent đang xem hoặc đang gọi tool). */
export interface PluginCallContext {
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  agentId?: string
  agentName?: string
}

interface Entry {
  manifest: PluginManifest
  name: string
  version: string
  source: InstalledPlugin['source']
  dir: string
  installedAt: string
  approved: PluginCapability[]
  config: Record<string, unknown>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface Runtime {
  proc: WorkerProc | null
  status: PluginStatus
  logs: PluginLog[]
  pending: Map<string, Pending>
  nextId: number
  /** Đang chủ động dừng (không tính là lỗi, không khởi động lại). */
  stopping: boolean
  /** Lúc các lần khởi động lại gần đây (giới hạn 3 lần / 10 phút). */
  crashes: number[]
  healthTimer: ReturnType<typeof setInterval> | null
  restartTimer: ReturnType<typeof setTimeout> | null
  /** Xong khi worker hiện tại thoát. */
  exited: Promise<void>
  markExited: () => void
}

const MAX_LOGS = 200
const RESTART_WINDOW_MS = 10 * 60_000
const MAX_RESTARTS = 3
const HEALTH_MS = 30_000
const TIMEOUT = { initialize: 15_000, health: 5_000, tool: 120_000, action: 30_000, data: 15_000, config: 10_000, shutdown: 3_000 }

/** Lời gọi worker → host cần quyền gì (không có trong bảng = không cần quyền). */
const NEEDS: Record<string, PluginCapability> = {
  'state.get': 'plugin.state.read',
  'state.set': 'plugin.state.write',
  'state.delete': 'plugin.state.write',
  'agents.list': 'agents.read',
  'agent.sessions.send': 'agent.sessions.send',
  'board.list': 'board.read',
  'vault.read': 'vault.read',
  'vault.write': 'vault.write',
  notify: 'ui.notify'
}

const now = (): string => new Date().toISOString()

export class PluginHost {
  private entries: Entry[] = []
  private rt = new Map<string, Runtime>()
  private busy: Promise<unknown> = Promise.resolve()
  private changeTimer: ReturnType<typeof setTimeout> | null = null
  private settings: Settings | null = null

  constructor(
    /** userData/plugins */
    private root: string,
    private deps: { spawn: SpawnWorker; api: PluginHostApi; onChange?: (list: InstalledPlugin[]) => void; env?: NodeJS.ProcessEnv }
  ) {}

  private get file(): string {
    return join(this.root, 'registry.json')
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse((await readText(this.file)) ?? '{}') as { plugins?: Entry[] }
      this.entries = (raw.plugins ?? []).filter((e) => e?.manifest?.id)
    } catch {
      this.entries = []
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ plugins: this.entries }, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }

  private runtime(id: string): Runtime {
    let r = this.rt.get(id)
    if (!r) {
      r = {
        proc: null,
        status: { state: 'stopped', pid: null, startedAt: null, restarts: 0, lastError: null, health: null, toolCalls: 0, events: 0 },
        logs: [],
        pending: new Map(),
        nextId: 1,
        stopping: false,
        crashes: [],
        healthTimer: null,
        restartTimer: null,
        exited: Promise.resolve(),
        markExited: () => {}
      }
      this.rt.set(id, r)
    }
    return r
  }

  private get(id: string): Entry {
    const e = this.entries.find((x) => x.manifest.id === id)
    if (!e) throw new Error(`Không có plugin "${id}".`)
    return e
  }

  /** Trạng thái hiện ở giao diện (chưa duyệt / tắt suy ra từ cài đặt). */
  private info(e: Entry): InstalledPlugin {
    const r = this.runtime(e.manifest.id)
    let state = r.status.state
    const missing = newCapabilities(e.manifest, e.approved)
    if (missing.length) state = e.approved.length || !e.manifest.capabilities.length ? 'upgrade_pending' : 'approval_pending'
    else if (!this.enabled(e)) state = 'disabled'
    else if (!e.manifest.entrypoints.worker) state = 'ready'
    return { ...e, status: { ...r.status, state, pid: r.proc?.pid ?? null }, logs: r.logs.slice(-MAX_LOGS) }
  }

  list(): InstalledPlugin[] {
    return this.entries.map((e) => this.info(e))
  }

  private changed(): void {
    if (this.changeTimer) return
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null
      this.deps.onChange?.(this.list())
    }, 150)
  }

  private log(id: string, level: PluginLog['level'], message: string): void {
    const r = this.runtime(id)
    for (const line of message.split(/\r?\n/).filter((l) => l.trim())) r.logs.push({ at: now(), level, message: line.slice(0, 2000) })
    if (r.logs.length > MAX_LOGS) r.logs.splice(0, r.logs.length - MAX_LOGS)
    this.changed()
  }

  private enabled(e: Entry): boolean {
    return this.settings ? pluginOn(this.settings, e.manifest.id) : true
  }

  /** Plugin được chạy: đã duyệt đủ quyền và bật ở cấp app. */
  private runnable(e: Entry): boolean {
    return !newCapabilities(e.manifest, e.approved).length && this.enabled(e)
  }

  // ---- cài / gỡ ----

  install(req: PluginInstallRequest): Promise<InstalledPlugin> {
    const p = this.busy.then(() => this.doInstall(req))
    this.busy = p.catch(() => {})
    return p
  }

  private async doInstall(req: PluginInstallRequest): Promise<InstalledPlugin> {
    let dir: string
    let source: Entry['source']
    if (req.type === 'npm') {
      const name = req.name.trim()
      const version = (req.version ?? '').trim() || 'latest'
      dir = await npmInstall(join(this.root, 'npm'), 'stag-plugins', name, version)
      source = { type: 'npm', name, version }
    } else {
      dir = resolve(req.path.trim())
      const st = await fs.stat(dir).catch(() => null)
      if (!st?.isDirectory()) throw new Error(`Không thấy thư mục "${req.path}".`)
      source = { type: 'local', path: dir }
    }
    const text = await readText(join(dir, 'package.json'))
    if (!text) throw new Error(`Không thấy package.json trong "${dir}".`)
    let pkg: unknown
    try {
      pkg = JSON.parse(text)
    } catch {
      throw new Error('package.json của gói không phải JSON hợp lệ.')
    }
    const { manifest, name, version } = parsePluginManifest(pkg)
    if (manifest.entrypoints.worker) {
      const script = resolve(dir, manifest.entrypoints.worker)
      if (!script.startsWith(dir + sep) || !(await fs.stat(script).catch(() => null))?.isFile())
        throw new Error(`Không thấy file worker "${manifest.entrypoints.worker}" trong gói.`)
    }
    const old = this.entries.find((e) => e.manifest.id === manifest.id)
    if (old && !sameSource(old.source, source)) throw new Error(`Đã có plugin "${manifest.id}" (${old.manifest.displayName}) cài từ nguồn khác. Gỡ nó trước rồi cài lại.`)
    const entry: Entry = {
      manifest,
      name,
      version,
      source,
      dir,
      installedAt: old?.installedAt ?? now(),
      // Cài lại: giữ quyền đã duyệt (chỉ những quyền manifest mới vẫn xin); quyền mới → chờ duyệt.
      approved: old ? old.approved.filter((c) => manifest.capabilities.includes(c)) : [],
      config: normalizePluginConfig(manifest.instanceConfigSchema, old?.config ?? {}).config
    }
    if (old) await this.stop(old.manifest.id)
    this.entries = old ? this.entries.map((e) => (e === old ? entry : e)) : [...this.entries, entry]
    await this.save()
    this.log(manifest.id, 'info', `${old ? 'Cài lại' : 'Cài'} ${name}@${version} từ ${source.type === 'npm' ? 'npm' : source.path}`)
    if (this.runnable(entry)) await this.start(manifest.id)
    this.changed()
    return this.info(entry)
  }

  /** Người dùng duyệt quyền (lần cài đầu / cập nhật xin thêm quyền). */
  async approve(id: string): Promise<InstalledPlugin> {
    const e = this.get(id)
    e.approved = [...e.manifest.capabilities]
    await this.save()
    this.log(id, 'info', `Đã duyệt quyền: ${e.approved.join(', ') || '(không có)'}`)
    if (this.runnable(e)) await this.start(id)
    this.changed()
    return this.info(e)
  }

  async remove(id: string): Promise<void> {
    const e = this.get(id)
    await this.stop(id)
    if (e.source.type === 'npm') {
      const name = e.source.name
      await (this.busy = this.busy.then(() => npmUninstall(join(this.root, 'npm'), name)))
    }
    this.entries = this.entries.filter((x) => x !== e)
    this.rt.delete(id)
    await this.save()
    await fs.rm(join(this.root, 'state', `${id}.json`), { force: true })
    this.changed()
  }

  /** Đọc lại gói (thư mục cục bộ) / cài lại cùng phiên bản (npm). */
  reload(id: string): Promise<InstalledPlugin> {
    const e = this.get(id)
    return this.install(e.source.type === 'npm' ? { type: 'npm', name: e.source.name, version: e.source.version } : { type: 'local', path: e.source.path })
  }

  /** Lưu cấu hình: kiểm theo schema, rồi hỏi worker (validateConfig) nếu đang chạy; xong báo configChanged. */
  async setConfig(id: string, raw: Record<string, unknown>): Promise<InstalledPlugin> {
    const e = this.get(id)
    const { config, errors } = normalizePluginConfig(e.manifest.instanceConfigSchema, raw)
    const bad = Object.entries(errors)
    if (bad.length) throw new Error(bad.map(([k, m]) => `${e.manifest.instanceConfigSchema?.properties[k]?.title ?? k}: ${m}`).join(' '))
    const r = this.runtime(id)
    if (r.proc && r.status.state === 'ready') {
      const v = (await this.call(id, 'validateConfig', { config }, TIMEOUT.config)) as { ok?: boolean; errors?: string[] } | null
      if (v && v.ok === false) throw new Error((v.errors ?? ['Plugin không nhận cấu hình này.']).join(' '))
    }
    e.config = config
    await this.save()
    if (r.proc && r.status.state === 'ready') await this.call(id, 'configChanged', { config }, TIMEOUT.config).catch((err) => this.log(id, 'warn', `configChanged: ${err.message}`))
    this.changed()
    return this.info(e)
  }

  // ---- chạy / dừng worker ----

  /** Cài đặt đổi (hoặc lúc mở app): bật thì chạy, tắt ở cấp app thì dừng. */
  async applySettings(s: Settings): Promise<void> {
    this.settings = s
    for (const e of this.entries) {
      const r = this.runtime(e.manifest.id)
      const want = this.runnable(e) && !!e.manifest.entrypoints.worker
      if (want && !r.proc && r.status.state !== 'error' && !r.restartTimer) await this.start(e.manifest.id)
      else if (!want && r.proc) await this.stop(e.manifest.id)
    }
    this.changed()
  }

  async restart(id: string): Promise<InstalledPlugin> {
    const e = this.get(id)
    await this.stop(id)
    const r = this.runtime(id)
    r.crashes = []
    r.status.lastError = null
    r.status.state = 'stopped'
    if (this.runnable(e)) await this.start(id)
    this.changed()
    return this.info(e)
  }

  private async start(id: string): Promise<void> {
    const e = this.get(id)
    const r = this.runtime(id)
    if (!e.manifest.entrypoints.worker || r.proc) return
    if (r.restartTimer) clearTimeout(r.restartTimer)
    r.restartTimer = null
    const script = resolve(e.dir, e.manifest.entrypoints.worker)
    r.stopping = false
    r.status = { ...r.status, state: 'starting', startedAt: now(), lastError: null, health: null }
    this.changed()
    let proc: WorkerProc
    try {
      proc = this.deps.spawn(script, {
        cwd: e.dir,
        name: e.manifest.displayName,
        env: { ...(this.deps.env ?? process.env), STAG_PLUGIN_ID: id, STAG_PLUGIN_DIR: e.dir, STAG_PLUGIN_DATA: join(this.root, 'state') }
      })
    } catch (err) {
      this.fail(id, `Không chạy được worker: ${(err as Error).message}`)
      return
    }
    r.proc = proc
    r.exited = new Promise((res) => (r.markExited = res))
    proc.onOutput((text, isErr) => this.log(id, isErr ? 'warn' : 'info', text))
    proc.onMessage((m) => void this.onMessage(id, proc, m))
    proc.onExit((code) => {
      r.markExited()
      this.onExit(id, proc, code)
    })
    try {
      await this.call(id, 'initialize', { manifest: e.manifest, config: e.config, host: { name: 'stag.ai', apiVersion: e.manifest.apiVersion } }, TIMEOUT.initialize)
    } catch (err) {
      this.log(id, 'error', `initialize lỗi: ${(err as Error).message}`)
      r.stopping = true
      proc.kill()
      r.proc = null
      this.fail(id, `Worker khởi động lỗi: ${(err as Error).message}`)
      return
    }
    if (r.proc !== proc) return
    r.status.state = 'ready'
    this.log(id, 'info', `Worker chạy (pid ${proc.pid ?? '?'})`)
    r.healthTimer = setInterval(() => void this.checkHealth(id), HEALTH_MS)
    this.changed()
  }

  private fail(id: string, message: string): void {
    const r = this.runtime(id)
    r.status.state = 'error'
    r.status.lastError = message
    this.changed()
  }

  private async stop(id: string): Promise<void> {
    const r = this.rt.get(id)
    if (!r) return
    if (r.restartTimer) clearTimeout(r.restartTimer)
    r.restartTimer = null
    if (r.healthTimer) clearInterval(r.healthTimer)
    r.healthTimer = null
    const proc = r.proc
    if (!proc) return
    r.stopping = true
    await this.call(id, 'shutdown', {}, TIMEOUT.shutdown).catch(() => {})
    proc.kill()
    // Chờ tiến trình thoát hẳn (Windows: thư mục của gói còn bị khoá tới lúc đó).
    await Promise.race([r.exited, new Promise((res) => setTimeout(res, 3000))])
    r.proc = null
    for (const p of r.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('Plugin đã dừng'))
    }
    r.pending.clear()
    r.status.state = 'stopped'
    this.changed()
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.entries.map((e) => this.stop(e.manifest.id)))
  }

  private onExit(id: string, proc: WorkerProc, code: number | null): void {
    const r = this.runtime(id)
    if (r.proc !== proc) return
    r.proc = null
    if (r.healthTimer) clearInterval(r.healthTimer)
    r.healthTimer = null
    for (const p of r.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(`Worker thoát (mã ${code})`))
    }
    r.pending.clear()
    if (r.stopping) return
    const t = Date.now()
    r.crashes = r.crashes.filter((x) => t - x < RESTART_WINDOW_MS)
    r.crashes.push(t)
    r.status.restarts++
    this.log(id, 'error', `Worker thoát bất ngờ (mã ${code})`)
    if (r.crashes.length > MAX_RESTARTS) {
      this.fail(id, `Worker lỗi ${MAX_RESTARTS} lần trong 10 phút, đã dừng. Bấm "Khởi động lại" sau khi sửa.`)
      return
    }
    r.status.state = 'starting'
    r.restartTimer = setTimeout(() => {
      r.restartTimer = null
      const e = this.entries.find((x) => x.manifest.id === id)
      if (e && this.runnable(e)) void this.start(id)
    }, 1000 * r.crashes.length)
    this.changed()
  }

  private async checkHealth(id: string): Promise<void> {
    const r = this.runtime(id)
    if (!r.proc || r.status.state !== 'ready') return
    try {
      const h = (await this.call(id, 'health', {}, TIMEOUT.health)) as { status?: string; message?: string } | null
      r.status.health = { ok: (h?.status ?? 'ok') === 'ok', message: h?.message, at: now() }
    } catch (err) {
      r.status.health = { ok: false, message: (err as Error).message, at: now() }
    }
    this.changed()
  }

  /** Kiểm sức khoẻ ngay (nút trên trang Trạng thái). */
  async health(id: string): Promise<InstalledPlugin> {
    await this.checkHealth(id)
    return this.info(this.get(id))
  }

  // ---- JSON-RPC ----

  private call(id: string, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const r = this.runtime(id)
    const proc = r.proc
    if (!proc) return Promise.reject(new Error('Worker của plugin không chạy.'))
    const rid = `h${r.nextId++}`
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        r.pending.delete(rid)
        rej(new Error(`Plugin không trả lời ${method} sau ${Math.round(timeoutMs / 1000)} giây.`))
      }, timeoutMs)
      r.pending.set(rid, { resolve: res, reject: rej, timer })
      proc.send({ jsonrpc: '2.0', id: rid, method, params })
    })
  }

  private notifyWorker(id: string, method: string, params: unknown): void {
    this.runtime(id).proc?.send({ jsonrpc: '2.0', method, params })
  }

  private async onMessage(id: string, proc: WorkerProc, raw: unknown): Promise<void> {
    const m = raw as { jsonrpc?: string; id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string } }
    if (!m || m.jsonrpc !== '2.0') return
    const r = this.runtime(id)
    if (m.method === undefined && m.id !== undefined) {
      const p = r.pending.get(String(m.id))
      if (!p) return
      r.pending.delete(String(m.id))
      clearTimeout(p.timer)
      if (m.error) p.reject(new Error(m.error.message ?? 'Lỗi từ plugin'))
      else p.resolve(m.result)
      return
    }
    if (m.method === 'log') {
      const level = m.params?.level === 'error' || m.params?.level === 'warn' ? m.params.level : 'info'
      this.log(id, level, String(m.params?.message ?? ''))
      return
    }
    if (m.id === undefined || !m.method) return
    const reply = (body: { result?: unknown; error?: { code: number; message: string } }): void => {
      if (r.proc === proc) proc.send({ jsonrpc: '2.0', id: m.id, ...body })
    }
    try {
      reply({ result: (await this.hostCall(id, m.method, m.params ?? {})) ?? null })
    } catch (err) {
      reply({ error: { code: (err as { code?: number }).code ?? -32099, message: (err as Error).message } })
    }
  }

  /** Lời gọi worker → host, kiểm quyền đã duyệt. */
  private async hostCall(id: string, method: string, p: Record<string, unknown>): Promise<unknown> {
    const e = this.get(id)
    const need = NEEDS[method]
    if (need && !e.approved.includes(need)) throw Object.assign(new Error(`Plugin chưa được cấp quyền "${need}".`), { code: -32001 })
    const api = this.deps.api
    const s = (v: unknown, max = 100_000): string => {
      if (typeof v !== 'string' || !v || v.length > max) throw Object.assign(new Error('Tham số không hợp lệ'), { code: -32602 })
      return v
    }
    switch (method) {
      case 'config.get':
        return e.config
      case 'state.get':
        return (await this.readState(id))[stateKey(p)]
      case 'state.set': {
        const st = await this.readState(id)
        st[stateKey(p)] = p.value
        await this.writeState(id, st)
        return null
      }
      case 'state.delete': {
        const st = await this.readState(id)
        delete st[stateKey(p)]
        await this.writeState(id, st)
        return null
      }
      case 'agents.list':
        return api.agents()
      case 'agent.sessions.send':
        await api.sendToAgent(s(p.agentId), s(p.text, 20_000))
        return null
      case 'board.list':
        return api.board(s(p.workspaceId))
      case 'vault.read':
        return api.vaultRead(s(p.workspaceId), s(p.path, 1000))
      case 'vault.write':
        await api.vaultWrite(s(p.workspaceId), s(p.path, 1000), typeof p.content === 'string' ? p.content : '')
        return null
      case 'notify':
        api.notify(s(p.title, 200), typeof p.body === 'string' ? p.body.slice(0, 500) : '')
        return null
      default:
        throw Object.assign(new Error(`stag.ai không có method "${method}"`), { code: -32601 })
    }
  }

  private stateWrites = new Map<string, Promise<void>>()

  private async readState(id: string): Promise<Record<string, unknown>> {
    await this.stateWrites.get(id)
    try {
      return JSON.parse((await readText(join(this.root, 'state', `${id}.json`))) ?? '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private async writeState(id: string, st: Record<string, unknown>): Promise<void> {
    const text = JSON.stringify(st)
    if (text.length > 5_000_000) throw new Error('Dữ liệu của plugin vượt 5 MB.')
    const p = (async () => {
      await fs.mkdir(join(this.root, 'state'), { recursive: true })
      await fs.writeFile(join(this.root, 'state', `${id}.json`), text, 'utf8')
    })()
    this.stateWrites.set(id, p.catch(() => {}))
    await p
  }

  // ---- sự kiện, tool, slot ----

  /** Gửi sự kiện cho plugin đang chạy, có quyền, có khai sự kiện đó, và bật ở workspace / agent liên quan. */
  emit(ev: PluginEvent): void {
    for (const e of this.entries) {
      const r = this.rt.get(e.manifest.id)
      if (!r?.proc || r.status.state !== 'ready') continue
      if (!e.approved.includes('events.subscribe') || !e.manifest.events.includes(ev.type)) continue
      if (this.settings && !pluginOn(this.settings, e.manifest.id, ev.workspaceId, ev.agentId)) continue
      r.status.events++
      this.notifyWorker(e.manifest.id, 'onEvent', { event: ev })
    }
    this.changed()
  }

  /** Tool của plugin cho một agent (máy chủ MCP stag): plugin chạy, đã duyệt agent.tools.register, bật cho agent đó. */
  toolsFor(workspaceId: string, agentId: string): Array<{ pluginId: string; mcpName: string; tool: PluginTool }> {
    const out: Array<{ pluginId: string; mcpName: string; tool: PluginTool }> = []
    for (const e of this.entries) {
      const r = this.rt.get(e.manifest.id)
      if (!r?.proc || r.status.state !== 'ready' || !e.approved.includes('agent.tools.register')) continue
      if (this.settings && !pluginOn(this.settings, e.manifest.id, workspaceId, agentId)) continue
      for (const tool of e.manifest.tools) out.push({ pluginId: e.manifest.id, mcpName: pluginToolName(e.manifest.id, tool.name), tool })
    }
    return out
  }

  async callTool(id: string, name: string, params: unknown, ctx: PluginCallContext): Promise<{ text: string; isError: boolean }> {
    const r = this.runtime(id)
    r.status.toolCalls++
    this.changed()
    try {
      const res = (await this.call(id, 'executeTool', { name, params, context: ctx }, TIMEOUT.tool)) as { content?: unknown; isError?: boolean } | null
      const c = res?.content
      return { text: typeof c === 'string' ? c : JSON.stringify(c ?? null), isError: !!res?.isError }
    } catch (err) {
      this.log(id, 'error', `Tool ${name}: ${(err as Error).message}`)
      return { text: `Plugin ${id}: ${(err as Error).message}`, isError: true }
    }
  }

  /**
   * Người dùng bấm một slot: `open` → điền URL (cấu hình + ngữ cảnh); `action` → performAction của worker.
   * Kết quả: { openUrl, target } để giao diện mở, hoặc { message } để hiện.
   */
  async runSlot(id: string, slotId: string, ctx: PluginCallContext): Promise<{ openUrl?: string; target?: 'browser' | 'external'; message?: string }> {
    const e = this.get(id)
    if (!this.runnable(e)) throw new Error(`Plugin ${e.manifest.displayName} chưa được duyệt quyền hoặc đang tắt.`)
    const slot = e.manifest.ui.slots.find((x) => x.id === slotId)
    if (!slot) throw new Error(`Plugin không có slot "${slotId}".`)
    if (slot.open) {
      const url = fillSlotUrl(slot.open.url, {
        config: e.config,
        workspace: ctx.workspaceId ? { id: ctx.workspaceId, name: ctx.workspaceName ?? '', path: ctx.workspacePath ?? '' } : undefined,
        agent: ctx.agentId ? { id: ctx.agentId, name: ctx.agentName ?? '' } : undefined
      })
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error(`Địa chỉ không hợp lệ: "${url}". Kiểm tra cấu hình của plugin.`)
      return { openUrl: url, target: slot.open.target }
    }
    const res = (await this.call(id, 'performAction', { key: slot.action, params: {}, context: ctx }, TIMEOUT.action)) as Record<string, unknown> | null
    const out: { openUrl?: string; target?: 'browser' | 'external'; message?: string } = {}
    if (typeof res?.openUrl === 'string' && /^https?:\/\/\S+$/i.test(res.openUrl)) {
      out.openUrl = res.openUrl
      out.target = res.target === 'external' ? 'external' : 'browser'
    }
    if (typeof res?.message === 'string') out.message = res.message.slice(0, 1000)
    return out
  }
}

function stateKey(p: Record<string, unknown>): string {
  const key = typeof p.key === 'string' ? p.key : ''
  if (!key || key.length > 200) throw Object.assign(new Error('Khoá dữ liệu không hợp lệ'), { code: -32602 })
  return typeof p.scope === 'string' && p.scope ? `${p.scope.slice(0, 100)}:${key}` : key
}

function sameSource(a: Entry['source'], b: Entry['source']): boolean {
  if (a.type === 'npm' && b.type === 'npm') return a.name === b.name
  if (a.type === 'local' && b.type === 'local') return resolve(a.path).toLowerCase() === resolve(b.path).toLowerCase()
  return false
}
