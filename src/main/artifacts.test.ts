import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Workspace } from '@shared/types'
import { ArtifactLog, isRunnableFile, outputRel, pathTokens, serveArtifact, toolTouches } from './artifacts'

// artifacts.ts → workspace.ts có import `app` của Electron (không dùng tới ở đây).
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => {
      throw new Error('không được đụng template')
    },
    getPath: () => {
      throw new Error('không được đụng userData')
    }
  }
}))

let root: string
let ws: Workspace

const agent = (id: string): Agent => ({
  id,
  workspaceId: 'ws1',
  name: `Agent ${id}`,
  role: 'Dev',
  permissionMode: 'default',
  createdAt: '2026-01-01T00:00:00.000Z'
})

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'stag-artifacts-'))
  ws = { id: 'ws1', name: 'demo', path: root, vaultPath: join(root, 'demo memory'), createdAt: '2026-01-01T00:00:00.000Z' }
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(root, { recursive: true, force: true })
})

describe('toolTouches', () => {
  it('Claude: Write = ghi, Edit/MultiEdit/NotebookEdit = sửa', () => {
    expect(toolTouches({ tool_name: 'Write', tool_input: { file_path: 'C:\\p\\a.png' } }).touches).toEqual([{ path: 'C:\\p\\a.png', kind: 'write' }])
    expect(toolTouches({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } }).touches).toEqual([{ path: 'src/a.ts', kind: 'edit' }])
    expect(toolTouches({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } }).touches).toEqual([{ path: 'n.ipynb', kind: 'edit' }])
    expect(toolTouches({ tool_name: 'Read', tool_input: { file_path: 'a.md' } })).toEqual({ touches: [], shell: [] })
  })

  it('Codex apply_patch: thêm / sửa / xoá / đổi tên', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: docs/new.md',
      '+hi',
      '*** Update File: src/old.ts',
      '*** Move to: src/renamed.ts',
      '@@',
      '*** Update File: src/keep.ts',
      '*** Delete File: tmp.txt',
      '*** End Patch'
    ].join('\n')
    expect(toolTouches({ tool_name: 'apply_patch', tool_input: { command: patch } }).touches).toEqual([
      { path: 'docs/new.md', kind: 'write' },
      { path: 'src/old.ts', kind: 'delete' },
      { path: 'src/renamed.ts', kind: 'write' },
      { path: 'src/keep.ts', kind: 'edit' },
      { path: 'tmp.txt', kind: 'delete' }
    ])
  })

  it('lệnh shell: trả về các chữ trông như file', () => {
    expect(toolTouches({ tool_name: 'Bash', tool_input: { command: 'python gen.py --out=out/chart.png' } }).shell).toEqual(['gen.py', 'out/chart.png'])
  })
})

describe('pathTokens', () => {
  it('đọc chữ trong nháy, sau = và bỏ URL / chữ không có đuôi', () => {
    expect(pathTokens(`ffmpeg -i "my clip.mov" -o:final.mp4 https://x.com/a.png 'a b.txt' ls`)).toEqual(['my clip.mov', 'final.mp4', 'a b.txt'])
    expect(pathTokens('echo hi > notes.txt && cat ..')).toEqual(['notes.txt'])
  })
})

describe('outputRel', () => {
  it('giữ hoa thường, bỏ file ngoài dự án, thư mục ẩn, node_modules và vault', () => {
    expect(outputRel(join(root, 'Out', 'Chart.PNG'), ws, root)).toBe('Out/Chart.PNG')
    expect(outputRel('src/a.ts', ws, join(root, 'pkg'))).toBe('pkg/src/a.ts')
    expect(outputRel('C:\\elsewhere\\a.png', ws, root)).toBeNull()
    expect(outputRel('.stag/tasks.json', ws, root)).toBeNull()
    expect(outputRel('node_modules/x/index.js', ws, root)).toBeNull()
    expect(outputRel('demo memory/40 Log/a.md', ws, root)).toBeNull()
  })
})

