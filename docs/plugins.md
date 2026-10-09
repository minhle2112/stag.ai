# Plugin (alpha)

Plugin mở rộng chính app stag.ai, theo kiểu plugin của Paperclip: thêm nút ở thanh bên / thanh trên cùng / menu ⋯ của agent, thêm tool cho agent, nghe sự kiện của app. Quản lý ở Cài đặt → Plugin.

- **Cài**: từ một thư mục (dùng tại chỗ, sửa xong bấm "Đọc lại gói") hoặc gói npm (`npm install --ignore-scripts` vào `userData/plugins/npm`).
- **Duyệt quyền**: plugin chỉ chạy sau khi bạn bấm "Duyệt và chạy". Bản mới xin thêm quyền → dừng, chờ duyệt lại ("Chờ duyệt quyền mới").
- **Bật / tắt** theo cấp app → workspace → agent. Tắt ở cấp app = dừng worker; tắt ở workspace / agent = ẩn nút, tool, sự kiện ở đó.
- Trang mỗi plugin: **Cấu hình** (form tự sinh từ `instanceConfigSchema`), **Trạng thái** (worker, PID, thời gian chạy, số lần khởi động lại, sức khoẻ, tool, nút, sự kiện, 200 dòng nhật ký), **Giới thiệu** (gói, nguồn, thư mục, quyền).

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
    "entrypoints": { "worker": "./worker.mjs" },
    "instanceConfigSchema": { "type": "object", "properties": { "greeting": { "type": "string", "title": "Lời chào", "default": "Xin chào" } } },
    "tools": [{ "name": "word_count", "displayName": "Đếm từ", "description": "Count the words…", "parametersSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }],
    "events": ["task.done"],
    "ui": { "slots": [{ "type": "sidebar", "id": "hello", "displayName": "Chào", "action": "hello" }] }
  }
}
```

Mẫu đầy đủ: `examples/stag-plugin-hello` (tool, nút gọi worker, nút mở địa chỉ, sự kiện, dữ liệu riêng).

| Khoá | Ghi chú |
| --- | --- |
| `id` | `a-z0-9._-`, 2–64 ký tự, không dùng `stag`, `claude`, `codex`, `terminal` |
| `entrypoints.worker` | Đường dẫn trong gói. Không có worker: plugin chỉ có nút mở địa chỉ |
| `instanceConfigSchema` | JSON Schema object; trường `string` / `number` / `integer` / `boolean`, `enum`, `default`, `minimum` / `maximum`, `format: "url" \| "textarea"`. Cấu hình lưu dạng chữ thường, không ghi token / mật khẩu |
| `tools` | Tên `a-z0-9_`. Agent thấy trong máy chủ MCP `stag` với tên `<id>__<tool>` (id đổi `.` `-` thành `_`), vd. `stag_hello__word_count`. Dùng được với Claude Code và Codex; không hỏi lại từng lần gọi (đã duyệt quyền) |
| `events` | `agent.session.started`, `agent.session.stopped`, `agent.waiting`, `task.started`, `task.done` |
| `ui.slots` | `sidebar` (thanh bên), `globalToolbarButton` (thanh trên cùng), `agentMenu` (menu ⋯ của agent). Mỗi slot có `open: { url, target: "browser" \| "external" }` (mẫu URL với `{config.x}`, `{workspace.name}`, `{workspace.path}`, `{workspace.id}`, `{agent.name}`, `{agent.id}`) hoặc `action` (gọi worker) |

## Quyền

| Quyền | Cho phép |
| --- | --- |
| `ui.sidebar.register` | Slot `sidebar` |
| `ui.action.register` | Slot `globalToolbarButton`, `agentMenu` |
| `agent.tools.register` | `tools` |
| `events.subscribe` | `events` |
| `agents.read` | `ctx.agents.list()` |
| `agent.sessions.send` | `ctx.agents.send(agentId, text)` — gõ vào terminal của agent |
| `board.read` | `ctx.board.list(workspaceId)` |
| `vault.read` / `vault.write` | `ctx.vault.read / write(workspaceId, path, …)` |
| `plugin.state.read` / `plugin.state.write` | `ctx.state.get / set / delete(key, scope?)` (`userData/plugins/state/<id>.json`, tối đa 5 MB) |
| `ui.notify` | `ctx.notify(title, body)` — thông báo Windows |
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
    },
    async onValidateConfig(config) { return { ok: true } }, // { ok: false, errors: [...] } để từ chối
    async onConfigChanged(config) {},
    async onHealth() { return { status: 'ok' } }
  })
)
```

- Host → worker: `initialize`, `health` (30 giây / lần), `validateConfig`, `configChanged`, `shutdown`, `onEvent` (thông báo, xử lý lần lượt), `executeTool`, `performAction`, `getData`.
- Worker → host: `config.get`, `state.*`, `agents.list`, `agent.sessions.send`, `board.list`, `vault.read`, `vault.write`, `notify`; thông báo `log`. Thiếu quyền → lỗi `-32001`.
- `run` (ngữ cảnh lần gọi): `workspaceId`, `workspaceName`, `workspacePath`, `agentId`, `agentName`.
- stdout / stderr của worker vào nhật ký. Worker thoát bất ngờ → khởi động lại (1 s, 2 s, 3 s); quá 3 lần trong 10 phút → "Lỗi", bấm "Khởi động lại" sau khi sửa.

## Chưa có

- Trang / tab riêng của plugin (UI trong khung), widget, ô mới trong lưới (S4b đầy đủ).
- Việc theo lịch, webhook (S4c).
- Cấu hình dạng bí mật (dùng Cài đặt → Secrets sau này), danh mục plugin, kiểm SHA-256.
- Chạy plugin viết cho Paperclip (giao thức worker khác; chỉ tên manifest / quyền giống).
