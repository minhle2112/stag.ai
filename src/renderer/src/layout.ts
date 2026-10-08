import type { LayoutNode, SplitDir } from '@shared/types'

export type LayoutPath = Array<'a' | 'b'>

export function leaves(node: LayoutNode | null): string[] {
  if (!node) return []
  return node.type === 'leaf' ? [node.agentId] : [...leaves(node.a), ...leaves(node.b)]
}

/** Thêm ô mới cạnh ô `targetId` (không có thì chia đôi toàn bộ lưới). */
export function insertLeaf(node: LayoutNode | null, targetId: string | null, newId: string, dir: SplitDir): LayoutNode {
  const leaf: LayoutNode = { type: 'leaf', agentId: newId }
  if (!node) return leaf
  if (targetId && leaves(node).includes(targetId)) {
    const walk = (n: LayoutNode): LayoutNode => {
      if (n.type === 'leaf') return n.agentId === targetId ? { type: 'split', dir, ratio: 0.5, a: n, b: leaf } : n
      return { ...n, a: walk(n.a), b: walk(n.b) }
    }
    return walk(node)
  }
  return { type: 'split', dir, ratio: 0.5, a: node, b: leaf }
}

/** Bỏ ô của agent; ô anh em chiếm chỗ của nhánh cha. */
export function removeLeaf(node: LayoutNode | null, agentId: string): LayoutNode | null {
  if (!node) return null
  if (node.type === 'leaf') return node.agentId === agentId ? null : node
  const a = removeLeaf(node.a, agentId)
  const b = removeLeaf(node.b, agentId)
  if (!a) return b
  if (!b) return a
  return { ...node, a, b }
}

/** Đổi chỗ hai ô; khung chia và tỉ lệ giữ nguyên. */
export function swapLeaves(node: LayoutNode | null, x: string, y: string): LayoutNode | null {
  if (!node || x === y) return node
  if (node.type === 'leaf') {
    if (node.agentId === x) return { type: 'leaf', agentId: y }
    if (node.agentId === y) return { type: 'leaf', agentId: x }
    return node
  }
  return { ...node, a: swapLeaves(node.a, x, y)!, b: swapLeaves(node.b, x, y)! }
}

export function setRatio(node: LayoutNode, path: LayoutPath, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node
  if (path.length === 0) return { ...node, ratio }
  const [head, ...rest] = path
  return { ...node, [head]: setRatio(node[head], rest, ratio) }
}

/**
 * Đồng bộ lưới với danh sách agent: bỏ ô của agent đã xoá. Agent không có ô là agent người dùng
 * đã đóng ô — vẫn nằm ở thanh bên, không tự thêm lại.
 */
export function reconcile(node: LayoutNode | null, agentIds: string[]): LayoutNode | null {
  let result = node
  for (const id of leaves(node)) if (!agentIds.includes(id)) result = removeLeaf(result, id)
  return result
}
