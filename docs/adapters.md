# Adapter ngoài (alpha)

Adapter ngoài cho stag.ai chạy thêm một CLI AI khác (vd. Aider, OpenCode…) như một agent trong lưới, bên cạnh Claude Code, Codex và Terminal có sẵn. Cách làm giống "Install Adapter" của Paperclip: adapter là một **gói npm** hoặc một **thư mục** có mục `stagAdapter` trong `package.json`.

Cài ở **Cài đặt → Adapter → + Cài adapter**:

- **Gói npm**: tên gói + phiên bản (bỏ trống = `latest`). App chạy `npm install --ignore-scripts` vào `userData/adapters/npm`, nên script cài đặt của gói **không** được chạy.
- **Thư mục**: dùng tại chỗ, không chép. Sửa gói xong, bấm "Đọc lại gói" ở trang của adapter đó.

Adapter chạy chương trình trên máy bạn với quyền của bạn. Chỉ cài từ nguồn bạn tin.

## Khai báo `stagAdapter`

```json
{
  "name": "stag-adapter-aider",
  "version": "0.1.0",
  "stagAdapter": {
    "id": "aider",
    "label": "Aider",
    "description": "Pair programming trong terminal.",
    "command": "aider",
    "args": ["--no-auto-commits"],
    "versionArgs": ["--version"],
    "install": "pip install aider-chat",
    "homepage": "https://aider.chat",
    "models": [{ "id": "sonnet", "label": "Claude Sonnet" }, "gpt-4o"],
    "modelFlag": "--model",
    "rules": { "flag": "--read" },
    "prompt": null,
    "mcpConfigFlag": ""
  }
}
```

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `id` | có | a-z, 0-9, `-`, bắt đầu bằng chữ, 2–32 ký tự. Không được trùng `claude`, `codex`, `terminal`. |
| `label` | có | Tên hiện trong app. |
| `command` | có | Tên chương trình trong PATH (`aider`, tự thử `.exe`, `.cmd`, `.bat`), hoặc đường dẫn có `{pkg}` = thư mục gói (`{pkg}/bin/x.exe`). |
| `args` | | Tham số luôn truyền, có thể dùng `{pkg}` (vd. `["{pkg}/cli.js"]` khi `command` là `node`). |
| `versionArgs` | | Tham số để kiểm tra phiên bản; mặc định `["--version"]`. |
| `install` | | Lệnh cài gợi ý khi không tìm thấy chương trình. |
| `models`, `modelFlag` | | Gợi ý model và cờ chọn model. Không có `modelFlag` thì app không truyền model. |
| `rules` | | Cách đưa **luật phiên** (file .md app viết cho mỗi phiên: vai trò, vault, kanban…): `{ "flag": "--read" }` → `--read <file>`, hoặc `{ "env": "TEN_BIEN" }` → biến môi trường chứa đường dẫn file. |
| `prompt` | | Lời mở phiên mới: `{ "flag": "--message" }` hoặc `{ "positional": true }` (tham số cuối). Bỏ trống = không gửi. |
| `mcpConfigFlag` | | Nếu CLI đọc được file MCP kiểu Claude (`{ "mcpServers": { … } }`): cờ nhận đường dẫn file đó. Agent khi đó có tool `stag` (kanban, trình duyệt, bàn giao). |

Mỗi phiên, app chạy trong thư mục dự án:

```
<command> <args…> [modelFlag model] [rules.flag <file luật phiên>] [mcpConfigFlag <file mcp>] <tham số thêm của bạn> [lời mở]
```

kèm các biến môi trường `STAG_AGENT_ID`, `STAG_AGENT_NAME`, `STAG_SESSION_ID`, `STAG_WORKSPACE`, `STAG_TOKEN` và biến bạn thêm ở trang adapter.

## Giới hạn hiện tại (alpha)

- Không có hook trạng thái: thanh bên chỉ biết phiên đang chạy hay đã dừng, không biết agent đang chờ bạn.
- Không có "tiếp tục phiên trước", % context, tự bàn giao, khoá phạm vi.
- Model chọn ở cấp app cho cả adapter (chưa theo workspace / agent như Claude / Codex).

## Mẫu

`examples/stag-adapter-echo`: một CLI nhỏ bằng Node in ra những gì app truyền (model, luật phiên, MCP, lời mở) rồi nhắc lại điều bạn gõ. Cài bằng **Thư mục** → chọn thư mục đó, rồi thêm agent "Echo (mẫu)".
