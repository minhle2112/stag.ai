import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { importServers, slugify, type EffectiveConnectors, type ParsedImport } from '@shared/connectors'
import type { CliAdapterId, Connector, ConnectorTestResult, InheritedScan, InheritedServer } from '@shared/types'
import { codexHome, tomlString } from './codex'
import { resolveCommand } from './externalAdapters'
import { readText } from './fsutil'

/**
 * Connector (máy chủ MCP) cho phiên agent: dịch sang cấu hình từng CLI, đưa bí mật qua biến môi trường,
 * quét máy chủ có sẵn của Claude Code / Codex, thử kết nối.
 *
 * Bí mật không bao giờ nằm trong file cấu hình hay dòng lệnh:
 * - stdio: biến `KEY` của máy chủ được đặt thẳng vào môi trường phiên; Claude nhận `"KEY": "${KEY}"`,
 *   Codex nhận `env_vars = ["KEY"]` (chuyển tiếp từ môi trường).
 * - http: bí mật vào biến `STAG_SECRET_<TÊN>`; Claude nhận header `${STAG_SECRET_<TÊN>}`, Codex nhận
 *   `bearer_token_env_var` / `env_http_headers`.
 */

export const secretEnvName = (name: string): string => `STAG_SECRET_${name.toUpperCase()}`
/** Biến chứa cả giá trị header (tiền tố + bí mật, vd. `Token token=…`): Codex `env_http_headers` lấy nguyên giá trị từ biến. */
export const urlEnvName = (id: string): string => `STAG_URL_${id.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`
export const headerEnvName = (id: string, header: string): string => `STAG_HDR_${`${id}_${header}`.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`

/** Chương trình .cmd/.bat (npx, npm, pnpm…): Claude Code và Codex không tự chạy được trên Windows → `cmd /c`. */
export async function windowsCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<{ command: string; args: string[] }> {
  if (platform !== 'win32') return { command, args }
  const batch = /\.(cmd|bat)$/i.test(command) || /\.(cmd|bat)$/i.test((await resolveCommand(command, cwd, env)) ?? '')
  return batch ? { command: 'cmd', args: ['/c', command, ...args] } : { command, args }
}

/** Biến môi trường mang bí mật cho phiên. Thiếu bí mật / hai connector dùng cùng biến khác giá trị → lỗi. */
export function connectorEnv(servers: Connector[], getSecret: (name: string) => string | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  const owner: Record<string, string> = {}
  const need = (c: Connector, name: string): string => {
    const v = getSecret(name)
    if (v === undefined) throw new Error(`Connector "${c.id}" cần bí mật ${name} nhưng chưa lưu (hoặc không giải mã được). Thêm ở Cài đặt → Secrets, hoặc tắt connector này.`)
    return v
  }
  const put = (c: Connector, key: string, value: string): void => {
    if (key in env && env[key] !== value)
      throw new Error(`Connector "${owner[key]}" và "${c.id}" cùng đặt biến ${key} với giá trị khác nhau. Đổi tên biến hoặc tắt một trong hai.`)
    env[key] = value
    owner[key] = c.id
  }
  for (const c of servers) {
    if (c.transport === 'stdio') {
      for (const [k, v] of Object.entries(c.env)) if ('secret' in v) put(c, k, need(c, v.secret))
    } else {
      if (c.urlSecret) put(c, urlEnvName(c.id), need(c, c.urlSecret))
      if (c.bearerSecret) put(c, secretEnvName(c.bearerSecret), need(c, c.bearerSecret))
      for (const [h, v] of Object.entries(c.headers)) if ('secret' in v) put(c, headerEnvName(c.id, h), (v.prefix ?? '') + need(c, v.secret))
    }
  }
  return env
}

/** Lệnh đã bọc `cmd /c` của từng connector stdio (tính trước vì tìm trong PATH là việc async). */
export type Commands = Record<string, { command: string; args: string[] }>

export async function resolveCommands(servers: Connector[], cwd: string): Promise<Commands> {
  const out: Commands = {}
  for (const c of servers) if (c.transport === 'stdio') out[c.id] = await windowsCommand(c.command, c.args, cwd)
  return out
}

