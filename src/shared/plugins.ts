/**
 * Plugin của stag.ai (Cài đặt → Plugin, alpha): phần mở rộng cho chính app, theo kiểu plugin của Paperclip.
 * Gói npm / thư mục có `stagPlugin` trong package.json. Tên quyền, tên slot, tên khoá manifest đặt theo Paperclip
 * (`ui.sidebar.register`, `instanceConfigSchema`…) để chuyển plugin qua lại ít phải sửa; giao thức worker là của stag.ai.
 * Dùng chung main + giao diện: kiểu, đọc manifest, nhãn quyền, điền mẫu URL, tên tool MCP.
 */

import { t, type PlainKey } from './i18n'

export const PLUGIN_API_VERSION = 1
export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/
export const PLUGIN_TOOL_RE = /^[a-z][a-z0-9_]{0,39}$/
export const PLUGIN_SLOT_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
/** Khoá việc theo lịch / webhook. */
export const PLUGIN_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
/** id dành riêng cho chính app. */
export const RESERVED_PLUGIN_IDS = ['stag', 'stag.ai', 'claude', 'codex', 'terminal']

/** Bảng `{ khoá: nhãn }` đọc nhãn theo ngôn ngữ đang chọn mỗi lần truy cập (getter gọi t()), không đóng băng lúc import. */
function liveLabels<K extends string>(keys: Record<K, PlainKey>): { readonly [P in K]: string } {
  const out = {} as { [P in K]: string }
  for (const k of Object.keys(keys) as K[]) {
    const key: PlainKey = keys[k]
    Object.defineProperty(out, k, { enumerable: true, get: () => t(key) })
  }
  return out
}

/** Quyền plugin xin; người dùng duyệt trước khi plugin chạy. Nhãn (theo ngôn ngữ giao diện) cho hộp duyệt quyền. */
const CAPABILITY_LABELS = {
  'ui.sidebar.register': 'plugins.cap.ui.sidebar.register',
  'ui.action.register': 'plugins.cap.ui.action.register',
  'ui.page.register': 'plugins.cap.ui.page.register',
  'ui.dashboardWidget.register': 'plugins.cap.ui.dashboardWidget.register',
  'instance.settings.register': 'plugins.cap.instance.settings.register',
  'agent.tools.register': 'plugins.cap.agent.tools.register',
  'events.subscribe': 'plugins.cap.events.subscribe',
  'agents.read': 'plugins.cap.agents.read',
  'agent.sessions.send': 'plugins.cap.agent.sessions.send',
  'board.read': 'plugins.cap.board.read',
  'vault.read': 'plugins.cap.vault.read',
  'vault.write': 'plugins.cap.vault.write',
  'plugin.state.read': 'plugins.cap.plugin.state.read',
  'plugin.state.write': 'plugins.cap.plugin.state.write',
  'ui.notify': 'plugins.cap.ui.notify',
  'jobs.schedule': 'plugins.cap.jobs.schedule',
  'webhooks.receive': 'plugins.cap.webhooks.receive',
  'files.read': 'plugins.cap.files.read',
  'http.outbound': 'plugins.cap.http.outbound',
  'artifacts.publish': 'plugins.cap.artifacts.publish',
  'browser.cookies': 'plugins.cap.browser.cookies'
} as const satisfies Record<string, PlainKey>
export const PLUGIN_CAPABILITIES = liveLabels(CAPABILITY_LABELS)
export type PluginCapability = keyof typeof CAPABILITY_LABELS
/** Quyền nặng: hộp duyệt tô đỏ. */
export const RISKY_CAPABILITIES: PluginCapability[] = ['agent.sessions.send', 'vault.write', 'http.outbound', 'browser.cookies']

