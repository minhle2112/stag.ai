import type { LayoutCell, LayoutNode, SplitDir } from '@shared/types'

export type LayoutPath = Array<'a' | 'b'>

/**
 * Mã ô trong lưới: ô agent = id agent (UUID), ô widget = "widget:<id plugin>/<id slot>". Các hàm dưới đây nhận mã ô
 * nên mọi chỗ đang truyền id agent (chọn ô, đổi chỗ, chia ô cạnh ô đang chọn) vẫn đúng.
 */
export const widgetKey = (widget: string): string => `widget:${widget}`

export function cellKey(cell: LayoutCell): string {
  return cell.type === 'leaf' ? cell.agentId : widgetKey(cell.widget)
}

/** Mọi ô lá theo thứ tự trái sang phải. */
function cellNodes(node: LayoutNode | null): LayoutCell[] {
  if (!node) return []
  return node.type === 'split' ? [...cellNodes(node.a), ...cellNodes(node.b)] : [node]
}

/** Id các agent có ô trong lưới (không gồm widget). */
export function leaves(node: LayoutNode | null): string[] {
  return cellNodes(node).flatMap((c) => (c.type === 'leaf' ? [c.agentId] : []))
}

/** Mã mọi ô (agent + widget). */
export function cells(node: LayoutNode | null): string[] {
  return cellNodes(node).map(cellKey)
}

/** Widget đang có ô ("<id plugin>/<id slot>"). */
export function widgets(node: LayoutNode | null): string[] {
  return cellNodes(node).flatMap((c) => (c.type === 'widget' ? [c.widget] : []))
}

/** Thêm ô `cell` cạnh ô có mã `targetKey` (không có thì chia đôi toàn bộ lưới). */
export function insertCell(node: LayoutNode | null, targetKey: string | null, cell: LayoutCell, dir: SplitDir): LayoutNode {
  if (!node) return cell
  if (targetKey && cells(node).includes(targetKey)) {
    const walk = (n: LayoutNode): LayoutNode => {
      if (n.type !== 'split') return cellKey(n) === targetKey ? { type: 'split', dir, ratio: 0.5, a: n, b: cell } : n
      return { ...n, a: walk(n.a), b: walk(n.b) }
    }
    return walk(node)
  }
  return { type: 'split', dir, ratio: 0.5, a: node, b: cell }
}

/** Thêm ô agent mới cạnh ô `targetKey` (mã ô: id agent hoặc widgetKey). */
export function insertLeaf(node: LayoutNode | null, targetKey: string | null, newId: string, dir: SplitDir): LayoutNode {
  return insertCell(node, targetKey, { type: 'leaf', agentId: newId }, dir)
}

/** Bỏ ô có mã `key` (id agent hoặc widgetKey); ô anh em chiếm chỗ của nhánh cha. */
export function removeLeaf(node: LayoutNode | null, key: string): LayoutNode | null {
  if (!node) return null
  if (node.type !== 'split') return cellKey(node) === key ? null : node
  const a = removeLeaf(node.a, key)
  const b = removeLeaf(node.b, key)
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/** Đổi chỗ hai ô (theo mã ô); khung chia và tỉ lệ giữ nguyên. */
export function swapLeaves(node: LayoutNode | null, x: string, y: string): LayoutNode | null {
  if (!node || x === y) return node
  const all = cellNodes(node)
  const cx = all.find((c) => cellKey(c) === x)
  const cy = all.find((c) => cellKey(c) === y)
  if (!cx || !cy) return node
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'split') return { ...n, a: walk(n.a), b: walk(n.b) }
    const k = cellKey(n)
    return k === x ? cy : k === y ? cx : n
  }
  return walk(node)
}

export function setRatio(node: LayoutNode, path: LayoutPath, ratio: number): LayoutNode {
  if (node.type !== 'split') return node
  if (path.length === 0) return { ...node, ratio }
  const [head, ...rest] = path
  return { ...node, [head]: setRatio(node[head], rest, ratio) }
}

/**
 * Đồng bộ lưới với danh sách agent: bỏ ô của agent đã xoá. Agent không có ô là agent người dùng
 * đã đóng ô — vẫn nằm ở thanh bên, không tự thêm lại. Ô widget giữ nguyên (plugin đã gỡ / tắt thì ô hiện lời nhắc).
 */
export function reconcile(node: LayoutNode | null, agentIds: string[]): LayoutNode | null {
  let result = node
  for (const id of leaves(node)) if (!agentIds.includes(id)) result = removeLeaf(result, id)
  return result
}
