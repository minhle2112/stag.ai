/**
 * Computer use (giống Claude Desktop): agent Claude nhìn màn hình Windows và điều khiển chuột / bàn phím qua máy chủ
 * MCP `computer` (mcp.ts). Ở đây giữ trạng thái chung: quyền theo phiên / "luôn cho agent", khoá một agent một
 * lúc, tạm dừng khi người dùng đụng chuột, phím dừng toàn cục, viền nổi, nhật ký thao tác, trạng thái cho ô Máy tính.
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, globalShortcut, nativeImage } from 'electron'
import { t } from '@shared/i18n'
import { COMPUTER_STOP_HOTKEYS, CU_IPC, type ComputerAppAsk, type ComputerAsk, type ComputerAttach, type ComputerGrant, type ComputerLogLine, type ComputerSettings, type ComputerState, type ComputerWindow } from '@shared/computer'
import { captureDisplay, captureWindow, physicalDisplays, render, type MaskWindow } from './capture'
import { checkFramePoint, displayAt, frameSize, frameToPhysical, physicalToFrame, zoomRegion, type PhysicalDisplay } from './geometry'
import { chordFromAccelerator, chordId, isSystemCombo, MOD_VK, parseChord, typeUnits, type Chord } from './keys'
import { ComputerLock } from './lock'
import { defaultTier, tierAllows, tierError, tierOf, type ActionKind } from './policy'
import { displayNameFor, installedApps, resolveApp, suggestApps, type AppEntry } from './apps'
import { ComputerOverlay } from './overlay'
import * as win from './win32'

/** Phiên agent đang gọi tool. */
export interface CuSession {
  agentId: string
  agentName: string
  workspaceId: string
  workspacePath: string
  sessionId: string
}

export type CuImage = { type: 'image'; data: string; mimeType: string }
export type CuText = { type: 'text'; text: string }
export type CuContent = CuText | CuImage
export interface CuResult {
  content: CuContent[]
  isError?: boolean
}

/** Lỗi gửi agent (tiếng Anh). */
class CuError extends Error {}

interface SessionState {
  ref: CuSession
  apps: Map<string, { displayName: string; scope: 'session' | 'always' }>
  flags: { clipboardRead: boolean; clipboardWrite: boolean; systemKeyCombos: boolean }
  /** Màn hình chọn bằng switch_display; null = tự chọn. */
  display: string | null
  /** Ảnh toàn màn hình gần nhất: khung toạ độ cho click / zoom. */
  shot: { display: PhysicalDisplay; frame: { width: number; height: number } } | null
  /** Người dùng bấm Dừng: thao tác sau báo STOPPED tới khi agent xin quyền lại. */
  stopped: boolean
  /** Nút chuột trái đang giữ (left_mouse_down). */
  mouseHeld: boolean
}

export interface ComputerDeps {
  settings(): ComputerSettings
  /** Computer use có bật cho agent này không (Cài đặt → Máy tính, app → workspace → agent). */
  enabledFor(workspaceId: string, agentId: string): boolean
  /** Cửa sổ chính của stag.ai (thu nhỏ khi agent điều khiển). */
  mainWindows(): BrowserWindow[]
  /** "Luôn cho agent này": đọc / ghi danh sách khoá app nhớ cho agent. */
  alwaysApps(agentId: string): string[]
  saveAlwaysApps(agentId: string, keys: string[]): void
  /** Ai đang điều khiển máy thay đổi (khay / thanh tác vụ báo hiệu). */
  onDriving?(who: { agentName: string; paused: boolean } | null): void
}

