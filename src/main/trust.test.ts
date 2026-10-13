import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isClaudeFolderTrusted } from './trust'

describe('isClaudeFolderTrusted', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'stag-trust-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })
  const write = (projects: Record<string, unknown>): Promise<void> => writeFile(join(home, '.claude.json'), JSON.stringify({ projects }))

  it('tin cậy khi đúng thư mục đã chấp nhận', async () => {
    await write({ 'C:/work/app': { hasTrustDialogAccepted: true } })
    expect(await isClaudeFolderTrusted('C:\\work\\app', home)).toBe(true)
  })

  it('thư mục con theo thư mục cha đã tin, không ngược lại', async () => {
    await write({ 'C:/work': { hasTrustDialogAccepted: true } })
    expect(await isClaudeFolderTrusted('C:/work/app/src', home)).toBe(true)
    await write({ 'C:/work/app': { hasTrustDialogAccepted: true } })
    expect(await isClaudeFolderTrusted('C:/work', home)).toBe(false)
  })

  it('chưa chấp nhận / thiếu file / file hỏng → không tin cậy', async () => {
    await write({ 'C:/work/app': { hasTrustDialogAccepted: false } })
    expect(await isClaudeFolderTrusted('C:/work/app', home)).toBe(false)
    await write({})
    expect(await isClaudeFolderTrusted('C:/work/app', home)).toBe(false)
    await writeFile(join(home, '.claude.json'), '{not json')
    expect(await isClaudeFolderTrusted('C:/work/app', home)).toBe(false)
    await rm(join(home, '.claude.json'))
    expect(await isClaudeFolderTrusted('C:/work/app', home)).toBe(false)
  })

  it('CLAUDE_CONFIG_DIR: đọc <thư mục đó>/.claude.json, không đọc ~/.claude.json', async () => {
    await write({})
    const dir = join(home, 'claude2')
    await mkdir(dir)
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ projects: { 'C:/work/app': { hasTrustDialogAccepted: true } } }))
    expect(await isClaudeFolderTrusted('C:/work/app', home)).toBe(false)
    expect(await isClaudeFolderTrusted('C:/work/app', home, { CLAUDE_CONFIG_DIR: dir })).toBe(true)
  })
})
