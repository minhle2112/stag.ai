import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexLogin, independentSessionEnv } from './adapters'
import { resolveCodex } from './codex'

/**
 * Thử thật: gọi codex.exe trên máy (đúng file app dùng) như AdapterService.check('codex').
 * Chỉ chạy khi STAG_LIVE=1 (cần Codex CLI đã cài + đã `codex login`):  STAG_LIVE=1 npx vitest run codexLogin.live
 */
const live = process.env.STAG_LIVE === '1'

function loginStatus(exe: string, env: NodeJS.ProcessEnv): Promise<{ code: number; text: string }> {
  return new Promise((resolve) =>
    execFile(exe, ['login', 'status'], { env, timeout: 20_000, windowsHide: true }, (error, stdout, stderr) =>
      resolve({ code: error ? Number((error as { code?: unknown }).code ?? 1) : 0, text: `${stdout}\n${stderr}` })
    )
  )
}

describe.runIf(live)('Codex: đăng nhập (thử thật)', () => {
  it('máy này đã đăng nhập → state "in"', async () => {
    const exe = await resolveCodex()
    const r = await loginStatus(exe, independentSessionEnv(process.env))
    expect(r.code).toBe(0)
    expect(codexLogin(r.text).state).toBe('in')
  }, 30_000)

  it('CODEX_HOME trống → state "out" (exit 1)', async () => {
    const exe = await resolveCodex()
    // CODEX_HOME trong Temp: Codex in thêm một dòng WARNING (không tạo helper) rồi vẫn báo "Not logged in".
    const home = await fs.mkdtemp(join(tmpdir(), 'stag-codex-home-'))
    try {
      const r = await loginStatus(exe, { ...independentSessionEnv(process.env), CODEX_HOME: home })
      expect(r.code).toBe(1)
      expect(codexLogin(r.text)).toEqual({ state: 'out', detail: 'Chưa đăng nhập' })
    } finally {
      await fs.rm(home, { recursive: true, force: true })
    }
  }, 30_000)
})