/** Sự kiện app gửi cho plugin có quyền events.subscribe và khai trong manifest. */
const EVENT_LABELS = {
  'agent.session.started': 'plugins.event.agent.session.started',
  'agent.session.stopped': 'plugins.event.agent.session.stopped',
  'agent.waiting': 'plugins.event.agent.waiting',
  'task.started': 'plugins.event.task.started',
  'task.done': 'plugins.event.task.done',
  'artifact.written': 'plugins.event.artifact.written',
  'vault.note.changed': 'plugins.event.vault.note.changed',
  'handoff.done': 'plugins.event.handoff.done',
  'scope.conflict': 'plugins.event.scope.conflict'
} as const satisfies Record<string, PlainKey>
export const PLUGIN_EVENTS = liveLabels(EVENT_LABELS)
export type PluginEventType = keyof typeof EVENT_LABELS

export interface PluginEvent {
  type: PluginEventType
  at: string
  workspaceId: string
  agentId?: string
  agentName?: string
  /**
   * Thêm tuỳ sự kiện:
   * - agent.waiting: reason; task.started: title, scope; task.done: title; agent.session.*: kind
   * - artifact.written: path (tương đối so với dự án, "/"), kind ('write' = tạo / ghi cả file, 'edit' = sửa)
   * - vault.note.changed: path (tương đối so với vault), by ('agent' | 'user'); by 'user' thì không có agentId
   * - handoff.done: percent (% context lúc bàn giao, số nguyên; null nếu chưa biết), fromSessionId, summary (bản bàn giao)
   * - scope.conflict: path, paths, ownerAgentId, ownerAgentName, taskTitle, entry, command?, decision
   *   ('ask' = Claude Code hỏi trong terminal, 'allowed' / 'denied' = bạn trả lời trong app với Codex,
   *   'blocked' = chặn luôn, 'warned' = cho sửa, chỉ cảnh báo — theo Cài đặt → Khoá phạm vi)
   */
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
  /** Thời gian chờ worker trả lời tool này (giây, 1–1800); vắng = 120 s. Cho tool chạy lâu (vd. cắt video). */
  timeoutSec?: number
}

/**
 * Slot giao diện.
 * - Nút: `sidebar` = mục ở thanh bên; `globalToolbarButton` = nút trên thanh trên cùng; `agentMenu` = mục trong menu ⋯
 *   của agent. Bấm → `open` (mở URL, mẫu có {config.x} / {workspace.name} / {workspace.path} / {agent.name} /
 *   {agent.id}) hoặc `action` (gọi performAction của worker).
 * - Trang (khung cách ly, file trong thư mục `entrypoints.ui`): `page` = tab riêng cạnh Kanban / Agents / Artifacts;
 *   `settingsPage` = tab riêng trong trang plugin ở Cài đặt → Plugin; `dashboardWidget` = ô trong lưới agent (người dùng
 *   thêm từ nút "+ Widget" của lưới). `path` = file HTML trong thư mục đó.
 * - `statusBarItem` = chữ ngắn trên thanh trạng thái dưới cùng (quyền ui.action.register). Chữ = displayName, hoặc
 *   worker `getData(dataKey)` trả `string | {text, tooltip?, tone?: 'default'|'ok'|'warn'|'error'}`; app đọc lại khi
 *   mở, mỗi 60 s và khi worker `streams.emit('statusBar', …)`. Bấm → `open` / `action` (không bắt buộc).
 */
export type PluginButtonSlotType = 'sidebar' | 'globalToolbarButton' | 'agentMenu'
export type PluginPageSlotType = 'page' | 'settingsPage' | 'dashboardWidget'
export type PluginStatusSlotType = 'statusBarItem'
export interface PluginSlot {
  type: PluginButtonSlotType | PluginPageSlotType | PluginStatusSlotType
  id: string
  displayName: string
  open?: { url: string; target: 'browser' | 'external' }
  action?: string
  path?: string
  /** statusBarItem: khoá getData của worker cho chữ hiện ra. */
  dataKey?: string
}

/** Kết quả getData(dataKey) của slot statusBarItem (đã chuẩn hoá). */
export interface PluginStatusText {
  text: string
  tooltip?: string
  tone: 'default' | 'ok' | 'warn' | 'error'
}

