# Plugin (alpha)

Plugin mở rộng chính app stag.ai, theo kiểu plugin của Paperclip: thêm nút ở thanh bên / thanh trên cùng / menu ⋯ của agent, thêm trang riêng (tab cạnh Kanban / Agents / Artifacts, tab trong Cài đặt → Plugin), thêm tool cho agent, nghe sự kiện của app, chạy việc theo lịch, nhận webhook. Quản lý ở Cài đặt → Plugin.

- **Cài**: từ một thư mục (dùng tại chỗ, sửa xong bấm "Đọc lại gói") hoặc gói npm (`npm install --ignore-scripts` vào `userData/plugins/npm`).
- **Duyệt quyền**: plugin chỉ chạy sau khi bạn bấm "Duyệt và chạy". Bản mới xin thêm quyền → dừng, chờ duyệt lại ("Chờ duyệt quyền mới").
- **Bật / tắt** theo cấp app → workspace → agent. Tắt ở cấp app = dừng worker; tắt ở workspace / agent = ẩn nút, tool, sự kiện ở đó.
- Trang mỗi plugin: **Cấu hình** (form tự sinh từ `instanceConfigSchema`), trang cài đặt riêng của plugin (nếu có), **Trạng thái** (worker, PID, thời gian chạy, số lần khởi động lại, sức khoẻ, tool, nút / trang, việc theo lịch + "Chạy ngay", địa chỉ webhook + "Đổi mã", sự kiện, 200 dòng nhật ký), **Giới thiệu** (gói, nguồn, thư mục, quyền).

Plugin chạy chương trình trên máy bạn với quyền của bạn. Quyền bạn duyệt chỉ giới hạn những gì plugin làm **qua stag.ai** (gõ vào agent, đọc vault…), không phải mọi thứ worker làm được. Chỉ cài từ nguồn bạn tin.

## Gói plugin

`package.json` có mục `stagPlugin` (tên khoá theo manifest của Paperclip):

```json
{
  "name": "stag-plugin-hello",
  "version": "1.0.0",
  "type": "module",
  "stagPlugin": {
    "id": "stag.hello",
    "apiVersion": 1,
    "displayName": "Hello",
    "description": "…",
    "author": "…",
    "capabilities": ["agent.tools.register", "ui.sidebar.register", "events.subscribe", "plugin.state.read", "plugin.state.write"],
    "entrypoints": { "worker": "./worker.mjs", "ui": "./ui" },
    "instanceConfigSchema": { "type": "object", "properties": { "greeting": { "type": "string", "title": "Lời chào", "default": "Xin chào" } } },
    "tools": [{ "name": "word_count", "displayName": "Đếm từ", "description": "Count the words…", "parametersSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }],
    "events": ["task.done"],
    "jobs": [{ "key": "summary", "displayName": "Tổng kết", "schedule": "0 * * * *" }],
    "webhooks": [{ "endpointKey": "ping", "displayName": "Ping" }],
    "ui": {
      "slots": [
        { "type": "sidebar", "id": "hello", "displayName": "Chào", "action": "hello" },
        { "type": "page", "id": "home", "displayName": "Hello", "path": "index.html" }
      ]
    }
  }
}
```

Mẫu đầy đủ: `examples/stag-plugin-hello` (tool, nút gọi worker, nút mở địa chỉ, tab trang riêng, trang cài đặt riêng, sự kiện, dữ liệu riêng, việc theo lịch, webhook).

