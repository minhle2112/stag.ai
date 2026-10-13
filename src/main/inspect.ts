import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  applyReply,
  close,
  enqueue,
  markDelivered,
  markRead,
  normalizePin,
  packetDisplay,
  packetMessage,
  pageKey,
  PAGE_IPC,
  promoteNext,
  reopen,
  toPagePin,
  withAgent,
  type AnchorUpdate,
  type CaptureResult,
  type InspectAction,
  type InspectActionResult,
  type InspectAgent,
  type InspectPin,
  type InspectSnapshot,
  type InspectSource,
  type InspectTarget,
  type PageCmd,
  type PageState,
  type PinPlace,
  type Rect,
  type ReplyInput,
  type SaveInput
} from '@shared/inspect'
import type { Agent, Workspace } from '@shared/types'
import { STATIC_ROOTS, staticCandidates, staticTags, type StaticTag } from '@shared/inspectSource'
import type { BrowserService, PageTab } from './browser'
import { readText } from './fsutil'
import { ensureIgnored } from './workspace'

/** Ảnh chụp lúc gửi mà chưa lưu thành bình luận: bỏ sau chừng này. */
const CAPTURE_TTL = 30 * 60_000
const MAX_TEXT = 4000
/** Chờ trang trả lời một lệnh (resnap). */
const REQ_TIMEOUT = 4000

interface IndexFile {
  version: 1
  next: number
  pins: InspectPin[]
  /** Agent nhận bình luận gần nhất (hộp bình luận chọn sẵn). */
  lastAgent?: string
}

export interface InspectEvents {
  /** Bình luận của workspace đổi (renderer tải lại). */
  changed(workspaceId: string): void
  /** Có bình luận mới trong hàng chờ của agent: gửi ngay nếu agent rảnh. */
  queued(agentId: string): void
  /** Người dùng bấm ghim trên trang: mở ngăn Bình luận, sáng mạch. */
  focus(workspaceId: string, tabId: string, id: number): void
}

export interface InspectTeamMember {
  id: string
  name: string
  running: boolean
  busy: boolean
}

/** Bình luận đang chờ gõ vào phiên một agent (gom theo workspace). */
export interface InspectDelivery {
  ws: Workspace
  pins: InspectPin[]
  text: string
  display: string
}

const now = (): string => new Date().toISOString()

/**
 * Chế độ Soi: bình luận người dùng ghim lên phần tử của trang trong ô Browser, theo workspace, lưu ở
 * `<dự án>/.stag/inspect/index.json` (ảnh ở `.stag/inspect/img/`). Nói chuyện với lớp Soi trong trang (preload
 * `inspect`, thế giới cô lập) qua PAGE_IPC; với renderer qua `act` / `snapshot`; agent trả lời qua tool inspect_reply.
 * Mỗi agent một hàng chờ: gói tin gõ vào phiên khi agent rảnh (AgentService), agent làm lần lượt từng mục.
 */
export class InspectService {
  private data = new Map<string, Promise<IndexFile>>()
  private chain = new Map<string, Promise<unknown>>()
  private known = new Map<string, Workspace>()
  private ignored = new Set<string>()
  private captures = new Map<string, { wsId: string; png: Buffer; at: number }>()
  /** Theo tab: ghim nào trang tìm thấy. */
  private places = new Map<string, Record<number, PinPlace>>()
  /** Theo tab: trang đang mở (URL không #) đã chào main (lớp Soi sẵn sàng). */
  private pageUrl = new Map<string, string>()
  private reqs = new Map<string, (v: unknown) => void>()
  private notifyTimers = new Map<string, NodeJS.Timeout>()
  private team: (wsId: string) => InspectTeamMember[] = () => []

  constructor(
    private browser: BrowserService,
    private workspace: (id: string) => Workspace | undefined,
    private events: InspectEvents
  ) {
    browser.attachInspect({ toggle: (wsId, tabId) => void this.toggle(wsId, tabId) })
  }

