import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { delimiter, join } from 'node:path'
import { parseEnv, splitArgs } from '@shared/settings'
import type { AdapterModel, AdapterStatus, CliAdapterId, ModelSettings } from '@shared/types'
import { codexHome, isCodexSessionVar, resolveCodex } from './codex'
import { claudeConfigDir } from './context'
import { spawnSpec } from './externalAdapters'
import { exists, readText } from './fsutil'
import type { SettingsStore } from './settings'
import { t } from '@shared/i18n'

/**
 * Adapter = cách app chạy một CLI AI (Claude Code, Codex): tìm file chạy, kiểm tra phiên bản / đăng nhập,
 * và phần cờ người dùng chọn trong Settings → Adapter (model, mức suy nghĩ, tham số thêm, biến môi trường).
 * Luật phiên, hook, MCP `stag` của app vẫn do agents.ts / codex.ts / hub.ts dựng.
 */

export const ADAPTER_LABEL: Record<CliAdapterId, string> = { claude: 'Claude Code', codex: 'Codex' }

/** Mức suy nghĩ `--effort` của Claude Code (theo `claude --help`, 2.1.295). */
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
/** Tên tắt model của Claude Code: luôn trỏ tới bản mới nhất của dòng đó. Gõ tên đầy đủ cũng được. */
const claudeModels = (): AdapterModel[] =>
  ['Opus', 'Sonnet', 'Haiku', 'Fable'].map((name) => ({ id: name.toLowerCase(), label: t('adapters.model.latest', { name }), efforts: CLAUDE_EFFORTS }))

/**
 * Tìm file chạy thật của Claude Code. Gọi thẳng claude.exe thay vì claude.cmd để tham số
 * (luật phiên nhiều dòng, có thể chứa chữ ngoài ASCII) không phải đi qua cách tách tham số của cmd.exe.
 */
export async function resolveClaude(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    const exe = join(dir, 'claude.exe')
    if (await exists(exe)) return exe
  }
  for (const dir of dirs) {
    const shim = await readText(join(dir, 'claude.cmd'))
    const target = shim && /"%dp0%\\?([^"]+?\.exe)"/i.exec(shim)
    if (target && (await exists(join(dir, target[1])))) return join(dir, target[1])
  }
  throw new Error(t('adapters.error.claudeMissing'))
}

/** Biến cấu hình Claude Code của người dùng — luôn giữ. */
const USER_CLAUDE_CONFIG =
  /^CLAUDE_CODE_(USE_|MAX_OUTPUT_TOKENS|GIT_BASH_PATH|SHELL|DISABLE_NONESSENTIAL|SKIP_|AUTO_COMPACT_WINDOW|DISABLE_1M_CONTEXT|MAX_CONTEXT_TOKENS)/

/**
 * Nếu stag.ai được mở từ bên trong một phiên Claude Code (vd. terminal của Claude desktop), môi trường
 * mang dấu "phiên con" (CLAUDECODE, CLAUDE_CODE_CHILD_SESSION, token/socket của host…). Agent kế thừa
 * những biến này sẽ tưởng mình là phiên con và tắt lưu transcript (hỏng "tiếp tục phiên trước").
 * Agent của stag.ai là phiên độc lập, nên bỏ các biến đó, giữ biến cấu hình của người dùng.
 */
export function independentSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const claude = !!(env.CLAUDECODE || env.CLAUDE_CODE_CHILD_SESSION)
  // Mở từ trong một phiên Codex: biến thread / sandbox của phiên đó (xem codex.ts).
  const codex = Object.keys(env).some(isCodexSessionVar)
  if (!claude && !codex) return env
  const out: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    const hostMarker =
      (claude &&
        (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)$/.test(key) ||
          /^(CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)/.test(key) ||
          (key.startsWith('CLAUDE_CODE_') && !USER_CLAUDE_CONFIG.test(key)))) ||
      isCodexSessionVar(key)
    if (!hostMarker) out[key] = value
  }
  return out
}

