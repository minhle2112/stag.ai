import type { Connector, ConnectorsSettings, ConnectorValue, Settings, ToolPolicy } from './types'

/** Connector (máy chủ MCP) và bí mật: chuẩn hoá, kiểm tra, bật / tắt theo cấp, nhập từ JSON. Dùng chung main + renderer. */

type Loose = Record<string, unknown>
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
const s = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Tên máy chủ MCP trong phiên (Claude: `mcp__<id>__tool`; Codex: `mcp_servers.<id>`). */
export const CONNECTOR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
/** Tên bí mật = tên biến môi trường. */
export const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Tên header HTTP (token theo RFC 9110). */
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/
/** Tên tool MCP. */
const TOOL_RE = /^[A-Za-z0-9_.:/-]{1,128}$/
/** Máy chủ MCP của chính app. */
export const RESERVED_CONNECTOR_IDS = ['stag']
/** Bí mật app tự tạo cho đăng nhập OAuth (token + client); người dùng không đặt tên bắt đầu thế này. */
export const OAUTH_SECRET_PREFIX = 'OAUTH_'
export const oauthSecretName = (id: string): string => `${OAUTH_SECRET_PREFIX}${id.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`
const POLICIES: readonly ToolPolicy[] = ['allow', 'ask', 'block']

export const emptyConnector = (id = ''): Connector => ({
  id,
  label: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  url: '',
  urlSecret: '',
  bearerSecret: '',
  headers: {},
  oauth: false,
  enabled: true,
  approval: 'ask',
  toolPolicy: {},
  tools: [],
  testedAt: ''
})

function normalizeValue(raw: unknown): ConnectorValue | null {
  const r = obj(raw)
  if (typeof r.secret === 'string' && SECRET_NAME_RE.test(r.secret.trim())) {
    const prefix = typeof r.prefix === 'string' ? r.prefix.slice(0, 40) : ''
    return prefix ? { secret: r.secret.trim(), prefix } : { secret: r.secret.trim() }
  }
  if (typeof r.value === 'string') return { value: r.value.slice(0, 4000) }
  return null
}

function normalizeValues(raw: unknown, keyRe: RegExp): Record<string, ConnectorValue> {
  const out: Record<string, ConnectorValue> = {}
  for (const [k, v] of Object.entries(obj(raw))) {
    const val = normalizeValue(v)
    if (keyRe.test(k) && val) out[k] = val
  }
  return out
}

/** Đọc một connector từ file / giao diện. Thiếu id hợp lệ → null. */
export function normalizeConnector(raw: unknown): Connector | null {
  const r = obj(raw)
  const id = s(r.id, 40)
  if (!CONNECTOR_ID_RE.test(id)) return null
  const policy: Record<string, ToolPolicy> = {}
  for (const [k, v] of Object.entries(obj(r.toolPolicy))) if (TOOL_RE.test(k) && POLICIES.includes(v as ToolPolicy)) policy[k] = v as ToolPolicy
  const cat = obj(r.catalog)
  const catalog = typeof cat.slug === 'string' && /^[a-z0-9-]{1,40}$/.test(cat.slug) ? { slug: cat.slug, method: s(cat.method, 60) } : undefined
  const tools = Array.isArray(r.tools)
    ? r.tools
        .map((t) => ({ name: s(obj(t).name, 128), description: s(obj(t).description, 500) }))
        .filter((t) => TOOL_RE.test(t.name))
        .slice(0, 500)
    : []
  return {
    id,
    label: s(r.label, 80),
    transport: r.transport === 'http' ? 'http' : 'stdio',
    command: s(r.command, 1000),
    args: Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 2000)).slice(0, 100) : [],
    env: normalizeValues(r.env, ENV_KEY_RE),
    url: s(r.url, 2000),
    urlSecret: typeof r.urlSecret === 'string' && SECRET_NAME_RE.test(r.urlSecret.trim()) ? r.urlSecret.trim() : '',
    bearerSecret: typeof r.bearerSecret === 'string' && SECRET_NAME_RE.test(r.bearerSecret.trim()) ? r.bearerSecret.trim() : '',
    headers: normalizeValues(r.headers, HEADER_RE),
    oauth: r.oauth === true,
    ...(catalog ? { catalog } : {}),
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    approval: r.approval === 'allow' ? 'allow' : 'ask',
    toolPolicy: policy,
    tools,
    testedAt: s(r.testedAt, 40)
  }
}