  /** Danh sách agent của workspace (AgentService, gắn sau). */
  attachTeam(team: (wsId: string) => InspectTeamMember[]): void {
    this.team = team
  }

  // ---------- lưu trữ ----------

  private dir(ws: Workspace): string {
    return join(ws.path, '.stag', 'inspect')
  }

  private load(ws: Workspace): Promise<IndexFile> {
    this.known.set(ws.id, ws)
    let d = this.data.get(ws.id)
    if (!d) {
      d = this.read(ws)
      this.data.set(ws.id, d)
    }
    return d
  }

  private async read(ws: Workspace): Promise<IndexFile> {
    const file = join(this.dir(ws), 'index.json')
    const raw = await readText(file)
    const empty: IndexFile = { version: 1, next: 1, pins: [] }
    if (!raw) return empty
    try {
      const d = JSON.parse(raw) as Partial<IndexFile>
      if (d && Array.isArray(d.pins))
        return {
          version: 1,
          next: Math.max(d.next ?? 1, ...d.pins.map((p) => p.id + 1)),
          pins: d.pins.map(normalizePin),
          ...(typeof d.lastAgent === 'string' ? { lastAgent: d.lastAgent } : {})
        }
    } catch {
      // hỏng: cất sang bên cạnh, bắt đầu lại
    }
    await fs.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
    return empty
  }

  /** Chạy lần lượt các thay đổi của một workspace, ghi file + báo giao diện / trang sau mỗi lần. */
  private mutate<T>(ws: Workspace, fn: (d: IndexFile) => Promise<T> | T): Promise<T> {
    const prev = this.chain.get(ws.id) ?? Promise.resolve()
    const run = prev.then(async () => {
      const d = await this.load(ws)
      const out = await fn(d)
      await this.save(ws, d)
      this.changed(ws.id)
      return out
    })
    this.chain.set(
      ws.id,
      run.catch(() => {})
    )
    return run
  }

  private async save(ws: Workspace, d: IndexFile): Promise<void> {
    const file = join(this.dir(ws), 'index.json')
    await fs.mkdir(dirname(file), { recursive: true })
    if (!this.ignored.has(ws.id)) {
      await ensureIgnored(ws.path, ['.stag/'], 'stag.ai kanban data').catch(() => {})
      this.ignored.add(ws.id)
    }
    await fs.writeFile(`${file}.tmp`, JSON.stringify(d, null, 2), 'utf8')
    await fs.rename(`${file}.tmp`, file)
  }

  private changed(wsId: string): void {
    if (this.notifyTimers.has(wsId)) return
    this.notifyTimers.set(
      wsId,
      setTimeout(() => {
        this.notifyTimers.delete(wsId)
        this.events.changed(wsId)
        void this.pushPages(wsId)
      }, 80)
    )
  }

  private ws(id: string): Workspace {
    const ws = this.workspace(id)
    if (!ws) throw new Error('Workspace không còn')
    return ws
  }

  /** Ảnh (đường dẫn trong dự án, `/`). */
  private async writeImage(ws: Workspace, name: string, png: Buffer): Promise<string> {
    const rel = `.stag/inspect/img/${name}`
    const full = join(ws.path, ...rel.split('/'))
    await fs.mkdir(dirname(full), { recursive: true })
    await fs.writeFile(full, png)
    return rel
  }

  async snapshot(wsId: string): Promise<InspectSnapshot> {
    const ws = this.ws(wsId)
    const d = await this.load(ws)
    const places: InspectSnapshot['places'] = {}
    for (const p of this.browser.pages(wsId)) places[p.tabId] = this.places.get(p.tabId) ?? {}
    return { pins: d.pins, places }
  }

  /** Nạp sẵn workspace (lúc mở app) để hàng chờ được xét cả khi chưa mở Browser. */
  async warm(ws: Workspace): Promise<void> {
    await this.load(ws)
  }

  // ---------- trang ----------

