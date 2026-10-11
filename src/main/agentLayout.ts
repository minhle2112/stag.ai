import { COORD_MAX, GAP, MIN_H, MIN_W, ZOOM_MAX, ZOOM_MIN, cellKey, emptyCanvas } from '@shared/canvas'
import { PLUGIN_ID_RE, PLUGIN_SLOT_RE } from '@shared/plugins'
import type { CanvasCell, CanvasLayout, CanvasRect, CanvasRef, CanvasView } from '@shared/types'

/** "<id plugin>/<id slot>" (id plugin và id slot không có "/"). */
function validWidget(w: string): boolean {
  const [pluginId, slotId, ...rest] = w.split('/')
  return !rest.length && PLUGIN_ID_RE.test(pluginId) && PLUGIN_SLOT_RE.test(slotId ?? '')
}

/** Lưới chia đôi cũ (trước canvas, 2026-10-11): chỉ còn để đổi agents.json cũ sang canvas. */
export type LegacyLayoutNode =
  | { type: 'leaf'; agentId: string }
  | { type: 'widget'; widget: string }
  | { type: 'split'; dir: 'row' | 'col'; ratio: number; a: LegacyLayoutNode; b: LegacyLayoutNode }

/** Vùng tham chiếu khi đổi lưới cũ sang canvas (≈ một màn hình). */
export const LEGACY_AREA: CanvasRect = { x: 0, y: 0, w: 1600, h: 900 }

/** Nội dung ô hợp lệ (ô agent / ô widget), hoặc null. */
function parseRef(n: Record<string, unknown>): CanvasRef | null {
  if (n.type === 'leaf') {
    if (typeof n.agentId !== 'string' || !n.agentId || n.agentId.startsWith('widget:')) return null
    return { type: 'leaf', agentId: n.agentId }
  }
  if (n.type === 'widget') {
    if (typeof n.widget !== 'string' || !validWidget(n.widget)) return null
    return { type: 'widget', widget: n.widget }
  }
  return null
}

/**
 * Chuẩn hoá lưới chia đôi cũ: bỏ nút hỏng (ô hỏng thì ô anh em chiếm chỗ), tỉ lệ ngoài 0.05–0.95 kẹp lại, ô trùng chỉ
 * giữ ô đầu.
 */
export function normalizeLegacyTree(raw: unknown): LegacyLayoutNode | null {
  const seen = new Set<string>()
  const walk = (v: unknown, depth: number): LegacyLayoutNode | null => {
    if (!v || typeof v !== 'object' || depth > 64) return null
    const n = v as Record<string, unknown>
    if (n.type === 'split') {
      const a = walk(n.a, depth + 1)
      const b = walk(n.b, depth + 1)
      if (!a) return b
      if (!b) return a
      const dir = n.dir === 'col' ? 'col' : 'row'
      const ratio = typeof n.ratio === 'number' && Number.isFinite(n.ratio) ? Math.min(0.95, Math.max(0.05, n.ratio)) : 0.5
      return { type: 'split', dir, ratio, a, b }
    }
    const ref = parseRef(n)
    if (!ref || seen.has(cellKey(ref))) return null
    seen.add(cellKey(ref))
    return ref
  }
  return walk(raw, 0)
}

/** Lưới chia đôi cũ → các ô canvas chiếm cùng chỗ trong `area` (cách nhau GAP, toạ độ nguyên). */
export function treeToCells(tree: LegacyLayoutNode | null, area: CanvasRect = LEGACY_AREA): CanvasCell[] {
  const out: CanvasCell[] = []
  const walk = (n: LegacyLayoutNode, r: CanvasRect): void => {
    if (n.type !== 'split') {
      out.push({ ...n, x: Math.round(r.x), y: Math.round(r.y), w: Math.max(MIN_W, Math.round(r.w)), h: Math.max(MIN_H, Math.round(r.h)), z: out.length + 1 })
      return
    }
    if (n.dir === 'row') {
      const wa = (r.w - GAP) * n.ratio
      walk(n.a, { ...r, w: wa })
      walk(n.b, { ...r, x: r.x + wa + GAP, w: r.w - wa - GAP })
    } else {
      const ha = (r.h - GAP) * n.ratio
      walk(n.a, { ...r, h: ha })
      walk(n.b, { ...r, y: r.y + ha + GAP, h: r.h - ha - GAP })
    }
  }
  if (tree) walk(tree, area)
  return out
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_MAX

function parseRect(v: unknown): CanvasRect | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!num(r.x) || !num(r.y) || !num(r.w) || !num(r.h)) return null
  return { x: r.x, y: r.y, w: Math.max(MIN_W, r.w), h: Math.max(MIN_H, r.h) }
}

function parseView(v: unknown): CanvasView | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!num(r.x) || !num(r.y) || !num(r.zoom) || r.zoom <= 0) return null
  return { x: r.x, y: r.y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, r.zoom)) }
}

/** Mã ô hợp lệ cho `closed`: id agent, hoặc "widget:<id plugin>/<id slot>". */
function validKey(k: string): boolean {
  return k.startsWith('widget:') ? validWidget(k.slice('widget:'.length)) : k.length > 0 && k.length <= 200
}

/** Số chỗ cũ của ô đã đóng giữ lại tối đa (agent đã xoá thì renderer tự bỏ, xem reconcile). */
const CLOSED_MAX = 200

/**
 * Chuẩn hoá bố cục đọc từ agents.json / nhận từ renderer. Bố cục cũ (cây chia đôi) được đổi sang canvas. Ô hỏng bị
 * bỏ, ô trùng (cùng agent / cùng widget) chỉ giữ ô đầu, kích thước dưới mức tối thiểu được nới. Ô widget giữ nguyên dù
 * plugin đã gỡ: renderer hiện lời nhắc, người dùng tự đóng. Không biết agent nào còn tồn tại — renderer bỏ ô của agent
 * đã xoá (reconcile).
 */
export function normalizeLayout(raw: unknown): CanvasLayout {
  if (!raw || typeof raw !== 'object') return emptyCanvas()
  const o = raw as Record<string, unknown>
  if (typeof o.type === 'string') return { cells: treeToCells(normalizeLegacyTree(raw)), closed: {}, view: null }
  const seen = new Set<string>()
  const cells: CanvasCell[] = []
  for (const v of Array.isArray(o.cells) ? o.cells : []) {
    if (!v || typeof v !== 'object') continue
    const ref = parseRef(v as Record<string, unknown>)
    const rect = parseRect(v)
    if (!ref || !rect || seen.has(cellKey(ref))) continue
    seen.add(cellKey(ref))
    const z = (v as Record<string, unknown>).z
    cells.push({ ...ref, ...rect, z: num(z) ? z : cells.length + 1 })
  }
  const closed: Record<string, CanvasRect> = {}
  if (o.closed && typeof o.closed === 'object') {
    for (const [k, v] of Object.entries(o.closed as Record<string, unknown>).slice(-CLOSED_MAX)) {
      const rect = parseRect(v)
      if (rect && validKey(k) && !seen.has(k)) closed[k] = rect
    }
  }
  return { cells, closed, view: parseView(o.view) }
}
