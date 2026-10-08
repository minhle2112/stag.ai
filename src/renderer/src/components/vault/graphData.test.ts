import { describe, expect, it } from 'vitest'
import type { VaultLink, VaultNoteInfo } from '@shared/types'
import {
  NO_TYPE_COLOR,
  TYPE_COLORS,
  buildGraph,
  filterGraph,
  ghostId,
  neighborMap,
  nodeRadius,
  typeColor,
  typeStats,
  withAlpha,
  type GraphFilter
} from './graphData'

const note = (rel: string, type: string | null = null): VaultNoteInfo => ({
  rel,
  name: rel.replace(/^.*\//, '').replace(/\.md$/, ''),
  type,
  aliases: [],
  tags: [],
  mtime: 0
})
const link = (from: string, to: string | null, target = to ?? ''): VaultLink => ({ from, to, target, embed: false, line: 1 })

const ids = (xs: Array<{ id: string }>): string[] => xs.map((x) => x.id).sort()
const pairs = (ls: Array<{ source: string; target: string }>): string[] => ls.map((l) => `${l.source}>${l.target}`).sort()

const all: GraphFilter = { hiddenTypes: new Set(), showGhosts: true, hideOrphans: false, local: null }

describe('buildGraph', () => {
  it('node = note + node ma gộp không phân biệt hoa thường', () => {
    const g = buildGraph({
      notes: [note('a.md', 'feature'), note('b.md')],
      links: [link('a.md', null, 'Chưa Có'), link('b.md', null, 'chưa có'), link('a.md', 'b.md')]
    })
    expect(ids(g.nodes)).toEqual(['a.md', 'b.md', ghostId('chưa có')])
    const ghost = g.nodes.find((n) => n.ghost)!
    expect(ghost.name).toBe('Chưa Có')
    expect(ghost.type).toBeNull()
    expect(ghost.degree).toBe(2)
  })

  it('bỏ cạnh trùng (cả chiều ngược) và tự trỏ; bậc đếm sau khi bỏ trùng', () => {
    const g = buildGraph({
      notes: [note('a.md'), note('b.md'), note('c.md')],
      links: [link('a.md', 'b.md'), link('a.md', 'b.md'), link('b.md', 'a.md'), link('a.md', 'a.md'), link('c.md', 'a.md')]
    })
    expect(pairs(g.links)).toEqual(['a.md>b.md', 'c.md>a.md'])
    const deg = Object.fromEntries(g.nodes.map((n) => [n.id, n.degree]))
    expect(deg).toEqual({ 'a.md': 2, 'b.md': 1, 'c.md': 1 })
  })

  it('bỏ link từ/tới note không có trong danh sách và đích rỗng', () => {
    const g = buildGraph({
      notes: [note('a.md')],
      links: [link('x.md', 'a.md'), link('a.md', 'y.md'), link('a.md', null, '  ')]
    })
    expect(g.links).toEqual([])
    expect(g.nodes).toHaveLength(1)
  })
})

describe('filterGraph', () => {
  // a(feature) — b(decision) — c(log) — d(feature); a — ma; e mồ côi
  const g = buildGraph({
    notes: [note('a.md', 'feature'), note('b.md', 'decision'), note('c.md', 'log'), note('d.md', 'feature'), note('e.md')],
    links: [link('a.md', 'b.md'), link('b.md', 'c.md'), link('c.md', 'd.md'), link('a.md', null, 'Ma')]
  })

  it('không lọc → giữ nguyên, trả về chính object node', () => {
    const r = filterGraph(g, all)
    expect(r.nodes).toHaveLength(6)
    expect(r.links).toHaveLength(4)
    expect(r.nodes[0]).toBe(g.nodes[0])
  })

  it('ẩn loại kéo theo cạnh; khoá loại không phân biệt hoa thường', () => {
    const r = filterGraph(g, { ...all, hiddenTypes: new Set(['decision']) })
    expect(ids(r.nodes)).toEqual(['a.md', 'c.md', 'd.md', 'e.md', ghostId('ma')])
    expect(pairs(r.links)).toEqual(['a.md>' + ghostId('ma'), 'c.md>d.md'])
    const g2 = buildGraph({ notes: [note('x.md', 'Decision')], links: [] })
    expect(filterGraph(g2, { ...all, hiddenTypes: new Set(['decision']) }).nodes).toEqual([])
  })

  it('ẩn note không loại bằng khoá rỗng', () => {
    const r = filterGraph(g, { ...all, hiddenTypes: new Set(['']) })
    expect(ids(r.nodes)).not.toContain('e.md')
    expect(ids(r.nodes)).toContain(ghostId('ma'))
  })

  it('ẩn node ma', () => {
    const r = filterGraph(g, { ...all, showGhosts: false })
    expect(ids(r.nodes)).not.toContain(ghostId('ma'))
    expect(r.links).toHaveLength(3)
  })

  it('ẩn mồ côi (kể cả node thành mồ côi sau khi lọc)', () => {
    expect(ids(filterGraph(g, { ...all, hideOrphans: true }).nodes)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', ghostId('ma')])
    const r = filterGraph(g, { ...all, hideOrphans: true, showGhosts: false, hiddenTypes: new Set(['decision']) })
    expect(ids(r.nodes)).toEqual(['c.md', 'd.md'])
  })

  it('graph cục bộ độ sâu 1 và 2', () => {
    expect(ids(filterGraph(g, { ...all, local: { center: 'b.md', depth: 1 } }).nodes)).toEqual(['a.md', 'b.md', 'c.md'])
    const r2 = filterGraph(g, { ...all, local: { center: 'b.md', depth: 2 } })
    expect(ids(r2.nodes)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', ghostId('ma')])
    expect(r2.links).toHaveLength(4)
  })

  it('graph cục bộ: tâm luôn hiện kể cả bị lọc loại; không đi xuyên node bị ẩn', () => {
    const r = filterGraph(g, { ...all, hiddenTypes: new Set(['feature']), local: { center: 'a.md', depth: 2 } })
    expect(ids(r.nodes)).toEqual(['a.md', 'b.md', 'c.md', ghostId('ma')])
    const r2 = filterGraph(g, { ...all, hiddenTypes: new Set(['decision']), local: { center: 'a.md', depth: 2 } })
    expect(ids(r2.nodes)).toEqual(['a.md', ghostId('ma')])
    // Tâm mồ côi vẫn hiện khi ẩn mồ côi.
    expect(ids(filterGraph(g, { ...all, hideOrphans: true, local: { center: 'e.md', depth: 1 } }).nodes)).toEqual(['e.md'])
  })

  it('tâm không có trong graph → như toàn vault', () => {
    expect(filterGraph(g, { ...all, local: { center: 'zzz.md', depth: 1 } }).nodes).toHaveLength(6)
  })
})

describe('neighborMap / typeStats', () => {
  it('hàng xóm vô hướng', () => {
    const m = neighborMap([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'a' }
    ])
    expect([...m.get('a')!].sort()).toEqual(['b', 'c'])
    expect([...m.get('b')!]).toEqual(['a'])
  })

  it('đếm note theo loại, không tính node ma, không loại xếp cuối', () => {
    const g = buildGraph({
      notes: [note('a.md', 'log'), note('b.md', 'log'), note('c.md'), note('d.md', 'feature')],
      links: [link('a.md', null, 'X')]
    })
    expect(typeStats(g)).toEqual([
      { key: 'log', count: 2 },
      { key: 'feature', count: 1 },
      { key: '', count: 1 }
    ])
  })
})

describe('màu', () => {
  it('bảng cố định, không có loại → xám, loại lạ → băm ổn định', () => {
    expect(typeColor('decision')).toBe(TYPE_COLORS.decision)
    expect(typeColor(' Feature ')).toBe(TYPE_COLORS.feature)
    expect(typeColor(null)).toBe(NO_TYPE_COLOR)
    expect(typeColor('')).toBe(NO_TYPE_COLOR)
    const c = typeColor('nghiên-cứu')
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(typeColor('nghiên-cứu')).toBe(c)
    expect(typeColor('khác-hẳn')).not.toBe(c)
  })

  it('withAlpha', () => {
    expect(withAlpha('#ff0080', 0.5)).toBe('rgba(255,0,128,0.5)')
    expect(withAlpha('#fff', 1)).toBe('rgba(255,255,255,1)')
    expect(withAlpha('red', 0.3)).toBe('red')
  })

  it('bán kính tăng theo bậc, có trần', () => {
    expect(nodeRadius(0)).toBe(3)
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(1))
    expect(nodeRadius(10000)).toBe(12)
  })
})
