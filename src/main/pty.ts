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
  /** Phần cuối chữ terminal đã xuất (log dev server cho tool preview_logs). */
  output: string
}

/** Giữ chừng này ký tự cuối của mỗi terminal. */
const OUTPUT_MAX = 200_000
/** Terminal đã thoát vẫn giữ phần chữ cuối (để đọc vì sao lệnh chết), tối đa chừng này cái. */
const ENDED_MAX = 20

export interface SpawnExtras {
  env?: Record<string, string>
  /** Lọc biến môi trường kế thừa trước khi thêm `env`. */
  filterEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  onExit?: (exit: PtyExit) => void
}

/** Quản lý các terminal thật (ConPTY trên Windows) và đẩy dữ liệu về renderer sở hữu. */
export class PtyManager {
  private sessions = new Map<string, Session>()
  private ended = new Map<string, string>()

  spawn(owner: WebContents, opts: PtySpawnOptions, extras: SpawnExtras = {}): string {
    const id = randomUUID()
    const proc = pty.spawn(opts.command || defaultShell, opts.args ?? [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...(extras.filterEnv ? extras.filterEnv(process.env) : process.env), FORCE_COLOR: '1', ...extras.env } as Record<string, string>
    })
    const session: Session = { proc, owner, lastInput: 0, output: '' }
    this.sessions.set(id, session)
    // Cửa sổ đóng thì tắt terminal; terminal thoát trước thì gỡ listener (không thì mỗi phiên để lại một listener).
    const onDestroyed = (): void => this.kill(id)
    owner.once('destroyed', onDestroyed)

    proc.onData((data) => {
      session.output += data
      if (session.output.length > OUTPUT_MAX * 1.5) session.output = session.output.slice(-OUTPUT_MAX)
      if (!owner.isDestroyed()) owner.send(IPC.ptyData, id, data)
    })
    proc.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      if (!owner.isDestroyed()) owner.removeListener('destroyed', onDestroyed)
      this.ended.set(id, session.output.slice(-OUTPUT_MAX))
      if (this.ended.size > ENDED_MAX) this.ended.delete(this.ended.keys().next().value!)
      // Lỗi trong phần dọn của bên gọi không được chặn sự kiện thoát (ô trên giao diện kẹt "đang chạy").
      try {
        extras.onExit?.({ exitCode, signal })
      } catch (e) {
        console.error('[pty] onExit', e)
      }
      if (!owner.isDestroyed()) owner.send(IPC.ptyExit, id, { exitCode, signal })
    })
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

  /** Chữ terminal đã xuất (phần cuối, còn mã màu); terminal đã thoát thì là phần cuối lúc thoát. */
  output(id: string): string {
    return this.sessions.get(id)?.output.slice(-OUTPUT_MAX) ?? this.ended.get(id) ?? ''
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
