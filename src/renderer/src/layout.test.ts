import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@shared/types'
import { cellKey, cells, insertCell, insertLeaf, leaves, reconcile, removeLeaf, setRatio, swapLeaves, widgetKey, widgets } from './layout'

const leaf = (agentId: string): LayoutNode => ({ type: 'leaf', agentId })
const wid = (widget: string): LayoutNode => ({ type: 'widget', widget })
const split = (dir: 'row' | 'col', a: LayoutNode, b: LayoutNode, ratio = 0.5): LayoutNode => ({ type: 'split', dir, ratio, a, b })

describe('leaves', () => {
  it('null → rỗng; thứ tự trái sang phải', () => {
    expect(leaves(null)).toEqual([])
    expect(leaves(leaf('a'))).toEqual(['a'])
    expect(leaves(split('row', leaf('a'), split('col', leaf('b'), leaf('c'))))).toEqual(['a', 'b', 'c'])
  })
})

describe('insertLeaf', () => {
  it('lưới trống → một ô', () => {
    expect(insertLeaf(null, null, 'a', 'row')).toEqual(leaf('a'))
  })

  it('chia đôi đúng ô đích, ô mới ở nhánh b', () => {
    const tree = split('row', leaf('a'), leaf('b'), 0.3)
    expect(insertLeaf(tree, 'b', 'c', 'col')).toEqual(split('row', leaf('a'), split('col', leaf('b'), leaf('c')), 0.3))
  })

  it('không có ô đích (hoặc đích không còn) → chia đôi toàn bộ lưới', () => {
    const tree = split('row', leaf('a'), leaf('b'))
    expect(insertLeaf(tree, null, 'c', 'col')).toEqual(split('col', tree, leaf('c')))
    expect(insertLeaf(tree, 'đã-xoá', 'c', 'row')).toEqual(split('row', tree, leaf('c')))
  })

  it('không sửa cây cũ (bất biến)', () => {
    const tree = split('row', leaf('a'), leaf('b'))
    const copy = structuredClone(tree)
    insertLeaf(tree, 'a', 'c', 'col')
    expect(tree).toEqual(copy)
  })
})

describe('removeLeaf', () => {
  it('bỏ ô duy nhất → null; agent không có trong lưới → giữ nguyên', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
    expect(removeLeaf(null, 'a')).toBeNull()
    const tree = split('row', leaf('a'), leaf('b'))
    expect(removeLeaf(tree, 'x')).toEqual(tree)
  })

  it('ô anh em chiếm chỗ nhánh cha, giữ tỉ lệ của các nhánh khác', () => {
    const tree = split('row', leaf('a'), split('col', leaf('b'), leaf('c'), 0.7), 0.4)
    expect(removeLeaf(tree, 'b')).toEqual(split('row', leaf('a'), leaf('c'), 0.4))
    expect(removeLeaf(tree, 'a')).toEqual(split('col', leaf('b'), leaf('c'), 0.7))
  })
})

describe('setRatio', () => {
  it('đặt tỉ lệ ở gốc hoặc theo đường a/b', () => {
    const tree = split('row', leaf('a'), split('col', leaf('b'), leaf('c')))
    expect(setRatio(tree, [], 0.2)).toEqual(split('row', leaf('a'), split('col', leaf('b'), leaf('c')), 0.2))
    expect(setRatio(tree, ['b'], 0.8)).toEqual(split('row', leaf('a'), split('col', leaf('b'), leaf('c'), 0.8)))
  })

  it('đường đi tới ô lá → không đổi gì', () => {
    const tree = split('row', leaf('a'), leaf('b'))
    expect(setRatio(tree, ['a'], 0.9)).toEqual(tree)
    expect(setRatio(leaf('a'), [], 0.9)).toEqual(leaf('a'))
  })
})

describe('reconcile', () => {
  it('bỏ ô của agent đã xoá, không tự thêm agent chưa có ô', () => {
    const tree = split('row', leaf('a'), split('col', leaf('b'), leaf('c')))
    expect(reconcile(tree, ['a', 'c', 'd'])).toEqual(split('row', leaf('a'), leaf('c')))
    expect(reconcile(tree, [])).toBeNull()
    expect(reconcile(null, ['a'])).toBeNull()
  })
})

describe('ô widget', () => {
  const W = 'stag.hello/board'
  const WK = widgetKey(W)
  const tree = split('row', leaf('a'), split('col', wid(W), leaf('b'), 0.6), 0.3)

  it('leaves chỉ có agent; cells / widgets có cả widget', () => {
    expect(leaves(tree)).toEqual(['a', 'b'])
    expect(cells(tree)).toEqual(['a', WK, 'b'])
    expect(widgets(tree)).toEqual([W])
    expect(cellKey({ type: 'widget', widget: W })).toBe('widget:stag.hello/board')
    expect(cellKey({ type: 'leaf', agentId: 'a' })).toBe('a')
  })

  it('lưới trống → widget thành gốc; chia đúng ô đích (agent hoặc widget)', () => {
    expect(insertCell(null, null, { type: 'widget', widget: W }, 'row')).toEqual(wid(W))
    expect(insertCell(leaf('a'), 'a', { type: 'widget', widget: W }, 'col')).toEqual(split('col', leaf('a'), wid(W)))
    // Agent mới cạnh ô widget đang chọn.
    expect(insertLeaf(tree, WK, 'c', 'row')).toEqual(split('row', leaf('a'), split('col', split('row', wid(W), leaf('c')), leaf('b'), 0.6), 0.3))
    // Mã widget không có tiền tố "widget:" không phải mã ô nào → chia cả lưới.
    expect(insertLeaf(tree, W, 'c', 'row')).toEqual(split('row', tree, leaf('c')))
  })

  it('removeLeaf theo mã ô: bỏ widget không đụng agent, bỏ agent không đụng widget', () => {
    expect(removeLeaf(tree, WK)).toEqual(split('row', leaf('a'), leaf('b'), 0.3))
    expect(removeLeaf(tree, 'b')).toEqual(split('row', leaf('a'), wid(W), 0.3))
    expect(removeLeaf(wid(W), WK)).toBeNull()
    expect(removeLeaf(tree, W)).toEqual(tree)
  })

  it('swapLeaves đổi chỗ agent với widget, giữ khung và tỉ lệ', () => {
    expect(swapLeaves(tree, 'a', WK)).toEqual(split('row', wid(W), split('col', leaf('a'), leaf('b'), 0.6), 0.3))
    expect(swapLeaves(tree, WK, 'b')).toEqual(split('row', leaf('a'), split('col', leaf('b'), wid(W), 0.6), 0.3))
    expect(swapLeaves(tree, WK, 'không-có')).toEqual(tree)
  })

  it('setRatio tới ô widget → không đổi gì', () => {
    expect(setRatio(tree, ['b', 'a'], 0.9)).toEqual(tree)
    expect(setRatio(tree, ['b'], 0.2)).toEqual(split('row', leaf('a'), split('col', wid(W), leaf('b'), 0.2), 0.3))
  })

  it('reconcile giữ ô widget (cả khi không còn agent nào)', () => {
    expect(reconcile(tree, ['a'])).toEqual(split('row', leaf('a'), wid(W), 0.3))
    expect(reconcile(tree, [])).toEqual(wid(W))
  })
})
