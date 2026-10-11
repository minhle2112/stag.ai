/**
 * Dev server của dự án (Tab mới của browser + tool preview_* của agent): đoán lệnh chạy từ package.json, đọc / ghi
 * `.stag/launch.json` (cùng dạng `configurations` với `.claude/launch.json` của Claude desktop), dựng dòng lệnh để gõ
 * vào ô terminal. Logic thuần, dùng chung main và renderer.
 */

export interface LaunchConfig {
  /** Tên duy nhất trong dự án (agent gọi preview_start theo tên này). */
  name: string
  runtimeExecutable: string
  runtimeArgs?: string[]
  port: number
  /** Trang mở khi server chạy; vắng = http://localhost:<port>. */
  url?: string
}

export interface LaunchFile {
  version: string
  configurations: LaunchConfig[]
}

/** Một cách chạy dev server như Tab mới hiện. */
export interface DevServerEntry extends LaunchConfig {
  /** Lệnh hiển thị (`npm run dev`). */
  command: string
  /** Cổng đang mở (server đã chạy, có thể do người dùng tự chạy ngoài app). */
  running: boolean
}

export interface DevServerList {
  /** Đã lưu trong `.stag/launch.json` (theo thứ tự trong file). */
  saved: DevServerEntry[]
  /** Đoán từ package.json…, trừ tên đã lưu. */
  detected: DevServerEntry[]
}

/** Đường dẫn file lưu lựa chọn, tương đối với thư mục dự án. */
export const LAUNCH_FILE = '.stag/launch.json'
export const LAUNCH_VERSION = '0.0.1'

/** Script npm đáng thử, theo thứ tự ưu tiên. */
const SCRIPT_ORDER = ['dev', 'start', 'serve', 'develop', 'preview']

/** Script chạy app desktop / mobile, không phải trang web (vd. chính stag.ai: `electron-vite dev`). */
const NOT_WEB = /^\s*(electron(-vite|-forge|-builder)?|tauri|expo|react-native|cap|ionic)\b/i

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** Trình quản lý gói theo file lock có trong thư mục dự án. */
export function packageManagerOf(files: readonly string[]): PackageManager {
  const has = (n: string): boolean => files.includes(n)
  if (has('pnpm-lock.yaml')) return 'pnpm'
  if (has('yarn.lock')) return 'yarn'
  if (has('bun.lockb') || has('bun.lock')) return 'bun'
  return 'npm'
}

/** Cổng ghi thẳng trong lệnh: `--port 4000`, `--port=4000`, `-p 4000`, `PORT=4000`. */
export function portInScript(script: string): number | null {
  const m = /(?:--port[= ]|\s-p\s+|\bPORT=)(\d{2,5})\b/.exec(script)
  return m ? validPort(Number(m[1])) : null
}

function validPort(n: number): number | null {
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null
}

/** `PORT=…` trong nội dung file .env. */
export function portInEnv(text: string): number | null {
  const m = /^\s*PORT\s*=\s*["']?(\d{2,5})["']?\s*$/m.exec(text)
  return m ? validPort(Number(m[1])) : null
}

/** `server: { port: 3001 }` trong vite.config / astro.config…. */
export function portInConfig(text: string): number | null {
  const m = /\bserver\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})/.exec(text)
  return m ? validPort(Number(m[1])) : null
}

/** Cổng mặc định của công cụ chạy trong script (null = không nhận ra). */
export function defaultPortOf(script: string): number | null {
  const s = script.trim()
  const rules: Array<[RegExp, number]> = [
    [/\bvite\s+preview\b/, 4173],
    [/\b(vite|svelte-kit\s+dev|vinxi\s+dev)\b/, 5173],
    [/\bnext\b/, 3000],
    [/\b(nuxt|nuxi)\b/, 3000],
    [/\bastro\b/, 4321],
    [/\bng\s+serve\b/, 4200],
    [/\breact-scripts\s+start\b/, 3000],
    [/\bremix\b/, 3000],
    [/\bgatsby\s+develop\b/, 8000],
    [/\b(webpack-dev-server|webpack\s+serve)\b/, 8080],
    [/\bparcel\b/, 1234],
    [/\b(http-server|live-server)\b/, 8080],
    [/\beleventy\b.*--serve/, 8080],
    [/\bserve\b/, 3000]
  ]
  for (const [re, port] of rules) if (re.test(s)) return port
  return null
}

