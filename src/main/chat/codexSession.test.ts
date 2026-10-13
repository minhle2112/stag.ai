import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CodexChatSession } from './codexSession'

describe('CodexChatSession.kill trong lúc chạy thử hook', () => {
  it('kết thúc phiên ngay và không mở app-server sau đó', async () => {
    let exits = 0
    // `node app-server` thoát ngay (không có module) → chạy thử hook lỗi → boot() chạy tiếp.
    const s = new CodexChatSession({
      command: process.execPath,
      args: [],
      cwd: tmpdir(),
      env: process.env,
      emit: () => {},
      onExit: () => exits++,
      thread: { cwd: tmpdir(), developerInstructions: '' },
      hookUrl: 'http://127.0.0.1:1/hook'
    })
    const spawned: unknown[] = []
    const real = (s as unknown as { spawnProcess: (a?: string[]) => void }).spawnProcess.bind(s)
    ;(s as unknown as { spawnProcess: (a?: string[]) => void }).spawnProcess = (a) => {
      spawned.push(a)
      real(a)
    }
    s.start([], 'sid')
    s.send('làm đi', { origin: 'app' })
    s.kill()
    expect(exits).toBe(1)
    expect(s.alive).toBe(false)
    // Chờ lần chạy thử hook xong (node thoát ngay).
    await new Promise((r) => setTimeout(r, 1500))
    expect(exits).toBe(1)
    expect((s as unknown as { proc: unknown }).proc).toBeNull()
    expect(spawned.length).toBe(0)
  })
})
