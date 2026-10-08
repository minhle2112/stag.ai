// Tên kênh IPC và kiểu dữ liệu dùng chung giữa main, preload và renderer.

export const IPC = {
  appInfo: 'app:info',
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  wsList: 'workspace:list',
  wsPick: 'workspace:pick',
  wsInspect: 'workspace:inspect',
  wsCreate: 'workspace:create',
  wsRemove: 'workspace:remove',
  vaultTree: 'vault:tree',
  vaultRead: 'vault:read',
  vaultOpenObsidian: 'vault:open-obsidian',
  vaultIsRegistered: 'vault:is-registered',
  openFolder: 'shell:open-folder',
  templatesOpen: 'templates:open'
} as const

export interface AppInfo {
  /** Thư mục làm việc lúc mở app (tạm dùng cho M0, M1 thay bằng workspace). */
  cwd: string
  platform: string
}

export interface PtySpawnOptions {
  /** Lệnh chạy; bỏ trống = shell mặc định (PowerShell trên Windows). */
  command?: string
  args?: string[]
  cwd: string
  cols: number
  rows: number
}

export interface PtyExit {
  exitCode: number
  signal?: number
}
