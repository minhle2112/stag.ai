# {{PROJECT}}

_(Mô tả dự án 2–3 dòng.)_

**Ngôn ngữ trao đổi: tiếng Việt.**

## Memory (BẮT BUỘC)
- Vault: `{{VAULT_PATH}}`
- **Vault là bộ nhớ chính**; auto memory của Claude Code chỉ là cache trỏ về vault. Mâu thuẫn → vault thắng.
- **Mọi phiên phải đọc `{{VAULT_DIR}}/_INDEX.md` (rồi các note liên quan) trước khi làm bất cứ việc gì.** Chạy trong worktree thì dùng đường dẫn tuyệt đối ở trên.
- Học được điều mới (quy ước, lỗi, quyết định, việc xong) → ghi vào vault theo `{{VAULT_DIR}}/00 Meta/Memory Protocol.md`.
- **Vault viết hoàn toàn bằng tiếng Anh** (tên file, thư mục, frontmatter, tiêu đề, nội dung); trao đổi với người dùng vẫn theo ngôn ngữ ở trên.
- **Không lưu mật khẩu / API key / token** trong vault.