export function normalizeConnectors(raw: unknown): ConnectorsSettings {
  const r = obj(raw)
  const items: Connector[] = []
  for (const c of Array.isArray(r.items) ? r.items : []) {
    const n = normalizeConnector(c)
    if (n && !items.some((x) => x.id === n.id) && !RESERVED_CONNECTOR_IDS.includes(n.id)) items.push(n)
  }
  return { items, inherited: normalizeToggles(r.inherited, true) }
}

/** Map bật / tắt: khoá là id connector hoặc `claude:<tên>` / `codex:<tên>`. */
export function normalizeToggles(raw: unknown, inheritedOnly = false): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(obj(raw))) {
    if (typeof v !== 'boolean' || k.length > 200) continue
    if (/^(claude|codex):./.test(k) || (!inheritedOnly && CONNECTOR_ID_RE.test(k))) out[k] = v
  }
  return out
}

/** Lỗi cấu hình (tiếng Việt) hoặc null. `others` = id các connector khác (không được trùng). */
export function validateConnector(c: Connector, others: string[]): string | null {
  if (!CONNECTOR_ID_RE.test(c.id)) return 'Tên máy chủ chỉ gồm a-z, 0-9, "_" và "-", tối đa 40 ký tự, bắt đầu bằng chữ / số.'
  if (RESERVED_CONNECTOR_IDS.includes(c.id)) return `"${c.id}" là máy chủ MCP của chính app, chọn tên khác.`
  if (others.includes(c.id)) return `Đã có connector tên "${c.id}".`
  if (c.transport === 'stdio') {
    if (!c.command) return 'Cần chương trình chạy máy chủ (vd. npx).'
  } else {
    let u: URL
    try {
      u = new URL(c.url)
    } catch {
      return 'Địa chỉ máy chủ không hợp lệ (cần dạng https://…).'
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Địa chỉ máy chủ phải bắt đầu bằng https:// hoặc http://.'
    if (u.username || u.password) return 'Không ghi tài khoản / mật khẩu vào địa chỉ; dùng bí mật làm Bearer token hoặc header.'
  }
  return null
}

/** Tên bí mật một connector dùng. */
export function connectorSecrets(c: Connector): string[] {
  const out = new Set<string>()
  if (c.transport === 'http') {
    if (c.urlSecret) out.add(c.urlSecret)
    if (c.bearerSecret) out.add(c.bearerSecret)
    for (const v of Object.values(c.headers)) if ('secret' in v) out.add(v.secret)
  } else for (const v of Object.values(c.env)) if ('secret' in v) out.add(v.secret)
  return [...out]
}

/** Một connector / máy chủ có sẵn có bật cho cấp này không: agent → workspace → app. */
export function connectorOn(s: Settings, key: string, workspaceId?: string | null, agentId?: string | null): boolean {
  const a = agentId ? s.agents[agentId]?.connectors?.[key] : undefined
  if (a !== undefined) return a
  const w = workspaceId ? s.workspaces[workspaceId]?.connectors?.[key] : undefined
  if (w !== undefined) return w
  if (key.includes(':')) return s.app.connectors.inherited[key] ?? true
  return s.app.connectors.items.find((c) => c.id === key)?.enabled ?? false
}

export interface EffectiveConnectors {
  /** Connector của stag.ai bật cho phiên này. */
  servers: Connector[]
  /** Máy chủ có sẵn bị tắt (tên, theo CLI). */
  denied: { claude: string[]; codex: string[] }
}

/** Connector thực tế của một phiên agent. */
export function effectiveConnectors(s: Settings, workspaceId?: string | null, agentId?: string | null): EffectiveConnectors {
  const keys = new Set([
    ...Object.keys(s.app.connectors.inherited),
    ...Object.keys((workspaceId && s.workspaces[workspaceId]?.connectors) || {}),
    ...Object.keys((agentId && s.agents[agentId]?.connectors) || {})
  ])
  const denied = { claude: [] as string[], codex: [] as string[] }
  for (const k of keys) {
    const m = /^(claude|codex):(.+)$/.exec(k)
    if (m && !connectorOn(s, k, workspaceId, agentId)) denied[m[1] as 'claude' | 'codex'].push(m[2])
  }
  return { servers: s.app.connectors.items.filter((c) => connectorOn(s, c.id, workspaceId, agentId)), denied }
}

/** Mức thực tế của một tool. */
export function toolPolicy(c: Connector, tool: string): ToolPolicy {
  return c.toolPolicy[tool] ?? c.approval
}

/** Tên id từ tên tuỳ ý: chữ thường, bỏ dấu, ký tự lạ → '-'. */
export function slugify(name: string): string {
  const id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 40)
  return id || 'server'
}

