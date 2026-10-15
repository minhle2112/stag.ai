// Worker of the Hello example plugin (see package.json → stagPlugin).
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

const plugin = definePlugin({
  async setup(ctx) {
    ctx.tools.register('word_count', async ({ text }) => {
      const { maxWords = 500 } = await ctx.config.get()
      const n = String(text ?? '').trim().split(/\s+/).filter(Boolean).length
      return { content: `${n} words${n > maxWords ? ` — over the limit of ${maxWords}` : ''}.` }
    })

    ctx.actions.register('hello', async (_params, run) => {
      const { greeting = 'Hello' } = await ctx.config.get()
      const { agents } = await ctx.agents.list()
      const here = agents.filter((a) => a.workspaceId === run.workspaceId && a.kind !== 'terminal')
      return { message: `${greeting}! This workspace has ${here.length} agent${here.length === 1 ? '' : 's'}, ${here.filter((a) => a.running).length} running.` }
    })

    ctx.actions.register('stats', async (_params, run) => {
      const done = (await ctx.state.get(`done:${run.agentId}`)) ?? 0
      return { message: `${run.agentName ?? 'Agent'} has finished ${done} task${done === 1 ? '' : 's'} since Hello was installed.` }
    })

    // "Hello" / "Stats" pages: tasks finished per agent (only that workspace when the page is open in one).
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

    // Status bar (statusBarItem slot "done", dataKey "statusBar"): total tasks done; the app re-reads it when the worker emits "statusBar".
    ctx.data.register('statusBar', async () => {
      const { agents } = await ctx.agents.list()
      let total = 0
      for (const a of agents) total += (await ctx.state.get(`done:${a.id}`)) ?? 0
      return { text: `Hello · ${total} done`, tooltip: 'Tasks agents have finished since Hello was installed. Click to say hello.', tone: total ? 'ok' : 'default' }
    })

    ctx.actions.register('reset', async () => {
      const { agents } = await ctx.agents.list()
      for (const a of agents) await ctx.state.delete(`done:${a.id}`)
      ctx.streams.emit('stats', { reset: true })
      ctx.streams.emit('statusBar', {})
      return { message: 'Done counts reset.' }
    })

    ctx.events.on('task.done', async (e) => {
      const key = `done:${e.agentId}`
      await ctx.state.set(key, ((await ctx.state.get(key)) ?? 0) + 1)
      ctx.logger.info(`${e.agentName} finished: ${e.data.title}`)
      ctx.streams.emit('stats', { agentId: e.agentId })
      ctx.streams.emit('statusBar', {})
    })
    ctx.events.on('agent.session.started', async (e) => ctx.logger.info(`New session: ${e.agentName}`))

    const summarize = async (trigger) => {
      const { agents } = await ctx.agents.list()
      const parts = []
      for (const a of agents) {
        const n = (await ctx.state.get(`done:${a.id}`)) ?? 0
        if (n) parts.push(`${a.name}: ${n}`)
      }
      const text = parts.length ? `Tasks done — ${parts.join(', ')}` : 'No agent has finished a task yet.'
      await ctx.state.set('lastSummary', { at: new Date().toISOString(), text, trigger })
      ctx.logger.info(`Summary (${trigger}): ${text}`)
      ctx.streams.emit('stats', { summary: text })
      return text
    }
    // Scheduled job "summary" (top of every hour, see manifest.jobs); the "Stats" page runs the same code through an action.
    ctx.jobs.register('summary', (job) => summarize(job.trigger))
    ctx.actions.register('summaryNow', async () => ({ message: await summarize('page') }))

    // Webhook "ping": saves the request body and pushes it to the Hello page.
    ctx.webhooks.register('ping', async (req) => {
      const ping = { at: new Date().toISOString(), body: req.parsedBody ?? req.rawBody.slice(0, 2000) }
      await ctx.state.set('lastPing', ping)
      ctx.logger.info(`Webhook ping: ${JSON.stringify(ping.body).slice(0, 200)}`)
      ctx.streams.emit('ping', ping)
      return { status: 200, body: { ok: true, received: ping.at } }
    })

    ctx.logger.info('Hello is ready')
  },

  async onValidateConfig(config) {
    if (typeof config.greeting === 'string' && config.greeting.length > 80) return { ok: false, errors: ['The greeting is longer than 80 characters.'] }
    return { ok: true }
  },

  async onHealth() {
    return { status: 'ok' }
  }
})

runWorker(plugin)