const SETTLE_MS = 350
const LOG_MAX = 120
const TYPE_CHUNK = 40

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class ComputerService {
  private sessions = new Map<string, SessionState>()
  private lock = new ComputerLock()
  private overlay: ComputerOverlay
  private paused = false
  /** Toạ độ chuột (pixel thật) agent để lại sau thao tác gần nhất, để biết người dùng có di chuột không. */
  private agentCursor: { x: number; y: number } | null = null
  private lastAction = ''
  private log: ComputerLogLine[] = []
  private shot: ComputerState['shot']
  /** Thao tác chạy lần lượt (một luồng chuột / phím cho cả máy). */
  private queue: Promise<unknown> = Promise.resolve()
  private hotkey: string | null = null
  private minimized = false
  /** Tăng mỗi lần người dùng bấm Dừng: thao tác dài (gõ, chờ, giữ phím) kiểm tra để dừng giữa chừng. */
  private stopGen = 0
  private idleTimer: NodeJS.Timeout | null = null
  private appsCache: AppEntry[] = []
  private iconCache = new Map<string, string>()
  private drivingKey = ''

  constructor(private deps: ComputerDeps) {
    this.overlay = new ComputerOverlay((cmd) => this.command(cmd))
  }

  // ---- trạng thái cho renderer ----

  state(): ComputerState {
    const holder = this.lock.current()
    const avail = win.available()
    return {
      available: avail.ok,
      error: avail.error,
      holder: holder ? { agentId: holder.agentId, agentName: holder.agentName, workspaceId: holder.workspaceId, sessionId: holder.sessionId, since: holder.since } : null,
      paused: this.paused,
      shot: this.shot,
      log: this.log.slice(-60),
      sessions: [...this.sessions.values()]
        .filter((s) => s.apps.size)
        .map((s) => ({ agentId: s.ref.agentId, agentName: s.ref.agentName, workspaceId: s.ref.workspaceId, sessionId: s.ref.sessionId, grants: this.grantsOf(s) })),
      hotkey: COMPUTER_STOP_HOTKEYS[this.deps.settings().stopHotkey].label
    }
  }

  private emit(): void {
    const s = this.state()
    const who = s.holder ? `${s.holder.agentName}|${s.paused}` : ''
    if (who !== this.drivingKey) {
      this.drivingKey = who
      this.deps.onDriving?.(s.holder ? { agentName: s.holder.agentName, paused: s.paused } : null)
    }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CU_IPC.state, s)
  }

  private grantsOf(s: SessionState): ComputerGrant[] {
    const ov = this.deps.settings().tiers
    return [...s.apps.entries()].map(([key, v]) => ({ key, displayName: v.displayName, tier: tierOf(key, { overrides: ov }).tier, scope: v.scope }))
  }

  private session(ref: CuSession): SessionState {
    let s = this.sessions.get(ref.sessionId)
    if (!s) {
      s = { ref, apps: new Map(), flags: { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false }, display: null, shot: null, stopped: false, mouseHeld: false }
      // "Luôn cho agent này" từ lần trước.
      for (const key of this.deps.alwaysApps(ref.agentId)) s.apps.set(key, { displayName: displayNameFor(this.appsCache, key), scope: 'always' })
      this.sessions.set(ref.sessionId, s)
    }
    s.ref = ref
    return s
  }

  // ---- vòng đời ----

  /** Phiên agent đóng: bỏ quyền theo phiên, nhả khoá nếu nó đang giữ. */
  sessionEnded(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (s?.mouseHeld) this.safe(() => win.mouseButton('left', true))
    this.sessions.delete(sessionId)
    if (this.lock.current()?.sessionId === sessionId) this.released()
    this.emit()
  }

  /** Agent hết lượt (hook Stop): nhả khoá để agent khác / người dùng dùng máy, trả lại cửa sổ stag.ai. */
  turnEnded(agentId: string): void {
    const h = this.lock.current()
    if (h && h.agentId === agentId) this.released()
  }

  /** Người dùng bấm trên thanh nổi / ô Máy tính, hoặc phím dừng. */
  command(cmd: 'pause' | 'resume' | 'stop'): void {
    if (cmd === 'pause') this.paused = true
    else if (cmd === 'resume') {
      this.paused = false
      this.agentCursor = this.safe(() => win.cursorPos()) ?? null
    } else this.stop()
    this.syncOverlay()
    this.emit()
  }

  private stop(): void {
    this.stopGen++
    const h = this.lock.current()
    if (h) {
      const s = this.sessions.get(h.sessionId)
      if (s) {
        // Như Claude Desktop: dừng = thu hồi quyền theo phiên; agent phải xin lại (bạn duyệt lại).
        s.stopped = true
        for (const [k, v] of [...s.apps]) if (v.scope === 'session') s.apps.delete(k)
        if (s.mouseHeld) this.safe(() => win.mouseButton('left', true))
        s.mouseHeld = false
      }
      this.addLog(h.agentName, t('computer.log.stopped'), false)
    }
    this.releaseModifiers()
    this.paused = false
    this.released()
  }

  /** Khoá vừa nhả (dừng / hết lượt / phiên đóng / để lâu): ẩn viền, bỏ phím dừng, mở lại stag.ai nếu đã thu nhỏ. */
  private released(): void {
    this.lock.release()
    // Tạm dừng gắn với lượt điều khiển đó: agent lấy lại máy lần sau thì bắt đầu chạy (chuột mới được ghi lại).
    this.paused = false
    this.overlay.hide()
    this.unregisterHotkey()
    if (this.idleTimer) clearInterval(this.idleTimer)
    this.idleTimer = null
    this.agentCursor = null
    if (this.minimized) {
      this.minimized = false
      for (const w of this.deps.mainWindows()) if (!w.isDestroyed() && w.isMinimized()) w.restore()
    }
    this.emit()
  }

  private registerHotkey(): void {
    const accel = COMPUTER_STOP_HOTKEYS[this.deps.settings().stopHotkey].accel
    if (this.hotkey === accel) return
    this.unregisterHotkey()
    try {
      if (globalShortcut.register(accel, () => this.command('stop'))) this.hotkey = accel
    } catch {
      // Phím đã có app khác giữ: vẫn dừng được bằng nút trên thanh nổi / ô Máy tính.
    }
  }

  private unregisterHotkey(): void {
    if (this.hotkey) globalShortcut.unregister(this.hotkey)
    this.hotkey = null
  }

  private syncOverlay(): void {
    const h = this.lock.current()
    if (!h) return this.overlay.hide()
    const label = COMPUTER_STOP_HOTKEYS[this.deps.settings().stopHotkey].label
    this.overlay.show({
      agentName: h.agentName,
      action: this.lastAction,
      paused: this.paused,
      pausedText: t('computer.pill.paused', { name: h.agentName }),
      labels: { driving: t('computer.pill.driving'), pause: t('computer.pill.pause'), resume: t('computer.pill.resume'), stop: t('computer.pill.stop') },
      hotkey: label
    })
  }

  private addLog(agentName: string, text: string, ok: boolean): void {
    this.log.push({ at: Date.now(), agentName, text, ok })
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX)
  }

  private async fileLog(ref: CuSession, entry: Record<string, unknown>): Promise<void> {
    try {
      const dir = join(ref.workspacePath, '.stag', 'computer')
      await fs.mkdir(dir, { recursive: true })
      await fs.appendFile(join(dir, `${ref.sessionId}.jsonl`), JSON.stringify({ at: new Date().toISOString(), agent: ref.agentName, ...entry }) + '\n', 'utf8')
    } catch {
      // Nhật ký là phụ: lỗi ghi không chặn thao tác.
    }
  }

  private safe<T>(fn: () => T): T | undefined {
    try {
      return fn()
    } catch {
      return undefined
    }
  }

  private releaseModifiers(): void {
    this.safe(() => win.keyEvents(Object.values(MOD_VK).map((vk) => ({ vk, up: true }))))
  }

  // ---- app / cửa sổ ----

  private async apps(): Promise<AppEntry[]> {
    this.appsCache = await installedApps().catch(() => this.appsCache)
    return this.appsCache
  }

  private isSelf(w: { pid: number; exe: string }): boolean {
    return w.pid === process.pid || w.exe.toLowerCase() === process.execPath.toLowerCase()
  }

  private tier(w: { pid: number; exe: string }): ReturnType<typeof tierOf> {
    return tierOf(w.exe || 'unknown.exe', { self: this.isSelf(w), overrides: this.deps.settings().tiers })
  }

  private async iconFor(exe: string): Promise<string | undefined> {
    if (!exe) return undefined
    const hit = this.iconCache.get(exe)
    if (hit !== undefined) return hit || undefined
    try {
      const img = await app.getFileIcon(exe, { size: 'small' })
      const url = img.isEmpty() ? '' : img.toDataURL()
      this.iconCache.set(exe, url)
      return url || undefined
    } catch {
      this.iconCache.set(exe, '')
      return undefined
    }
  }

  /** Cửa sổ đang mở cho bảng @ (bỏ cửa sổ của stag.ai, cửa sổ công cụ, không tiêu đề, nền Windows). */
  async windows(): Promise<ComputerWindow[]> {
    if (!win.available().ok) return []
    const apps = await this.apps()
    const out: ComputerWindow[] = []
    for (const w of win.listWindows()) {
      if (this.isSelf(w) || w.clickThrough || w.tool || w.owned || w.shell || !w.title.trim() || !w.exe) continue
      // Cửa sổ thu nhỏ có khung giả rất nhỏ ở (-32000, -32000): vẫn liệt kê.
      if (!w.minimized && (w.rect.width < 40 || w.rect.height < 40)) continue
      const tr = this.tier(w)
      out.push({
        id: w.id,
        title: w.title,
        exe: w.exe,
        key: tr.reason === 'self' ? '' : w.exe.split(/[\\/]/).pop()!.toLowerCase(),
        displayName: displayNameFor(apps, w.exe),
        tier: tr.tier,
        reason: tr.reason,
        minimized: w.minimized,
        icon: await this.iconFor(w.exe)
      })
    }
    return out
  }

  /** Mức mặc định của một exe, không tính cài đặt (Cài đặt → Máy tính hiện "mặc định: …"). */
  tierFor(exe: string): { tier: ComputerWindow['tier']; reason: ComputerWindow['reason'] } {
    return defaultTier(exe)
  }

  /** Người dùng thu hồi một app (ô Máy tính) hoặc cả phiên. */
  revoke(sessionId: string, key?: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    if (key) {
      s.apps.delete(key)
      const always = this.deps.alwaysApps(s.ref.agentId)
      if (always.includes(key)) this.deps.saveAlwaysApps(s.ref.agentId, always.filter((k) => k !== key))
    } else {
      s.apps.clear()
    }
    this.emit()
  }

  /**
   * Người dùng chọn một cửa sổ trong bảng @ khi soạn tin cho agent: cấp app đó cho phiên đang chạy (mức theo bảng), trả
   * dòng ngữ cảnh + ảnh cửa sổ để đính kèm.
   */
  async attachWindow(ref: CuSession | null, enabled: boolean, windowId: string, withImage = true): Promise<ComputerAttach> {
    const w = win.available().ok ? win.listWindows().find((x) => x.id === windowId) : undefined
    if (!w) return { ok: false, error: t('computer.attach.gone') }
    const apps = await this.apps()
    const tr = this.tier(w)
    const name = displayNameFor(apps, w.exe)
    const key = w.exe.split(/[\\/]/).pop()!.toLowerCase()
    if (tr.tier === 'blocked') return { ok: false, error: t('computer.attach.blocked', { name }) }
    let granted = false
    if (ref && enabled) {
      const s = this.session(ref)
      if (!s.apps.has(key)) s.apps.set(key, { displayName: name, scope: 'session' })
      s.stopped = false
      granted = true
      this.emit()
    }
    // Chụp riêng cửa sổ đó (thấy được cả khi bị cửa sổ khác đè / đang thu nhỏ); không được thì cắt từ ảnh màn hình.
    let image = withImage ? await captureWindow(w.id, w.rect).catch(() => undefined) : undefined
    if (withImage && !image) try {
      const d = displayAt(physicalDisplays(), w.rect.x + w.rect.width / 2, w.rect.y + w.rect.height / 2)
      if (d && !w.minimized) {
        const full = await captureDisplay(d)
        const region = { x: Math.max(0, w.rect.x - d.bounds.x), y: Math.max(0, w.rect.y - d.bounds.y), width: Math.min(w.rect.width, d.bounds.width), height: Math.min(w.rect.height, d.bounds.height) }
        image = render(full, d, { region, windows: this.maskWindows(ref ? this.sessions.get(ref.sessionId) : undefined, d, [key]) }).jpeg.toString('base64')
      }
    } catch {
      // Không chụp được (cửa sổ ở màn hình khác vừa rút ra…): vẫn gửi dòng ngữ cảnh.
    }
    const where = `at (${w.rect.x}, ${w.rect.y}), ${w.rect.width}x${w.rect.height} px${w.minimized ? ', minimized' : ''}`
    // Phiên không chạy: không nói gì về quyền (lần mở phiên sau agent tự xin). Tắt cho agent: chỉ xem ảnh.
    const access = granted
      ? `The user granted computer use for "${name}" (tier "${tr.tier}") in this session by picking it, so you do not need request_access for it.`
      : ref && !enabled
        ? 'Computer use is turned off for you, so you can only look at the attached screenshot.'
        : ''
    const context = `[stag.ai] The user pointed at a Windows window: "${w.title}" — app "${name}" (${key})${where ? `, ${where}` : ''}.${access ? ` ${access}` : ''}${image ? ' A screenshot of that window is attached.' : granted ? ' Take a screenshot to see it.' : ''}`
    return { ok: true, context, image, disabled: !enabled }
  }

  // ---- request_access ----

  /** Chuẩn bị thẻ hỏi: đổi tên app agent đưa thành app trên máy + mức của từng app. */
  async prepareAsk(names: string[], reason: string, flags: Partial<ComputerAsk>): Promise<ComputerAsk> {
    const apps = await this.apps()
    const running = win.available().ok ? win.listWindows().filter((w) => !this.isSelf(w)) : []
    const out: ComputerAppAsk[] = []
    const unknown: string[] = []
    for (const n of names) {
      const a = resolveApp(n, apps, running)
      if (!a) {
        unknown.push(n)
        continue
      }
      if (out.some((x) => x.key === a.key)) continue
      const tr = tierOf(a.key, { overrides: this.deps.settings().tiers })
      out.push({ key: a.key, displayName: a.displayName, exe: a.exe, tier: tr.tier, reason: tr.reason, icon: a.exe ? await this.iconFor(a.exe) : undefined })
    }
    return {
      reason,
      apps: out,
      unknown,
      clipboardRead: !!flags.clipboardRead,
      clipboardWrite: !!flags.clipboardWrite,
      systemKeyCombos: !!flags.systemKeyCombos
    }
  }

  /** Ghi kết quả thẻ hỏi; trả lời cho agent (JSON như Claude Desktop). */
  async applyAsk(ref: CuSession, ask: ComputerAsk, answer: 'allow' | 'always' | 'deny' | 'timeout'): Promise<CuResult> {
    const s = this.session(ref)
    const apps = await this.apps()
    const granted: Array<{ app: string; displayName: string; tier: string }> = []
    const denied: Array<{ app: string; reason: string; suggestions?: string[] }> = ask.unknown.map((n) => ({ app: n, reason: 'not_installed', suggestions: suggestApps(n, apps) }))
    for (const a of ask.apps) {
      if (a.tier === 'blocked') {
        denied.push({ app: a.displayName, reason: `blocked (${a.reason})` })
        continue
      }
      if (answer === 'allow' || answer === 'always') {
        s.apps.set(a.key, { displayName: a.displayName, scope: answer === 'always' ? 'always' : 'session' })
        granted.push({ app: a.key, displayName: a.displayName, tier: a.tier })
      } else denied.push({ app: a.displayName, reason: answer === 'timeout' ? 'user_did_not_answer' : 'user_denied' })
    }
    if (answer === 'allow' || answer === 'always') {
      if (ask.clipboardRead) s.flags.clipboardRead = true
      if (ask.clipboardWrite) s.flags.clipboardWrite = true
      if (ask.systemKeyCombos) s.flags.systemKeyCombos = true
      s.stopped = false
    }
    if (answer === 'always') {
      const keys = new Set([...this.deps.alwaysApps(ref.agentId), ...granted.map((g) => g.app)])
      this.deps.saveAlwaysApps(ref.agentId, [...keys])
    }
    this.addLog(ref.agentName, t('computer.log.access', { apps: ask.apps.map((a) => a.displayName).join(', ') || '—', answer: t(`computer.answer.${answer}`) }), answer === 'allow' || answer === 'always')
    void this.fileLog(ref, { action: 'request_access', apps: ask.apps.map((a) => a.key), answer })
    this.emit()
    const body = {
      granted,
      denied,
      flags: s.flags,
      screenshotFiltering: 'mask',
      hostPlatform: 'win32',
      note:
        granted.length > 0
          ? 'Granted apps stay granted for this session. Windows of apps you were not granted are masked with a solid rectangle in screenshots. Elevated (administrator) windows cannot be controlled.'
          : 'Nothing was granted. Do not retry the same request; ask the user what to do.'
    }
    return { content: [{ type: 'text', text: JSON.stringify(body, null, 1) }], ...(granted.length ? {} : { isError: answer !== 'allow' && answer !== 'always' }) }
  }

  listGranted(ref: CuSession): CuResult {
    const s = this.session(ref)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { granted: this.grantsOf(s).map((g) => ({ app: g.key, displayName: g.displayName, tier: g.tier, remembered: g.scope === 'always' })), flags: s.flags, coordinateMode: 'pixels', display: s.display ?? 'auto' },
            null,
            1
          )
        }
      ]
    }
  }

  // ---- chạy thao tác ----

  /** Chạy một tool (đã qua zod). Mọi thao tác chạy lần lượt trên một hàng đợi chung. */
  run(ref: CuSession, tool: string, input: Record<string, unknown>): Promise<CuResult> {
    const job = this.queue.then(() => this.runNow(ref, tool, input))
    this.queue = job.catch(() => undefined)
    return job
  }

  private async runNow(ref: CuSession, tool: string, input: Record<string, unknown>): Promise<CuResult> {
    try {
      if (!this.deps.enabledFor(ref.workspaceId, ref.agentId))
        throw new CuError(`Computer use is turned off for you in stag.ai (${t('common.name.settings')} → ${t('settings.nav.computer')}). Tell the user; they can turn it on there.`)
      const avail = win.available()
      if (!avail.ok) throw new CuError(avail.error ?? 'Computer use is not available on this machine.')
      const s = this.session(ref)
      if (s.stopped) throw new CuError('STOPPED_BY_USER: the user stopped computer use. Stop what you were doing on the screen and ask the user how to continue. Call request_access again only if the user asks you to continue.')
      if (!s.apps.size) throw new CuError('No applications are granted yet. Call request_access with the apps you need first.')
      const lockRes = this.lock.acquire({ agentId: ref.agentId, agentName: ref.agentName, sessionId: ref.sessionId, workspaceId: ref.workspaceId })
      if (!lockRes.ok)
        throw new CuError(`COMPUTER_BUSY: ${lockRes.holder.agentName} is using the computer right now. Wait (e.g. 30 s with your own tools, not this server) and try again, or tell the user.`)
      if (lockRes.fresh) this.startDriving()
      if (this.paused)
        throw new CuError(
          'PAUSED_BY_USER: the user paused computer use or is using the mouse. Do not retry right away: call wait (10–30 s) a few times, then try again; if it is still paused, ask the user to press Resume on the stag.ai bar at the top of the screen.'
        )
      const startShot = s.shot
      const out = tool === 'computer_batch' ? await this.batch(s, input) : await this.one(s, tool, input, startShot, false)
      return out
    } catch (e) {
      const msg = e instanceof CuError ? e.message : `Error: ${(e as Error)?.message ?? String(e)}`
      this.addLog(ref.agentName, `${tool}: ${msg.split('\n')[0].slice(0, 160)}`, false)
      void this.fileLog(ref, { action: tool, error: msg.slice(0, 500) })
      this.emit()
      return { content: [{ type: 'text', text: msg }], isError: true }
    }
  }

  private startDriving(): void {
    this.registerHotkey()
    this.agentCursor = this.safe(() => win.cursorPos()) ?? null
    if (this.deps.settings().minimizeApp) {
      for (const w of this.deps.mainWindows())
        if (!w.isDestroyed() && !w.isMinimized()) {
          w.minimize()
          this.minimized = true
        }
    }
    this.syncOverlay()
    if (!this.idleTimer)
      this.idleTimer = setInterval(() => {
        if (!this.lock.current()) this.released()
      }, 5_000)
    this.emit()
  }

  /** Người dùng di chuột khỏi chỗ agent để lại → tạm dừng (Cài đặt → Máy tính). */
  private checkUser(): void {
    if (!this.deps.settings().pauseOnUser || !this.agentCursor) return
    const p = this.safe(() => win.cursorPos())
    if (!p) return
    if (Math.abs(p.x - this.agentCursor.x) > 3 || Math.abs(p.y - this.agentCursor.y) > 3) {
      this.paused = true
      const h = this.lock.current()
      if (h) this.addLog(h.agentName, t('computer.log.userMoved'), false)
      this.syncOverlay()
      this.emit()
      throw new CuError('PAUSED_BY_USER: the user moved the mouse, so computer use is paused. Do not retry right away: call wait (10–30 s), then try again; the user resumes from the stag.ai bar at the top of the screen.')
    }
  }

  private noteCursor(): void {
    this.agentCursor = this.safe(() => win.cursorPos()) ?? this.agentCursor
  }

  private async batch(s: SessionState, input: Record<string, unknown>): Promise<CuResult> {
    const actions = Array.isArray(input.actions) ? (input.actions as Array<Record<string, unknown>>) : []
    if (!actions.length) throw new CuError('actions must be a non-empty list.')
    if (actions.length > 50) throw new CuError('At most 50 actions per batch.')
    // Toạ độ trong cả batch tính theo ảnh chụp TRƯỚC lần gọi này.
    const frameRef = s.shot
    const content: CuContent[] = []
    let acted = false
    let lastWasImage = false
    for (const [i, a] of actions.entries()) {
      const name = String(a.action ?? '')
      const prefix = `[${i + 1}/${actions.length}] ${name}: `
      try {
        const r = await this.one(s, name, a, frameRef, true)
        const texts = r.content.filter((c): c is CuText => c.type === 'text').map((c) => c.text)
        content.push({ type: 'text', text: prefix + (texts.join(' ') || 'ok') })
        content.push(...r.content.filter((c): c is CuImage => c.type === 'image'))
        lastWasImage = name === 'screenshot' || name === 'zoom'
        if (!lastWasImage && name !== 'wait' && name !== 'cursor_position') acted = true
      } catch (e) {
        const msg = e instanceof CuError ? e.message : `Error: ${(e as Error)?.message ?? String(e)}`
        content.push({ type: 'text', text: `${prefix}${msg}\nThe batch stopped here; the remaining ${actions.length - i - 1} action(s) did not run.` })
        if (acted) content.push(...(await this.afterShot(s)))
        return { content, isError: true }
      }
    }
    if (acted && !lastWasImage) content.push(...(await this.afterShot(s)))
    return { content }
  }

  /** Ảnh sau thao tác (Cài đặt → "trả ảnh sau mỗi thao tác"). */
  private async afterShot(s: SessionState): Promise<CuContent[]> {
    if (!this.deps.settings().screenshotAfter) return []
    await sleep(SETTLE_MS)
    try {
      const r = await this.screenshot(s, {})
      return [{ type: 'text', text: 'Screenshot after the action:' }, ...r.content]
    } catch {
      return []
    }
  }

  /** Một thao tác. `frameRef` = khung toạ độ dùng cho toạ độ agent đưa (ảnh trước lần gọi). */
  private async one(s: SessionState, tool: string, a: Record<string, unknown>, frameRef: SessionState['shot'], inBatch: boolean): Promise<CuResult> {
    const ref = s.ref
    const done = async (text: string, kind: 'input' | 'look', mark?: { x: number; y: number }): Promise<CuResult> => {
      this.lastAction = text
      this.addLog(ref.agentName, text, true)
      void this.fileLog(ref, { action: tool, text })
      if (mark && this.shot) this.shot = { ...this.shot, mark }
      if (kind === 'input') this.noteCursor()
      this.syncOverlay()
      this.emit()
      const content: CuContent[] = [{ type: 'text', text: kind === 'input' ? `${text}.` : text }]
      if (kind === 'input' && !inBatch) content.push(...(await this.afterShot(s)))
      return { content }
    }
    const point = (key = 'coordinate'): { x: number; y: number; frameX: number; frameY: number } => {
      if (!frameRef) throw new CuError('Take a screenshot first: coordinates are read from the most recent screenshot.')
      const err = checkFramePoint(frameRef.frame, a[key])
      if (err) throw new CuError(err)
      const [fx, fy] = a[key] as number[]
      return { ...frameToPhysical(frameRef.display.bounds, frameRef.frame, fx, fy), frameX: fx / frameRef.frame.width, frameY: fy / frameRef.frame.height }
    }
    const mods = (): Chord | null => {
      const m = typeof a.text === 'string' && a.text.trim() ? parseChord(a.text) : null
      if (m && m.key !== null) throw new CuError(`"${a.text}" is not a modifier. For clicks, text holds modifier keys only (e.g. "shift", "ctrl+shift").`)
      return m
    }

    switch (tool) {
      case 'screenshot':
        return this.screenshot(s, a)
      case 'zoom':
        return this.zoom(s, a, frameRef)
      case 'cursor_position': {
        const p = win.cursorPos()
        const d = frameRef ?? s.shot
        const f = d ? physicalToFrame(d.display.bounds, d.frame, p.x, p.y) : null
        return { content: [{ type: 'text', text: f ? JSON.stringify({ x: f.x, y: f.y }) : JSON.stringify({ x: null, y: null, note: 'The cursor is not on the monitor of the most recent screenshot.' }) }] }
      }
      case 'wait': {
        const sec = Math.min(100, Math.max(0, Number(a.duration) || 0))
        await this.waitStoppable(sec * 1000)
        return { content: [{ type: 'text', text: `Waited ${sec}s.` }] }
      }
      case 'mouse_move': {
        this.checkUser()
        const p = point()
        this.gateAt(s, p, { kind: 'look' }, tool)
        win.moveMouse(p.x, p.y)
        return done('Moved', 'input', { x: p.frameX, y: p.frameY })
      }
      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
      case 'triple_click': {
        this.checkUser()
        const p = point()
        const m = mods()
        const button = tool === 'right_click' ? 'right' : tool === 'middle_click' ? 'middle' : 'left'
        const count = tool === 'double_click' ? 2 : tool === 'triple_click' ? 3 : 1
        const target = this.gateAt(s, p, { kind: 'click', button, count, modifiers: !!m?.modifiers.length }, tool)
        win.moveMouse(p.x, p.y)
        await sleep(30)
        const modVks = (m?.modifiers ?? []).map((x) => MOD_VK[x])
        win.keyEvents(modVks.map((vk) => ({ vk, up: false })))
        try {
          for (let i = 0; i < count; i++) {
            win.mouseButton(button, false)
            win.mouseButton(button, true)
            if (i < count - 1) await sleep(40)
          }
        } finally {
          win.keyEvents(modVks.reverse().map((vk) => ({ vk, up: true })))
        }
        return done(`${tool} (${(a.coordinate as number[]).join(', ')}) in ${target}`, 'input', { x: p.frameX, y: p.frameY })
      }
      case 'scroll': {
        this.checkUser()
        const p = point()
        const m = mods()
        const dir = String(a.scroll_direction ?? '')
        if (!['up', 'down', 'left', 'right'].includes(dir)) throw new CuError('scroll_direction must be up, down, left or right.')
        const amount = Math.min(100, Math.max(0, Math.round(Number(a.scroll_amount) || 0)))
        const target = this.gateAt(s, p, { kind: 'scroll', modifiers: !!m?.modifiers.length }, tool)
        win.moveMouse(p.x, p.y)
        const modVks = (m?.modifiers ?? []).map((x) => MOD_VK[x])
        win.keyEvents(modVks.map((vk) => ({ vk, up: false })))
        try {
          for (let i = 0; i < amount; i++) {
            win.wheel(dir === 'up' || dir === 'right' ? 1 : -1, dir === 'left' || dir === 'right')
            await sleep(15)
          }
        } finally {
          win.keyEvents(modVks.reverse().map((vk) => ({ vk, up: true })))
        }
        return done(`Scrolled ${dir} ${amount} in ${target}`, 'input', { x: p.frameX, y: p.frameY })
      }
      case 'left_click_drag': {
        this.checkUser()
        const end = point('coordinate')
        const start = a.start_coordinate !== undefined ? point('start_coordinate') : null
        const from = start ?? { ...win.cursorPos(), frameX: 0, frameY: 0 }
        this.gateAt(s, from, { kind: 'drag' }, tool)
        const target = this.gateAt(s, end, { kind: 'drag' }, tool)
        win.moveMouse(from.x, from.y)
        await sleep(40)
        win.mouseButton('left', false)
        try {
          const steps = 12
          for (let i = 1; i <= steps; i++) {
            win.moveMouse(from.x + ((end.x - from.x) * i) / steps, from.y + ((end.y - from.y) * i) / steps)
            await sleep(16)
          }
        } finally {
          win.mouseButton('left', true)
        }
        return done(`Dragged to (${(a.coordinate as number[]).join(', ')}) in ${target}`, 'input', { x: end.frameX, y: end.frameY })
      }
      case 'left_mouse_down': {
        this.checkUser()
        if (s.mouseHeld) throw new CuError('The left button is already held. Call left_mouse_up first.')
        const p = win.cursorPos()
        this.gateAt(s, p, { kind: 'drag' }, tool)
        win.mouseButton('left', false)
        s.mouseHeld = true
        return done('Left button pressed', 'input')
      }
      case 'left_mouse_up': {
        const p = win.cursorPos()
        if (s.mouseHeld) this.gateAt(s, p, { kind: 'drag' }, tool)
        win.mouseButton('left', true)
        s.mouseHeld = false
        return done('Left button released', 'input')
      }
      case 'type': {
        this.checkUser()
        const text = typeof a.text === 'string' ? a.text : ''
        if (!text) throw new CuError('text is empty.')
        if (text.length > 20_000) throw new CuError('text is too long (max 20000 characters); type it in parts.')
        const target = this.gateFocus(s, { kind: 'type' }, tool)
        const units = typeUnits(text)
        const gen = this.stopGen
        for (let i = 0; i < units.length; i += TYPE_CHUNK) {
          if (gen !== this.stopGen) throw new CuError('STOPPED_BY_USER: the user stopped computer use while you were typing.')
          const chunk = units.slice(i, i + TYPE_CHUNK)
          let run: number[] = []
          const flush = (): void => {
            if (run.length) win.typeUnicode(run)
            run = []
          }
          for (const u of chunk) {
            if ('unit' in u) run.push(u.unit)
            else {
              flush()
              win.keyEvents([
                { vk: u.vk, up: false },
                { vk: u.vk, up: true }
              ])
            }
          }
          flush()
          await sleep(8)
        }
        return done(`Typed ${text.length} character(s) in ${target}`, 'input')
      }
      case 'key':
      case 'hold_key': {
        this.checkUser()
        const text = typeof a.text === 'string' ? a.text : ''
        const chord = parseChord(text)
        const stop = chordFromAccelerator(COMPUTER_STOP_HOTKEYS[this.deps.settings().stopHotkey].accel)
        if (chordId(chord) === chordId(stop)) throw new CuError(`"${text}" is the user's stop shortcut for computer use; you cannot send it.`)
        if (isSystemCombo(chord) && !s.flags.systemKeyCombos)
          throw new CuError(`"${text}" is a system-level key combo (quit / switch app, Start menu, lock screen). Call request_access with systemKeyCombos: true to ask the user for it first.`)
        const target = this.gateFocus(s, { kind: 'key' }, tool)
        const vks = [...chord.modifiers.map((m) => MOD_VK[m]), ...(chord.key !== null ? [chord.key] : [])]
        if (tool === 'key') {
          const repeat = Math.min(100, Math.max(1, Math.round(Number(a.repeat) || 1)))
          for (let i = 0; i < repeat; i++) {
            win.keyEvents([...vks.map((vk) => ({ vk, up: false })), ...[...vks].reverse().map((vk) => ({ vk, up: true }))])
            if (repeat > 1) await sleep(20)
          }
          return done(`Pressed ${text}${repeat > 1 ? ` ×${repeat}` : ''} in ${target}`, 'input')
        }
        const sec = Math.min(100, Math.max(0, Number(a.duration) || 0))
        win.keyEvents(vks.map((vk) => ({ vk, up: false })))
        try {
          await this.waitStoppable(sec * 1000)
        } finally {
          win.keyEvents([...vks].reverse().map((vk) => ({ vk, up: true })))
        }
        return done(`Held ${text} for ${sec}s in ${target}`, 'input')
      }
      case 'read_clipboard': {
        if (!s.flags.clipboardRead) throw new CuError('Reading the clipboard needs the clipboardRead grant: call request_access with clipboardRead: true.')
        return { content: [{ type: 'text', text: await clipboard.readText() }] }
      }
      case 'write_clipboard': {
        if (!s.flags.clipboardWrite) throw new CuError('Writing the clipboard needs the clipboardWrite grant: call request_access with clipboardWrite: true.')
        await clipboard.writeText(typeof a.text === 'string' ? a.text : '')
        return { content: [{ type: 'text', text: 'Clipboard written.' }] }
      }
      case 'open_application':
        return this.openApp(s, String(a.app ?? ''))
      case 'switch_display': {
        const want = String(a.display ?? '').trim()
        if (!want || want.toLowerCase() === 'auto') {
          s.display = null
          return { content: [{ type: 'text', text: 'Monitor selection is automatic again. Take a screenshot.' }] }
        }
        const ds = physicalDisplays()
        const d = ds.find((x) => x.label.toLowerCase() === want.toLowerCase()) ?? ds.find((x) => x.label.toLowerCase().includes(want.toLowerCase()))
        if (!d) throw new CuError(`No monitor named "${want}". Monitors: ${ds.map((x) => `"${x.label}"`).join(', ')}.`)
        s.display = d.id
        return { content: [{ type: 'text', text: `Switched to "${d.label}". Take a screenshot to see it.` }] }
      }
      default:
        throw new CuError(`Unknown action "${tool}".`)
    }
  }

  /** Chờ, dừng sớm nếu người dùng bấm Dừng. */
  private async waitStoppable(ms: number): Promise<void> {
    const gen = this.stopGen
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (gen !== this.stopGen) throw new CuError('STOPPED_BY_USER: the user stopped computer use.')
      await sleep(Math.min(200, end - Date.now()))
    }
  }

  /** Kiểm tra cửa sổ dưới điểm: app phải được cấp và mức cho phép thao tác. Trả tên app. */
  private gateAt(s: SessionState, p: { x: number; y: number }, kind: ActionKind, tool: string): string {
    const w = win.windowAt(p.x, p.y)
    return this.gate(s, w, kind, tool, 'under that point')
  }

  /** Kiểm tra cửa sổ đang nhận bàn phím. */
  private gateFocus(s: SessionState, kind: ActionKind, tool: string): string {
    const w = win.foregroundWindow()
    return this.gate(s, w, kind, tool, 'that has keyboard focus')
  }

  private gate(s: SessionState, w: win.WinInfo | null, kind: ActionKind, tool: string, where: string): string {
    if (!w) throw new CuError(`${tool} refused: there is no window ${where}.`)
    const name = displayNameFor(this.appsCache, w.exe)
    const tr = this.tier(w)
    if (tr.tier === 'blocked') throw new CuError(tierError(tr.reason === 'self' ? 'stag.ai' : name, 'blocked', tr.reason, tool))
    // Desktop / thanh tác vụ thuộc explorer.exe: cần quyền "File Explorer" như mọi app.
    const key = (w.exe.split(/[\\/]/).pop() ?? '').toLowerCase()
    if (!s.apps.has(key))
      throw new CuError(
        `${tool} refused: the window ${where} belongs to "${name}" (${key || 'unknown'}), which is not granted in this session${w.shell ? ' (the desktop and taskbar belong to File Explorer)' : ''}. Call request_access with "${w.shell ? 'File Explorer' : name}" first, or use open_application to bring a granted app to the front.`
      )
    const no = tierAllows(tr.tier, kind)
    if (no) throw new CuError(tierError(name, tr.tier, tr.reason, tool))
    return name
  }

  private chooseDisplay(s: SessionState): PhysicalDisplay {
    const ds = physicalDisplays()
    if (s.display) {
      const d = ds.find((x) => x.id === s.display)
      if (d) return d
      s.display = null
    }
    // Tự chọn: màn hình có cửa sổ trên cùng của một app đã cấp; không có thì màn hình chính.
    for (const w of win.listWindows()) {
      if (w.minimized || this.isSelf(w)) continue
      const key = (w.exe.split(/[\\/]/).pop() ?? '').toLowerCase()
      if (!s.apps.has(key)) continue
      const d = displayAt(ds, w.rect.x + w.rect.width / 2, w.rect.y + w.rect.height / 2)
      if (d) return d
    }
    return ds.find((d) => d.primary) ?? ds[0]
  }

  /** Cửa sổ để che trong ảnh (từ dưới lên trên): app chưa cấp + stag.ai bị che, desktop / thanh tác vụ để lộ. */
  private maskWindows(s: SessionState | undefined, d: PhysicalDisplay, extraKeys: string[] = []): MaskWindow[] {
    const out: MaskWindow[] = []
    for (const w of win.listWindows().reverse()) {
      if (w.minimized || w.rect.width <= 0 || w.rect.height <= 0) continue
      // Lớp phủ click xuyên qua (viền của stag.ai, lớp phủ của app khác) và thanh nổi của stag.ai (không lọt vào ảnh):
      // che chúng thì che luôn cả màn hình bên dưới.
      if (w.clickThrough || (this.isSelf(w) && w.tool)) continue
      if (w.rect.x >= d.bounds.x + d.bounds.width || w.rect.y >= d.bounds.y + d.bounds.height || w.rect.x + w.rect.width <= d.bounds.x || w.rect.y + w.rect.height <= d.bounds.y) continue
      const key = (w.exe.split(/[\\/]/).pop() ?? '').toLowerCase()
      const ok = !this.isSelf(w) && (w.shell || !!s?.apps.has(key) || extraKeys.includes(key))
      out.push({ rect: w.rect, masked: !ok })
    }
    return out
  }

  private maskedNames(s: SessionState, d: PhysicalDisplay): string[] {
    const names = new Set<string>()
    for (const w of win.listWindows()) {
      if (w.minimized || w.shell || w.clickThrough || this.isSelf(w) || !w.title.trim()) continue
      if (w.rect.x >= d.bounds.x + d.bounds.width || w.rect.y >= d.bounds.y + d.bounds.height || w.rect.x + w.rect.width <= d.bounds.x || w.rect.y + w.rect.height <= d.bounds.y) continue
      const key = (w.exe.split(/[\\/]/).pop() ?? '').toLowerCase()
      if (!s.apps.has(key)) names.add(displayNameFor(this.appsCache, w.exe))
    }
    return [...names].slice(0, 10)
  }

  private async screenshot(s: SessionState, a: Record<string, unknown>): Promise<CuResult> {
    await this.apps()
    const d = this.chooseDisplay(s)
    const full = await captureDisplay(d)
    const frame = frameSize(d.bounds.width, d.bounds.height)
    const scale = typeof a.scale === 'number' ? a.scale : undefined
    const r = render(full, d, { windows: this.maskWindows(s, d), scale })
    s.shot = { display: d, frame: { width: frame.width, height: frame.height } }
    // Ảnh nhỏ cho ô Máy tính.
    const thumb = nativeImage.createFromBuffer(r.jpeg).resize({ width: Math.min(960, r.width) })
    this.shot = { url: `data:image/jpeg;base64,${thumb.toJPEG(70).toString('base64')}`, at: Date.now(), display: d.label }
    this.emit()
    const others = physicalDisplays().filter((x) => x.id !== d.id)
    const masked = this.maskedNames(s, d)
    const lines = [
      `This screenshot was taken on monitor "${d.label}"${others.length ? `. Other attached monitors: ${others.map((x) => `"${x.label}"`).join(', ')}. Use switch_display to capture a different monitor` : ''}.`,
      masked.length ? `${masked.map((n) => `"${n}"`).join(', ')} ${masked.length === 1 ? 'is' : 'are'} open but masked with a solid rectangle (not in the session allowlist). Call request_access to add them if you need them.` : '',
      scale && scale < 1 ? `${scale}-scale view; coordinate frame: ${frame.width}x${frame.height}.` : `Coordinate frame: ${frame.width}x${frame.height}.`
    ].filter(Boolean)
    return { content: [{ type: 'text', text: lines.join('\n') }, { type: 'image', data: r.jpeg.toString('base64'), mimeType: 'image/jpeg' }] }
  }

  private async zoom(s: SessionState, a: Record<string, unknown>, frameRef: SessionState['shot']): Promise<CuResult> {
    const ref = frameRef ?? s.shot
    if (!ref) throw new CuError('Take a screenshot first: zoom regions refer to the most recent full-screen screenshot.')
    const region = zoomRegion(ref.display.bounds, ref.frame, a.region)
    if (typeof region === 'string') throw new CuError(region)
    const full = await captureDisplay(ref.display)
    const scale = typeof a.scale === 'number' ? a.scale : undefined
    // Zoom ở độ phân giải gốc (không phóng to quá pixel thật), trong ngân sách ảnh.
    const r = render(full, ref.display, { region, windows: this.maskWindows(s, ref.display), scale })
    return { content: [{ type: 'image', data: r.jpeg.toString('base64'), mimeType: 'image/jpeg' }] }
  }

  private async openApp(s: SessionState, name: string): Promise<CuResult> {
    const apps = await this.apps()
    const running = win.listWindows().filter((w) => !this.isSelf(w))
    const a = resolveApp(name, apps, running)
    if (!a) throw new CuError(`No application named "${name}" was found. Try the name as it appears in the Start menu${suggestApps(name, apps).length ? ` (e.g. ${suggestApps(name, apps).map((x) => `"${x}"`).join(', ')})` : ''}.`)
    if (!s.apps.has(a.key)) throw new CuError(`"${a.displayName}" is not granted in this session. Call request_access with it first.`)
    if (tierOf(a.key, { overrides: this.deps.settings().tiers }).tier === 'blocked') throw new CuError(`"${a.displayName}" is blocked for computer use.`)
    const find = (): win.WinInfo | undefined =>
      win.listWindows().find((w) => !w.tool && !w.owned && w.title.trim() && (w.exe.split(/[\\/]/).pop() ?? '').toLowerCase() === a.key)
    let w = find()
    if (!w) {
      const target = a.lnk ?? a.exe
      if (!target) throw new CuError(`Do not know how to start "${a.displayName}". Ask the user to open it.`)
      const { shell } = await import('electron')
      if (/^[a-z-]+:$/i.test(target)) await shell.openExternal(target)
      else {
        const err = await shell.openPath(target)
        if (err) throw new CuError(`Could not start "${a.displayName}": ${err}`)
      }
      for (let i = 0; i < 40 && !w; i++) {
        await sleep(250)
        w = find()
      }
      if (!w) return this.finishOpen(s, `Started "${a.displayName}", but no window appeared yet. Wait a moment, then take a screenshot.`)
    }
    win.focusWindow(w.id)
    await sleep(200)
    return this.finishOpen(s, `"${a.displayName}" is in front ("${w.title}").`)
  }

  private async finishOpen(s: SessionState, text: string): Promise<CuResult> {
    this.lastAction = text
    this.addLog(s.ref.agentName, text, true)
    void this.fileLog(s.ref, { action: 'open_application', text })
    this.noteCursor()
    this.syncOverlay()
    this.emit()
    return { content: [{ type: 'text', text }, ...(await this.afterShot(s))] }
  }

  /**
   * Thẻ hỏi cần bạn thấy: hiện lại cửa sổ stag.ai (có thể đang bị thu nhỏ vì agent điều khiển), trả lời xong thì thu
   * nhỏ lại nếu agent vẫn đang cầm máy.
   */
  async withAttention<T>(fn: () => Promise<T>): Promise<T> {
    const wins = this.deps.mainWindows().filter((w) => !w.isDestroyed())
    for (const w of wins) {
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
    try {
      return await fn()
    } finally {
      if (this.lock.current() && this.deps.settings().minimizeApp) {
        for (const w of wins)
          if (!w.isDestroyed() && !w.isMinimized()) {
            w.minimize()
            this.minimized = true
          }
      }
    }
  }

  dispose(): void {
    this.overlay.hide()
    this.unregisterHotkey()
    if (this.idleTimer) clearInterval(this.idleTimer)
  }
}
