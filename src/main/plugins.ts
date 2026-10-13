import { fork } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import {
  fillSlotUrl,
  newCapabilities,
  nextCronRun,
  normalizePluginConfig,
  parsePluginManifest,
  PLUGIN_ID_RE,
  pluginFolderFor,
  pluginToolName,
  RESERVED_PLUGIN_IDS,
  type InstalledPlugin,
  type PluginCatalogEntry,
  type PluginCapability,
  type PluginEvent,
  type PluginInstallRequest,
  type PluginJobRun,
  type PluginLog,
  type PluginManifest,
  type PluginScaffoldRequest,
  type PluginStatus,
  type PluginTool,
  type PluginWebhookDelivery
} from '@shared/plugins'
import { pluginOn } from '@shared/settings'
import type { Settings } from '@shared/types'
import { npmInstall, npmUninstall } from './externalAdapters'
import { isInside, readText, realPathInside, relSlash } from './fsutil'
import { isObject, JsonFile } from './jsonFile'
import { scaffoldFiles } from './pluginScaffold'

/**
 * Plugin của stag.ai (alpha, Cài đặt → Plugin). Mỗi plugin có worker chạy trong tiến trình riêng (Electron
 * utilityProcess; test dùng Node fork), nói JSON-RPC 2.0 qua kênh tin nhắn của tiến trình (SDK:
 * resources/plugin-sdk). Plugin chỉ chạy sau khi người dùng duyệt quyền; cập nhật xin thêm quyền → chờ duyệt lại.
 * Quyền giới hạn những gì plugin làm **qua stag.ai** (API host); worker vẫn là chương trình chạy với quyền của bạn.
 *
 * userData/plugins/registry.json — danh sách đã cài (manifest, nguồn, quyền đã duyệt, cấu hình)
 * userData/plugins/npm/          — gói cài từ npm (`--ignore-scripts`)
 * userData/plugins/state/<id>.json — dữ liệu riêng của plugin (ctx.state)
 * userData/plugins/webhooks.json — cổng máy chủ webhook (giữ nguyên giữa các lần mở app)
 *
 * Trang của plugin (slot page / settingsPage) là file trong thư mục `entrypoints.ui`, mở trong iframe cách ly qua
 * giao thức `stag-plugin://<id>/…` (uiFile + uiHeaders); trang gọi app qua postMessage → bridge().
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
  /** Thư mục dự án + vault của workspace (files.list / files.read), null = không có workspace này. */
  workspacePaths(workspaceId: string): { path: string; vaultPath: string } | null
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
  /** Lúc người dùng duyệt plugin (kể cả plugin không xin quyền nào: worker vẫn là một tiến trình Node). Vắng = chưa duyệt. */
  approvedAt?: string
  config: Record<string, unknown>
  /** Mã bí mật trong địa chỉ webhook (chỉ ở userData, không ra vault). */
  webhookToken?: string
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
  /** Lần chạy kế tiếp của từng việc theo lịch (ms), tính lúc worker sẵn sàng. */
  jobNext: Map<string, number>
  jobRunning: Set<string>
  jobRuns: PluginJobRun[]
  deliveries: PluginWebhookDelivery[]
}

/** Một yêu cầu webhook (đã đọc thân). */
export interface WebhookRequest {
  method: string
  headers: Record<string, string>
  query: Record<string, string>
  rawBody: string
}

const MAX_LOGS = 200
const RESTART_WINDOW_MS = 10 * 60_000
const MAX_RESTARTS = 3
const HEALTH_MS = 30_000
const TIMEOUT = { initialize: 15_000, health: 5_000, tool: 120_000, action: 30_000, data: 15_000, config: 10_000, shutdown: 3_000, job: 10 * 60_000, webhook: 30_000 }
const MAX_RUNS = 30
const JOB_TICK_MS = 15_000
/** Lời gọi từ trang của plugin (iframe) được chuyển cho host như lời gọi của worker. */
const BRIDGE_HOST_METHODS = ['config.get', 'state.get', 'state.set', 'state.delete', 'agents.list', 'agent.sessions.send', 'board.list', 'vault.read', 'vault.write', 'files.list', 'files.read', 'notify']
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
}

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
  'files.list': 'files.read',
  'files.read': 'files.read',
  notify: 'ui.notify'
}

const now = (): string => new Date().toISOString()

export class PluginHost {
  private entries: Entry[] = []
  private rt = new Map<string, Runtime>()
  private busy: Promise<unknown> = Promise.resolve()
  private changeTimer: ReturnType<typeof setTimeout> | null = null
  private settings: Settings | null = null
  private jobTimer: ReturnType<typeof setInterval> | null = null
  /** Gốc địa chỉ webhook, vd. http://127.0.0.1:43123 (máy chủ webhook đặt khi chạy). */
  private webhookBase: string | null = null

