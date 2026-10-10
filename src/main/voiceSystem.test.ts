import { describe, expect, it, vi } from 'vitest'

// voiceSystem.ts nhập electron (BrowserWindow, clipboard…): test chỉ dùng phần không cần Electron thật.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  clipboard: {},
  globalShortcut: {},
  screen: {},
  // ClipboardItem dựng sẵn (đã có dữ liệu), như `new ClipboardItem({...})` của Electron.
  ClipboardItem: class {
    constructor(public data: Record<string, unknown>) {}
    get types(): string[] {
      return Object.keys(this.data)
    }
    async getType(t: string): Promise<unknown> {
      return this.data[t]
    }
  }
}))

const { GlobalVoice, typeText } = await import('./voiceSystem')
import { DEFAULT_VOICE, type VoiceSettings } from '@shared/types'

/**
 * Clipboard giả bắt chước Electron 44: `read()` trả mục **đọc lười** — `getType()` đọc clipboard lúc được gọi, không phải
 * lúc `read()`. (Lỗi thật 2026-10-09: sao lưu kiểu này rồi ghi chữ mới vào thì "bản sao lưu" chính là chữ mới.)
 */
function fakeClip(initial: string | null) {
  let current: Record<string, string> = initial === null ? {} : { 'text/plain': initial, 'text/html': `<b>${initial}</b>` }
  return {
    read: async () =>
      Object.keys(current).length
        ? [{ get types() { return Object.keys(current) }, getType: async (t: string) => current[t] } as unknown as Electron.ClipboardItem]
        : [],
    write: async (items: Electron.ClipboardItem[]) => {
      const next: Record<string, string> = {}
      for (const it of items) for (const t of it.types) next[t] = (await it.getType(t)) as unknown as string
      current = next
    },
    readText: async () => current['text/plain'] ?? '',
    writeText: async (t: string) => {
      current = { 'text/plain': t }
    },
    clear: () => {
      current = {}
    },
    get current() {
      return current
    }
  }
}

describe('typeText (dán vào ứng dụng khác)', () => {
  const noSleep = async (): Promise<void> => {}

  it('ghi chữ vào clipboard, Ctrl+V, rồi trả **nguyên** clipboard cũ (mọi kiểu dữ liệu); không nhấn Enter', async () => {
    const clip = fakeClip('cũ')
    const pressed: string[] = []
    const keys = { press: async (c: 'paste' | 'enter') => void pressed.push(`${c}:${await clip.readText()}`) }
    await typeText(keys, 'Sửa hàm handleClick', false, clip, noSleep)
    expect(pressed).toEqual(['paste:Sửa hàm handleClick'])
    expect(clip.current).toEqual({ 'text/plain': 'cũ', 'text/html': '<b>cũ</b>' })
  })

  it('"gửi": dán rồi Enter; chỉ "gửi" (không chữ) → chỉ Enter, không đụng clipboard', async () => {
    const clip = fakeClip(null)
    const pressed: string[] = []
    const keys = { press: async (c: 'paste' | 'enter') => void pressed.push(c) }
    await typeText(keys, 'chạy test', true, clip, noSleep)
    expect(pressed).toEqual(['paste', 'enter'])
    const clip2 = fakeClip('giữ')
    const read = vi.spyOn(clip2, 'read')
    pressed.length = 0
    await typeText(keys, '', true, clip2, noSleep)
    expect(pressed).toEqual(['enter'])
    expect(read).not.toHaveBeenCalled()
  })

  it('trong lúc dán người dùng chép thứ khác → không đè clipboard mới; clipboard cũ rỗng → xoá', async () => {
    const clip = fakeClip('cũ')
    await typeText({ press: async () => void (await clip.writeText('người dùng vừa chép')) }, 'x', false, clip, noSleep)
    expect(await clip.readText()).toBe('người dùng vừa chép')
    const empty = fakeClip(null)
    await typeText({ press: async () => {} }, 'y', false, empty, noSleep)
    expect(empty.current).toEqual({})
  })
})

describe('GlobalVoice (phím tắt toàn hệ thống)', () => {
  function setup(v: Partial<VoiceSettings>, focused = false, taken = false) {
    const reg = new Map<string, () => void>()
    const shortcuts = {
      register: vi.fn((accel: string, fn: () => void) => {
        if (taken && accel !== 'Escape') return false
        reg.set(accel, fn)
        return true
      }),
      unregister: vi.fn((accel: string) => void reg.delete(accel))
    }
    const state = { settings: { ...DEFAULT_VOICE, ...v }, focused }
    const onToggle = vi.fn()
    const onCancel = vi.fn()
    const g = new GlobalVoice({ settings: () => state.settings, appFocused: () => state.focused, onToggle, onCancel, shortcuts })
    return { g, reg, state, onToggle, onCancel }
  }

  it('tắt sẵn: không đăng ký gì', () => {
    const { g, reg } = setup({})
    g.sync()
    expect(reg.size).toBe(0)
  })

  it('bật: chỉ đăng ký khi stag.ai không ở trên cùng; đổi phím thì đăng ký lại', () => {
    const { g, reg, state, onToggle } = setup({ global: true }, true)
    g.sync()
    expect(reg.size).toBe(0)
    state.focused = false
    g.sync()
    expect([...reg.keys()]).toEqual(['Control+Shift+Space'])
    reg.get('Control+Shift+Space')!()
    expect(onToggle).toHaveBeenCalledTimes(1)
    state.settings = { ...state.settings, globalHotkey: 'f8' }
    g.sync()
    expect([...reg.keys()]).toEqual(['F8'])
    state.focused = true
    g.sync()
    expect(reg.size).toBe(0)
  })

  it('phím bị ứng dụng khác chiếm → báo lỗi để Cài đặt hiện', () => {
    const { g, reg } = setup({ global: true }, false, true)
    g.sync()
    expect(reg.size).toBe(0)
    expect(g.error).toMatch(/Ctrl \+ Shift \+ Space đang bị ứng dụng khác dùng/)
  })

  it('Esc toàn hệ thống chỉ trong lúc đang nói ra ngoài', () => {
    const { g, reg, onCancel } = setup({ global: true })
    g.setActive(true)
    reg.get('Escape')!()
    expect(onCancel).toHaveBeenCalled()
    g.setActive(false)
    expect(reg.has('Escape')).toBe(false)
  })
})
