import { promises as fs } from 'node:fs'

/**
 * Đọc phiên của agent khác cho tool agent_log (Agent API): transcript JSONL của Claude Code hoặc rollout của Codex,
 * rút thành các lượt gọn (lời người dùng, lời agent, tên tool + file, lỗi). Không bao giờ đưa ra đầu ra thô của terminal.
 * Bí mật bị che trước khi trả về; kết quả ghi rõ là dữ liệu (có thể chứa chữ từ trang web / file → không phải lệnh).
 */

export interface LogEntry {
  at: string
  who: 'user' | 'agent' | 'tool' | 'error'
  text: string
}

export interface LogOptions {
  /** Có lấy dòng gọi tool (tên tool + file / lệnh) không. Lỗi tool luôn lấy. */
  tools: boolean
}

/** Mỗi lượt cắt tới chừng này ký tự. */
const ENTRY_MAX = 700
const TOOL_MAX = 160

const clip = (s: string, max: number): string => {
  const t = s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Tool + đối số chính, vd. `Edit src/a.ts`, `Bash npm test`. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const arg =
    str(i.file_path) ||
    str(i.notebook_path) ||
    str(i.path) ||
    str(i.command) ||
    str(i.cmd) ||
    str(i.pattern) ||
    str(i.url) ||
    str(i.query) ||
    str(i.description) ||
    (typeof input === 'string' ? input : '')
  return clip(`${name}${arg ? ` ${arg.replace(/\s+/g, ' ')}` : ''}`, TOOL_MAX)
}

/** Lời "người dùng" do CLI tự chèn (lệnh slash, nhắc hệ thống…), không phải người dùng gõ. */
const SYNTHETIC_USER = /^\s*<(command-|local-command|system-reminder|user-prompt-submit-hook|bash-|task-notification)/

interface ClaudeLine {
  type?: unknown
  isSidechain?: unknown
  isMeta?: unknown
  isCompactSummary?: unknown
  timestamp?: unknown
  message?: { role?: unknown; content?: unknown }
}

/** Một dòng transcript Claude Code → các lượt (phiên chính; bỏ subagent, tóm tắt compact, dòng meta). */
export function parseClaudeLog(line: string, o: LogOptions): LogEntry[] {
  let e: ClaudeLine
  try {
    e = JSON.parse(line) as ClaudeLine
  } catch {
    return []
  }
  if (!e || typeof e !== 'object' || e.isSidechain === true || e.isMeta === true || e.isCompactSummary === true) return []
  if (e.type !== 'user' && e.type !== 'assistant') return []
  const at = str(e.timestamp)
  const content = e.message?.content
  const blocks: Array<Record<string, unknown>> =
    typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Array<Record<string, unknown>>) : []
  const out: LogEntry[] = []
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      if (e.type === 'user' && SYNTHETIC_USER.test(b.text)) continue
      out.push({ at, who: e.type === 'user' ? 'user' : 'agent', text: clip(b.text, ENTRY_MAX) })
    } else if (b.type === 'tool_use' && o.tools) {
      out.push({ at, who: 'tool', text: toolSummary(str(b.name), b.input) })
    } else if (b.type === 'tool_result' && b.is_error === true) {
      const c = b.content
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => str((x as { text?: unknown })?.text)).join('\n') : ''
      if (text.trim()) out.push({ at, who: 'error', text: clip(text, 300) })
    }
  }
  return out
}

interface CodexLine {
  timestamp?: unknown
  type?: unknown
  payload?: Record<string, unknown>
}

/** Tin "người dùng" Codex tự chèn (AGENTS.md, môi trường, luật…). */
const CODEX_INJECTED = /^\s*(<[a-z_]+[\s>]|# AGENTS\.md instructions)/i

/** Một dòng rollout Codex → các lượt. */
export function parseCodexLog(line: string, o: LogOptions): LogEntry[] {
  let e: CodexLine
  try {
    e = JSON.parse(line) as CodexLine
  } catch {
    return []
  }
  if (e?.type !== 'response_item' || !e.payload) return []
  const p = e.payload
  const at = str(e.timestamp)
  if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
    const texts = (Array.isArray(p.content) ? p.content : [])
      .map((c) => str((c as { text?: unknown })?.text))
      .filter((t) => t.trim() && !(p.role === 'user' && CODEX_INJECTED.test(t)))
    return texts.map((t) => ({ at, who: p.role === 'user' ? 'user' : 'agent', text: clip(t, ENTRY_MAX) }))
  }
  if ((p.type === 'function_call' || p.type === 'custom_tool_call' || p.type === 'local_shell_call') && o.tools) {
    let input: unknown = p.input ?? p.action
    if (typeof p.arguments === 'string') {
      try {
        input = JSON.parse(p.arguments)
      } catch {
        input = p.arguments
      }
    }
    return [{ at, who: 'tool', text: toolSummary(str(p.name) || 'shell', input) }]
  }
  return []
}

