import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path'
import { MODEL_RE, parseEnv, splitArgs } from '@shared/settings'
import type {
  AdapterInstallRequest,
  ExternalAdapterManifest,
  ExternalAdapterStatus,
  InstalledAdapter,
  InstalledAdapterPatch
} from '@shared/types'
import { independentSessionEnv } from './adapters'
import { exists, readText } from './fsutil'

/**
 * Adapter ngoài (alpha, theo kiểu "Install Adapter" của Paperclip): một gói npm hoặc một thư mục có
 * `stagAdapter` trong package.json, khai báo cách chạy một CLI AI khác như một agent của stag.ai.
 * Gói npm được cài vào userData/adapters/npm với `--ignore-scripts` (không chạy script cài đặt của gói);
 * thư mục cục bộ được dùng tại chỗ (sửa gói là có tác dụng ở phiên sau). Xem docs/adapters.md.
 */

/** id trùng các loại ô có sẵn thì không cài được. */
const RESERVED_IDS = new Set(['claude', 'codex', 'terminal', 'external', 'stag'])
const ID_RE = /^[a-z][a-z0-9-]{1,31}$/
/** Tên gói npm (có scope hoặc không). */
export const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
/** Phiên bản / dist-tag (vd. 1.2.0, ~1.2, latest, beta). Không có ^ < > | & hay dấu cách: lệnh đi qua cmd.exe. */
export const NPM_VERSION_RE = /^[A-Za-z0-9.~*+-]{1,40}$/
const FLAG_RE = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

type Loose = Record<string, unknown>
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
const strList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null)

/** Đọc `stagAdapter` của package.json. Sai thì ném lỗi tiếng Việt nói rõ trường nào. */
export function parseManifest(pkg: unknown): { manifest: ExternalAdapterManifest; name: string; version: string } {
  const p = obj(pkg)
  const raw = p.stagAdapter
  if (!raw || typeof raw !== 'object') throw new Error('Gói này không phải adapter của stag.ai: package.json thiếu mục "stagAdapter".')
  const m = obj(raw)
  const bad = (field: string, why: string): never => {
    throw new Error(`stagAdapter.${field} ${why}`)
  }
  const id = typeof m.id === 'string' ? m.id : bad('id', 'là bắt buộc')
  if (!ID_RE.test(id)) bad('id', 'chỉ gồm a-z, 0-9, "-", bắt đầu bằng chữ, 2–32 ký tự')
  if (RESERVED_IDS.has(id)) bad('id', `"${id}" trùng adapter có sẵn`)
  const label = typeof m.label === 'string' && m.label.trim() ? m.label.trim().slice(0, 60) : bad('label', 'là bắt buộc')
  const command = typeof m.command === 'string' && m.command.trim() ? m.command.trim() : bad('command', 'là bắt buộc')
  const args = m.args === undefined ? [] : (strList(m.args) ?? bad('args', 'phải là mảng chuỗi'))
  const versionArgs = m.versionArgs === undefined ? ['--version'] : (strList(m.versionArgs) ?? bad('versionArgs', 'phải là mảng chuỗi'))
  const models: ExternalAdapterManifest['models'] = []
  if (m.models !== undefined) {
    if (!Array.isArray(m.models)) bad('models', 'phải là mảng')
    for (const x of m.models as unknown[]) {
      const one = typeof x === 'string' ? { id: x, label: x } : { id: obj(x).id, label: obj(x).label ?? obj(x).id }
      if (typeof one.id !== 'string' || !one.id || !MODEL_RE.test(one.id)) bad('models', 'có model id không hợp lệ')
      models.push({ id: one.id as string, label: typeof one.label === 'string' ? one.label : (one.id as string) })
    }
  }
  const flag = (field: string, v: unknown): string => {
    if (v === undefined || v === '') return ''
    if (typeof v !== 'string' || !FLAG_RE.test(v)) bad(field, 'phải là một cờ dạng --ten')
    return v as string
  }
  const modelFlag = flag('modelFlag', m.modelFlag)
  const mcpConfigFlag = flag('mcpConfigFlag', m.mcpConfigFlag)
  let rules: ExternalAdapterManifest['rules'] = null
  if (m.rules !== undefined && m.rules !== null) {
    const r = obj(m.rules)
    if (typeof r.flag === 'string') rules = { flag: flag('rules.flag', r.flag) }
    else if (typeof r.env === 'string' && ENV_RE.test(r.env) && !/^STAG_/i.test(r.env)) rules = { env: r.env }
    else bad('rules', 'phải là { "flag": "--cờ" } hoặc { "env": "TEN_BIEN" }')
  }
  let prompt: ExternalAdapterManifest['prompt'] = null
  if (m.prompt !== undefined && m.prompt !== null) {
    const r = obj(m.prompt)
    if (typeof r.flag === 'string') prompt = { flag: flag('prompt.flag', r.flag) }
    else if (r.positional === true) prompt = { positional: true }
    else bad('prompt', 'phải là { "flag": "--cờ" } hoặc { "positional": true }')
  }
  const name = typeof p.name === 'string' ? p.name : id
  const version = typeof p.version === 'string' ? p.version : '0.0.0'
  return {
    name,
    version,
    manifest: {
      id,
      label,
      description: typeof m.description === 'string' ? m.description.slice(0, 300) : typeof p.description === 'string' ? p.description.slice(0, 300) : '',
      command,
      args,
      versionArgs,
      install: typeof m.install === 'string' ? m.install.slice(0, 200) : '',
      homepage: typeof m.homepage === 'string' && /^https?:\/\//.test(m.homepage) ? m.homepage : '',
      models,
      modelFlag,
      rules,
      prompt,
      mcpConfigFlag
    }
  }
}

