/**
 * Plugin của stag.ai (Cài đặt → Plugin, alpha): phần mở rộng cho chính app, theo kiểu plugin của Paperclip.
 * Gói npm / thư mục có `stagPlugin` trong package.json. Tên quyền, tên slot, tên khoá manifest đặt theo Paperclip
 * (`ui.sidebar.register`, `instanceConfigSchema`…) để chuyển plugin qua lại ít phải sửa; giao thức worker là của stag.ai.
 * Dùng chung main + giao diện: kiểu, đọc manifest, nhãn quyền, điền mẫu URL, tên tool MCP.
 */

export const PLUGIN_API_VERSION = 1
export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/
export const PLUGIN_TOOL_RE = /^[a-z][a-z0-9_]{0,39}$/
export const PLUGIN_SLOT_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
/** id dành riêng cho chính app. */
export const RESERVED_PLUGIN_IDS = ['stag', 'stag.ai', 'claude', 'codex', 'terminal']

/** Quyền plugin xin; người dùng duyệt trước khi plugin chạy. Nhãn tiếng Việt cho hộp duyệt quyền. */
export const PLUGIN_CAPABILITIES = {
  'ui.sidebar.register': 'Thêm mục ở thanh bên trái',
  'ui.action.register': 'Thêm nút ở thanh trên cùng và trong menu ⋯ của agent',
  'agent.tools.register': 'Thêm tool cho agent (qua máy chủ MCP stag)',
  'events.subscribe': 'Nhận sự kiện của app (phiên agent mở / đóng, agent chờ bạn, việc bắt đầu / xong)',
  'agents.read': 'Xem danh sách workspace, agent và trạng thái của họ',
  'agent.sessions.send': 'Gõ chữ vào terminal của agent đang chạy',
  'board.read': 'Xem các việc trên kanban',
  'vault.read': 'Đọc note trong vault của workspace',
  'vault.write': 'Ghi note vào vault của workspace',
  'plugin.state.read': 'Đọc dữ liệu riêng của plugin',
  'plugin.state.write': 'Ghi dữ liệu riêng của plugin',
  'ui.notify': 'Hiện thông báo',
  'http.outbound': 'Gọi ra Internet'
} as const
export type PluginCapability = keyof typeof PLUGIN_CAPABILITIES
/** Quyền nặng: hộp duyệt tô đỏ. */
export const RISKY_CAPABILITIES: PluginCapability[] = ['agent.sessions.send', 'vault.write', 'http.outbound']

/** Sự kiện app gửi cho plugin có quyền events.subscribe và khai trong manifest. */
export const PLUGIN_EVENTS = {
  'agent.session.started': 'Phiên agent mở',
  'agent.session.stopped': 'Phiên agent đóng',
  'agent.waiting': 'Agent chờ bạn (xong lượt / hỏi / xin quyền)',
  'task.started': 'Agent bắt đầu một việc',
  'task.done': 'Agent xong việc'
} as const
export type PluginEventType = keyof typeof PLUGIN_EVENTS

export interface PluginEvent {
  type: PluginEventType
  at: string
  workspaceId: string
  agentId?: string
  agentName?: string
  /** Thêm tuỳ sự kiện: reason (agent.waiting), title / scope (task.*), kind (session). */
  data: Record<string, unknown>
}

/** JSON Schema (phần app hiểu để vẽ form cấu hình). */
export interface PluginConfigField {
  type: 'string' | 'number' | 'integer' | 'boolean'
  title?: string
  description?: string
  default?: string | number | boolean
  enum?: Array<string | number>
  /** 'url' / 'textarea'. */
  format?: string
  minimum?: number
  maximum?: number
}
export interface PluginConfigSchema {
  type: 'object'
  properties: Record<string, PluginConfigField>
  required: string[]
}

export interface PluginTool {
  name: string
  displayName: string
  description: string
  /** JSON Schema object của tham số. */
  parametersSchema: Record<string, unknown>
}

/**
 * Slot giao diện. `sidebar` = mục ở thanh bên; `globalToolbarButton` = nút trên thanh trên cùng; `agentMenu` = mục
 * trong menu ⋯ của agent. Bấm → `open` (mở URL, mẫu có {config.x} / {workspace.name} / {workspace.path} /
 * {agent.name} / {agent.id}) hoặc `action` (gọi performAction của worker).
 */
