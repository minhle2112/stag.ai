import { randomBytes } from 'node:crypto'
import { promises as fs, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { HookPayload } from './board'

export interface HubHandlers {
  hook(agentId: string, payload: HookPayload): void
  /** Máy chủ MCP gắn với một agent (tool task_* biết ai đang gọi). null = agent không tồn tại. */
  mcp(agentId: string): McpServer | null
}

/** Sự kiện hook để cập nhật kanban. SessionStart/SessionEnd không cần: app tự biết lúc mở/đóng phiên. */
const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop']

const MAX_BODY = 4 * 1024 * 1024

/**
 * Máy chủ HTTP nội bộ (chỉ 127.0.0.1) cho các phiên Claude Code của agent:
 * - POST /hook: hook HTTP của Claude Code báo agent đang làm / đang chờ.
 * - POST /mcp:  máy chủ MCP "stag" (Streamable HTTP, không giữ phiên) với các tool task_*.
 * Mỗi lần chạy app có một token ngẫu nhiên; agent nhận token qua biến môi trường STAG_TOKEN,
 * nên tiến trình khác trên máy không giả được trạng thái.
 */
export class StatusHub {
  private readonly token = randomBytes(24).toString('hex')
  private server: Server | null = null
  private port = 0
  private settingsFile = ''
  private mcpFile = ''

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

  /** Tham số thêm cho `claude`: hook + máy chủ MCP của app. */
  claudeArgs(): string[] {
    if (!this.server) throw new Error('StatusHub chưa chạy')
    return ['--settings', this.settingsFile, '--mcp-config', this.mcpFile]
  }

  /** Biến môi trường thêm cho tiến trình agent. */
  env(): Record<string, string> {
    return { STAG_TOKEN: this.token }
  }

  stop(): void {
    this.server?.close()
    this.server = null
    for (const f of [this.settingsFile, this.mcpFile]) if (f) rmSync(f, { force: true })
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
    const settings = {
      permissions: { allow: ['mcp__stag'] },
      hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [hook] }]]))
    }
    const mcp = {
      mcpServers: {
        stag: {
          type: 'http',
          url: `${base}/mcp`,
          headers: { Authorization: 'Bearer ${STAG_TOKEN}', 'X-Stag-Agent': '${STAG_AGENT_ID}' }
        }
      }
    }
    this.settingsFile = join(dir, `settings-${this.port}.json`)
    this.mcpFile = join(dir, `mcp-${this.port}.json`)
    await fs.writeFile(this.settingsFile, JSON.stringify(settings, null, 2), 'utf8')
    await fs.writeFile(this.mcpFile, JSON.stringify(mcp, null, 2), 'utf8')
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${this.token}`) return send(res, 401, { error: 'unauthorized' })
    const agentId = String(req.headers['x-stag-agent'] ?? '')
    const path = (req.url ?? '').split('?')[0]

    if (path === '/hook') {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const body = (await readJson(req)) as HookPayload
      if (agentId) this.handlers.hook(agentId, body)
      // Trả {} = không can thiệp quyết định của Claude Code, chỉ ghi nhận.
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
  const ports = new Set<number>()
  for (const name of await fs.readdir(dir)) {
    const m = /^(?:settings|mcp)-(\d+)\.json$/.exec(name)
    if (m) ports.add(Number(m[1]))
  }
  for (const port of ports) {
    if (await isListening(port)) continue
    for (const kind of ['settings', 'mcp']) rmSync(join(dir, `${kind}-${port}.json`), { force: true })
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
