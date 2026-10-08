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
  templatesOpen: 'templates:open',
  agentSnapshot: 'agent:snapshot',
  agentCreate: 'agent:create',
  agentStart: 'agent:start',
  agentStop: 'agent:stop',
  agentRemove: 'agent:remove',
  agentLayout: 'agent:layout',
  boardSnapshot: 'board:snapshot',
  boardChanged: 'board:changed',
  taskComplete: 'task:complete',
  taskDrop: 'task:drop',
  browserState: 'browser:state',
  browserChanged: 'browser:changed',
  browserReveal: 'browser:reveal',
  browserNewTab: 'browser:new-tab',
  browserCloseTab: 'browser:close-tab',
  browserActivate: 'browser:activate',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserBounds: 'browser:bounds',
  browserAsk: 'browser:ask',
  browserAnswer: 'browser:answer',
  agentRename: 'agent:rename',
  agentReorder: 'agent:reorder',
  browserDevTools: 'browser:devtools',
  vaultIndex: 'vault:index',
  vaultSearch: 'vault:search',
  vaultWatch: 'vault:watch',
  vaultUnwatch: 'vault:unwatch',
  /** main → renderer: file trong vault đổi (Obsidian, agent hoặc người dùng sửa). Kèm `vaultPath`. */
  vaultChanged: 'vault:changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** main → renderer: cài đặt vừa đổi. */
  settingsChanged: 'settings:changed',
  /** Người dùng bấm "Bàn giao sang phiên mới". */
  agentHandoff: 'agent:handoff',
  /** main → renderer: phiên cũ đã đóng sau khi bàn giao, mở phiên mới cho agent (kèm agentId). */
  agentRestart: 'agent:restart',
  /** Người dùng trả lời câu hỏi khoá phạm vi (agent Codex sửa file trong vùng của agent khác). */
  scopeAnswer: 'scope:answer'
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
