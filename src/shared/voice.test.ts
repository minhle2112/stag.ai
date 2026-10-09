import { describe, expect, it } from 'vitest'
import { CHUNK_MAX_S, CHUNK_MIN_S, cleanHotwords, echoAt, findSplit, isHotkeyDown, isHotkeyUp, joinChunks, nextCut, trimSilence, VOICE_RATE } from './voice'

const key = (code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})

/** Âm thanh giả: `loud` giây tiếng to, xen các khoảng lặng ở vị trí (giây) cho trước. */
function speech(seconds: number, silences: Array<[number, number]> = []): Float32Array {
  const a = new Float32Array(Math.round(seconds * VOICE_RATE))
  for (let i = 0; i < a.length; i++) a[i] = 0.3 * Math.sin(i / 7)
  for (const [from, to] of silences) a.fill(0, Math.round(from * VOICE_RATE), Math.round(to * VOICE_RATE))
  return a
}

describe('phím tắt', () => {
  it('Ctrl+Space: đúng modifier, không thừa', () => {
    expect(isHotkeyDown(key('Space', { ctrlKey: true }), 'ctrl+space')).toBe(true)
    expect(isHotkeyDown(key('Space'), 'ctrl+space')).toBe(false)
    expect(isHotkeyDown(key('Space', { ctrlKey: true, shiftKey: true }), 'ctrl+space')).toBe(false)
    expect(isHotkeyDown(key('Space', { ctrlKey: true, metaKey: true }), 'ctrl+space')).toBe(false)
    expect(isHotkeyDown(key('KeyA', { ctrlKey: true }), 'ctrl+space')).toBe(false)
  })

  it('Ctrl+Shift+Space, Ctrl+Alt+Space, F9', () => {
    expect(isHotkeyDown(key('Space', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+space')).toBe(true)
    expect(isHotkeyDown(key('Space', { ctrlKey: true }), 'ctrl+shift+space')).toBe(false)
    expect(isHotkeyDown(key('Space', { ctrlKey: true, altKey: true }), 'ctrl+alt+space')).toBe(true)
    expect(isHotkeyDown(key('F9'), 'f9')).toBe(true)
    expect(isHotkeyDown(key('F9', { ctrlKey: true }), 'f9')).toBe(false)
  })

  it('thả Space hoặc Ctrl là dừng; F9 chỉ thả F9', () => {
    expect(isHotkeyUp({ code: 'Space', key: ' ' }, 'ctrl+space')).toBe(true)
    expect(isHotkeyUp({ code: 'ControlLeft', key: 'Control' }, 'ctrl+shift+space')).toBe(true)
    expect(isHotkeyUp({ code: 'ShiftLeft', key: 'Shift' }, 'ctrl+shift+space')).toBe(false)
    expect(isHotkeyUp({ code: 'F9', key: 'F9' }, 'f9')).toBe(true)
    expect(isHotkeyUp({ code: 'ControlLeft', key: 'Control' }, 'f9')).toBe(false)
  })
})

describe('cắt đoạn', () => {
  it('findSplit chọn chỗ lặng nhất', () => {
    const a = speech(12, [[8.4, 8.8]])
    const cut = findSplit(a, 6 * VOICE_RATE, 12 * VOICE_RATE)
    expect(cut / VOICE_RATE).toBeGreaterThanOrEqual(8.4)
    expect(cut / VOICE_RATE).toBeLessThanOrEqual(8.8)
  })

  it('nextCut: chưa đủ dài thì chờ; thả phím thì gửi hết phần còn lại', () => {
    const a = speech(5)
    expect(nextCut(a, 0, a.length, false)).toBeNull()
    expect(nextCut(a, 0, a.length, true)).toBe(a.length)
    expect(nextCut(a, a.length, a.length, true)).toBeNull()
  })

  it('nextCut: dài quá thì cắt trong khoảng MIN…MAX, ở chỗ ngắt hơi', () => {
    const a = speech(20, [[9.5, 9.9]])
    const cut = nextCut(a, 0, a.length, false)!
    expect(cut).toBeGreaterThanOrEqual(CHUNK_MIN_S * VOICE_RATE)
    expect(cut).toBeLessThanOrEqual(CHUNK_MAX_S * VOICE_RATE)
    expect(cut / VOICE_RATE).toBeGreaterThan(9.4)
    expect(cut / VOICE_RATE).toBeLessThan(10)
  })

  it('nói liền không ngắt hơi vẫn cắt được (không đoạn nào dài quá MAX)', () => {
    const a = speech(40)
    let start = 0
    const lens: number[] = []
    for (;;) {
      const cut = nextCut(a, start, a.length, true)
      if (cut === null) break
      lens.push(cut - start)
      start = cut
    }
    expect(start).toBe(a.length)
    expect(Math.max(...lens)).toBeLessThanOrEqual(CHUNK_MAX_S * VOICE_RATE)
  })

  it('trimSilence: bỏ lặng đầu / cuối, giữ 0,25 s đệm; im lặng hết → rỗng', () => {
    const a = speech(4, [[0, 1], [3, 4]])
    const t = trimSilence(a)
    expect(t.length / VOICE_RATE).toBeCloseTo(2.5, 1)
    expect(trimSilence(new Float32Array(16000)).length).toBe(0)
    const loud = speech(1)
    expect(trimSilence(loud).length).toBe(loud.length)
  })

})

describe('gợi ý từ', () => {
  it('cleanHotwords: bỏ dấu phẩy / xuống dòng, trùng (không phân biệt hoa thường), rỗng; giới hạn số mục', () => {
    expect(cleanHotwords(['handleClick', ' a,b ', 'HANDLECLICK', '', 'x\ny'])).toEqual(['handleClick', 'a b', 'x y'])
    expect(cleanHotwords(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })

  it('echoAt: ≥3 mục liền nhau của danh sách xuất hiện liền nhau = chép danh sách', () => {
    const words = ['package', 'zustand', 'npm install', 'package.json', 'debug', 'Electron']
    expect(echoAt('cài thêm package zustand bằng npm install zustand npm install package.json debug Electron', words)).toBeGreaterThan(0)
    expect(echoAt('cài thêm package zustand bằng npm install rồi cập nhật package.json', words)).toBe(-1)
    expect(echoAt('anything', ['a', 'b'])).toBe(-1)
  })

  it('joinChunks bỏ đoạn rỗng và khoảng trắng thừa', () => {
    expect(joinChunks([' một ', '', 'hai', '  '])).toBe('một hai')
  })
})
