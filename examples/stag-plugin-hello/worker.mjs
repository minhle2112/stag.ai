// Worker của plugin mẫu Hello (xem package.json → stagPlugin).
import { definePlugin, runWorker } from '../stag-plugin-sdk/index.mjs'

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

    ctx.events.on('task.done', async (e) => {
      const key = `done:${e.agentId}`
      await ctx.state.set(key, ((await ctx.state.get(key)) ?? 0) + 1)
      ctx.logger.info(`${e.agentName} xong việc: ${e.data.title}`)
    })
    ctx.events.on('agent.session.started', async (e) => ctx.logger.info(`Phiên mới: ${e.agentName}`))
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
