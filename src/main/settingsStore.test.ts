import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyConnector } from '@shared/connectors'
import { SettingsStore } from './settings'

const fresh = async (): Promise<SettingsStore> => {
  const s = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'stag-set-')), 'settings.json'))
  await s.load()
  return s
}

describe('SettingsStore: connector', () => {
  it('thêm, đổi tên (bật / tắt riêng đi theo), gỡ', async () => {
    const s = await fresh()
    await s.saveConnector({ ...emptyConnector('a'), command: 'npx' })
    await s.setOverrides('agent', 'g', { connectors: { a: false } })
    await s.setOverrides('workspace', 'w', { connectors: { a: true, 'claude:x': false } })
    await s.saveConnector({ ...emptyConnector('b'), command: 'npx' }, 'a')
    expect(s.get().app.connectors.items.map((c) => c.id)).toEqual(['b'])
    expect(s.get().agents.g).toEqual({ connectors: { b: false } })
    expect(s.get().workspaces.w).toEqual({ connectors: { 'claude:x': false, b: true } })
    await s.removeConnector('b')
    expect(s.get().app.connectors.items).toEqual([])
    expect(s.get().agents.g).toBeUndefined()
    expect(s.get().workspaces.w).toEqual({ connectors: { 'claude:x': false } })
  })

  it('từ chối trùng tên / cấu hình sai, không ghi gì', async () => {
    const s = await fresh()
    await s.saveConnector({ ...emptyConnector('a'), command: 'npx' })
    await s.saveConnector({ ...emptyConnector('b'), command: 'npx' })
    await expect(s.saveConnector({ ...emptyConnector('b'), command: 'npx' }, 'a')).rejects.toThrow(/Đã có/)
    await expect(s.saveConnector({ ...emptyConnector('c') })).rejects.toThrow(/chương trình/)
    await expect(s.addConnectors([{ ...emptyConnector('d'), command: 'x' }, { ...emptyConnector('a'), command: 'x' }])).rejects.toThrow(/Đã có/)
    expect(s.get().app.connectors.items.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('không ghi giá trị bí mật vào settings.json', async () => {
    const s = await fresh()
    await s.saveConnector({ ...emptyConnector('gh'), transport: 'http', url: 'https://x/mcp', bearerSecret: 'GITHUB_TOKEN' })
    const file = (s as unknown as { file: string }).file
    const raw = readFileSync(file, 'utf8')
    expect(raw).toContain('"bearerSecret": "GITHUB_TOKEN"')
  })
})

describe('SettingsStore: file hỏng', () => {
  it('đọc bản .bak thay vì về mặc định (lần lưu sau không xoá mất cài đặt)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stag-set-')), 'settings.json')
    const a = new SettingsStore(file)
    await a.load()
    await a.saveConnector({ ...emptyConnector('a'), command: 'npx' })
    await a.saveConnector({ ...emptyConnector('b'), command: 'npx' })
    // Mất điện giữa lúc ghi: file chính cụt.
    writeFileSync(file, '{"version": 2, "app": {')
    const b = new SettingsStore(file)
    await b.load()
    expect(b.get().app.connectors.items.map((c) => c.id)).toEqual(['a'])
  })

  it('đọc được file có BOM (người dùng sửa bằng Notepad)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stag-set-')), 'settings.json')
    const a = new SettingsStore(file)
    await a.load()
    await a.saveConnector({ ...emptyConnector('a'), command: 'npx' })
    writeFileSync(file, '﻿' + readFileSync(file, 'utf8'))
    const b = new SettingsStore(file)
    await b.load()
    expect(b.get().app.connectors.items.map((c) => c.id)).toEqual(['a'])
  })
})
