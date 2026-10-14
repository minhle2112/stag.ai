// Sắp xếp agent ở thanh bên khi workspace có project: danh sách agent là một mảng chung (mọi project), nhưng thanh
// bên hiện theo nhóm (Chung / từng project) và chỉ cho kéo trong cùng nhóm. Vị trí thả tính theo nhóm rồi đổi ra
// vị trí trong mảng chung.

/**
 * Chỗ thả trong nhóm khi rê lên dòng thứ `row` của nhóm (`after` = nửa dưới dòng): trước phần tử thứ kết quả
 * (= `group.length`: cuối nhóm). null = thả tại chỗ cũ, không đổi gì.
 */
export function groupDropAt(group: string[], dragId: string, row: number, after: boolean): number | null {
  const from = group.indexOf(dragId)
  const at = row + (after ? 1 : 0)
  return at === from || at === from + 1 ? null : at
}

/** Vị trí đưa vào `moveAgent` để agent `dragId` đứng trước `group[at]` (hoặc sau phần tử cuối nhóm). -1 = không hợp lệ. */
export function moveIndex(all: string[], group: string[], dragId: string, at: number): number {
  const from = all.indexOf(dragId)
  if (from === -1 || !group.length) return -1
  const target = at < group.length ? all.indexOf(group[at]) : all.indexOf(group[group.length - 1]) + 1
  if (target < 0) return -1
  return from < target ? target - 1 : target
}
