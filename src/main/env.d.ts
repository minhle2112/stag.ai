// Vite: nạp nguyên văn nội dung file thành chuỗi.
declare module '*?raw' {
  const content: string
  export default content
}
