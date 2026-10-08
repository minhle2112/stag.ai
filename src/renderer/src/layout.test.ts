import { describe, expect, it } from 'vitest'
import type { LayoutNode } from '@shared/types'
import { insertLeaf, leaves, reconcile, removeLeaf, setRatio } from './layout'

const leaf = (agentId: string): LayoutNode => ({ type: 'leaf', agentId })
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
