---
type: decision
date: {{DATE}}
---
# Quyết định: Vault là bộ nhớ chính

Quay lại: [[_INDEX]] · [[Memory Protocol]]

## Bối cảnh
Dự án {{PROJECT}} làm việc qua nhiều phiên và nhiều agent. Cần một nơi lưu kiến thức lâu dài mà người dùng đọc/sửa được, không phụ thuộc ngữ cảnh của từng phiên.

## Quyết định
Vault Obsidian `{{VAULT_DIR}}/` trong thư mục dự án là **bộ nhớ chính (source of truth)**. Auto memory của Claude Code chỉ là **cache ngắn** trỏ về vault. Mâu thuẫn → vault thắng. Mọi phiên phải recall `_INDEX.md` trước khi làm.

## Lý do
- Người dùng đọc/sửa trực tiếp trong Obsidian, có link giữa các note.
- Nằm cạnh code, độc lập với công cụ AI cụ thể.

## Phương án đã loại
- Chỉ dùng auto memory của Claude Code: khó đọc/sửa, gắn với một công cụ.

## Ảnh hưởng
- Vault và `.obsidian/` không lên git.
- Đổi tên/di chuyển vault phải sửa đường dẫn ở `CLAUDE.md`, [[Memory Protocol]] và cache.
