---
type: protocol
updated: {{DATE}}
---
# Memory Protocol

Quay lại: [[_INDEX]]

**Đường dẫn tuyệt đối của vault:** `{{VAULT_PATH}}`

## Vai trò
| Nơi | Vai trò | Ghi chú |
|---|---|---|
| Vault này (`{{VAULT_DIR}}/`) | **Bộ nhớ chính** (source of truth) | Mọi kiến thức lâu dài của dự án nằm ở đây |
| Auto memory của Claude Code (`{{AUTO_MEMORY_PATH}}`) | **Cache ngắn** | Chỉ trỏ về vault, nhắc recall |
| Mâu thuẫn giữa hai nơi | **Vault thắng** | Sửa cache cho khớp vault |

## Recall (bắt buộc)
1. Đầu mỗi phiên: đọc [[_INDEX]] trước tiên.
2. Đọc tiếp các note liên quan tới việc sắp làm (project, feature, decision, log gần nhất).
3. **Chưa recall thì không hành động dựa trên "trí nhớ".**

## Ghi nhớ
| Học được gì | Ghi vào đâu |
|---|---|
| Quy trình / quy ước / thủ thuật / lỗi đã gặp | [[Learnings]] hoặc note trong `30 Features/` |
| Xong việc có điều không hiển nhiên | `40 Log/<YYYY-MM-DD>.md` (theo [[40 Log/_Template|mẫu]]) |
| Quyết định quan trọng + lý do | `50 Decisions/<YYYY-MM-DD> <tên>.md` (theo [[50 Decisions/_Template|mẫu]]) |
| Điều riêng của một agent (vai trò, thói quen, việc dở) | `60 Agents/<tên agent>.md` |
| Thay đổi trạng thái việc đang mở | Mục "Đang mở" trong [[_INDEX]] |

Sau khi ghi: cập nhật cache auto memory nếu cần (chỉ con trỏ, không chép nội dung).

## Cấm
- **Không lưu mật khẩu / API key / token / bí mật** trong vault.

## Quy ước note
- Mọi note có frontmatter `type:` (index / protocol / project / workflow / feature / log / decision / agent) và `date:` hoặc `updated:`.
- Nối các note bằng `[[link]]`.

## Đổi tên / di chuyển vault
Nếu đổi tên hoặc di chuyển thư mục vault:
1. Mở lại vault trong Obsidian ("Open folder as vault").
2. Sửa đường dẫn trong `CLAUDE.md` ở gốc dự án, trong note này, và trong cache auto memory (`MEMORY.md`).

## Worktree
Vault chỉ nằm ở thư mục chính của dự án. Phiên chạy trong git worktree phải trỏ tới vault bằng đường dẫn tuyệt đối ở trên.

## Git
Vault và `.obsidian/` là dữ liệu cá nhân → nằm trong `.gitignore`, không lên GitHub.