/** `mcpServers` kiểu Claude (file `--mcp-config`, cũng dùng cho adapter ngoài). */
export function claudeServers(servers: Connector[], cmds: Commands): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of servers) {
    if (c.transport === 'stdio') {
      const cmd = cmds[c.id] ?? { command: c.command, args: c.args }
      const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, 'secret' in v ? `\${${k}}` : v.value]))
      out[c.id] = { type: 'stdio', command: cmd.command, args: cmd.args, ...(Object.keys(env).length ? { env } : {}) }
    } else {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(c.headers)) headers[k] = 'secret' in v ? `\${${headerEnvName(c.id, k)}}` : v.value
      if (c.bearerSecret) headers.Authorization = `Bearer \${${secretEnvName(c.bearerSecret)}}`
      out[c.id] = { type: 'http', url: c.urlSecret ? `\${${urlEnvName(c.id)}}` : c.url, ...(Object.keys(headers).length ? { headers } : {}) }
    }
  }
  return out
}

/** Phần thêm vào file `--settings` của phiên Claude: quyền tool + tắt máy chủ có sẵn. */
export function claudeSettingsExtra(eff: EffectiveConnectors): { allow: string[]; ask: string[]; deny: string[]; deniedMcpServers: Array<{ serverName: string }> } {
  const allow: string[] = []
  const ask: string[] = []
  const deny: string[] = []
  for (const c of eff.servers) {
    if (c.approval === 'allow') allow.push(`mcp__${c.id}`)
    for (const [tool, p] of Object.entries(c.toolPolicy)) {
      const rule = `mcp__${c.id}__${tool}`
      if (p === 'block') deny.push(rule)
      else if (p === 'allow' && c.approval !== 'allow') allow.push(rule)
      else if (p === 'ask' && c.approval === 'allow') ask.push(rule)
    }
  }
  return { allow, ask, deny, deniedMcpServers: eff.denied.claude.map((serverName) => ({ serverName })) }
}

/** Khoá TOML trong đường dẫn `-c a.b.c`: chỉ nhận tên đơn giản (tên lạ thì bỏ qua thay vì làm hỏng cả tham số). */
const TOML_KEY = /^[A-Za-z0-9_-]+$/
const tomlArray = (a: string[]): string => `[${a.map(tomlString).join(',')}]`
const tomlTable = (m: Record<string, string>): string =>
  `{${Object.entries(m)
    .map(([k, v]) => `${tomlString(k)}=${tomlString(v)}`)
    .join(',')}}`

/** Tên máy chủ MCP khai báo trong config.toml của Codex (bảng `[mcp_servers.<tên>]` / `[mcp_servers.<tên>.env]`…). */
export function codexServerNames(toml: string): string[] {
  const out = new Set<string>()
  for (const m of toml.matchAll(/^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))/gm)) out.add(m[1] ?? m[2] ?? m[3])
  return [...out]
}

/** Máy chủ Codex sẽ nạp cho thư mục này: ~/.codex/config.toml + .codex/config.toml của dự án. */
export async function codexConfiguredServers(cwd: string): Promise<Set<string>> {
  const names = new Set<string>()
  for (const f of [join(codexHome(), 'config.toml'), join(cwd, '.codex', 'config.toml')]) for (const n of codexServerNames((await readText(f)) ?? '')) names.add(n)
  return names
}

/**
 * Tham số `-c mcp_servers.*` cho Codex: connector bật + tắt máy chủ có sẵn. `existing` = máy chủ đang có trong
 * config.toml: chỉ tắt những máy chủ đó (đặt `enabled=false` cho tên không có thì Codex coi là máy chủ mới
 * thiếu transport và không chạy được: "invalid transport").
 */