export interface PluginSlot {
  type: 'sidebar' | 'globalToolbarButton' | 'agentMenu'
  id: string
  displayName: string
  open?: { url: string; target: 'browser' | 'external' }
  action?: string
}

export interface PluginManifest {
  id: string
  apiVersion: number
  displayName: string
  description: string
  author: string
  categories: string[]
  capabilities: PluginCapability[]
  /** Đường dẫn trong gói. Không có worker: chỉ slot `open` (mở URL). */
  entrypoints: { worker?: string }
  instanceConfigSchema: PluginConfigSchema | null
  tools: PluginTool[]
  events: PluginEventType[]
  ui: { slots: PluginSlot[] }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function fail(field: string, msg: string): never {
  throw new Error(`stagPlugin.${field}: ${msg}`)
}

/** Đường dẫn tương đối nằm trong gói (không `..`, không tuyệt đối). */
export function safeRelPath(p: string): boolean {
  return !!p && !/^([A-Za-z]:|[\\/])/.test(p) && !p.split(/[\\/]+/).includes('..')
}

function parseConfigSchema(raw: unknown): PluginConfigSchema | null {
  const r = obj(raw)
  if (!Object.keys(r).length) return null
  if (r.type !== 'object') fail('instanceConfigSchema', 'phải là { "type": "object", "properties": … }')
  const properties: Record<string, PluginConfigField> = {}
  for (const [k, v] of Object.entries(obj(r.properties))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k)) fail(`instanceConfigSchema.properties.${k}`, 'tên trường chỉ gồm chữ, số, "_"')
    const f = obj(v)
    const type = f.type
    if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean')
      fail(`instanceConfigSchema.properties.${k}.type`, 'chỉ hỗ trợ string / number / integer / boolean')
    const field: PluginConfigField = { type }
    if (str(f.title)) field.title = str(f.title, 100)
    if (str(f.description)) field.description = str(f.description, 500)
    if (['string', 'number', 'boolean'].includes(typeof f.default)) field.default = f.default as string | number | boolean
    if (Array.isArray(f.enum)) field.enum = f.enum.filter((x) => typeof x === 'string' || typeof x === 'number').slice(0, 50) as Array<string | number>
    if (str(f.format)) field.format = str(f.format, 20)
    if (typeof f.minimum === 'number') field.minimum = f.minimum
    if (typeof f.maximum === 'number') field.maximum = f.maximum
    properties[k] = field
  }
  const required = Array.isArray(r.required) ? r.required.filter((x): x is string => typeof x === 'string' && x in properties) : []
  return { type: 'object', properties, required }
}

/**
 * Đọc `stagPlugin` trong package.json. Lỗi → ném lỗi tiếng Việt chỉ rõ trường. `version` lấy từ package.json.
 */
