import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: {} }))

describe('computer apps', () => {
  it('resolves Start-menu names, exe names and running windows', async () => {
    const { resolveApp, displayNameFor, suggestApps } = await import('./apps')
    const apps = [
      { key: 'capcut.exe', displayName: 'CapCut', exe: 'C:\\x\\CapCut.exe' },
      { key: 'notepad.exe', displayName: 'Notepad' },
      { key: 'winword.exe', displayName: 'Word' },
      { key: 'wordpad.exe', displayName: 'WordPad' },
      { key: 'explorer.exe', displayName: 'File Explorer' }
    ]
    const running = [{ exe: 'C:\\Apps\\Foo\\FooEditor.exe', title: 'Untitled - Foo Editor' }]
    expect(resolveApp('capcut', apps, running)?.key).toBe('capcut.exe')
    expect(resolveApp('CapCut.exe', apps, running)?.key).toBe('capcut.exe')
    expect(resolveApp('C:\\x\\CapCut.exe', apps, running)?.key).toBe('capcut.exe')
    expect(resolveApp('Word', apps, running)?.key).toBe('winword.exe')
    expect(resolveApp('wordp', apps, running)?.key).toBe('wordpad.exe')
    expect(resolveApp('file explorer', apps, running)?.key).toBe('explorer.exe')
    expect(resolveApp('fooeditor', apps, running)).toMatchObject({ key: 'fooeditor.exe', displayName: 'Fooeditor' })
    expect(resolveApp('Foo Editor', apps, running)?.key).toBe('fooeditor.exe')
    expect(resolveApp('photoshop', apps, running)).toBeNull()
    expect(displayNameFor(apps, 'C:\\x\\notepad.exe')).toBe('Notepad')
    expect(suggestApps('notpad', apps)).toContain('Notepad')
  })
})
