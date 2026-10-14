import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Task, Workspace } from '@shared/types'
import { ArtifactStore, commentMessage, projectFile } from './artifactStore'

// artifactStore.ts → workspace.ts có import `app` của Electron (không dùng tới ở đây).
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }))

let root: string
let ws: Workspace
let store: ArtifactStore
const queued: string[] = []

const agent: Agent = { id: 'ag1', workspaceId: 'ws1', name: 'Tester', role: '', permissionMode: 'default', createdAt: '2026-01-01T00:00:00.000Z' }
const task: Task = { id: 't1', agentId: 'ag1', agentName: 'Tester', sessionId: 's1', title: 'Smoke test', scope: 'docs/', status: 'open', createdAt: '2026-10-12T09:00:00.000Z' }

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-art-'))
  ws = { id: 'ws1', name: 'W', path: root, vaultPath: join(root, 'vault'), createdAt: '' } as Workspace
  queued.length = 0
  store = new ArtifactStore(
    () => {},
    (id) => queued.push(id)
  )
  await fs.mkdir(join(root, 'docs'), { recursive: true })
})

afterEach(async () => {
  await store.flush()
  await fs.rm(root, { recursive: true, force: true })
})

const write = (rel: string, text: string): Promise<void> => fs.writeFile(join(root, rel), text, 'utf8')

describe('projectFile', () => {
  it('accepts paths inside the project, keeps case, rejects outside and app folders', () => {
    expect(projectFile(root, root, 'docs/Report.md')).toBe('docs/Report.md')
    expect(projectFile(root, join(root, 'docs'), './a.png')).toBe('docs/a.png')
    expect(projectFile(root, root, join(root, 'docs', 'x.md'))).toBe('docs/x.md')
    expect(() => projectFile(root, root, '../evil.md')).toThrow(/outside/)
    expect(() => projectFile(root, root, '.stag/artifacts/index.json')).toThrow(/cannot be published/)
    expect(() => projectFile(root, root, '')).toThrow(/empty/)
  })
})

