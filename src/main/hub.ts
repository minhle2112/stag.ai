import { promises as fs, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { HookPayload } from './board'
import { SessionTokens } from './sessionTokens'

export interface HubHandlers {
  /** Trả về JSON trả lời hook (vd. quyết định PreToolUse), undefined = chỉ ghi nhận. */
  hook(agentId: string, payload: HookPayload): unknown
  /** Máy chủ MCP gắn với một agent (tool task_* biết ai đang gọi). null = agent không tồn tại. */
  mcp(agentId: string): McpServer | null
  /** JSON statusLine của phiên agent (độ dài context, xem context.ts). */
  status(agentId: string, body: unknown): void
}

/** Sự kiện hook để cập nhật kanban. SessionStart/SessionEnd không cần: app tự biết lúc mở/đóng phiên. */
const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop']

const MAX_BODY = 4 * 1024 * 1024

/**
 * Máy chủ HTTP nội bộ (chỉ 127.0.0.1) cho các phiên Claude Code của agent:
 * - POST /hook: hook HTTP của Claude Code báo agent đang làm / đang chờ.
 * - POST /mcp:  máy chủ MCP "stag" (Streamable HTTP, không giữ phiên) với các tool task_*.
 * Mỗi phiên agent có token riêng (cấp lúc mở, thu hồi lúc đóng, xem sessionTokens.ts) qua biến môi trường STAG_TOKEN:
 * tiến trình khác trên máy không giả được trạng thái, và agent này không gọi tool dưới tên agent khác.
 */
export class StatusHub {
  private readonly tokens = new SessionTokens()
  private server: Server | null = null
  private port = 0
  private settingsFile = ''
  private mcpFile = ''
  private statusScript = ''
  /** Nội dung file `--settings` chung (hook, statusLine, quyền tool stag): phiên có connector ghép thêm vào bản riêng. */
  private settingsObj: Record<string, unknown> = {}

  constructor(private handlers: HubHandlers) {}

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        console.error('[hub]', e)
        if (!res.headersSent) send(res, 500, { error: 'internal' })
        else res.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    this.server = server
    this.port = (server.address() as AddressInfo).port
    await this.writeConfigs()
  }

  /** Tham số thêm cho `claude`: hook + máy chủ MCP của app (hoặc file riêng của phiên, xem writeSessionConfigs). */
  claudeArgs(own: { settingsFile?: string; mcpFile?: string } = {}): string[] {
    if (!this.server) throw new Error('StatusHub chưa chạy')
    return ['--settings', own.settingsFile ?? this.settingsFile, '--mcp-config', own.mcpFile ?? this.mcpFile]
  }

  /** Mục `stag` trong `mcpServers` kiểu Claude (token / id agent lấy từ biến môi trường). */
  stagServer(): Record<string, unknown> {
    if (!this.server) throw new Error('StatusHub chưa chạy')
    return {
      type: 'http',
      url: `http://127.0.0.1:${this.port}/mcp`,
      headers: { Authorization: 'Bearer ${STAG_TOKEN}', 'X-Stag-Agent': '${STAG_AGENT_ID}' }
    }
  }

  /**
   * File cấu hình riêng của một phiên có connector / skill: `mcpServers` = stag + connector; settings = bản chung
   * + quyền tool connector + máy chủ có sẵn bị tắt + skill / plugin có sẵn bị tắt (`--settings` chỉ nhận một file, nên phải ghép).
   */
  async writeSessionConfigs(
    base: string,
    servers: Record<string, unknown>,
    extra: {
      allow: string[]
      ask: string[]
      deny: string[]
      deniedMcpServers: Array<{ serverName: string }>
      skillOverrides?: Record<string, 'off'>
      enabledPlugins?: Record<string, false>
    }
  ): Promise<{ settingsFile?: string; mcpFile?: string; files: string[] }> {
    const out: { settingsFile?: string; mcpFile?: string; files: string[] } = { files: [] }
    if (Object.keys(servers).length) {
      out.mcpFile = `${base}.mcp.json`
      await fs.writeFile(out.mcpFile, JSON.stringify({ mcpServers: { stag: this.stagServer(), ...servers } }, null, 2), 'utf8')
      out.files.push(out.mcpFile)
    }
    if (extra.allow.length || extra.ask.length || extra.deny.length || extra.deniedMcpServers.length || extra.skillOverrides || extra.enabledPlugins) {
      const perms = (this.settingsObj.permissions ?? {}) as { allow?: string[] }
      const settings = {
        ...this.settingsObj,
        permissions: {
          ...perms,
          allow: [...(perms.allow ?? []), ...extra.allow],
          ...(extra.ask.length ? { ask: extra.ask } : {}),
          ...(extra.deny.length ? { deny: extra.deny } : {})
        },
        ...(extra.deniedMcpServers.length ? { deniedMcpServers: extra.deniedMcpServers } : {}),
        ...(extra.skillOverrides ? { skillOverrides: extra.skillOverrides } : {}),
        ...(extra.enabledPlugins ? { enabledPlugins: extra.enabledPlugins } : {})
      }
      out.settingsFile = `${base}.settings.json`
      await fs.writeFile(out.settingsFile, JSON.stringify(settings, null, 2), 'utf8')
      out.files.push(out.settingsFile)
    }
    return out
  }

  /** File cấu hình MCP kiểu Claude (`{ mcpServers: { stag } }`, token qua biến môi trường) cho adapter ngoài. */
  mcpConfigFile(): string {
    if (!this.server) throw new Error('StatusHub chưa chạy')
    return this.mcpFile
  }

  /** Địa chỉ hook / MCP cho CLI không dùng file cấu hình của app (Codex nhận qua `-c`). */
  endpoints(): { hookUrl: string; mcpUrl: string } {
    if (!this.server) throw new Error('StatusHub chưa chạy')
    const base = `http://127.0.0.1:${this.port}`
    return { hookUrl: `${base}/hook`, mcpUrl: `${base}/mcp` }
  }

  /** Cấp token cho một phiên agent sắp mở; trả về biến môi trường thêm cho tiến trình đó. Đóng phiên → revoke. */
  issueToken(agentId: string, sessionId: string): { token: string; env: Record<string, string> } {
    const token = this.tokens.issue(agentId, sessionId)
    return { token, env: { STAG_TOKEN: token } }
  }

  revokeToken(token: string | undefined): void {
    this.tokens.revoke(token)
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.tokens.clear()
    for (const f of [this.settingsFile, this.mcpFile, this.statusScript]) if (f) rmSync(f, { force: true })
  }

  /**
   * File cấu hình theo cổng của lần chạy này (hai bản app chạy cùng lúc không đè nhau).
   * Không chứa token: token và id agent lấy từ biến môi trường của từng tiến trình.
   */
  private async writeConfigs(): Promise<void> {
    const dir = join(app.getPath('userData'), 'claude')
    await fs.mkdir(dir, { recursive: true })
    await removeStaleConfigs(dir)
    const base = `http://127.0.0.1:${this.port}`

    const hook = {
      type: 'http',
      url: `${base}/hook`,
      headers: { Authorization: 'Bearer $STAG_TOKEN', 'X-Stag-Agent': '$STAG_AGENT_ID' },
      allowedEnvVars: ['STAG_TOKEN', 'STAG_AGENT_ID'],
      timeout: 5
    }
    // PreToolUse có thể phải chờ người dùng duyệt tool connector trong app (approvals.ts, tối đa 540 s).
    const hookFor = (e: string): typeof hook => (e === 'PreToolUse' ? { ...hook, timeout: 600 } : hook)
    const common = {
      permissions: { allow: ['mcp__stag'] },
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hookFor(e)] }]]))
    }
    // statusLine chỉ chạy lệnh (không có kiểu http như hook): một script PowerShell chuyển stdin về /status.
    // Claude Code chạy lệnh qua Git Bash (nếu có) hoặc PowerShell: đường dẫn dùng '/' cho cả hai.
    // `--settings` thắng statusLine của người dùng: script chạy tiếp lệnh của họ (biến STAG_USER_STATUSLINE).
    if (process.platform === 'win32') {
      this.statusScript = join(dir, `statusline-${this.port}.ps1`)
      await fs.writeFile(this.statusScript, statusScript(`${base}/status`), 'utf8')
    }
    const settings = this.statusScript
      ? {
          ...common,
          statusLine: {
            type: 'command',
            command: `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${this.statusScript.replace(/\\/g, '/')}"`,
            padding: 0
          }
        }
      : common
    this.settingsObj = settings
    const mcp = { mcpServers: { stag: this.stagServer() } }
    this.settingsFile = join(dir, `settings-${this.port}.json`)
    this.mcpFile = join(dir, `mcp-${this.port}.json`)
    await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2), 'utf8')
    await fs.writeFile(this.mcpFile, JSON.stringify(mcp, null, 2), 'utf8')
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Người gọi = phiên của token; header X-Stag-Agent chỉ để kiểm tra khớp. Phiên đã đóng → token đã thu hồi.
    const who = this.tokens.resolve(req.headers.authorization, String(req.headers['x-stag-agent'] ?? '') || undefined)
    if (!who) return send(res, 401, { error: 'unauthorized' })
    const agentId = who.agentId
    const path = (req.url ?? '').split('?')[0]

    if (path === '/hook') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const body = (await readJson(req)) as HookPayload
      const out = agentId ? await this.handlers.hook(agentId, body) : undefined
      // {} = không can thiệp quyết định của CLI, chỉ ghi nhận.
      return send(res, 200, out ?? {})
    }

    if (path === '/status') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const body = await readJson(req)
      if (agentId) this.handlers.status(agentId, body)
      return send(res, 200, {})
    }

    if (path === '/mcp') {
      // Không giữ phiên: không có luồng GET/SSE riêng, không có DELETE phiên.
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
      }
      const body = await readJson(req)
      const server = agentId ? this.handlers.mcp(agentId) : null
      if (!server) return send(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Agent không tồn tại' }, id: null })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => {
        transport.close()
        server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
      return
    }

    send(res, 404, { error: 'not found' })
  }
}