/** Chuẩn hoá giá trị worker trả cho statusBarItem; null = không hiện. */
export function statusTextFrom(v: unknown): PluginStatusText | null {
  if (typeof v === 'string') return v.trim() ? { text: v.trim().slice(0, 80), tone: 'default' } : null
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, 80) : ''
  if (!text) return null
  const tone = o.tone === 'ok' || o.tone === 'warn' || o.tone === 'error' ? o.tone : 'default'
  return { text, tone, ...(typeof o.tooltip === 'string' && o.tooltip ? { tooltip: o.tooltip.slice(0, 300) } : {}) }
}

/** Việc theo lịch (cron 5 trường theo giờ máy). */
export interface PluginJob {
  key: string
  displayName: string
  description: string
  schedule: string
}

/** Điểm nhận webhook: POST tới địa chỉ cục bộ của app (InstalledPlugin.webhookUrls). */
export interface PluginWebhook {
  endpointKey: string
  displayName: string
  description: string
}

export interface PluginManifest {
  id: string
  apiVersion: number
  displayName: string
  description: string
  author: string
  categories: string[]
  /** Tên icon trong bộ icon của app (Lucide, `icons.ts`) cho trang của plugin ở thanh trái; vắng / không có = chữ cái đầu. */
  icon?: string
  capabilities: PluginCapability[]
  /** Đường dẫn trong gói. Không có worker: chỉ slot `open` (mở URL). */
  /** worker: file JS chạy trong tiến trình riêng; ui: thư mục file giao diện (slot page / settingsPage). */
  entrypoints: { worker?: string; ui?: string }
  instanceConfigSchema: PluginConfigSchema | null
  tools: PluginTool[]
  events: PluginEventType[]
  jobs: PluginJob[]
  webhooks: PluginWebhook[]
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
  if (r.type !== 'object') fail('instanceConfigSchema', t('plugins.manifest.schemaObject', { example: '{ "type": "object", "properties": … }' }))
  const properties: Record<string, PluginConfigField> = {}
  for (const [k, v] of Object.entries(obj(r.properties))) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(k)) fail(`instanceConfigSchema.properties.${k}`, t('plugins.manifest.fieldName'))
    const f = obj(v)
    const type = f.type
    if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean')
      fail(`instanceConfigSchema.properties.${k}.type`, t('plugins.manifest.fieldType'))
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
  if (!Object.keys(m).length) throw new Error(t('plugins.manifest.missing'))
  const id = str(m.id, 64)
  if (!PLUGIN_ID_RE.test(id)) fail('id', t('plugins.manifest.id'))
  if (RESERVED_PLUGIN_IDS.includes(id)) fail('id', t('plugins.manifest.idReserved', { id }))
  const apiVersion = m.apiVersion ?? PLUGIN_API_VERSION
  if (apiVersion !== PLUGIN_API_VERSION) fail('apiVersion', t('plugins.manifest.apiVersion', { version: String(PLUGIN_API_VERSION) }))
  const displayName = str(m.displayName, 80) || id
  const capabilities: PluginCapability[] = []
  for (const c of Array.isArray(m.capabilities) ? m.capabilities : []) {
    if (typeof c !== 'string' || !(c in PLUGIN_CAPABILITIES)) fail('capabilities', t('plugins.manifest.unknownCap', { name: String(c) }))
    if (!capabilities.includes(c as PluginCapability)) capabilities.push(c as PluginCapability)
  }
  const e = obj(m.entrypoints)
  const worker = str(e.worker, 200)
  if (worker && !safeRelPath(worker)) fail('entrypoints.worker', t('plugins.manifest.workerPath'))
  const uiDir = str(e.ui, 200)
  if (uiDir && !safeRelPath(uiDir)) fail('entrypoints.ui', t('plugins.manifest.uiPath'))

  const tools: PluginTool[] = []
  for (const [i, raw] of (Array.isArray(m.tools) ? m.tools : []).entries()) {
    const tl = obj(raw)
    const name = str(tl.name, 40)
    if (!PLUGIN_TOOL_RE.test(name)) fail(`tools[${i}].name`, t('plugins.manifest.toolName'))
    if (tools.some((x) => x.name === name)) fail(`tools[${i}].name`, t('plugins.manifest.dupName', { name }))
    const description = str(tl.description, 1000)
    if (!description) fail(`tools[${i}].description`, t('plugins.manifest.toolDesc'))
    const schema = obj(tl.parametersSchema)
    const tool: PluginTool = { name, displayName: str(tl.displayName, 80) || name, description, parametersSchema: Object.keys(schema).length ? schema : { type: 'object', properties: {} } }
    if (typeof tl.timeoutSec === 'number' && Number.isFinite(tl.timeoutSec)) tool.timeoutSec = Math.min(1800, Math.max(1, Math.round(tl.timeoutSec)))
    tools.push(tool)
  }
  if (tools.length && !capabilities.includes('agent.tools.register')) fail('tools', t('plugins.manifest.needCap', { cap: 'agent.tools.register' }))

  const events: PluginEventType[] = []
  for (const ev of Array.isArray(m.events) ? m.events : []) {
    if (typeof ev !== 'string' || !(ev in PLUGIN_EVENTS)) fail('events', t('plugins.manifest.unknownEvent', { name: String(ev) }))
    if (!events.includes(ev as PluginEventType)) events.push(ev as PluginEventType)
  }
  if (events.length && !capabilities.includes('events.subscribe')) fail('events', t('plugins.manifest.needCap', { cap: 'events.subscribe' }))

  const jobs: PluginJob[] = []
  for (const [i, raw] of (Array.isArray(m.jobs) ? m.jobs : []).entries()) {
    const j = obj(raw)
    const key = str(j.key ?? j.jobKey, 40)
    if (!PLUGIN_KEY_RE.test(key)) fail(`jobs[${i}].key`, t('plugins.manifest.key'))
    if (jobs.some((x) => x.key === key)) fail(`jobs[${i}].key`, t('plugins.manifest.dupKey', { key }))
    const schedule = str(j.schedule, 100)
    const cronErr = cronProblem(schedule)
    if (cronErr) fail(`jobs[${i}].schedule`, cronErr)
    jobs.push({ key, displayName: str(j.displayName, 80) || key, description: str(j.description, 500), schedule })
  }
  if (jobs.length && !capabilities.includes('jobs.schedule')) fail('jobs', t('plugins.manifest.needCap', { cap: 'jobs.schedule' }))

  const webhooks: PluginWebhook[] = []
  for (const [i, raw] of (Array.isArray(m.webhooks) ? m.webhooks : []).entries()) {
    const w = obj(raw)
    const endpointKey = str(w.endpointKey ?? w.key, 40)
    if (!PLUGIN_KEY_RE.test(endpointKey)) fail(`webhooks[${i}].endpointKey`, t('plugins.manifest.key'))
    if (webhooks.some((x) => x.endpointKey === endpointKey)) fail(`webhooks[${i}].endpointKey`, t('plugins.manifest.dupKey', { key: endpointKey }))
    webhooks.push({ endpointKey, displayName: str(w.displayName, 80) || endpointKey, description: str(w.description, 500) })
  }
  if (webhooks.length && !capabilities.includes('webhooks.receive')) fail('webhooks', t('plugins.manifest.needCap', { cap: 'webhooks.receive' }))

  const SLOT_TYPES: PluginSlot['type'][] = ['sidebar', 'globalToolbarButton', 'agentMenu', 'page', 'settingsPage', 'dashboardWidget', 'statusBarItem']
  const slots: PluginSlot[] = []
  for (const [i, raw] of (Array.isArray(obj(m.ui).slots) ? (obj(m.ui).slots as unknown[]) : []).entries()) {
    const s = obj(raw)
    const type = s.type as PluginSlot['type']
    if (!SLOT_TYPES.includes(type))
      fail(`ui.slots[${i}].type`, t('plugins.manifest.slotType', { types: SLOT_TYPES.join(' / ') }))
    const sid = str(s.id, 40)
    if (!PLUGIN_SLOT_RE.test(sid)) fail(`ui.slots[${i}].id`, t('plugins.manifest.key'))
    if (slots.some((x) => x.id === sid)) fail(`ui.slots[${i}].id`, t('plugins.manifest.dupId', { id: sid }))
    const need: PluginCapability =
      type === 'sidebar'
        ? 'ui.sidebar.register'
        : type === 'page'
          ? 'ui.page.register'
          : type === 'settingsPage'
            ? 'instance.settings.register'
            : type === 'dashboardWidget'
              ? 'ui.dashboardWidget.register'
              : 'ui.action.register'
    if (!capabilities.includes(need)) fail(`ui.slots[${i}]`, t('plugins.manifest.slotNeedCap', { type, cap: need }))
    const slot: PluginSlot = { type, id: sid, displayName: str(s.displayName, 60) || sid }
    if (type === 'page' || type === 'settingsPage' || type === 'dashboardWidget') {
      if (!uiDir) fail(`ui.slots[${i}]`, t('plugins.manifest.slotNeedUi', { type }))
      const path = (str(s.path, 200) || 'index.html').replace(/^\.\//, '')
      if (!safeRelPath(path) || !/\.html?$/i.test(path)) fail(`ui.slots[${i}].path`, t('plugins.manifest.slotPath'))
      slot.path = path.replace(/\\/g, '/')
      slots.push(slot)
      continue
    }
    if (type === 'statusBarItem' && s.dataKey !== undefined) {
      const dataKey = str(s.dataKey, 40)
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(dataKey)) fail(`ui.slots[${i}].dataKey`, t('plugins.manifest.dataKey'))
      if (!worker) fail(`ui.slots[${i}].dataKey`, t('plugins.manifest.dataKeyNoWorker'))
      slot.dataKey = dataKey
    }
    const open = obj(s.open)
    if (Object.keys(open).length) {
      const url = str(open.url, 1000)
      if (!/^(https?:\/\/|\{config\.[A-Za-z_][A-Za-z0-9_]*\})/.test(url)) fail(`ui.slots[${i}].open.url`, t('plugins.manifest.openUrl', { lb: '{', rb: '}' }))
      slot.open = { url, target: open.target === 'external' ? 'external' : 'browser' }
    } else if (str(s.action, 60)) slot.action = str(s.action, 60)
    else if (type !== 'statusBarItem') fail(`ui.slots[${i}]`, t('plugins.manifest.slotNeedOpen'))
    if (slot.action && !worker) fail(`ui.slots[${i}].action`, t('plugins.manifest.actionNoWorker'))
    slots.push(slot)
  }
  if ((tools.length || events.length || jobs.length || webhooks.length) && !worker)
    fail('entrypoints.worker', t('plugins.manifest.needWorker'))

  return {
    manifest: {
      id,
      apiVersion,
      displayName,
      description: str(m.description, 1000) || str(p.description, 1000),
      author: str(m.author, 100) || (typeof p.author === 'string' ? str(p.author, 100) : str(obj(p.author).name, 100)),
      categories: (Array.isArray(m.categories) ? m.categories : []).filter((c): c is string => typeof c === 'string').slice(0, 10),
      ...(/^[a-z][a-z0-9]{0,30}$/.test(str(m.icon, 40)) ? { icon: str(m.icon, 40) } : {}),
      capabilities,
      entrypoints: { ...(worker ? { worker } : {}), ...(uiDir ? { ui: uiDir } : {}) },
      instanceConfigSchema: parseConfigSchema(m.instanceConfigSchema),
      tools,
      events,
      jobs,
      webhooks,
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
      if (schema.required.includes(k)) errors[k] = t('plugins.config.required')
      continue
    }
    if (f.type === 'boolean') v = v === true || v === 'true'
    else if (f.type === 'number' || f.type === 'integer') {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) {
        errors[k] = f.type === 'integer' ? t('plugins.config.integer') : t('plugins.config.number')
        continue
      }
      if (f.minimum !== undefined && n < f.minimum) errors[k] = t('plugins.config.min', { n: String(f.minimum) })
      if (f.maximum !== undefined && n > f.maximum) errors[k] = t('plugins.config.max', { n: String(f.maximum) })
      v = n
    } else {
      v = String(v)
      if (f.format === 'url' && !/^https?:\/\/\S+$/i.test(v as string)) errors[k] = t('plugins.config.url')
    }
    if (f.enum && !f.enum.includes(v as string | number)) errors[k] = t('plugins.config.enum', { options: f.enum.join(', ') })
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

