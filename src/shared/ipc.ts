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
  scopeAnswer: 'scope:answer',
  /** Lưu note người dùng sửa trong app (kèm nội dung gốc để phát hiện sửa chồng). */
  vaultWrite: 'vault:write',
  vaultCreate: 'vault:create',
  /** Agent đọc / ghi note nào (theo workspace). */
  vaultActivity: 'vault:activity',
  /** main → renderer: nhật ký đọc/ghi note của một workspace vừa đổi (kèm workspaceId). */
  vaultActivityChanged: 'vault:activity-changed',
  /** File agent tạo / sửa trong dự án (tab Artifacts). */
  artifactList: 'artifact:list',
  artifactStat: 'artifact:stat',
  artifactText: 'artifact:text',
  artifactForget: 'artifact:forget',
  artifactBytes: 'artifact:bytes',
  artifactThumb: 'artifact:thumb',
  artifactOpen: 'artifact:open',
  artifactReveal: 'artifact:reveal',
  /** main → renderer: danh sách artifact của một workspace vừa đổi (kèm workspaceId). */
  artifactsChanged: 'artifact:changed',
  /** Ghi đè cài đặt của một workspace / agent (null = theo cấp trên). */
  settingsOverride: 'settings:override',
  /** Phiên bản app / Electron, thư mục dữ liệu (Settings → Giới thiệu). */
  appMeta: 'app:meta',
  /** Các shell có trên máy (Settings → Chung → Terminal). */
  shellsList: 'shells:list',
  /** Hộp thoại chọn thư mục (kèm tiêu đề và thư mục mở sẵn). */
  pickFolder: 'dialog:pick-folder',
  /** Gửi một thông báo thử (Settings → Chung → Thông báo). */
  notifyTest: 'notify:test',
  /** Kiểm tra một adapter CLI (file chạy, phiên bản, đăng nhập). */
  adapterCheck: 'adapter:check',
  /** Chọn một file .exe (Cài đặt → Adapter → đường dẫn). */
  pickFile: 'dialog:pick-file',
  /** Adapter ngoài (alpha): danh sách, cài từ npm / thư mục, gỡ, sửa, kiểm tra; main báo khi danh sách đổi. */
  adapterExtList: 'adapter-ext:list',
  adapterExtInstall: 'adapter-ext:install',
  adapterExtRemove: 'adapter-ext:remove',
  adapterExtUpdate: 'adapter-ext:update',
  adapterExtCheck: 'adapter-ext:check',
  adapterExtChanged: 'adapter-ext:changed',
  /** Connector (MCP): thêm / sửa, gỡ, nhập JSON, chép máy chủ có sẵn, thử kết nối, quét máy chủ của Claude Code / Codex. */
  connectorSave: 'connector:save',
  connectorRemove: 'connector:remove',
  connectorImport: 'connector:import',
  connectorCopy: 'connector:copy',
  connectorTest: 'connector:test',
  connectorScan: 'connector:scan',
  /** Bí mật: chỉ tên đi qua IPC theo chiều main → renderer; main báo khi danh sách đổi. */
  secretsList: 'secrets:list',
  secretsSet: 'secrets:set',
  secretsRemove: 'secrets:remove',
  secretsChanged: 'secrets:changed',
  /** Connect từ danh mục (có thể mở trình duyệt đăng nhập OAuth), huỷ đăng nhập đang chờ, đăng nhập lại. */
  connectorConnect: 'connector:connect',
  connectorConnectCancel: 'connector:connect-cancel',
  connectorReauth: 'connector:reauth',
  /** Hàng chờ duyệt tool connector (Cài đặt → Connector → Duyệt); main báo khi đổi. */
  approvalsList: 'approvals:list',
  approvalsAnswer: 'approvals:answer',
  approvalsChanged: 'approvals:changed',
  /**
   * Skill: thư viện của stag.ai (danh sách, đọc, tạo, lưu, gỡ, nhập thư mục / zip, cài từ danh mục, chép skill có sẵn,
   * mở thư mục), đọc skill có sẵn / trong danh mục để xem, quét skill Claude Code / Codex tự nạp.
   */
  skillsList: 'skills:list',
  skillsRead: 'skills:read',
  skillsReadPath: 'skills:read-path',
  skillsCatalogDoc: 'skills:catalog-doc',
  skillsCreate: 'skills:create',
  skillsSave: 'skills:save',
  skillsRemove: 'skills:remove',
  skillsImport: 'skills:import',
  skillsInstall: 'skills:install',
  skillsCopy: 'skills:copy',
  skillsScan: 'skills:scan',
  skillsReveal: 'skills:reveal',
  /**
   * Plugin (alpha): danh sách, cài (npm / thư mục), duyệt quyền, gỡ, đọc lại / cài lại, khởi động lại worker,
   * lưu cấu hình, kiểm sức khoẻ, bấm một slot (mở URL / gọi worker); main báo khi danh sách / trạng thái đổi.
   */
  pluginsList: 'plugins:list',
  pluginsInstall: 'plugins:install',
  pluginsApprove: 'plugins:approve',
  pluginsRemove: 'plugins:remove',
  pluginsReload: 'plugins:reload',
  pluginsRestart: 'plugins:restart',
  pluginsConfig: 'plugins:config',
  pluginsHealth: 'plugins:health',
  pluginsSlot: 'plugins:slot',
  pluginsChanged: 'plugins:changed',
  pluginsBridge: 'plugins:bridge',
  pluginsRunJob: 'plugins:runJob',
  pluginsRotateWebhook: 'plugins:rotateWebhook',
  pluginsStream: 'plugins:stream',
  /** main → renderer: người dùng bấm thông báo của agent → mở agent đó (kèm workspaceId, agentId). */
  revealAgent: 'agent:reveal'
} as const

export interface AppInfo {
  /** Thư mục làm việc lúc mở app (tạm dùng cho M0, M1 thay bằng workspace). */
  cwd: string
  platform: string
}

export interface PtySpawnOptions {
  /** Lệnh chạy; bỏ trống = shell mặc định (PowerShell trên Windows). */
  command?: string
  /** Chuỗi = dòng lệnh thô đưa thẳng cho Windows (node-pty không tự thêm nháy), dùng khi chạy file .cmd qua cmd.exe. */
  args?: string[] | string
  cwd: string
  cols: number
  rows: number
}

export interface PtyExit {
  exitCode: number
  signal?: number
}
