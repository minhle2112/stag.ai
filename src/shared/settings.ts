import { normalizeSkills, normalizeSkillToggles } from './skills'
import { PLUGIN_ID_RE } from './plugins'
import {
  DEFAULT_ADAPTERS,
  DEFAULT_AGENT_API,
  DEFAULT_BROWSER,
  DEFAULT_GENERAL,
  DEFAULT_HANDOFF,
  DEFAULT_SCOPE,
  DEFAULT_VOICE,
  HANDOFF_MAX,
  HANDOFF_MIN,
  TERMINAL_FONT_MAX,
  TERMINAL_FONT_MIN,
  ZOOM_MAX,
  ZOOM_MIN,
  type AdaptersSettings,
  type AgentApiSettings,
  type AppSettings,
  type AppSettingsPatch,
  type BrowserSettings,
  type CliAdapterId,
  type CliAdapterSettings,
  type CloseAction,
  type ExternalPagePolicy,
  type GeneralSettings,
  type HandoffSettings,
  type ModelSettings,
  type PermissionMode,
  type ScopeLockSettings,
  type ScopeMode,
  type SearchEngine,
  type Settings,
  type SettingsOverrides,
  type SettingsOverridesPatch,
  type ShellId,
  type TerminalAdapterSettings,
  type VoiceEngine,
  type VoiceHotkey,
  type VoiceReplacement,
  type VoiceSettings,
  VOICE_UNLOAD_MAX
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
export const SCOPE_MODES: readonly ScopeMode[] = ['ask', 'block', 'warn', 'off']
const SEARCH_ENGINES: readonly SearchEngine[] = ['google', 'duckduckgo', 'bing']
const EXTERNAL_POLICIES: readonly ExternalPagePolicy[] = ['ask', 'allow', 'deny']
const VOICE_HOTKEY_IDS: readonly VoiceHotkey[] = ['ctrl+space', 'ctrl+shift+space', 'ctrl+alt+space', 'f9']
const VOICE_ENGINES: readonly VoiceEngine[] = ['local', 'soniox']

/** Danh sách chuỗi gọn: bỏ trống / trùng, cắt độ dài, tối đa `max` mục. */
function strList(v: unknown, max: number, len: number, ok: (x: string) => boolean = () => true): string[] {
  const out: string[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const t = typeof x === 'string' ? x.trim().slice(0, len) : ''
    if (t && ok(t) && !out.includes(t) && out.length < max) out.push(t)
  }
  return out
}

/** Origin http(s) chuẩn (`https://github.com`, `http://192.168.1.5:8080`), null nếu không phải. */
export function normalizeOrigin(input: string): string | null {
  const t = input.trim()
  if (!t) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

export function normalizeScope(raw: unknown): ScopeLockSettings {
  const r = obj(raw)
  return {
    mode: oneOf(r.mode, SCOPE_MODES, DEFAULT_SCOPE.mode),
    guessShell: bool(r.guessShell, DEFAULT_SCOPE.guessShell),
    exempt: strList(r.exempt, 100, 300)
  }
}

/** Trang mở cho tab mới: địa chỉ http(s) đầy đủ; gõ thiếu giao thức thì thêm https://; không hợp lệ → '' (trang trống). */
function normalizeHomePage(v: unknown): string {
  const t = typeof v === 'string' ? v.trim().slice(0, 2000) : ''
  if (!t) return ''
  const url = /^https?:\/\//i.test(t) ? t : `https://${t}`
  return normalizeOrigin(url) ? url : ''
}

export function normalizeAgentApi(raw: unknown): AgentApiSettings {
  const r = obj(raw)
  const d = DEFAULT_AGENT_API
  return { manage: bool(r.manage, d.manage), message: bool(r.message, d.message), confirmCreate: bool(r.confirmCreate, d.confirmCreate) }
}

/** Phần ghi đè Agent API hợp lệ (chỉ khoá boolean có mặt); rỗng → undefined. */
function partialAgentApi(raw: unknown): Partial<AgentApiSettings> | undefined {
  const r = obj(raw)
  const out: Partial<AgentApiSettings> = {}
  for (const k of ['manage', 'message', 'confirmCreate'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean
  return Object.keys(out).length ? out : undefined
}

export function normalizeBrowser(raw: unknown): BrowserSettings {
  const r = obj(raw)
  return {
    homePage: normalizeHomePage(r.homePage),
    searchEngine: oneOf(r.searchEngine, SEARCH_ENGINES, DEFAULT_BROWSER.searchEngine),
    agentTools: bool(r.agentTools, DEFAULT_BROWSER.agentTools),
    externalPages: oneOf(r.externalPages, EXTERNAL_POLICIES, DEFAULT_BROWSER.externalPages),
    allowedOrigins: strList(r.allowedOrigins, 200, 300).map((o) => normalizeOrigin(o)).filter((o, i, a): o is string => !!o && a.indexOf(o) === i),
    keepCookies: bool(r.keepCookies, DEFAULT_BROWSER.keepCookies)
  }
}
export function normalizeVoice(raw: unknown): VoiceSettings {
  const r = obj(raw)
  const d = DEFAULT_VOICE
  return {
    enabled: bool(r.enabled, d.enabled),
    engine: oneOf(r.engine, VOICE_ENGINES, d.engine),
    hotkey: oneOf(r.hotkey, VOICE_HOTKEY_IDS, d.hotkey),
    micId: typeof r.micId === 'string' ? r.micId.slice(0, 300) : d.micId,
    preview: bool(r.preview, d.preview),
    unloadMinutes: int(r.unloadMinutes, d.unloadMinutes, 0, VOICE_UNLOAD_MAX),
    // Qwen3 nhận gợi ý dạng CSV: bỏ dấu phẩy trong từng mục.
    hotwords: strList(
      (Array.isArray(r.hotwords) ? r.hotwords : []).map((x) => (typeof x === 'string' ? x.replace(/,/g, ' ').replace(/\s+/g, ' ') : x)),
      200,
      60
    ),
    workspaceVocab: bool(r.workspaceVocab, d.workspaceVocab),
    replacements: normalizeReplacements(r.replacements),
    commands: bool(r.commands, d.commands)
  }
}

/** Luật thay từ: bỏ mục hỏng / trùng vế trái (không phân biệt hoa thường), tối đa 200 luật. */
function normalizeReplacements(v: unknown): VoiceReplacement[] {
  const out: VoiceReplacement[] = []
  const seen = new Set<string>()
  for (const x of Array.isArray(v) ? v : []) {
    const r = obj(x)
    if (typeof r.from !== 'string' || typeof r.to !== 'string') continue
    const from = r.from.replace(/\s+/g, ' ').trim().slice(0, 60)
    const to = r.to.replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
    const k = from.toLowerCase()
    if (!from || !to || seen.has(k)) continue
    seen.add(k)
    out.push({ from, to })
    if (out.length >= 200) break
  }
  return out
}
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
  const skills = normalizeSkillToggles(obj(raw).skills)
  if (Object.keys(skills).length) out.skills = skills
  const plugins = normalizePluginToggles(obj(raw).plugins)
  if (Object.keys(plugins).length) out.plugins = plugins
  const sc = obj(obj(raw).scope)
  const scope: Partial<ScopeLockSettings> = {}
  if (SCOPE_MODES.includes(sc.mode as ScopeMode)) scope.mode = sc.mode as ScopeMode
  if (typeof sc.guessShell === 'boolean') scope.guessShell = sc.guessShell
  const exempt = strList(sc.exempt, 100, 300)
  if (exempt.length) scope.exempt = exempt
  if (Object.keys(scope).length) out.scope = scope
  const agentApi = partialAgentApi(obj(raw).agentApi)
  if (agentApi) out.agentApi = agentApi
  const br = obj(obj(raw).browser)
  if (typeof br.agentTools === 'boolean') out.browser = { agentTools: br.agentTools }
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
      app: {
        general: normalizeGeneral({}),
        handoff: normalizeHandoff(r),
        adapters: normalizeAdapters({}),
        connectors: normalizeConnectors({}),
        skills: normalizeSkills({}),
        plugins: { toggles: {} },
        scope: normalizeScope({}),
        agentApi: normalizeAgentApi({}),
        browser: normalizeBrowser({}),
        voice: normalizeVoice({})
      },
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
      connectors: normalizeConnectors(app.connectors),
      skills: normalizeSkills(app.skills),
      plugins: { toggles: normalizePluginToggles(obj(app.plugins).toggles) },
      scope: normalizeScope(app.scope),
      agentApi: normalizeAgentApi(app.agentApi),
      browser: normalizeBrowser(app.browser),
      voice: normalizeVoice(app.voice)
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
      : app.connectors,
    skills: patch.skills ? { toggles: normalizeSkillToggles(patch.skills.toggles) } : app.skills,
    plugins: patch.plugins ? { toggles: normalizePluginToggles(patch.plugins.toggles) } : app.plugins,
    scope: normalizeScope({ ...app.scope, ...patch.scope }),
    agentApi: normalizeAgentApi({ ...app.agentApi, ...patch.agentApi }),
    browser: normalizeBrowser({ ...app.browser, ...patch.browser }),
    voice: normalizeVoice({ ...app.voice, ...patch.voice })
  }
}

/** Bật / tắt plugin: khoá = id plugin. */
export function normalizePluginToggles(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(obj(raw))) if (typeof v === 'boolean' && PLUGIN_ID_RE.test(k)) out[k] = v
  return out
}

/** Plugin có bật cho cấp này không: agent → workspace → app; vắng = bật. */
export function pluginOn(s: Settings, id: string, workspaceId?: string | null, agentId?: string | null): boolean {
  const a = agentId ? s.agents[agentId]?.plugins?.[id] : undefined
  if (a !== undefined) return a
  const w = workspaceId ? s.workspaces[workspaceId]?.plugins?.[id] : undefined
  if (w !== undefined) return w
  return s.app.plugins.toggles[id] ?? true
}

/** Cài đặt bàn giao thực tế của một agent: app → workspace → agent (cấp sau thắng). */
export function resolveHandoff(s: Settings, workspaceId: string | null | undefined, agentId: string | null | undefined): HandoffSettings {
  return {
    ...s.app.handoff,
    ...(workspaceId ? s.workspaces[workspaceId]?.handoff : undefined),
    ...(agentId ? s.agents[agentId]?.handoff : undefined)
  }
}

/**
 * Khoá phạm vi thực tế của một agent: mode / guessShell theo app → workspace → agent (cấp sau thắng);
 * exempt = của app cộng của workspace.
 */
export function resolveScope(s: Settings, workspaceId: string | null | undefined, agentId: string | null | undefined): ScopeLockSettings {
  const w = workspaceId ? s.workspaces[workspaceId]?.scope : undefined
  const a = agentId ? s.agents[agentId]?.scope : undefined
  return {
    mode: a?.mode ?? w?.mode ?? s.app.scope.mode,
    guessShell: a?.guessShell ?? w?.guessShell ?? s.app.scope.guessShell,
    exempt: [...new Set([...s.app.scope.exempt, ...(w?.exempt ?? [])])]
  }
}

/** Quyền Agent API thực tế của một agent: từng khoá agent → workspace → app. */
export function resolveAgentApi(s: Settings, workspaceId: string | null | undefined, agentId: string | null | undefined): AgentApiSettings {
  return {
    ...s.app.agentApi,
    ...(workspaceId ? s.workspaces[workspaceId]?.agentApi : undefined),
    ...(agentId ? s.agents[agentId]?.agentApi : undefined)
  }
}

/** Agent có được dùng tool trình duyệt không: agent → workspace → app. */
export function browserToolsOn(s: Settings, workspaceId: string | null | undefined, agentId: string | null | undefined): boolean {
  const a = agentId ? s.agents[agentId]?.browser?.agentTools : undefined
  if (a !== undefined) return a
  const w = workspaceId ? s.workspaces[workspaceId]?.browser?.agentTools : undefined
  return w ?? s.app.browser.agentTools
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
