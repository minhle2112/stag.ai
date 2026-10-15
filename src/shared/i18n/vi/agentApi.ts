// Chuỗi giao diện tiếng Việt (nguồn), namespace `agentApi`. Tham số dạng {tên}.
export default {
  // Cài đặt → Agent API (AgentApiSection.tsx)
  'desc': 'Agent dùng app thay bạn qua các tool agent_* của máy chủ MCP stag. Agent luôn xem được danh sách agent và các loại / model có trên máy (agent_list, adapter_models). Chỉ nên đồng ý những gì chính bạn đã nhờ agent làm.',
  'manage': 'Cho agent quản lý agent khác',
  'manageDesc': 'Bạn nhắn agent "tạo agent tên…, dùng model…, làm việc…" là nó làm được: tạo, đổi tên / vai trò / model / quyền, mở, dừng, xoá agent (agent_create, agent_update, agent_open, agent_stop, agent_delete); tạo project, đổi tên / mục tiêu project (project_create, project_update; agent không xoá được project). Có hỏi bạn trước hay không: xem công tắc "Hỏi bạn trước…" bên dưới.',
  'message': 'Cho agent nhắn agent khác',
  'messageDesc': 'agent_send: app gõ tin vào ô của agent nhận khi nó rảnh và bạn không đang gõ ở đó; tin ghi rõ là từ agent, không phải từ bạn. Có giới hạn số tin để hai agent không nhắn qua lại mãi. Gồm cả agent_handoff: giao việc đang làm cho agent khác (thẻ việc + phạm vi chuyển sang agent nhận, bản bàn giao gõ vào ô của nó; agent nhận chưa chạy thì mở phiên mới, việc này cần thêm quyền quản lý agent).',
  'read': 'Cho agent đọc trạng thái và nhật ký phiên của agent khác',
  'readDesc': 'agent_status: agent kia đang làm gì, % context, việc đang mở, việc xong gần nhất. agent_log: các lượt mới nhất trong phiên của agent kia (lời bạn, lời agent, lỗi, tuỳ chọn cả tool đã gọi), đã che key / token; không đọc đầu ra thô của terminal. Chỉ trong cùng workspace.',
  'confirmCreate': 'Hỏi bạn trước khi agent tạo, dừng, xoá, đổi quyền agent / project, gửi việc sang project khác hoặc chạy dev server',
  'confirmCreateDesc': 'Bật: hiện thẻ xác nhận khi agent tạo agent hoặc project, dừng / xoá agent, đổi quyền agent, gửi việc sang agent của project khác (từ Chung, vào Chung, hay cặp project đã "Luôn cho" thì không hỏi), gửi việc cho agent có quyền cao hơn nó, hoặc chạy dev server lần đầu (preview_start). Tắt: agent làm luôn mọi việc trên, không hỏi gì. Khoá phạm vi (sửa file của agent khác) có cài đặt riêng: Cài đặt → Khoá phạm vi.',
  'note': 'Tắt một nhóm: phiên mở sau không thấy các tool đó; phiên đang chạy gọi tới thì bị từ chối ngay. Agent biết có các tool này qua luật phiên, cập nhật từ phiên mới tiếp theo.'
} as const
