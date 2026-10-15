// Chuỗi giao diện tiếng Việt (nguồn), namespace `secrets`. Tham số dạng {tên}.
export default {
  // Kho bí mật (main/secrets.ts)
  'error.noCipher': 'Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu bí mật được.',
  'error.badName': 'Tên bí mật "{name}" không hợp lệ: chỉ chữ, số và "_", không bắt đầu bằng số.',
  'error.empty': 'Bí mật {name} đang trống.',
  'error.tooLong': 'Bí mật {name} dài quá {max} ký tự.',

  // Trang Kho bí mật (SecretsSection.tsx)
  'title': 'Kho bí mật',
  'desc': 'Token và API key cho connector. App mã hoá bằng Windows (gắn với tài khoản Windows của bạn), truyền cho phiên agent qua biến môi trường — không đưa lên dòng lệnh, không ghi vào cài đặt hay vault. Giá trị đã lưu không xem lại được, chỉ thay hoặc xoá.',
  'unavailable': 'Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu bí mật được. Connector cần bí mật sẽ không chạy.',
  'missing': 'Connector đang cần bí mật chưa lưu',
  'add': 'Thêm bí mật',
  'name': 'Tên',
  'nameDesc': 'Chữ, số và _ (vd. GITHUB_TOKEN). Trùng tên = thay giá trị cũ.',
  'value': 'Giá trị',
  'replace': 'Thay',
  'saved': 'Đã lưu ({count})',
  'empty': 'Chưa có bí mật nào.',
  'oauth': 'đăng nhập OAuth (app tự quản lý)',
  'savedAt': 'Lưu {time}',
  'usedBy': 'dùng bởi {list}',
  'unused': 'chưa connector nào dùng',
  'newValueFor': 'Giá trị mới cho {name}',
  'replaceValue': 'Thay giá trị',
  'inUse': 'Đang được dùng bởi {names}',
  'reallyDelete': 'Xoá thật',
  'note': 'Lưu ý: agent đọc được bí mật của connector trong phiên của nó (nằm trong biến môi trường của phiên). Chỉ bật connector cho agent bạn tin. File bí mật nằm ở thư mục dữ liệu của app (secrets.json), chép sang máy / tài khoản Windows khác sẽ không giải mã được.'
} as const
