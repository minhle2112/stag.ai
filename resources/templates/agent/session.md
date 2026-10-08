---
type: session
agent: {{AGENT}}
session: {{SESSION_ID}}
started: {{NOW}}
status: {{STATUS}}
---
# Phiên của {{AGENT}}

File này do stag.ai tạo khi mở phiên, cập nhật khi agent gọi task_start / task_update / task_done, và xoá khi đóng phiên. Điều cần giữ lâu dài phải ghi vào vault.

## Việc
{{TASK}}

## Phạm vi
{{SCOPE}}

## Bàn giao
{{HANDOFF}}