// ---- cron (việc theo lịch) ----

const CRON_FIELDS: Array<{ name: PlainKey; min: number; max: number }> = [
  { name: 'plugins.cron.minute', min: 0, max: 59 },
  { name: 'plugins.cron.hour', min: 0, max: 23 },
  { name: 'plugins.cron.day', min: 1, max: 31 },
  { name: 'plugins.cron.month', min: 1, max: 12 },
  { name: 'plugins.cron.weekday', min: 0, max: 7 }
]

export interface CronSpec {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  /** 0 = Chủ nhật (7 cũng là Chủ nhật). */
  dow: Set<number>
  domAny: boolean
  dowAny: boolean
}

/** Đọc biểu thức cron 5 trường: `*`, `*\/n`, `a`, `a-b`, `a-b/n`, `a,b`. Lỗi → ném lỗi tiếng Việt. */
export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(t('plugins.cron.fields'))
  const sets = parts.map((part, i) => {
    const f = CRON_FIELDS[i]
    const out = new Set<number>()
    for (const item of part.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item)
      if (!m) throw new Error(t('plugins.cron.badField', { field: t(f.name), part }))
      const step = m[4] ? Number(m[4]) : 1
      let lo = f.min
      let hi = f.max
      if (m[1] !== '*') {
        lo = Number(m[2])
        hi = m[3] !== undefined ? Number(m[3]) : m[4] ? f.max : lo
      }
      if (lo < f.min || hi > f.max || lo > hi || step < 1) throw new Error(t('plugins.cron.range', { field: t(f.name), part, min: String(f.min), max: String(f.max) }))
      for (let v = lo; v <= hi; v += step) out.add(i === 4 && v === 7 ? 0 : v)
    }
    return out
  })
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], domAny: parts[2] === '*', dowAny: parts[4] === '*' }
}

