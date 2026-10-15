/**
 * Toạ độ của computer use. Agent thấy ảnh chụp một màn hình ở "khung toạ độ" cố định (cạnh dài ≤ 1568, ≈ 1,2 MP — cỡ
 * Claude nhận mà không tự thu nhỏ); mọi click / vùng zoom tính theo khung đó. Ở đây đổi khung ↔ pixel thật của màn
 * hình (toạ độ ảo của Windows, có thể âm khi màn hình phụ nằm bên trái / trên). Thuần logic, có unit test.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Một màn hình theo pixel thật (đã nhân DPI), gốc là toạ độ ảo của Windows. */
export interface PhysicalDisplay {
  id: string
  label: string
  primary: boolean
  /** Pixel thật trong toạ độ ảo. */
  bounds: Rect
}

export const FRAME_MAX_EDGE = 1568
export const FRAME_MAX_PIXELS = 1_192_464

/** Cỡ khung toạ độ của một màn hình (giữ tỉ lệ, không phóng to). */
export function frameSize(width: number, height: number): { width: number; height: number; scale: number } {
  const s = Math.min(1, FRAME_MAX_EDGE / Math.max(width, height), Math.sqrt(FRAME_MAX_PIXELS / (width * height)))
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), scale: s }
}

/** Điểm trong khung (có thể lẻ) → pixel thật (nguyên) trong toạ độ ảo; kẹp vào trong màn hình. */
export function frameToPhysical(d: Rect, frame: { width: number; height: number }, fx: number, fy: number): { x: number; y: number } {
  const x = d.x + Math.floor(((fx + 0.5) * d.width) / frame.width)
  const y = d.y + Math.floor(((fy + 0.5) * d.height) / frame.height)
  return { x: clamp(x, d.x, d.x + d.width - 1), y: clamp(y, d.y, d.y + d.height - 1) }
}

/** Pixel thật → điểm trong khung (nguyên); null = ngoài màn hình này. */
export function physicalToFrame(d: Rect, frame: { width: number; height: number }, px: number, py: number): { x: number; y: number } | null {
  if (px < d.x || py < d.y || px >= d.x + d.width || py >= d.y + d.height) return null
  return { x: Math.floor(((px - d.x) * frame.width) / d.width), y: Math.floor(((py - d.y) * frame.height) / d.height) }
}

/** Kiểm tra toạ độ agent đưa có nằm trong khung không; trả câu lỗi cho agent hoặc null. */
export function checkFramePoint(frame: { width: number; height: number }, p: unknown): string | null {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return 'coordinate must be [x, y] numbers from the most recent screenshot.'
  const [x, y] = p as number[]
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height)
    return `coordinate (${x}, ${y}) is outside the screenshot (${frame.width}x${frame.height}). Use coordinates read from the most recent screenshot.`
  return null
}

/** Vùng zoom [x0, y0, x1, y1] trong khung → hình chữ nhật pixel thật tương đối với góc màn hình (để cắt ảnh gốc). */
export function zoomRegion(d: Rect, frame: { width: number; height: number }, region: unknown): Rect | string {
  if (!Array.isArray(region) || region.length !== 4 || !region.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return 'region must be [x0, y0, x1, y1] in the coordinate space of the most recent screenshot.'
  let [x0, y0, x1, y1] = region as number[]
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  x0 = clamp(x0, 0, frame.width)
  x1 = clamp(x1, 0, frame.width)
  y0 = clamp(y0, 0, frame.height)
  y1 = clamp(y1, 0, frame.height)
  if (x1 - x0 < 2 || y1 - y0 < 2) return `region [${region.join(', ')}] is empty or outside the screenshot (${frame.width}x${frame.height}).`
  const sx = d.width / frame.width
  const sy = d.height / frame.height
  const x = Math.floor(x0 * sx)
  const y = Math.floor(y0 * sy)
  return { x, y, width: Math.max(1, Math.min(d.width - x, Math.ceil(x1 * sx) - x)), height: Math.max(1, Math.min(d.height - y, Math.ceil(y1 * sy) - y)) }
}

/** Cỡ ảnh trả về cho một vùng / màn hình: trong ngân sách khung, rồi nhân `scale` (0.1–1) agent xin. */
export function outputSize(width: number, height: number, scale?: number): { width: number; height: number } {
  const f = frameSize(width, height)
  const s = scale === undefined || !Number.isFinite(scale) ? 1 : clamp(scale, 0.1, 1)
  return { width: Math.max(1, Math.round(f.width * s)), height: Math.max(1, Math.round(f.height * s)) }
}

/** Màn hình chứa điểm pixel thật; không có thì màn hình gần nhất. */
export function displayAt(displays: PhysicalDisplay[], px: number, py: number): PhysicalDisplay | undefined {
  const inside = displays.find((d) => px >= d.bounds.x && py >= d.bounds.y && px < d.bounds.x + d.bounds.width && py < d.bounds.y + d.bounds.height)
  if (inside) return inside
  let best: PhysicalDisplay | undefined
  let bestDist = Infinity
  for (const d of displays) {
    const dx = Math.max(d.bounds.x - px, 0, px - (d.bounds.x + d.bounds.width - 1))
    const dy = Math.max(d.bounds.y - py, 0, py - (d.bounds.y + d.bounds.height - 1))
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

/** Phần giao của hai hình chữ nhật; null = không giao. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.width, b.x + b.width)
  const btm = Math.min(a.y + a.height, b.y + b.height)
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null
}

/**
 * Che cửa sổ của app chưa được cấp trong ảnh (BGRA, như nativeImage.toBitmap). `windows` theo thứ tự từ dưới lên trên
 * (z-order ngược), toạ độ đã đổi sang pixel của ảnh: cửa sổ được phép phía trên làm lộ lại phần nó che.
 * Trả về số pixel bị che.
 */
export function maskBitmap(bitmap: Uint8Array, width: number, height: number, windows: Array<{ rect: Rect; masked: boolean }>, color: [number, number, number] = [40, 40, 44]): number {
  const mask = new Uint8Array(width * height)
  const full: Rect = { x: 0, y: 0, width, height }
  for (const w of windows) {
    const r = intersect(full, { x: Math.floor(w.rect.x), y: Math.floor(w.rect.y), width: Math.ceil(w.rect.width), height: Math.ceil(w.rect.height) })
    if (!r) continue
    const v = w.masked ? 1 : 0
    for (let y = r.y; y < r.y + r.height; y++) mask.fill(v, y * width + r.x, y * width + r.x + r.width)
  }
  let n = 0
  const [cr, cg, cb] = color
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const o = i * 4
    bitmap[o] = cb
    bitmap[o + 1] = cg
    bitmap[o + 2] = cr
    bitmap[o + 3] = 255
    n++
  }
  return n
}

/** Đổi hình chữ nhật pixel thật (toạ độ ảo) sang toạ độ trong một ảnh chụp phần `src` của màn hình, cỡ ảnh w×h. */
export function rectToImage(r: Rect, src: Rect, w: number, h: number): Rect {
  const sx = w / src.width
  const sy = h / src.height
  return { x: (r.x - src.x) * sx, y: (r.y - src.y) * sy, width: r.width * sx, height: r.height * sy }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
