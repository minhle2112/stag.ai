import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@shared/types'
import { normalizeLayout } from './agentLayout'

const leaf = (agentId: string): LayoutNode => ({ type: 'leaf', agentId })
const wid = (widget: string): LayoutNode => ({ type: 'widget', widget })
const split = (dir: 'row' | 'col', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ type: 'split', dir, ratio, a, b })

describe('normalizeLayout', () => {
  it('giữ nguyên lưới hợp lệ có ô agent và ô widget', () => {
    const tree = split('row', leaf('a'), split('col', wid('stag.hello/board'), leaf('b'), 0.7), 0.3)
    expect(normalizeLayout(structuredClone(tree))).toEqual(tree)
    expect(normalizeLayout(null)).toBeNull()
    expect(normalizeLayout(undefined)).toBeNull()
  })

  it('bỏ ô hỏng, ô anh em chiếm chỗ; bỏ trường lạ', () => {
    expect(normalizeLayout(split('row', leaf('a'), { type: 'leaf', agentId: '' }))).toEqual(leaf('a'))
    expect(normalizeLayout({ type: 'split', dir: 'row', ratio: 0.5, a: { type: 'lạ' }, b: wid('stag.hello/board') })).toEqual(wid('stag.hello/board'))
    expect(normalizeLayout({ type: 'leaf', agentId: 'a', extra: 1 })).toEqual(leaf('a'))
    expect(normalizeLayout({ type: 'split', dir: 'row', ratio: 0.5, a: 1, b: 'x' })).toBeNull()
  })

  it('mã widget sai dạng → bỏ ô', () => {
    for (const w of ['stag.hello', 'stag.hello/', '/board', 'a.b/c/d', 'Stag/Board', 'stag.hello/bo ard', 42])
      expect(normalizeLayout({ type: 'widget', widget: w })).toBeNull()
    expect(normalizeLayout({ type: 'leaf', agentId: 'widget:stag.hello/board' })).toBeNull()
  })

  it('ô trùng chỉ giữ ô đầu (một widget / một agent một ô)', () => {
    expect(normalizeLayout(split('row', wid('p.x/w'), split('col', leaf('a'), wid('p.x/w'))))).toEqual(split('row', wid('p.x/w'), leaf('a')))
    expect(normalizeLayout(split('row', leaf('a'), leaf('a')))).toEqual(leaf('a'))
  })

  it('tỉ lệ / hướng hỏng được sửa', () => {
    expect(normalizeLayout({ type: 'split', dir: 'xx', ratio: 'a', a: leaf('a'), b: leaf('b') })).toEqual(split('row', leaf('a'), leaf('b'), 0.5))
    expect(normalizeLayout(split('col', leaf('a'), leaf('b'), 7))).toEqual(split('col', leaf('a'), leaf('b'), 0.95))
    expect(normalizeLayout(split('col', leaf('a'), leaf('b'), -1))).toEqual(split('col', leaf('a'), leaf('b'), 0.05))
  })
})
