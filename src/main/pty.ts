import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import { IPC, type PtySpawnOptions } from '@shared/ipc'

const defaultShell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'

interface Session {
  proc: pty.IPty
  owner: WebContents
}

/** Quản lý các terminal thật (ConPTY trên Windows) và đẩy dữ liệu về renderer sở hữu. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  spawn(owner: WebContents, opts: PtySpawnOptions): string {
    const id = randomUUID()
    const proc = pty.spawn(opts.command || defaultShell, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, FORCE_COLOR: '1' } as Record<string, string>
    })
    this.sessions.set(id, { proc, owner })

    proc.onData((data) => {
      if (!owner.isDestroyed()) owner.send(IPC.ptyData, id, data)
    })
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      if (!owner.isDestroyed()) owner.send(IPC.ptyExit, id, { exitCode, signal })
    })
    owner.once('destroyed', () => this.kill(id))
    return id
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(id)?.proc.resize(cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.sessions.delete(id)
    s.proc.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
