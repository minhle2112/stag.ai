import type { CanvasLayout, CanvasRect, CanvasRef, CanvasView } from './types'

/**
 * Hình học của canvas tab Agents (main dùng để chuẩn hoá / đổi bố cục cũ, renderer dùng để đặt / kéo / xếp ô).
 * Toạ độ thế giới = px ở mức zoom 100%; camera (CanvasView) đổi toạ độ thế giới sang px của khung canvas.
 */

/** Bước lưới chấm: vị trí / kích thước ô hít vào bội số của nó. */
export const GRID = 20
/** Khoảng cách chuẩn giữa hai ô cạnh nhau. */
export const GAP = 20
export const MIN_W = 280
export const MIN_H = 160
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 1.5
/** Toạ độ / kích thước vượt mức này coi như hỏng (agents.json bị sửa tay). */
export const COORD_MAX = 1_000_000

export type CellSizeKind = 'agent' | 'terminal' | 'widget'

/** Kích thước ô mới: ô agent đủ ~100 cột chữ ở cỡ chữ mặc định. */
export const DEFAULT_SIZE: Record<CellSizeKind, { w: number; h: number }> = {
  agent: { w: 760, h: 460 },
  terminal: { w: 640, h: 380 },
  widget: { w: 380, h: 420 }
}

