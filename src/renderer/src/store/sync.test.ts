import { describe, expect, it } from 'vitest'
import { coalesce, fetchThenListen, latestWins } from './sync'

/** Promise điều khiển được từ ngoài. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('latestWins', () => {
  it('chỉ lần gọi mới nhất của khoá còn hiệu lực', () => {
    const l = latestWins()
    const a = l.begin('ws1')
    const b = l.begin('ws1')
    expect(a()).toBe(false)
    expect(b()).toBe(true)
  })

  it('các khoá độc lập nhau', () => {
    const l = latestWins()
    const a = l.begin('ws1')
    l.begin('ws2')
    expect(a()).toBe(true)
  })

  it('bump bỏ lần gọi đang chờ', () => {
    const l = latestWins()
    const a = l.begin('ws1')
    l.bump('ws1')
    expect(a()).toBe(false)
    expect(l.begin('ws1')()).toBe(true)
  })

  it('phản hồi cũ về sau phản hồi mới không đè', async () => {
    const l = latestWins()
    let state = ''
    const load = async (p: Promise<string>): Promise<void> => {
      const fresh = l.begin('k')
      const v = await p
      if (fresh()) state = v
    }
    const old = deferred<string>()
    const neu = deferred<string>()
    const a = load(old.promise)
    const b = load(neu.promise)
    neu.resolve('mới')
    await b
    old.resolve('cũ')
    await a
    expect(state).toBe('mới')
  })
})

describe('coalesce', () => {
  it('gọi trùng lúc dùng chung một lần chạy, xong thì chạy lại được', async () => {
    let runs = 0
    const d = deferred<number>()
    const load = coalesce(async () => {
      runs++
      return d.promise
    })
    const a = load('ws1')
    const b = load('ws1')
    expect(a).toBe(b)
    expect(runs).toBe(1)
    d.resolve(7)
    expect(await a).toBe(7)
    await load('ws1')
    expect(runs).toBe(2)
  })

  it('khác khoá thì chạy riêng; lỗi cũng gỡ khỏi danh sách đang chạy', async () => {
    let runs = 0
    const load = coalesce(async (k: string) => {
      runs++
      if (k === 'bad') throw new Error('x')
      return k
    })
    await Promise.all([load('a'), load('b')])
    expect(runs).toBe(2)
    await expect(load('bad')).rejects.toThrow('x')
    await expect(load('bad')).rejects.toThrow('x')
    expect(runs).toBe(4)
  })
})

describe('fetchThenListen', () => {
  it('bản đẩy tới trước thì bỏ phản hồi nạp', async () => {
    const d = deferred<string>()
    let push: (v: string) => void = () => {}
    const seen: string[] = []
    fetchThenListen(
      () => d.promise,
      (cb) => (push = cb),
      (v) => seen.push(v)
    )
    push('đẩy')
    d.resolve('nạp')
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['đẩy'])
  })

  it('chưa có bản đẩy thì dùng phản hồi nạp; lỗi nạp thì bỏ qua', async () => {
    const seen: string[] = []
    fetchThenListen(
      async () => 'nạp',
      () => {},
      (v) => seen.push(v)
    )
    fetchThenListen(
      async () => {
        throw new Error('x')
      },
      () => {},
      (v) => seen.push(v)
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['nạp'])
  })
})