/** Cờ model / mức suy nghĩ cho từng CLI ('' = không thêm cờ, CLI dùng cấu hình của người dùng). */
export function modelArgs(id: CliAdapterId, m: ModelSettings): string[] {
  const out: string[] = []
  if (id === 'codex') {
    if (m.model) out.push('-m', m.model)
    if (m.effort) out.push('-c', `model_reasoning_effort=${JSON.stringify(m.effort)}`)
  } else {
    if (m.model) out.push('--model', m.model)
    if (m.effort) out.push('--effort', m.effort)
  }
  return out
}


/** Model trong ~/.claude/settings.json. */
export async function claudeConfigModel(home = claudeConfigDir()): Promise<string | null> {
  try {
    const s = JSON.parse((await readText(join(home, 'settings.json'))) ?? '{}') as { model?: unknown }
    return typeof s.model === 'string' && s.model ? s.model : null
  } catch {
    return null
  }
}

/** `model = "…"` ở phần đầu ~/.codex/config.toml (trước bảng [..] đầu tiên). */
export function codexConfigModel(toml: string): string | null {
  for (const line of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break
    const m = /^\s*model\s*=\s*"([^"]*)"/.exec(line)
    if (m) return m[1] || null
  }
  return null
}

/** Model Codex hiện trong danh sách chọn (models_cache.json do Codex tự tải về), kèm mức suy nghĩ từng model. */
export function codexModels(cacheJson: string): AdapterModel[] {
  try {
    const raw = JSON.parse(cacheJson) as { models?: unknown }
    if (!Array.isArray(raw.models)) return []
    const out: AdapterModel[] = []
    for (const m of raw.models as Array<Record<string, unknown>>) {
      const id = typeof m.slug === 'string' ? m.slug : null
      if (!id || m.visibility === 'hide') continue
      const levels = Array.isArray(m.supported_reasoning_levels) ? (m.supported_reasoning_levels as Array<{ effort?: unknown } | string>) : []
      const efforts = levels.map((l) => (typeof l === 'string' ? l : l?.effort)).filter((e): e is string => typeof e === 'string')
      const name = typeof m.display_name === 'string' && m.display_name ? m.display_name : id
      out.push({ id, label: name.toLowerCase() === id.toLowerCase() ? name : `${name} (${id})`, efforts })
    }
    return out
  } catch {
    return []
  }
}

/** Kết quả `claude auth status --json`. */
export function claudeLogin(stdout: string): AdapterStatus['login'] {
  try {
    const s = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown; email?: unknown }
    if (s.loggedIn === false) return { state: 'out', detail: t('adapters.login.out') }
    if (s.loggedIn !== true) return { state: 'unknown', detail: t('adapters.login.unknown') }
    const parts = [s.authMethod, s.subscriptionType && t('adapters.login.plan', { plan: String(s.subscriptionType) }), s.email].filter((p): p is string => typeof p === 'string' && !!p)
    return { state: 'in', detail: parts.join(' · ') || t('adapters.login.in') }
  } catch {
    return { state: 'unknown', detail: t('adapters.login.unknown') }
  }
}

/** Kết quả `codex login status` (chữ thường, không có JSON). */
export function codexLogin(output: string): AdapterStatus['login'] {
  const using = /Logged in using (.+)/i.exec(output)
  if (using) return { state: 'in', detail: using[1].trim() }
  if (/logged in/i.test(output) && !/not logged in/i.test(output)) return { state: 'in', detail: t('adapters.login.in') }
  if (/not logged in/i.test(output)) return { state: 'out', detail: t('adapters.login.out') }
  return { state: 'unknown', detail: output.trim().split(/\r?\n/)[0] || t('adapters.login.unknown') }
}

interface RunResult {
  ok: boolean
  out: string
  err: string
}