  /** Đăng ký IPC của lớp Soi trong trang. Chỉ nhận từ webContents là tab browser của app. */
  register(): void {
    const page = (e: IpcMainEvent | IpcMainInvokeEvent): PageTab => {
      const p = this.browser.pageTab(e.sender)
      if (!p) throw new Error('not a stag.ai browser tab')
      return p
    }
    ipcMain.handle(PAGE_IPC.hello, (e, url: unknown) => this.hello(page(e), String(url ?? '')))
    ipcMain.handle(PAGE_IPC.capture, (e, arg: { rect: Rect; scroll: { x: number; y: number } }) => this.pageCapture(page(e), arg))
    ipcMain.handle(PAGE_IPC.save, (e, input: SaveInput) => this.pageSave(page(e), input))
    ipcMain.handle(PAGE_IPC.staticMap, (e, url: unknown) => this.staticMap(page(e).wsId, String(url ?? '')))
    ipcMain.handle(PAGE_IPC.remove, (e, id: unknown) => this.removeDraft(page(e).wsId, Number(id)))
    ipcMain.on(PAGE_IPC.soi, (e, on: unknown) => {
      const p = this.browser.pageTab(e.sender)
      if (p) void this.toggle(p.wsId, p.tabId, !!on)
    })
    ipcMain.on(PAGE_IPC.focus, (e, id: unknown) => {
      const p = this.browser.pageTab(e.sender)
      if (p && Number.isInteger(id)) this.events.focus(p.wsId, p.tabId, Number(id))
    })
    ipcMain.on(PAGE_IPC.places, (e, places: Record<number, PinPlace>) => {
      const p = this.browser.pageTab(e.sender)
      if (!p || !places || typeof places !== 'object') return
      const clean: Record<number, PinPlace> = {}
      for (const [k, v] of Object.entries(places)) if (v === 'ok' || v === 'hidden' || v === 'orphan') clean[Number(k)] = v
      this.places.set(p.tabId, clean)
      this.events.changed(p.wsId)
    })
    ipcMain.on(PAGE_IPC.anchor, (e, a: AnchorUpdate) => {
      const p = this.browser.pageTab(e.sender)
      if (p && a && Number.isInteger(a.id)) void this.reanchor(p, a)
    })
    ipcMain.on(PAGE_IPC.res, (e, msg: { reqId: string; value: unknown }) => {
      if (!this.browser.pageTab(e.sender) || !msg) return
      const r = this.reqs.get(String(msg.reqId))
      if (r) {
        this.reqs.delete(String(msg.reqId))
        r(msg.value)
      }
    })
  }

  private cmd(p: PageTab, c: PageCmd): void {
    if (!p.wc.isDestroyed()) p.wc.send(PAGE_IPC.cmd, c)
  }

