import { describe, expect, it } from 'vitest'
import { GAP, MIN_H, MIN_W } from '@shared/canvas'
import type { CanvasLayout } from '@shared/types'
import { normalizeLayout, normalizeLegacyTree, treeToCells, type LegacyLayoutNode } from './agentLayout'

const leaf = (agentId: string): LegacyLayoutNode => ({ type: 'leaf', agentId })
const wid = (widget: string): LegacyLayoutNode => ({ type: 'widget', widget })
const split = (dir: 'row' | 'col', a: LegacyLayoutNode, b: LegacyLayoutNode, ratio = 0.5): LegacyLayoutNode => ({ type: 'split', dir, ratio, a, b })

describe('normalizeLegacyTree (lưới chia đôi cũ)', () => {
  it('giữ nguyên lưới hợp lệ có ô agent và ô widget', () => {
    const tree = split('row', leaf('a'), split('col', wid('stag.hello/board'), leaf('b'), 0.7), 0.3)
    expect(normalizeLegacyTree(structuredClone(tree))).toEqual(tree)
    expect(normalizeLegacyTree(null)).toBeNull()
  })

  it('bỏ ô hỏng, ô anh em chiếm chỗ; ô trùng chỉ giữ ô đầu; tỉ lệ hỏng được sửa', () => {
    expect(normalizeLegacyTree(split('row', leaf('a'), { type: 'leaf', agentId: '' }))).toEqual(leaf('a'))
    expect(normalizeLegacyTree(split('row', wid('p.x/w'), split('col', leaf('a'), wid('p.x/w'))))).toEqual(split('row', wid('p.x/w'), leaf('a')))
    expect(normalizeLegacyTree({ type: 'split', dir: 'xx', ratio: 'a', a: leaf('a'), b: leaf('b') })).toEqual(split('row', leaf('a'), leaf('b'), 0.5))
    expect(normalizeLegacyTree(split('col', leaf('a'), leaf('b'), 7))).toEqual(split('col', leaf('a'), leaf('b'), 0.95))
  })

  it('mã widget sai dạng → bỏ ô', () => {
    for (const w of ['stag.hello', 'stag.hello/', '/board', 'a.b/c/d', 'Stag/Board', 'stag.hello/bo ard', 42])
      expect(normalizeLegacyTree({ type: 'widget', widget: w })).toBeNull()
    expect(normalizeLegacyTree({ type: 'leaf', agentId: 'widget:stag.hello/board' })).toBeNull()
  })
})

describe('treeToCells', () => {
  it('ô chiếm đúng chỗ cũ trong vùng tham chiếu, cách nhau GAP', () => {
    const area = { x: 0, y: 0, w: 1620, h: 900 }
    const cells = treeToCells(split('row', leaf('a'), split('col', leaf('b'), wid('p.x/w'))), area)
    expect(cells).toEqual([
      { type: 'leaf', agentId: 'a', x: 0, y: 0, w: 800, h: 900, z: 1 },
      { type: 'leaf', agentId: 'b', x: 800 + GAP, y: 0, w: 800, h: 440, z: 2 },
      { type: 'widget', widget: 'p.x/w', x: 800 + GAP, y: 440 + GAP, w: 800, h: 440, z: 3 }
    ])
  })

  it('ô quá nhỏ được nới tới cỡ tối thiểu', () => {
    const cells = treeToCells(split('row', leaf('a'), leaf('b'), 0.05), { x: 0, y: 0, w: 1000, h: 100 })
    expect(cells.every((c) => c.w >= MIN_W && c.h >= MIN_H)).toBe(true)
  })
})

describe('normalizeLayout', () => {
  it('rỗng / hỏng → canvas trống', () => {
    const empty: CanvasLayout = { cells: [], closed: {}, view: null }
    expect(normalizeLayout(null)).toEqual(empty)
    expect(normalizeLayout(undefined)).toEqual(empty)
    expect(normalizeLayout(42)).toEqual(empty)
    expect(normalizeLayout({ cells: 'x', closed: 3 })).toEqual(empty)
  })

  it('bố cục cũ (cây chia đôi) được đổi sang canvas', () => {
    const l = normalizeLayout(split('row', leaf('a'), leaf('b')))
    expect(l.cells.map((c) => (c.type === 'leaf' ? c.agentId : c.widget))).toEqual(['a', 'b'])
    expect(l.cells[1].x).toBeGreaterThan(l.cells[0].x + l.cells[0].w)
    expect(l.view).toBeNull()
  })

  it('giữ canvas hợp lệ; bỏ ô hỏng / trùng; nới cỡ nhỏ; kẹp zoom', () => {
    const raw = {
      cells: [
        { type: 'leaf', agentId: 'a', x: 10, y: -20, w: 500, h: 300, z: 4 },
        { type: 'leaf', agentId: 'a', x: 0, y: 0, w: 500, h: 300, z: 1 },
        { type: 'widget', widget: 'bad', x: 0, y: 0, w: 500, h: 300, z: 1 },
        { type: 'leaf', agentId: 'b', x: 'x', y: 0, w: 500, h: 300 },
        { type: 'leaf', agentId: 'c', x: 0, y: 0, w: 10, h: 10, extra: true },
        { type: 'leaf', agentId: 'd', x: 1e12, y: 0, w: 500, h: 300 }
      ],
      closed: { e: { x: 1, y: 2, w: 400, h: 300 }, a: { x: 0, y: 0, w: 400, h: 300 }, 'widget:bad': { x: 0, y: 0, w: 400, h: 300 }, f: { x: 'no' } },
      view: { x: 5, y: 6, zoom: 99 }
    }
    expect(normalizeLayout(raw)).toEqual({
      cells: [
        { type: 'leaf', agentId: 'a', x: 10, y: -20, w: 500, h: 300, z: 4 },
        { type: 'leaf', agentId: 'c', x: 0, y: 0, w: MIN_W, h: MIN_H, z: 2 }
      ],
      closed: { e: { x: 1, y: 2, w: 400, h: 300 } },
      view: { x: 5, y: 6, zoom: 1.5 }
    })
  })
})