/** Thay {pkg} bằng thư mục gói. */
const fillPkg = (s: string, dir: string): string => s.split('{pkg}').join(dir)

/** Tìm chương trình: đường dẫn (tuyệt đối / có {pkg}) phải tồn tại; tên trần thì tìm trong PATH theo PATHEXT. */
export async function resolveCommand(command: string, dir: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const c = fillPkg(command, dir)
  if (isAbsolute(c) || /[\\/]/.test(c)) {
    // resolve: tương đối → theo thư mục gói; tuyệt đối giữ nguyên, chỉ chuẩn hoá dấu \ / /.
    const p = resolve(dir, c)
    return (await exists(p)) ? p : null
  }
  const exts = extname(c) ? [''] : ['.exe', '.cmd', '.bat', '.com']
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(d, c + ext)
      if (await exists(p)) return p
    }
  }
  return null
}

/** Một tham số trong dòng lệnh cmd.exe: thêm nháy khi có dấu cách / ký tự đặc biệt; nháy kép bên trong nhân đôi. */
export function cmdQuote(a: string): string {
  return a === '' || /[\s"&|<>^()%!,;=]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a
}

const isBatch = (p: string): boolean => /\.(cmd|bat)$/i.test(p)

/** Lệnh thật cho node-pty: file .cmd/.bat chạy qua cmd.exe với dòng lệnh tự dựng (xem PtySpawnOptions.args). */
export function spawnSpec(path: string, args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] | string } {
  if (!isBatch(path)) return { command: path, args }
  const line = [path, ...args].map(cmdQuote).join(' ')
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: `/d /s /c "${line}"` }
}

export interface ExternalLaunch {
  /** File luật phiên app đã viết. */
  rulesFile: string
  /** Lời mở phiên (phiên mới). */
  prompt?: string
  /** File cấu hình MCP kiểu Claude của app (MCP `stag`). */
  mcpFile: string
}

/** Tham số + biến môi trường cho một phiên agent chạy bằng adapter ngoài. */
export function externalArgs(a: InstalledAdapter, o: ExternalLaunch): { args: string[]; env: Record<string, string> } {
  const m = a.manifest
  const args = m.args.map((x) => fillPkg(x, a.dir))
  if (a.model && m.modelFlag) args.push(m.modelFlag, a.model)
  if (m.rules && 'flag' in m.rules) args.push(m.rules.flag, o.rulesFile)
  if (m.mcpConfigFlag) args.push(m.mcpConfigFlag, o.mcpFile)
  args.push(...splitArgs(a.extraArgs))
  if (o.prompt && m.prompt) {
    if ('flag' in m.prompt) args.push(m.prompt.flag, o.prompt)
    else args.push(o.prompt)
  }
  const env = parseEnv(a.env).vars
  if (m.rules && 'env' in m.rules) env[m.rules.env] = o.rulesFile
  return { args, env }
}

