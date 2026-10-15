import { ipcMain, nativeTheme } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, promises as fs, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { IPC } from '@shared/ipc'
import { flipTheme, themeState, type Theme, type ThemeState } from '@shared/theme'
import type { GeneralSettings, ThemePref } from '@shared/types'

/**
 * Màu của app (Cài đặt → Giao diện): đặt `nativeTheme.themeSource` (menu chuột phải, hộp thoại chọn file, thanh cuộn
 * Chromium), báo giao diện, và đổi theme của Claude Code trong ~/.claude.json khi người dùng bật.
 *
 * Màu của Windows đọc riêng: khi themeSource đã là 'light' / 'dark', `nativeTheme.shouldUseDarkColors` báo theo lựa chọn
 * của app chứ không theo Windows nữa. Mà trang web trong ô Trình duyệt và "Theo Windows" cần đúng màu của Windows.
 */
export class ThemeService {
  private windowsDark = true
  private state: ThemeState
  private claudeChain: Promise<void> = Promise.resolve()

  constructor(
    private deps: {
      general: () => GeneralSettings
      setPref: (pref: ThemePref) => Promise<unknown>
      changed: (s: ThemeState) => void
      /** ~/.claude.json */
      claudeConfig: string
      /** userData/claude-theme.json: theme cũ của Claude Code để trả lại khi tắt. */
      claudeBackup: string
    }
  ) {
    this.state = this.compute()
  }

  /** Gọi sau khi đọc cài đặt, trước khi tạo cửa sổ (cửa sổ lấy màu nền từ đây). */
  start(): void {
    // themeSource mặc định là 'system' → lúc này shouldUseDarkColors đúng là màu của Windows.
    nativeTheme.themeSource = 'system'
    this.windowsDark = nativeTheme.shouldUseDarkColors
    nativeTheme.on('updated', () => this.refreshWindows())
    this.apply(true)
  }

  get(): ThemeState {
    return this.state
  }

  /** Cài đặt đổi (hoặc Windows đổi): áp lại, chỉ báo khi có gì khác. */
  apply(force = false): void {
    const g = this.deps.general()
    const next = this.compute()
    if (nativeTheme.themeSource !== g.theme) nativeTheme.themeSource = g.theme
    const prev = this.state
    this.state = next
    if (force || JSON.stringify(prev) !== JSON.stringify(next)) this.deps.changed(next)
    this.syncClaude(g.claudeThemeSync, next.terminal)
  }

  /** Ctrl+Shift+L / nút mặt trời: chọn hẳn màu ngược với màu đang hiện. */
  async toggle(): Promise<void> {
    await this.deps.setPref(flipTheme(this.state.theme))
  }

  /**
   * Đọc lại màu của Windows: khi nativeTheme báo đổi, và mỗi lần cửa sổ app được chọn lại (người dùng vừa đổi trong
   * Cài đặt của Windows rồi quay về) — vì khi themeSource đã ghim, Electron không chắc còn báo Windows đổi.
   */
  refreshWindows(): void {
    if (nativeTheme.themeSource === 'system') return this.setWindowsDark(nativeTheme.shouldUseDarkColors)
    void readWindowsDark().then((d) => {
      if (d !== null) this.setWindowsDark(d)
    })
  }

  private setWindowsDark(dark: boolean): void {
    if (dark === this.windowsDark) return
    this.windowsDark = dark
    this.apply()
  }

  private compute(): ThemeState {
    const g = this.deps.general()
    return themeState(g.theme, this.windowsDark, g.terminalFollowTheme)
  }

  /** Ghi / trả lại theme của Claude Code. Lần lượt từng lần, lỗi thì bỏ qua (không có Claude Code, file đang khoá…). */
  private syncClaude(enabled: boolean, terminal: Theme): void {
    this.claudeChain = this.claudeChain
      .then(() => syncClaudeTheme(this.deps.claudeConfig, this.deps.claudeBackup, enabled, terminal))
      .catch(() => {})
  }
}

export function registerThemeIpc(svc: ThemeService): void {
  ipcMain.handle(IPC.themeGet, () => svc.get())
  // Script đầu trang (trước React) cần màu ngay, không chờ được lời hứa.
  ipcMain.on(IPC.themeGetSync, (e) => {
    e.returnValue = svc.get()
  })
  ipcMain.handle(IPC.themeToggle, () => svc.toggle())
}

const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** AppsUseLightTheme của Windows: 0 = tối. null = không đọc được (không phải Windows, thiếu khoá…). */
export function readWindowsDark(): Promise<boolean | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('reg', ['query', PERSONALIZE, '/v', 'AppsUseLightTheme'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(err ? null : parseAppsUseLightTheme(String(out)))
    })
  })
}