export interface ProjectFiles {
  /** Nội dung package.json (đã parse), null = không có. */
  pkg: { scripts?: Record<string, unknown> } | null
  /** Tên file ở thư mục gốc dự án. */
  files: readonly string[]
  /** Nội dung .env / .env.local (nối lại), '' = không có. */
  env?: string
  /** Nội dung vite.config.* / astro.config.* …, '' = không có. */
  config?: string
}

/** Đoán các cách chạy dev server của dự án (chưa lưu). Không nhận ra gì → []. */
export function detectLaunch(p: ProjectFiles): LaunchConfig[] {
  const out: LaunchConfig[] = []
  const scripts = p.pkg?.scripts ?? {}
  const pm = packageManagerOf(p.files)
  for (const name of SCRIPT_ORDER) {
    const script = scripts[name]
    if (typeof script !== 'string' || !script.trim() || NOT_WEB.test(script)) continue
    const known = defaultPortOf(script)
    // `start` của dự án node thuần (vd. `node server.js`) vẫn hay là web server; script lạ khác thì bỏ.
    if (known === null && name !== 'dev' && name !== 'start') continue
    const port = portInScript(script) ?? (p.config && name !== 'preview' ? portInConfig(p.config) : null) ?? (p.env ? portInEnv(p.env) : null) ?? known ?? 3000
    out.push({ name, runtimeExecutable: pm, runtimeArgs: ['run', name], port })
  }
  if (!out.length && p.files.includes('manage.py'))
    out.push({ name: 'django', runtimeExecutable: 'python', runtimeArgs: ['manage.py', 'runserver'], port: 8000 })
  return out
}

const NAME_RE = /^[\w .:@/-]{1,60}$/
/** Một ký tự xuống dòng gõ vào terminal là chạy lệnh: không cho trong bất kỳ trường nào. */
const NO_CONTROL = /^[^\x00-\x1f\x7f]*$/