  constructor(
    /** userData/plugins */
    private root: string,
    private deps: {
      spawn: SpawnWorker
      api: PluginHostApi
      onChange?: (list: InstalledPlugin[]) => void
      /** Worker gửi dữ liệu trực tiếp cho trang của nó (ctx.streams.emit). */
      onStream?: (pluginId: string, channel: string, data: unknown) => void
      env?: NodeJS.ProcessEnv
      /** resources/plugin-catalog: plugin kèm app (mục "Có sẵn"). */
      catalogDir?: string
      /** resources/plugin-sdk/stag-plugin-sdk.mjs: chép vào plugin mới tạo từ mẫu. */
      sdkFile?: string
    }
  ) {}

  get dataRoot(): string {
    return this.root
  }

  private get file(): string {
    return join(this.root, 'registry.json')
  }
  private jsonFile?: JsonFile
  private get json(): JsonFile {
    return (this.jsonFile ??= new JsonFile(this.file))
  }

  async load(): Promise<void> {
    const raw = ((await this.json.read(isObject)).data ?? {}) as { plugins?: Entry[] }
    this.entries = (Array.isArray(raw.plugins) ? raw.plugins : []).filter((e) => e?.manifest?.id)
    // Bản cũ chưa có approvedAt: plugin đã được duyệt quyền thì coi như đã duyệt; plugin 0 quyền phải duyệt một lần.
    for (const e of this.entries) if (!e.approvedAt && e.approved?.length) e.approvedAt = e.installedAt
    // Plugin kèm app: thư mục và manifest theo bản app hiện tại (cập nhật app xin thêm quyền → chờ duyệt lại).
    for (const e of this.entries) {
      if (e.source.type !== 'catalog' || !this.deps.catalogDir) continue
      e.dir = join(this.deps.catalogDir, e.source.slug)
      try {
        const { manifest, name, version } = parsePluginManifest(JSON.parse((await readText(join(e.dir, 'package.json'))) ?? ''))
        if (manifest.id === e.manifest.id) Object.assign(e, { manifest, name, version, config: normalizePluginConfig(manifest.instanceConfigSchema, e.config).config })
      } catch {
        // App bỏ plugin này khỏi danh mục: giữ bản ghi, worker sẽ báo lỗi không thấy file.
      }
    }
  }

  // ---- danh mục kèm app, tạo plugin mới ----