| Khoá | Ghi chú |
| --- | --- |
| `id` | `a-z0-9._-`, 2–64 ký tự, không dùng `stag`, `claude`, `codex`, `terminal` |
| `entrypoints.worker` | Đường dẫn trong gói. Không có worker: plugin chỉ có nút mở địa chỉ / trang tĩnh |
| `entrypoints.ui` | Thư mục giao diện trong gói (slot `page` / `settingsPage`) |
| `instanceConfigSchema` | JSON Schema object; trường `string` / `number` / `integer` / `boolean`, `enum`, `default`, `minimum` / `maximum`, `format: "url" \| "textarea"`. Cấu hình lưu dạng chữ thường, không ghi token / mật khẩu |
| `tools` | Tên `a-z0-9_`. Agent thấy trong máy chủ MCP `stag` với tên `<id>__<tool>` (id đổi `.` `-` thành `_`), vd. `stag_hello__word_count`. Dùng được với Claude Code và Codex; không hỏi lại từng lần gọi (đã duyệt quyền) |
| `events` | `agent.session.started`, `agent.session.stopped`, `agent.waiting`, `task.started`, `task.done` |
| `jobs` | `{ key, displayName, description, schedule }`. `schedule` = cron 5 trường theo giờ máy (`*`, `*/n`, `a-b`, `a,b`; thứ 0 hoặc 7 = Chủ nhật) |
| `webhooks` | `{ endpointKey, displayName, description }`. App cho mỗi điểm một địa chỉ cục bộ có mã bí mật |
| `ui.slots` | Nút: `sidebar` (thanh bên), `globalToolbarButton` (thanh trên cùng), `agentMenu` (menu ⋯ của agent), mỗi nút có `open: { url, target: "browser" \| "external" }` (mẫu URL với `{config.x}`, `{workspace.name}`, `{workspace.path}`, `{workspace.id}`, `{agent.name}`, `{agent.id}`) hoặc `action` (gọi worker). Trang: `page` (tab cạnh Kanban / Agents / Artifacts, theo workspace đang xem), `settingsPage` (tab trong trang plugin ở Cài đặt → Plugin), có `path` = file `.html` trong `entrypoints.ui` (mặc định `index.html`) |

## Quyền

| Quyền | Cho phép |
| --- | --- |
| `ui.sidebar.register` | Slot `sidebar` |
| `ui.action.register` | Slot `globalToolbarButton`, `agentMenu` |
| `ui.page.register` | Slot `page` |
| `instance.settings.register` | Slot `settingsPage` |
| `agent.tools.register` | `tools` |
| `events.subscribe` | `events` |
| `agents.read` | `ctx.agents.list()` |
| `agent.sessions.send` | `ctx.agents.send(agentId, text)` — gõ vào terminal của agent |
| `board.read` | `ctx.board.list(workspaceId)` |
| `vault.read` / `vault.write` | `ctx.vault.read / write(workspaceId, path, …)` |
| `plugin.state.read` / `plugin.state.write` | `ctx.state.get / set / delete(key, scope?)` (`userData/plugins/state/<id>.json`, tối đa 5 MB) |
| `ui.notify` | `ctx.notify(title, body)` — thông báo Windows |
| `jobs.schedule` | `jobs` |
| `webhooks.receive` | `webhooks` |
| `http.outbound` | Chỉ là khai báo (worker là chương trình Node, tự gọi mạng được) |

## Worker

Chạy trong Electron `utilityProcess` (tiến trình Node riêng). Nói JSON-RPC 2.0 qua kênh tin nhắn của tiến trình. SDK không phụ thuộc gì: `examples/stag-plugin-sdk/index.mjs` (chép vào plugin của bạn), tên hàm theo SDK của Paperclip:

```js
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

runWorker(
  definePlugin({
    async setup(ctx) {
      ctx.tools.register('word_count', async ({ text }, run) => ({ content: `${text.split(/\s+/).length} words` }))
      ctx.actions.register('hello', async (params, run) => ({ message: 'Xin chào' })) // hoặc { openUrl, target }
      ctx.events.on('task.done', async (e) => ctx.logger.info(e.agentName, e.data.title))
      ctx.data.register('stats', async (params, run) => ({ done: 3 }))      // trang: host.getData('stats')
      ctx.jobs.register('summary', async (job) => {})                     // job.key, job.runId, job.trigger
      ctx.webhooks.register('ping', async (req) => ({ status: 200, body: { ok: true } }))
      ctx.streams.emit('feed', { text: 'hi' })                             // đẩy tới trang đang mở: host.on('feed')
    },
    async onValidateConfig(config) { return { ok: true } }, // { ok: false, errors: [...] } để từ chối
    async onConfigChanged(config) {},
    async onHealth() { return { status: 'ok' } }
  })
)
```