export function codexConnectorArgs(eff: EffectiveConnectors, cmds: Commands, existing: Set<string> = new Set(), env: Record<string, string> = {}): string[] {
  const out: string[] = []
  const set = (id: string, key: string, value: string): void => {
    out.push('-c', `mcp_servers.${id}.${key}=${value}`)
  }
  for (const c of eff.servers) {
    if (c.transport === 'stdio') {
      const cmd = cmds[c.id] ?? { command: c.command, args: c.args }
      set(c.id, 'command', tomlString(cmd.command))
      set(c.id, 'args', tomlArray(cmd.args))
      const literal: Record<string, string> = {}
      const forward: string[] = []
      for (const [k, v] of Object.entries(c.env)) if ('secret' in v) forward.push(k)
      else literal[k] = v.value
      if (Object.keys(literal).length) set(c.id, 'env', tomlTable(literal))
      if (forward.length) set(c.id, 'env_vars', tomlArray(forward))
    } else {
      // Codex không thay biến trong url: URL có token (urlSecret) phải nằm trên dòng lệnh (không ghi ra file nào).
      set(c.id, 'url', tomlString(c.urlSecret ? (env[urlEnvName(c.id)] ?? '') : c.url))
      if (c.bearerSecret) set(c.id, 'bearer_token_env_var', tomlString(secretEnvName(c.bearerSecret)))
      const literal: Record<string, string> = {}
      const fromEnv: Record<string, string> = {}
      for (const [k, v] of Object.entries(c.headers)) if ('secret' in v) fromEnv[k] = headerEnvName(c.id, k)
      else literal[k] = v.value
      if (Object.keys(literal).length) set(c.id, 'http_headers', tomlTable(literal))
      if (Object.keys(fromEnv).length) set(c.id, 'env_http_headers', tomlTable(fromEnv))
    }
    if (c.approval === 'allow') set(c.id, 'default_tools_approval_mode', '"approve"')
    const blocked = Object.entries(c.toolPolicy)
      .filter(([, p]) => p === 'block')
      .map(([t]) => t)
    if (blocked.length) set(c.id, 'disabled_tools', tomlArray(blocked))
    for (const [tool, p] of Object.entries(c.toolPolicy)) {
      if (!TOML_KEY.test(tool) || p === 'block' || p === c.approval) continue
      set(c.id, `tools.${tool}.approval_mode`, p === 'allow' ? '"approve"' : '"prompt"')
    }
  }
  for (const name of eff.denied.codex) if (TOML_KEY.test(name) && existing.has(name)) set(name, 'enabled', 'false')
  return out
}

// ---- máy chủ có sẵn của Claude Code / Codex ----

interface RunResult {
  ok: boolean
  out: string
  err: string
}

function run(exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(exe, args, { cwd, env, timeout, windowsHide: true, maxBuffer: 4 << 20 }, (error, stdout, stderr) =>
      resolve({ ok: !error, out: String(stdout), err: String(stderr) || (error ? error.message : '') })
    )
  })
}

type Loose = Record<string, unknown>
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {})
/** So khớp đường dẫn dự án trong ~/.claude.json (dấu '/', không phân biệt hoa thường trên Windows). */
const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Cấu hình máy chủ của Claude Code theo phạm vi: user (~/.claude.json), local (dự án trong ~/.claude.json), project (.mcp.json). */
export async function claudeConfigs(cwd: string, home = homedir()): Promise<Record<'user' | 'local' | 'project', Loose>> {
  let j: Loose = {}
  try {
    j = obj(JSON.parse((await readText(join(home, '.claude.json'))) ?? '{}'))
  } catch {
    /* file hỏng: coi như trống */
  }
  const proj = Object.entries(obj(j.projects)).find(([p]) => samePath(p, cwd))?.[1]
  let mcpJson: Loose = {}
  try {
    mcpJson = obj(JSON.parse((await readText(join(cwd, '.mcp.json'))) ?? '{}'))
  } catch {
    /* bỏ qua */
  }
  return { user: obj(j.mcpServers), local: obj(obj(proj).mcpServers), project: obj(mcpJson.mcpServers) }
}

