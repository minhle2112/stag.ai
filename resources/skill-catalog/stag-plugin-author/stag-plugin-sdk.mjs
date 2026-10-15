// Worker SDK for stag.ai plugins (alpha). No dependencies: every plugin keeps its own copy of this file next to its worker
// (Settings → Plugins → "New plugin" copies it in). Original: resources/plugin-sdk/stag-plugin-sdk.mjs; the copies in the
// bundled plugins and in the stag-plugin-author skill must be identical (a test checks). Function names follow Paperclip's plugin SDK:
//
//   import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'
//   const plugin = definePlugin({
//     async setup(ctx) {
//       ctx.tools.register('word_count', async (params, run) => ({ content: '42' }))
//       ctx.actions.register('hello', async (params, run) => ({ message: 'Hello' }))
//       ctx.events.on('task.done', async (event) => ctx.logger.info(event.data.title))
//       ctx.data.register('stats', async (params, run) => ({ done: 3 }))        // plugin page: host.getData('stats')
//       ctx.jobs.register('summary', async (job) => { /* runs on the schedule in manifest.jobs */ })
//       ctx.webhooks.register('ping', async (req) => ({ status: 200, body: { ok: true } }))
//       ctx.streams.emit('feed', { text: 'hi' })                               // pushed straight to open plugin pages
//     },
//     async onValidateConfig(config) { return { ok: true } },
//     async onHealth() { return { status: 'ok' } }
//   })
//   runWorker(plugin)
//
// Protocol: JSON-RPC 2.0 over the process message channel (Electron utilityProcess: process.parentPort;
// Node fork: process.send). See docs/plugins.md.

const HOST_TIMEOUT_MS = 30_000

export function definePlugin(def) {
  return def
}

