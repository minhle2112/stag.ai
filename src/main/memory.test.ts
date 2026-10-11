import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Agent, MemoryToolsMode, Workspace } from '@shared/types'
import type { Board } from './board'
import type { BrowserService } from './browser'
import { createStagMcp, MEMORY_TOOLS_OFF } from './mcp'
import { MemoryService, memoryToolRules, toRel, versionOf, type Touch } from './memory'
import { VaultIndexer } from './vaultIndex'
import { NoteWriter } from './workLog'

vi.mock('./browser', () => ({ BROWSER_KEYS: ['Enter'] }))

let vault: string
const SECRET = 'my-own-secret-value-123'

async function put(rel: string, text: string): Promise<void> {
  await fs.mkdir(join(vault, rel, '..'), { recursive: true })
  await fs.writeFile(join(vault, rel), text, 'utf8')
}
const read = (rel: string): Promise<string> => fs.readFile(join(vault, rel), 'utf8')

beforeEach(async () => {
  vault = await fs.mkdtemp(join(tmpdir(), 'stag-mem-'))
  await put('_INDEX.md', '---\ntype: index\n---\n# Index\n\n- [[Kanban]]\n- [[Workspace and Vault]]\n- [[Ghost note]]\n')
  await put('30 Features/Kanban.md', '---\ntype: feature\ntags: [ui, board]\nstatus: done\n---\n# Kanban\n\nBack to: [[_INDEX]]\n\n## Columns\nTodo, working, done.\n\n## Kế hoạch\nKéo thả thẻ.\n')
  await put('30 Features/Workspace and Vault.md', '---\ntype: feature\n---\n# Workspace and Vault\n\nSee [[Kanban#Columns|columns]] and [notes](./Kanban.md).\n')
  await put('50 Decisions/2026-10-08 Drop tickets.md', '---\ntype: decision\ndate: 2026-10-08\n---\n# Drop tickets\n\nRelated: [[Kanban]] #board #backend\n')
  await put('50 Decisions/_Template.md', '---\ntype: decision\ntags: [tpl]\n---\n# Decision: <name>\n')
  await put('.obsidian/workspace.json', '{}')
})

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true })
})