describe('ArtifactStore publish', () => {
  it('needs a task and an existing file; failures are recorded', async () => {
    await expect(store.publish(ws, agent, null, { file: 'docs/r.md', title: 'R', description: '' })).rejects.toThrow(/task_start/)
    await expect(store.publish(ws, agent, task, { file: 'docs/none.md', title: 'R', description: '' })).rejects.toThrow(/does not exist/)
    const snap = await store.snapshot(ws)
    expect(snap.artifacts).toHaveLength(0)
    expect(snap.failures.map((f) => f.error)).toHaveLength(2)
    expect(snap.failures[1]).toMatchObject({ taskId: 't1', file: 'docs/none.md' })
  })

  it('snapshots each version, keeps block ids, skips unchanged content', async () => {
    await write('docs/r.md', '# Report\n\nAll areas pass.\n\nNote: not tried on a clean machine.\n')
    const r1 = await store.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report', description: 'Smoke test' })
    expect(r1).toMatch(/as v1 \(artifact a1/)
    await write('docs/r.md', '# Report\n\nAll areas pass, including Settings.\n\nRepro steps added.\n')
    const r2 = await store.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report', description: 'Smoke test v2', note: 'Added settings' })
    expect(r2).toMatch(/as v2/)
    const r3 = await store.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report!', description: 'same' })
    expect(r3).toMatch(/unchanged since v2/)

    const { artifacts } = await store.snapshot(ws)
    expect(artifacts).toHaveLength(1)
    const a = artifacts[0]
    expect(a).toMatchObject({ id: 'a1', rel: 'docs/r.md', title: 'Report!', taskId: 't1', seen: 0 })
    expect(a.versions.map((v) => [v.v, v.note, v.snapshot, v.blocks])).toEqual([
      [1, '', '.stag/artifacts/a1/v1.md', true],
      [2, 'Added settings', '.stag/artifacts/a1/v2.md', true]
    ])
    expect(await fs.readFile(join(root, '.stag/artifacts/a1/v1.md'), 'utf8')).toMatch(/clean machine/)
    const b1 = await store.blocks(ws, 'a1', 1)
    const b2 = await store.blocks(ws, 'a1', 2)
    expect(b2[0].id).toBe(b1[0].id)
    expect(b2[1].id).toBe(b1[1].id)
    expect(b2[2].id).not.toBe(b1[2].id)
  })

  it('binary files get snapshots without blocks', async () => {
    await fs.writeFile(join(root, 'docs/a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]))
    await store.publish(ws, agent, task, { file: 'docs/a.png', title: 'Shot', description: '' })
    const a = (await store.snapshot(ws)).artifacts[0]
    expect(a.versions[0].blocks).toBeUndefined()
    expect(a.versions[0].snapshot).toBe('.stag/artifacts/a1/v1.png')
  })
})

describe('ArtifactStore comments', () => {
  beforeEach(async () => {
    await write('docs/r.md', '# Report\n\nOne.\n')
    await store.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report', description: '' })
  })

  it('drafts, batch send, delivery, reply, fix, close', async () => {
    const d1 = await store.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'More detail', send: false })
    const d2 = await store.addComment(ws, 'a1', { v: 1, anchor: { type: 'pin', x: 2, y: 0.5 }, text: 'Circle this', send: false })
    expect([d1.id, d1.no, d1.state, d2.no]).toEqual(['c1', 1, 'draft', 2])
    expect(d2.anchor).toEqual({ type: 'pin', x: 1, y: 0.5 })
    expect(await store.queuedFor('ag1')).toEqual([])

    expect(await store.sendDrafts(ws, 'a1')).toBe(2)
    const q = await store.queuedFor('ag1')
    expect(q[0].comments.map((c) => c.id)).toEqual(['c1', 'c2'])
    await vi.waitFor(() => expect(queued).toContain('ag1'))
    const msg = commentMessage(q)
    expect(msg).toMatch(/\[c1\] on the whole artifact: More detail/)
    expect(msg).toMatch(/artifact_publish/)

    await store.delivered(ws, ['c1', 'c2'])
    await store.reply(ws, agent, { id: 'c1', text: 'Which part?', options: ['Results', 'All'] })
    let a = (await store.snapshot(ws)).artifacts[0]
    expect(a.comments[0]).toMatchObject({ state: 'you' })
    expect(a.comments[0].thread[1]).toMatchObject({ by: 'agent', name: 'Tester', options: ['Results', 'All'] })

    // Trả lời rồi huỷ gửi: về lại trạng thái trước, chữ trả về để soạn tiếp.
    await store.say(ws, 'c1', 'Results')
    expect((await store.unsend(ws, 'c1'))).toEqual({ text: 'Results', draft: false })
    a = (await store.snapshot(ws)).artifacts[0]
    expect(a.comments[0].state).toBe('you')
    expect(a.comments[0].thread).toHaveLength(2)

    await write('docs/r.md', '# Report\n\nOne, circled.\n')
    const r = await store.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report', description: '', fixes: ['c2', 'c99'] })
    expect(r).toMatch(/Marked fixed in v2: c2/)
    expect(r).toMatch(/ignored\): c99/)
    a = (await store.snapshot(ws)).artifacts[0]
    expect(a.comments[1]).toMatchObject({ state: 'fixed', fixedIn: 2 })
    expect(a.versions[1].fixes).toEqual(['c2'])

    await store.close(ws, 'c2')
    expect((await store.snapshot(ws)).artifacts[0].comments[1].state).toBe('closed')
  })

  it('unsend of a single-message comment returns it to drafts; sent comments cannot be unsent', async () => {
    await store.addComment(ws, 'a1', { v: 1, anchor: { type: 'time', t: 11 }, text: 'Which key?', send: true })
    expect(await store.unsend(ws, 'c1')).toEqual({ text: 'Which key?', draft: true })
    await store.sendDrafts(ws, 'a1')
    await store.delivered(ws, ['c1'])
    await expect(store.unsend(ws, 'c1')).rejects.toThrow(/không huỷ/)
  })

  it('drafts can be edited and deleted; seen and hide persist across reloads', async () => {
    await store.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'x', send: false })
    await store.editDraft(ws, 'c1', 'y')
    expect((await store.snapshot(ws)).artifacts[0].comments[0].thread[0].text).toBe('y')
    await store.deleteDraft(ws, 'c1')
    await store.markSeen(ws, 'a1')
    await store.hide(ws, 'a1')
    await store.flush()
    const again = new ArtifactStore(() => {})
    const a = (await again.snapshot(ws)).artifacts[0]
    expect(a).toMatchObject({ seen: 1, hidden: true, comments: [] })
    // Nộp lại → hiện lại.
    await write('docs/r.md', 'changed')
    expect(await again.publish(ws, agent, task, { file: 'docs/r.md', title: 'Report', description: '' })).toMatch(/shown again/)
    await again.flush()
  })

  it('chỉ agent sở hữu được trả lời góp ý; agent khác nộp đè khi việc của chủ còn mở → bị từ chối, việc đã đóng → nhận quyền', async () => {
    const other: Agent = { ...agent, id: 'ag2', name: 'Other' }
    const otherTask: Task = { ...task, id: 't2', agentId: 'ag2', agentName: 'Other' }
    await store.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'Why?', send: true })
    await store.delivered(ws, ['c1'])
    await expect(store.reply(ws, other, { id: 'c1', text: 'Because.' })).rejects.toThrow(/belongs to Tester, whose task "Smoke test" is still open\. Only Tester can reply/)

    // Không có cách biết việc còn mở (taskOpen) → coi như còn mở.
    await write('docs/r.md', '# Report\n\nTwo.\n')
    await expect(store.publish(ws, other, otherTask, { file: 'docs/r.md', title: 'Mine', description: '' })).rejects.toThrow(/still open/)

    const open = new Set(['t1'])
    const s2 = new ArtifactStore(() => {}, (id) => queued.push(id), async (_w, id) => open.has(id))
    await expect(s2.publish(ws, other, otherTask, { file: 'docs/r.md', title: 'Mine', description: '' })).rejects.toThrow(/still open/)
    open.delete('t1')
    await s2.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'Queued for the owner', send: true })
    queued.length = 0
    expect(await s2.publish(ws, other, otherTask, { file: 'docs/r.md', title: 'Mine', description: '' })).toMatch(/took over this artifact from Tester/)
    const a = (await s2.snapshot(ws)).artifacts[0]
    expect([a.agentId, a.versions.length]).toEqual(['ag2', 2])
    expect(queued).toContain('ag2')
    expect(await s2.reply(ws, other, { id: 'c1', text: 'Done.' })).toMatch(/Reply added/)
    // Trả lời góp ý của sản phẩm mà việc của chủ đã đóng (vd. sau bàn giao): nhận quyền luôn.
    const third: Agent = { ...agent, id: 'ag3', name: 'Third' }
    open.add('t2')
    await expect(s2.reply(ws, third, { id: 'c1', text: 'Hi' })).rejects.toThrow(/belongs to Other/)
    open.delete('t2')
    expect(await s2.reply(ws, third, { id: 'c1', text: 'Hi' })).toMatch(/took over artifact a1 from Other/)
    expect((await s2.snapshot(ws)).artifacts[0].agentId).toBe('ag3')
    await s2.flush()
  })

  it('index.json đổi trên đĩa (bản app khác / git checkout) → đọc lại trước khi sửa, không ghi đè mất', async () => {
    const a = new ArtifactStore(() => {})
    const b = new ArtifactStore(() => {})
    await a.snapshot(ws)
    await b.snapshot(ws)
    await a.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'from A', send: false })
    await a.flush()
    await b.addComment(ws, 'a1', { v: 1, anchor: { type: 'general' }, text: 'from B', send: false })
    await b.flush()
    const c = new ArtifactStore(() => {})
    const comments = (await c.snapshot(ws)).artifacts[0].comments
    expect(comments.map((x) => [x.id, x.thread[0].text])).toEqual([
      ['c1', 'from A'],
      ['c2', 'from B']
    ])
  })
})