/** Lỗi của một cấu hình (null = hợp lệ). */
export function launchProblem(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'not an object'
  const o = c as Record<string, unknown>
  if (typeof o.name !== 'string' || !NAME_RE.test(o.name.trim())) return 'name must be 1–60 letters, digits, spaces or . _ : @ / -'
  if (typeof o.runtimeExecutable !== 'string' || !o.runtimeExecutable.trim() || !NO_CONTROL.test(o.runtimeExecutable))
    return 'runtimeExecutable must be a command, e.g. "npm"'
  if (o.runtimeArgs !== undefined && (!Array.isArray(o.runtimeArgs) || o.runtimeArgs.some((a) => typeof a !== 'string' || !NO_CONTROL.test(a))))
    return 'runtimeArgs must be a list of strings'
  if (typeof o.port !== 'number' || validPort(o.port) === null) return 'port must be a number from 1 to 65535'
  if (o.url !== undefined) {
    if (typeof o.url !== 'string') return 'url must be a string'
    try {
      const u = new URL(o.url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'url must be http(s)'
    } catch {
      return 'url is not a valid URL'
    }
  }
  return null
}

function clean(c: LaunchConfig): LaunchConfig {
  return {
    name: c.name.trim(),
    runtimeExecutable: c.runtimeExecutable.trim(),
    ...(c.runtimeArgs?.length ? { runtimeArgs: [...c.runtimeArgs] } : {}),
    port: c.port,
    ...(c.url ? { url: c.url } : {})
  }
}

/** Đọc `.stag/launch.json`: bỏ cấu hình hỏng / trùng tên, file hỏng → []. */
export function parseLaunch(raw: string | null): LaunchConfig[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = (data as { configurations?: unknown })?.configurations
  if (!Array.isArray(list)) return []
  const out: LaunchConfig[] = []
  for (const c of list) {
    if (launchProblem(c)) continue
    const cfg = clean(c as LaunchConfig)
    if (!out.some((x) => sameName(x.name, cfg.name))) out.push(cfg)
  }
  return out
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Thêm / thay cấu hình cùng tên, giữ thứ tự cũ; trả về nội dung file mới. */
export function upsertLaunch(raw: string | null, cfg: LaunchConfig): string {
  let data: Record<string, unknown> = {}
  try {
    const d = raw ? (JSON.parse(raw) as unknown) : null
    if (d && typeof d === 'object' && !Array.isArray(d)) data = d as Record<string, unknown>
  } catch {
    // File hỏng: viết lại từ đầu.
  }
  const list = Array.isArray(data.configurations) ? [...(data.configurations as unknown[])] : []
  const i = list.findIndex((c) => typeof (c as LaunchConfig)?.name === 'string' && sameName((c as LaunchConfig).name, cfg.name))
  if (i >= 0) list[i] = clean(cfg)
  else list.push(clean(cfg))
  const file = { version: typeof data.version === 'string' ? data.version : LAUNCH_VERSION, ...data, configurations: list }
  return JSON.stringify(file, null, 2) + '\n'
}

export function launchUrl(c: LaunchConfig): string {
  return c.url || `http://localhost:${c.port}`
}

/** Trên Windows `npm` trong PowerShell là npm.ps1, hay bị chặn bởi execution policy: gọi bản .cmd. */
const WIN_CMD = new Set(['npm', 'npx', 'pnpm', 'yarn'])

function quoteArg(a: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`
}

/** Dòng lệnh gõ vào ô terminal (không kèm Enter). */
export function commandLine(c: LaunchConfig, platform: string = 'win32'): string {
  const exe = platform === 'win32' && WIN_CMD.has(c.runtimeExecutable) ? `${c.runtimeExecutable}.cmd` : c.runtimeExecutable
  return [exe, ...(c.runtimeArgs ?? [])].map(quoteArg).join(' ')
}

/** Lệnh hiển thị cho người đọc (`npm run dev`), không đổi sang .cmd. */
export function commandLabel(c: LaunchConfig): string {
  return [c.runtimeExecutable, ...(c.runtimeArgs ?? [])].map(quoteArg).join(' ')
}

/** Tách `npm run dev -- --port 4000` thành exe + args (tôn trọng "…" và '…'). */
export function splitCommand(command: string): { runtimeExecutable: string; runtimeArgs: string[] } | null {
  const parts: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) parts.push(m[1] ?? m[2] ?? m[3])
  if (!parts.length) return null
  return { runtimeExecutable: parts[0], runtimeArgs: parts.slice(1) }
}

/** Tên ô terminal chạy dev server. */
export function devCellName(name: string): string {
  return `Dev · ${name.replace(/[<>:"/\\|?*]/g, '-')}`.slice(0, 60).replace(/\.+$/, '')
}

/**
 * Chữ xuất ra của terminal → các dòng chữ thường: bỏ mã màu / điều khiển, `\r` giữa dòng (thanh tiến độ) chỉ giữ phần
 * viết sau cùng.
 */
export function terminalLines(raw: string): string[] {
  const text = raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
  return text
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      return (parts.filter((p) => p.length).at(-1) ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd()
    })
}

/** Dòng báo lệnh không chạy được ngay (khỏi đợi hết giờ chờ cổng mở). */
export function startupFailure(lines: readonly string[]): string | null {
  const bad = [
    /npm (ERR!|error) (code|Missing script)/i,
    /is not recognized as (the name of a cmdlet|an internal or external command)/i,
    /command not found/i,
    /cannot be loaded because running scripts is disabled/i,
    /ERR_PNPM_NO_SCRIPT|Command ".+" not found/i,
    /EADDRINUSE/,
    /Cannot find module/
  ]
  for (const line of lines) if (bad.some((re) => re.test(line))) return line.trim()
  return null
}
