import { describe, expect, it } from 'vitest'
import {
  applyReply,
  close,
  elementLabel,
  enqueue,
  markDelivered,
  markRead,
  normalizePin,
  packetItem,
  packetMessage,
  pageKey,
  promoteNext,
  queuePosition,
  reopen,
  sendDrafts,
  sortForList,
  toPagePin,
  type InspectPin
} from './inspect'

let n = 0
function pin(over: Partial<InspectPin> = {}): InspectPin {
  const id = over.id ?? ++n
  return {
    id,
    url: 'http://localhost:5173/',
    title: 'Home',
    agentId: 'a1',
    agentName: 'Dev',
    state: 'draft',
    round: 1,
    target: {
      tag: 'a.cta',
      label: 'Đặt bàn',
      selector: 'section.hero > a.cta',
      path: 'body > div:nth-child(1) > a:nth-child(2)',
      text: 'Đặt bàn',
      rect: { x: 10, y: 20, w: 120, h: 40 },
      pt: { x: 0.25, y: 0.5 },
      scroll: { x: 0, y: 0 },
      viewport: { kind: 'desk', w: 1200, h: 800, dpr: 1 },
      style: 'font 14px/600',
      html: '<a class="cta">Đặt bàn</a>',
      source: { chip: 'code', label: 'src/Hero.tsx:42', file: 'src/Hero.tsx', line: 42 }
    },
    thread: [{ by: 'user', text: 'Nút to hơn', at: '2026-10-12T10:00:00Z', round: 1 }],
    images: {},
    createdAt: '2026-10-12T10:00:00Z',
    updatedAt: '2026-10-12T10:00:00Z',
    ...over
  }
}

describe('pageKey', () => {
  it('bỏ #, giữ query', () => {
    expect(pageKey('http://localhost:5173/a?x=1#top')).toBe('http://localhost:5173/a?x=1')
    expect(pageKey('not a url#x')).toBe('not a url')
  })
})

describe('hàng chờ mỗi agent', () => {
  it('gửi → chờ; gõ vào phiên → mục đầu đang trả lời, mục sau chờ tới lượt', () => {
    const a = pin({ id: 1 })
    const b = pin({ id: 2 })
    enqueue(a, '2026-10-12T10:00:01Z')
    enqueue(b, '2026-10-12T10:00:02Z')
    expect(queuePosition([a, b], b)).toBe(2)
    markDelivered([a, b], 'a1', [1, 2])
    expect(a.state).toBe('working')
    expect(b.state).toBe('queued')
    expect(b.delivered).toBe(true)
    applyReply(a, { id: 1, text: 'Đã sửa', changes: 'src/Hero.tsx:42' }, 'a1')
    expect(a.state).toBe('new')
    expect(promoteNext([a, b], 'a1')?.id).toBe(2)
    expect(b.state).toBe('working')
  })

  it('hàng của agent khác không ảnh hưởng', () => {
    const a = pin({ id: 1, agentId: 'a1' })
    const b = pin({ id: 2, agentId: 'a2' })
    enqueue(a)
    enqueue(b)
    markDelivered([a, b], 'a1', [1])
    expect(a.state).toBe('working')
    expect(b.state).toBe('queued')
    expect(b.delivered).toBe(false)
  })
})

describe('gom rồi gửi', () => {
  it('Gửi một nhóm: chỉ các bình luận chờ gửi được chọn vào hàng, cùng lúc, theo số → một gói tin', () => {
    const a = pin({ id: 3 })
    const b = pin({ id: 1 })
    const other = pin({ id: 2 })
    const sent = pin({ id: 4, state: 'read' })
    const all = [a, b, other, sent]
    const out = sendDrafts(all, [3, 1, 4], '2026-10-14T09:00:00Z')
    expect(out.map((p) => p.id)).toEqual([1, 3])
    expect([a.state, b.state, other.state, sent.state]).toEqual(['queued', 'queued', 'draft', 'read'])
    expect(a.queuedAt).toBe(b.queuedAt)
    expect(a.delivered).toBe(false)
    expect(a.round).toBe(1)
    expect(a.thread).toHaveLength(1)
    const msg = packetMessage(all.filter((p) => p.state === 'queued').sort((x, y) => x.id - y.id))
    expect(msg).toMatch(/^\[stag\.ai\] 2 comments/)
    expect(msg.indexOf('#1 ')).toBeLessThan(msg.indexOf('#3 '))
    markDelivered(all, 'a1', [1, 3])
    expect(b.state).toBe('working')
    expect(a.state).toBe('queued')
  })

  it('đã gửi rồi thì gửi lại không làm gì', () => {
    const a = pin({ id: 1 })
    sendDrafts([a], [1])
    const at = a.queuedAt
    expect(sendDrafts([a], [1])).toEqual([])
    expect(a.queuedAt).toBe(at)
  })
})

