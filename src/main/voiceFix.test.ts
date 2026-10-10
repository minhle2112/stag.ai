import { describe, expect, it, vi } from 'vitest'
import { aiFix, plausibleFix } from './voiceFix'

const reply = (text: string, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(status === 200 ? { content: [{ type: 'text', text }] } : { type: 'error', error: { type: text, message: 'nope' } }), { status })) as typeof fetch

describe('aiFix (sửa bằng AI)', () => {
  it('gửi key qua header, model Haiku, câu + danh sách từ; trả về bản sửa', async () => {
    const f = vi.fn(reply('Sửa hàm handleClick rồi chạy test'))
    const out = await aiFix({ key: 'k', text: 'Sửa hàm hen đồ click rồi chạy test', terms: ['handleClick', 'App.tsx'], fetch: f })
    expect(out).toBe('Sửa hàm handleClick rồi chạy test')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.temperature).toBe(0)
    expect(body.messages[0].content).toContain('handleClick, App.tsx')
    expect(body.messages[0].content).toContain('Sửa hàm hen đồ click rồi chạy test')
    expect(String(init.body)).not.toContain('"k"')
  })

  it('key sai / giới hạn / lỗi khác → lỗi dễ hiểu', async () => {
    await expect(aiFix({ key: 'k', text: 'a b c', terms: [], fetch: reply('authentication_error', 401) })).rejects.toThrow(/API key Anthropic không đúng/)
    await expect(aiFix({ key: 'k', text: 'a b c', terms: [], fetch: reply('rate_limit_error', 429) })).rejects.toThrow(/giới hạn/)
    await expect(aiFix({ key: 'k', text: 'a b c', terms: [], fetch: reply('api_error', 500) })).rejects.toThrow(/AI báo lỗi 500/)
  })

  it('AI trả lời lạc đề (dài hẳn ra / "Here is…") → giữ câu gốc', async () => {
    const text = 'đọc file readme rồi tóm tắt'
    await expect(aiFix({ key: 'k', text, terms: [], fetch: reply(`Here is the corrected text: ${text}`) })).rejects.toThrow(/không giống bản sửa/)
    await expect(aiFix({ key: 'k', text, terms: [], fetch: reply('README là file giới thiệu dự án. '.repeat(10)) })).rejects.toThrow(/không giống bản sửa/)
    expect(plausibleFix(text, 'đọc file README rồi tóm tắt')).toBe(true)
    expect(plausibleFix(text, '')).toBe(false)
  })

  it('quá giờ → báo AI trả lời quá lâu', async () => {
    const slow = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
    await expect(aiFix({ key: 'k', text: 'xin chào', terms: [], fetch: slow, timeoutMs: 20 })).rejects.toThrow(/quá lâu/)
  })
})
