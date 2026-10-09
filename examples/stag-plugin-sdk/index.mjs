// SDK worker cho plugin stag.ai (alpha). Không phụ thuộc gói nào: chép file này vào plugin của bạn
// (hoặc import đường dẫn tương đối như các plugin ví dụ). Tên hàm theo SDK plugin của Paperclip:
//
//   import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'
//   const plugin = definePlugin({
//     async setup(ctx) {
//       ctx.tools.register('word_count', async (params, run) => ({ content: '42' }))
//       ctx.actions.register('hello', async (params, run) => ({ message: 'Xin chào' }))
//       ctx.events.on('task.done', async (event) => ctx.logger.info(event.data.title))
//       ctx.data.register('stats', async (params, run) => ({ done: 3 }))        // trang plugin: host.getData('stats')
//       ctx.jobs.register('summary', async (job) => { /* chạy theo lịch trong manifest.jobs */ })
//       ctx.webhooks.register('ping', async (req) => ({ status: 200, body: { ok: true } }))
//       ctx.streams.emit('feed', { text: 'hi' })                               // đẩy thẳng tới trang plugin đang mở
//     },
//     async onValidateConfig(config) { return { ok: true } },
//     async onHealth() { return { status: 'ok' } }
//   })
//   runWorker(plugin)
//
// Giao thức: JSON-RPC 2.0 qua kênh tin nhắn của tiến trình (Electron utilityProcess: process.parentPort;
// Node fork: process.send). Xem docs/plugins.md.

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
        reject(new Error(`stag.ai không trả lời ${method}`))
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
      send: (agentId, text) => call('agent.sessions.send', { agentId, text })
    },
    board: { list: (workspaceId) => call('board.list', { workspaceId }) },
    vault: {
      read: (workspaceId, path) => call('vault.read', { workspaceId, path }),
      write: (workspaceId, path, content) => call('vault.write', { workspaceId, path, content })
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
      if (!fn) throw new Error(`Tool "${p.name}" chưa được đăng ký trong setup()`)
      const r = await fn(p.params ?? {}, p.context)
      return typeof r === 'string' ? { content: r } : r
    },
    async performAction(p) {
      const fn = actions.get(p.key)
      if (!fn) throw new Error(`Action "${p.key}" chưa được đăng ký trong setup()`)
      return (await fn(p.params ?? {}, p.context)) ?? {}
    },
    async getData(p) {
      const fn = data.get(p.key)
      if (!fn) throw new Error(`Data "${p.key}" chưa được đăng ký trong setup()`)
      return fn(p.params ?? {}, p.context)
    },
    async runJob(p) {
      const fn = jobs.get(p.job.key)
      if (!fn) throw new Error(`Job "${p.job.key}" chưa được đăng ký trong setup()`)
      await fn(p.job)
      return { ok: true }
    },
    async handleWebhook(p) {
      const fn = webhooks.get(p.endpointKey) ?? def.onWebhook
      if (!fn) throw new Error(`Webhook "${p.endpointKey}" chưa được đăng ký trong setup()`)
      return (await fn(p)) ?? null
    }
  }

  const onMessage = async (m) => {
    if (!m || m.jsonrpc !== '2.0') return
    // Trả lời cho lời gọi worker → host.
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
      // Thông báo (vd. onEvent): không trả lời; xử lý lần lượt theo thứ tự đến (hai sự kiện không chạy chồng nhau).
      if (fn) events = events.then(() => fn(m.params ?? {})).catch((e) => log('error')(`${m.method}: ${e?.message ?? e}`))
      return
    }
    if (!fn) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Không có method ${m.method}` } })
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