  /** Plugin kèm app (mỗi thư mục con của catalogDir có package.json với stagPlugin hợp lệ). */
  async catalog(): Promise<PluginCatalogEntry[]> {
    const root = this.deps.catalogDir
    if (!root) return []
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const out: PluginCatalogEntry[] = []
    for (const d of dirs) {
      if (!d.isDirectory() || !/^[a-z0-9-]+$/.test(d.name)) continue
      try {
        const { manifest, name, version } = parsePluginManifest(JSON.parse((await readText(join(root, d.name, 'package.json'))) ?? ''))
        out.push({ slug: d.name, name, version, manifest, installed: this.entries.some((e) => e.manifest.id === manifest.id) })
      } catch {
        // bỏ qua thư mục hỏng
      }
    }
    return out.sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName))
  }

  /** Tạo plugin mới từ mẫu trong `<parentDir>/stag-plugin-<tên>` rồi cài tại chỗ (chờ duyệt quyền như mọi plugin). */
  async scaffold(req: PluginScaffoldRequest): Promise<InstalledPlugin> {
    const name = req.name.trim()
    const id = req.id.trim()
    if (!name || name.length > 60 || /[\r\n]/.test(name)) throw new Error('Tên plugin: 1–60 ký tự, một dòng.')
    if (!PLUGIN_ID_RE.test(id) || RESERVED_PLUGIN_IDS.includes(id)) throw new Error('Mã plugin chỉ gồm a-z, 0-9, ".", "_", "-" (2–64 ký tự), vd. "my.bao-cao".')
    if (this.entries.some((e) => e.manifest.id === id)) throw new Error(`Đã có plugin mã "${id}".`)
    if (!this.deps.sdkFile) throw new Error('Không thấy SDK plugin kèm app.')
    const parent = resolve(req.parentDir.trim())
    if (!(await fs.stat(parent).catch(() => null))?.isDirectory()) throw new Error(`Không thấy thư mục "${req.parentDir}".`)
    const dir = join(parent, pluginFolderFor(id))
    if ((await fs.readdir(dir).catch(() => [])).length) throw new Error(`Thư mục "${dir}" đã có file. Chọn chỗ khác hoặc đổi mã.`)
    for (const [rel, text] of Object.entries(scaffoldFiles({ ...req, name, id }))) {
      await fs.mkdir(join(dir, rel, '..'), { recursive: true })
      await fs.writeFile(join(dir, rel), text, 'utf8')
    }
    await fs.copyFile(this.deps.sdkFile, join(dir, 'stag-plugin-sdk.mjs'))
    return this.install({ type: 'local', path: dir })
  }

  private async save(): Promise<void> {
    await this.json.write({ plugins: this.entries })
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
        markExited: () => {},
        jobNext: new Map(),
        jobRunning: new Set(),
        jobRuns: [],
        deliveries: []
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
    if (!e.approvedAt) state = 'approval_pending'
    else if (missing.length) state = 'upgrade_pending'
    else if (!this.enabled(e)) state = 'disabled'
    else if (!e.manifest.entrypoints.worker) state = 'ready'
    const { webhookToken, ...rest } = e
    const webhookUrls: Record<string, string> = {}
    if (this.webhookBase && webhookToken)
      for (const w of e.manifest.webhooks) webhookUrls[w.endpointKey] = `${this.webhookBase}/plugins/${encodeURIComponent(e.manifest.id)}/webhooks/${w.endpointKey}?token=${webhookToken}`
    return {
      ...rest,
      status: { ...r.status, state, pid: r.proc?.pid ?? null },
      logs: r.logs.slice(-MAX_LOGS),
      jobs: e.manifest.jobs.map((j) => {
        const next = r.jobNext.get(j.key)
        return { key: j.key, nextRun: next && state === 'ready' ? new Date(next).toISOString() : null, running: r.jobRunning.has(j.key) }
      }),
      jobRuns: r.jobRuns.slice(),
      webhookUrls,
      deliveries: r.deliveries.slice()
    }
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
    return !!e.approvedAt && !newCapabilities(e.manifest, e.approved).length && this.enabled(e)
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
    } else if (req.type === 'catalog') {
      if (!this.deps.catalogDir || !/^[a-z0-9-]+$/.test(req.slug) || !(await this.catalog()).some((c) => c.slug === req.slug))
        throw new Error(`Không có plugin "${req.slug}" trong danh mục kèm app.`)
      dir = join(this.deps.catalogDir, req.slug)
      source = { type: 'catalog', slug: req.slug }
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
      ...(old?.approvedAt ? { approvedAt: old.approvedAt } : {}),
      config: normalizePluginConfig(manifest.instanceConfigSchema, old?.config ?? {}).config,
      ...(manifest.webhooks.length || old?.webhookToken ? { webhookToken: old?.webhookToken ?? newToken() } : {})
    }
    if (manifest.entrypoints.ui) {
      const ui = resolve(dir, manifest.entrypoints.ui)
      if (!ui.startsWith(dir + sep) || !(await fs.stat(ui).catch(() => null))?.isDirectory())
        throw new Error(`Không thấy thư mục giao diện "${manifest.entrypoints.ui}" trong gói.`)
    }
    if (old) await this.stop(old.manifest.id)
    this.entries = old ? this.entries.map((e) => (e === old ? entry : e)) : [...this.entries, entry]
    await this.save()
    this.log(manifest.id, 'info', `${old ? 'Cài lại' : 'Cài'} ${name}@${version} từ ${source.type === 'npm' ? 'npm' : source.type === 'catalog' ? 'danh mục kèm app' : source.path}`)
    if (this.runnable(entry)) await this.start(manifest.id)
    this.changed()
    return this.info(entry)
  }

  /** Người dùng duyệt quyền (lần cài đầu / cập nhật xin thêm quyền). */
  async approve(id: string): Promise<InstalledPlugin> {
    const e = this.get(id)
    e.approved = [...e.manifest.capabilities]
    e.approvedAt = now()
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
    const s = e.source
    return this.install(s.type === 'npm' ? { type: 'npm', name: s.name, version: s.version } : s.type === 'catalog' ? { type: 'catalog', slug: s.slug } : { type: 'local', path: s.path })
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
    this.planJobs(e, r, new Date())
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
    if (m.method === 'streams.emit') {
      const channel = typeof m.params?.channel === 'string' ? m.params.channel.slice(0, 100) : ''
      if (channel) this.deps.onStream?.(id, channel, m.params?.data ?? null)
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
        return this.updateState(id, (st) => ({ result: st[stateKey(p)], changed: false }))
      case 'state.set':
        return this.updateState(id, (st) => {
          st[stateKey(p)] = p.value
          return { result: null, changed: true }
        })
      case 'state.delete':
        return this.updateState(id, (st) => {
          delete st[stateKey(p)]
          return { result: null, changed: true }
        })
      case 'agents.list': {
        // Chỉ workspace / agent mà plugin đang bật.
        const all = api.agents()
        return {
          ...all,
          workspaces: all.workspaces.filter((w) => this.onIn(id, w.id)),
          agents: all.agents.filter((a) => this.onIn(id, a.workspaceId, a.id))
        }
      }
      case 'agent.sessions.send': {
        const agentId = s(p.agentId)
        const a = api.agents().agents.find((x) => x.id === agentId)
        if (a && !this.onIn(id, a.workspaceId, a.id)) throw Object.assign(new Error('Plugin đang tắt ở agent / workspace này.'), { code: -32001 })
        await api.sendToAgent(agentId, s(p.text, 20_000))
        return null
      }
      case 'board.list':
        return api.board(this.wsOn(id, s(p.workspaceId)))
      case 'vault.read':
        return api.vaultRead(this.wsOn(id, s(p.workspaceId)), s(p.path, 1000))
      case 'vault.write':
        await api.vaultWrite(this.wsOn(id, s(p.workspaceId)), s(p.path, 1000), typeof p.content === 'string' ? p.content : '')
        return null
      case 'files.list': {
        const ws = this.filesWorkspace(id, s(p.workspaceId))
        return listProjectDir(ws.path, ws.vaultPath, typeof p.path === 'string' ? p.path.slice(0, 1000) : '')
      }
      case 'files.read': {
        const ws = this.filesWorkspace(id, s(p.workspaceId))
        return readProjectText(ws.path, ws.vaultPath, s(p.path, 1000))
      }
      case 'notify':
        api.notify(s(p.title, 200), typeof p.body === 'string' ? p.body.slice(0, 500) : '')
        return null
      default:
        throw Object.assign(new Error(`stag.ai không có method "${method}"`), { code: -32601 })
    }
  }

  /** Plugin bật ở workspace / agent này (Cài đặt → Plugin theo cấp). */
  private onIn(id: string, workspaceId: string, agentId?: string): boolean {
    return !this.settings || pluginOn(this.settings, id, workspaceId, agentId)
  }

  /** `workspaceId` nếu plugin bật ở đó, không thì lỗi (board / vault của workspace đã tắt plugin). */
  private wsOn(id: string, workspaceId: string): string {
    if (!this.onIn(id, workspaceId)) throw Object.assign(new Error('Plugin đang tắt ở workspace này.'), { code: -32001 })
    return workspaceId
  }

  /** Workspace cho files.*: phải có, và plugin không bị tắt ở workspace đó. */
  private filesWorkspace(id: string, workspaceId: string): { path: string; vaultPath: string } {
    const ws = this.deps.api.workspacePaths(workspaceId)
    if (!ws) throw Object.assign(new Error('Không có workspace này.'), { code: -32602 })
    if (this.settings && !pluginOn(this.settings, id, workspaceId)) throw Object.assign(new Error('Plugin đang tắt ở workspace này.'), { code: -32001 })
    return ws
  }

  /** Lần đọc / ghi trạng thái đang chờ theo plugin: nối đuôi nhau, hai lời gọi song song không mất thay đổi của nhau. */
  private stateChain = new Map<string, Promise<unknown>>()

  private updateState<T>(id: string, fn: (st: Record<string, unknown>) => { result: T; changed: boolean }): Promise<T> {
    const file = join(this.root, 'state', `${id}.json`)
    const run = async (): Promise<T> => {
      let st: Record<string, unknown>
      try {
        st = JSON.parse((await readText(file)) ?? '{}') as Record<string, unknown>
      } catch {
        st = {}
      }
      const { result, changed } = fn(st)
      if (!changed) return result
      const text = JSON.stringify(st)
      if (text.length > 5_000_000) throw new Error('Dữ liệu của plugin vượt 5 MB.')
      await fs.mkdir(dirname(file), { recursive: true })
      // Ghi file tạm rồi đổi tên: tắt máy giữa chừng không để lại JSON hỏng (mất hết dữ liệu của plugin).
      await fs.writeFile(`${file}.tmp`, text, 'utf8')
      await fs.rename(`${file}.tmp`, file)
      return result
    }
    const p = (this.stateChain.get(id) ?? Promise.resolve()).then(run)
    this.stateChain.set(id, p.catch(() => undefined))
    return p
  }

  // ---- sự kiện, tool, slot ----

  /** Gửi sự kiện cho plugin đang chạy, có quyền, có khai sự kiện đó, và bật ở workspace / agent liên quan. */
  emit(ev: PluginEvent): void {
    let sent = 0
    for (const e of this.entries) {
      const r = this.rt.get(e.manifest.id)
      if (!r?.proc || r.status.state !== 'ready') continue
      if (!e.approved.includes('events.subscribe') || !e.manifest.events.includes(ev.type)) continue
      if (this.settings && !pluginOn(this.settings, e.manifest.id, ev.workspaceId, ev.agentId)) continue
      r.status.events++
      sent++
      this.notifyWorker(e.manifest.id, 'onEvent', { event: ev })
    }
    // Sự kiện dày (artifact, vault): không plugin nào nghe thì khỏi báo giao diện.
    if (sent) this.changed()
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

  // ---- việc theo lịch ----

  /** Tính lần chạy kế tiếp cho mọi việc của plugin (lúc worker sẵn sàng). Lịch hỏng đã bị chặn lúc đọc manifest. */
  private planJobs(e: Entry, r: Runtime, from: Date): void {
    r.jobNext.clear()
    if (!e.approved.includes('jobs.schedule')) return
    for (const j of e.manifest.jobs) {
      const next = nextCronRun(j.schedule, from)
      if (next) r.jobNext.set(j.key, next.getTime())
    }
  }

  /** Bắt đầu đồng hồ việc theo lịch (app gọi một lần; test gọi tickJobs trực tiếp). */
  startScheduler(): void {
    if (this.jobTimer) return
    this.jobTimer = setInterval(() => void this.tickJobs(new Date()), JOB_TICK_MS)
    this.jobTimer.unref?.()
  }

  /** Chạy những việc đã tới giờ. Bỏ lỡ lúc app tắt / máy ngủ thì chạy một lần rồi tính lịch tiếp. */
  async tickJobs(at: Date): Promise<void> {
    const runs: Promise<unknown>[] = []
    for (const e of this.entries) {
      const r = this.rt.get(e.manifest.id)
      if (!r?.proc || r.status.state !== 'ready' || !this.runnable(e)) continue
      for (const [key, next] of r.jobNext) {
        if (next > at.getTime()) continue
        const j = e.manifest.jobs.find((x) => x.key === key)
        const n = j ? nextCronRun(j.schedule, at) : null
        if (n) r.jobNext.set(key, n.getTime())
        else r.jobNext.delete(key)
        runs.push(this.runJob(e.manifest.id, key, 'schedule').catch(() => {}))
      }
    }
    await Promise.all(runs)
  }

  /** Chạy một việc (theo lịch hoặc người dùng bấm "Chạy ngay"). Việc đang chạy thì không chạy chồng. */
  async runJob(id: string, key: string, trigger: PluginJobRun['trigger'] = 'manual'): Promise<PluginJobRun> {
    const e = this.get(id)
    const job = e.manifest.jobs.find((j) => j.key === key)
    if (!job) throw new Error(`Plugin không có việc "${key}".`)
    if (!e.approved.includes('jobs.schedule') || !this.runnable(e)) throw new Error(`Plugin ${e.manifest.displayName} chưa được duyệt quyền hoặc đang tắt.`)
    const r = this.runtime(id)
    if (!r.proc || r.status.state !== 'ready') throw new Error('Worker của plugin không chạy.')
    if (r.jobRunning.has(key)) throw new Error(`Việc "${job.displayName}" đang chạy.`)
    const run: PluginJobRun = { runId: newToken(8), key, trigger, startedAt: now(), finishedAt: null, ok: null }
    r.jobRunning.add(key)
    r.jobRuns.unshift(run)
    if (r.jobRuns.length > MAX_RUNS) r.jobRuns.length = MAX_RUNS
    this.changed()
    try {
      await this.call(id, 'runJob', { job: { key, runId: run.runId, trigger, scheduledAt: run.startedAt } }, TIMEOUT.job)
      run.ok = true
    } catch (err) {
      run.ok = false
      run.error = (err as Error).message.slice(0, 500)
      this.log(id, 'error', `Việc ${key}: ${run.error}`)
    } finally {
      run.finishedAt = now()
      r.jobRunning.delete(key)
      this.changed()
    }
    return run
  }

  // ---- webhook ----

  setWebhookBase(base: string | null): void {
    this.webhookBase = base
    this.changed()
  }

  /** Đổi mã bí mật của địa chỉ webhook (địa chỉ cũ thôi dùng được). */
  async rotateWebhookToken(id: string): Promise<InstalledPlugin> {
    const e = this.get(id)
    e.webhookToken = newToken()
    await this.save()
    this.log(id, 'info', 'Đã đổi mã địa chỉ webhook')
    this.changed()
    return this.info(e)
  }

  /** Một yêu cầu POST /plugins/<id>/webhooks/<endpointKey>?token=… tới máy chủ webhook. */
  async handleWebhook(id: string, endpointKey: string, req: WebhookRequest): Promise<{ status: number; body: unknown }> {
    const e = this.entries.find((x) => x.manifest.id === id)
    const ep = e?.manifest.webhooks.find((w) => w.endpointKey === endpointKey)
    const given = req.query.token || (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!e || !ep || !e.webhookToken || !sameSecret(given, e.webhookToken)) return { status: 404, body: { error: 'not found' } }
    if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } }
    const r = this.runtime(id)
    const delivery: PluginWebhookDelivery = { requestId: newToken(8), endpointKey, at: now(), status: 0, ms: 0 }
    const t0 = Date.now()
    const done = (status: number, body: unknown, error?: string): { status: number; body: unknown } => {
      delivery.status = status
      delivery.ms = Date.now() - t0
      if (error) delivery.error = error.slice(0, 500)
      r.deliveries.unshift(delivery)
      if (r.deliveries.length > MAX_RUNS) r.deliveries.length = MAX_RUNS
      this.changed()
      return { status, body }
    }
    if (!e.approved.includes('webhooks.receive') || !this.runnable(e) || !r.proc || r.status.state !== 'ready')
      return done(503, { error: 'plugin not running' }, 'Plugin không chạy (chưa duyệt, đang tắt hoặc lỗi)')
    let parsedBody: unknown
    if (/json/i.test(req.headers['content-type'] ?? '') && req.rawBody) {
      try {
        parsedBody = JSON.parse(req.rawBody)
      } catch {
        return done(400, { error: 'invalid JSON' }, 'Thân yêu cầu không phải JSON hợp lệ')
      }
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['authorization', 'cookie'].includes(k)))
    try {
      const res = (await this.call(id, 'handleWebhook', { endpointKey, requestId: delivery.requestId, headers, query: omit(req.query, 'token'), rawBody: req.rawBody, parsedBody }, TIMEOUT.webhook)) as {
        status?: number
        body?: unknown
      } | null
      const status = typeof res?.status === 'number' && res.status >= 200 && res.status < 600 ? Math.floor(res.status) : 200
      return done(status, res?.body ?? { ok: true })
    } catch (err) {
      this.log(id, 'error', `Webhook ${endpointKey}: ${(err as Error).message}`)
      return done(500, { error: 'plugin error' }, (err as Error).message)
    }
  }

  // ---- trang của plugin (iframe cách ly) ----

  /** File giao diện của plugin cho giao thức stag-plugin://<id>/<rel>. null = không có / chưa được chạy. */
  async uiFile(id: string, rel: string): Promise<{ path: string; type: string } | null> {
    const e = this.entries.find((x) => x.manifest.id === id)
    if (!e?.manifest.entrypoints.ui || !this.runnable(e)) return null
    const base = resolve(e.dir, e.manifest.entrypoints.ui)
    const file = resolve(base, rel || 'index.html')
    if (!file.startsWith(base + sep)) return null
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile()) return null
    return { path: file, type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' }
  }

  /**
   * Header cho mọi file của trang plugin: CSP chỉ cho tải từ chính gói (gọi mạng chỉ khi có quyền http.outbound),
   * không nhúng khung khác; CORS mở vì trang chạy với origin "null" (iframe sandbox không allow-same-origin).
   */
  uiHeaders(id: string): Record<string, string> {
    const e = this.entries.find((x) => x.manifest.id === id)
    const self = `stag-plugin://${id}`
    const net = e?.approved.includes('http.outbound') ? ' https: http:' : ''
    return {
      'Content-Security-Policy': [
        `default-src ${self}`,
        `script-src ${self} 'unsafe-inline'`,
        `style-src ${self} 'unsafe-inline'`,
        `img-src ${self} data: blob:${net}`,
        `font-src ${self} data:`,
        `media-src ${self} data: blob:${net}`,
        `connect-src ${self}${net}`,
        "frame-src 'none'",
        "object-src 'none'",
        "form-action 'none'",
        "base-uri 'none'"
      ].join('; '),
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  }

  /**
   * Lời gọi từ trang của plugin (qua postMessage → giao diện app → IPC). Ngữ cảnh (workspace / agent) do app điền,
   * không lấy từ trang. data.get / action.perform → worker; còn lại như lời gọi worker → host (kiểm quyền).
   */
  async bridge(id: string, method: string, params: Record<string, unknown>, ctx: PluginCallContext): Promise<unknown> {
    const e = this.get(id)
    if (!this.runnable(e)) throw new Error(`Plugin ${e.manifest.displayName} chưa được duyệt quyền hoặc đang tắt.`)
    if (ctx.workspaceId && !this.onIn(id, ctx.workspaceId, ctx.agentId)) throw new Error(`Plugin ${e.manifest.displayName} đang tắt ở workspace / agent này.`)
    if (method === 'data.get' || method === 'action.perform') {
      const key = typeof params.key === 'string' ? params.key.slice(0, 100) : ''
      if (!key) throw new Error('Thiếu "key".')
      const r = this.runtime(id)
      if (!r.proc || r.status.state !== 'ready') throw new Error('Worker của plugin không chạy.')
      const p = params.params && typeof params.params === 'object' ? params.params : {}
      return method === 'data.get'
        ? this.call(id, 'getData', { key, params: p, context: ctx }, TIMEOUT.data)
        : this.call(id, 'performAction', { key, params: p, context: ctx }, TIMEOUT.action)
    }
    if (!BRIDGE_HOST_METHODS.includes(method)) throw new Error(`Trang plugin không gọi được "${method}".`)
    return this.hostCall(id, method, params)
  }

  /** Dừng worker + đồng hồ việc theo lịch (thoát app). */
  async shutdown(): Promise<void> {
    if (this.jobTimer) clearInterval(this.jobTimer)
    this.jobTimer = null
    await this.stopAll()
  }
}

