// Chuỗi giao diện tiếng Việt (nguồn), namespace `inspect` (chế độ Soi). Tham số dạng {tên}.
export default {
  // InspectPanel (ngăn Bình luận)
  'panel.hide': 'Ẩn bình luận',
  'panel.empty': 'Chưa có bình luận.',
  'panel.pending': 'Chờ gửi',
  'panel.sent': 'Đã gửi',
  'panel.hideClosed': 'Ẩn {count} bình luận đã đóng',
  'panel.showClosed': 'Hiện {count} bình luận đã đóng',
  'panel.count': '{count} bình luận',
  'panel.elementGone': 'Phần tử này không còn trên trang',
  'draft.sendTip': 'Gửi {count} bình luận cho {name} trong một tin',
  'draft.gone': '{name} không còn trong workspace',
  'draft.removeTip': 'Xoá bình luận này',
  'draft.removeAria': 'Xoá bình luận #{id}',
  'thread.reopen': 'Mở lại',
  'thread.closeTip': 'Xong, đóng bình luận',
  'thread.closeAria': 'Đóng bình luận',
  'thread.you': 'Bạn',
  'thread.youInitial': 'B',
  'thread.waitBusy': 'Chờ {name} xong việc đang làm',
  'thread.waitSession': 'Chờ phiên của {name} mở',
  'thread.replying': '{name} đang trả lời',
  'thread.replyPlaceholder': 'Trả lời…',

  // Dòng hiển thị trong ô chat khi gõ gói tin
  'packet.one': 'Bình luận #{id} từ chế độ Soi',
  'packet.many': '{count} bình luận từ chế độ Soi ({ids})',

  // Lớp Soi trong trang (preload)
  'pin.queued': 'đang chờ agent',
  'pin.working': 'agent đang trả lời',
  'pin.new': 'có trả lời mới',
  'pin.read': 'đã xem',
  'pin.draft': '#{id} · chờ gửi: {title}',
  'pin.draftFor': '#{id} · chờ gửi cho {who}: {title}',
  'box.placeholder': 'Nhập bình luận…',
  'box.addTip': 'Thêm vào danh sách chờ gửi (Enter)',
  'box.whoTip': 'Gửi cho agent nào',
  'box.noAgent': 'Chưa có agent',
  'box.notOpen': 'chưa mở',
  'box.busy': 'đang bận',
  'box.noAgents': 'Workspace chưa có agent nào',
  'box.addFailed': 'Không thêm được bình luận: {message}',

  // Lỗi từ main (hiện ở ngăn / lớp Soi)
  'err.noWorkspace': 'Workspace không còn',
  'err.empty': 'Bình luận trống',
  'err.agentGone': 'Agent không còn trong workspace',
  'err.noElement': 'Thiếu phần tử',
  'err.groupAgentGone': '{name} không còn trong workspace: xoá hoặc chọn agent khác cho bình luận #{id}',

  // SourceSetupDialog (Tìm nguồn cho chế độ Soi)
  'setup.title': 'Tìm nguồn cho chế độ Soi',
  'setup.intro':
    'Để agent biết phần tử bạn bình luận đến từ file / dòng nào và sửa đúng chỗ. Không tìm được nguồn thì bình luận vẫn gửi kèm HTML, selector và ảnh.',
  'setup.loading': 'Đang xem dự án…',
  'setup.installedWp': 'Đã cài {file}. Tải lại trang để thấy nguồn.',
  'setup.copied': 'Đã chép {files}.',
  'setup.installFailed': 'Không cài được: {message}',
  'setup.askSent': 'Đã nhờ {name} thêm plugin vào file cấu hình.',
  'setup.askQueued': '{name} đang bận, lời nhờ sẽ được gõ khi agent rảnh.',
  'setup.askNoSession': 'Agent này chưa mở phiên. Mở phiên của agent rồi bấm lại.',
  'setup.notOpen': '(chưa mở)',
  'setup.copiedDone': 'Đã chép plugin vào .stag/inspect/',
  'setup.pluginDesc': 'Plugin nhỏ chỉ chạy khi {cmd}: gắn {attr} vào thẻ HTML. Bản build không đổi.',
  'setup.attr': 'data-stag-src="file:dòng"',
  'setup.copyAgain': 'Chép lại',
  'setup.copyStep': '1. Chép plugin vào dự án',
  'setup.askStep': '2. Nhờ agent gắn vào {file}',
  'setup.wpDone': 'Đã cài mu-plugin stag-inspect',
  'setup.wpDesc':
    'Mu-plugin {plugin} gắn nguồn cho block Gutenberg (bài #ID), template part và file template của theme (phân biệt child / parent theme), tắt cache trang. Chỉ chạy trên bản local / development / localhost, hoặc khi {define}; đừng chép lên site thật. Elementor đọc thẳng {dataId}, không cần cài.',
  'setup.wpRemove': 'Gỡ mu-plugin',
  'setup.wpInstall': 'Cài vào {path}/mu-plugins',
  'setup.static': 'HTML tĩnh',
  'setup.staticSub': 'file .html trong dự án',
  'setup.auto': 'Tự động',
  'setup.staticDesc':
    'Trang mở từ localhost hoặc file:// mà có file .html tương ứng trong dự án (gốc, public/, site/, dist/…) thì tự khớp phần tử với dòng, không cần cài.',
  'setup.none': 'Không thấy Vite, Next.js hay WordPress (wp-content) trong thư mục dự án.',
  'setup.noWpContent': 'Không thấy wp-content trong thư mục dự án'
} as const