/** Tên biến / header trông như chứa thứ cần giấu → tách thành bí mật khi nhập. */
const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|AUTH|CREDENTIAL|COOKIE|SESSION)/i
export const looksSecret = (name: string): boolean => SECRETISH.test(name)

/** Tên bí mật cho một giá trị tách ra khi nhập: `<ID>_<TÊN>` viết hoa. */
export function secretNameFor(id: string, key: string): string {
  return `${id}_${key}`
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^([^A-Z_])/, '_$1')
    .slice(0, 64)
}

export interface ParsedImport {
  connectors: Connector[]
  /** Bí mật tách ra (tên + giá trị): main lưu rồi bỏ giá trị. */
  secrets: Array<{ name: string; value: string }>
  errors: string[]
}

/**
 * Đọc cấu hình máy chủ MCP kiểu Claude / Cursor / VS Code: `{ "mcpServers": { tên: {...} } }`, `{ "servers": {...} }`,
 * map `{ tên: {...} }`, hoặc một máy chủ `{ command | url, ... }`. Giá trị env / header có tên giống token → bí mật.
 * `taken` = id đã có (tên trùng được thêm hậu tố -2, -3…).
 */
export function parseMcpJson(text: string, taken: string[] = []): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { connectors: [], secrets: [], errors: [`JSON không đọc được: ${(e as Error).message}`] }
  }
  const r = obj(raw)
  let map: Loose
  if (r.mcpServers || r.servers) map = obj(r.mcpServers ?? r.servers)
  else if (typeof r.command === 'string' || typeof r.url === 'string') map = { [s(r.name) || 'server']: r }
  else map = r
  return importServers(map, taken)
}

/** Chuyển map `{ tên: cấu hình kiểu Claude }` thành connector (xem parseMcpJson). */
export function importServers(map: Record<string, unknown>, taken: string[] = []): ParsedImport {
  const out: ParsedImport = { connectors: [], secrets: [], errors: [] }
  const used = new Set([...taken, ...RESERVED_CONNECTOR_IDS])
  for (const [name, v] of Object.entries(map)) {
    const r = obj(v)
    const type = s(r.type).toLowerCase()
    const isHttp = typeof r.url === 'string' || type === 'http' || type === 'streamable_http' || type === 'sse'
    if (!isHttp && typeof r.command !== 'string') {
      out.errors.push(`"${name}": thiếu "command" hoặc "url"`)
      continue
    }
    if (type === 'sse') out.errors.push(`"${name}": kiểu SSE cũ — app thử nối bằng Streamable HTTP, có thể không chạy`)
    let id = slugify(name)
    for (let i = 2; used.has(id); i++) id = `${slugify(name).slice(0, 36)}-${i}`
    used.add(id)
    const c = emptyConnector(id)
    c.label = name
    const take = (key: string, value: string, force = false): ConnectorValue => {
      if (!value || (!force && !looksSecret(key)) || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value)) return { value }
      const secret = secretNameFor(id, key)
      out.secrets.push({ name: secret, value })
      return { secret }
    }
    if (isHttp) {
      c.transport = 'http'
      c.url = s(r.url, 2000)
      for (const [k, val] of Object.entries(obj(r.headers))) {
        if (typeof val !== 'string' || !HEADER_RE.test(k)) continue
        const bearer = /^bearer\s+(.+)$/i.exec(val.trim())
        if (k.toLowerCase() === 'authorization' && bearer) {
          const t = take('TOKEN', bearer[1], true)
          if ('secret' in t) c.bearerSecret = t.secret
          else c.headers[k] = { value: val }
        } else c.headers[k] = take(k, val)
      }
    } else {
      c.command = s(r.command, 1000)
      c.args = Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string') : []
      for (const [k, val] of Object.entries(obj(r.env))) if (typeof val === 'string' && ENV_KEY_RE.test(k)) c.env[k] = take(k, val)
    }
    const n = normalizeConnector(c)
    if (n) out.connectors.push(n)
  }
  if (!out.connectors.length && !out.errors.length) out.errors.push('Không thấy máy chủ MCP nào trong JSON')
  return out
}
