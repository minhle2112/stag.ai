// Kiểu chữ của note đã hiện (HTML từ markdown.ts) trong Vault, theo bản thiết kế "Xưởng": 13px / 1.7, tiêu đề
// 20 / 15px không gạch chân, `code` nền panel-3, wikilink teal gạch chấm, link tới note chưa có mờ đi.
//
// Nền là `.md-body` trong styles.css (dùng chung với Artifacts, Skills) — không sửa file đó. Các quy tắc `.md-body`
// nằm ngoài @layer nên thắng mọi tiện ích Tailwind thường; chỗ nào ghi đè thuộc tính mà `.md-body` đã đặt thì phải
// thêm `!` (important). Mỗi lớp viết trọn chuỗi để Tailwind quét được.
export const NOTE_PROSE = [
  'md-body',
  'text-[13px]! leading-[1.7]!',
  // Tiêu đề: h1 20px, h2 15px bỏ gạch dưới, h3 bằng chữ thường (đậm).
  '[&_h1]:text-[20px]! [&_h1]:mb-2! [&_h1]:tracking-[-0.01em]',
  '[&_h2]:text-[15px]! [&_h2]:border-b-0! [&_h2]:pb-0!',
  '[&_h3]:text-[13px]!',
  // Đoạn, danh sách: sát hơn.
  '[&_p]:my-1.5!',
  '[&_ul]:my-1! [&_ul]:pl-5! [&_ol]:pl-5!',
  '[&_li]:my-0.5',
  // `code` trong dòng (không đụng khối code).
  '[&_:not(pre)>code]:text-[12px]! [&_:not(pre)>code]:bg-panel-3! [&_:not(pre)>code]:px-[5px]! [&_:not(pre)>code]:py-px! [&_:not(pre)>code]:rounded-[3px]!',
  // Wikilink: teal, gạch chân đứt; rê chuột nền teal nhạt; note chưa có thì mờ, viền xám.
  '[&_a.wikilink]:border-b [&_a.wikilink]:border-dashed [&_a.wikilink]:border-accent/40',
  '[&_a:hover]:no-underline! [&_a.wikilink:hover]:bg-accent/10',
  '[&_a.ghost]:text-dim! [&_a.ghost]:no-underline! [&_a.ghost]:opacity-100! [&_a.ghost]:border-line-2!'
].join(' ')
