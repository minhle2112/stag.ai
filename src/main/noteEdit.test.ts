import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Workspace } from '@shared/types'
import { createNote, writeNote } from './vault'
import { mdMentions, VaultActivityLog, vaultTouches } from './vaultActivity'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }))

let vault: string

beforeEach(async () => {
  vault = await fs.mkdtemp(join(tmpdir(), 'stag-note-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(vault, { recursive: true, force: true })
})

describe('writeNote', () => {
  it('ghi khi file trên đĩa vẫn là bản gốc', async () => {
    await fs.writeFile(join(vault, 'a.md'), 'cũ', 'utf8')
    expect(await writeNote(vault, 'a.md', 'mới', 'cũ')).toEqual({ status: 'saved' })
    expect(await fs.readFile(join(vault, 'a.md'), 'utf8')).toBe('mới')
  })

  it('file đã bị sửa bên ngoài → không ghi, trả bản trên đĩa', async () => {
    await fs.writeFile(join(vault, 'a.md'), 'agent sửa', 'utf8')
    expect(await writeNote(vault, 'a.md', 'của tôi', 'cũ')).toEqual({ status: 'conflict', disk: 'agent sửa' })
    expect(await fs.readFile(join(vault, 'a.md'), 'utf8')).toBe('agent sửa')
  })

  it('file đã bị xoá → conflict với disk null; base null = ghi bất kể', async () => {
    expect(await writeNote(vault, 'gone.md', 'x', 'cũ')).toEqual({ status: 'conflict', disk: null })
    expect(await writeNote(vault, 'gone.md', 'x', null)).toEqual({ status: 'saved' })
    expect(await fs.readFile(join(vault, 'gone.md'), 'utf8')).toBe('x')
  })

  it('chặn đường dẫn ra ngoài vault và file không phải .md', async () => {
    await expect(writeNote(vault, '../x.md', 'x', null)).rejects.toThrow('ngoài vault')
    await expect(writeNote(vault, 'a.txt', 'x', null)).rejects.toThrow('.md')
  })
})

describe('createNote', () => {
  it('tạo note có tiêu đề trong thư mục (tạo thư mục nếu chưa có)', async () => {
    expect(await createNote(vault, '30 Features', 'Login flow')).toBe('30 Features/Login flow.md')
    expect(await fs.readFile(join(vault, '30 Features', 'Login flow.md'), 'utf8')).toBe('# Login flow\n\n')
    expect(await createNote(vault, '', 'Root.md')).toBe('Root.md')
  })

  it('không ghi đè note có sẵn, từ chối tên xấu', async () => {
    await createNote(vault, '', 'A')
    await expect(createNote(vault, '', 'A')).rejects.toThrow('Đã có note')
    await expect(createNote(vault, '', 'a/b')).rejects.toThrow('Tên note')
    await expect(createNote(vault, '', '[[x]]')).rejects.toThrow('Tên note')
    await expect(createNote(vault, '', '  ')).rejects.toThrow('Chưa nhập')
    await expect(createNote(vault, '..', 'x')).rejects.toThrow('ngoài vault')
  })
})

describe('hoạt động agent trong vault', () => {
  const P = 'C:\\proj'
  const V = 'C:\\proj\\proj memory'

  it('mdMentions: trong nháy (có khoảng trắng) và chữ liền', () => {
    expect(mdMentions(`Get-Content -LiteralPath 'proj memory\\_INDEX.md' -Encoding utf8; cat "proj memory/40 Log/2026-10-09.md"`)).toEqual([
      'proj memory\\_INDEX.md',
      'proj memory/40 Log/2026-10-09.md'
    ])
    expect(mdMentions('rg foo docs/a.md,docs/b.md')).toEqual(['docs/a.md', 'docs/b.md'])
    expect(mdMentions('npm test')).toEqual([])
  })

  it('vaultTouches: Read = đọc, Edit = ghi, shell theo dấu hiệu ghi; ngoài vault / không phải .md bị bỏ', () => {
    expect(vaultTouches({ tool_name: 'Read', tool_input: { file_path: `${V}\\_INDEX.md` } }, V, P)).toEqual([{ rel: '_INDEX.md', kind: 'read' }])
    expect(vaultTouches({ tool_name: 'Edit', tool_input: { file_path: `${V}\\40 Log\\X.md` } }, V, P)).toEqual([{ rel: '40 Log/X.md', kind: 'write' }])
    expect(vaultTouches({ tool_name: 'Read', tool_input: { file_path: `${P}\\src\\a.md` } }, V, P)).toEqual([])
    expect(vaultTouches({ tool_name: 'Read', tool_input: { file_path: `${V}\\img.png` } }, V, P)).toEqual([])
    expect(vaultTouches({ tool_name: 'Bash', tool_input: { command: "Get-Content 'proj memory\\_INDEX.md'" }, cwd: P }, V, P)).toEqual([
      { rel: '_INDEX.md', kind: 'read' }
    ])
    expect(vaultTouches({ tool_name: 'Bash', tool_input: { command: "Add-Content 'proj memory/40 Log/X.md' -Value y" }, cwd: P }, V, P)).toEqual([
      { rel: '40 Log/X.md', kind: 'write' }
    ])
    expect(
      vaultTouches(
        { tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: proj memory/60 Agents/Coder.md\n*** End Patch' }, cwd: P },
        V,
        P
      )
    ).toEqual([{ rel: '60 Agents/Coder.md', kind: 'write' }])
    expect(vaultTouches({ tool_name: 'Read', tool_input: { file_path: `${V}\\.obsidian\\x.md` } }, V, P)).toEqual([])
  })

  it('VaultActivityLog gộp lặp lại gần nhau, báo theo workspace', async () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const log = new VaultActivityLog(notify)
    const ws = { id: 'w', name: 'p', path: P, vaultPath: V, createdAt: '' } as Workspace
    const agent = { id: 'a', name: 'Coder' } as Agent
    const read = { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: `${V}\\_INDEX.md` } }
    log.onToolUse(ws, agent, read)
    log.onToolUse(ws, agent, read)
    log.onToolUse(ws, agent, { ...read, tool_name: 'Write' })
    expect(log.list('w').map((e) => [e.agentName, e.rel, e.kind])).toEqual([
      ['Coder', '_INDEX.md', 'read'],
      ['Coder', '_INDEX.md', 'write']
    ])
    log.onToolUse(ws, agent, { ...read, tool_name: 'Bash', tool_input: { command: 'npm test' } })
    vi.advanceTimersByTime(300)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('w')
    log.renameAgent('a', 'Coder 2')
    expect(log.list('w')[0].agentName).toBe('Coder 2')
  })
})
