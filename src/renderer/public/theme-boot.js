// Đặt màu app (data-theme + color-scheme) trước khi React vẽ, để mở app / tải lại không chớp sai màu.
// File riêng vì CSP của trang chặn script nội tuyến. window.stag do preload gắn trước khi trang chạy.
try {
  var s = window.stag && window.stag.theme.initial()
  if (s) {
    var r = document.documentElement
    r.dataset.theme = s.theme
    r.style.colorScheme = s.theme
    if (s.terminal !== s.theme) r.dataset.termdark = ''
  }
} catch (e) {
  /* giữ màu tối mặc định */
}
