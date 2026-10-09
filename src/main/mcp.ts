import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import { BROWSER_TOOLS_OFF } from '@shared/browser'
import type { Agent, Task, Workspace } from '@shared/types'
import { overlapsOf, scopeLocks, sharedPrefixes } from '@shared/scope'
import type { Board } from './board'
import { BROWSER_KEYS, type BrowserService } from './browser'

export interface McpContext {
  agent: Agent
  workspace: Workspace
  /** Phiên đang chạy của agent (undefined nếu gọi tới khi phiên đã đóng). */
  sessionId?: string
  board: Board
  browser: BrowserService
  /** Mọi agent trong workspace và phiên của họ có đang chạy không (cho task_list). */
  teammates(): Array<{ agent: Agent; running: boolean }>
  /** Ghi lại file .sessions/<id>.md sau khi việc đổi. */
  syncSessionFile(): Promise<void>
  /** Lưu bản bàn giao rồi đóng phiên; app mở phiên mới đọc bản bàn giao đó. */
  handoff(summary: string): Promise<void>
  /** Tool của plugin (Cài đặt → Plugin) bật cho agent này; tên đã có tiền tố plugin. */
  extraTools?: ExtraTool[]
  /** false = Cài đặt → Trình duyệt tắt "Cho agent dùng trình duyệt" cho agent này: ẩn tool browser_*, gọi thì báo lỗi. */
  browserTools?: boolean
}

export interface ExtraTool {
  name: string
  title: string
  description: string
  /** JSON Schema object của tham số. */
  inputSchema: Record<string, unknown>
  call(params: unknown): Promise<{ text: string; isError: boolean }>
}

