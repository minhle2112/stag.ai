import { describe, expect, it } from 'vitest'
import { groupDropAt, moveIndex } from './agentOrder'

/** Giống moveAgent của store: bỏ khỏi chỗ cũ rồi chèn vào `index`. */
function move(all: string[], id: string, index: number): string[] {
  const out = all.filter((x) => x !== id)
  out.splice(index, 0, id)
  return out
}

describe('groupDropAt', () => {
  const g = ['a', 'b', 'c']
  it('thả tại chỗ cũ (trên / dưới chính nó) → null', () => {
    expect(groupDropAt(g, 'b', 1, false)).toBeNull()
    expect(groupDropAt(g, 'b', 1, true)).toBeNull()
    expect(groupDropAt(g, 'b', 0, true)).toBeNull()
    expect(groupDropAt(g, 'b', 2, false)).toBeNull()
  })
  it('vị trí trong nhóm', () => {
    expect(groupDropAt(g, 'a', 2, true)).toBe(3)
    expect(groupDropAt(g, 'c', 0, false)).toBe(0)
  })
})

describe('moveIndex', () => {
  // Mảng chung xen kẽ agent của project khác (X, Y) giữa các agent của nhóm a/b/c.
  const all = ['a', 'X', 'b', 'Y', 'c']
  const g = ['a', 'b', 'c']
  const groupOrder = (list: string[]): string[] => list.filter((x) => g.includes(x))

  it('đưa xuống cuối nhóm, agent nhóm khác giữ thứ tự', () => {
    const out = move(all, 'a', moveIndex(all, g, 'a', 3))
    expect(groupOrder(out)).toEqual(['b', 'c', 'a'])
    expect(out.filter((x) => !g.includes(x))).toEqual(['X', 'Y'])
  })

  it('đưa lên đầu nhóm', () => {
    expect(groupOrder(move(all, 'c', moveIndex(all, g, 'c', 0)))).toEqual(['c', 'a', 'b'])
  })

  it('chèn vào giữa', () => {
    expect(groupOrder(move(all, 'a', moveIndex(all, g, 'a', 2)))).toEqual(['b', 'a', 'c'])
    expect(groupOrder(move(all, 'c', moveIndex(all, g, 'c', 1)))).toEqual(['a', 'c', 'b'])
  })

  it('không thấy agent → -1', () => {
    expect(moveIndex(all, g, 'z', 0)).toBe(-1)
  })
})
