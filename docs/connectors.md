# Connector (MCP) và Secrets

Connector = máy chủ MCP app đưa vào phiên agent (Cài đặt → Connector). Token / API key cất ở Cài đặt → Secrets.

Trang Connector có 3 mục, bố cục theo trang Connectors của Paperclip:

- **Danh mục** — 60 dịch vụ (tìm theo tên), nút **Kết nối** mở hộp 2 bước: (1) agent nào được dùng: mọi agent / một workspace / vài agent chọn tay; (2) cách kết nối. Cuối danh sách: **Kết nối công cụ riêng** (tự cấu hình / dán JSON).
- **Đã kết nối** — connector đã có + máy chủ có sẵn của Claude Code / Codex, bật / tắt theo cấp.
- **Duyệt** — lần gọi tool đang chờ bạn đồng ý.

## Danh mục

Tạo bằng `node scripts/import-connector-catalog.mjs <node_modules của Paperclip>` từ định nghĩa app của Paperclip (`@paperclipai/shared`, MIT) + logo LobeHub (MIT), xem `src/renderer/src/assets/connectors/LICENSES.md`. Chỉ giữ cách kết nối chạy được ngoài Paperclip Cloud:

| Cách | Nghĩa |
| --- | --- |
| `oauth` | Đăng nhập trong trình duyệt; app tự đăng ký client (RFC 7591) |
| `oauth-app` | OAuth app của bạn (client ID / secret, khai báo `http://127.0.0.1:47621/oauth/callback`); bỏ trống client ID thì app thử tự đăng ký |
| `key` | API key gửi trong header (có thể có tiền tố, vd. `Token token=`) |
| `none` | Không cần đăng nhập (có thể có ô điền vào URL, vd. tên cửa hàng Shopify) |
| `url` | Dán URL bạn tạo ở trang dịch vụ (Zapier); URL có token nên cất ở Secrets |
| `stdio` | Chạy trên máy bằng npx (Playwright, Filesystem — thêm của stag.ai) |

Bỏ: cách chỉ chạy qua Paperclip Cloud (GitHub managed, Google "Paperclip" read/write), kênh chat (Slack/Discord/Telegram bot), khoá API của nhà cung cấp AI (đó là việc của Adapter).

## Đăng nhập OAuth

`src/main/oauth.ts`: tìm máy chủ xác thực (RFC 9728 → RFC 8414, hoặc endpoint danh mục ghi sẵn), đăng ký client hoặc dùng client của bạn, PKCE + `state`, mở trình duyệt mặc định, nhận mã ở `http://127.0.0.1:47621/oauth/callback` (tối đa 5 phút, huỷ được). Token + client cất thành bí mật `OAUTH_<ID>`. Trước mỗi phiên agent / lần thử kết nối app làm mới token nếu còn dưới 5 phút; không làm mới được → phiên không mở, báo "Đăng nhập lại". Phiên rất dài có thể gặp token hết hạn giữa chừng (mở phiên mới).

## Duyệt

Tool connector ở mức **Hỏi trước** trong phiên **Claude Code**: hook PreToolUse (timeout 600 s) giữ lời gọi lại, hiện ở mục Duyệt (kèm tham số), thông báo nổi ở màn hình chính và số đếm cạnh mục Connector. **Cho phép** (một lần), **Luôn cho phép** (tool chuyển sang Tự cho phép), **Từ chối** (agent nhận lý do, không thử lại). Quá 9 phút không ai duyệt → Claude hỏi trong terminal như thường. Phiên đóng → câu hỏi bị huỷ. Codex tự hỏi trong terminal của nó.

## Hai loại máy chủ

| Loại | Ai nạp | App làm gì |
| --- | --- | --- |
| **Connector của stag.ai** | App, cho Claude Code, Codex và adapter ngoài có `mcpConfigFlag` | Thêm / sửa / gỡ, thử kết nối, mức cho từng tool |
| **Có sẵn trong Claude Code / Codex** (claude.ai, plugin, `claude mcp add`, `.mcp.json`, `~/.codex/config.toml`) | Chính CLI | Chỉ tắt bớt cho phiên agent; nút "Chép" biến máy chủ `user` / `local` / `.mcp.json` / Codex thành connector của stag.ai |

