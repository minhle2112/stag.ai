import { describe, expect, it } from 'vitest'
import { chordFromAccelerator, chordId, isSystemCombo, keyCode, parseChord, typeUnits, VK } from './keys'
import { checkFramePoint, displayAt, frameSize, frameToPhysical, maskBitmap, outputSize, physicalToFrame, rectToImage, zoomRegion } from './geometry'
import { ComputerLock } from './lock'
import { defaultTier, exeKey, tierAllows, tierError, tierOf } from './policy'

describe('computer policy', () => {
  it('classifies apps like Claude Desktop', () => {
    expect(defaultTier('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe').tier).toBe('read')
    expect(defaultTier('msedge.exe')).toEqual({ tier: 'read', reason: 'browser' })
    expect(defaultTier('WindowsTerminal.exe')).toEqual({ tier: 'click', reason: 'terminal' })
    expect(defaultTier('Code.exe')).toEqual({ tier: 'click', reason: 'ide' })
    expect(defaultTier('C:\\Users\\x\\AppData\\Local\\CapCut\\Apps\\9.6.0.4097\\CapCut.exe')).toEqual({ tier: 'full', reason: 'other' })
    expect(defaultTier('notepad.exe').tier).toBe('full')
    expect(defaultTier('1Password.exe')).toEqual({ tier: 'blocked', reason: 'password' })
    expect(defaultTier('Exodus.exe')).toEqual({ tier: 'blocked', reason: 'finance' })
    expect(defaultTier('Taskmgr.exe')).toEqual({ tier: 'blocked', reason: 'system' })
    expect(exeKey('/a/b/Foo Bar.EXE')).toBe('foo bar.exe')
  })

  it('stag.ai itself stays blocked; user settings override the rest', () => {
    expect(tierOf('electron.exe', { self: true, overrides: { 'electron.exe': 'full' } })).toEqual({ tier: 'blocked', reason: 'self' })
    expect(tierOf('chrome.exe', { overrides: { 'chrome.exe': 'full' } })).toEqual({ tier: 'full', reason: 'user' })
    expect(tierOf('capcut.exe', { overrides: { 'capcut.exe': 'blocked' } }).tier).toBe('blocked')
    expect(tierOf('capcut.exe', { overrides: { 'capcut.exe': 'bogus' as never } }).tier).toBe('full')
  })

  it('tiers allow the right actions', () => {
    const left = { kind: 'click', button: 'left', count: 1, modifiers: false } as const
    expect(tierAllows('full', { kind: 'drag' })).toBeNull()
    expect(tierAllows('read', { kind: 'look' })).toBeNull()
    expect(tierAllows('read', left)).toBe('read')
    expect(tierAllows('read', { kind: 'scroll', modifiers: false })).toBe('read')
    expect(tierAllows('click', left)).toBeNull()
    expect(tierAllows('click', { kind: 'scroll', modifiers: false })).toBeNull()
    expect(tierAllows('click', { ...left, count: 2 })).toBe('click')
    expect(tierAllows('click', { ...left, button: 'right' })).toBe('click')
    expect(tierAllows('click', { ...left, modifiers: true })).toBe('click')
    expect(tierAllows('click', { kind: 'type' })).toBe('click')
    expect(tierAllows('click', { kind: 'key' })).toBe('click')
    expect(tierAllows('click', { kind: 'drag' })).toBe('click')
    expect(tierAllows('blocked', { kind: 'look' })).toBeNull()
    expect(tierAllows('blocked', left)).toBe('blocked')
  })

  it('errors name the tier and the alternative', () => {
    expect(tierError('Google Chrome', 'read', 'browser', 'left_click')).toMatch(/tier "read".*browser_/)
    expect(tierError('VS Code', 'click', 'ide', 'type')).toMatch(/tier "click".*Bash/)
    expect(tierError('stag.ai', 'blocked', 'self', 'left_click')).toMatch(/stag\.ai itself/)
  })
})