export function runWorker(def) {
  const port = process.parentPort
  const send = port ? (m) => port.postMessage(m) : (m) => process.send?.(m)
  const pending = new Map()
  let nextId = 1
  let manifest = null
  let config = {}
  const tools = new Map()
  const actions = new Map()
  const data = new Map()
  const jobs = new Map()
  const webhooks = new Map()
  const listeners = new Map()
  let events = Promise.resolve()

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = `w${nextId++}`
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`stag.ai did not answer ${method}`))
      }, HOST_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      send({ jsonrpc: '2.0', id, method, params })
    })
  const log = (level) => (...args) =>
    send({ jsonrpc: '2.0', method: 'log', params: { level, message: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') } })

  const ctx = {
    get manifest() {
      return manifest
    },
    config: { get: async () => config },
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    tools: { register: (name, fn) => tools.set(name, fn) },
    actions: { register: (key, fn) => actions.set(key, fn) },
    data: { register: (key, fn) => data.set(key, fn) },
    jobs: { register: (key, fn) => jobs.set(key, fn) },
    webhooks: { register: (endpointKey, fn) => webhooks.set(endpointKey, fn) },
    streams: { emit: (channel, payload) => send({ jsonrpc: '2.0', method: 'streams.emit', params: { channel, data: payload } }) },
    events: {
      on: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    state: {
      get: (key, scope) => call('state.get', { key, scope }),
      set: (key, value, scope) => call('state.set', { key, value, scope }),
      delete: (key, scope) => call('state.delete', { key, scope })
    },
    agents: {
      list: () => call('agents.list'),
      send: (agentId, text) => call('agent.sessions.send', { agentId, text }),
      // agent.sessions.send capability: ask an agent to do something. Typed and sent when it is idle; an agent without a
      // running session gets a new session that starts with it. → { status: 'sent' | 'queued' | 'opened' }
      ask: (agentId, text) => call('agent.ask', { agentId, text })
    },
    board: { list: (workspaceId) => call('board.list', { workspaceId }) },
    vault: {
      read: (workspaceId, path) => call('vault.read', { workspaceId, path }),
      write: (workspaceId, path, content) => call('vault.write', { workspaceId, path, content })
    },
    // files.read capability: one folder of the project (not recursive; skips .git, node_modules, .sessions, .stag, vault) →
    // [{ name, path, type: 'file' | 'dir', size }]; reading a UTF-8 text file ≤ 1 MB → { text }. path is relative to the project.
    files: {
      list: (workspaceId, path = '') => call('files.list', { workspaceId, path }),
      read: (workspaceId, path) => call('files.read', { workspaceId, path })
    },
    // artifacts.publish capability: publish a project file (path relative to the workspace, or absolute inside it) to the
    // Artifacts tab on behalf of an agent, under its open / latest task. → { id }
    artifacts: {
      publish: (workspaceId, agentId, { file, title, description = '' }) => call('artifacts.publish', { workspaceId, agentId, file, title, description })
    },
    // browser.cookies capability (risky): the Browser pane's cookies for one domain and its subdomains, as a Netscape
    // cookies.txt → { text, count }. Keep them in memory or a temp file you delete right after use.
    browser: {
      cookies: (workspaceId, domain) => call('browser.cookies', { workspaceId, domain })
    },
    notify: (title, body) => call('notify', { title, body })
  }

  const handlers = {
    async initialize(p) {
      manifest = p.manifest
      config = p.config ?? {}
      await def.setup?.(ctx)
      return { ok: true }
    },
    async health() {
      return (await def.onHealth?.()) ?? { status: 'ok' }
    },
    async validateConfig(p) {
      return (await def.onValidateConfig?.(p.config)) ?? { ok: true }
    },
    async configChanged(p) {
      config = p.config ?? {}
      await def.onConfigChanged?.(config)
    },
    async shutdown() {
      await def.onShutdown?.()
      setTimeout(() => process.exit(0), 50)
    },
    async onEvent(p) {
      for (const fn of listeners.get(p.event.type) ?? []) await fn(p.event)
    },
    async executeTool(p) {
      const fn = tools.get(p.name)
      if (!fn) throw new Error(`Tool "${p.name}" is not registered in setup()`)
      const r = await fn(p.params ?? {}, p.context)
      return typeof r === 'string' ? { content: r } : r
    },
    async performAction(p) {
      const fn = actions.get(p.key)
      if (!fn) throw new Error(`Action "${p.key}" is not registered in setup()`)
      return (await fn(p.params ?? {}, p.context)) ?? {}
    },
    async getData(p) {
      const fn = data.get(p.key)
      if (!fn) throw new Error(`Data "${p.key}" is not registered in setup()`)
      return fn(p.params ?? {}, p.context)
    },
    async runJob(p) {
      const fn = jobs.get(p.job.key)
      if (!fn) throw new Error(`Job "${p.job.key}" is not registered in setup()`)
      await fn(p.job)
      return { ok: true }
    },
    async handleWebhook(p) {
      const fn = webhooks.get(p.endpointKey) ?? def.onWebhook
      if (!fn) throw new Error(`Webhook "${p.endpointKey}" is not registered in setup()`)
      return (await fn(p)) ?? null
    }
  }

  const onMessage = async (m) => {
    if (!m || m.jsonrpc !== '2.0') return
    // Reply to a worker → host call.
    if (m.id !== undefined && !m.method) {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error) p.reject(new Error(m.error.message))
      else p.resolve(m.result)
      return
    }
    const fn = handlers[m.method]
    if (m.id === undefined) {
      // Notification (e.g. onEvent): no reply; handled one at a time in arrival order (two events never overlap).
      if (fn) events = events.then(() => fn(m.params ?? {})).catch((e) => log('error')(`${m.method}: ${e?.message ?? e}`))
      return
    }
    if (!fn) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `No method ${m.method}` } })
    try {
      send({ jsonrpc: '2.0', id: m.id, result: (await fn(m.params ?? {})) ?? null })
    } catch (e) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32002, message: String(e?.message ?? e) } })
    }
  }

  if (port) port.on('message', (e) => onMessage(e.data))
  else process.on('message', onMessage)
  process.on('uncaughtException', (e) => log('error')(`uncaughtException: ${e?.stack ?? e}`))
  process.on('unhandledRejection', (e) => log('error')(`unhandledRejection: ${e?.stack ?? e}`))
}