/** Máy chủ webhook cục bộ (127.0.0.1), cổng giữ nguyên giữa các lần mở app (lưu trong webhooks.json). */
export class PluginWebhookServer {
  private server: Server | null = null

  constructor(private host: PluginHost) {}

  /** Chạy; trả về gốc địa chỉ, vd. http://127.0.0.1:43123. `port` = 0 → chọn cổng trống (test). */
  async start(port?: number): Promise<string> {
    const file = join(this.host.dataRoot, 'webhooks.json')
    let want = port
    if (want === undefined) {
      try {
        want = Number((JSON.parse((await readText(file)) ?? '{}') as { port?: number }).port) || 0
      } catch {
        want = 0
      }
    }
    const server = createServer((req, res) => {
      void this.handle(req).then(
        ({ status, body }) => {
          res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(body))
        },
        () => {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end('{"error":"internal"}')
        }
      )
    })
    const listen = (p: number): Promise<void> =>
      new Promise((ok, bad) => {
        server.once('error', bad)
        server.listen(p, '127.0.0.1', () => {
          server.off('error', bad)
          ok()
        })
      })
    try {
      await listen(want)
    } catch {
      await listen(0) // cổng cũ bị chiếm → cổng mới (địa chỉ webhook đổi theo)
    }
    this.server = server
    const actual = (server.address() as AddressInfo).port
    if (port === undefined && actual !== want) {
      await fs.mkdir(this.host.dataRoot, { recursive: true })
      await fs.writeFile(file, JSON.stringify({ port: actual }), 'utf8')
    }
    const base = `http://127.0.0.1:${actual}`
    this.host.setWebhookBase(base)
    return base
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const m = /^\/plugins\/([^/]+)\/webhooks\/([^/]+)\/?$/.exec(url.pathname)
    if (!m) return { status: 404, body: { error: 'not found' } }
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > 1024 * 1024) return { status: 413, body: { error: 'body too large (1 MB max)' } }
      chunks.push(c as Buffer)
    }
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
    return this.host.handleWebhook(decodeURIComponent(m[1]), decodeURIComponent(m[2]), {
      method: req.method ?? 'GET',
      headers,
      query: Object.fromEntries(url.searchParams),
      rawBody: Buffer.concat(chunks).toString('utf8')
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.host.setWebhookBase(null)
  }
}

