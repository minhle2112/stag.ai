/**
 * App trên máy cho computer use: đọc shortcut trong Start menu (tên hiển thị → exe), ghép với cửa sổ đang chạy, đổi
 * tên agent đưa trong request_access ("CapCut", "Notepad", "capcut.exe") thành một app có khoá = tên exe thường.
 */
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import { exeKey } from './policy'

export interface AppEntry {
  /** Tên exe thường (khoá cấp quyền). */
  key: string
  displayName: string
  /** Đường dẫn exe nếu biết. */
  exe?: string
  /** Shortcut Start menu để mở app. */
  lnk?: string
}

/** App có sẵn của Windows không có shortcut .lnk (app Store / file trong System32). */
const BUILTIN: AppEntry[] = [
  { key: 'notepad.exe', displayName: 'Notepad', exe: 'C:\\Windows\\System32\\notepad.exe' },
  { key: 'mspaint.exe', displayName: 'Paint', exe: 'C:\\Windows\\System32\\mspaint.exe' },
  { key: 'explorer.exe', displayName: 'File Explorer', exe: 'C:\\Windows\\explorer.exe' },
  { key: 'calculatorapp.exe', displayName: 'Calculator', exe: 'C:\\Windows\\System32\\calc.exe' },
  { key: 'cmd.exe', displayName: 'Command Prompt', exe: 'C:\\Windows\\System32\\cmd.exe' },
  { key: 'windowsterminal.exe', displayName: 'Terminal', exe: 'wt.exe' },
  { key: 'powershell.exe', displayName: 'Windows PowerShell', exe: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
  { key: 'systemsettings.exe', displayName: 'Settings', exe: 'ms-settings:' },
  { key: 'snippingtool.exe', displayName: 'Snipping Tool', exe: 'ms-screenclip:' }
]

let cache: { at: number; apps: AppEntry[] } | null = null

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 4) return
  let items: import('node:fs').Dirent[]
  try {
    items = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const d of items) {
    const p = join(dir, d.name)
    if (d.isDirectory()) await walk(p, out, depth + 1)
    else if (/\.lnk$/i.test(d.name)) out.push(p)
  }
}

/** Shortcut gỡ cài đặt / tài liệu / web: không phải app. */
const SKIP_NAME = /\b(uninstall|gỡ|readme|help|website|documentation|license|release notes|manual)\b/i // i18n-ignore: lọc tên shortcut tiếng Việt

/** App cài trên máy (Start menu) + app có sẵn. Nhớ 5 phút. */
export async function installedApps(): Promise<AppEntry[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.apps
  const roots = [join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), join(process.env.APPDATA ?? '', 'Microsoft\\Windows\\Start Menu\\Programs')]
  const lnks: string[] = []
  for (const r of roots) await walk(r, lnks)
  const byKey = new Map<string, AppEntry>()
  for (const b of BUILTIN) byKey.set(b.key, b)
  for (const lnk of lnks) {
    const name = basename(lnk).replace(/\.lnk$/i, '')
    if (SKIP_NAME.test(name)) continue
    let target = ''
    try {
      target = process.platform === 'win32' ? shell.readShortcutLink(lnk).target : ''
    } catch {
      continue
    }
    if (!/\.exe$/i.test(target)) continue
    const key = exeKey(target)
    // Nhiều shortcut cùng exe (vd. "Visual Studio Code" và "Code"): giữ tên ngắn nhất.
    const old = byKey.get(key)
    if (!old || (old.lnk && name.length < old.displayName.length)) byKey.set(key, { key, displayName: name, exe: target, lnk })
  }
  const apps = [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  cache = { at: Date.now(), apps }
  return apps
}

/** Tên hiển thị cho một exe (Start menu nếu có, không thì tên file bỏ .exe). */
export function displayNameFor(apps: AppEntry[], exe: string): string {
  const key = exeKey(exe)
  const hit = apps.find((a) => a.key === key)
  if (hit) return hit.displayName
  const base = key.replace(/\.exe$/, '')
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : exe
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Đổi tên agent đưa thành app. Thứ tự: tên Start menu trùng → tên exe trùng → cửa sổ đang chạy có exe trùng →
 * chứa nhau (chỉ khi duy nhất). null = không thấy.
 */
export function resolveApp(name: string, apps: AppEntry[], running: Array<{ exe: string; title: string }>): AppEntry | null {
  const n = norm(name.split(/[\\/]/).pop() ?? name)
  if (!n) return null
  const exact = apps.find((a) => norm(a.displayName) === n)
  if (exact) return exact
  const byExe = apps.find((a) => norm(a.key) === n)
  if (byExe) return byExe
  const run = running.find((w) => norm(exeKey(w.exe)) === n)
  if (run) return { key: exeKey(run.exe), displayName: displayNameFor(apps, run.exe), exe: run.exe }
  const partial = apps.filter((a) => norm(a.displayName).includes(n) || (n.length >= 4 && n.includes(norm(a.displayName))))
  if (partial.length === 1) return partial[0]
  // Nhiều kết quả: ưu tiên tên ngắn nhất bắt đầu bằng chữ đã gõ ("Word" → "Word", không phải "WordPad").
  const starts = partial.filter((a) => norm(a.displayName).startsWith(n)).sort((a, b) => a.displayName.length - b.displayName.length)
  if (starts.length) return starts[0]
  const runPartial = running.filter((w) => norm(exeKey(w.exe)).includes(n) || norm(w.title).includes(n))
  const keys = [...new Set(runPartial.map((w) => exeKey(w.exe)))]
  if (keys.length === 1) {
    const w = runPartial[0]
    return { key: keys[0], displayName: displayNameFor(apps, w.exe), exe: w.exe }
  }
  return null
}

/** Vài tên gần đúng để gợi ý khi không tìm thấy. */
export function suggestApps(name: string, apps: AppEntry[], limit = 5): string[] {
  const n = norm(name)
  const first = n.split(' ')[0] ?? ''
  return apps
    .filter((a) => first && norm(a.displayName).split(' ').some((w) => w.startsWith(first.slice(0, 3))))
    .slice(0, limit)
    .map((a) => a.displayName)
}