/** Lỗi của biểu thức cron (null = hợp lệ). */
export function cronProblem(expr: string): string | null {
  if (!expr) return t('plugins.cron.missing')
  try {
    parseCron(expr)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

function cronDayOk(c: CronSpec, d: Date): boolean {
  const dom = c.dom.has(d.getDate())
  const dow = c.dow.has(d.getDay())
  // Như cron chuẩn: giới hạn cả ngày lẫn thứ → khớp một trong hai.
  if (!c.domAny && !c.dowAny) return dom || dow
  return dom && dow
}

/** Lần chạy kế tiếp sau `from` (theo giờ máy), null nếu không có trong 2 năm tới. */
export function nextCronRun(expr: string | CronSpec, from: Date): Date | null {
  const c = typeof expr === 'string' ? parseCron(expr) : expr
  const d = new Date(from.getTime())
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = from.getTime() + 2 * 366 * 24 * 3600_000
  while (d.getTime() <= limit) {
    if (!c.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!cronDayOk(c, d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!c.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!c.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d
  }
  return null
}

/** Mô tả ngắn (theo ngôn ngữ giao diện) cho vài lịch hay gặp; còn lại trả nguyên biểu thức. */
export function describeCron(expr: string): string {
  const p = expr.trim().split(/\s+/)
  if (p.length !== 5) return expr
  const [mi, h, dom, mon, dow] = p
  const rest = dom === '*' && mon === '*' && dow === '*'
  if (rest && h === '*' && mi === '*') return t('plugins.cron.everyMinute')
  if (rest && h === '*' && /^\*\/\d+$/.test(mi)) return t('plugins.cron.everyMinutes', { count: Number(mi.slice(2)) })
  if (rest && h === '*' && /^\d+$/.test(mi)) return mi === '0' ? t('plugins.cron.hourly') : t('plugins.cron.minuteOfHour', { minute: mi })
  if (rest && /^\*\/\d+$/.test(h) && /^\d+$/.test(mi)) return t('plugins.cron.everyHours', { count: Number(h.slice(2)), minute: mi })
  const at = /^\d+$/.test(h) && /^\d+$/.test(mi) ? `${h.padStart(2, '0')}:${mi.padStart(2, '0')}` : null
  if (at && rest) return t('plugins.cron.daily', { time: at })
  if (at && dom === '*' && mon === '*' && dow === '1-5') return t('plugins.cron.weekdays', { time: at })
  return expr
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

/** Một lần chạy việc theo lịch. */
export interface PluginJobRun {
  runId: string
  key: string
  trigger: 'schedule' | 'manual'
  startedAt: string
  finishedAt: string | null
  ok: boolean | null
  error?: string
}

/** Một lần nhận webhook. */
export interface PluginWebhookDelivery {
  requestId: string
  endpointKey: string
  at: string
  status: number
  ms: number
  error?: string
}

/** Trạng thái một việc theo lịch. */
export interface PluginJobStatus {
  key: string
  nextRun: string | null
  running: boolean
}

/** Plugin đã cài (gửi cho giao diện). */
export interface InstalledPlugin {
  manifest: PluginManifest
  /** Tên gói npm + phiên bản. */
  name: string
  version: string
  source: { type: 'npm'; name: string; version: string } | { type: 'local'; path: string } | { type: 'catalog'; slug: string }
  dir: string
  installedAt: string
  /** Quyền người dùng đã duyệt (khác manifest.capabilities → chờ duyệt). */
  approved: PluginCapability[]
  /** Lúc người dùng duyệt plugin; vắng = chưa duyệt (chưa chạy, kể cả khi không xin quyền nào). */
  approvedAt?: string
  /** Cấu hình hiện tại (theo instanceConfigSchema; không có bí mật). */
  config: Record<string, unknown>
  status: PluginStatus
  logs: PluginLog[]
  jobs: PluginJobStatus[]
  jobRuns: PluginJobRun[]
  /** Địa chỉ nhận webhook (có mã bí mật), theo endpointKey. Rỗng khi máy chủ webhook chưa chạy. */
  webhookUrls: Record<string, string>
  deliveries: PluginWebhookDelivery[]
}

export type PluginInstallRequest = { type: 'npm'; name: string; version?: string } | { type: 'local'; path: string } | { type: 'catalog'; slug: string }

/** Plugin kèm app (resources/plugin-catalog/<slug>), mục "Có sẵn" ở Cài đặt → Plugin. */
export interface PluginCatalogEntry {
  slug: string
  name: string
  version: string
  manifest: PluginManifest
  installed: boolean
}

/** Tạo plugin mới từ mẫu (nút "Tạo plugin"): thư mục `<parentDir>/stag-plugin-<tên>` rồi cài tại chỗ. */
export interface PluginScaffoldRequest {
  parentDir: string
  name: string
  id: string
  /** basic: worker + tool + nút ở thanh bên; page: thêm tab trang riêng. */
  template: 'basic' | 'page'
}

/** Gợi ý mã plugin từ tên (bỏ dấu tiếng Việt): "Báo cáo tuần" → "my.bao-cao-tuan". */
export function pluginIdFrom(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd') // i18n-ignore: bỏ dấu chữ đ khi tạo mã từ tên tiếng Việt
    .replace(/Đ/g, 'D') // i18n-ignore: bỏ dấu chữ Đ khi tạo mã từ tên tiếng Việt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slug ? `my.${slug}` : ''
}

/** Thư mục của plugin mới: `stag-plugin-<phần sau dấu chấm cuối của mã>`. */
export function pluginFolderFor(id: string): string {
  return `stag-plugin-${id.split('.').pop()!.replace(/[^a-z0-9-]/g, '-')}`
}