export function parseAppsUseLightTheme(out: string): boolean | null {
  const m = /AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out)
  return m ? parseInt(m[1], 16) === 0 : null
}

// ---- theme của Claude Code (~/.claude.json) ----

/** Theme cũ của người dùng (null = chưa đặt) và theme app đã ghi lần gần nhất. */
export interface ClaudeThemeBackup {
  original: string | null
  applied: string | null
}

/**
 * Việc cần làm với khoá `theme` của ~/.claude.json.
 * - Bật: terminal sáng → `light-ansi`; terminal tối → giữ theme tối / `auto` của người dùng (hoặc chưa đặt), không thì `dark-ansi`.
 *   Claude Code vẽ `*-ansi` bằng 16 màu ANSI của terminal, tức là theo bảng màu của app.
 * - Tắt: trả lại theme cũ, chỉ khi khoá vẫn là giá trị app đã ghi (người dùng tự đổi thì để nguyên).
 * `write` vắng = không ghi; `null` = xoá khoá.
 */
export function planClaudeTheme(
  current: string | null,
  backup: ClaudeThemeBackup | null,
  enabled: boolean,
  terminal: Theme
): { write?: string | null; backup: ClaudeThemeBackup | null } {
  if (!enabled) {
    if (!backup) return { backup: null }
    return current === backup.applied && current !== backup.original ? { write: backup.original, backup: null } : { backup: null }
  }
  // Chưa ghi lần nào, hoặc người dùng đã tự đổi theme sau lần ghi trước: giá trị đang có là theme "của họ".
  const original = backup && backup.applied === current ? backup.original : current
  // `auto` tự theo nền terminal nên giữ khi terminal tối.
  const keepDark = original === null || original === 'auto' || /^dark/.test(original)
  const target = terminal === 'light' ? 'light-ansi' : keepDark ? original : 'dark-ansi'
  const next = { original, applied: target }
  return target === current ? { backup: next } : { write: target, backup: next }
}

/** Đổi (hoặc xoá khi `value` null) một khoá cấp đầu của file JSON, giữ thứ tự khoá, thụt lề và dòng trống cuối file. */
export function setJsonKey(text: string, key: string, value: string | null): string {
  const obj = JSON.parse(text) as Record<string, unknown>
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object')
  if (value === null) delete obj[key]
  else obj[key] = value
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? (/^\{\r?\n/.test(text) ? '  ' : '')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  let out = JSON.stringify(obj, null, indent || undefined)
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n')
  return /\r?\n$/.test(text) ? out + eol : out
}

async function syncClaudeTheme(file: string, backupFile: string, enabled: boolean, terminal: Theme, attempt = 0): Promise<void> {
  const backup = await readBackup(backupFile)
  if (!enabled && !backup) return
  if (!existsSync(file)) return
  // Claude Code ghi file này thường xuyên: đọc - sửa - ghi liền một mạch (đồng bộ) để ít giẫm lên lần ghi của nó nhất.
  const text = readFileSync(file, 'utf8')
  const json = JSON.parse(text) as Record<string, unknown>
  const current = typeof json.theme === 'string' ? json.theme : null
  const plan = planClaudeTheme(current, backup, enabled, terminal)
  if (plan.write !== undefined) {
    const out = setJsonKey(text, 'theme', plan.write)
    const tmp = `${file}.stag-tmp`
    writeFileSync(tmp, out, 'utf8')
    // Không bao giờ ghi thẳng vào file đang dùng: Claude Code có thể đọc phải file dở (nó coi là hỏng và tạo lại cấu hình)
    // hoặc phần nó vừa ghi bị đè mất. Đổi tên không được thì thử lại; file đổi trong lúc chờ thì làm lại từ đầu.
    for (let i = 0; ; i++) {
      try {
        renameSync(tmp, file)
        break
      } catch (e) {
        if (i >= 4) {
          await fs.rm(tmp, { force: true })
          console.warn('[theme] could not change the Claude Code theme', (e as Error).message)
          return
        }
      }
      await new Promise((r) => setTimeout(r, 80 * (i + 1)))
      if (readFileSync(file, 'utf8') !== text) {
        await fs.rm(tmp, { force: true })
        if (attempt < 2) return syncClaudeTheme(file, backupFile, enabled, terminal, attempt + 1)
        return
      }
    }
  }
  if (plan.backup) {
    await fs.mkdir(dirname(backupFile), { recursive: true })
    await fs.writeFile(backupFile, JSON.stringify(plan.backup), 'utf8')
  } else await fs.rm(backupFile, { force: true })
}

async function readBackup(file: string): Promise<ClaudeThemeBackup | null> {
  try {
    const r = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<ClaudeThemeBackup>
    const s = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return { original: s(r.original), applied: s(r.applied) }
  } catch {
    return null
  }
}