export interface Point {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

/** Đường gióng khi kéo: `axis` 'x' = vạch dọc tại x = `at` (từ y = `from` tới `to`), 'y' = vạch ngang. */
export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

export const emptyCanvas = (): CanvasLayout => ({ cells: [], closed: {}, view: null })

/** Mã ô: ô agent = id agent (UUID), ô widget = "widget:<id plugin>/<id slot>". */
export const widgetKey = (widget: string): string => `widget:${widget}`

export function cellKey(ref: CanvasRef): string {
  return ref.type === 'leaf' ? ref.agentId : widgetKey(ref.widget)
}

export const snap = (v: number, step = GRID): number => Math.round(v / step) * step

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

export const rectOf = (r: CanvasRect): CanvasRect => ({ x: r.x, y: r.y, w: r.w, h: r.h })

/** Hai hình chồng lên nhau, hoặc gần nhau hơn `gap`. */
export function overlaps(a: CanvasRect, b: CanvasRect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

/** Khung bao các hình; không có hình nào → null. */
export function bounds(rects: CanvasRect[]): CanvasRect | null {
  if (!rects.length) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}

/**
 * Chỗ trống cho một ô cỡ `size`: thử bên phải / dưới / trái / trên của `anchor` (cách GAP), không được thì đặt bên phải
 * mọi ô (luôn trống). Canvas trống → gốc toạ độ.
 */
export function freeSpot(others: CanvasRect[], size: Size, anchor?: CanvasRect | null): Point {
  const fits = (p: Point): boolean => !others.some((o) => overlaps({ ...p, ...size }, o, GAP - 1))
  if (anchor) {
    const tries: Point[] = [
      { x: anchor.x + anchor.w + GAP, y: anchor.y },
      { x: anchor.x, y: anchor.y + anchor.h + GAP },
      { x: anchor.x - GAP - size.w, y: anchor.y },
      { x: anchor.x, y: anchor.y - GAP - size.h }
    ].map((p) => ({ x: snap(p.x), y: snap(p.y) }))
    const hit = tries.find(fits)
    if (hit) return hit
  }
  const b = bounds(others)
  if (!b) return { x: 0, y: 0 }
  return { x: snap(b.x + b.w + GAP), y: snap(anchor?.y ?? b.y) }
}

/**
 * Camera vừa khung mọi hình (lề `pad` px, thêm `top` px phía trên cho thanh công cụ nổi), không phóng quá `maxZoom`.
 * Không có hình → gốc toạ độ ở góc trên trái.
 */
export function fitView(rects: CanvasRect[], viewport: Size, pad = 40, maxZoom = 1, top = 0): CanvasView {
  const b = bounds(rects)
  if (!b || viewport.w <= 0 || viewport.h <= 0) return { x: pad, y: pad + top, zoom: 1 }
  const h = viewport.h - top
  const zoom = Math.max(ZOOM_MIN, Math.min(maxZoom, (viewport.w - 2 * pad) / b.w, (h - 2 * pad) / b.h))
  return { x: (viewport.w - b.w * zoom) / 2 - b.x * zoom, y: top + (h - b.h * zoom) / 2 - b.y * zoom, zoom }
}

/**
 * Camera để thấy trọn `rect` (cách mép `pad` px, phía trên chừa thêm `top` px): đã thấy trọn thì giữ nguyên; lọt khung
 * ở mức zoom hiện tại thì chỉ dịch vừa đủ; không lọt thì thu nhỏ và đưa nó ra giữa (không bao giờ phóng to thêm).
 */
export function revealView(view: CanvasView, rect: CanvasRect, viewport: Size, pad = 40, top = 0): CanvasView {
  const z = view.zoom
  const minY = top + pad
  if (rect.w * z <= viewport.w - 2 * pad && rect.h * z <= viewport.h - minY - pad) {
    const shift = (pos: number, len: number, lo: number, hi: number): number => (pos < lo ? lo - pos : pos + len > hi ? hi - pos - len : 0)
    const dx = shift(view.x + rect.x * z, rect.w * z, pad, viewport.w - pad)
    const dy = shift(view.y + rect.y * z, rect.h * z, minY, viewport.h - pad)
    return dx || dy ? { x: view.x + dx, y: view.y + dy, zoom: z } : view
  }
  const zoom = Math.max(ZOOM_MIN, Math.min(z, (viewport.w - 2 * pad) / rect.w, (viewport.h - minY - pad) / rect.h))
  return { x: viewport.w / 2 - (rect.x + rect.w / 2) * zoom, y: minY + (viewport.h - minY - pad) / 2 - (rect.y + rect.h / 2) * zoom, zoom }
}

/** Phóng `factor` lần quanh điểm (px, py) của khung: điểm thế giới dưới con trỏ đứng yên. */
export function zoomAt(view: CanvasView, factor: number, px: number, py: number): CanvasView {
  const zoom = clampZoom(view.zoom * factor)
  return { x: px - ((px - view.x) * zoom) / view.zoom, y: py - ((py - view.y) * zoom) / view.zoom, zoom }
}

/** Điểm (px, py) của khung → toạ độ thế giới. */
export function toWorld(view: CanvasView, px: number, py: number): Point {
  return { x: (px - view.x) / view.zoom, y: (py - view.y) / view.zoom }
}

/**
 * "Xếp gọn": xếp các ô thành lưới đều, giữ thứ tự đọc hiện tại (theo hàng rồi theo cột). Số cột chọn sao cho ô gần tỉ lệ
 * 16:10 và cả lưới vừa `viewport` ở zoom 100%; ô quá nhỏ thì dùng cỡ cố định (rồi camera tự thu nhỏ cho vừa).
 */
export function tidyRects<T extends CanvasRect & { key: string }>(items: T[], viewport: Size): Record<string, CanvasRect> {
  const n = items.length
  if (!n) return {}
  const order = [...items].sort((a, b) => Math.round(a.y / 200) - Math.round(b.y / 200) || a.x - b.x || a.y - b.y)
  let best = { cols: 1, cw: 0, ch: 0, score: Infinity }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (viewport.w - GAP * (cols + 1)) / cols
    const ch = (viewport.h - GAP * (rows + 1)) / rows
    if (cw <= 0 || ch <= 0) continue
    const score = Math.abs(Math.log(cw / ch / 1.6)) + (rows * cols - n) * 0.15
    if (score < best.score) best = { cols, cw, ch, score }
  }
  let { cols, cw, ch } = best
  if (!Number.isFinite(best.score) || cw < 480 || ch < 280) {
    cols = Math.ceil(Math.sqrt(n))
    cw = 640
    ch = 400
  }
  cw = Math.max(MIN_W, Math.floor(cw / GRID) * GRID)
  ch = Math.max(MIN_H, Math.floor(ch / GRID) * GRID)
  const out: Record<string, CanvasRect> = {}
  order.forEach((it, i) => {
    out[it.key] = { x: GAP + (i % cols) * (cw + GAP), y: GAP + Math.floor(i / cols) * (ch + GAP), w: cw, h: ch }
  })
  return out
}

interface Cand {
  /** Giá trị đích cho cạnh đang xét. */
  to: number
  /** Hình kia (để vẽ vạch gióng phủ cả hai hình). */
  o: CanvasRect
}

/** Đích hít cho một cạnh: cạnh trái / trên (`start`) hoặc phải / dưới của hình đang kéo, theo trục. */
function edgeCands(others: CanvasRect[], axis: 'x' | 'y', start: boolean): Cand[] {
  const out: Cand[] = []
  for (const o of others) {
    const lo = axis === 'x' ? o.x : o.y
    const hi = axis === 'x' ? o.x + o.w : o.y + o.h
    if (start) out.push({ to: lo, o }, { to: hi + GAP, o })
    else out.push({ to: hi, o }, { to: lo - GAP, o })
  }
  return out
}

function guideFor(axis: 'x' | 'y', at: number, r: CanvasRect, o: CanvasRect): Guide {
  return axis === 'x'
    ? { axis, at, from: Math.min(r.y, o.y), to: Math.max(r.y + r.h, o.y + o.h) }
    : { axis, at, from: Math.min(r.x, o.x), to: Math.max(r.x + r.w, o.x + o.w) }
}

/**
 * Kéo cả ô: mỗi trục hít vào cạnh của ô khác (thẳng hàng, hoặc cách đúng GAP) nếu gần hơn `threshold`; không có thì hít
 * lưới. Trả hình mới + vạch gióng.
 */
export function snapMove(rect: CanvasRect, others: CanvasRect[], threshold: number): { rect: CanvasRect; guides: Guide[] } {
  const out = { ...rect }
  const hits: Array<{ axis: 'x' | 'y'; at: number; o: CanvasRect }> = []
  for (const axis of ['x', 'y'] as const) {
    const pos = axis === 'x' ? rect.x : rect.y
    const len = axis === 'x' ? rect.w : rect.h
    let best: { d: number; at: number; o: CanvasRect } | null = null
    for (const start of [true, false]) {
      const edge = start ? pos : pos + len
      for (const c of edgeCands(others, axis, start)) {
        const d = c.to - edge
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: c.to, o: c.o }
      }
    }
    const next = best ? pos + best.d : snap(pos)
    if (axis === 'x') out.x = next
    else out.y = next
    if (best) hits.push({ axis, at: best.at, o: best.o })
  }
  return { rect: out, guides: hits.map((h) => guideFor(h.axis, h.at, out, h.o)) }
}

