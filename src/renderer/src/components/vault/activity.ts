import type { VaultActivity } from '@shared/types'

/** Hoạt động trong khoảng này được coi là "gần đây" (chấm trên cây, quầng trên graph). */
export const RECENT_MS = 15 * 60_000

/** Màu riêng của mỗi agent (băm id → sắc độ), dùng chung cho cây, note và graph. */
export function agentColor(agentId: string): string {
  let h = 2166136261
  for (let i = 0; i < agentId.length; i++) h = Math.imul(h ^ agentId.charCodeAt(i), 16777619)
  return `hsl(${(h >>> 0) % 360}, 70%, 62%)`
}

/** Lần gần nhất mỗi agent đọc / ghi một note. */
export interface NoteTouch {
  agentId: string
  agentName: string
  kind: 'read' | 'write'
  at: string
}

/**
 * Gom nhật ký theo note (khoá = `rel` chữ thường): mỗi agent một dòng, ưu tiên lần ghi (ghi quan trọng hơn
 * đọc), mới nhất trước. `since` = chỉ lấy hoạt động từ mốc này (ms); bỏ trống = tất cả.
 */
export function touchesByNote(events: VaultActivity[], since = 0): Map<string, NoteTouch[]> {
  const out = new Map<string, NoteTouch[]>()
  for (const e of events) {
    const t = Date.parse(e.at)
    if (t < since) continue
    const key = e.rel.toLowerCase()
    const list = out.get(key) ?? []
    const i = list.findIndex((x) => x.agentId === e.agentId)
    const touch: NoteTouch = { agentId: e.agentId, agentName: e.agentName, kind: e.kind, at: e.at }
    if (i < 0) list.push(touch)
    else {
      const cur = list[i]
      // Lần ghi giữ chỗ trước lần đọc sau đó; còn lại lấy lần mới hơn.
      if (e.kind === 'write' || cur.kind === 'read') list[i] = cur.kind === 'write' && e.kind === 'read' ? cur : touch
    }
    out.set(key, list)
  }
  for (const list of out.values()) list.sort((a, b) => b.at.localeCompare(a.at))
  return out
}
