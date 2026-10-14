import jsQR from 'jsqr'
import type { NativeImage } from 'electron'

/**
 * Đọc mã QR trong ảnh (ảnh chụp vùng trang, màn hình, file ảnh). Thử thêm bản phóng to khi ảnh nhỏ (QR vẽ bằng SVG
 * cỡ ~100px thường quá mịn cho bộ giải). Trả về nội dung chữ của mã, hoặc null.
 */
export function decodeQr(img: NativeImage): string | null {
  if (img.isEmpty()) return null
  const tries: NativeImage[] = [img]
  const { width } = img.getSize()
  if (width < 400) tries.push(img.resize({ width: width * 3, quality: 'good' }))
  for (const im of tries) {
    const { width: w, height: h } = im.getSize()
    if (w < 21 || h < 21) continue
    // toBitmap: BGRA → jsQR cần RGBA.
    const bgra = im.toBitmap()
    const rgba = new Uint8ClampedArray(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2]
      rgba[i + 1] = bgra[i + 1]
      rgba[i + 2] = bgra[i]
      rgba[i + 3] = 255
    }
    const res = jsQR(rgba, w, h, { inversionAttempts: 'attemptBoth' })
    if (res?.data) return res.data
  }
  return null
}
