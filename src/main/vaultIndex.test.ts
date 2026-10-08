import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fold, isHiddenChange, VaultIndexer, VaultWatchers } from './vaultIndex'

let vault: string

async function write(rel: string, text: string): Promise<void> {
  const full = join(vault, ...rel.split('/'))
  await fs.mkdir(join(full, '..'), { recursive: true })
  await fs.writeFile(full, text, 'utf8')
}

beforeEach(async () => {
  vault = await fs.mkdtemp(join(tmpdir(), 'stag-vault-'))
  await write('_INDEX.md', '---\ntype: index\n---\n# INDEX\n- [[Browser]] · [[Kanban#Esc|Esc]] · [[Vault Viewer]]\n- ![[sơ đồ.png]] [[#Mục]]\n')
  await write('30 Features/Browser.md', '---\ntype: feature\naliases: [Trình duyệt]\ntags: [m4]\n---\n# Browser\nQuay lại [[_INDEX]]. Kế hoạch làm tab.\n')
  await write('30 Features/Kanban.md', '---\ntype: feature\n---\n# Kanban\n## Esc\nXem [Browser](Browser.md) và `[[không tính]]`.\n')
  await write('.obsidian/workspace.json', '{}')
  await write('.trash/Cũ.md', '[[Browser]]')
  await write('ghi chú.txt', 'không phải note')
})

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true })
})

describe('VaultIndexer.index', () => {
  it('liệt kê note (bỏ thư mục ẩn, file không phải .md), đọc type/aliases/tags', async () => {
    const idx = await new VaultIndexer().index(vault)
    expect(idx.vaultPath).toBe(vault)
    expect(idx.notes.map((n) => [n.rel, n.name, n.type, n.aliases, n.tags])).toEqual([
      ['_INDEX.md', '_INDEX', 'index', [], []],
      ['30 Features/Browser.md', 'Browser', 'feature', ['Trình duyệt'], ['m4']],
      ['30 Features/Kanban.md', 'Kanban', 'feature', [], []]
    ])
    expect(idx.notes.every((n) => n.mtime > 0)).toBe(true)
  })

  it('link đã phân giải; link tới note chưa có → to null; bỏ ảnh và [[#heading]]', async () => {
    const idx = await new VaultIndexer().index(vault)
    expect(idx.links).toEqual([
      { from: '_INDEX.md', to: '30 Features/Browser.md', target: 'Browser', embed: false, line: 5 },
      { from: '_INDEX.md', to: '30 Features/Kanban.md', target: 'Kanban', embed: false, line: 5 },
      { from: '_INDEX.md', to: null, target: 'Vault Viewer', embed: false, line: 5 },
      { from: '30 Features/Browser.md', to: '_INDEX.md', target: '_INDEX', embed: false, line: 7 },
      { from: '30 Features/Kanban.md', to: '30 Features/Browser.md', target: 'Browser.md', embed: false, line: 6 }
    ])
  })

  it('lần sau chỉ đọc lại file đã đổi, thấy note mới và note đã xoá', async () => {
    const indexer = new VaultIndexer()
    await indexer.index(vault)
    const read = vi.spyOn(fs, 'readFile')
    await write('Mới.md', '[[Vault Viewer]]')
    await fs.rm(join(vault, '30 Features', 'Kanban.md'))
    const idx = await indexer.index(vault)
    expect(read.mock.calls.map((c) => String(c[0]))).toEqual([join(vault, 'Mới.md')])
    read.mockRestore()
    expect(idx.notes.map((n) => n.rel)).toEqual(['_INDEX.md', '30 Features/Browser.md', 'Mới.md'])
    // Kanban đã xoá → link từ _INDEX thành "ma".
    expect(idx.links.find((l) => l.target === 'Kanban')?.to).toBeNull()
  })

  it('vault không tồn tại → rỗng', async () => {
    expect(await new VaultIndexer().index(join(vault, 'không có'))).toEqual({ vaultPath: join(vault, 'không có'), notes: [], links: [] })
  })
})

