# stag.ai — design v2 brief (shared by all 3 directions)

Static, clickable HTML mockups of the **stag.ai** desktop app (Electron, Windows 11, 1440×900 window target).
One self-contained `.html` file per direction: inline CSS + vanilla JS, no build step. Fonts from Google Fonts only.
No external images (draw icons as inline SVG; logos as coloured letter tiles). All UI text in **Vietnamese** (with diacritics).
Fake but realistic data (a project called `shop-api`, agents named Kiên, Lan, Minh, QA-bot…).

## What the app is
A desktop app that runs a team of AI coding agents (Claude Code, Codex CLIs installed on the user's machine, using the user's own login — no API key)
in a BridgeMind-style multi-cell workspace. Each workspace = a project folder with its own Obsidian vault as memory.
No tickets / org chart. Agents have a name, a "job" (persona), a model, permissions.

## Every design MUST show these screens / features (switchable via the app's own nav, all clickable)
1. **Workspaces** — list of projects (switch), "+ Workspace" (creates folder vault `<name> memory`, git init, opens in Obsidian).
2. **Agent list** (sidebar or equivalent) — each agent: name, adapter (Claude / Codex / Terminal / external), status dot + label, ctx %. Click to open its cell. Closing a cell ≠ deleting the agent.
3. **Agents grid (main screen)** — split cells (right / below), drag to swap. Cell types:
   - **CLI cell**: terminal-looking (monospace, Claude Code TUI feel), header with name, status, `ctx 42%`, model, menu ⋯ (Model & effort, Connector, Skill, rename, stop, new session).
   - **Chat cell** (new, "option B"): runs the same `claude` in stream-json; own chat UI — message bubbles, collapsible tool cards (Read / Edit / Bash), per-file diff, **Allow / Deny** permission card, exact context %, composer with @file, paste image, mic button, slash buttons (/compact, /model).
   - **Plain terminal cell**, **plugin widget cell** ("+ Widget"), and the **in-app browser** (localhost preview, URL bar, DevTools, agent-driven indicator) as a side pane or cell.
   Statuses (use these exact labels): `đang làm`, `đang chạy Edit`, `chờ bạn trả lời`, `cần bạn duyệt quyền`, `đang hỏi bạn`, `đang viết bàn giao`, `đang chuyển sang phiên mới`, `phiên đã dừng`. Waiting = amber, working = green pulse.
4. **Kanban** — 4 columns: `Đang hỏi việc`, `Đang làm`, `Chờ bạn`, `Xong`. Cards = agent task: title, agent, scope (folder), files edited, time. Tab shows a badge with count waiting.
5. **Artifacts** — files agents created/edited: list (search, group by file, agent, time, + / ~ markers) and a big preview pane (code with diff, image, PDF/doc page, HTML preview).
6. **Vault** (mini Obsidian) — file tree, rendered note with [[wikilinks]], backlinks, search, **graph view** (SVG nodes/edges), edit mode (Ctrl+E), live dots showing which agent is reading/writing which note, "Mở trong Obsidian".
7. **Memory & work log** — today's log `40 Log/2026-10-10.md` auto-written by the app from finished tasks; per-agent note "Work done"; memory budget bar (archives old items).
8. **Settings** page — sections: Chung · Adapter · Connector (MCP catalog with service tiles, OAuth "Kết nối") · Skill · Plugin · Secrets · Agent & bàn giao (handoff threshold %) · Khoá phạm vi · Agent API · Vault & bộ nhớ · Trình duyệt · Giọng nói · Dữ liệu · Giới thiệu. A **level switch: App → Workspace → Agent** (settings override per level). Show at least 2–3 sections fully drawn, others can be lighter.
9. **Overlays / dialogs** (triggerable by a button or shortcut in the mockup):
   - **Scope lock ask**: "Lan muốn sửa `src/orders/` đang thuộc việc của Kiên — Cho phép / Từ chối / Chỉ lần này".
   - **Agent API confirm card**: "Kiên muốn tạo agent mới *QA-bot* (Codex, gpt-5, quyền đọc) để viết test — Tạo / Sửa / Huỷ".
   - **Approval toast** (agent waiting for you).
   - **Handoff**: ctx reaching 80% → "đang viết bàn giao" → new session.
   - **Voice**: hold `Ctrl+Space` → floating overlay with waveform + live Vietnamese text preview ("sửa hàm tính phí ship cho đơn quốc tế… gửi").
   - **Create agent** dialog: name, job, adapter, model, effort, permission mode, scope folder, first task.
   - **Command palette** (Ctrl+K).
10. **Plugins** — a plugin tab page (e.g. "Nhật ký việc"), a widget in the grid, items in a bottom status bar.

## "Tiện ích" — each direction also proposes 3–5 NEW utilities
Fitting its own philosophy, clearly tagged with a small `mới` badge so the user can see what is proposed vs. existing.
Ideas pool (pick what fits, or invent): per-agent changeset + diff/revert (alternative to git worktree), "wait your turn" scope queue,
daily standup summary from the work log, cost/quota meter per agent (subscription usage), focus mode for one cell, broadcast a message to many agents,
session timeline/replay, git panel (branch, uncommitted per agent), agent templates/roster presets, notifications inbox, split-diff review queue before commit.

## Presentation
- At the very top-right of each mockup, a tiny unobtrusive "ⓘ" button that opens a panel listing: the design's philosophy (2–3 lines), the screens, and the new utilities proposed. (So the user can compare.)
- Must look like a real polished native app, not a web landing page. Dense where needed, readable at 13px.
- Make sure all nav works with no console errors. Keep the file < ~120 KB.