/** JSON Schema của plugin → zod cho MCP SDK; không đổi được thì nhận mọi object (plugin tự kiểm). */
function schemaOf(json: Record<string, unknown>): z.ZodType {
  try {
    const s = z.fromJSONSchema(json as Parameters<typeof z.fromJSONSchema>[0])
    if (s instanceof z.ZodObject) return s
  } catch {
    // bỏ qua
  }
  return z.object({}).passthrough()
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (e: unknown): ToolResult => ({ content: [{ type: 'text', text: String((e as Error)?.message ?? e) }], isError: true })

function describe(t: Task): string {
  return `"${t.title}" — scope: ${t.scope || '(not set)'}`
}

/** Cảnh báo khi phạm vi vừa khai đè lên việc đang mở của agent khác (xem shared/scope.ts). */
async function overlapWarning(board: Board, ws: Workspace, task: Task): Promise<string> {
  const { tasks } = await board.snapshot(ws)
  const shared = sharedPrefixes(ws.path, ws.vaultPath)
  const overlaps = overlapsOf(task, scopeLocks(tasks, ws.path), ws.path, shared)
  if (!overlaps.length) return ''
  const lines = overlaps.map((o) => `- ${o.other.agentName}: "${o.other.title}" (scope: ${o.other.scope}) — overlaps on ${o.labels.join(', ')}`)
  return `\n\nWARNING — your scope overlaps with other agents' open tasks:\n${lines.join('\n')}\nTell the user now and agree on who edits what (narrow your scope with task_update if possible). Before you edit a file in another agent's scope, stag.ai asks the user for permission.`
}

/** Máy chủ MCP "stag" cho một agent: các tool để agent tự đưa việc của mình lên kanban. */
export function createStagMcp(ctx: McpContext): McpServer {
  const { agent, workspace: ws, board } = ctx
  const server = new McpServer({ name: 'stag', version: '0.1.0' })

  server.registerTool(
    'task_start',
    {
      title: 'Start task',
      description:
        'Call as soon as the task the user gave you is clear. Creates a card on the stag.ai kanban ("working" column) and writes Task/Scope into your session file. Only one open task at a time.',
      inputSchema: {
        title: z.string().min(1).max(120).describe('Short task title in the conversation language (shown to the user on the kanban), e.g. "Fix Google sign-in bug"'),
        scope: z.string().min(1).max(500).describe('Folders/files you will edit, relative to the project folder, comma-separated, e.g. "src/auth/, tests/auth/*.test.ts". stag.ai locks them for you while the task is open.')
      }
    },
    async ({ title, scope }) => {
      try {
        const task = await board.startTask(ws, agent, ctx.sessionId ?? '', title, scope)
        await ctx.syncSessionFile()
        return ok(`Task started: ${describe(task)}. When done, update the vault, then call task_done.${await overlapWarning(board, ws, task)}`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_update',
    {
      title: 'Update task',
      description: 'Change the title or scope of your open task (e.g. the user widened the scope).',
      inputSchema: {
        title: z.string().max(120).optional().describe('New title'),
        scope: z.string().max(500).optional().describe('New scope')
      }
    },
    async ({ title, scope }) => {
      try {
        const task = await board.updateTask(ws, agent.id, { title, scope })
        await ctx.syncSessionFile()
        return ok(`Updated: ${describe(task)}${scope ? await overlapWarning(board, ws, task) : ''}`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_done',
    {
      title: 'Finish task',
      description:
        'Call when your open task is done and the vault is updated. The card moves to the "done" column; the summary goes into the Handoff section of your session file.',
      inputSchema: {
        summary: z.string().min(1).max(2000).describe('Handoff summary in the conversation language: what was done, what is left, what the next person needs to know')
      }
    },
    async ({ summary }) => {
      try {
        const task = await board.finishTask(ws, agent.id, summary)
        await ctx.syncSessionFile()
        return ok(`Marked done: ${describe(task)}. Ask the user if there is anything else.`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_list',
    {
      title: 'Team tasks',
      description:
        "See the open task and scope of every agent in the workspace (including you). Use it before editing files so you do not touch another agent's scope.",
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const { tasks } = await board.snapshot(ws)
        const open = tasks.filter((t) => t.status === 'open')
        const lines = ctx.teammates().map(({ agent: a, running }) => {
          const t = open.find((x) => x.agentId === a.id)
          const who = `${a.name}${a.id === agent.id ? ' (you)' : ''}${a.role ? ` [${a.role}]` : ''}${running ? '' : ' — session stopped'}`
          return `- ${who}: ${t ? describe(t) : 'no task yet'}`
        })
        return ok(lines.length ? lines.join('\n') : 'The workspace has no agents yet.')
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'session_handoff',
    {
      title: 'Hand off to a new session',
      description:
        'Call only when stag.ai asks you to hand off (a message starting with "[stag.ai] Handoff") or the user asks you to continue in a fresh session. Update the vault first. stag.ai saves your handoff, closes this session and opens a new one that starts from it. Your open task stays open.',
      inputSchema: {
        summary: z
          .string()
          .min(1)
          .max(8000)
          .describe(
            'Everything your next session needs, in the conversation language: the goal, what is done, what is left, key files and decisions, the exact next step, and anything the user asked for that is still pending'
          )
      }
    },
    async ({ summary }) => {
      try {
        await ctx.handoff(summary)
        return ok('Handoff saved. stag.ai will close this session in a few seconds and open a new one. Do nothing more.')
      } catch (e) {
        return fail(e)
      }
    }
  )

  const browserTools = registerBrowserTools(server, ctx)
  if (ctx.browserTools === false) hideFromList(server, browserTools)
  for (const t of ctx.extraTools ?? []) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: schemaOf(t.inputSchema) }, async (params: unknown) => {
      const r = await t.call(params)
      return { content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) }
    })
  }

  return server
}

/**
 * Ẩn tool khỏi tools/list nhưng vẫn gọi được: máy chủ tạo mới cho mỗi yêu cầu, nên phiên mở lúc đã tắt không thấy tool,
 * còn phiên đã thấy tool từ trước (CLI giữ danh sách cả phiên) gọi tới thì nhận lỗi rõ ràng thay vì "not found".
 * SDK không có cách công khai để ẩn mà vẫn gọi được → bọc handler tools/list có sẵn; SDK đổi cấu trúc thì bỏ qua
 * (tool vẫn hiện nhưng gọi báo lỗi).
 */
function hideFromList(server: McpServer, tools: RegisteredTool[]): void {
  type Handler = (req: unknown, extra: unknown) => Promise<unknown>
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers
  const list = handlers?.get('tools/list')
  if (!handlers || !list) return
  handlers.set('tools/list', async (req, extra) => {
    // Handler của SDK lọc theo `enabled` ngay khi gọi (đồng bộ), nên chỉ tắt trong lúc đó.
    for (const t of tools) t.enabled = false
    try {
      return await list(req, extra)
    } finally {
      for (const t of tools) t.enabled = true
    }
  })
}

/** Tool browser_*: agent dùng tab của mình trong browser của workspace (người dùng thấy trực tiếp). */
function registerBrowserTools(server: McpServer, ctx: McpContext): RegisteredTool[] {
  const { agent, browser } = ctx
  const off = ctx.browserTools === false
  const run =
    <A>(fn: (args: A) => Promise<string> | string) =>
    async (args: A): Promise<ToolResult> => {
      if (off) return fail(BROWSER_TOOLS_OFF)
      try {
        return ok(await fn(args))
      } catch (e) {
        return fail(e)
      }
    }

  const tools: RegisteredTool[] = []
  tools.push(server.registerTool(
    'browser_navigate',
    {
      title: 'Open page',
      description:
        "Open a URL in your tab of the stag.ai browser (the user watches it live). localhost opens right away; pages on the Internet need the user's permission (the call waits for their answer).",
      inputSchema: { url: z.string().min(1).describe('URL, e.g. http://localhost:5173 or https://example.com') }
    },
    run(({ url }: { url: string }) => browser.agentNavigate(agent, url))
  ))

  tools.push(server.registerTool(
    'browser_snapshot',
    {
      title: 'Read page',
      description:
        'Read the current page as text. Every button/link/input has a [ref] number to use with browser_click / browser_type. Call again after the page changes.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    run(() => browser.agentSnapshot(agent))
  ))

  tools.push(server.registerTool(
    'browser_click',
    {
      title: 'Click',
      description: 'Click the element with the [ref] number from browser_snapshot.',
      inputSchema: { ref: z.number().int().positive().describe('[ref] number from browser_snapshot') }
    },
    run(({ ref }: { ref: number }) => browser.agentClick(agent, ref))
  ))

  tools.push(server.registerTool(
    'browser_type',
    {
      title: 'Type',
      description: 'Type into the input with the [ref] number (replaces its content). submit=true presses Enter afterwards.',
      inputSchema: {
        ref: z.number().int().positive().describe('[ref] number of the input'),
        text: z.string().describe('Text to type'),
        submit: z.boolean().optional().describe('Press Enter after typing')
      }
    },
    run(({ ref, text, submit }: { ref: number; text: string; submit?: boolean }) => browser.agentType(agent, ref, text, !!submit))
  ))

  tools.push(server.registerTool(
    'browser_press',
    {
      title: 'Press key',
      description: 'Press a key on the page (e.g. Enter, Escape, Tab, PageDown).',
      inputSchema: { key: z.enum(BROWSER_KEYS).describe('Key name') }
    },
    run(({ key }: { key: string }) => browser.agentPress(agent, key))
  ))

  tools.push(server.registerTool(
    'browser_screenshot',
    {
      title: 'Screenshot',
      description: 'Capture the visible part of the page in your tab (PNG image).',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async (): Promise<ToolResult> => {
      if (off) return fail(BROWSER_TOOLS_OFF)
      try {
        return { content: [{ type: 'image', data: await browser.agentScreenshot(agent), mimeType: 'image/png' }] }
      } catch (e) {
        return fail(e)
      }
    }
  ))

  tools.push(server.registerTool(
    'browser_console',
    {
      title: 'Console',
      description:
        "Read the page console (logs, warnings, JS errors, failed loads) since the last read. only_errors=true returns only errors and warnings.",
      inputSchema: { only_errors: z.boolean().optional().describe('Only errors and warnings') },
      annotations: { readOnlyHint: true }
    },
    run(({ only_errors }: { only_errors?: boolean }) => browser.agentConsole(agent, !!only_errors))
  ))
  return tools
}