function run(command: string, args: string[] | string, opts: { env: NodeJS.ProcessEnv; cwd?: string; timeout?: number }): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((done) => {
    const child =
      typeof args === 'string'
        ? spawn(command, [args], { env: opts.env, cwd: opts.cwd, windowsHide: true, windowsVerbatimArguments: true })
        : spawn(command, args, { env: opts.env, cwd: opts.cwd, windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), opts.timeout ?? 20_000)
    child.stdout?.on('data', (d) => (out += String(d)))
    child.stderr?.on('data', (d) => (err += String(d)))
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ ok: false, out, err: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      done({ ok: code === 0, out, err })
    })
  })
}

/**
 * `npm install --ignore-scripts` một gói vào thư mục `prefix` (có package.json riêng), trả thư mục của gói.
 * Dùng chung cho adapter ngoài và plugin. Tên / phiên bản kiểm bằng NPM_NAME_RE / NPM_VERSION_RE (chạy qua cmd.exe).
 */
export async function npmInstall(prefix: string, label: string, name: string, version: string): Promise<string> {
  if (!NPM_NAME_RE.test(name)) throw new Error(`"${name}" không phải tên gói npm hợp lệ.`)
  if (!NPM_VERSION_RE.test(version)) throw new Error(`Phiên bản "${version}" không hợp lệ.`)
  await fs.mkdir(prefix, { recursive: true })
  if (!(await exists(join(prefix, 'package.json')))) await fs.writeFile(join(prefix, 'package.json'), JSON.stringify({ name: label, private: true }, null, 2), 'utf8')
  // npm trên Windows là npm.cmd → chạy qua cmd.exe; tên / phiên bản đã kiểm bằng regex (không có ký tự đặc biệt của cmd).
  const r = await run(process.env.ComSpec || 'cmd.exe', `/d /s /c "npm install --ignore-scripts --no-audit --no-fund --save ${name}@${version}"`, {
    env: independentSessionEnv(process.env),
    cwd: prefix,
    timeout: 180_000
  })
  if (!r.ok) {
    const msg = (r.err || r.out).split(/\r?\n/).filter((l) => /ERR!|error/i.test(l)).slice(0, 4).join('\n') || (r.err || r.out).trim().slice(-400)
    throw new Error(`npm install ${name}@${version} lỗi:\n${msg || 'không rõ (npm có trong PATH không?)'}`)
  }
  return join(prefix, 'node_modules', ...name.split('/'))
}

export async function npmUninstall(prefix: string, name: string): Promise<void> {
  if (!NPM_NAME_RE.test(name)) return
  await run(process.env.ComSpec || 'cmd.exe', `/d /s /c "npm uninstall --ignore-scripts --no-audit --no-fund ${name}"`, {
    env: independentSessionEnv(process.env),
    cwd: prefix,
    timeout: 120_000
  })
}

interface RegistryFile {
  adapters: InstalledAdapter[]
}

export class ExternalAdapterStore {
  private items: InstalledAdapter[] = []
  private busy: Promise<unknown> = Promise.resolve()

  constructor(
    /** userData/adapters */
    private root: string,
    private onChange: (list: InstalledAdapter[]) => void = () => {}
  ) {}