describe('VaultIndexer.search', () => {
  it('không phân biệt hoa thường và dấu; tên note khớp lên trước', async () => {
    const indexer = new VaultIndexer()
    const hits = await indexer.search(vault, 'ke HOACH')
    expect(hits).toEqual([{ rel: '30 Features/Browser.md', titleMatch: false, matches: [{ line: 7, text: 'Quay lại [[_INDEX]]. Kế hoạch làm tab.' }] }])

    const byTitle = await indexer.search(vault, 'kanban')
    expect(byTitle[0]).toMatchObject({ rel: '30 Features/Kanban.md', titleMatch: true })
  })

  it('nhiều từ: note phải có đủ mọi từ', async () => {
    const indexer = new VaultIndexer()
    // Kanban có 2 dòng khớp, _INDEX 1 dòng; Browser.md không có "esc".
    expect((await indexer.search(vault, 'browser esc')).map((h) => h.rel)).toEqual(['30 Features/Kanban.md', '_INDEX.md'])
    expect(await indexer.search(vault, 'browser không-có-từ-này')).toEqual([])
    expect(await indexer.search(vault, '   ')).toEqual([])
  })

  it('cắt dòng dài quanh chỗ khớp', async () => {
    await write('Dài.md', `${'a '.repeat(200)}ĐÍCH ${'b '.repeat(200)}`)
    const [hit] = await new VaultIndexer().search(vault, 'dich')
    expect(hit.matches[0].text.length).toBeLessThanOrEqual(162)
    expect(hit.matches[0].text).toContain('ĐÍCH')
    expect(hit.matches[0].text.startsWith('…')).toBe(true)
  })
})

describe('fold / isHiddenChange', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(fold('Đóng gói và Kế hoạch')).toBe('dong goi va ke hoach')
  })

  it('bỏ qua thay đổi trong .obsidian, .trash', () => {
    expect(isHiddenChange('.obsidian\\workspace.json')).toBe(true)
    expect(isHiddenChange('a/.trash/x.md')).toBe(true)
    expect(isHiddenChange('30 Features\\Browser.md')).toBe(false)
    expect(isHiddenChange(null)).toBe(false)
  })
})

describe('VaultWatchers', () => {
  function fakeWc(): { wc: never; sent: string[]; listeners: Array<() => void>; destroy: () => void } {
    const sent: string[] = []
    let destroyed = false
    const listeners: Array<() => void> = []
    const wc = {
      isDestroyed: () => destroyed,
      send: (_ch: string, path: string) => sent.push(path),
      once: (_ev: string, fn: () => void) => listeners.push(fn),
      removeListener: (_ev: string, fn: () => void) => {
        const i = listeners.indexOf(fn)
        if (i !== -1) listeners.splice(i, 1)
      }
    }
    return {
      wc: wc as never,
      sent,
      listeners,
      destroy: () => {
        destroyed = true
        listeners.splice(0).forEach((fn) => fn())
      }
    }
  }

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('báo một lần cho nhiều thay đổi liên tiếp; bỏ qua .obsidian; dừng khi cửa sổ đóng', async () => {
    const watchers = new VaultWatchers()
    const a = fakeWc()
    watchers.watch(vault, a.wc)
    await wait(100)

    await write('.obsidian/workspace.json', '{"x":1}')
    await wait(500)
    expect(a.sent).toEqual([])

    await write('A.md', '1')
    await write('B.md', '2')
    await write('30 Features/Browser.md', 'đổi')
    await wait(600)
    expect(a.sent).toEqual([vault])

    a.destroy()
    await write('C.md', '3')
    await wait(500)
    expect(a.sent).toEqual([vault])
    watchers.dispose()
  })

  it('watch/unwatch lặp lại không để sót listener `destroyed` (đổi workspace nhiều lần)', () => {
    const watchers = new VaultWatchers()
    const a = fakeWc()
    for (let i = 0; i < 20; i++) {
      watchers.watch(vault, a.wc)
      watchers.unwatch(vault, a.wc)
    }
    expect(a.listeners).toHaveLength(0)
    watchers.dispose()
  })

  it('cùng cửa sổ theo dõi hai lần: huỷ một lần vẫn còn nhận báo', async () => {
    const watchers = new VaultWatchers()
    const a = fakeWc()
    watchers.watch(vault, a.wc)
    watchers.watch(vault, a.wc)
    expect(a.listeners).toHaveLength(1)
    watchers.unwatch(vault, a.wc)
    await wait(100)
    await write('D.md', '4')
    await wait(600)
    expect(a.sent).toEqual([vault])

    watchers.unwatch(vault, a.wc)
    expect(a.listeners).toHaveLength(0)
    await write('E.md', '5')
    await wait(500)
    expect(a.sent).toEqual([vault])
    watchers.dispose()
  })

  it('vault không tồn tại thì không lỗi', () => {
    const watchers = new VaultWatchers()
    expect(() => watchers.watch(join(vault, 'không có'), fakeWc().wc)).not.toThrow()
    watchers.dispose()
  })
})
