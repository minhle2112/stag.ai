import { describe, expect, it } from 'vitest'
import type { ArtifactRecord, ArtifactsSnapshot } from '@shared/artifacts'
import type { Task } from '@shared/types'
import { buildEntries, emptyCount, entryBadges, groupEntries, searchArtifacts, visibleEntries } from './products'

const now = new Date(2026, 9, 12, 15, 0)
const iso = (d: number, h = 10): string => new Date(2026, 9, d, h).toISOString()

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  agentId: 'tester',
  agentName: 'Tester',
  sessionId: 's',
  title: `Task ${id}`,
  scope: '',
  status: 'done',
  createdAt: iso(12, 8),
  doneAt: iso(12, 11),
  ...over
})

const art = (id: string, taskId: string | null, over: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  id,
  rel: `docs/${id}.md`,
  title: `Báo cáo ${id}`,
  description: 'Kết quả smoke test',
  agentId: 'tester',
  agentName: 'Tester',
  taskId,
  taskTitle: `Old ${taskId}`,
  createdAt: iso(12),
  updatedAt: iso(12),
  versions: [{ v: 1, at: iso(12), note: '', snapshot: '', size: 1, sha256: '', agentId: 'tester', agentName: 'Tester', taskId }],
  seen: 1,
  comments: [],
  ...over
})

describe('buildEntries', () => {
  const snap: ArtifactsSnapshot = {
    artifacts: [art('a1', 't1'), art('a2', 't1', { updatedAt: iso(12, 12) }), art('a3', 'gone'), art('a4', 't2', { hidden: true })],
    failures: [{ at: iso(12), agentId: 'tester', agentName: 'Tester', taskId: 't3', file: 'x.json', error: 'missing' }]
  }
  const tasks = [
    task('t1'),
    task('t2', { doneAt: iso(11, 21) }),
    task('t3', { status: 'open', agentId: 'dev', agentName: 'Dev' }),
    task('t4', { doneAt: iso(1) })
  ]
  const entries = buildEntries(tasks, snap, now)

  it('attaches artifacts (newest first), keeps orphans, puts running tasks first', () => {
    expect(entries.map((e) => [e.id, e.bucket, e.artifacts.map((a) => a.id)])).toEqual([
      ['t3', 'run', []],
      ['t1', 'today', ['a2', 'a1']],
      ['gone', 'today', ['a3']],
      ['t2', 'yday', []],
      ['t4', 'older', []]
    ])
    expect(entries.find((e) => e.id === 'gone')!.title).toBe('Old gone')
    expect(entries[0].failures).toHaveLength(1)
  })

  it('hides tasks without artifacts unless running or the switch is on; filters by agent', () => {
    expect(visibleEntries(entries, { agentId: null, showEmpty: false }).map((e) => e.id)).toEqual(['t3', 't1', 'gone'])
    expect(visibleEntries(entries, { agentId: 'tester', showEmpty: true }).map((e) => e.id)).toEqual(['t1', 'gone', 't2', 't4'])
    expect(emptyCount(entries, null)).toBe(2)
  })

  it('pages the older group after filtering', () => {
    const many = buildEntries(
      Array.from({ length: 25 }, (_, i) => task(`o${i}`, { doneAt: iso(1, i % 20) })),
      { artifacts: Array.from({ length: 25 }, (_, i) => art(`x${i}`, `o${i}`)), failures: [] },
      now
    )
    const g = groupEntries(many, 20)
    expect(g).toHaveLength(1)
    expect([g[0].id, g[0].entries.length, g[0].more]).toEqual(['older', 20, 5])
  })

  it('search goes straight to artifacts, accent-insensitive, all terms', () => {
    const hits = searchArtifacts(entries, 'bao cao a2', null)
    expect(hits.map((h) => h.artifact.id)).toEqual(['a2'])
    expect(hits[0].field).toBe('title')
    expect(searchArtifacts(entries, 'smoke', 'dev')).toEqual([])
    expect(searchArtifacts(entries, 'old gone', null).map((h) => [h.artifact.id, h.field])).toEqual([['a3', 'task']])
  })

  it('badges count unread versions, comments needing you and drafts', () => {
    const e = buildEntries(
      [task('t1')],
      {
        artifacts: [
          art('a1', 't1', {
            seen: 0,
            comments: [
              { id: 'c1', v: 1, no: 1, anchor: { type: 'general' }, state: 'you', thread: [], createdAt: '', updatedAt: '' },
              { id: 'c2', v: 1, no: 2, anchor: { type: 'general' }, state: 'draft', thread: [], createdAt: '', updatedAt: '' }
            ]
          })
        ],
        failures: []
      },
      now
    )
    expect(entryBadges(e[0])).toEqual({ unread: true, you: 1, drafts: 1 })
  })
})