describe('computer keys', () => {
  it('parses xdotool-style chords', () => {
    expect(parseChord('Return')).toEqual({ modifiers: [], key: VK.RETURN, name: 'return' })
    expect(parseChord('ctrl+s')).toEqual({ modifiers: ['ctrl'], key: 'S'.charCodeAt(0), name: 's' })
    expect(parseChord('ctrl+shift+Tab').modifiers).toEqual(['ctrl', 'shift'])
    expect(parseChord('cmd+a').modifiers).toEqual(['ctrl'])
    expect(parseChord('super').modifiers).toEqual(['win'])
    expect(parseChord('shift_l+Down')).toEqual({ modifiers: ['shift'], key: VK.DOWN, name: 'down' })
    expect(parseChord('F12').key).toBe(VK.F1 + 11)
    expect(parseChord('ctrl++').key).toBe(0xbb)
    expect(parseChord('shift').key).toBeNull()
    expect(keyCode('kp_5')).toBe(VK.NUMPAD0 + 5)
    expect(keyCode('7')).toBe('7'.charCodeAt(0))
    expect(() => parseChord('ctrl+a+b')).toThrow(/more than one main key/)
    expect(() => parseChord('hyperdrive')).toThrow(/Unknown key/)
    expect(() => parseChord('  ')).toThrow(/Empty key/)
  })

  it('detects system combos and the stop shortcut', () => {
    expect(isSystemCombo(parseChord('alt+f4'))).toBe(true)
    expect(isSystemCombo(parseChord('alt+tab'))).toBe(true)
    expect(isSystemCombo(parseChord('win+r'))).toBe(true)
    expect(isSystemCombo(parseChord('super'))).toBe(true)
    expect(isSystemCombo(parseChord('ctrl+shift+escape'))).toBe(true)
    expect(isSystemCombo(parseChord('ctrl+alt+delete'))).toBe(true)
    expect(isSystemCombo(parseChord('ctrl+s'))).toBe(false)
    expect(isSystemCombo(parseChord('alt+d'))).toBe(false)
    expect(chordId(chordFromAccelerator('Control+Alt+Q'))).toBe(chordId(parseChord('alt+ctrl+q')))
    expect(chordId(chordFromAccelerator('CommandOrControl+Shift+F12'))).toBe(chordId(parseChord('ctrl+shift+f12')))
  })

  it('types Vietnamese as UTF-16 units, newlines and tabs as keys', () => {
    expect(typeUnits('Ầ\r\nb\t😀')).toEqual([{ unit: 0x1ea6 }, { vk: VK.RETURN }, { unit: 98 }, { vk: VK.TAB }, { unit: 0xd83d }, { unit: 0xde00 }])
  })
})

