// Chuỗi giao diện tiếng Việt (nguồn), namespace `browser`. Tham số dạng {tên}.
export default {
  // BrowserPane: thanh tab
  'tab.new': 'Tab mới',
  'tab.newTip': 'Tab mới · Ctrl+T',
  'tab.close': 'Đóng tab',
  'tab.drivenBy': '{name} đang điều khiển',
  'pane.more': 'Thêm',
  'pane.collapse': 'Thu nhỏ pane',
  'pane.expand': 'Phóng to pane',
  'pane.close': 'Đóng · Ctrl+Shift+B',
  'pane.driving': 'đang điều khiển tab này',
  'pane.releaseToKeep': 'Thả chuột để giữ độ rộng này',
  'pane.resizeTip': 'Kéo để đổi độ rộng · nhấp đúp để về mặc định',

  // Nút Soi / Bình luận trên thanh địa chỉ
  'inspect.on': 'Bật Soi (Ctrl+Shift+C)',
  'inspect.off': 'Tắt Soi (Ctrl+Shift+C)',
  'comments.hide': 'Ẩn bình luận',
  'comments.fresh': '{count} trả lời mới',
  'comments.drafts': '{count} chờ gửi',
  'comments.open': '{count} đang mở',

  // Thanh địa chỉ
  'nav.back': 'Lùi',
  'nav.forward': 'Tới',
  'nav.reload': 'Tải lại',
  'nav.urlPlaceholder': 'Nhập URL',
  'devtools.closeTip': 'Đóng DevTools của tab này',
  'devtools.openTip': 'DevTools của tab · F12',
  'devtools.close': 'Đóng DevTools',
  'devtools.open': 'Mở DevTools',
  'key.count': '{count} mật khẩu cho {host} trong kho (agent dùng qua credential_fill)',
  'key.none': 'Chưa có mật khẩu cho {host}',

  // Menu ⋮
  'menu.devServer': 'Dev server của dự án…',
  'menu.external': 'Mở bằng trình duyệt ngoài',
  'menu.inspectSource': 'Tìm nguồn cho chế độ Soi…',
  'menu.clearData': 'Xoá cookie và dữ liệu trang',

  // Hỏi mở trang ngoài
  'ask.title': 'Agent muốn mở trang ngoài',
  'ask.always': 'Luôn cho trang này',
  'ask.wants': 'Agent {name} muốn mở:',
  'ask.note':
    'Cho phép thì agent dùng được mọi trang thuộc {origin} tới khi tắt app. "Luôn cho trang này" lưu origin vào Cài đặt → Trình duyệt (mọi agent, cả sau khi mở lại app). Agent đang chờ bạn trả lời (tự từ chối sau 2 phút).',

  // NewTabPanel
  'newTab.viewTerminal': 'Xem terminal',
  'newTab.devFailed': 'Không chạy được dev server',
  'newTab.starting': 'Đang khởi động dev server…',
  'newTab.opensWhenReady': 'Trang tự mở khi cổng {port} sẵn sàng.',
  'newTab.hint': 'Gõ địa chỉ ở trên, ví dụ {example}. Agent cũng mở tab ở đây khi dùng trình duyệt.',
  'newTab.projectDev': 'Dev server của dự án →',
  'newTab.savedIntro': 'Dev server của dự án. Lệnh chạy trong một ô terminal trên canvas khi bạn chọn.',
  'newTab.detectedIntro': 'Đã phát hiện dev server. Lệnh chạy trong một ô terminal trên canvas khi bạn chọn.',
  'newTab.port': 'cổng {port}',
  'newTab.running': '· đang chạy',
  'newTab.saved': '· đã lưu',
  'newTab.use': 'Dùng cái này',
  'newTab.savedTo': 'Lựa chọn được lưu vào {file} trong dự án.',
  'newTab.back': 'Quay lại duyệt web',

  // Lỗi khởi động dev server (main/devServer.ts → tab Browser)
  'dev.cancelled': 'Đã huỷ.',
  'dev.cellDeleted': 'Ô terminal của dev server đã bị xoá.',
  'dev.closed': 'Terminal đã đóng trước khi cổng {port} mở.',
  'dev.noCell': 'Ô terminal chưa mở được (mở workspace này ở tab Agent một lần rồi thử lại).',
  'dev.failed': 'Lệnh lỗi: {error}',
  'dev.timeout': 'Chờ {minutes} phút mà cổng {port} chưa mở. Xem log trong ô terminal; cổng trong {file} có đúng không?'
} as const