/**
 * App bị tắt đột ngột (crash, kill) thì không kịp xoá file cấu hình của nó. File của một cổng không còn
 * ai nghe là file sót; cổng còn nghe là của một bản app khác đang chạy → giữ.
 */
async function removeStaleConfigs(dir: string): Promise<void> {
  const byPort = new Map<number, string[]>()
  for (const name of await fs.readdir(dir)) {
    // `-plain`: file của một bản build thử ngày 2026-10-08, dọn luôn nếu còn sót.
    const m = /^(?:settings|mcp|statusline)-(\d+)(?:-plain)?\.(?:json|ps1)$/.exec(name)
    if (m) byPort.set(Number(m[1]), [...(byPort.get(Number(m[1])) ?? []), name])
  }
  for (const [port, names] of byPort) {
    if (await isListening(port)) continue
    for (const name of names) rmSync(join(dir, name), { force: true })
  }
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host: '127.0.0.1', port })
    sock.setTimeout(500)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => resolve(false))
  })
}

/**
 * Script statusLine: đọc JSON Claude Code gửi qua stdin, chuyển nguyên văn (byte) về app. Sau đó, nếu
 * người dùng có statusLine riêng (STAG_USER_STATUSLINE, xem context.ts) thì chạy lệnh đó với cùng stdin,
 * qua cùng loại shell Claude Code dùng (Git Bash ở STAG_USER_STATUSLINE_BASH, không có thì PowerShell),
 * và in nguyên kết quả của nó ra. Lệnh truyền qua biến môi trường để khỏi phải escape cả đoạn lệnh dài.
 * Chỉ dùng ký tự ASCII: PowerShell 5.1 đọc file .ps1 không BOM theo bảng mã ANSI.
 */
