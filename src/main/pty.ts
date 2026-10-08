import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { IPC, type PtyExit, type PtySpawnOptions } from '@shared/ipc'

const defaultShell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

interface Session {
  proc: pty.IPty
  owner: WebContents
  /** Lần cuối người dùng gõ vào terminal (ms); 0 = chưa gõ. */
  lastInput: number
}

export interface SpawnExtras {
  env?: Record<string, string>
  /** Lọc biến môi trường kế thừa trước khi thêm `env`. */
  filterEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  onExit?: (exit: PtyExit) => void
}

/** Quản lý các terminal thật (ConPTY trên Windows) và đẩy dữ liệu về renderer sở hữu. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  spawn(owner: WebContents, opts: PtySpawnOptions, extras: SpawnExtras = {}): string {
    const id = randomUUID()
    const proc = pty.spawn(opts.command || defaultShell, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...(extras.filterEnv ? extras.filterEnv(process.env) : process.env), FORCE_COLOR: '1', ...extras.env } as Record<string, string>
    })
    this.sessions.set(id, { proc, owner, lastInput: 0 })

    proc.onData((data) => {
      if (!owner.isDestroyed()) owner.send(IPC.ptyData, id, data)
    })
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      extras.onExit?.({ exitCode, signal })
      if (!owner.isDestroyed()) owner.send(IPC.ptyExit, id, { exitCode, signal })
    })
    owner.once('destroyed', () => this.kill(id))
    return id
  }

  isAlive(id: string): boolean {
    return this.sessions.has(id)
  }

  /** Ghi vào terminal. `fromUser` = người dùng gõ (app tự gõ thì không tính là người dùng đang gõ). */
  write(id: string, data: string, fromUser = true): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (fromUser) s.lastInput = Date.now()
    s.proc.write(data)
  }

  lastInputAt(id: string): number {
    return this.sessions.get(id)?.lastInput ?? 0
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(id)?.proc.resize(cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.proc.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
