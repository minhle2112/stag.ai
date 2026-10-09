import {
  DEFAULT_ADAPTERS,
  DEFAULT_GENERAL,
  DEFAULT_HANDOFF,
  HANDOFF_MAX,
  HANDOFF_MIN,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type AdaptersSettings,
  type AppSettings,
  type AppSettingsPatch,
  type CliAdapterId,
  type CliAdapterSettings,
  type CloseAction,
  type GeneralSettings,
  type HandoffSettings,
  type ModelSettings,
  type PermissionMode,
  type Settings,
  type SettingsOverrides,
  type SettingsOverridesPatch,
  type ShellId,
  type TerminalAdapterSettings
} from './types'
import { normalizeConnectors, normalizeToggles } from './connectors'

/** Chuẩn hoá cài đặt đọc từ file / nhận từ giao diện, dùng chung cho main và renderer. */

type Loose = Record<string, unknown>

const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const int = (v: unknown, d: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (all.includes(v as T) ? (v as T) : d)

const SHELLS: readonly ShellId[] = ['powershell', 'pwsh', 'gitbash', 'cmd']
const CLOSE_ACTIONS: readonly CloseAction[] = ['quit', 'tray']
const PERMISSIONS: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']
export const CLI_ADAPTERS: readonly CliAdapterId[] = ['claude', 'codex']

/** Tên model: chữ, số và . _ : - / [ ] @ (vd. `opus`, `claude-opus-5-5[1m]`, `gpt-5.6-terra`). '' = theo cấu hình CLI. */
export const MODEL_RE = /^[A-Za-z0-9._:/@[\]-]{0,100}$/
const EFFORT_RE = /^[a-z]{0,20}$/
const str = (v: unknown, re: RegExp, d: string): string => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : d)
const text = (v: unknown, d: string, max: number): string => (typeof v === 'string' ? v.slice(0, max) : d)

export function normalizeHandoff(raw: unknown): HandoffSettings {
  const r = obj(raw)
  return {
    autoHandoff: bool(r.autoHandoff, DEFAULT_HANDOFF.autoHandoff),
    handoffPercent: int(r.handoffPercent, DEFAULT_HANDOFF.handoffPercent, HANDOFF_MIN, HANDOFF_MAX)
  }
}

export function normalizeGeneral(raw: unknown): GeneralSettings {
  const r = obj(raw)
  const d = DEFAULT_GENERAL
  return {
    zoom: int(r.zoom, d.zoom, ZOOM_MIN, ZOOM_MAX),
    openAtLogin: bool(r.openAtLogin, d.openAtLogin),
    reopenLastWorkspace: bool(r.reopenLastWorkspace, d.reopenLastWorkspace),
    projectsDir: typeof r.projectsDir === 'string' ? r.projectsDir.trim() : d.projectsDir,
    terminalFontSize: int(r.terminalFontSize, d.terminalFontSize, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX),
    notifyWaiting: bool(r.notifyWaiting, d.notifyWaiting),
    notifyTaskDone: bool(r.notifyTaskDone, d.notifyTaskDone),
    notifySound: bool(r.notifySound, d.notifySound),
    closeAction: oneOf(r.closeAction, CLOSE_ACTIONS, d.closeAction),
    confirmQuitRunning: bool(r.confirmQuitRunning, d.confirmQuitRunning)
  }
}

function normalizeCli(raw: unknown, d: CliAdapterSettings): CliAdapterSettings {
  const r = obj(raw)
  return {
    enabled: bool(r.enabled, d.enabled),
    path: typeof r.path === 'string' ? r.path.trim() : d.path,
    model: str(r.model, MODEL_RE, d.model),
    effort: str(r.effort, EFFORT_RE, d.effort),
    defaultPermission: oneOf(r.defaultPermission, PERMISSIONS, d.defaultPermission),
    extraArgs: text(r.extraArgs, d.extraArgs, 2000).replace(/[\r\n]+/g, ' '),
    env: text(r.env, d.env, 8000)
  }
}

function normalizeTerminal(raw: unknown, d: TerminalAdapterSettings): TerminalAdapterSettings {
  const r = obj(raw)
  return { enabled: bool(r.enabled, d.enabled), shell: oneOf(r.shell, SHELLS, d.shell) }
}

/** `legacyShell`: shell của ô Terminal từng nằm ở general.terminalShell (bản S0). */
export function normalizeAdapters(raw: unknown, legacyShell?: unknown): AdaptersSettings {
  const r = obj(raw)
  const term = obj(r.terminal)
  return {
    claude: normalizeCli(r.claude, DEFAULT_ADAPTERS.claude),
    codex: normalizeCli(r.codex, DEFAULT_ADAPTERS.codex),
    terminal: normalizeTerminal('shell' in term ? term : { ...term, shell: legacyShell }, DEFAULT_ADAPTERS.terminal)
  }
}

function normalizeModels(raw: unknown): SettingsOverrides['models'] | undefined {
  const out: NonNullable<SettingsOverrides['models']> = {}
  for (const id of CLI_ADAPTERS) {
    const m = obj(obj(raw)[id])
    const one: Partial<ModelSettings> = {}
    if (typeof m.model === 'string' && MODEL_RE.test(m.model.trim())) one.model = m.model.trim()
    if (typeof m.effort === 'string' && EFFORT_RE.test(m.effort.trim())) one.effort = m.effort.trim()
    if (Object.keys(one).length) out[id] = one
  }
  return Object.keys(out).length ? out : undefined
}