Bật / tắt theo cấp **app → workspace → agent** (cấp sau thắng). Connector của stag.ai: cấp app = công tắc `enabled`; máy chủ có sẵn: mặc định bật.

## Dịch sang từng CLI

**Claude Code** — khi phiên có connector hoặc tắt máy chủ có sẵn, app viết hai file riêng trong `.sessions/` (xoá khi phiên đóng):

- `<phiên>.mcp.json` → `--mcp-config`: `stag` + connector. Bí mật viết dạng `${TÊN_BIẾN}` (Claude tự thay từ môi trường).
- `<phiên>.settings.json` → `--settings` (Claude chỉ nhận **một** `--settings`, nên ghép với file chung của app): `permissions.allow` / `ask` / `deny` = `mcp__<id>` / `mcp__<id>__<tool>`, `deniedMcpServers` = máy chủ có sẵn bị tắt (kể cả `claude.ai …`).

**Codex** — tham số `-c`:

```
mcp_servers.<id>.command / args / env (chữ thường) / env_vars (biến mang bí mật)
mcp_servers.<id>.url / bearer_token_env_var / http_headers / env_http_headers
mcp_servers.<id>.default_tools_approval_mode="approve"     (mặc định "Tự cho phép")
mcp_servers.<id>.disabled_tools=[…]                         (tool "Chặn")
mcp_servers.<id>.tools.<tool>.approval_mode="approve"|"prompt"
mcp_servers.<tên có sẵn>.enabled=false                      (chỉ khi tên đó có trong config.toml)
```

**Adapter ngoài** có `mcpConfigFlag`: nhận file `<phiên>.mcp.json` như Claude.

Trên Windows, lệnh `.cmd` / `.bat` (npx, npm, pnpm…) tự được bọc `cmd /c` vì cả hai CLI không chạy thẳng được.

## Bí mật

- Lưu ở `userData/secrets.json`, mỗi giá trị mã hoá bằng Electron `safeStorage` (DPAPI, gắn với tài khoản Windows). Giao diện chỉ thấy tên; không đọc lại được giá trị.
- Truyền cho phiên qua biến môi trường, không trên dòng lệnh, không trong file cấu hình, không trong vault:
  - stdio: biến `KEY` của máy chủ đặt thẳng vào môi trường phiên (Claude `"KEY": "${KEY}"`, Codex `env_vars = ["KEY"]`). Hai connector đặt cùng biến với giá trị khác → phiên báo lỗi.
  - HTTP: Bearer → `STAG_SECRET_<TÊN>` (Claude `Authorization: Bearer ${STAG_SECRET_…}`, Codex `bearer_token_env_var`); header khác → `STAG_HDR_<ID>_<HEADER>` chứa cả tiền tố (Claude `${…}`, Codex `env_http_headers`); URL có token → `STAG_URL_<ID>` (Claude `url: "${…}"`; Codex không thay biến trong url nên URL nằm trên dòng lệnh của phiên, không ghi ra file).
- Agent đọc được bí mật trong phiên của nó (biến môi trường). Chỉ bật connector cho agent bạn tin.
- Thiếu bí mật connector cần → phiên không mở, báo rõ tên bí mật.

## Nhập

- **Dán JSON** dạng Claude Code / Cursor / VS Code (`mcpServers` hoặc `servers`). Giá trị env / header có tên giống token (KEY, TOKEN, SECRET, PASSWORD, AUTH…) và `Authorization: Bearer …` được tách thành bí mật `<ID>_<TÊN>`.
- **Chép** một máy chủ có sẵn của Claude Code / Codex (mục Đã kết nối).

## Chưa có

- Kiểu SSE cũ (app thử nối bằng Streamable HTTP).
- Duyệt trong app cho phiên Codex.
