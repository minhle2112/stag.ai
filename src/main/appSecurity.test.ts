import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { IpcMain } from 'electron'
import { appPermissionAllowed, guardIpc, isAppFrame, isAppUrl, type AppPage } from './appSecurity'

const page: AppPage = { file: 'file:///C:/Program%20Files/stag.ai/resources/app.asar/out/renderer/index.html' }
const dev: AppPage = { ...page, dev: 'http://localhost:5173' }

describe('isAppUrl / isAppFrame', () => {
  it('nhận đúng file renderer (bỏ #hash / ?query, hoa thường trên Windows, mã hoá khác nhau), từ chối file khác', () => {
    expect(isAppUrl('file:///C:/Program%20Files/stag.ai/resources/app.asar/out/renderer/index.html#/x', page, true)).toBe(true)
    expect(isAppUrl('file:///c:/program files/stag.ai/resources/app.asar/out/renderer/index.html?a=1', page, true)).toBe(true)
    expect(isAppUrl('file:///C:/Program%20Files/stag.ai/resources/app.asar/out/renderer/other.html', page, true)).toBe(false)
    expect(isAppUrl('file:///C:/Users/x/Downloads/index.html', page, true)).toBe(false)
    expect(isAppUrl('https://evil.example/', page, true)).toBe(false)
    expect(isAppUrl('stag-plugin://p/ui.html', page, true)).toBe(false)
    expect(isAppUrl('about:srcdoc', page, true)).toBe(false)
    expect(isAppUrl('', page, true)).toBe(false)
  })

  it('bản dev: thêm origin của dev server, không nhận cổng / máy khác', () => {
    expect(isAppUrl('http://localhost:5173/#/settings', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('http://127.0.0.1:5173/', dev)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', page)).toBe(false)
  })

  it('chỉ khung chính: iframe (plugin, xem trước) bị từ chối dù cùng URL', () => {
    const url = page.file
    expect(isAppFrame({ url, parent: null }, page)).toBe(true)
    expect(isAppFrame({ url, parent: {} }, page)).toBe(false)
    expect(isAppFrame(null, page)).toBe(false)
  })
})

describe('appPermissionAllowed', () => {
  const ask = (permission: string, extra: Partial<{ url: string; isMainFrame: boolean; mediaTypes: string[] }> = {}): boolean =>
    appPermissionAllowed({ permission, url: page.file, isMainFrame: true, ...extra }, page)

  it('trang app: micro, ghi clipboard, toàn màn hình; không camera, vị trí, thông báo…', () => {
    expect(ask('media', { mediaTypes: ['audio'] })).toBe(true)
    expect(ask('media', { mediaTypes: [] })).toBe(true)
    expect(ask('media', { mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(ask('media', { mediaTypes: ['video'] })).toBe(false)
    expect(ask('clipboard-sanitized-write')).toBe(true)
    expect(ask('fullscreen')).toBe(true)
    for (const p of ['clipboard-read', 'geolocation', 'notifications', 'openExternal', 'display-capture', 'midi', 'pointerLock', 'hid'])
      expect(ask(p), p).toBe(false)
  })

  it('iframe / trang khác: từ chối hết', () => {
    expect(ask('media', { mediaTypes: ['audio'], isMainFrame: false })).toBe(false)
    expect(ask('clipboard-sanitized-write', { url: 'stag-plugin://p/ui.html', isMainFrame: false })).toBe(false)
    expect(ask('media', { mediaTypes: ['audio'], url: 'https://evil.example/' })).toBe(false)
  })
})

describe('guardIpc', () => {
  /** ipcMain giả: handle / on như Electron (EventEmitter + bảng handler). */
  function fakeIpc(): IpcMain & { invoke(channel: string, e: unknown, ...a: unknown[]): unknown } {
    const em = new EventEmitter() as unknown as IpcMain & { invoke(channel: string, e: unknown, ...a: unknown[]): unknown }
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    const g = em as unknown as Record<string, unknown>
    g.handle = (c: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void handlers.set(c, fn)
    g.handleOnce = g.handle
    g.invoke = (c: string, e: unknown, ...a: unknown[]) => handlers.get(c)!(e, ...a)
    return em
  }
  const event = (trusted: boolean): Record<string, unknown> => ({ trusted, sender: { getURL: () => 'x' }, senderFrame: { url: 'x' } })

  it('handle / on chỉ chạy với người gửi tin cậy; kênh miễn trừ giữ nguyên; sendSync bị từ chối nhận null', () => {
    const ipc = fakeIpc()
    const logs: string[] = []
    guardIpc(ipc, (e) => !!(e as unknown as { trusted: boolean }).trusted, new Set(['page:hello']), (m) => logs.push(m))
    ipc.handle('pty:spawn', (_e, x: unknown) => `ran ${x}`)
    ipc.handle('page:hello', () => 'hi')
    expect(ipc.invoke('pty:spawn', event(true), 1)).toBe('ran 1')
    expect(() => ipc.invoke('pty:spawn', event(false), 1)).toThrow(/refused/)
    expect(ipc.invoke('page:hello', event(false))).toBe('hi')

    const got: unknown[] = []
    const fn = (_e: unknown, v: unknown): void => void got.push(v)
    ipc.on('theme:sync', fn)
    const bad = event(false)
    ipc.emit('theme:sync', bad, 'a')
    ipc.emit('theme:sync', event(true), 'b')
    expect(got).toEqual(['b'])
    expect(bad.returnValue).toBeNull()
    expect(logs.some((l) => l.includes('theme:sync'))).toBe(true)
    // Gỡ listener bằng hàm gốc vẫn được.
    ipc.removeListener('theme:sync', fn)
    ipc.emit('theme:sync', event(true), 'c')
    expect(got).toEqual(['b'])
  })
})