/** Đọc tối đa `maxBytes` cuối file, trả về các dòng (dòng đầu bị cắt dở thì bỏ). */
export async function readTailLines(file: string, maxBytes = 8 * 1024 * 1024): Promise<string[]> {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    const from = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(size - from)
    const { bytesRead } = await handle.read(buf, 0, buf.length, from)
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
    if (from > 0) lines.shift()
    return lines.filter((l) => l.trim())
  } finally {
    await handle.close()
  }
}

/** Chuỗi bí mật thường gặp: cả chuỗi khớp bị thay. */
const SECRET_TOKENS: RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
]

/** Bí mật đứng sau một tiền tố (`Bearer …`, `API_KEY=…`): giữ tiền tố (nhóm 1), thay phần giá trị. */
const SECRET_VALUES: RegExp[] = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /(\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd|pwd)[A-Za-z0-9_]*\s*[:=]\s*["']?)[^\s"',;]{6,}/gi
]

/**
 * Giá trị bí mật để che: nguyên giá trị, và với bí mật đăng nhập OAuth (JSON) thêm từng token bên trong — phiên agent
 * nhận access token trần, không phải cả khối JSON.
 */
export function secretParts(values: string[]): string[] {
  const out = new Set<string>()
  for (const v of values) {
    out.add(v)
    if (!v.startsWith('{')) continue
    try {
      const j = JSON.parse(v) as { tokens?: Record<string, unknown>; client?: Record<string, unknown> }
      for (const t of [j?.tokens?.access_token, j?.tokens?.refresh_token, j?.client?.client_secret]) if (typeof t === 'string' && t) out.add(t)
    } catch {
      // không phải JSON
    }
  }
  return [...out]
}

/** Che bí mật: giá trị thật trong kho bí mật của app (`known`) + mẫu thường gặp. */
export function redact(text: string, known: string[] = []): string {
  let t = text
  for (const v of known) if (v && v.length >= 6) t = t.split(v).join('[redacted]')
  for (const re of SECRET_TOKENS) t = t.replace(re, '[redacted]')
  for (const re of SECRET_VALUES) t = t.replace(re, (_m, prefix: string) => `${prefix}[redacted]`)
  return t
}

/**
 * Bí mật chắc chắn có trong `text` (giá trị trong kho bí mật của app, chuỗi khoá / token có dạng rõ ràng, `Bearer …`)
 * — để chặn agent ghi vào vault. Không dùng mẫu `key=value` của redact vì dễ khớp nhầm chữ thường ("token: expires").
 */
export function findSecrets(text: string, known: string[] = []): string[] {
  const out: string[] = []
  for (const v of known) if (v && v.length >= 6 && text.includes(v)) out.push('a value from the stag.ai secret store')
  for (const re of [...SECRET_TOKENS, SECRET_VALUES[0]]) {
    re.lastIndex = 0
    const m = re.exec(text)
    re.lastIndex = 0
    if (m) out.push(`"${m[0].slice(0, 8)}…"`)
  }
  return out
}

const WHO: Record<LogEntry['who'], string> = { user: 'USER', agent: 'AGENT', tool: 'TOOL', error: 'ERROR' }

/** Bỏ dấu tiếng Việt và hoa / thường để tìm. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase() // i18n-ignore: folds Vietnamese letters for search

/**
 * Lượt mới nhất (sau khi lọc `query`): tối đa `last` lượt, tổng không quá `maxChars` ký tự, cũ trước mới sau.
 * Trả về các dòng đã định dạng và số lượt bị bỏ vì giới hạn.
 */
export function formatEntries(entries: LogEntry[], o: { last: number; query?: string; maxChars: number }): { lines: string[]; skipped: number } {
  const q = o.query?.trim() ? fold(o.query.trim()) : ''
  const hits = q ? entries.filter((e) => fold(e.text).includes(q)) : entries
  const pick = hits.slice(-o.last)
  const lines: string[] = []
  let total = 0
  for (let i = pick.length - 1; i >= 0; i--) {
    const e = pick[i]
    const time = e.at ? `${e.at.slice(11, 16)} ` : ''
    const line = `[${time}${WHO[e.who]}] ${e.text}`
    if (total + line.length > o.maxChars && lines.length) break
    lines.unshift(line)
    total += line.length + 1
  }
  return { lines, skipped: hits.length - lines.length }
}
