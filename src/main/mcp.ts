import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { Agent, Task, Workspace } from '@shared/types'
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
        scope: z.string().min(1).max(500).describe('Folders/files you will edit, e.g. "src/auth/, tests/auth/"')
      }
    },
    async ({ title, scope }) => {
      try {
        const task = await board.startTask(ws, agent, ctx.sessionId ?? '', title, scope)
        await ctx.syncSessionFile()
        return ok(`Task started: ${describe(task)}. When done, update the vault, then call task_done.`)
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
        return ok(`Updated: ${describe(task)}`)
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

  registerBrowserTools(server, ctx)
  return server
}

/** Tool browser_*: agent dùng tab của mình trong browser của workspace (người dùng thấy trực tiếp). */
function registerBrowserTools(server: McpServer, ctx: McpContext): void {
  const { agent, browser } = ctx
  const run =
    <A>(fn: (args: A) => Promise<string> | string) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return ok(await fn(args))
      } catch (e) {
        return fail(e)
      }
    }

  server.registerTool(
    'browser_navigate',
    {
      title: 'Open page',
      description:
        "Open a URL in your tab of the stag.ai browser (the user watches it live). localhost opens right away; pages on the Internet need the user's permission (the call waits for their answer).",
      inputSchema: { url: z.string().min(1).describe('URL, e.g. http://localhost:5173 or https://example.com') }
    },
    run(({ url }: { url: string }) => browser.agentNavigate(agent, url))
  )

  server.registerTool(
    'browser_snapshot',
    {
      title: 'Read page',
      description:
        'Read the current page as text. Every button/link/input has a [ref] number to use with browser_click / browser_type. Call again after the page changes.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    run(() => browser.agentSnapshot(agent))
  )

  server.registerTool(
    'browser_click',
    {
      title: 'Click',
      description: 'Click the element with the [ref] number from browser_snapshot.',
      inputSchema: { ref: z.number().int().positive().describe('[ref] number from browser_snapshot') }
    },
    run(({ ref }: { ref: number }) => browser.agentClick(agent, ref))
  )

  server.registerTool(
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
  )

  server.registerTool(
    'browser_press',
    {
      title: 'Press key',
      description: 'Press a key on the page (e.g. Enter, Escape, Tab, PageDown).',
      inputSchema: { key: z.enum(BROWSER_KEYS).describe('Key name') }
    },
    run(({ key }: { key: string }) => browser.agentPress(agent, key))
  )

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Screenshot',
      description: 'Capture the visible part of the page in your tab (PNG image).',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async (): Promise<ToolResult> => {
      try {
        return { content: [{ type: 'image', data: await browser.agentScreenshot(agent), mimeType: 'image/png' }] }
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'browser_console',
    {
      title: 'Console',
      description:
        "Read the page console (logs, warnings, JS errors, failed loads) since the last read. only_errors=true returns only errors and warnings.",
      inputSchema: { only_errors: z.boolean().optional().describe('Only errors and warnings') },
      annotations: { readOnlyHint: true }
    },
    run(({ only_errors }: { only_errors?: boolean }) => browser.agentConsole(agent, !!only_errors))
  )
}