describe('computer geometry', () => {
  it('frames like Claude Desktop (≈1.2 MP, long edge ≤ 1568)', () => {
    expect(frameSize(2560, 1440)).toMatchObject({ width: 1456, height: 819 })
    expect(frameSize(1920, 1080)).toMatchObject({ width: 1456, height: 819 })
    const p = frameSize(1080, 1920)
    expect(p.height).toBeLessThanOrEqual(1568)
    expect(p.width * p.height).toBeLessThanOrEqual(1_200_000)
    expect(frameSize(1024, 768)).toMatchObject({ width: 1024, height: 768, scale: 1 })
    expect(outputSize(2560, 1440, 0.5)).toEqual({ width: 728, height: 410 })
    expect(outputSize(2560, 1440, 5)).toEqual({ width: 1456, height: 819 })
  })

  it('maps frame points to physical pixels, incl. a display left of the primary', () => {
    const prim = { x: 0, y: 0, width: 2560, height: 1440 }
    const f = frameSize(2560, 1440)
    expect(frameToPhysical(prim, f, 0, 0)).toEqual({ x: 0, y: 0 })
    expect(frameToPhysical(prim, f, 728, 409)).toEqual({ x: 1280, y: 720 })
    expect(frameToPhysical(prim, f, 1455, 818)).toEqual({ x: 2559, y: 1439 })
    expect(frameToPhysical(prim, f, 99999, -5)).toEqual({ x: 2559, y: 0 })
    const left = { x: -1080, y: -383, width: 1080, height: 1920 }
    const lf = frameSize(1080, 1920)
    const p = frameToPhysical(left, lf, lf.width / 2, lf.height / 2)
    expect(p.x).toBeGreaterThan(-545)
    expect(p.x).toBeLessThan(-535)
    expect(physicalToFrame(left, lf, p.x, p.y)).toEqual({ x: Math.floor(lf.width / 2), y: Math.floor(lf.height / 2) })
    expect(physicalToFrame(left, lf, 5, 5)).toBeNull()
    // 150 %: Windows báo pixel thật, khung vẫn tính trên pixel thật.
    const hi = { x: 2560, y: 0, width: 3840, height: 2160 }
    const hf = frameSize(3840, 2160)
    // Ô cuối của khung ≈ 2,6 pixel thật: lấy điểm giữa ô.
    const last = frameToPhysical(hi, hf, hf.width - 1, hf.height - 1)
    expect(last.x).toBeGreaterThanOrEqual(2560 + 3836)
    expect(last.y).toBeGreaterThanOrEqual(2156)
    expect(last.x).toBeLessThanOrEqual(2560 + 3839)
  })

  it('validates points and zoom regions', () => {
    const f = { width: 1456, height: 819 }
    expect(checkFramePoint(f, [10, 10])).toBeNull()
    expect(checkFramePoint(f, [1456, 10])).toMatch(/outside/)
    expect(checkFramePoint(f, ['a', 1])).toMatch(/must be/)
    const d = { x: 0, y: 0, width: 2560, height: 1440 }
    const z = zoomRegion(d, f, [100, 50, 300, 150])
    expect(typeof z).toBe('object')
    expect(z).toMatchObject({ x: 175, y: 87 })
    expect(zoomRegion(d, f, [300, 150, 100, 50])).toEqual(z)
    expect(zoomRegion(d, f, [5, 5, 5, 5])).toMatch(/empty/)
    expect(zoomRegion(d, f, [0, 0, 99999, 99999])).toEqual({ x: 0, y: 0, width: 2560, height: 1440 })
  })

  it('finds the display under a point, or the nearest one', () => {
    const ds = [
      { id: 'a', label: 'A', primary: true, bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
      { id: 'b', label: 'B', primary: false, bounds: { x: -1080, y: -383, width: 1080, height: 1920 } }
    ]
    expect(displayAt(ds, -10, 0)?.id).toBe('b')
    expect(displayAt(ds, 10, 10)?.id).toBe('a')
    expect(displayAt(ds, 5000, 10)?.id).toBe('a')
  })

  it('masks non-granted windows, granted windows above them stay visible', () => {
    const w = 10
    const h = 4
    const bmp = new Uint8Array(w * h * 4).fill(200)
    const n = maskBitmap(bmp, w, h, [
      { rect: { x: 0, y: 0, width: 6, height: 4 }, masked: true },
      { rect: { x: 2, y: 1, width: 2, height: 2 }, masked: false }
    ])
    expect(n).toBe(24 - 4)
    const px = (x: number, y: number): number => bmp[(y * w + x) * 4]
    expect(px(0, 0)).toBe(44)
    expect(px(2, 1)).toBe(200)
    expect(px(7, 0)).toBe(200)
    expect(rectToImage({ x: 1280, y: 0, width: 1280, height: 720 }, { x: 0, y: 0, width: 2560, height: 1440 }, 1456, 819)).toEqual({ x: 728, y: 0, width: 728, height: 409.5 })
  })
})

describe('computer lock', () => {
  it('lets one session drive, frees on idle or release', () => {
    let now = 1000
    const lock = new ComputerLock(() => now, 60_000)
    const a = { agentId: 'a', agentName: 'A', sessionId: 's1', workspaceId: 'w' }
    const b = { agentId: 'b', agentName: 'B', sessionId: 's2', workspaceId: 'w' }
    expect(lock.acquire(a)).toEqual({ ok: true, fresh: true })
    expect(lock.acquire(a)).toEqual({ ok: true, fresh: false })
    const busy = lock.acquire(b)
    expect(busy.ok).toBe(false)
    now += 59_000
    expect(lock.acquire(b).ok).toBe(false)
    now += 61_000
    expect(lock.acquire(b)).toEqual({ ok: true, fresh: true })
    expect(lock.release('s1')).toBeNull()
    expect(lock.release('s2')?.agentId).toBe('b')
    expect(lock.current()).toBeNull()
    expect(lock.remainingMs()).toBeNull()
  })
})
