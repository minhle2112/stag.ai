// Worker của plugin mẫu Hello (xem package.json → stagPlugin).
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

const plugin = definePlugin({
  async setup(ctx) {
    ctx.tools.register('word_count', async ({ text }) => {
      const { maxWords = 500 } = await ctx.config.get()
      const n = String(text ?? '').trim().split(/\s+/).filter(Boolean).length
      return { content: `${n} words${n > maxWords ? ` — over the limit of ${maxWords}` : ''}.` }
    })

    ctx.actions.register('hello', async (_params, run) => {
      const { greeting = 'Xin chào' } = await ctx.config.get()
      const { agents } = await ctx.agents.list()
      const here = agents.filter((a) => a.workspaceId === run.workspaceId && a.kind !== 'terminal')
      return { message: `${greeting}! Workspace này có ${here.length} agent, ${here.filter((a) => a.running).length} đang chạy.` }
    })

    ctx.actions.register('stats', async (_params, run) => {
      const done = (await ctx.state.get(`done:${run.agentId}`)) ?? 0
      return { message: `${run.agentName ?? 'Agent'} đã xong ${done} việc kể từ khi cài Hello.` }
    })

    // Trang "Hello" / "Số liệu": số việc xong của từng agent (cả workspace nếu trang mở trong một workspace).
    ctx.data.register('stats', async (_params, run) => {
      const { workspaces, agents } = await ctx.agents.list()
      const rows = []
      for (const a of agents) {
        if (a.kind === 'terminal' || (run.workspaceId && a.workspaceId !== run.workspaceId)) continue
        rows.push({
          id: a.id,
          name: a.name,
          workspace: workspaces.find((w) => w.id === a.workspaceId)?.name ?? '',
          running: a.running,
          done: (await ctx.state.get(`done:${a.id}`)) ?? 0
        })
      }
      return { agents: rows, lastPing: (await ctx.state.get('lastPing')) ?? null, lastSummary: (await ctx.state.get('lastSummary')) ?? null }
    })

    // Thanh trạng thái (slot statusBarItem "done", dataKey "statusBar"): tổng việc xong; app đọc lại khi worker phát "statusBar".
    ctx.data.register('statusBar', async () => {
      const { agents } = await ctx.agents.list()
      let total = 0
      for (const a of agents) total += (await ctx.state.get(`done:${a.id}`)) ?? 0
      return { text: `Hello · ${total} việc xong`, tooltip: 'Số việc agent đã xong kể từ khi cài Hello. Bấm để chào.', tone: total ? 'ok' : 'default' }
    })

    ctx.actions.register('reset', async () => {
      const { agents } = await ctx.agents.list()
      for (const a of agents) await ctx.state.delete(`done:${a.id}`)
      ctx.streams.emit('stats', { reset: true })
      ctx.streams.emit('statusBar', {})
      return { message: 'Đã đặt lại số việc xong.' }
    })

    ctx.events.on('task.done', async (e) => {
      const key = `done:${e.agentId}`
      await ctx.state.set(key, ((await ctx.state.get(key)) ?? 0) + 1)
      ctx.logger.info(`${e.agentName} xong việc: ${e.data.title}`)
      ctx.streams.emit('stats', { agentId: e.agentId })
      ctx.streams.emit('statusBar', {})
    })
    ctx.events.on('agent.session.started', async (e) => ctx.logger.info(`Phiên mới: ${e.agentName}`))

    const summarize = async (trigger) => {
      const { agents } = await ctx.agents.list()
      const parts = []
      for (const a of agents) {
        const n = (await ctx.state.get(`done:${a.id}`)) ?? 0
        if (n) parts.push(`${a.name}: ${n}`)
      }
      const text = parts.length ? `Việc đã xong — ${parts.join(', ')}` : 'Chưa agent nào xong việc.'
      await ctx.state.set('lastSummary', { at: new Date().toISOString(), text, trigger })
      ctx.logger.info(`Tổng kết (${trigger}): ${text}`)
      ctx.streams.emit('stats', { summary: text })
      return text
    }
    // Việc theo lịch "summary" (đầu mỗi giờ, xem manifest.jobs); trang "Số liệu" gọi cùng đoạn mã qua action.
    ctx.jobs.register('summary', (job) => summarize(job.trigger))
    ctx.actions.register('summaryNow', async () => ({ message: await summarize('page') }))

    // Webhook "ping": lưu thân yêu cầu, đẩy lên trang Hello.
    ctx.webhooks.register('ping', async (req) => {
      const ping = { at: new Date().toISOString(), body: req.parsedBody ?? req.rawBody.slice(0, 2000) }
      await ctx.state.set('lastPing', ping)
      ctx.logger.info(`Webhook ping: ${JSON.stringify(ping.body).slice(0, 200)}`)
      ctx.streams.emit('ping', ping)
      return { status: 200, body: { ok: true, received: ping.at } }
    })

    ctx.logger.info('Hello đã sẵn sàng')
  },

  async onValidateConfig(config) {
    if (typeof config.greeting === 'string' && config.greeting.length > 80) return { ok: false, errors: ['Lời chào dài quá 80 ký tự.'] }
    return { ok: true }
  },

  async onHealth() {
    return { status: 'ok' }
  }
})

runWorker(plugin)
