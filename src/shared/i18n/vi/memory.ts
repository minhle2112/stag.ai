// Chuỗi giao diện tiếng Việt (nguồn), namespace `memory`. Tham số dạng {tên}.
export default {
  // Cài đặt → Vault & bộ nhớ
  title: 'Vault & bộ nhớ',
  desc: 'Mỗi workspace có một vault (thư mục note markdown) làm bộ nhớ, tạo từ bộ mẫu dưới đây. Agent đọc / sửa vault qua tool của app; app tự ghi việc agent làm xong vào vault, và giữ note riêng của từng agent gọn trong hạn mức.',
  on: 'bật',
  off: 'tắt',
  kb: '{n} KB',
  days: '{count} ngày',
  daysSuffix: 'ngày',
  // Chế độ tool
  'tools.full': 'Đọc và ghi',
  'tools.fullDesc':
    'Agent đọc, tìm, sửa, đổi tên note qua app (memory_read, memory_search, memory_patch, memory_move…). App chặn ghi bí mật và không cho ghi đè thay đổi của người khác.',
  'tools.read': 'Chỉ đọc',
  'tools.readDesc': 'Agent đọc và tìm qua app; muốn ghi thì agent tự sửa file note như trước.',
  'tools.off': 'Tắt',
  'tools.offDesc': 'Không có tool memory_*: agent tự đọc / sửa file trong vault bằng công cụ file của nó.',
  // Mẫu
  'tpl.group': 'Mẫu',
  'tpl.label': 'Template vault',
  'tpl.desc': 'Cấu trúc vault, CLAUDE.md, luật phiên của agent. Sửa bản trong thư mục này sẽ thay bản có sẵn của app (theo từng file).',
  'tpl.open': 'Mở thư mục mẫu',
  // Tool bộ nhớ
  'agentTools.group': 'Tool bộ nhớ cho agent',
  'agentTools.label': 'Agent dùng vault qua app',
  // Nhật ký việc
  'workLog.group': 'Nhật ký việc',
  'workLog.label': 'Ghi việc xong vào nhật ký ngày',
  'workLog.desc':
    'Mỗi việc agent làm xong (task_done), giao cho agent khác (agent_handoff) hoặc bạn đánh dấu xong (menu ⋯ của agent) → một dòng trong 40 Log/<ngày>.md của vault, mục "Agent work (auto)": tên việc, agent, giờ, một dòng tiếng Anh agent viết, phạm vi. Chỉ ghi vào vault có cấu trúc của stag.ai.',
  'workDone.label': 'Ghi vào mục "Work done" của note agent',
  'workDone.desc': 'Cùng lúc đó thêm một dòng vào mục "Work done" trong 60 Agents/<tên agent>.md, để agent nhớ mình đã làm gì.',
  // Note bộ nhớ của agent
  'note.group': 'Note bộ nhớ của agent',
  'note.budget': 'Hạn mức note',
  'note.budgetDesc':
    'Note quá hạn mức → app chuyển các dòng "Work done" cũ sang 60 Agents/<tên> archive.md (không tốn quota). Vẫn quá thì phiên sau agent được nhờ tự viết gọn phần còn lại.',
  'note.keep': 'Giữ lại bao nhiêu dòng "Work done"',
  'note.keepDesc': 'Khi cất, giữ lại chừng này dòng mới nhất trong note.',
  'note.keepLabel': 'Số dòng "Work done" giữ lại',
  // _INDEX.md
  'index.group': '_INDEX.md của vault',
  'index.archive': 'Dời mục đã xong cũ ra khỏi _INDEX',
  'index.archiveDesc':
    '_INDEX.md được mọi phiên agent đọc đầu tiên. Khi nó quá hạn mức, app chuyển các mục đã xong ("- [x]") cũ trong mục "Open items" sang _INDEX archive.md (trong 00 Meta/), nhóm theo ngày. Mục chưa xong ("- [ ]") luôn ở lại. Theo app → workspace.',
  'index.budget': 'Hạn mức _INDEX',
  'index.budgetDesc': 'Chỉ dời khi _INDEX.md lớn hơn chừng này.',
  'index.keepDays': 'Giữ mục đã xong (ngày)',
  'index.keepDaysDesc':
    'Mục đã xong có ngày (YYYY-MM-DD) mới nhất ghi trong mục nằm trong chừng này ngày thì vẫn giữ trong _INDEX. Mục không ghi ngày nào coi là cũ.',
  'index.clean': 'Dọn ngay',
  'index.cleanDescWs': 'Dời ngay các mục đã xong cũ (theo số ngày ở trên) khỏi _INDEX.md của workspace này, không chờ quá hạn mức.',
  'index.cleanDescAll':
    'Dời ngay các mục đã xong cũ khỏi _INDEX.md của mọi workspace (mỗi workspace theo cài đặt của nó; workspace đang tắt tính năng này thì bỏ qua), không chờ quá hạn mức.',
  'index.cleaning': 'Đang dọn…',
  'index.cleanAll': 'Dọn mọi workspace',
  'index.skipped': '{name}: bỏ qua ({reason})',
  'index.moved': '{name}: đã dời {count} mục, _INDEX còn {kb} KB',
  'index.nothing': '{name}: không có mục nào đủ cũ để dời ({kb} KB)',
  'index.noWorkspaces': 'Không có workspace nào.',
  note: 'Agent không tự ghi lại dòng "xong việc" nữa, chỉ ghi điều đáng nhớ (quyết định, lỗi gặp, bài học). Hạn mức note được kiểm khi phiên agent mở và sau mỗi việc xong. Đổi chế độ tool bộ nhớ có tác dụng từ phiên agent mở sau (phiên đang chạy gọi tool đã tắt thì nhận lỗi).'
} as const