- Host → worker: `initialize`, `health` (30 giây / lần), `validateConfig`, `configChanged`, `shutdown`, `onEvent` (thông báo, xử lý lần lượt), `executeTool`, `performAction`, `getData`, `runJob`, `handleWebhook`.
- Worker → host: `config.get`, `state.*`, `agents.list`, `agent.sessions.send`, `board.list`, `vault.read`, `vault.write`, `notify`; thông báo `log`, `streams.emit`. Thiếu quyền → lỗi `-32001`.
- `run` (ngữ cảnh lần gọi): `workspaceId`, `workspaceName`, `workspacePath`, `agentId`, `agentName`.
- stdout / stderr của worker vào nhật ký. Worker thoát bất ngờ → khởi động lại (1 s, 2 s, 3 s); quá 3 lần trong 10 phút → "Lỗi", bấm "Khởi động lại" sau khi sửa.

## Trang của plugin

File trong `entrypoints.ui` mở trong iframe cách ly (`sandbox` không có `allow-same-origin`): trang không thấy `window.stag`, không đọc được DOM / bộ nhớ của app, không có `localStorage`. App phục vụ file qua `stag-plugin://<id>/<file>` với CSP: chỉ tải file của chính gói, gọi mạng (`fetch`, ảnh ngoài) chỉ khi plugin có quyền `http.outbound`, không nhúng khung khác, không tự điều hướng ra trang web. Trang chỉ mở được khi plugin đã duyệt quyền và đang bật.

SDK của trang do app phục vụ sẵn ở `/__stag/ui.js` (kèm màu của app ở `/__stag/ui.css`):

```html
<link rel="stylesheet" href="/__stag/ui.css" />
<script type="module">
  import { host } from '/__stag/ui.js'
  const ctx = await host.ready // { pluginId, slotId, slotType, workspace: { id, name, path } | null, theme, locale }
  const stats = await host.getData('stats') // worker: ctx.data.register
  await host.action('hello', { a: 1 }) // worker: ctx.actions.register
  host.on('feed', (data) => {}) // worker: ctx.streams.emit('feed', data)
  host.onContext((ctx) => {}) // người dùng đổi workspace
  await host.toast('Xong') // lời nhắn ở góc app
  await host.openUrl('https://…', 'browser') // trình duyệt trong app, hoặc 'external'
</script>
```

Còn có `host.config.get()`, `host.state.get / set / delete`, `host.agents.list / send`, `host.board.list()`, `host.vault.read(path) / write(path, content)`, `host.notify(title, body)` — cùng quyền như worker. Ngữ cảnh (workspace) do app điền, trang không tự khai. Trang cài đặt (`settingsPage`) tự cao theo nội dung.

## Việc theo lịch

App kiểm 15 giây / lần, chạy `runJob` khi tới giờ (giờ máy). Chỉ chạy khi app đang mở và plugin đang chạy; lỡ giờ (máy ngủ) thì chạy bù một lần rồi tính lịch tiếp; không chạy chồng một việc đang chạy; hết 10 phút là lỗi. Trạng thái → Việc theo lịch: lịch dễ đọc, lần tới, lần trước, "Chạy ngay", 30 lần chạy gần nhất.

## Webhook

Máy chủ webhook riêng của plugin, chỉ nghe `127.0.0.1`, cổng giữ nguyên giữa các lần mở app (`userData/plugins/webhooks.json`):

```
POST http://127.0.0.1:<cổng>/plugins/<id>/webhooks/<endpointKey>?token=<mã>
```

Mã bí mật mỗi plugin (cũng nhận ở header `Authorization: Bearer <mã>`), lưu trong `userData/plugins/registry.json`, "Đổi mã" để thu hồi địa chỉ cũ. Thân tối đa 1 MB; `Content-Type` JSON thì worker nhận thêm `parsedBody`. Worker trả `{ status, body }` (mặc định 200 `{ ok: true }`); sai mã / không có điểm nhận → 404; plugin không chạy → 503; worker lỗi → 500; 30 lần nhận gần nhất ở trang Trạng thái. Dịch vụ ngoài Internet cần một tunnel (cloudflared, ngrok…) trỏ về địa chỉ này.

## Chưa có

- Widget, ô mới trong lưới agent, mục trên thanh trạng thái.
- Cấu hình dạng bí mật (dùng Cài đặt → Secrets sau này), danh mục plugin, kiểm SHA-256.
- Chạy plugin viết cho Paperclip (giao thức worker khác; chỉ tên manifest / quyền giống).