  /** Gửi lệnh có trả lời; hết giờ → null. */
  private request<T>(p: PageTab, c: PageCmd & { reqId: string }): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.reqs.delete(c.reqId)
        resolve(null)
      }, REQ_TIMEOUT)
      this.reqs.set(c.reqId, (v) => {
        clearTimeout(timer)
        resolve((v ?? null) as T | null)
      })
      this.cmd(p, c)
    })
  }

  private agentsFor(wsId: string, pins: InspectPin[]): InspectAgent[] {
    return this.team(wsId).map((a) => ({ ...a, load: pins.filter((p) => p.agentId === a.id && withAgent(p.state)).length }))
  }

  private async pageState(p: PageTab): Promise<PageState> {
    const ws = this.ws(p.wsId)
    const d = await this.load(ws)
    const url = this.pageUrl.get(p.tabId)
    const team = this.agentsFor(p.wsId, d.pins)
    return {
      on: p.inspect,
      viewport: p.viewport,
      pins: url ? d.pins.filter((x) => x.url === url).map(toPagePin) : [],
      agents: team,
      lastAgentId: pickAgent(team, d.lastAgent)
    }
  }

  private async pushPages(wsId: string): Promise<void> {
    if (!this.workspace(wsId)) return
    for (const p of this.browser.pages(wsId)) {
      if (!this.pageUrl.has(p.tabId)) continue
      this.places.delete(p.tabId)
      p.wc.send(PAGE_IPC.state, await this.pageState(p))
    }
  }

  /** Trang vừa tải (hoặc đổi URL trong trang): trả trạng thái. */
  private async hello(p: PageTab, url: string): Promise<PageState> {
    this.pageUrl.set(p.tabId, pageKey(url))
    this.places.delete(p.tabId)
    return this.pageState(p)
  }

  private async pageCapture(p: PageTab, arg: { rect: Rect; scroll: { x: number; y: number } }): Promise<CaptureResult | null> {
    if (!arg?.rect) return null
    this.sweep()
    const png = await this.browser.capture(p.wsId, p.tabId, arg.rect, arg.scroll)
    if (!png) return null
    const captureId = randomUUID()
    this.captures.set(captureId, { wsId: p.wsId, png, at: Date.now() })
    return { captureId }
  }

  private sweep(): void {
    const t = Date.now()
    for (const [k, v] of this.captures) if (t - v.at > CAPTURE_TTL) this.captures.delete(k)
  }

  /** Lưu nháp (send: false) hoặc gửi (send: true) bình luận của một phần tử. */
  private async pageSave(p: PageTab, input: SaveInput): Promise<number> {
    const ws = this.ws(p.wsId)
    const text = String(input?.text ?? '').trim().slice(0, MAX_TEXT)
    if (!text) throw new Error('Bình luận trống')
    const member = this.team(p.wsId).find((a) => a.id === input.agentId)
    if (!member) throw new Error('Agent không còn trong workspace')
    const cap = input.captureId ? this.captures.get(input.captureId) : undefined
    if (cap) this.captures.delete(input.captureId!)
    const at = now()
    const id = await this.mutate(ws, async (d) => {
      let pin = input.pinId !== undefined ? d.pins.find((x) => x.id === input.pinId) : undefined
      // Nháp đã bị gửi / xoá ở chỗ khác: tạo mục mới thay vì sửa mạch đã gửi.
      if (pin && pin.state !== 'draft') pin = undefined
      const target = cleanTarget(input.target)
      if (!pin) {
        if (!target) throw new Error('Thiếu phần tử')
        pin = {
          id: d.next++,
          url: pageKey(String(input.url ?? '')),
          title: String(input.title ?? '').slice(0, 200),
          agentId: member.id,
          agentName: member.name,
          state: 'draft',
          round: 1,
          target,
          thread: [{ by: 'user', text, at, round: 1 }],
          images: {},
          createdAt: at,
          updatedAt: at
        }
        d.pins.push(pin)
      } else {
        if (target) pin.target = target
        pin.agentId = member.id
        pin.agentName = member.name
        pin.thread = [{ by: 'user', text, at, round: 1 }]
        pin.updatedAt = at
      }
      if (cap) pin.images.before = await this.writeImage(ws, `p${pin.id}-before.png`, cap.png)
      if (input.send) {
        enqueue(pin, at)
        d.lastAgent = member.id
      }
      return pin.id
    })
    if (input.send) this.events.queued(member.id)
    return id
  }

  /** Xoá nháp (hộp bình luận đóng khi đã xoá hết chữ). Mạch đã gửi thì không xoá. */
  async removeDraft(wsId: string, id: number): Promise<void> {
    const ws = this.ws(wsId)
    await this.mutate(ws, (d) => {
      const i = d.pins.findIndex((x) => x.id === id && x.state === 'draft')
      if (i >= 0) d.pins.splice(i, 1)
    })
  }

  /** Trang dò lại được phần tử của ghim (sau khi sửa / HMR) nhưng khoá đã lệch: lưu khoá mới để lần sau tìm thẳng. */
  private async reanchor(p: PageTab, a: AnchorUpdate): Promise<void> {
    const ws = this.workspace(p.wsId)
    const url = this.pageUrl.get(p.tabId)
    if (!ws || !url) return
    const pin = (await this.load(ws)).pins.find((x) => x.id === a.id && x.url === url)
    if (!pin) return
    const next = { selector: String(a.selector ?? '').slice(0, 600), path: String(a.path ?? '').slice(0, 1200), text: String(a.text ?? '').slice(0, 200), label: String(a.label ?? '').slice(0, 40) }
    const t = pin.target
    if (!next.selector || !next.path || (t.selector === next.selector && t.path === next.path && t.text === next.text)) return
    await this.mutate(ws, (d) => {
      const cur = d.pins.find((x) => x.id === a.id)
      if (cur) cur.target = { ...cur.target, ...next }
    })
  }

  /**
   * Trang tĩnh trên máy: file HTML trong dự án ứng với URL (localhost: thử `''`, public/, site/, dist/… ; file://: chính
   * file đó nếu nằm trong dự án) + thẻ mở của nó, để lớp Soi khớp phần tử ↔ dòng.
   */
  private async staticMap(wsId: string, url: string): Promise<{ file: string; tags: StaticTag[] } | null> {
    const ws = this.workspace(wsId)
    if (!ws) return null
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return null
    }
    const rels: string[] = []
    if (u.protocol === 'file:') {
      const rel = relative(ws.path, fileURLToPath(u))
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) rels.push(rel.split(sep).join('/'))
    } else if (/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|.+\.localhost)$/i.test(u.hostname)) {
      for (const root of STATIC_ROOTS) for (const c of staticCandidates(u.pathname)) rels.push(root ? `${root}/${c}` : c)
    }
    for (const rel of rels) {
      const full = join(ws.path, ...rel.split('/'))
      try {
        const st = await fs.stat(full)
        if (!st.isFile() || st.size > 2 * 1024 * 1024) continue
        return { file: rel, tags: staticTags(await fs.readFile(full, 'utf8')) }
      } catch {
        // thử chỗ tiếp theo
      }
    }
    return null
  }

  /** Bật / tắt Soi trên tab (nút Soi, Ctrl+Shift+C, Esc trong trang). */
  async toggle(wsId: string, tabId: string, on?: boolean): Promise<void> {
    const p = this.browser.page(wsId, tabId)
    if (!p) return
    this.browser.setInspect(wsId, tabId, on ?? !p.inspect)
    const cur = this.browser.page(wsId, tabId)
    if (cur && this.pageUrl.has(tabId)) cur.wc.send(PAGE_IPC.state, await this.pageState(cur))
  }

  // ---------- người dùng (renderer) ----------

  async act(wsId: string, a: InspectAction): Promise<InspectActionResult> {
    const ws = this.ws(wsId)
    switch (a.type) {
      case 'toggle':
        await this.toggle(wsId, a.tabId, a.on)
        break
      case 'focus': {
        const p = this.browser.page(wsId, a.tabId)
        if (p) this.cmd(p, { type: 'flash', id: a.id })
        break
      }
      case 'peek': {
        const p = this.browser.page(wsId, a.tabId)
        if (p) this.cmd(p, { type: 'peek', id: a.id })
        break
      }
      case 'read': {
        const d = await this.load(ws)
        if (d.pins.some((x) => x.id === a.id && x.state === 'new'))
          await this.mutate(ws, (x) => {
            const pin = x.pins.find((y) => y.id === a.id)
            if (pin) markRead(pin)
          })
        break
      }
      case 'reply': {
        const text = a.text.trim().slice(0, MAX_TEXT)
        if (text) await this.answer(ws, a.id, text)
        break
      }
      case 'close':
        await this.mutate(ws, (d) => {
          // Agent có thể vẫn đang làm mục này: mục kế tiếp chỉ thành "đang sửa" khi agent trả lời (promoteNext ở reply).
          const pin = d.pins.find((x) => x.id === a.id)
          if (pin) close(pin)
        })
        break
      case 'reopen': {
        const agent = await this.mutate(ws, (d) => {
          const pin = d.pins.find((x) => x.id === a.id)
          return pin && reopen(pin) ? pin.agentId : null
        })
        if (agent) this.events.queued(agent)
        break
      }
    }
    return {}
  }

  /** Bạn trả lời trong mạch (vòng sau): đọc lại style / HTML hiện tại của phần tử rồi vào hàng. */
  private async answer(ws: Workspace, id: number, text: string): Promise<void> {
    const pin0 = (await this.load(ws)).pins.find((x) => x.id === id)
    if (!pin0) return
    const fresh = await this.resnap(ws.id, pin0)
    const agent = await this.mutate(ws, (d) => {
      const pin = d.pins.find((x) => x.id === id)
      if (!pin || pin.state === 'draft' || pin.state === 'closed' || withAgent(pin.state)) return null
      if (fresh) pin.target = { ...pin.target, ...fresh }
      enqueue(pin, now(), text)
      return pin.agentId
    })
    if (agent) this.events.queued(agent)
  }

  private async resnap(wsId: string, pin: InspectPin): Promise<Pick<InspectTarget, 'style' | 'html' | 'text'> | null> {
    for (const p of this.browser.pages(wsId)) {
      if (this.pageUrl.get(p.tabId) !== pin.url) continue
      const v = await this.request<Pick<InspectTarget, 'style' | 'html' | 'text'>>(p, { type: 'resnap', reqId: randomUUID(), id: pin.id })
      if (v && typeof v.style === 'string' && typeof v.html === 'string') return { style: v.style.slice(0, 600), html: v.html.slice(0, 1200), text: String(v.text ?? '').slice(0, 200) }
    }
    return null
  }

  // ---------- agent ----------

  /** Bình luận đang chờ gõ vào phiên agent (chưa gõ), theo thứ tự hàng; kèm gói tin. */
  async queuedFor(agentId: string): Promise<InspectDelivery[]> {
    const out: InspectDelivery[] = []
    for (const ws of this.known.values()) {
      const d = await this.load(ws)
      const pins = d.pins
        .filter((p) => p.agentId === agentId && p.state === 'queued' && !p.delivered)
        .sort((a, b) => (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '') || a.id - b.id)
      if (!pins.length) continue
      out.push({ ws, pins, text: packetMessage(pins), display: packetDisplay(pins.map((p) => p.id)) })
    }
    return out
  }

  /** Đã gõ gói tin vào phiên agent. */
  async delivered(ws: Workspace, agentId: string, ids: number[]): Promise<void> {
    await this.mutate(ws, (d) => markDelivered(d.pins, agentId, ids))
  }

  /** Tool inspect_reply. Trả về câu trả lời cho agent (tiếng Anh). */
  async reply(ws: Workspace, agent: Agent, input: ReplyInput): Promise<string> {
    const text = String(input.text ?? '').trim().slice(0, MAX_TEXT)
    if (!text) throw new Error('text is empty.')
    const res = await this.mutate(ws, (d) => {
      const pin = d.pins.find((x) => x.id === Number(input.id))
      if (!pin) throw new Error(`No comment #${input.id} in this workspace.`)
      const state = applyReply(pin, { ...input, text, changes: input.changes?.trim().slice(0, 1000) || undefined }, agent.id)
      const next = promoteNext(d.pins, agent.id)
      const left = d.pins.filter((x) => x.agentId === agent.id && x.state === 'queued').length
      return { state, url: pin.url, next: next?.id ?? null, left }
    })
    // Agent đã trả lời (thường là đã sửa): tải lại trang đang mở — trang tĩnh / WordPress không có HMR. Lớp Soi chờ hộp
    // bình luận đang gõ đóng lại rồi mới tải.
    if (res.state === 'new' && !input.ask && !input.failed)
      for (const p of this.browser.pages(ws.id)) if (this.pageUrl.get(p.tabId) === res.url) this.cmd(p, { type: 'reload' })
    const what = res.state === 'closed' ? 'The user had already closed this comment; nothing more to do on it.' : 'The user sees your reply in the comment thread.'
    const next = res.next !== null ? ` Next for you: #${res.next}.` : res.left ? ` ${res.left} more comment(s) are waiting for you; stag.ai sends them when you are idle.` : ''
    return `Recorded on #${input.id}. ${what}${next}`
  }

  async renameAgent(agentId: string, name: string): Promise<void> {
    for (const ws of this.known.values()) {
      const d = await this.load(ws)
      if (!d.pins.some((p) => p.agentId === agentId)) continue
      await this.mutate(ws, (x) => {
        for (const p of x.pins) if (p.agentId === agentId) p.agentName = name
      })
    }
  }

  forgetWorkspace(wsId: string): void {
    this.data.delete(wsId)
    this.known.delete(wsId)
    this.chain.delete(wsId)
  }

  /** Tab đóng: bỏ trạng thái của nó. */
  forgetTab(tabId: string): void {
    this.pageUrl.delete(tabId)
    this.places.delete(tabId)
  }
}