/** Chạy CLI lấy phiên bản / trạng thái. File .cmd/.bat (đường dẫn người dùng đặt) đi qua cmd.exe như lúc mở phiên agent (spawnSpec): Node chặn chạy thẳng .cmd (EINVAL). */
export function runCli(exe: string, args: string[], env: NodeJS.ProcessEnv, timeout = 20_000): Promise<RunResult> {
  const spec = spawnSpec(exe, args, env)
  const raw = typeof spec.args === 'string'
  return new Promise((resolve) => {
    execFile(
      spec.command,
      raw ? [spec.args as string] : (spec.args as string[]),
      { env, timeout, windowsHide: true, maxBuffer: 1 << 20, windowsVerbatimArguments: raw },
      (error, stdout, stderr) => resolve({ ok: !error, out: String(stdout), err: String(stderr) || (error ? error.message : '') })
    )
  })
}

export class AdapterService {
  private checking = new Map<CliAdapterId, Promise<AdapterStatus>>()

  constructor(private settings: SettingsStore) {}

  /** File chạy cho phiên agent: đường dẫn người dùng đặt, hoặc tự tìm trong PATH. */
  async exe(id: CliAdapterId): Promise<{ path: string; source: 'auto' | 'custom' }> {
    const custom = this.settings.get().app.adapters[id].path
    if (custom) {
      const st = await fs.stat(custom).catch(() => null)
      if (!st?.isFile()) throw new Error(t('adapters.error.customPath', { name: ADAPTER_LABEL[id], path: custom }))
      return { path: custom, source: 'custom' }
    }
    return { path: id === 'codex' ? await resolveCodex() : await resolveClaude(), source: 'auto' }
  }

  /** Biến môi trường thêm của adapter (dòng sai đã bị bỏ, giao diện báo lỗi lúc nhập). */
  env(id: CliAdapterId): Record<string, string> {
    return parseEnv(this.settings.get().app.adapters[id].env).vars
  }

  /** Cờ người dùng chọn cho một phiên của agent: model / mức suy nghĩ (app → workspace → agent) + tham số thêm. */
  launchArgs(id: CliAdapterId, agent: { id: string; workspaceId: string }): string[] {
    return [...modelArgs(id, this.settings.modelFor(id, agent)), ...splitArgs(this.settings.get().app.adapters[id].extraArgs)]
  }

  /** Kiểm tra CLI trên máy: file chạy, phiên bản, đăng nhập, model gợi ý. Không gọi model (không tốn quota). */
  check(id: CliAdapterId): Promise<AdapterStatus> {
    const pending = this.checking.get(id)
    if (pending) return pending
    const p = this.doCheck(id).finally(() => this.checking.delete(id))
    this.checking.set(id, p)
    return p
  }

  private async doCheck(id: CliAdapterId): Promise<AdapterStatus> {
    const status: AdapterStatus = {
      id,
      path: null,
      source: this.settings.get().app.adapters[id].path ? 'custom' : 'auto',
      version: null,
      login: { state: 'unknown', detail: '' },
      configModel: null,
      models: id === 'claude' ? claudeModels() : [],
      error: null,
      checkedAt: new Date().toISOString()
    }
    if (id === 'claude') status.configModel = await claudeConfigModel()
    else {
      status.configModel = codexConfigModel((await readText(join(codexHome(), 'config.toml'))) ?? '')
      status.models = codexModels((await readText(join(codexHome(), 'models_cache.json'))) ?? '')
    }
    try {
      status.path = (await this.exe(id)).path
    } catch (e) {
      status.error = (e as Error).message
      return status
    }
    const env = { ...independentSessionEnv(process.env), ...this.env(id) }
    const version = await runCli(status.path, ['--version'], env)
    if (!version.ok) {
      status.error = t('adapters.error.runFailed', { command: `"${status.path} --version"`, error: version.err.trim().split(/\r?\n/)[0] || t('common.unknown') })
      return status
    }
    status.version = version.out.trim().split(/\r?\n/)[0] || null
    if (id === 'claude') {
      const r = await runCli(status.path, ['auth', 'status', '--json'], env)
      status.login = claudeLogin(r.out)
    } else {
      const r = await runCli(status.path, ['login', 'status'], env)
      status.login = codexLogin(`${r.out}\n${r.err}`)
    }
    return status
  }
}