// ---- files.list / files.read (quyền files.read) ----

/** Không liệt kê (ngoài thư mục vault của workspace). */
const FILES_SKIP = new Set(['.git', 'node_modules', '.sessions', '.stag'])
/** Không liệt kê / đọc bên trong: dữ liệu của app, git (config có thể chứa mã truy cập trong địa chỉ remote). */
const FILES_DENY = new Set(['.git', '.sessions', '.stag'])
/** Tên file hay chứa mã bí mật (biến môi trường, cấu hình MCP / npm, khoá riêng): liệt kê được, không đọc được. */
const FILES_SECRET = /^(\.env(\..*)?|\.mcp\.json|\.npmrc|\.pypirc|\.netrc|\.git-credentials|settings\.local\.json|id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|key|pfx|p12))$/i
export const FILES_MAX_BYTES = 1024 * 1024
const FILES_MAX_ENTRIES = 2000

export interface ProjectFileEntry {
  name: string
  /** Tương đối so với thư mục dự án, dấu "/". */
  path: string
  type: 'file' | 'dir'
  /** Byte (thư mục: 0). */
  size: number
}

const rpcError = (message: string, code = -32602): Error => Object.assign(new Error(message), { code })

/** Đường dẫn thật của `rel` trong dự án (chặn thoát ra ngoài, symlink trỏ ra ngoài, .git / .stag / .sessions, vault). */
async function projectTarget(project: string, vault: string, rel: string): Promise<{ root: string; real: string; vault: string | null }> {
  let real: string
  try {
    real = await realPathInside(project, rel)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'OUTSIDE') throw rpcError((e as Error).message)
    if (code === 'ENOENT' || code === 'ENOTDIR') throw rpcError(`Không thấy "${rel}" trong dự án.`)
    throw rpcError(`Không mở được "${rel}": ${(e as Error).message}`, -32099)
  }
  const root = await fs.realpath(resolve(project))
  if (relSlash(root, real).split('/').some((s) => FILES_DENY.has(s.toLowerCase()))) throw rpcError(`"${rel}" là dữ liệu của git / stag.ai, plugin không đọc được.`)
  const v = await fs.realpath(resolve(vault)).catch(() => null)
  if (v && isInside(v, real)) throw rpcError(`"${rel}" nằm trong vault: dùng ctx.vault.read (quyền vault.read).`)
  return { root, real, vault: v }
}

