# stag.ai

App desktop điều hành một đội agent AI viết code như một công ty (kiểu Paperclip: vai trò, ticket, heartbeat, hạn mức chi), hiển thị theo không gian làm việc nhiều ô (kiểu BridgeMind). Tính năng cốt lõi: mỗi workspace tự có một vault Obsidian làm bộ nhớ.

**Ngôn ngữ trao đổi: tiếng Việt.**

## Memory (BẮT BUỘC)
- Vault: `C:\Users\piopy\Desktop\stag.ai\stag.ai memory`
- **Vault là bộ nhớ chính**; auto memory của Claude Code chỉ là cache trỏ về vault. Mâu thuẫn → vault thắng.
- **Mọi phiên phải đọc `stag.ai memory/_INDEX.md` (rồi các note liên quan) trước khi làm bất cứ việc gì.**
- Học được điều mới (quy ước, lỗi, quyết định, việc xong) → ghi vào vault theo `stag.ai memory/00 Meta/Memory Protocol.md`.
- **Vault viết hoàn toàn bằng tiếng Anh** (tên file, thư mục, frontmatter, tiêu đề, nội dung) — người dùng chốt 2026-10-08. Trao đổi với người dùng vẫn bằng tiếng Việt.
- **Không lưu mật khẩu / API key / token** trong vault.
