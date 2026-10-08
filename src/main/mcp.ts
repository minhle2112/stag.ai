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
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const fail = (e: unknown): ToolResult => ({ content: [{ type: 'text', text: String((e as Error)?.message ?? e) }], isError: true })

function describe(t: Task): string {
  return `"${t.title}" — phạm vi: ${t.scope || '(chưa ghi)'}`
}

/** Máy chủ MCP "stag" cho một agent: các tool để agent tự đưa việc của mình lên kanban. */
export function createStagMcp(ctx: McpContext): McpServer {
  const { agent, workspace: ws, board } = ctx
  const server = new McpServer({ name: 'stag', version: '0.1.0' })

  server.registerTool(
    'task_start',
    {
      title: 'Nhận việc',
      description:
        'Gọi ngay khi đã rõ việc người dùng giao. Tạo thẻ trên kanban của stag.ai (cột "Đang làm") và ghi Việc/Phạm vi vào file phiên. Mỗi lúc chỉ có một việc mở.',
      inputSchema: {
        title: z.string().min(1).max(120).describe('Tên việc ngắn gọn, tiếng Việt, ví dụ "Sửa lỗi đăng nhập Google"'),
        scope: z.string().min(1).max(500).describe('Thư mục/file bạn sẽ sửa, ví dụ "src/auth/, tests/auth/"')
      }
    },
    async ({ title, scope }) => {
      try {
        const task = await board.startTask(ws, agent, ctx.sessionId ?? '', title, scope)
        await ctx.syncSessionFile()
        return ok(`Đã nhận việc ${describe(task)}. Xong thì cập nhật vault rồi gọi task_done.`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_update',
    {
      title: 'Sửa việc',
      description: 'Đổi tiêu đề hoặc phạm vi của việc đang mở (ví dụ người dùng mở rộng phạm vi).',
      inputSchema: {
        title: z.string().max(120).optional().describe('Tiêu đề mới'),
        scope: z.string().max(500).optional().describe('Phạm vi mới')
      }
    },
    async ({ title, scope }) => {
      try {
        const task = await board.updateTask(ws, agent.id, { title, scope })
        await ctx.syncSessionFile()
        return ok(`Đã cập nhật: ${describe(task)}`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_done',
    {
      title: 'Xong việc',
      description:
        'Gọi khi đã làm xong việc đang mở và đã cập nhật vault. Thẻ chuyển sang cột "Xong"; tóm tắt được ghi vào mục Bàn giao của file phiên.',
      inputSchema: {
        summary: z.string().min(1).max(2000).describe('Tóm tắt đã làm gì, còn gì dở, người sau cần biết gì')
      }
    },
    async ({ summary }) => {
      try {
        const task = await board.finishTask(ws, agent.id, summary)
        await ctx.syncSessionFile()
        return ok(`Đã đánh dấu xong ${describe(task)}. Hỏi người dùng có việc gì tiếp không.`)
      } catch (e) {
        return fail(e)
      }
    }
  )

  server.registerTool(
    'task_list',
    {
      title: 'Việc của cả đội',
      description:
        'Xem việc đang mở và phạm vi của mọi agent trong workspace (kể cả bạn). Dùng trước khi sửa file để không đụng phạm vi của agent khác.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      try {
        const { tasks } = await board.snapshot(ws)
        const open = tasks.filter((t) => t.status === 'open')
        const lines = ctx.teammates().map(({ agent: a, running }) => {
          const t = open.find((x) => x.agentId === a.id)
          const who = `${a.name}${a.id === agent.id ? ' (bạn)' : ''}${a.role ? ` [${a.role}]` : ''}${running ? '' : ' — phiên đã dừng'}`
          return `- ${who}: ${t ? describe(t) : 'chưa nhận việc'}`
        })
        return ok(lines.length ? lines.join('\n') : 'Workspace chưa có agent nào.')
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
      title: 'Mở trang',
      description:
        'Mở URL trong tab của bạn ở browser của stag.ai (người dùng thấy trực tiếp). localhost mở ngay; trang ngoài Internet cần người dùng cho phép (lệnh sẽ chờ họ trả lời).',
      inputSchema: { url: z.string().min(1).describe('URL, ví dụ http://localhost:5173 hoặc https://example.com') }
    },
    run(({ url }: { url: string }) => browser.agentNavigate(agent, url))
  )

  server.registerTool(
    'browser_snapshot',
    {
      title: 'Đọc trang',
      description:
        'Đọc nội dung trang hiện tại dạng chữ. Mỗi nút/link/ô nhập có số [ref] để dùng với browser_click / browser_type. Gọi lại sau khi trang đổi.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    run(() => browser.agentSnapshot(agent))
  )

  server.registerTool(
    'browser_click',
    {
      title: 'Bấm',
      description: 'Bấm vào phần tử theo số [ref] lấy từ browser_snapshot.',
      inputSchema: { ref: z.number().int().positive().describe('Số [ref] trong browser_snapshot') }
    },
    run(({ ref }: { ref: number }) => browser.agentClick(agent, ref))
  )

  server.registerTool(
    'browser_type',
    {
      title: 'Gõ chữ',
      description: 'Gõ chữ vào ô nhập theo số [ref] (thay nội dung cũ). submit=true thì nhấn Enter sau khi gõ.',
      inputSchema: {
        ref: z.number().int().positive().describe('Số [ref] của ô nhập'),
        text: z.string().describe('Nội dung cần gõ'),
        submit: z.boolean().optional().describe('Nhấn Enter sau khi gõ')
      }
    },
    run(({ ref, text, submit }: { ref: number; text: string; submit?: boolean }) => browser.agentType(agent, ref, text, !!submit))
  )

  server.registerTool(
    'browser_press',
    {
      title: 'Nhấn phím',
      description: 'Nhấn một phím trên trang (ví dụ Enter, Escape, Tab, PageDown).',
      inputSchema: { key: z.enum(BROWSER_KEYS).describe('Tên phím') }
    },
    run(({ key }: { key: string }) => browser.agentPress(agent, key))
  )

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Chụp màn hình',
      description: 'Chụp phần đang hiển thị của trang trong tab của bạn (ảnh PNG).',
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
        'Đọc console của trang (log, cảnh báo, lỗi JS, lỗi tải trang) kể từ lần đọc trước. only_errors=true để chỉ lấy lỗi và cảnh báo.',
      inputSchema: { only_errors: z.boolean().optional().describe('Chỉ lấy lỗi và cảnh báo') },
      annotations: { readOnlyHint: true }
    },
    run(({ only_errors }: { only_errors?: boolean }) => browser.agentConsole(agent, !!only_errors))
  )
}