/** Một thư mục trong dự án (không đệ quy), thư mục trước, tối đa 2000 mục. Bỏ .git, node_modules, .sessions, .stag, vault. */
export async function listProjectDir(project: string, vault: string, rel: string): Promise<ProjectFileEntry[]> {
  const { root, real, vault: v } = await projectTarget(project, vault, rel)
  if (!(await fs.stat(real)).isDirectory()) throw rpcError(`"${rel}" không phải thư mục.`)
  const out: ProjectFileEntry[] = []
  for (const d of await fs.readdir(real, { withFileTypes: true })) {
    if (out.length >= FILES_MAX_ENTRIES) break
    if (FILES_SKIP.has(d.name.toLowerCase())) continue
    const full = join(real, d.name)
    let target = full
    if (d.isSymbolicLink()) {
      // Symlink / junction trỏ ra ngoài dự án: không hiện (đọc cũng bị chặn).
      const t = await fs.realpath(full).catch(() => null)
      if (!t || !isInside(root, t)) continue
      target = t
    }
    if (v && isInside(v, target)) continue
    const st = await fs.stat(target).catch(() => null)
    if (!st || (!st.isFile() && !st.isDirectory())) continue
    out.push({ name: d.name, path: relSlash(root, full), type: st.isDirectory() ? 'dir' : 'file', size: st.isFile() ? st.size : 0 })
  }
  return out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1))
}