/** Ghi đè của một workspace / agent: chỉ giữ khoá hợp lệ; rỗng → null (= theo cấp trên hoàn toàn). */
export function normalizeOverrides(raw: unknown): SettingsOverrides | null {
  const h = obj(obj(raw).handoff)
  const handoff: Partial<HandoffSettings> = {}
  if (typeof h.autoHandoff === 'boolean') handoff.autoHandoff = h.autoHandoff
  if (typeof h.handoffPercent === 'number' && Number.isFinite(h.handoffPercent))
    handoff.handoffPercent = int(h.handoffPercent, DEFAULT_HANDOFF.handoffPercent, HANDOFF_MIN, HANDOFF_MAX)
  const out: SettingsOverrides = {}
  if (Object.keys(handoff).length) out.handoff = handoff
  const models = normalizeModels(obj(raw).models)
  if (models) out.models = models
  const connectors = normalizeToggles(obj(raw).connectors)
  if (Object.keys(connectors).length) out.connectors = connectors
  return Object.keys(out).length ? out : null
}

/** Áp một lần sửa lên ghi đè hiện có: mỗi mục có mặt thay cả mục đó, null = bỏ mục. Kết quả rỗng → null. */
export function patchOverrides(current: SettingsOverrides | undefined, patch: SettingsOverridesPatch): SettingsOverrides | null {
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else if (value !== undefined) next[key] = value
  }
  return normalizeOverrides(next)
}

function normalizeMap(raw: unknown): Record<string, SettingsOverrides> {
  const out: Record<string, SettingsOverrides> = {}
  for (const [id, v] of Object.entries(obj(raw))) {
    const o = normalizeOverrides(v)
    if (o) out[id] = o
  }
  return out
}

/**
 * Đọc nội dung settings.json bất kỳ phiên bản. Bản 1 (trước Settings S0) chỉ có
 * `{ autoHandoff, handoffPercent }` ở gốc → chuyển thành cấp app của bản 2.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = obj(raw)
  if (r.version !== 2) {
    return {
      version: 2,
      app: { general: normalizeGeneral({}), handoff: normalizeHandoff(r), adapters: normalizeAdapters({}), connectors: normalizeConnectors({}) },
      workspaces: {},
      agents: {}
    }
  }
  const app = obj(r.app)
  return {
    version: 2,
    app: {
      general: normalizeGeneral(app.general),
      handoff: normalizeHandoff(app.handoff),
      adapters: normalizeAdapters(app.adapters, obj(app.general).terminalShell),
      connectors: normalizeConnectors(app.connectors)
    },
    workspaces: normalizeMap(r.workspaces),
    agents: normalizeMap(r.agents)
  }
}

export function patchApp(app: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    general: normalizeGeneral({ ...app.general, ...patch.general }),
    handoff: normalizeHandoff({ ...app.handoff, ...patch.handoff }),
    // Giá trị sai dạng trong patch → giữ giá trị đang có (không về mặc định).
    adapters: {
      claude: normalizeCli({ ...app.adapters.claude, ...patch.adapters?.claude }, app.adapters.claude),
      codex: normalizeCli({ ...app.adapters.codex, ...patch.adapters?.codex }, app.adapters.codex),
      terminal: normalizeTerminal({ ...app.adapters.terminal, ...patch.adapters?.terminal }, app.adapters.terminal)
    },
    connectors: patch.connectors?.inherited
      ? { items: app.connectors.items, inherited: normalizeToggles(patch.connectors.inherited, true) }
      : app.connectors
  }
}

/** Cài đặt bàn giao thực tế của một agent: app → workspace → agent (cấp sau thắng). */
export function resolveHandoff(s: Settings, workspaceId: string | null | undefined, agentId: string | null | undefined): HandoffSettings {
  return {
    ...s.app.handoff,
    ...(workspaceId ? s.workspaces[workspaceId]?.handoff : undefined),
    ...(agentId ? s.agents[agentId]?.handoff : undefined)
  }
}

/** Model / mức suy nghĩ thực tế của một CLI cho một agent: app → workspace → agent. */
export function resolveModel(s: Settings, id: CliAdapterId, workspaceId: string | null | undefined, agentId: string | null | undefined): ModelSettings {
  const { model, effort } = s.app.adapters[id]
  return {
    model,
    effort,
    ...(workspaceId ? s.workspaces[workspaceId]?.models?.[id] : undefined),
    ...(agentId ? s.agents[agentId]?.models?.[id] : undefined)
  }
}

/**
 * Tách ô "Tham số thêm" thành từng tham số: cách nhau bằng khoảng trắng, "…" giữ khoảng trắng bên trong,
 * \" là dấu nháy thật. Nháy chưa đóng = tới hết dòng.
 */
export function splitArgs(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '"') {
      cur += '"'
      has = true
      i++
    } else if (c === '"') {
      quoted = !quoted
      has = true
    } else if (!quoted && /\s/.test(c)) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += c
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

/** Biến app tự đặt cho phiên agent: người dùng không ghi đè được. */
const RESERVED_ENV = /^(STAG_|FORCE_COLOR$)/i

/** Đọc ô "Biến môi trường": mỗi dòng TÊN=giá trị, bỏ dòng trống và dòng bắt đầu bằng #. */
export function parseEnv(input: string): { vars: Record<string, string>; errors: string[] } {
  const vars: Record<string, string> = {}
  const errors: string[] = []
  input.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const eq = line.indexOf('=')
    const key = eq > 0 ? line.slice(0, eq).trim() : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) errors.push(`Dòng ${i + 1}: cần dạng TÊN=giá trị`)
    else if (RESERVED_ENV.test(key)) errors.push(`Dòng ${i + 1}: ${key} do app tự đặt, không đổi được`)
    else vars[key] = line.slice(eq + 1).trim()
  })
  return { vars, errors }
}
