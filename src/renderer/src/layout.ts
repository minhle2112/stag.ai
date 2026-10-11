import { DEFAULT_SIZE, cellKey, freeSpot, rectOf, snap, widgetKey, type CellSizeKind, type Point } from '@shared/canvas'
import type { CanvasCell, CanvasLayout, CanvasRect, CanvasRef } from '@shared/types'

export { cellKey, widgetKey }

/**
 * Bố cục canvas của tab Agents (xem shared/canvas.ts). Mã ô: ô agent = id agent (UUID), ô widget =
 * "widget:<id plugin>/<id slot>". Các hàm dưới đây nhận mã ô nên mọi chỗ truyền id agent (chọn ô, mở ô) vẫn đúng.
 * Mọi hàm trả bố cục mới, không sửa bố cục cũ.
 */

/** Id các agent có ô trên canvas (không gồm widget). */
export function leaves(layout: CanvasLayout): string[] {
  return layout.cells.flatMap((c) => (c.type === 'leaf' ? [c.agentId] : []))
}

/** Mã mọi ô (agent + widget). */
export function cells(layout: CanvasLayout): string[] {
  return layout.cells.map(cellKey)
}

/** Widget đang có ô ("<id plugin>/<id slot>"). */
export function widgets(layout: CanvasLayout): string[] {
  return layout.cells.flatMap((c) => (c.type === 'widget' ? [c.widget] : []))
}

export function findCell(layout: CanvasLayout, key: string): CanvasCell | undefined {
  return layout.cells.find((c) => cellKey(c) === key)
}

const topZ = (layout: CanvasLayout): number => layout.cells.reduce((m, c) => Math.max(m, c.z), 0)

/** Ô mới đặt ở đâu: tại điểm thế giới `at` (góc trên trái), quanh tâm `center`, hoặc chỗ trống cạnh ô `near`. */
export interface Placement {
  at?: Point
  center?: Point
  near?: string | null
}

/**
 * Thêm ô (đã có thì giữ nguyên). Ô từng đóng → về đúng chỗ cũ; không thì theo `place` (không có gì → chỗ trống cạnh
 * ô trên cùng). Ô mới nằm trên cùng.
 */
export function addCell(layout: CanvasLayout, ref: CanvasRef, kind: CellSizeKind, place: Placement = {}): CanvasLayout {
  const key = cellKey(ref)
  if (findCell(layout, key)) return layout
  const size = DEFAULT_SIZE[kind]
  let rect: CanvasRect
  const old = layout.closed[key]
  if (old) rect = rectOf(old)
  else if (place.at) rect = { x: snap(place.at.x), y: snap(place.at.y), ...size }
  else if (place.center) rect = { x: snap(place.center.x - size.w / 2), y: snap(place.center.y - size.h / 2), ...size }
  else {
    const anchorKey = place.near ?? [...layout.cells].sort((a, b) => b.z - a.z).map(cellKey)[0]
    const anchor = anchorKey ? findCell(layout, anchorKey) : undefined
    rect = { ...freeSpot(layout.cells, size, anchor), ...size }
  }
  const closed = { ...layout.closed }
  delete closed[key]
  return { ...layout, cells: [...layout.cells, { ...ref, ...rect, z: topZ(layout) + 1 }], closed }
}

/** Bỏ ô có mã `key`; nhớ chỗ của nó để mở lại đúng chỗ (`forget` = không nhớ, vd. agent đã xoá). */
export function removeCell(layout: CanvasLayout, key: string, forget = false): CanvasLayout {
  const cell = findCell(layout, key)
  if (!cell && !(forget && key in layout.closed)) return layout
  const closed = { ...layout.closed }
  if (forget) delete closed[key]
  else if (cell) closed[key] = rectOf(cell)
  return { ...layout, cells: layout.cells.filter((c) => c !== cell), closed }
}

/** Đặt lại vị trí / kích thước nhiều ô (mã ô → hình); ô không có thì bỏ qua. */
export function setRects(layout: CanvasLayout, rects: Record<string, CanvasRect>): CanvasLayout {
  return { ...layout, cells: layout.cells.map((c) => (rects[cellKey(c)] ? { ...c, ...rectOf(rects[cellKey(c)]) } : c)) }
}

/** Đưa ô lên trên cùng (đã trên cùng thì giữ nguyên bố cục). */
export function toFront(layout: CanvasLayout, key: string): CanvasLayout {
  const cell = findCell(layout, key)
  const top = topZ(layout)
  if (!cell || (cell.z === top && layout.cells.filter((c) => c.z === top).length === 1)) return layout
  return { ...layout, cells: layout.cells.map((c) => (c === cell ? { ...c, z: top + 1 } : c)) }
}

/** Hình hiện tại của mọi ô (để hoàn tác). */
export function rectsOf(layout: CanvasLayout): Record<string, CanvasRect> {
  return Object.fromEntries(layout.cells.map((c) => [cellKey(c), rectOf(c)]))
}

/** Bỏ ô và chỗ cũ của agent không còn tồn tại (đã xoá ở nơi khác). */
export function reconcile(layout: CanvasLayout, agentIds: string[]): CanvasLayout {
  const known = new Set(agentIds)
  const cellsKept = layout.cells.filter((c) => c.type !== 'leaf' || known.has(c.agentId))
  const closed = Object.fromEntries(Object.entries(layout.closed).filter(([k]) => k.startsWith('widget:') || known.has(k)))
  if (cellsKept.length === layout.cells.length && Object.keys(closed).length === Object.keys(layout.closed).length) return layout
  return { ...layout, cells: cellsKept, closed }
}