describe('ArtifactLog', () => {
  it('ghi file agent tạo / sửa, gộp lần lặp gần nhau, lưu xuống .stag/artifacts.json', async () => {
    const notify = vi.fn()
    const log = new ArtifactLog(notify)
    await log.onToolUse(ws, agent('a'), { tool_name: 'Write', tool_input: { file_path: join(root, 'out', 'a.png') } })
    await log.onToolUse(ws, agent('a'), { tool_name: 'Write', tool_input: { file_path: join(root, 'out', 'a.png') } })
    await log.onToolUse(ws, agent('b'), { tool_name: 'Edit', tool_input: { file_path: 'out/a.png' }, cwd: root })
    await log.onToolUse(ws, agent('a'), { tool_name: 'Read', tool_input: { file_path: join(root, 'x.md') } })
    const list = await log.list(ws)
    expect(list.map((e) => [e.agentId, e.rel, e.kind, e.tool])).toEqual([
      ['a', 'out/a.png', 'write', 'Write'],
      ['b', 'out/a.png', 'edit', 'Edit']
    ])
    await log.flush()
    const saved = JSON.parse(await fs.readFile(join(root, '.stag', 'artifacts.json'), 'utf8'))
    expect(saved.events).toHaveLength(2)
    // Mở lại app: đọc từ file.
    expect((await new ArtifactLog(() => {}).list(ws)).map((e) => e.rel)).toEqual(['out/a.png', 'out/a.png'])
  })

  it('flushSync (Windows tắt máy): ghi đồng bộ danh sách còn đang hẹn giờ lưu', async () => {
    const log = new ArtifactLog(() => {})
    await log.onToolUse(ws, agent('a'), { tool_name: 'Write', tool_input: { file_path: join(root, 'out', 'b.png') } })
    log.flushSync()
    const saved = JSON.parse(await fs.readFile(join(root, '.stag', 'artifacts.json'), 'utf8'))
    expect(saved.events.map((e: { rel: string }) => e.rel)).toEqual(['out/b.png'])
  })

  it('lệnh shell: chỉ tính file vừa được ghi; file artifact biến mất sau lệnh xoá = đã xoá', async () => {
    const log = new ArtifactLog(() => {})
    await fs.writeFile(join(root, 'chart.png'), 'x')
    await fs.writeFile(join(root, 'gen.py'), 'print(1)')
    const old = new Date(Date.now() - 10 * 60_000)
    await fs.utimes(join(root, 'gen.py'), old, old)
    await log.onToolUse(ws, agent('a'), { tool_name: 'Bash', tool_input: { command: 'python gen.py --out chart.png' }, cwd: root })
    expect((await log.list(ws)).map((e) => [e.rel, e.kind])).toEqual([['chart.png', 'write']])

    await fs.rm(join(root, 'chart.png'))
    await log.onToolUse(ws, agent('a'), { tool_name: 'PowerShell', tool_input: { command: 'Remove-Item chart.png' }, cwd: root })
    expect((await log.list(ws)).map((e) => [e.rel, e.kind])).toEqual([
      ['chart.png', 'write'],
      ['chart.png', 'delete']
    ])
  })

  it('đọc chữ để xem trước, nhận ra file nhị phân, chặn đường dẫn ra ngoài dự án', async () => {
    const log = new ArtifactLog(() => {})
    await fs.writeFile(join(root, 'a.txt'), 'xin chào')
    await fs.writeFile(join(root, 'b.bin'), Buffer.from([1, 0, 2]))
    expect(await log.text(ws, 'a.txt')).toEqual({ status: 'ok', text: 'xin chào', truncated: false })
    expect(await log.text(ws, 'a.txt', 4)).toEqual({ status: 'ok', text: 'xin ', truncated: true })
    expect(await log.text(ws, 'b.bin')).toEqual({ status: 'binary' })
    expect(await log.text(ws, 'missing.txt')).toEqual({ status: 'missing' })
    expect(await log.text(ws, '../outside.txt')).toEqual({ status: 'missing' })
    expect(await log.stat(ws, ['a.txt', 'missing.txt'])).toMatchObject({ 'a.txt': { size: 9 }, 'missing.txt': null })
  })

  it('ẩn một file khỏi danh sách và đổi tên agent', async () => {
    const log = new ArtifactLog(() => {})
    await log.onToolUse(ws, agent('a'), { tool_name: 'Write', tool_input: { file_path: join(root, 'A.md') } })
    await log.onToolUse(ws, agent('a'), { tool_name: 'Write', tool_input: { file_path: join(root, 'b.md') } })
    await log.renameAgent('a', 'Nam')
    await log.forget(ws, 'a.md')
    expect((await log.list(ws)).map((e) => [e.rel, e.agentName])).toEqual([['b.md', 'Nam']])
  })
})

describe('serveArtifact', () => {
  it('trả cả file hoặc một đoạn (Range), chặn đường dẫn ra ngoài', async () => {
    await fs.writeFile(join(root, 'v.mp4'), '0123456789')
    const full = await serveArtifact(ws, 'v.mp4', null)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(await full.text()).toBe('0123456789')

    const part = await serveArtifact(ws, 'v.mp4', 'bytes=2-5')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await part.text()).toBe('2345')

    expect((await serveArtifact(ws, 'v.mp4', 'bytes=-3')).headers.get('content-range')).toBe('bytes 7-9/10')
    expect((await serveArtifact(ws, 'v.mp4', 'bytes=20-')).status).toBe(416)
    expect((await serveArtifact(ws, '../x.mp4', null)).status).toBe(403)
    expect((await serveArtifact(ws, 'nope.png', null)).status).toBe(404)
  })

  it('junction / symlink trong dự án trỏ ra ngoài → chặn (403), dù chuỗi đường dẫn nằm trong dự án', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'stag-outside-'))
    await fs.writeFile(join(outside, 'secret.png'), 'x')
    await fs.symlink(outside, join(root, 'link'), 'junction')
    expect((await serveArtifact(ws, 'link/secret.png', null)).status).toBe(403)
    const log = new ArtifactLog(() => {})
    expect(await log.text(ws, 'link/secret.png')).toEqual({ status: 'missing' })
    expect(await log.stat(ws, ['link/secret.png'])).toEqual({ 'link/secret.png': null })
    await expect(log.bytes(ws, 'link/secret.png')).rejects.toThrow()
    await fs.rm(outside, { recursive: true, force: true })
  })
})

describe('isRunnableFile (nút "Mở" không chạy file agent tạo)', () => {
  it('nhận ra chương trình / script / lối tắt, kể cả viết hoa hay có dấu chấm cuối', () => {
    for (const f of ['setup.cmd', 'a.BAT', 'x.exe', 'run.ps1', 'note.vbs', 'tool.js', 'app.hta', 'link.lnk', 'site.url', 'x.msi', 'evil.cmd.', 'C:\p\y.scr'])
      expect(isRunnableFile(f), f).toBe(true)
  })
  it('file để xem thì mở bình thường', () => {
    for (const f of ['report.md', 'a.pdf', 'shot.png', 'data.csv', 'deck.pptx', 'index.html', 'notes.txt', 'cmd.md', 'exe'])
      expect(isRunnableFile(f), f).toBe(false)
  })
})