/** Đọc đầu ra `claude mcp list`: mỗi dòng `tên: lệnh/URL - ✔ Connected`. */
export function parseClaudeMcpList(out: string, configs: Record<'user' | 'local' | 'project', Loose>): InheritedServer[] {
  const servers: InheritedServer[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    const colon = line.indexOf(': ')
    const dash = line.lastIndexOf(' - ')
    if (colon <= 0 || dash <= colon) continue
    const name = line.slice(0, colon)
    const source: InheritedServer['source'] = name.startsWith('claude.ai ')
      ? 'claude.ai'
      : name.startsWith('plugin:')
        ? 'plugin'
        : name in configs.local
          ? 'local'
          : name in configs.project
            ? 'project'
            : 'user'
    servers.push({
      key: `claude:${name}`,
      runtime: 'claude',
      name,
      source,
      target: line.slice(colon + 2, dash),
      status: line.slice(dash + 3).replace(/^[^\p{L}\p{N}]+/u, ''),
      copyable: source === 'user' || source === 'local' || source === 'project'
    })
  }
  return servers
}

interface CodexListItem {
  name: string
  enabled: boolean
  transport: Loose
}

export function parseCodexMcpList(out: string): InheritedServer[] {
  let list: CodexListItem[] = []
  try {
    const j = JSON.parse(out)
    list = Array.isArray(j) ? j : []
  } catch {
    return []
  }
  return list
    .filter((s) => typeof s?.name === 'string')
    .map((s) => {
      const t = obj(s.transport)
      const target = typeof t.url === 'string' ? t.url : [t.command, ...(Array.isArray(t.args) ? t.args : [])].filter((x) => typeof x === 'string').join(' ')
      return {
        key: `codex:${s.name}`,
        runtime: 'codex' as const,
        name: s.name,
        source: 'codex' as const,
        target,
        status: s.enabled === false ? 'Đã tắt trong config.toml' : 'Bật trong config.toml',
        copyable: true
      }
    })
}

/** Quét máy chủ MCP có sẵn. Claude: `claude mcp list` (có kiểm tra sức khoẻ, mất vài giây); Codex: `codex mcp list --json`. */
export async function scanInherited(runtime: CliAdapterId, exe: string, cwd: string, env: NodeJS.ProcessEnv): Promise<InheritedScan> {
  const scan: InheritedScan = { runtime, cwd, servers: [], error: null, scannedAt: new Date().toISOString() }
  const r = await run(exe, runtime === 'claude' ? ['mcp', 'list'] : ['mcp', 'list', '--json'], cwd, env, runtime === 'claude' ? 120_000 : 30_000)
  if (!r.ok && !r.out.trim()) {
    scan.error = `Chạy "${runtime} mcp list" lỗi: ${r.err.trim().split(/\r?\n/)[0] || 'không rõ'}`
    return scan
  }
  scan.servers = runtime === 'claude' ? parseClaudeMcpList(r.out, await claudeConfigs(cwd)) : parseCodexMcpList(r.out)
  return scan
}

/** Cấu hình kiểu Claude của một máy chủ có sẵn để chép thành connector (giá trị giống token → bí mật). */
export async function inheritedConfig(runtime: CliAdapterId, name: string, exe: string, cwd: string, env: NodeJS.ProcessEnv): Promise<Loose | null> {
  if (runtime === 'claude') {
    const c = await claudeConfigs(cwd)
    const found = c.local[name] ?? c.project[name] ?? c.user[name]
    return found ? obj(found) : null
  }
  const r = await run(exe, ['mcp', 'list', '--json'], cwd, env, 30_000)
  let list: CodexListItem[] = []
  try {
    list = JSON.parse(r.out)
  } catch {
    return null
  }
  const t = obj(list.find((s) => s?.name === name)?.transport)
  if (typeof t.url === 'string') {
    const headers: Record<string, string> = { ...(obj(t.http_headers) as Record<string, string>) }
    for (const [k, v] of Object.entries(obj(t.env_http_headers))) if (typeof v === 'string' && process.env[v]) headers[k] = process.env[v]!
    const bearer = typeof t.bearer_token_env_var === 'string' ? process.env[t.bearer_token_env_var] : undefined
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    return { type: 'http', url: t.url, headers }
  }
  if (typeof t.command !== 'string') return null
  const e: Record<string, string> = { ...(obj(t.env) as Record<string, string>) }
  for (const v of Array.isArray(t.env_vars) ? t.env_vars : []) if (typeof v === 'string' && process.env[v]) e[v] = process.env[v]!
  return { command: t.command, args: Array.isArray(t.args) ? t.args : [], env: e }
}

