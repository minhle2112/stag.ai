# Skill

Skill = thư mục có `SKILL.md`: frontmatter `name` + `description`, rồi phần hướng dẫn (có thể kèm script, mẫu, tài liệu). Agent chỉ thấy tên + mô tả cho tới khi việc khớp, lúc đó mới mở `SKILL.md`. Quản lý ở Cài đặt → Skill (bố cục theo trang Skills của Paperclip).

- **Đã cài** — thư viện của stag.ai + skill Claude Code / Codex tự nạp. Bật / tắt theo cấp **app → workspace → agent** (cấp sau thắng; vắng = bật).
- **Khám phá** — danh mục kèm app; **Cài** = chép vào thư viện.
- **Tạo skill** — tên (a-z, 0-9, "-", tối đa 64 ký tự, cũng là tên thư mục) + mô tả, rồi sửa `SKILL.md` ngay trong app (Ctrl+S lưu). Đổi `name` trong frontmatter = đổi tên skill (bật / tắt ở mọi cấp đi theo).
- Menu ⋯ của agent → **Skill…** mở trang ở cấp agent đó.

## Thư viện của stag.ai

`userData/skills/<tên>/` (nguồn gốc mỗi skill ở `userData/skills/.stag-skills.json`). Thêm bằng:

| Cách | Ghi chú |
| --- | --- |
| Tạo skill | `SKILL.md` mẫu (When to use / Steps) |
| Nhập thư mục… | Một thư mục skill, hoặc thư mục chứa nhiều skill (tìm `SKILL.md` sâu 3 cấp). Tên lấy từ frontmatter; sai thì thử tên thư mục |
| Nhập .zip… | Như thư mục; từ chối file zip có đường dẫn `..` / tuyệt đối |
| Khám phá → Cài | Danh mục kèm app |
| Chép (skill có sẵn) | Chép skill của Claude Code / Codex để dùng cho CLI khác |

Không chép: link tượng trưng, `.git`, `node_modules`, `__pycache__`, `.venv`. Giới hạn mỗi skill: 400 file, 20 MB. Tên trùng skill đã có → bỏ qua, báo lại. Skill có `SKILL.md` lỗi (thiếu frontmatter / mô tả, tên khác thư mục) vẫn hiện để sửa nhưng không đưa vào phiên.

## Danh mục kèm app

`resources/skill-catalog/`, tạo bằng `node scripts/import-skill-catalog.mjs <node_modules của Paperclip>` từ `@paperclipai/skills-catalog` (MIT, giấy phép ở `resources/skill-catalog/LICENSE.md`). Chỉ giữ 7 skill dùng chung ngoài Paperclip: agent-browser, design-critique, doc-maintenance, github-pr-workflow, qa-acceptance, simplified-english, wireframe. Bỏ skill gọi API / CLI của Paperclip (issue-triage, task-planning, ramp…), release-announcement (có phần riêng của Paperclip), last30days (chạy script Python / Node). Frontmatter chỉ giữ `name` + `description`.

## Đưa vào phiên agent

Khi phiên mở, app chép các skill bật cho agent vào `userData/skill-sessions/<phiên>/.claude/skills/` (bản riêng của phiên: agent sửa cũng không hỏng thư viện; nằm ngoài dự án để agent khác cùng dự án không vô tình nạp). Phiên đóng → xoá; mở app → xoá hết bản cũ.

| CLI | Skill thư viện | Tắt skill có sẵn |
| --- | --- | --- |
| **Claude Code** | `--add-dir <thư mục phiên>` (Claude nạp `.claude/skills` của thư mục thêm, như skill dự án) | `skillOverrides: { "<tên>": "off" }` và `enabledPlugins: { "<plugin@marketplace>": false }` trong file `--settings` riêng của phiên |
| **Codex** | Mục "Skills from stag.ai" trong luật phiên (`developer_instructions`): tên, mô tả, đường dẫn `SKILL.md`; agent tự mở file khi việc khớp (Codex không có cách thêm thư mục skill cho một phiên) | `-c skills.config=[{name="<tên>",enabled=false}]` (giữ cả mục `[[skills.config]]` bạn tự khai trong `config.toml`, vì `-c` thay cả mảng) |
| **Adapter ngoài** | Như Codex, trong file luật phiên | — |

Claude tắt skill theo **tên**, nên không tách được hai skill cùng tên: skill thư viện trùng tên skill Claude Code tự nạp (user / claude.ai / dự án) thì phiên Claude dùng bản của Claude Code, bản thư viện chỉ vào phiên Codex / adapter ngoài. Trang Skill cảnh báo khi trùng; đổi tên nếu muốn dùng bản của stag.ai cho Claude.

## Skill có sẵn của CLI

- **Claude Code** — app đọc đĩa (không chạy claude): `~/.claude/skills` (user), `~/.claude/skills/synced/<tài khoản>/` (đồng bộ từ claude.ai), `<dự án>/.claude/skills`, skill của plugin đã bật (`~/.claude/plugins/installed_plugins.json` + `enabledPlugins` trong settings của bạn / dự án). Skill của plugin chỉ tắt được **cả plugin**.
- **Codex** — app hỏi chính Codex qua `codex app-server` (`skills/list`, không gọi model, ~0,6 s): `~/.codex/skills`, `~/.agents/skills`, `.agents/skills` / `.codex/skills` của dự án, skill hệ thống (imagegen, openai-docs, skill-creator…). Skill bạn đã tắt trong `config.toml` ghi "đã tắt trong config.toml của bạn".

Tắt ở đây chỉ áp dụng cho phiên agent của stag.ai, không sửa cấu hình của CLI.

## Chưa có

- Nhập từ git / GitHub.
- Sửa file khác ngoài `SKILL.md` trong app (dùng nút **Mở** thư mục).
- Skill do plugin của stag.ai mang theo (S4).
