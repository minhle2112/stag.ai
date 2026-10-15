// Chuỗi giao diện tiếng Việt (nguồn), namespace `scope`. Tham số dạng {tên}.
export default {
  title: 'Khoá phạm vi',

  // ScopeAskDialog (Codex: app hỏi người dùng)
  'ask.allow': 'Cho sửa',
  'ask.wantsRun': 'Agent {name} muốn chạy lệnh có thể sửa {file}:',
  'ask.wantsEdit': 'Agent {name} muốn sửa:',
  'ask.holderPlace': 'Chỗ đó thuộc việc {title} của agent {holder} (phạm vi {entry}), việc đó chưa xong.',
  'ask.holderFile': 'File này thuộc việc {title} của agent {holder} (phạm vi {entry}), việc đó chưa xong.',
  'ask.notePlace':
    'Cho sửa thì {name} sửa được chỗ đó tới hết phiên mà không hỏi lại. Lệnh shell được đoán theo chữ trong lệnh, có thể báo thừa. Agent đang chờ bạn trả lời (tự từ chối sau khoảng {minutes} phút).',
  'ask.noteFile':
    'Cho sửa thì {name} sửa được file này tới hết phiên mà không hỏi lại. Lệnh shell được đoán theo chữ trong lệnh, có thể báo thừa. Agent đang chờ bạn trả lời (tự từ chối sau khoảng {minutes} phút).',
  'ask.more': '{label} (+{count} chỗ khác)',

  // Cài đặt → Khoá phạm vi
  desc: 'Mỗi việc đang mở của agent giữ một vùng code: phạm vi agent khai khi nhận việc (task_start) cộng các file agent đó đã sửa. Agent khác định sửa vào vùng đó thì app làm theo chế độ dưới đây; việc xong hoặc bị bỏ thì nhả khoá. Thay đổi có tác dụng ngay, cả với phiên đang chạy.',
  'mode.ask': 'Hỏi bạn',
  'mode.askDesc': 'Claude hỏi ngay trong terminal của nó (hộp xin quyền, kèm lý do); Codex: app hiện hộp thoại, chờ bạn cho sửa hay từ chối.',
  'mode.block': 'Chặn luôn',
  'mode.blockDesc':
    'Không bao giờ hỏi bạn: agent bị từ chối và tự bàn với agent kia (xem việc của nó, nhắn nhờ thu hẹp phạm vi hay báo khi xong), trong lúc chờ thì làm phần khác của việc mình.',
  'mode.warn': 'Chỉ cảnh báo',
  'mode.warnDesc': 'Cho sửa. Vẫn cảnh báo agent khi nhận việc trùng phạm vi.',
  'mode.off': 'Tắt',
  'mode.offDesc': 'Không khoá, không cảnh báo.',
  'mode.label': 'Khi agent định sửa vào phạm vi của agent khác',
  'mode.desc': 'Chế độ tính theo agent đang định sửa. Rê chuột vào từng chế độ để xem nghĩa.',
  parentWs: 'workspace {name}',
  parentApp: 'mặc định của app',
  on: 'bật',
  off: 'tắt',
  'shell.label': 'Đoán lệnh shell',
  'shell.labelFor': 'Đoán lệnh shell cho {name}',
  'shell.desc':
    'Lệnh Bash / PowerShell (Codex: exec_command) có dấu hiệu ghi (>, rm, mv, cp, Set-Content, sed -i, git checkout…) và nhắc tới đường dẫn đang bị khoá thì coi như sửa chỗ đó. Chỉ là đoán: bỏ sót script hoặc lệnh không ghi rõ đường dẫn, đôi khi hỏi thừa lệnh chỉ đọc file bị khoá. Tắt thì chỉ xét tool sửa file (Edit / Write, apply_patch).',
  'shell.descAgent': 'Cấp agent theo {parent}.',
  'exempt.title': 'Không bao giờ khoá',
  'exempt.tip':
    'Agent luôn sửa được các chỗ này, phạm vi trùng ở đây cũng không bị cảnh báo. Mẫu viết như phạm vi việc, tương đối so với thư mục dự án, không phân biệt hoa thường: docs/, package-lock.json, **/*.snap (mọi thư mục), *.md (chỉ ở gốc dự án).',
  'exempt.tipWs': 'Cộng thêm với danh sách của app.',
  'exempt.vaultTip': 'Bộ nhớ chung: agent nào cũng ghi log / index',
  'exempt.vaultFallback': 'vault của workspace',
  'exempt.appData': 'Dữ liệu của app / git',
  'exempt.fromApp': 'Từ mặc định của app',
  'exempt.from': 'Từ {parent}',
  'exempt.agentNote': 'Danh sách miễn khoá đặt ở cấp app và workspace.',
  'exempt.outside': '{name} (ngoài dự án)',
  'exempt.badPattern': 'Không đọc được mẫu này (đường dẫn ngoài dự án?).',
  'exempt.wholeProject': 'Mẫu này là cả dự án. Muốn bỏ khoá hẳn thì chọn chế độ "Tắt".',
  'exempt.dup': 'Đã có trong danh sách.',
  'exempt.removeAria': 'Bỏ {pattern}',
  'exempt.removeTip': 'Bỏ mẫu này',
  'exempt.newAria': 'Mẫu miễn khoá mới',
  'exempt.placeholder': 'vd. docs/ hoặc **/*.snap'
} as const