/** Nội dung chữ (UTF-8) của một file trong dự án, tối đa 1 MB; file nhị phân / quá lớn → lỗi. */
export async function readProjectText(project: string, vault: string, rel: string): Promise<{ text: string }> {
  const { real } = await projectTarget(project, vault, rel)
  if (FILES_SECRET.test(basename(real))) throw rpcError(`"${rel}" thường chứa mã bí mật (API key, mật khẩu), plugin không đọc được.`)
  const st = await fs.stat(real)
  if (!st.isFile()) throw rpcError(`"${rel}" không phải file.`)
  if (st.size > FILES_MAX_BYTES) throw rpcError(`"${rel}" quá lớn (${Math.ceil(st.size / 1024)} KB, tối đa 1 MB).`)
  const buf = await fs.readFile(real)
  if (buf.includes(0)) throw rpcError(`"${rel}" là file nhị phân, files.read chỉ đọc file chữ.`)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  } catch {
    throw rpcError(`"${rel}" không phải chữ UTF-8.`)
  }
}

/**
 * Giới hạn sự kiện dày (agent ghi một file liên tục): mỗi khoá qua được một lần trong `ms`. Tính từ lần qua gần
 * nhất (không trượt), nên ghi liên tục vẫn ra một sự kiện mỗi `ms`.
 */
