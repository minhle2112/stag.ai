// Worker của plugin "Nhật ký việc" (xem package.json → stagPlugin). Note viết bằng tiếng Anh như vault của agent.
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

const pad = (n) => String(n).padStart(2, '0')
/** Ngày theo giờ máy, dạng YYYY-MM-DD. */
export const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Nội dung note của một ngày; null khi không có việc nào xong hôm đó. */
export function renderLog(day, tasks, includeOpen) {
  const done = tasks.filter((t) => t.status === 'done' && t.doneAt && dayOf(new Date(t.doneAt)) === day)
  if (!done.length) return null
  const open = includeOpen ? tasks.filter((t) => t.status === 'open') : []
  const line = (t) => {
    const scope = t.scope ? ` (scope: ${t.scope})` : ''
    const summary = t.summary ? ` — ${t.summary.replace(/\s+/g, ' ').trim()}` : ''
    return `- **${t.agentName}**: ${t.title}${scope}${summary}`
  }
  const out = ['---', 'type: task-log', `date: ${day}`, '---', `# Task log ${day}`, '', `## Done (${done.length})`, ...done.map(line)]
  if (open.length) out.push('', `## Still open (${open.length})`, ...open.map(line))
  out.push('', '_Written by the stag.ai plugin "Nhật ký việc"; rewritten on each run._', '')
  return out.join('\n')
}

const plugin = definePlugin({
  async setup(ctx) {
    const write = async (workspace, day) => {
      const { folder = 'Task log', includeOpen = true } = await ctx.config.get()
      const text = renderLog(day, await ctx.board.list(workspace.id), includeOpen)
      if (!text) return null
      const path = `${String(folder).replace(/^[\/]+|[\/]+$/g, '') || 'Task log'}/${day}.md`
      await ctx.vault.write(workspace.id, path, text)
      ctx.logger.info(`${workspace.name}: ${path}`)
      return path
    }

    ctx.jobs.register('daily', async () => {
      const day = dayOf(new Date())
      const { workspaces } = await ctx.agents.list()
      for (const w of workspaces) await write(w, day).catch((e) => ctx.logger.error(`${w.name}: ${e.message}`))
    })

    ctx.actions.register('writeToday', async (_params, run) => {
      if (!run.workspaceId) return { message: 'Chưa chọn workspace.' }
      const path = await write({ id: run.workspaceId, name: run.workspaceName ?? '' }, dayOf(new Date()))
      return { message: path ? `Đã ghi ${path} trong vault.` : 'Hôm nay chưa có việc nào xong, chưa ghi gì.' }
    })
  }
})

// Chỉ chạy worker khi là tiến trình plugin (test import renderLog / dayOf trực tiếp).
if (process.env.STAG_PLUGIN_ID) runWorker(plugin)
