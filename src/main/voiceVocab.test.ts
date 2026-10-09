import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanVocab, VocabCache } from './voiceVocab'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'stag-vocab-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

async function put(rel: string, text: string): Promise<void> {
  await fs.mkdir(join(dir, rel, '..'), { recursive: true })
  await fs.writeFile(join(dir, rel), text)
}

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('scanVocab', () => {
  it('lấy tên khai báo cấp cao nhất, tên file, thư viện; bỏ biến cục bộ, hằng VIẾT HOA, node_modules', async () => {
    await put(
      'src/App.tsx',
      [
        'import { useState } from "react"',
        'export function handleClick(): void {',
        '  const localThing = 1',
        '}',
        'export const VOICE_RATE = 16000',
        'export default function VoiceButton() { return handleClick() }',
        'class Sidebar {}',
        'handleClick(); handleClick()'
      ].join('\n')
    )
    await put('app/models.py', 'class UserProfile:\n    def load_avatar(self):\n        pass\n')
    await put('package.json', JSON.stringify({ dependencies: { zustand: '5', '@xterm/xterm': '6' }, devDependencies: { '@types/node': '1' } }))
    await put('node_modules/lib/index.js', 'export function hiddenThing() {}')
    await put('README.md', '# x')
    const terms = await scanVocab(dir)
    for (const t of ['handleClick', 'VoiceButton', 'Sidebar', 'UserProfile', 'load_avatar', 'App.tsx', 'models.py', 'README.md', 'zustand', 'xterm'])
      expect(terms).toContain(t)
    for (const t of ['localThing', 'VOICE_RATE', 'hiddenThing', 'node', 'useState']) expect(terms).not.toContain(t)
    // Được dùng nhiều hơn → đứng trước.
    expect(terms.indexOf('handleClick')).toBeLessThan(terms.indexOf('VoiceButton'))
  })

  it.runIf(hasGit)('repo git: bỏ file bị .gitignore', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir })
    await put('.gitignore', 'gen/\n')
    await put('gen/out.ts', 'export function generatedThing() {}')
    await put('src/real.ts', 'export function realThing() {}')
    const terms = await scanVocab(dir)
    expect(terms).toContain('realThing')
    expect(terms).not.toContain('generatedThing')
  })

  it('thư mục không có gì / không tồn tại → rỗng, không lỗi', async () => {
    expect(await scanVocab(join(dir, 'không có'))).toEqual([])
  })
})

describe('VocabCache', () => {
  it('quét một lần, dùng lại trong vài phút; quá hạn thì trả bản cũ ngay và quét lại nền', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let n = 0
    const scan = vi.fn(async () => [`v${++n}`])
    const c = new VocabCache(scan)
    expect(await c.get('a')).toEqual(['v1'])
    expect(await c.get('a')).toEqual(['v1'])
    expect(scan).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 4 * 60_000)
    expect(await c.get('a')).toEqual(['v1'])
    await Promise.resolve()
    await Promise.resolve()
    expect(await c.get('a')).toEqual(['v2'])
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('quét lỗi → rỗng', async () => {
    const c = new VocabCache(async () => {
      throw new Error('x')
    })
    expect(await c.get('a')).toEqual([])
  })
})