export interface Edges {
  l?: boolean
  r?: boolean
  t?: boolean
  b?: boolean
}

/** Kéo cạnh / góc để đổi kích thước: cạnh đang kéo hít như snapMove; giữ kích thước tối thiểu. */
export function snapResize(rect: CanvasRect, edges: Edges, others: CanvasRect[], threshold: number): { rect: CanvasRect; guides: Guide[] } {
  let l = rect.x
  let r = rect.x + rect.w
  let t = rect.y
  let b = rect.y + rect.h
  const hits: Array<{ axis: 'x' | 'y'; at: number; o: CanvasRect }> = []
  const pick = (axis: 'x' | 'y', start: boolean, v: number): number => {
    let best: Cand | null = null
    for (const c of edgeCands(others, axis, start)) if (Math.abs(c.to - v) <= threshold && (!best || Math.abs(c.to - v) < Math.abs(best.to - v))) best = c
    if (!best) return snap(v)
    hits.push({ axis, at: best.to, o: best.o })
    return best.to
  }
  if (edges.l) l = Math.min(pick('x', true, l), r - MIN_W)
  if (edges.r) r = Math.max(pick('x', false, r), l + MIN_W)
  if (edges.t) t = Math.min(pick('y', true, t), b - MIN_H)
  if (edges.b) b = Math.max(pick('y', false, b), t + MIN_H)
  const out = { x: l, y: t, w: r - l, h: b - t }
  return { rect: out, guides: hits.map((h) => guideFor(h.axis, h.at, out, h.o)) }
}
