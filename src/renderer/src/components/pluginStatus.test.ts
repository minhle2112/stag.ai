import { describe, expect, it, vi } from 'vitest'
import { errorLogOnce, loadStatusText, statusSlotClickable, STATUS_TONE } from './pluginStatus'

describe('loadStatusText', () => {
  it('không có dataKey → displayName, không gọi worker', async () => {
    const getData = vi.fn()
    expect(await loadStatusText({ displayName: 'Hello' }, getData)).toEqual({ text: 'Hello', tone: 'default' })
    expect(getData).not.toHaveBeenCalled()
  })

  it('có dataKey → chuẩn hoá kết quả của worker', async () => {
    const getData = vi.fn(async () => ({ text: ' Hello · 2 việc xong ', tooltip: 'Bấm để chào', tone: 'ok' }))
    expect(await loadStatusText({ displayName: 'Hello', dataKey: 'statusBar' }, getData)).toEqual({ text: 'Hello · 2 việc xong', tooltip: 'Bấm để chào', tone: 'ok' })
    expect(getData).toHaveBeenCalledWith('statusBar')
    expect(await loadStatusText({ displayName: 'X', dataKey: 'k' }, async () => 'chỉ chữ')).toEqual({ text: 'chỉ chữ', tone: 'default' })
    expect(await loadStatusText({ displayName: 'X', dataKey: 'k' }, async () => ({ text: 'a', tone: 'lạ' }))).toEqual({ text: 'a', tone: 'default' })
  })

  it('worker trả rỗng / sai kiểu → null (ẩn mục)', async () => {
    for (const v of [null, undefined, '', '   ', 3, {}, { text: '' }]) expect(await loadStatusText({ displayName: 'X', dataKey: 'k' }, async () => v)).toBeNull()
  })

  it('lỗi của worker để người gọi bắt', async () => {
    await expect(loadStatusText({ displayName: 'X', dataKey: 'k' }, async () => Promise.reject(new Error('chết')))).rejects.toThrow('chết')
  })
})

describe('statusSlotClickable / STATUS_TONE', () => {
  it('bấm được khi có open hoặc action', () => {
    expect(statusSlotClickable({})).toBe(false)
    expect(statusSlotClickable({ action: 'hello' })).toBe(true)
    expect(statusSlotClickable({ open: { url: 'https://x', target: 'browser' } })).toBe(true)
  })

  it('tone default không có chấm, các tone khác có', () => {
    expect(STATUS_TONE.default.dot).toBeNull()
    for (const t of ['ok', 'warn', 'error'] as const) expect(STATUS_TONE[t].dot).toBeTruthy()
  })
})

describe('errorLogOnce', () => {
  it('mỗi mục ghi một lần, đọc lại được thì lần lỗi sau ghi tiếp', () => {
    const log = vi.fn()
    const e = errorLogOnce(log)
    e.fail('a:x', new Error('1'))
    e.fail('a:x', new Error('2'))
    e.fail('b:y', new Error('3'))
    expect(log).toHaveBeenCalledTimes(2)
    e.ok('a:x')
    e.fail('a:x', new Error('4'))
    expect(log).toHaveBeenCalledTimes(3)
  })
})
