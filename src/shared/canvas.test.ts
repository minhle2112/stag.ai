import { describe, expect, it } from 'vitest'
import { GAP, MIN_H, MIN_W, ZOOM_MAX, ZOOM_MIN, fitView, freeSpot, revealView, snapMove, snapResize, tidyRects, toWorld, zoomAt } from './canvas'

describe('camera', () => {
  it('zoomAt giữ điểm dưới con trỏ đứng yên, kẹp mức zoom', () => {
    const v = { x: 100, y: 50, zoom: 1 }
    const before = toWorld(v, 400, 300)
    const z = zoomAt(v, 1.5, 400, 300)
    expect(toWorld(z, 400, 300)).toEqual(before)
    expect(zoomAt(v, 100, 0, 0).zoom).toBe(ZOOM_MAX)
    expect(zoomAt(v, 0.001, 0, 0).zoom).toBe(ZOOM_MIN)
  })

  it('fitView canh giữa mọi ô, không phóng quá 100%', () => {
    const v = fitView([{ x: 0, y: 0, w: 400, h: 300 }], { w: 1200, h: 800 })
    expect(v.zoom).toBe(1)
    expect(v.x).toBe(400)
    expect(v.y).toBe(250)
    const small = fitView([{ x: 0, y: 0, w: 4000, h: 300 }], { w: 1000, h: 800 }, 0)
    expect(small.zoom).toBeCloseTo(0.25)
    expect(fitView([], { w: 100, h: 100 })).toEqual({ x: 40, y: 40, zoom: 1 })
  })

  it('revealView: thấy trọn thì giữ nguyên; lọt khung thì dịch vừa đủ; không lọt thì thu nhỏ + đưa ra giữa', () => {
    const v = { x: 0, y: 0, zoom: 0.5 }
    expect(revealView(v, { x: 100, y: 100, w: 400, h: 300 }, { w: 1000, h: 800 })).toBe(v)
    const r = revealView(v, { x: 5000, y: 0, w: 400, h: 300 }, { w: 1000, h: 800 })
    expect(r.zoom).toBe(0.5)
    expect(r.x + (5000 + 400) * 0.5).toBe(1000 - 40)
    expect(r.y).toBe(40)
    const big = revealView({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0, w: 2000, h: 300 }, { w: 1000, h: 800 })
    expect(big.zoom).toBeCloseTo(0.46)
    expect(big.x + 1000 * big.zoom).toBeCloseTo(500)
  })
})

describe('freeSpot', () => {
  it('canvas trống → gốc; bên phải anchor nếu trống; bị chặn hết → bên phải mọi ô', () => {
    expect(freeSpot([], { w: 400, h: 300 })).toEqual({ x: 0, y: 0 })
    const a = { x: 0, y: 0, w: 400, h: 300 }
    expect(freeSpot([a], { w: 400, h: 300 }, a)).toEqual({ x: 400 + GAP, y: 0 })
    const around = [a, { x: 420, y: 0, w: 400, h: 300 }, { x: 0, y: 320, w: 400, h: 300 }, { x: -420, y: 0, w: 400, h: 300 }, { x: 0, y: -320, w: 400, h: 300 }]
    expect(freeSpot(around, { w: 400, h: 300 }, a)).toEqual({ x: 820 + GAP, y: 0 })
  })
})

describe('tidyRects', () => {
  it('xếp lưới đều theo thứ tự đọc, không chồng nhau', () => {
    const items = ['c', 'a', 'b', 'd'].map((key, i) => ({ key, x: [900, 0, 450, 0][i], y: [0, 0, 0, 500][i], w: 300, h: 200 }))
    const out = tidyRects(items, { w: 1600, h: 900 })
    // Thứ tự đọc a, b, c (hàng trên), d (hàng dưới) → lưới 2×2 cho màn 16:9.
    expect(out.a).toMatchObject({ x: GAP, y: GAP })
    expect(out.b).toMatchObject({ x: out.a.x + out.a.w + GAP, y: GAP })
    expect(out.c).toMatchObject({ x: GAP, y: out.a.y + out.a.h + GAP })
    expect(out.d).toMatchObject({ x: out.b.x, y: out.c.y })
    const rects = Object.values(out)
    for (const r of rects) expect(r.w >= MIN_W && r.h >= MIN_H).toBe(true)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [p, q] = [rects[i], rects[j]]
        expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h).toBe(false)
      }
  })

  it('màn hình quá nhỏ → cỡ cố định', () => {
    const out = tidyRects([{ key: 'a', x: 0, y: 0, w: 1, h: 1 }], { w: 300, h: 200 })
    expect(out.a).toEqual({ x: GAP, y: GAP, w: 640, h: 400 })
  })
})

describe('hít khi kéo', () => {
  const other = { x: 0, y: 0, w: 400, h: 300 }

  it('snapMove hít cạnh ô khác (cách GAP) và hiện vạch gióng; xa thì hít lưới', () => {
    const near = snapMove({ x: 425, y: 3, w: 300, h: 200 }, [other], 8)
    expect(near.rect).toMatchObject({ x: 400 + GAP, y: 0 })
    expect(near.guides.map((g) => g.axis).sort()).toEqual(['x', 'y'])
    const far = snapMove({ x: 611, y: 509, w: 300, h: 200 }, [other], 8)
    expect(far.rect).toMatchObject({ x: 620, y: 500 })
    expect(far.guides).toEqual([])
  })

  it('snapResize hít cạnh đang kéo, giữ cỡ tối thiểu', () => {
    const r = snapResize({ x: 500, y: 0, w: 300, h: 296 }, { b: true }, [other], 8)
    expect(r.rect.h).toBe(300)
    const tiny = snapResize({ x: 500, y: 0, w: 10, h: 10 }, { r: true, b: true }, [], 8)
    expect(tiny.rect).toMatchObject({ w: MIN_W, h: MIN_H })
  })
})