export function parsePluginManifest(pkg: unknown): { manifest: PluginManifest; name: string; version: string } {
  const p = obj(pkg)
  const m = obj(p.stagPlugin)
  if (!Object.keys(m).length) throw new Error('package.json không có mục "stagPlugin" (manifest plugin của stag.ai).')
  const id = str(m.id, 64)
  if (!PLUGIN_ID_RE.test(id)) fail('id', 'chỉ gồm a-z, 0-9, ".", "_", "-" (2–64 ký tự), vd. "acme.launcher"')
  if (RESERVED_PLUGIN_IDS.includes(id)) fail('id', `"${id}" dành cho chính app`)
  const apiVersion = m.apiVersion ?? PLUGIN_API_VERSION
  if (apiVersion !== PLUGIN_API_VERSION) fail('apiVersion', `stag.ai chỉ hỗ trợ apiVersion ${PLUGIN_API_VERSION}`)
  const displayName = str(m.displayName, 80) || id
  const capabilities: PluginCapability[] = []
  for (const c of Array.isArray(m.capabilities) ? m.capabilities : []) {
    if (typeof c !== 'string' || !(c in PLUGIN_CAPABILITIES)) fail('capabilities', `quyền "${String(c)}" không có trong stag.ai`)
    if (!capabilities.includes(c as PluginCapability)) capabilities.push(c as PluginCapability)
  }
  const e = obj(m.entrypoints)
  const worker = str(e.worker, 200)
  if (worker && !safeRelPath(worker)) fail('entrypoints.worker', 'phải là đường dẫn trong gói, vd. "./dist/worker.js"')

  const tools: PluginTool[] = []
  for (const [i, raw] of (Array.isArray(m.tools) ? m.tools : []).entries()) {
    const t = obj(raw)
    const name = str(t.name, 40)
    if (!PLUGIN_TOOL_RE.test(name)) fail(`tools[${i}].name`, 'chữ thường, số, "_", bắt đầu bằng chữ, tối đa 40 ký tự')
    if (tools.some((x) => x.name === name)) fail(`tools[${i}].name`, `trùng tên "${name}"`)
    const description = str(t.description, 1000)
    if (!description) fail(`tools[${i}].description`, 'cần mô tả (agent dựa vào đó để biết khi nào gọi)')
    const schema = obj(t.parametersSchema)
    tools.push({ name, displayName: str(t.displayName, 80) || name, description, parametersSchema: Object.keys(schema).length ? schema : { type: 'object', properties: {} } })
  }
  if (tools.length && !capabilities.includes('agent.tools.register')) fail('tools', 'cần quyền "agent.tools.register"')

  const events: PluginEventType[] = []
  for (const ev of Array.isArray(m.events) ? m.events : []) {
    if (typeof ev !== 'string' || !(ev in PLUGIN_EVENTS)) fail('events', `sự kiện "${String(ev)}" không có trong stag.ai`)
    if (!events.includes(ev as PluginEventType)) events.push(ev as PluginEventType)
  }
  if (events.length && !capabilities.includes('events.subscribe')) fail('events', 'cần quyền "events.subscribe"')

  const slots: PluginSlot[] = []
  for (const [i, raw] of (Array.isArray(obj(m.ui).slots) ? (obj(m.ui).slots as unknown[]) : []).entries()) {
    const s = obj(raw)
    const type = s.type
    if (type !== 'sidebar' && type !== 'globalToolbarButton' && type !== 'agentMenu') fail(`ui.slots[${i}].type`, 'chỉ hỗ trợ sidebar / globalToolbarButton / agentMenu')
    const sid = str(s.id, 40)
    if (!PLUGIN_SLOT_RE.test(sid)) fail(`ui.slots[${i}].id`, 'chữ thường, số, "_", "-"')
    const need: PluginCapability = type === 'sidebar' ? 'ui.sidebar.register' : 'ui.action.register'
    if (!capabilities.includes(need)) fail(`ui.slots[${i}]`, `slot ${type} cần quyền "${need}"`)
    const slot: PluginSlot = { type, id: sid, displayName: str(s.displayName, 60) || sid }
    const open = obj(s.open)
    if (Object.keys(open).length) {
      const url = str(open.url, 1000)
      if (!/^(https?:\/\/|\{config\.[A-Za-z_][A-Za-z0-9_]*\})/.test(url)) fail(`ui.slots[${i}].open.url`, 'phải bắt đầu bằng http(s):// hoặc {config.<trường>}')
      slot.open = { url, target: open.target === 'external' ? 'external' : 'browser' }
    } else if (str(s.action, 60)) slot.action = str(s.action, 60)
    else fail(`ui.slots[${i}]`, 'cần "open" (mở URL) hoặc "action" (gọi worker)')
    if (slot.action && !worker) fail(`ui.slots[${i}].action`, 'slot gọi worker nhưng gói không có entrypoints.worker')
    slots.push(slot)
  }
  if ((tools.length || events.length) && !worker) fail('entrypoints.worker', 'plugin có tool / sự kiện thì cần worker')

  return {
    manifest: {
      id,
      apiVersion,
      displayName,
      description: str(m.description, 1000) || str(p.description, 1000),
      author: str(m.author, 100) || (typeof p.author === 'string' ? str(p.author, 100) : str(obj(p.author).name, 100)),
      categories: (Array.isArray(m.categories) ? m.categories : []).filter((c): c is string => typeof c === 'string').slice(0, 10),
      capabilities,
      entrypoints: worker ? { worker } : {},
      instanceConfigSchema: parseConfigSchema(m.instanceConfigSchema),
      tools,
      events,
      ui: { slots }
    },
    name: str(p.name, 214),
    version: str(p.version, 50) || '0.0.0'
  }
}