export function statusScript(url: string): string {
  return [
    '# stag.ai: forward the Claude Code statusLine JSON (context window usage) to the app,',
    "# then run the user's own statusLine command (if any) with the same input.",
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$ms = New-Object System.IO.MemoryStream',
    '[Console]::OpenStandardInput().CopyTo($ms)',
    '$bytes = $ms.ToArray()',
    'if ($env:STAG_TOKEN -and $env:STAG_AGENT_ID) {',
    '  try {',
    '    $wc = New-Object System.Net.WebClient',
    '    $wc.Proxy = $null',
    "    $wc.Headers.Add('Authorization', 'Bearer ' + $env:STAG_TOKEN)",
    "    $wc.Headers.Add('X-Stag-Agent', $env:STAG_AGENT_ID)",
    "    $wc.Headers.Add('Content-Type', 'application/json')",
    `    [void]$wc.UploadData('${url}', 'POST', $bytes)`,
    '  } catch {}',
    '}',
    'if (-not $env:STAG_USER_STATUSLINE) { exit 0 }',
    'try {',
    '  $psi = New-Object System.Diagnostics.ProcessStartInfo',
    '  if ($env:STAG_USER_STATUSLINE_BASH) {',
    '    $psi.FileName = $env:STAG_USER_STATUSLINE_BASH',
    String.raw`    $psi.Arguments = '-c "eval \"$STAG_USER_STATUSLINE\""'`,
    '  } else {',
    "    $psi.FileName = 'powershell.exe'",
    `    $psi.Arguments = '-NoProfile -NonInteractive -Command "Invoke-Expression $env:STAG_USER_STATUSLINE"'`,
    '  }',
    '  $psi.UseShellExecute = $false',
    '  $psi.RedirectStandardInput = $true',
    '  $psi.RedirectStandardOutput = $true',
    '  $p = [System.Diagnostics.Process]::Start($psi)',
    '  $out = [Console]::OpenStandardOutput()',
    '  $copy = $p.StandardOutput.BaseStream.CopyToAsync($out)',
    '  $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)',
    '  $p.StandardInput.Close()',
    '  $copy.Wait()',
    '  $p.WaitForExit()',
    '  $out.Flush()',
    '  exit $p.ExitCode',
    '} catch { exit 0 }',
    ''
  ].join('\r\n')
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}
