import type { AgentKind, PermissionMode } from '@shared/types'

/** Mức quyền theo CLI của agent (main đổi sang cờ của từng CLI, xem agents.ts / codex.ts). */
export function permissionModes(kind: AgentKind): Array<{ id: PermissionMode; label: string; hint: string }> {
  if (kind === 'codex')
    return [
      { id: 'default', label: 'Theo cài đặt Codex', hint: 'Như khi bạn tự chạy codex (~/.codex/config.toml).' },
      { id: 'acceptEdits', label: 'Tự sửa file', hint: 'Sửa trong thư mục dự án không cần hỏi; ra ngoài sandbox thì hỏi.' },
      { id: 'auto', label: 'Tự động', hint: 'Codex tự duyệt (approve-for-me), vẫn trong sandbox.' },
      { id: 'plan', label: 'Chỉ đọc', hint: 'Sandbox chỉ đọc: đọc và đề xuất, không sửa gì.' }
    ]
  return [
    { id: 'default', label: 'Theo cài đặt Claude Code', hint: 'Hỏi bạn như khi bạn tự chạy claude.' },
    { id: 'acceptEdits', label: 'Tự sửa file', hint: 'Sửa file không cần hỏi; chạy lệnh vẫn hỏi.' },
    { id: 'auto', label: 'Tự động', hint: 'Claude tự quyết, vẫn chặn việc rủi ro.' },
    { id: 'plan', label: 'Chỉ lập kế hoạch', hint: 'Đọc và đề xuất, không sửa gì.' }
  ]
}
