// Chuỗi giao diện tiếng Việt (nguồn), namespace `handoff`. Tham số dạng {tên}.
export default {
  // HandoffSection
  'title': 'Agent & bàn giao',
  'desc': 'Khi context của một phiên agent đạt ngưỡng và agent đang chờ bạn (hết lượt, bạn không gõ phím vài giây), app nhờ agent ghi vault và viết bản bàn giao, rồi đóng phiên và mở phiên mới đọc tiếp từ bản bàn giao đó. Việc đang làm của agent vẫn giữ nguyên.',
  'group': 'Bàn giao khi context gần đầy',
  'auto': 'Tự động bàn giao',
  'threshold': 'Ngưỡng',
  'thresholdDesc': '= {t200} token với cửa sổ 200k, {t1m} token với cửa sổ 1M. Claude Code tự compact ở khoảng 97% (cửa sổ 1M) nên tối đa là {max}%.',
  'sliderLabel': 'Ngưỡng bàn giao (thanh trượt)',
  'thresholdLabel': 'Ngưỡng bàn giao',
  'note': 'Bàn giao tay bất cứ lúc nào: menu ⋯ của agent ở thanh bên → "Bàn giao sang phiên mới". App đọc % context qua statusLine của Claude Code; statusLine riêng của bạn (nếu có) vẫn chạy và hiện như cũ trong phiên agent.',
  'strip': 'Ctx hiện tại',
  'stripTip': 'Mỗi ô vuông là một agent · vạch đỏ = ngưỡng bàn giao',
  'thresholdTip': 'Ngưỡng {pct}%',
  'soon': ' · sắp bàn giao'
} as const