export class KeyedThrottle {
  private last = new Map<string, number>()

  constructor(
    private ms: number,
    private clock: () => number = Date.now
  ) {}

  pass(key: string): boolean {
    const t = this.clock()
    const prev = this.last.get(key)
    if (prev !== undefined && t - prev < this.ms) return false
    this.last.set(key, t)
    if (this.last.size > 2000) for (const [k, at] of this.last) if (t - at >= this.ms) this.last.delete(k)
    return true
  }
}

function newToken(bytes = 18): string {
  return randomBytes(bytes).toString('hex')
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function omit(o: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _drop, ...rest } = o
  return rest
}

function stateKey(p: Record<string, unknown>): string {
  const key = typeof p.key === 'string' ? p.key : ''
  if (!key || key.length > 200) throw Object.assign(new Error('Khoá dữ liệu không hợp lệ'), { code: -32602 })
  return typeof p.scope === 'string' && p.scope ? `${p.scope.slice(0, 100)}:${key}` : key
}

function sameSource(a: Entry['source'], b: Entry['source']): boolean {
  if (a.type === 'npm' && b.type === 'npm') return a.name === b.name
  if (a.type === 'local' && b.type === 'local') return resolve(a.path).toLowerCase() === resolve(b.path).toLowerCase()
  if (a.type === 'catalog' && b.type === 'catalog') return a.slug === b.slug
  return false
}