async function connect(mode: MemoryToolsMode = 'full'): Promise<{ client: Client; touched: Touch[] }> {
  const touched: Touch[] = []
  const service = new MemoryService(new VaultIndexer(), new NoteWriter(), () => [SECRET])
  const server = createStagMcp({
    agent: { id: 'a1', name: 'A', workspaceId: 'w1' } as Agent,
    workspace: { id: 'w1', name: 'W', path: vault, vaultPath: vault } as Workspace,
    board: {} as Board,
    browser: {} as BrowserService,
    teammates: () => [],
    syncSessionFile: async () => {},
    handoff: async () => {},
    memory: { service, mode, touched: (t) => touched.push(...t) }
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return { client, touched }
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; error: boolean }> {
  const r = await c.callTool({ name, arguments: args })
  return { text: (r.content as Array<{ text: string }>)[0].text, error: !!r.isError }
}

describe('toRel', () => {
  it('chuẩn hoá tên / đường dẫn, chặn ra ngoài vault, thư mục ẩn, ký tự cấm', () => {
    expect(toRel('C:/v', '30 Features\\Kanban')).toBe('30 Features/Kanban.md')
    expect(toRel('C:/v', '[[Kanban]]')).toBe('Kanban.md')
    expect(toRel('C:/v', 'C:/v/40 Log/2026-10-11.md')).toBe('40 Log/2026-10-11.md')
    expect(() => toRel('C:/v', '../x.md')).toThrow()
    expect(() => toRel('C:/v', 'C:/other/x.md')).toThrow(/outside/)
    expect(() => toRel('C:/v', '.obsidian/app.md')).toThrow(/hidden/)
    expect(() => toRel('C:/v', 'a/b?.md')).toThrow(/Bad note name/)
    expect(() => toRel('C:/v', 'pic.png')).toThrow(/\.md/)
  })
})

describe('tool memory_* đọc', () => {
  it('memory_read: theo tên, kèm link / backlink / link hỏng / version; ghi nhận đã đọc', async () => {
    const { client, touched } = await connect()
    const idx = await call(client, 'memory_read', { note: '_INDEX' })
    expect(idx.error).toBe(false)
    expect(idx.text).toContain('links: 30 Features/Kanban.md, 30 Features/Workspace and Vault.md')
    expect(idx.text).toContain('unresolved links: Ghost note')
    const k = await call(client, 'memory_read', { note: 'kanban' })
    expect(k.text).toMatch(/^path: 30 Features\/Kanban\.md/)
    expect(k.text).toContain(`version: ${versionOf(await read('30 Features/Kanban.md'))}`)
    expect(k.text).toContain('tags: ui, board')
    expect(k.text).toMatch(/backlinks: .*_INDEX\.md.*Workspace and Vault\.md.*Drop tickets\.md|backlinks: .*_INDEX\.md/)
    expect(k.text.split('backlinks: ')[1].split('\n')[0].split(', ').sort()).toEqual(
      ['30 Features/Workspace and Vault.md', '50 Decisions/2026-10-08 Drop tickets.md', '_INDEX.md'].sort()
    )
    expect(touched).toEqual([
      { rel: '_INDEX.md', kind: 'read' },
      { rel: '30 Features/Kanban.md', kind: 'read' }
    ])
  })

  it('memory_read theo heading / trường; không có thì gợi ý', async () => {
    const { client } = await connect()
    expect((await call(client, 'memory_read', { note: 'Kanban', heading: 'columns' })).text).toMatch(/Kanban\.md > columns · version \w+\n\nTodo, working, done\.$/)
    expect((await call(client, 'memory_read', { note: 'Kanban', field: 'status' })).text).toBe('done')
    const miss = await call(client, 'memory_read', { note: 'Kanban', heading: 'Nope' })
    expect(miss.error).toBe(true)
    expect(miss.text).toContain('## Columns')
    const none = await call(client, 'memory_read', { note: 'Kanbn' })
    expect(none.error).toBe(true)
    expect(none.text).toMatch(/No note "Kanbn"/)
  })

  it('memory_outline, memory_list, memory_tags', async () => {
    const { client } = await connect()
    const o = await call(client, 'memory_outline', { note: '30 Features/Kanban.md' })
    expect(o.text).toContain('frontmatter: type, tags, status')
    expect(o.text).toContain('  ## Kế hoạch')
    expect((await call(client, 'memory_list')).text).toBe('30 Features/ (2 notes)\n50 Decisions/ (2 notes)\n_INDEX.md')
    expect((await call(client, 'memory_list', { folder: '30 Features/' })).text).toBe('Kanban.md\nWorkspace and Vault.md')
    // Tag trong frontmatter + #tag trong thân; note mẫu không tính.
    expect((await call(client, 'memory_tags')).text).toBe('board (2)\nbackend (1)\nui (1)')
  })

  it('memory_search: không phân biệt dấu, lọc thư mục', async () => {
    const { client } = await connect()
    const r = await call(client, 'memory_search', { query: 'ke hoach' })
    expect(r.text).toContain('30 Features/Kanban.md\n  L13: ## Kế hoạch')
    expect((await call(client, 'memory_search', { query: 'kanban', folder: '50 Decisions' })).text).toMatch(/^50 Decisions\/2026-10-08 Drop tickets\.md/)
    expect((await call(client, 'memory_search', { query: 'zzz' })).text).toMatch(/No notes match/)
  })

  it('memory_query: type, tag, field, links_to, linked_from, ngày', async () => {
    const { client } = await connect()
    const names = async (args: Record<string, unknown>): Promise<string[]> =>
      (await call(client, 'memory_query', args)).text.split('\n').map((l) => l.split(' · ')[0]).sort()
    expect(await names({ type: 'feature' })).toEqual(['30 Features/Kanban.md', '30 Features/Workspace and Vault.md'])
    expect(await names({ tag: '#UI' })).toEqual(['30 Features/Kanban.md'])
    expect(await names({ tag: 'backend' })).toEqual(['50 Decisions/2026-10-08 Drop tickets.md'])
    expect(await names({ type: 'decision', include_templates: true })).toEqual(['50 Decisions/2026-10-08 Drop tickets.md', '50 Decisions/_Template.md'])
    expect(await names({ field: 'status=done' })).toEqual(['30 Features/Kanban.md'])
    expect(await names({ field: 'date' })).toEqual(['50 Decisions/2026-10-08 Drop tickets.md'])
    expect(await names({ links_to: 'Kanban', type: 'decision' })).toEqual(['50 Decisions/2026-10-08 Drop tickets.md'])
    expect(await names({ linked_from: '_INDEX' })).toEqual(['30 Features/Kanban.md', '30 Features/Workspace and Vault.md'])
    expect((await call(client, 'memory_query', { modified_since: '2999-01-01' })).text).toBe('No notes match.')
    expect((await call(client, 'memory_query', { modified_since: 'hôm qua' })).error).toBe(true)
  })
})

describe('tool memory_* ghi', () => {
  it('memory_write: tạo note mới (nhắc frontmatter); ghi đè cần if_version đúng', async () => {
    const { client, touched } = await connect()
    const c = await call(client, 'memory_write', { note: '20 Workflow/Tips', content: '# Tips\n\n- one' })
    expect(c.text).toMatch(/^Created 20 Workflow\/Tips\.md · version \w+\. Note: it has no frontmatter/)
    expect(await read('20 Workflow/Tips.md')).toBe('# Tips\n\n- one\n')
    const noVer = await call(client, 'memory_write', { note: 'Tips', content: 'x' })
    expect(noVer.error).toBe(true)
    expect(noVer.text).toMatch(/already exists \(version \w+\)/)
    const bad = await call(client, 'memory_write', { note: 'Tips', content: 'x', if_version: 'abc' })
    expect(bad.text).toMatch(/changed since you read it/)
    const ok = await call(client, 'memory_write', { note: 'Tips', content: '# Tips v2', if_version: versionOf('# Tips\n\n- one\n') })
    expect(ok.error).toBe(false)
    expect(await read('20 Workflow/Tips.md')).toBe('# Tips v2\n')
    expect(touched.filter((t) => t.kind === 'write')).toHaveLength(2)
  })

  it('chặn bí mật (kho bí mật của app + mẫu khoá rõ ràng), không chặn chữ thường', async () => {
    const { client } = await connect()
    for (const content of [`key ${SECRET}`, 'sk-ant-abcdefghijklmnopqrstuvwx', 'Authorization: Bearer abcdefghijklmnop123']) {
      const r = await call(client, 'memory_append', { note: 'Kanban', content })
      expect(r.error).toBe(true)
      expect(r.text).toMatch(/^Refused: .*secret/)
    }
    expect((await call(client, 'memory_append', { note: 'Kanban', content: 'The token: expires after 1h' })).error).toBe(false)
  })

  it('memory_append: cuối note, dưới heading, tạo heading', async () => {
    const { client } = await connect()
    await call(client, 'memory_append', { note: 'Kanban', content: '- learned x', heading: 'Columns' })
    expect(await read('30 Features/Kanban.md')).toContain('Todo, working, done.\n\n- learned x\n\n## Kế hoạch')
    await call(client, 'memory_append', { note: 'Kanban', content: '- g1', heading: 'Gotchas' })
    expect((await read('30 Features/Kanban.md')).endsWith('## Gotchas\n\n- g1\n')).toBe(true)
    await call(client, 'memory_append', { note: '40 Log/2026-10-11', content: '- line' })
    expect(await read('40 Log/2026-10-11.md')).toBe('- line\n')
  })

  it('memory_patch: heading / trường frontmatter / if_version', async () => {
    const { client } = await connect()
    expect((await call(client, 'memory_patch', { note: 'Kanban', heading: 'Kế hoạch', content: 'Xong.' })).error).toBe(false)
    expect(await read('30 Features/Kanban.md')).toContain('## Kế hoạch\n\nXong.\n')
    await call(client, 'memory_patch', { note: 'Kanban', field: 'status', content: 'archived' })
    await call(client, 'memory_patch', { note: 'Kanban', field: 'tags', content: '' })
    const text = await read('30 Features/Kanban.md')
    expect(text).toMatch(/^---\ntype: feature\nstatus: archived\n---\n/)
    const stale = await call(client, 'memory_patch', { note: 'Kanban', heading: 'Columns', content: 'x', if_version: 'nope' })
    expect(stale.error).toBe(true)
    expect((await call(client, 'memory_patch', { note: 'Kanban', content: 'x' })).text).toMatch(/exactly one of heading or field/)
  })

  it('memory_move: đổi tên, sửa link wiki + markdown ở note khác và trong chính nó', async () => {
    const { client, touched } = await connect()
    const r = await call(client, 'memory_move', { note: 'Kanban', to: 'Board' })
    expect(r.text).toMatch(/^Moved 30 Features\/Kanban\.md → 30 Features\/Board\.md\. Updated 4 link\(s\) in 3 note\(s\)/)
    await expect(fs.access(join(vault, '30 Features/Kanban.md'))).rejects.toThrow()
    expect(await read('_INDEX.md')).toContain('- [[Board]]\n')
    expect(await read('30 Features/Workspace and Vault.md')).toContain('See [[Board#Columns|columns]] and [notes](Board.md).')
    expect(await read('50 Decisions/2026-10-08 Drop tickets.md')).toContain('Related: [[Board]]')
    expect(touched.map((t) => t.rel)).toContain('30 Features/Board.md')
    expect((await call(client, 'memory_move', { note: 'Board', to: 'Workspace and Vault' })).text).toMatch(/already exists/)
  })

  it('memory_delete: chuyển vào .trash, báo note còn link; note ẩn không thấy nữa', async () => {
    const { client } = await connect()
    const r = await call(client, 'memory_delete', { note: 'Workspace and Vault' })
    expect(r.text).toBe('Moved 30 Features/Workspace and Vault.md to the vault trash (.trash/30 Features/Workspace and Vault.md). These notes still link to it: _INDEX.md.')
    expect(await read('.trash/30 Features/Workspace and Vault.md')).toContain('# Workspace and Vault')
    expect((await call(client, 'memory_read', { note: 'Workspace and Vault' })).error).toBe(true)
  })
})

describe('chế độ theo Cài đặt', () => {
  const list = async (c: Client): Promise<string[]> => (await c.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith('memory_'))

  it('full: đủ 11 tool', async () => {
    expect((await list((await connect('full')).client)).length).toBe(11)
  })

  it('read: ẩn tool ghi, gọi thì báo lỗi, file không đổi', async () => {
    const { client } = await connect('read')
    expect((await list(client)).sort()).toEqual(['memory_list', 'memory_outline', 'memory_query', 'memory_read', 'memory_search', 'memory_tags'])
    const r = await call(client, 'memory_append', { note: 'Kanban', content: 'x' })
    expect(r).toEqual({ text: MEMORY_TOOLS_OFF.read, error: true })
    expect(await read('30 Features/Kanban.md')).not.toContain('\nx\n')
  })

  it('off: ẩn hết, gọi thì báo lỗi', async () => {
    const { client } = await connect('off')
    expect(await list(client)).toEqual([])
    expect(await call(client, 'memory_read', { note: 'Kanban' })).toEqual({ text: MEMORY_TOOLS_OFF.off, error: true })
  })

  it('luật phiên theo chế độ', () => {
    expect(memoryToolRules('off')).toBe('')
    expect(memoryToolRules('read')).toContain('read-only')
    expect(memoryToolRules('full')).toContain('memory_patch')
  })
})
