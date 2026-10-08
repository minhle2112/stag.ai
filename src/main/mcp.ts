import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import type { Agent, Task, Workspace } from '@shared/types'
import type { Board } from './board'

export interface McpContext {
  agent: Agent
  workspace: Workspace
  /** Phiên đang chạy của agent (undefined nếu gọi tới khi phiên đã đóng). */
  sessionId?: string
  board: Board
  /** Mọi agent trong workspace và phiên của họ có đang chạy không (cho task_list). */
  teammates(): Array<{ agent: Agent; running: boolean }>
  /** Ghi lại file .sessions/<id>.md sau khi việc đổi. */
  syncSessionFile(): Promise<void>
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

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

  return server
}
