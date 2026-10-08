// Đồng bộ note đang sửa trong app với file trên đĩa (Obsidian hoặc agent có thể sửa cùng lúc).

/**
 * File trên đĩa vừa đọc lại (`disk`, null = đã bị xoá) so với `base` (nội dung lúc bắt đầu sửa / lần lưu gần
 * nhất) và chữ đang có trong trình soạn (`text`):
 * - 'same': không ai sửa bên ngoài (hoặc đó chính là lần lưu của mình).
 * - 'adopt': bên ngoài đổi đúng thành chữ đang soạn → chỉ cần coi là đã lưu.
 * - 'reload': bên ngoài đổi, người dùng chưa gõ gì → nạp bản trên đĩa.
 * - 'conflict': cả hai cùng đổi → hỏi người dùng giữ bản nào.
 */
export type SyncAction = 'same' | 'adopt' | 'reload' | 'conflict'

export function syncAction(disk: string | null, base: string, text: string): SyncAction {
  if (disk === base) return 'same'
  if (disk === text) return 'adopt'
  if (text === base && disk !== null) return 'reload'
  return 'conflict'
}

/** Chữ trước con trỏ đang gõ một wikilink `[[…` → phần tên đã gõ (để gợi ý note), không thì null. */
export function wikilinkQuery(before: string): string | null {
  const m = /\[\[([^\]|#\n]*)$/.exec(before)
  return m ? m[1] : null
}