/** Quyền mới so với lần duyệt trước (cập nhật xin thêm quyền → chờ duyệt lại). */
export function newCapabilities(manifest: PluginManifest, approved: string[]): PluginCapability[] {
  return manifest.capabilities.filter((c) => !approved.includes(c))
}

/** Cấu hình đã điền mặc định + ép kiểu theo schema; lỗi (tiếng Việt) theo từng trường. */
export function normalizePluginConfig(schema: PluginConfigSchema | null, raw: unknown): { config: Record<string, unknown>; errors: Record<string, string> } {
  const config: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  if (!schema) return { config, errors }
  const r = obj(raw)
  for (const [k, f] of Object.entries(schema.properties)) {
    let v = r[k]
    if (v === undefined || v === '' || v === null) v = f.default
    if (v === undefined || v === '') {
      if (schema.required.includes(k)) errors[k] = 'Bắt buộc.'
      continue
    }
    if (f.type === 'boolean') v = v === true || v === 'true'
    else if (f.type === 'number' || f.type === 'integer') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) {
        errors[k] = f.type === 'integer' ? 'Cần số nguyên.' : 'Cần một số.'
        continue
      }
      if (f.minimum !== undefined && n < f.minimum) errors[k] = `Nhỏ nhất ${f.minimum}.`
      if (f.maximum !== undefined && n > f.maximum) errors[k] = `Lớn nhất ${f.maximum}.`
      v = n
    } else {
      v = String(v)
      if (f.format === 'url' && !/^https?:\/\/\S+$/i.test(v as string)) errors[k] = 'Cần địa chỉ http(s)://…'
    }
    if (f.enum && !f.enum.includes(v as string | number)) errors[k] = `Chọn một trong: ${f.enum.join(', ')}.`
    config[k] = v
  }
  return { config, errors }
}

export interface SlotContext {
  config: Record<string, unknown>
  workspace?: { id: string; name: string; path: string }
  agent?: { id: string; name: string }
}

/** Điền mẫu URL của slot: {config.x}, {workspace.name|path|id}, {agent.name|id}. Giá trị (trừ config đứng đầu) được mã hoá URL. */
export function fillSlotUrl(template: string, ctx: SlotContext): string {
  return template.replace(/\{(config|workspace|agent)\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, scope: string, key: string, offset: number) => {
    const src = scope === 'config' ? ctx.config : ((ctx[scope as 'workspace' | 'agent'] ?? {}) as Record<string, unknown>)
    const v = src[key]
    if (v === undefined || v === null) return ''
    const s = String(v)
    // Mẫu bắt đầu bằng {config.url}: giữ nguyên (là chính địa chỉ gốc), bỏ "/" cuối.
    return offset === 0 && scope === 'config' ? s.replace(/\/+$/, '') : encodeURIComponent(s)
  })
}

/** Tên tool trong máy chủ MCP stag: `<id plugin>__<tool>` (id đổi ".", "-" thành "_"), tối đa 64 ký tự. */
export function pluginToolName(pluginId: string, tool: string): string {
  return `${pluginId.replace(/[^a-z0-9_]/g, '_')}__${tool}`.slice(0, 64)
}

// ---- trạng thái hiện ở giao diện ----

export type PluginState = 'ready' | 'starting' | 'stopped' | 'disabled' | 'error' | 'approval_pending' | 'upgrade_pending'

export interface PluginLog {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface PluginStatus {
  state: PluginState
  pid: number | null
  startedAt: string | null
  restarts: number
  lastError: string | null
  health: { ok: boolean; message?: string; at: string } | null
  toolCalls: number
  events: number
}

/** Plugin đã cài (gửi cho giao diện). */
export interface InstalledPlugin {
  manifest: PluginManifest
  /** Tên gói npm + phiên bản. */
  name: string
  version: string
  source: { type: 'npm'; name: string; version: string } | { type: 'local'; path: string }
  dir: string
  installedAt: string
  /** Quyền người dùng đã duyệt (khác manifest.capabilities → chờ duyệt). */
  approved: PluginCapability[]
  /** Cấu hình hiện tại (theo instanceConfigSchema; không có bí mật). */
  config: Record<string, unknown>
  status: PluginStatus
  logs: PluginLog[]
}

export type PluginInstallRequest = { type: 'npm'; name: string; version?: string } | { type: 'local'; path: string }
