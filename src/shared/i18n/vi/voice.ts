// Chuỗi giao diện tiếng Việt (nguồn), namespace `voice`. Tham số dạng {tên}.
export default {
  // Trạng thái (khung giọng nói, ô nổi)
  'status.opening': 'Đang mở micro…',
  'status.listening': 'Đang nghe…',
  'status.fixing': 'Đang sửa bằng AI…',
  'status.processing': 'Đang nhận dạng…',
  'overlay.hint': 'bấm {key} để dừng · Esc huỷ',
  'overlay.hotkey': 'phím tắt',

  // Khung giọng nói trong ô agent (VoicePanel.tsx)
  'panel.stop': 'Dừng nói',
  'panel.speak': 'Nói để gõ',
  'panel.speakHold': 'Nói để gõ (hoặc giữ {key})',
  'panel.hint': 'thả {key} (hoặc bấm nút micro) để dừng · Esc huỷ',
  'panel.hintLoading': 'đang nạp model · thả {key} (hoặc bấm nút micro) để dừng · Esc huỷ',
  'panel.loadingModel': 'Đang nạp model (lần đầu sau một lúc không dùng)…',
  'panel.textLabel': 'Chữ nhận được từ giọng nói',
  'panel.fixed': 'Đã sửa bằng AI',
  'panel.undo': 'Hoàn tác',
  'panel.previewHint': 'Sửa nếu cần · giữ {key} để nói thêm · Shift+Enter xuống dòng · chèn xong vẫn chưa gửi',
  'panel.discard': 'Bỏ (Esc)',
  'panel.insert': 'Chèn (Enter)',
  'panel.openSettings': 'Mở Cài đặt → Giọng nói',
  'panel.retryInsert': 'Thử chèn lại',

  // Lượt nói (store/voice.ts)
  'run.noTarget': 'Chọn một ô agent trong tab Agents rồi giữ phím tắt để nói.',
  'run.cloudFallbackLive': '({error} Thả phím xong sẽ nhận dạng bằng máy trên máy.)',
  'run.noModel': 'Chưa tải model nhận dạng giọng nói.',
  'run.micFailed': 'Không mở được micro: {message}. Kiểm tra Windows Settings → Privacy → Microphone.',
  'run.cloudFallback': 'Soniox lỗi: {error} Đã nhận dạng bằng máy trên máy.',
  'run.failed': 'Nhận dạng lỗi: {message}',
  'run.nothingRecognized': 'Không nhận ra câu nào. Thử nói rõ hơn hoặc gần micro hơn.',
  'run.nothingHeard': 'Không nghe thấy gì. Kiểm tra micro trong Cài đặt → Giọng nói.',
  'run.aiFailed': 'Không sửa được bằng AI: {message}',
  'run.typeFailed': 'Không gõ được vào ứng dụng đang mở: {message}',
  'run.noSession': 'Ô này không có phiên đang chạy nên chưa chèn được. Mở phiên rồi thử lại.',

  // Model trên máy (main/voice.ts)
  'model.extractFailed': 'Giải nén không được: {message}',
  'model.serverError': 'Máy chủ trả về lỗi {status}.',
  'model.badChecksum': 'File tải về không khớp mã kiểm tra (có thể bị hỏng giữa đường). Thử tải lại.',
  'model.missingFiles': 'Gói model thiếu file, không dùng được.',
  'engine.noModel': 'Chưa tải model nhận dạng giọng nói (Cài đặt → Giọng nói).',
  'engine.notLoaded': 'Model chưa nạp.',
  'engine.failed': 'Lỗi nhận dạng.',
  'engine.crashed': 'Tiến trình nhận dạng thoát bất ngờ (mã {code}).',
  'engine.loadFailed': 'Không nạp được model: {message}',
  'engine.notRunning': 'Tiến trình nhận dạng chưa chạy.',
  'engine.timeout': 'Nhận dạng quá lâu, đã huỷ.',
  'engine.stopped': 'Đã dừng nhận dạng.',

  // Soniox (main/voiceCloud.ts)
  'cloud.badKey': 'API key Soniox không đúng hoặc đã bị thu hồi (Cài đặt → Giọng nói).',
  'cloud.noBalance': 'Tài khoản Soniox hết tiền hoặc hết hạn mức (console.soniox.com).',
  'cloud.rateLimited': 'Soniox đang giới hạn số yêu cầu, thử lại sau ít giây.',
  'cloud.error': 'Soniox báo lỗi: {message}',
  'cloud.connectFailed': 'Không kết nối được Soniox (kiểm tra mạng).',
  'cloud.closed': 'Soniox đóng kết nối giữa chừng (mã {code}).',
  'cloud.timeout': 'Soniox trả lời quá lâu.',
  'cloud.cancelled': 'Đã huỷ.',
  'cloud.noKeyLong': 'Chưa có API key Soniox (Cài đặt → Giọng nói, lưu trong bí mật {secret}).',
  'cloud.ended': 'Lượt nói đã kết thúc.',
  'cloud.noKey': 'Chưa có API key Soniox.',

  // Sửa bằng AI (main/voiceFix.ts)
  'ai.timeout': 'AI trả lời quá lâu.',
  'ai.callFailed': 'Không gọi được AI: {message}',
  'ai.badKey': 'API key Anthropic không đúng (Cài đặt → Giọng nói).',
  'ai.rateLimited': 'Anthropic đang giới hạn số yêu cầu, thử lại sau.',
  'ai.error': 'AI báo lỗi {status}: {message}',
  'ai.notAFix': 'AI trả về nội dung không giống bản sửa, đã giữ câu gốc.',

  // Gõ vào ứng dụng khác (main/voiceSystem.ts)
  'keys.startFailed': 'Không khởi động được bộ nhấn phím (PowerShell).',
  'keys.exited': 'Bộ nhấn phím đã thoát.',
  'keys.notRunning': 'Bộ nhấn phím không chạy.',
  'keys.noReply': 'Bộ nhấn phím không trả lời.',
  'global.taken': 'Phím {key} đang bị ứng dụng khác dùng, chọn phím khác.',

  // Cài đặt → Giọng nói
  'settings.title': 'Giọng nói',
  'settings.desc': 'Giữ {key} trong một ô agent để nói tiếng Việt (lẫn từ tiếng Anh), thả ra để chuyển thành chữ.',
  'settings.descCloud': 'Đang dùng máy đám mây Soniox: âm thanh được gửi tới Soniox để nhận dạng, app không lưu lại.',
  'settings.descLocal': 'Nhận dạng chạy hoàn toàn trên máy bạn, âm thanh không gửi đi đâu và không lưu lại.',
  'settings.engine': 'Máy nhận dạng',
  'settings.engineWhich': 'Dùng máy nào',
  'settings.engineCloudDesc':
    'Soniox: chữ hiện dần ngay khi bạn nói, thường chính xác hơn với từ tiếng Anh. Âm thanh và danh sách từ gợi ý (tên file, tên hàm) được gửi tới Soniox; chữ trong terminal thì không.',
  'settings.engineLocalDesc': 'Qwen3-ASR chạy hoàn toàn trên máy bạn: miễn phí, không cần mạng, âm thanh không gửi đi đâu.',
  'settings.engineLocal': 'Trên máy (Qwen3-ASR)',
  'settings.engineCloud': 'Đám mây (Soniox)',
  'settings.usage': 'Cách dùng',
  'settings.enable': 'Bật gõ bằng giọng nói',
  'settings.enableDesc': 'Phím tắt và nút micro trên thanh của ô agent.',
  'settings.hotkey': 'Phím tắt',
  'settings.hotkeyDesc': 'Giữ để nói, thả để dừng. Đang nói bấm Esc để huỷ. Nút micro trên ô: bấm để nói, bấm lần nữa để dừng.',
  'settings.preview': 'Xem trước rồi mới chèn',
  'settings.previewDesc':
    'Hiện chữ nhận được để sửa, Enter mới chèn vào ô. Tắt = chèn thẳng. Cả hai cách đều không tự gửi: bạn vẫn tự nhấn Enter trong ô.',
  'settings.sendCommand': 'Nói "gửi" để gửi',
  'settings.sendCommandDesc':
    'Kết câu bằng "gửi" hoặc "gửi đi" → chèn rồi nhấn Enter luôn (bỏ qua khung xem trước). Chỉ nói "gửi" → nhấn Enter cho phần đã gõ sẵn. Tắt sẵn vì câu có chữ "gửi" ở cuối sẽ bị gửi đi.',
  'settings.ram': 'Bộ nhớ (RAM)',
  'settings.unload': 'Giải phóng model',
  'settings.unloadDesc':
    'Tiến trình nhận dạng chỉ chạy khi bạn nói (khoảng 1,2–1,4 GB RAM). Không dùng một lúc thì tắt để trả RAM; lần nói sau nạp lại mất khoảng 2–3 giây, phần lớn trùng lúc bạn đang nói.',
  'settings.unloadMinutes': 'Sau {count} phút không dùng',
  'settings.unloadHour': 'Sau 1 giờ không dùng',
  'settings.unloadNever': 'Giữ tới khi tắt app',
  'settings.sonioxKey': 'API key Soniox',
  'settings.sonioxKeyHelp': 'Tạo key tại console.soniox.com → API keys rồi dán vào đây. Key được mã hoá bằng tài khoản Windows của bạn.',
  'settings.cost': 'Chi phí',
  'settings.costDesc':
    'Soniox tính khoảng {rate} USD mỗi giờ âm thanh (thời gian bạn giữ phím). Tháng này: {minutes} phút ≈ {usd} USD (app tự đếm, hoá đơn thật xem ở console.soniox.com).',
  'settings.ai': 'Sửa bằng AI (tuỳ chọn)',
  'settings.aiFix': 'Nhờ AI sửa từ nghe sai',
  'settings.aiFixDesc':
    'Sau khi nhận dạng, gửi câu vừa nói và danh sách từ của dự án cho Claude ({model}) để sửa từ code bị nghe sai, vd. "hen đồ click" → handleClick. Không gửi âm thanh hay chữ trong terminal. Khung xem trước hiện chữ ngay, AI sửa xong thì thay (có Hoàn tác). Mỗi câu tốn khoảng một phần trăm cent.',
  'settings.anthropicKey': 'API key Anthropic',
  'settings.anthropicKeyHelp': 'Tạo key tại console.anthropic.com → API keys. Dùng chung bí mật {secret} với connector nếu đã có.',
  'settings.global': 'Gõ vào ứng dụng khác',
  'settings.globalDesc':
    'Khi stag.ai không ở trên cùng: bấm {key} để nói, bấm lần nữa để dừng (Windows không báo nhả phím cho phím tắt toàn hệ thống), Esc để huỷ. Chữ được dán vào ô đang gõ của ứng dụng đó (clipboard được trả lại như cũ), không xem trước, không tự nhấn Enter. Không gõ được vào cửa sổ chạy quyền quản trị.',
  'settings.globalHotkey': 'Phím tắt toàn hệ thống',
  'settings.globalHotkeyDesc': 'Trong stag.ai vẫn dùng phím giữ-để-nói ở trên.',

  // Ô API key
  'key.savedOk': 'Đã lưu và thử key: dùng được.',
  'key.saved': 'Đã lưu (mã hoá trong bí mật {secret}, app không hiện lại). Dán key mới để thay.',
  'key.savedPlaceholder': '•••••••• (đã lưu)',
  'key.paste': 'Dán API key',
  'key.works': 'Key dùng được.',
  'key.testing': 'Đang thử…',
  'key.test': 'Kiểm tra',
  'key.removed': 'Đã xoá key.',
  'key.remove': 'Xoá key',

  // Model nhận dạng
  'model.ready': 'Đã tải, sẵn sàng dùng (khoảng 1 GB trên đĩa).',
  'model.remove': 'Xoá model',
  'model.verifying': 'Đang kiểm tra file tải về…',
  'model.extracting': 'Đang giải nén (khoảng một phút)…',
  'model.missing': 'Cần tải một lần {size} từ GitHub (k2-fsa/sherpa-onnx). App kiểm tra mã SHA-256 trước khi dùng.',
  'model.download': 'Tải model',
  'model.titleFallback': 'Model trên máy (dự phòng, không bắt buộc)',
  'model.title': 'Model nhận dạng',

  'engineRow.label': 'Tiến trình nhận dạng',
  'engineRow.ready': 'Đang nạp trong RAM, nói là nhận dạng ngay.',
  'engineRow.loading': 'Đang nạp model…',
  'engineRow.off': 'Không chạy, không tốn RAM.',
  'engineRow.unload': 'Giải phóng ngay',

  // Micro
  'mic.title': 'Micro',
  'mic.default': 'Micro mặc định của Windows',
  'mic.numbered': 'Micro {n}',
  'mic.unplugged': 'Micro đã chọn (đang không cắm)',
  'mic.showNamesHint': 'Bấm "Hiện tên micro" để thấy tên từng micro.',
  'mic.showNames': 'Hiện tên micro',

  // Từ gợi ý
  'hotwords.title': 'Từ gợi ý',
  'hotwords.auto': 'Tự gợi ý từ trong workspace',
  'hotwords.autoDesc':
    'Tên file, hàm, class, thư viện của dự án, từ code đang hiện trong ô agent và từ hay dùng (commit, push, npm…). Giúp nhận đúng chính tả từ tiếng Anh. Chỉ đọc file trên máy, không gửi đi đâu.',
  'hotwords.manual': 'Từ bạn tự thêm',
  'hotwords.manualDesc':
    'Luôn được ưu tiên: tên riêng, tên hàm, thư viện bạn hay nói (vd. handleClick, zustand) — mỗi dòng một mục, viết đúng chính tả muốn ra. Tên agent được thêm tự động.',
  'terms.label': 'Từ của workspace "{name}"',
  'terms.desc': 'Mỗi lần nói, app chọn khoảng 60 từ hợp nhất: từ bạn thêm, tên agent, từ đang hiện trong ô, rồi đến từ của workspace.',
  'terms.scanning': 'Đang quét…',
  'terms.list': '{count} từ, quan trọng nhất trước: {terms}',
  'terms.none': 'Không tìm thấy từ nào (thư mục trống hoặc không đọc được).',
  'terms.view': 'Xem',

  // Sửa chữ sau khi nhận dạng
  'fix.title': 'Sửa chữ sau khi nhận dạng',
  'fix.newline': 'Nói "xuống dòng" để xuống dòng',
  'fix.newlineDesc': '"…sửa hàm này, xuống dòng, rồi chạy test" → hai dòng. Nói "ký tự xuống dòng" hay "dấu xuống dòng" thì giữ nguyên chữ.',
  'fix.newlineSwitch': 'Lệnh xuống dòng',
  'fix.rules': 'Luật thay từ',
  'fix.rulesDesc':
    'Cho những chỗ máy hay nghe sai — mỗi dòng “chữ máy ra → chữ bạn muốn”, khớp trọn cụm, không phân biệt hoa thường. Tên hàm bị tách (handle click) hay sai hoa thường thì app tự sửa theo từ gợi ý, không cần luật.'
} as const