/** Agent chọn sẵn trong hộp bình luận: agent dùng lần trước → agent rảnh có phiên → có phiên → đầu tiên. */
export function pickAgent(team: InspectAgent[], last: string | undefined): string | null {
  if (last && team.some((a) => a.id === last)) return last
  return (team.find((a) => a.running && !a.busy) ?? team.find((a) => a.running) ?? team[0])?.id ?? null
}

/** Kiểm tra + cắt gọn gói ngữ cảnh trang gửi lên (trang có thể là bất cứ gì: không tin dữ liệu). */
export function cleanTarget(t: InspectTarget | undefined): InspectTarget | null {
  if (!t || typeof t !== 'object') return null
  const s = (v: unknown, n: number): string => String(v ?? '').slice(0, n)
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0)
  const frac = (v: unknown): number => Math.min(1, Math.max(0, Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : 0.5))
  const kind = t.viewport?.kind === 'tab' || t.viewport?.kind === 'mob' ? t.viewport.kind : 'desk'
  const out: InspectTarget = {
    tag: s(t.tag, 120),
    ...(t.label ? { label: s(t.label, 40) } : {}),
    selector: s(t.selector, 600),
    path: s(t.path, 1200),
    text: s(t.text, 200),
    rect: { x: num(t.rect?.x), y: num(t.rect?.y), w: num(t.rect?.w), h: num(t.rect?.h) },
    ...(t.pt && typeof t.pt === 'object' ? { pt: { x: frac(t.pt.x), y: frac(t.pt.y) } } : {}),
    scroll: { x: num(t.scroll?.x), y: num(t.scroll?.y) },
    viewport: { kind, w: num(t.viewport?.w), h: num(t.viewport?.h), dpr: num(t.viewport?.dpr) || 1 },
    style: s(t.style, 600),
    html: s(t.html, 1200)
  }
  if (!out.selector && !out.path) return null
  const src = t.source
  if (src && typeof src === 'object') {
    const chips = ['code', 'html', 'wp', 'el', 'theme', 'plugin', 'none']
    out.source = {
      chip: (chips.includes(src.chip) ? src.chip : 'none') as InspectSource['chip'],
      label: s(src.label, 300),
      ...(src.file ? { file: s(src.file, 400) } : {}),
      ...(Number.isInteger(src.line) ? { line: Number(src.line) } : {}),
      ...(src.effect ? { effect: s(src.effect, 300) } : {}),
      ...(src.hint ? { hint: s(src.hint, 400) } : {}),
      ...(src.inherited ? { inherited: true } : {})
    }
  }
  const g = t.group
  if (g && typeof g === 'object' && Number(g.n) > 1) out.group = { n: Math.min(9999, Math.floor(Number(g.n))), kind: g.kind === 'similar' ? 'similar' : 'loop', selector: s(g.selector, 400) }
  return out
}
