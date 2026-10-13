// Cột trái tab "Sản phẩm": gom sản phẩm theo việc của agent, nhóm theo ngày, lọc project / agent, tìm kiếm.
import { dayBucket, needsYou, unseenVersions, type ArtifactRecord, type ArtifactsSnapshot, type DayBucket, type PublishFailure } from '@shared/artifacts'
import type { Task } from '@shared/types'
import { fold } from '../vault/highlight'

export interface TaskEntry {
  /** Id việc (việc đã bị xoá vẫn giữ id cũ, lấy tên từ sản phẩm). */
  id: string
  /** Project của agent lúc nhận việc (vắng = Chung, hoặc việc cũ / không gắn việc: xem theo agent). */
  projectId?: string
  title: string
  agentId: string
  agentName: string
  status: Task['status']
  bucket: DayBucket
  /** ISO: lúc bắt đầu (đang làm) hoặc lúc xong. */
  when: string
  summary: string
  /** Sản phẩm đang hiện (không tính đã gỡ), mới nhất trước. */
  artifacts: ArtifactRecord[]
  failures: PublishFailure[]
}

export const BUCKETS: Array<{ id: DayBucket; label: string }> = [
  { id: 'run', label: 'ĐANG LÀM' },
  { id: 'today', label: 'HÔM NAY' },
  { id: 'yday', label: 'HÔM QUA' },
  { id: 'week', label: 'TUẦN NÀY' },
  { id: 'older', label: 'CŨ HƠN' }
]

/** Mỗi lần "Tải thêm" ở nhóm Cũ hơn. */
export const OLDER_PAGE = 20

/** Việc + sản phẩm của từng việc. Sản phẩm gắn với việc không còn → một việc "giữ chỗ". */
export function buildEntries(tasks: readonly Task[], snap: ArtifactsSnapshot | undefined, now: Date = new Date()): TaskEntry[] {
  const arts = (snap?.artifacts ?? []).filter((a) => !a.hidden && a.versions.length)
  const byTask = new Map<string, ArtifactRecord[]>()
  for (const a of arts) {
    const k = a.taskId ?? '∅'
    byTask.set(k, [...(byTask.get(k) ?? []), a])
  }
  const fails = new Map<string, PublishFailure[]>()
  for (const f of snap?.failures ?? []) if (f.taskId) fails.set(f.taskId, [...(fails.get(f.taskId) ?? []), f])
  const newest = (list: ArtifactRecord[]): ArtifactRecord[] => [...list].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
  const out: TaskEntry[] = tasks.map((t) => ({
    id: t.id,
    ...(t.projectId ? { projectId: t.projectId } : {}),
    title: t.title,
    agentId: t.agentId,
    agentName: t.agentName,
    status: t.status,
    bucket: dayBucket(t, now),
    when: t.status === 'open' ? t.createdAt : (t.doneAt ?? t.createdAt),
    summary: t.summary ?? '',
    artifacts: newest(byTask.get(t.id) ?? []),
    failures: fails.get(t.id) ?? []
  }))
  const known = new Set(tasks.map((t) => t.id))
  for (const [k, list] of byTask) {
    if (known.has(k)) continue
    const a = newest(list)[0]
    out.push({
      id: k,
      title: a.taskTitle || 'Không gắn việc',
      agentId: a.agentId,
      agentName: a.agentName,
      status: 'done',
      bucket: dayBucket({ status: 'done', createdAt: a.updatedAt }, now),
      when: a.updatedAt,
      summary: '',
      artifacts: newest(list),
      failures: []
    })
  }
  const rank = (e: TaskEntry): number => (e.status === 'open' ? 1 : 0)
  return out.sort((x, y) => rank(y) - rank(x) || y.when.localeCompare(x.when))
}

/** Việc hiện ở cột trái: theo agent; việc không có sản phẩm chỉ hiện khi đang làm hoặc bật công tắc. */
export function visibleEntries(entries: readonly TaskEntry[], o: { agentId: string | null; showEmpty: boolean }): TaskEntry[] {
  return entries.filter((e) => (!o.agentId || e.agentId === o.agentId) && (e.artifacts.length > 0 || e.status === 'open' || o.showEmpty))
}

/** Số việc ẩn vì không có sản phẩm (để ghi trên công tắc). */
export function emptyCount(entries: readonly TaskEntry[], agentId: string | null): number {
  return entries.filter((e) => (!agentId || e.agentId === agentId) && !e.artifacts.length && e.status !== 'open').length
}

export interface Group {
  id: DayBucket
  label: string
  entries: TaskEntry[]
  /** Nhóm Cũ hơn: số việc còn chưa tải. */
  more: number
}

/** Nhóm theo ngày; nhóm Cũ hơn chỉ hiện `olderShown` việc đầu (tính sau khi lọc agent). */
export function groupEntries(entries: readonly TaskEntry[], olderShown: number): Group[] {
  const out: Group[] = []
  for (const b of BUCKETS) {
    const list = entries.filter((e) => e.bucket === b.id)
    if (!list.length) continue
    const shown = b.id === 'older' ? list.slice(0, olderShown) : list
    out.push({ id: b.id, label: b.label, entries: shown, more: list.length - shown.length })
  }
  return out
}

export interface SearchHit {
  artifact: ArtifactRecord
  entry: TaskEntry
  /** Chỗ khớp (để hiện dòng phụ): tên → tên việc, còn lại → chính chữ khớp. */
  field: 'title' | 'description' | 'file' | 'agent' | 'task'
  text: string
}

/** Tìm thẳng ra sản phẩm (không phân biệt hoa thường / dấu) theo tên, mô tả, file, agent, tên việc. */
export function searchArtifacts(entries: readonly TaskEntry[], query: string, agentId: string | null): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const e of entries) {
    if (agentId && e.agentId !== agentId) continue
    for (const a of e.artifacts) {
      const fields: Array<[SearchHit['field'], string]> = [
        ['title', a.title],
        ['description', a.description],
        ['file', a.rel],
        ['agent', a.agentName],
        ['task', e.title]
      ]
      const all = fold(fields.map((f) => f[1]).join('\n'))
      if (!terms.every((t) => all.includes(t))) continue
      const hit = fields.find(([, s]) => terms.some((t) => fold(s).includes(t))) ?? fields[0]
      hits.push({ artifact: a, entry: e, field: hit[0], text: hit[1] })
    }
  }
  return hits
}

/** Chấm / số trên dòng việc. */
export function entryBadges(e: TaskEntry): { unread: boolean; you: number; drafts: number } {
  let you = 0
  let drafts = 0
  for (const a of e.artifacts)
    for (const c of a.comments) {
      if (needsYou(c)) you++
      else if (c.state === 'draft') drafts++
    }
  return { unread: e.artifacts.some((a) => unseenVersions(a) > 0), you, drafts }
}