describe('applyReply', () => {
  it('hỏi lại / không làm được chỉ là một tin trả lời', () => {
    const a = pin({ state: 'working' })
    expect(applyReply(a, { id: a.id, text: 'Đổi kiểu hay đổi chữ?', ask: true, quick: ['Kiểu', 'Chữ'] }, 'a1')).toBe('new')
    expect(a.thread.at(-1)).toMatchObject({ by: 'agent', text: 'Đổi kiểu hay đổi chữ?' })
    expect(a.thread.at(-1)).not.toHaveProperty('quick')
    const b = pin({ state: 'working' })
    expect(applyReply(b, { id: b.id, text: 'File bị khoá', failed: true }, 'a1')).toBe('new')
  })

  it('agent khác / chưa gửi → lỗi', () => {
    expect(() => applyReply(pin({ state: 'working' }), { id: 1, text: 'x' }, 'other')).toThrow(/not to you/)
    expect(() => applyReply(pin({ state: 'draft' }), { id: 1, text: 'x' }, 'a1')).toThrow(/not been sent/)
  })

  it('mạch đã đóng: tin vẫn lưu, mạch không mở lại', () => {
    const a = pin({ state: 'working' })
    close(a)
    expect(applyReply(a, { id: a.id, text: 'Đã sửa' }, 'a1')).toBe('closed')
    expect(a.thread.at(-1)?.text).toBe('Đã sửa')
  })

  it('bạn đã trả lời tiếp mà gói mới chưa gõ vào phiên: vẫn trong hàng', () => {
    const a = pin({ state: 'read', thread: [...pin().thread, { by: 'agent', text: 'ok', at: '', round: 1 }] })
    enqueue(a, undefined, 'To nữa')
    expect(applyReply(a, { id: a.id, text: 'trả lời muộn vòng 1' }, 'a1')).toBe('queued')
    expect(a.delivered).toBe(false)
  })
})

describe('đã xem / đóng / mở lại', () => {
  it('có trả lời mới → đã xem', () => {
    const a = pin({ state: 'new' })
    expect(markRead(a)).toBe(true)
    expect(a.state).toBe('read')
    expect(markRead(a)).toBe(false)
  })

  it('đóng mục đang chờ: ra khỏi hàng; mở lại khi agent chưa trả lời → gửi lại', () => {
    const a = pin()
    enqueue(a)
    close(a)
    expect(a).toMatchObject({ state: 'closed', delivered: false })
    expect(a.queuedAt).toBeUndefined()
    expect(reopen(a)).toBe(true)
    expect(a.state).toBe('queued')
  })

  it('mở lại khi đã có trả lời → đã xem', () => {
    const a = pin({ state: 'new', thread: [...pin().thread, { by: 'agent', text: 'ok', at: '', round: 1 }] })
    close(a)
    expect(reopen(a)).toBe(false)
    expect(a.state).toBe('read')
  })

  it('nháp không đóng được', () => {
    const a = pin()
    close(a)
    expect(a.state).toBe('draft')
  })
})

describe('normalizePin (dữ liệu bản Soi cũ)', () => {
  it('review / ask / failed → đã xem; done → đóng; bỏ tin hệ thống, phạm vi, hoàn tác', () => {
    const old = {
      ...pin({ id: 3 }),
      state: 'review',
      scope: 'all',
      request: 'revert',
      reverted: true,
      thread: [...pin().thread, { by: 'sys', text: 'Đã hoàn tác', at: '', round: 1 }],
      images: { before: 'b.png', after: 'a.png', afterRound: 1 }
    } as unknown as InspectPin
    const p = normalizePin(old)
    expect(p.state).toBe('read')
    expect(p).not.toHaveProperty('scope')
    expect(p).not.toHaveProperty('request')
    expect(p).not.toHaveProperty('reverted')
    expect(p.thread.map((m) => m.by)).toEqual(['user'])
    expect(p.images).toEqual({ before: 'b.png' })
    expect(normalizePin({ ...pin(), state: 'done', prev: 'ask' } as unknown as InspectPin)).toMatchObject({ state: 'closed', prev: 'read' })
  })
})