  private get file(): string {
    return join(this.root, 'registry.json')
  }
  private get npmPrefix(): string {
    return join(this.root, 'npm')
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse((await readText(this.file)) ?? '{}') as Partial<RegistryFile>
      this.items = Array.isArray(raw.adapters) ? raw.adapters.filter((a) => a?.manifest?.id) : []
    } catch {
      this.items = []
    }
  }

  list(): InstalledAdapter[] {
    return this.items
  }

  get(id: string): InstalledAdapter | undefined {
    return this.items.find((a) => a.manifest.id === id)
  }

  /** Cài (hoặc cài lại / cập nhật) một adapter. Cài lại cùng nguồn thì giữ cài đặt (bật/tắt, model…). */
  install(req: AdapterInstallRequest): Promise<InstalledAdapter> {
    // Lần lượt: hai lần cài song song cùng chạy npm vào một thư mục sẽ giẫm nhau.
    const p = this.busy.then(() => this.doInstall(req))
    this.busy = p.catch(() => {})
    return p
  }

  private async doInstall(req: AdapterInstallRequest): Promise<InstalledAdapter> {
    let dir: string
    let source: InstalledAdapter['source']
    if (req.type === 'npm') {
      const name = req.name.trim()
      const version = (req.version ?? '').trim() || 'latest'
      dir = await npmInstall(this.npmPrefix, 'stag-adapters', name, version)
      source = { type: 'npm', name, version }
    } else {
      dir = resolve(req.path.trim())
      const st = await fs.stat(dir).catch(() => null)
      if (!st?.isDirectory()) throw new Error(`Không thấy thư mục "${req.path}".`)
      source = { type: 'local', path: dir }
    }
    const pkgText = await readText(join(dir, 'package.json'))
    if (!pkgText) throw new Error(`Không thấy package.json trong "${dir}".`)
    let pkg: unknown
    try {
      pkg = JSON.parse(pkgText)
    } catch {
      throw new Error('package.json của gói không phải JSON hợp lệ.')
    }
    const { manifest, version } = parseManifest(pkg)
    const old = this.get(manifest.id)
    if (old && !sameSource(old.source, source))
      throw new Error(`Đã có adapter "${manifest.id}" (${old.manifest.label}) cài từ nguồn khác. Gỡ nó trước rồi cài lại.`)
    const entry: InstalledAdapter = {
      manifest,
      source,
      dir,
      version,
      installedAt: new Date().toISOString(),
      enabled: old?.enabled ?? true,
      model: old && manifest.models.some((m) => m.id === old.model) ? old.model : old?.model && manifest.modelFlag ? old.model : '',
      extraArgs: old?.extraArgs ?? '',
      env: old?.env ?? ''
    }
    this.items = old ? this.items.map((a) => (a === old ? entry : a)) : [...this.items, entry]
    await this.save()
    return entry
  }

  /** Gỡ adapter: gói npm thì gỡ khỏi userData/adapters/npm; thư mục cục bộ thì chỉ bỏ khỏi danh sách (không xoá file của bạn). */
  async remove(id: string): Promise<void> {
    const a = this.get(id)
    if (!a) return
    if (a.source.type === 'npm') {
      const name = a.source.name
      await (this.busy = this.busy.then(() => npmUninstall(this.npmPrefix, name)))
    }
    this.items = this.items.filter((x) => x !== a)
    await this.save()
  }

  async update(id: string, patch: InstalledAdapterPatch): Promise<InstalledAdapter> {
    const a = this.get(id)
    if (!a) throw new Error('Adapter không còn')
    const next: InstalledAdapter = { ...a }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.model === 'string' && MODEL_RE.test(patch.model.trim())) next.model = patch.model.trim()
    if (typeof patch.extraArgs === 'string') next.extraArgs = patch.extraArgs.replace(/[\r\n]+/g, ' ').slice(0, 2000)
    if (typeof patch.env === 'string') next.env = patch.env.slice(0, 8000)
    this.items = this.items.map((x) => (x === a ? next : x))
    await this.save()
    return next
  }

  /** File chạy của adapter; không có thì ném lỗi kèm lệnh cài gợi ý. */
  async exe(a: InstalledAdapter): Promise<string> {
    const p = await resolveCommand(a.manifest.command, a.dir)
    if (p) return p
    throw new Error(
      `Không tìm thấy chương trình "${a.manifest.command}" của adapter ${a.manifest.label}.` + (a.manifest.install ? ` Cài bằng: ${a.manifest.install}` : '')
    )
  }

  async check(id: string): Promise<ExternalAdapterStatus> {
    const status: ExternalAdapterStatus = { id, path: null, version: null, error: null, checkedAt: new Date().toISOString() }
    const a = this.get(id)
    if (!a) return { ...status, error: 'Adapter không còn' }
    try {
      status.path = await this.exe(a)
    } catch (e) {
      return { ...status, error: (e as Error).message }
    }
    if (!a.manifest.versionArgs.length) return status
    const spec = spawnSpec(status.path, a.manifest.versionArgs.map((x) => fillPkg(x, a.dir)))
    const r = await run(spec.command, spec.args, { env: { ...independentSessionEnv(process.env), ...parseEnv(a.env).vars }, cwd: a.dir })
    if (r.ok) status.version = (r.out || r.err).trim().split(/\r?\n/)[0] || null
    else status.error = `Chạy ${a.manifest.command} ${a.manifest.versionArgs.join(' ')} lỗi: ${(r.err || r.out).trim().split(/\r?\n/)[0] || 'không rõ'}`
    return status
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ adapters: this.items } satisfies RegistryFile, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
    this.onChange(this.items)
  }
}

function sameSource(a: InstalledAdapter['source'], b: InstalledAdapter['source']): boolean {
  if (a.type === 'npm' && b.type === 'npm') return a.name === b.name
  if (a.type === 'local' && b.type === 'local') return resolve(a.path).toLowerCase() === resolve(b.path).toLowerCase()
  return false
}

