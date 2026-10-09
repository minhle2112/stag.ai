import { PLUGIN_ID_RE, PLUGIN_SLOT_RE } from '@shared/plugins'
import type { LayoutNode } from '@shared/types'

/** "<id plugin>/<id slot>" (id plugin và id slot không có "/"). */
function validWidget(w: string): boolean {
  const [pluginId, slotId, ...rest] = w.split('/')
  return !rest.length && PLUGIN_ID_RE.test(pluginId) && PLUGIN_SLOT_RE.test(slotId ?? '')
}

/**
 * Chuẩn hoá lưới ô đọc từ agents.json / nhận từ renderer: bỏ nút hỏng (ô hỏng thì ô anh em chiếm chỗ), tỉ lệ ngoài
 * 0.05–0.95 kẹp lại, ô trùng (cùng agent / cùng widget) chỉ giữ ô đầu. Ô widget giữ nguyên dù plugin đã gỡ: renderer
 * hiện lời nhắc, người dùng tự đóng. Không biết agent nào còn tồn tại — renderer bỏ ô của agent đã xoá (reconcile).
 */
export function normalizeLayout(raw: unknown): LayoutNode | null {
  const seen = new Set<string>()
  const walk = (v: unknown, depth: number): LayoutNode | null => {
    if (!v || typeof v !== 'object' || depth > 64) return null
    const n = v as Record<string, unknown>
    if (n.type === 'leaf') {
      if (typeof n.agentId !== 'string' || !n.agentId || n.agentId.startsWith('widget:')) return null
      const key = `agent:${n.agentId}`
      if (seen.has(key)) return null
      seen.add(key)
      return { type: 'leaf', agentId: n.agentId }
    }
    if (n.type === 'widget') {
      if (typeof n.widget !== 'string' || !validWidget(n.widget)) return null
      const key = `widget:${n.widget}`
      if (seen.has(key)) return null
      seen.add(key)
      return { type: 'widget', widget: n.widget }
    }
    if (n.type === 'split') {
      const a = walk(n.a, depth + 1)
      const b = walk(n.b, depth + 1)
      if (!a) return b
      if (!b) return a
      const dir = n.dir === 'col' ? 'col' : 'row'
      const ratio = typeof n.ratio === 'number' && Number.isFinite(n.ratio) ? Math.min(0.95, Math.max(0.05, n.ratio)) : 0.5
      return { type: 'split', dir, ratio, a, b }
    }
    return null
  }
  return walk(raw, 0)
}