/**
 * Chép một máy chủ có sẵn thành connector. Tên gốc tính là đã dùng (bản chép thành `<tên>-2`): trùng tên thì
 * CLI gộp hai cấu hình làm một, và tắt bản có sẵn sẽ tắt luôn bản chép.
 */
export function importInherited(name: string, config: Loose, taken: string[]): ParsedImport {
  const base = name.replace(/^plugin:/, '')
  return importServers({ [base]: config }, [...taken, slugify(base)])
}

// ---- thử kết nối ----

const TEST_TIMEOUT = 60_000

/** Nối thử tới máy chủ, lấy danh sách tool rồi đóng. Không gọi tool nào. */
export async function testConnector(
  c: Connector,
  getSecret: (name: string) => string | undefined,
  cwd: string,
  baseEnv: NodeJS.ProcessEnv
): Promise<ConnectorTestResult> {
  const started = Date.now()
  const result = (r: Partial<ConnectorTestResult>): ConnectorTestResult => ({ ok: false, server: '', tools: [], error: null, ms: Date.now() - started, ...r })
  let env: Record<string, string>
  try {
    env = connectorEnv([c], getSecret)
  } catch (e) {
    return result({ error: (e as Error).message })
  }
  const client = new Client({ name: 'stag.ai', version: '0.1.0' })
  let stderr = ''
  let transport: StdioClientTransport | StreamableHTTPClientTransport
  if (c.transport === 'stdio') {
    const literal = Object.fromEntries(Object.entries(c.env).flatMap(([k, v]) => ('secret' in v ? [] : [[k, v.value]])))
    const t = new StdioClientTransport({
      command: c.command,
      args: c.args,
      cwd,
      env: { ...(Object.fromEntries(Object.entries(baseEnv).filter(([, v]) => v !== undefined)) as Record<string, string>), ...literal, ...env },
      stderr: 'pipe'
    })
    t.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < 4000) stderr += d.toString()
    })
    transport = t
  } else {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.headers)) headers[k] = 'secret' in v ? env[headerEnvName(c.id, k)] : v.value
    if (c.bearerSecret) headers.Authorization = `Bearer ${env[secretEnvName(c.bearerSecret)]}`
    transport = new StreamableHTTPClientTransport(new URL(c.urlSecret ? env[urlEnvName(c.id)] : c.url), { requestInit: { headers } })
  }
  let timer: NodeJS.Timeout | undefined
  try {
    const work = (async () => {
      await client.connect(transport)
      const tools: ConnectorTestResult['tools'] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined)
        for (const t of page.tools) tools.push({ name: t.name, description: (t.description ?? '').trim().split(/\r?\n/)[0].slice(0, 300) })
        cursor = page.nextCursor
      } while (cursor && tools.length < 500)
      const v = client.getServerVersion()
      return result({ ok: true, server: v ? `${v.name} ${v.version}` : '', tools })
    })()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Quá ${TEST_TIMEOUT / 1000} giây không xong (lần đầu chạy npx có thể phải tải gói — thử lại)`)), TEST_TIMEOUT)
    })
    return await Promise.race([work, timeout])
  } catch (e) {
    return result({ error: explain(e as Error, stderr) })
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => {})
  }
}

function explain(e: Error, stderr: string): string {
  const msg = e.message || String(e)
  const tail = stderr.trim().split(/\r?\n/).slice(-3).join(' · ')
  if (/\b401\b|unauthorized/i.test(msg)) return `Máy chủ từ chối (401): token sai, hoặc máy chủ cần đăng nhập OAuth (app chưa hỗ trợ). ${msg}`
  if (/ENOENT/.test(msg)) return `Không tìm thấy chương trình: ${msg}`
  if (/Connection closed/i.test(msg) && tail) return `Máy chủ thoát ngay: ${tail}`
  return tail ? `${msg} — ${tail}` : msg
}
