// SDK cho trang của plugin stag.ai (slot page / settingsPage). App phục vụ file này ở `/__stag/ui.js` trong mọi
// plugin có giao diện, nên không cần chép vào gói:
//
//   <link rel="stylesheet" href="/__stag/ui.css" />
//   <script type="module">
//     import { host } from '/__stag/ui.js'
//     const ctx = await host.ready                 // { pluginId, slotId, slotType, workspace, agent, theme: 'dark' | 'light' }
//     host.onTheme((theme) => …)                    // app đổi sáng / tối
//     const stats = await host.getData('stats')    // ctx.data.register('stats', …) trong worker
//     await host.action('hello', { name: 'A' })    // ctx.actions.register('hello', …)
//     host.on('feed', (data) => …)                 // ctx.streams.emit('feed', data) trong worker
//   </script>
//
// Trang chạy trong iframe cách ly (origin "null"): không có window.stag, không đọc được trang của app. Mọi lời gọi đi
// qua postMessage tới app; app kiểm quyền đã duyệt như lời gọi của worker.

const TIMEOUT_MS = 60_000
const pending = new Map()
const contextFns = new Set()
const themeFns = new Set()
const localeFns = new Set()
const streamFns = new Map()
let nextId = 1
let context = null
let markReady
const ready = new Promise((r) => (markReady = r))

const post = (m) => window.parent.postMessage({ __stag: 1, ...m }, '*')

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return
  const m = e.data
  if (!m || m.__stag !== 1) return
  if (m.id !== undefined) {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m.result)
    return
  }
  if (m.event === 'context') {
    context = m.context
    document.documentElement.dataset.theme = context?.theme ?? 'dark'
    document.documentElement.lang = context?.locale ?? 'vi'
    markReady(context)
    for (const fn of contextFns) fn(context)
  } else if (m.event === 'theme') {
    if (context) context = { ...context, theme: m.theme }
    document.documentElement.dataset.theme = m.theme
    for (const fn of themeFns) fn(m.theme)
  } else if (m.event === 'locale') {
    if (context) context = { ...context, locale: m.locale }
    document.documentElement.lang = m.locale
    for (const fn of localeFns) fn(m.locale)
  } else if (m.event === 'stream') {
    for (const fn of streamFns.get(m.channel) ?? []) fn(m.data)
  }
})

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`stag.ai did not respond to ${method}`))
    }, TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    post({ id, method, params })
  })
}

const wsId = (given) => given ?? context?.workspace?.id

export const host = {
  /** Xong khi app gửi ngữ cảnh lần đầu. */
  ready,
  get context() {
    return context
  },
  /** Ngữ cảnh đổi (vd. người dùng chuyển workspace). Trả về hàm huỷ. */
  onContext(fn) {
    contextFns.add(fn)
    return () => contextFns.delete(fn)
  },
  /** App đổi sáng / tối ('dark' | 'light'). /__stag/ui.css tự đổi màu theo; trả về hàm huỷ. */
  onTheme(fn) {
    themeFns.add(fn)
    return () => themeFns.delete(fn)
  },
  /** App đổi ngôn ngữ giao diện ('vi' | 'en'); ngôn ngữ hiện tại ở host.context.locale. Trả về hàm huỷ. */
  onLocale(fn) {
    localeFns.add(fn)
    return () => localeFns.delete(fn)
  },
  call,
  getData: (key, params = {}) => call('data.get', { key, params }),
  action: (key, params = {}) => call('action.perform', { key, params }),
  config: { get: () => call('config.get') },
  state: {
    get: (key, scope) => call('state.get', { key, scope }),
    set: (key, value, scope) => call('state.set', { key, value, scope }),
    delete: (key, scope) => call('state.delete', { key, scope })
  },
  agents: {
    list: () => call('agents.list'),
    send: (agentId, text) => call('agent.sessions.send', { agentId, text }),
    /** Nhờ agent làm việc: gõ + gửi khi agent rảnh, chưa chạy thì mở phiên mới (quyền agent.sessions.send). */
    ask: (agentId, text) => call('agent.ask', { agentId, text })
  },
  board: { list: (workspaceId) => call('board.list', { workspaceId: wsId(workspaceId) }) },
  vault: {
    read: (path, workspaceId) => call('vault.read', { workspaceId: wsId(workspaceId), path }),
    write: (path, content, workspaceId) => call('vault.write', { workspaceId: wsId(workspaceId), path, content })
  },
  /** Quyền files.read: file trong thư mục dự án của workspace (path tương đối, '' = gốc dự án). */
  files: {
    list: (path = '', workspaceId) => call('files.list', { workspaceId: wsId(workspaceId), path }),
    read: (path, workspaceId) => call('files.read', { workspaceId: wsId(workspaceId), path })
  },
  notify: (title, body = '') => call('notify', { title, body }),
  /** Lời nhắn ngắn ở góc màn hình của app. */
  toast: (text) => call('ui.toast', { text: String(text) }),
  /** Mở địa chỉ http(s) trong trình duyệt của app ('browser') hoặc trình duyệt mặc định ('external'). */
  openUrl: (url, target = 'browser') => call('ui.openUrl', { url, target }),
  /** Hộp chọn file của hệ điều hành → đường dẫn đầy đủ hoặc null. filters: [{ name, extensions: ['mp4', …] }]. */
  pickFile: (title, filters) => call('ui.pickFile', { title, filters }),
  /** Mở thư mục chứa file (path tương đối so với dự án của workspace) trong Explorer. */
  reveal: (path, workspaceId) => call('ui.reveal', { workspaceId: wsId(workspaceId), path }),
  /** Mở Cài đặt → Plugin → trang của plugin này. */
  openSettings: () => call('ui.openSettings'),
  /** Địa chỉ cho <img> / <video> tới một file trong dự án (quyền files.read; video tua được). */
  fileUrl: (path, workspaceId) =>
    `/__stag/file/${encodeURIComponent(wsId(workspaceId) ?? '')}/${String(path).split(/[\\/]+/).map(encodeURIComponent).join('/')}`,
  /** Nhận dữ liệu worker đẩy qua ctx.streams.emit(channel, data). Trả về hàm huỷ. */
  on(channel, fn) {
    const set = streamFns.get(channel) ?? new Set()
    set.add(fn)
    streamFns.set(channel, set)
    return () => set.delete(fn)
  }
}
globalThis.stagHost = host

post({ method: 'ui.ready' })
// Trang cài đặt cao theo nội dung: báo chiều cao cho app.
let lastHeight = 0
new ResizeObserver(() => {
  const h = Math.ceil(document.body.getBoundingClientRect().height)
  if (h !== lastHeight) {
    lastHeight = h
    post({ method: 'ui.resize', params: { height: h } })
  }
}).observe(document.body)