describe('sortForList', () => {
  it('mới nhất trước', () => {
    const list = [pin({ id: 1, state: 'queued' }), pin({ id: 3, state: 'new' }), pin({ id: 2, state: 'read' })]
    expect(sortForList(list).map((p) => p.id)).toEqual([3, 2, 1])
  })
})

describe('elementLabel', () => {
  it('tên thẻ + vài chữ đầu; không có chữ thì lớp đầu tiên', () => {
    expect(elementLabel({ tag: 'a.cta.big', text: 'Đặt bàn', label: 'Đặt bàn' })).toEqual({ t: 'a', txt: 'Đặt bàn' })
    expect(elementLabel({ tag: 'div#hero.wrap', text: '' })).toEqual({ t: 'div', txt: '.wrap' })
    expect(elementLabel({ tag: 'p', text: 'Một câu rất dài hơn hai mươi hai chữ cái' }).txt).toHaveLength(22)
  })
})

describe('gói tin gửi agent', () => {
  it('vòng đầu: yêu cầu, trang, selector, nguồn, khung, ảnh', () => {
    const a = pin({ id: 7, images: { before: '.stag/inspect/img/p7-before.png' } })
    const t = packetItem(a)
    expect(t).toContain('#7 "Nút to hơn"')
    expect(t).toContain('selector: section.hero > a.cta')
    expect(t).toContain('source: src/Hero.tsx:42')
    expect(t).toContain('viewport: Desktop 1200×800')
    expect(t).toContain('.stag/inspect/img/p7-before.png')
  })

  it('không rõ nguồn: vẫn gửi, bảo agent tự tìm', () => {
    const a = pin()
    a.target = { ...a.target, source: { chip: 'none', label: 'Không rõ nguồn' } }
    expect(packetItem(a)).toContain('source: unknown')
  })

  it('vòng sau kèm lịch sử', () => {
    const a = pin({ state: 'read', thread: [...pin().thread, { by: 'agent', text: 'Đã to hơn', at: '', round: 1, changes: 'padding 10 → 15' }] })
    enqueue(a, undefined, 'To nữa')
    const t = packetItem(a)
    expect(t).toContain('history:')
    expect(t).toContain('round 1 you: "Đã to hơn" (changes: padding 10 → 15)')
    expect(t).toContain('now (round 2) the user says: "To nữa"')
  })

  it('nhóm lặp: chỉ sửa mục này', () => {
    const a = pin()
    a.target = { ...a.target, group: { n: 4, kind: 'loop', selector: 'ul > li' } }
    expect(packetItem(a)).toContain('scope: only this element (it is 1 of 4 items from the same template')
  })

  it('gói nhiều mục: dòng đầu + từng mục #N, không còn Trước / Sau', () => {
    const t = packetMessage([pin({ id: 1 }), pin({ id: 2 })])
    expect(t).toMatch(/^\[stag\.ai\] 2 comments from the user on a web page/)
    expect(t).toContain('#1 ')
    expect(t).toContain('#2 ')
    expect(t).not.toContain('before / after')
  })

  it('không lặp hướng dẫn trả lời ở cuối tin (đã nằm trong luật phiên + mô tả inspect_reply)', () => {
    const t = packetMessage([pin({ id: 1 })])
    expect(t).toBe(`${t.split('\n')[0]}\n\n${packetItem(pin({ id: 1 }))}`)
    expect(t).not.toContain('A comment is not always a change request')
    expect(t).not.toContain('WordPress')
  })
})

describe('toPagePin', () => {
  it('chỉ phần trang cần để vẽ, kèm điểm bấm', () => {
    const p = toPagePin(pin({ id: 5 }))
    expect(p).toMatchObject({ id: 5, selector: 'section.hero > a.cta', title: 'Nút to hơn', agentId: 'a1', pt: { x: 0.25, y: 0.5 } })
  })
})
