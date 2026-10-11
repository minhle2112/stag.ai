import { describe, expect, it } from 'vitest'
import { DEFAULT_SIZE, GAP } from '@shared/canvas'
import type { CanvasCell, CanvasLayout } from '@shared/types'
import { addCell, cells, findCell, leaves, reconcile, removeCell, setRects, toFront, widgets } from './layout'

const leaf = (agentId: string, x = 0, y = 0, z = 1, w = 400, h = 300): CanvasCell => ({ type: 'leaf', agentId, x, y, w, h, z })
const canvas = (...c: CanvasCell[]): CanvasLayout => ({ cells: c, closed: {}, view: null })

describe('đọc bố cục', () => {
  it('leaves / cells / widgets', () => {
    const l = canvas(leaf('a'), { type: 'widget', widget: 'p.x/w', x: 0, y: 0, w: 300, h: 300, z: 2 })
    expect(leaves(l)).toEqual(['a'])
    expect(cells(l)).toEqual(['a', 'widget:p.x/w'])
    expect(widgets(l)).toEqual(['p.x/w'])
  })
})

describe('addCell', () => {
  it('tại điểm chuột phải (hít lưới), cỡ mặc định theo loại, nằm trên cùng', () => {
    const l = addCell(canvas(leaf('a', 0, 0, 5)), { type: 'leaf', agentId: 'b' }, 'terminal', { at: { x: 1007, y: 211 } })
    expect(findCell(l, 'b')).toEqual({ type: 'leaf', agentId: 'b', x: 1000, y: 220, ...DEFAULT_SIZE.terminal, z: 6 })
  })

  it('quanh tâm vùng đang nhìn (lệch tối đa nửa ô lưới)', () => {
    const l = addCell(canvas(), { type: 'leaf', agentId: 'a' }, 'agent', { center: { x: 1000, y: 500 } })
    const c = findCell(l, 'a')!
    expect(Math.abs(c.x + c.w / 2 - 1000)).toBeLessThanOrEqual(10)
    expect(Math.abs(c.y + c.h / 2 - 500)).toBeLessThanOrEqual(10)
  })

  it('cạnh ô `near` ở chỗ trống (phải, rồi dưới…)', () => {
    const base = canvas(leaf('a', 0, 0), leaf('blocker', 400 + GAP, 0))
    const c = findCell(addCell(base, { type: 'leaf', agentId: 'b' }, 'agent', { near: 'a' }), 'b')!
    expect(c).toMatchObject({ x: 0, y: 300 + GAP })
  })

  it('ô từng đóng mở lại đúng chỗ cũ; đã có ô thì giữ nguyên', () => {
    const l0 = canvas(leaf('a', 140, 60, 1, 500, 320))
    const closed = removeCell(l0, 'a')
    expect(closed.cells).toEqual([])
    expect(closed.closed.a).toEqual({ x: 140, y: 60, w: 500, h: 320 })
    const back = addCell(closed, { type: 'leaf', agentId: 'a' }, 'agent', { at: { x: 0, y: 0 } })
    expect(findCell(back, 'a')).toMatchObject({ x: 140, y: 60, w: 500, h: 320 })
    expect(back.closed).toEqual({})
    expect(addCell(back, { type: 'leaf', agentId: 'a' }, 'agent')).toBe(back)
  })
})

describe('removeCell', () => {
  it('forget = không nhớ chỗ (agent đã xoá); ô không có → giữ nguyên', () => {
    const l = canvas(leaf('a'))
    expect(removeCell(l, 'a', true)).toEqual(canvas())
    expect(removeCell(l, 'zz')).toBe(l)
    const withClosed = { ...canvas(), closed: { a: { x: 0, y: 0, w: 400, h: 300 } } }
    expect(removeCell(withClosed, 'a', true).closed).toEqual({})
  })
})

describe('toFront / setRects / reconcile', () => {
  it('toFront: đã trên cùng thì giữ nguyên bố cục', () => {
    const l = canvas(leaf('a', 0, 0, 1), leaf('b', 0, 0, 2))
    expect(toFront(l, 'b')).toBe(l)
    expect(findCell(toFront(l, 'a'), 'a')!.z).toBe(3)
  })

  it('setRects chỉ đổi ô có trong bảng', () => {
    const l = setRects(canvas(leaf('a'), leaf('b')), { b: { x: 9, y: 8, w: 700, h: 500 }, zz: { x: 0, y: 0, w: 1, h: 1 } })
    expect(findCell(l, 'a')).toEqual(leaf('a'))
    expect(findCell(l, 'b')).toEqual(leaf('b', 9, 8, 1, 700, 500))
  })

  it('reconcile bỏ ô / chỗ cũ của agent đã xoá, giữ widget', () => {
    const l: CanvasLayout = {
      cells: [leaf('a'), leaf('gone'), { type: 'widget', widget: 'p.x/w', x: 0, y: 0, w: 300, h: 300, z: 1 }],
      closed: { gone2: { x: 0, y: 0, w: 400, h: 300 }, 'widget:p.x/v': { x: 0, y: 0, w: 400, h: 300 } },
      view: null
    }
    const r = reconcile(l, ['a'])
    expect(cells(r)).toEqual(['a', 'widget:p.x/w'])
    expect(Object.keys(r.closed)).toEqual(['widget:p.x/v'])
    expect(reconcile(r, ['a'])).toBe(r)
  })
})
