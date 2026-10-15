/**
 * Chụp màn hình cho computer use: desktopCapturer (cửa sổ viền / thanh nổi của stag.ai đặt setContentProtection nên
 * không lọt vào ảnh — đã thử ở CU0), che cửa sổ của app chưa được cấp, thu về khung toạ độ (geometry.ts).
 */
import { desktopCapturer, nativeImage, screen, type NativeImage } from 'electron'
import { frameSize, maskBitmap, outputSize, rectToImage, type PhysicalDisplay, type Rect } from './geometry'

/** Mọi màn hình theo pixel thật (toạ độ ảo của Windows). */
export function physicalDisplays(): PhysicalDisplay[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d) => {
    // Windows: dipToScreenRect đổi đúng cả khi các màn hình khác DPI. Nơi khác: nhân scaleFactor.
    const b =
      process.platform === 'win32'
        ? screen.dipToScreenRect(null, d.bounds)
        : { x: Math.round(d.bounds.x * d.scaleFactor), y: Math.round(d.bounds.y * d.scaleFactor), width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) }
    return { id: String(d.id), label: d.label || `Display ${d.id}`, primary: d.id === primary, bounds: b }
  })
}

/** Ảnh gốc (pixel thật) của một màn hình. */
export async function captureDisplay(d: PhysicalDisplay): Promise<NativeImage> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.bounds.width, height: d.bounds.height } })
  const src = sources.find((s) => s.display_id === d.id) ?? (sources.length === 1 ? sources[0] : undefined)
  if (!src || src.thumbnail.isEmpty()) throw new Error(`Could not capture monitor "${d.label}".`)
  return src.thumbnail
}

/** Cửa sổ cần che / để lộ, toạ độ pixel thật, thứ tự từ dưới lên trên. */
export type MaskWindow = { rect: Rect; masked: boolean }

/**
 * Cắt phần `region` (pixel thật, tương đối với góc màn hình; vắng = cả màn hình), che cửa sổ, thu nhỏ về cỡ ra
 * (trong ngân sách khung × scale) và mã JPEG.
 */
export function render(
  full: NativeImage,
  d: PhysicalDisplay,
  opts: { region?: Rect; windows: MaskWindow[]; scale?: number; size?: { width: number; height: number } }
): { jpeg: Buffer; width: number; height: number; masked: number } {
  const imgSize = full.getSize()
  // Ảnh desktopCapturer có thể khác cỡ pixel thật một chút (làm tròn): quy về toạ độ ảnh.
  const kx = imgSize.width / d.bounds.width
  const ky = imgSize.height / d.bounds.height
  const reg = opts.region ?? { x: 0, y: 0, width: d.bounds.width, height: d.bounds.height }
  const crop = { x: Math.round(reg.x * kx), y: Math.round(reg.y * ky), width: Math.max(1, Math.round(reg.width * kx)), height: Math.max(1, Math.round(reg.height * ky)) }
  const part = opts.region ? full.crop(crop) : full
  const out = opts.size ?? outputSize(reg.width, reg.height, opts.scale)
  const small = part.resize({ width: out.width, height: out.height, quality: 'better' })
  const sz = small.getSize()
  const bmp = small.toBitmap()
  // Vùng nguồn theo toạ độ ảo để đổi khung cửa sổ sang pixel của ảnh ra.
  const srcAbs = { x: d.bounds.x + reg.x, y: d.bounds.y + reg.y, width: reg.width, height: reg.height }
  const masked = maskBitmap(
    bmp,
    sz.width,
    sz.height,
    opts.windows.map((w) => ({ rect: rectToImage(w.rect, srcAbs, sz.width, sz.height), masked: w.masked }))
  )
  const img = masked ? nativeImage.createFromBitmap(bmp, { width: sz.width, height: sz.height }) : small
  return { jpeg: img.toJPEG(80), width: sz.width, height: sz.height, masked }
}

/**
 * Ảnh riêng một cửa sổ (desktopCapturer kiểu 'window', id nguồn = `window:<HWND>:…`): Windows chụp nội dung cửa sổ kể
 * cả khi cửa sổ khác đè lên. Trong ngân sách khung; JPEG base64. undefined = không có nguồn / ảnh rỗng.
 */
export async function captureWindow(hwnd: string, rect: Rect): Promise<string | undefined> {
  const size = outputSize(Math.max(1, rect.width), Math.max(1, rect.height))
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: false })
  const src = sources.find((s) => s.id.startsWith(`window:${hwnd}:`))
  if (!src || src.thumbnail.isEmpty()) return undefined
  return src.thumbnail.toJPEG(80).toString('base64')
}

export { frameSize }
