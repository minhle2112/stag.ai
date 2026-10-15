import { promises as fs, readFileSync } from 'node:fs'
import { ipcMain } from 'electron'
import { CU_IPC, type ComputerCommand } from '@shared/computer'
import type { ComputerService, CuSession } from './service'

/** IPC của ô Máy tính, bảng @ cửa sổ và thanh tiêu đề. */
export function registerComputerIpc(svc: ComputerService, sessions: { computerSession(agentId: string): { ref: CuSession; enabled: boolean } | null }): void {
  ipcMain.handle(CU_IPC.getState, () => svc.state())
  ipcMain.handle(CU_IPC.windows, () => svc.windows())
  ipcMain.handle(CU_IPC.command, (_e, cmd: ComputerCommand) => {
    if (cmd === 'pause' || cmd === 'resume' || cmd === 'stop') svc.command(cmd)
  })
  ipcMain.handle(CU_IPC.revoke, (_e, sessionId: string, key?: string) => {
    if (typeof sessionId === 'string') svc.revoke(sessionId, typeof key === 'string' ? key : undefined)
  })
  ipcMain.handle(CU_IPC.attachWindow, async (_e, agentId: string, windowId: string, image?: boolean) => {
    if (typeof agentId !== 'string' || typeof windowId !== 'string') return { ok: false, error: 'bad request' }
    const s = sessions.computerSession(agentId)
    return svc.attachWindow(s?.ref ?? null, !!s?.enabled, windowId, image !== false)
  })
  ipcMain.handle(CU_IPC.tierFor, (_e, exe: string) => (typeof exe === 'string' ? svc.tierFor(exe) : null))
}

/** "Luôn cho agent này": app nhớ theo agent, lưu ở userData/computer-grants.json. */
export class AlwaysGrants {
  private data: Record<string, string[]> = {}

  constructor(private file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (raw && typeof raw === 'object')
        for (const [k, v] of Object.entries(raw as Record<string, unknown>))
          if (Array.isArray(v)) this.data[k] = v.filter((x): x is string => typeof x === 'string' && /\.exe$/i.test(x)).slice(0, 200)
    } catch {
      // Chưa có file / hỏng: bắt đầu trống (chỉ mất các app đã nhớ; agent sẽ xin lại).
    }
  }

  get(agentId: string): string[] {
    return this.data[agentId] ?? []
  }

  set(agentId: string, keys: string[]): void {
    if (keys.length) this.data[agentId] = [...new Set(keys)]
    else delete this.data[agentId]
    void fs.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8').catch((e) => console.error('[computer] save grants', e))
  }
}
