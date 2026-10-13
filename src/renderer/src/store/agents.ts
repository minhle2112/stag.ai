import { create } from 'zustand'
import { emptyCanvas, type CellSizeKind } from '@shared/canvas'
import { CHUNG, placeOf } from '@shared/projects'
import { agentKind, type Agent, type AgentCell, type AgentRun, type CanvasLayout, type CanvasView, type CreateAgentRequest } from '@shared/types'
import { revealCell, viewCenter } from '../canvasBus'
import { addCell, cells, findCell, leaves, reconcile, removeCell, toFront, widgetKey, type Placement } from '../layout'
import { bindPty, disposeTerminal, focusTerminal, onAgentExit, startTerminalBus, terminalSize } from '../terminals'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

export interface WorkspaceAgents {
  /** Mọi agent của workspace (mọi project), theo thứ tự ở thanh bên. */
  agents: Agent[]
  /** Canvas của chỗ đang xem (`place`): tab Chung, hoặc tab của một project. */
  layout: CanvasLayout
  /** Chỗ đang xem: CHUNG hoặc id project. Workspace chưa có project luôn là CHUNG. */
  place: string
  /** Canvas của các chỗ khác (không gồm `place`), theo chỗ. */
  layouts: Record<string, CanvasLayout>
  running: Record<string, AgentRun>
  /** Agent đang khởi động (chờ main tạo tiến trình). */
  starting: Record<string, boolean>
  /** Agent vừa tạo: ô sẽ tự mở phiên mới khi đã gắn terminal và biết kích thước. */
  autoStart: Record<string, boolean>
  errors: Record<string, string>
  /** Mã ô đang chọn: id agent, hoặc widgetKey(...) với ô widget (xem layout.ts). */
  focused: string | null
}

/** Ô chọn sẵn khi ô đang chọn bị đóng: ưu tiên ô agent. */
const firstCell = (layout: CanvasLayout): string | null => leaves(layout)[0] ?? cells(layout)[0] ?? null

/** Cỡ ô mặc định theo loại agent. */
const sizeKind = (agent: Agent | undefined): CellSizeKind => (agent && agentKind(agent) === 'terminal' ? 'terminal' : 'agent')

const empty = (): WorkspaceAgents => ({ agents: [], layout: emptyCanvas(), place: CHUNG, layouts: {}, running: {}, starting: {}, autoStart: {}, errors: {}, focused: null })

const PLACE_KEY = 'stag.place'

/** Tab project lần trước của từng workspace (chỉ là tiện ích, không lưu được thì về Chung). */
function readPlaces(): Record<string, string> {
  try {
    return (JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as Record<string, string> | null) ?? {}
  } catch {
    return {}
  }
}

function writePlace(wsId: string, place: string): void {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify({ ...readPlaces(), [wsId]: place }))
  } catch {
    // Không lưu được thì thôi.
  }
}

/** Workspace (bản mới nhất trong store workspace). */
const wsOf = (wsId: string) => useWorkspaces.getState().items.find((w) => w.id === wsId)

/** Chỗ còn tồn tại: project đã bị xoá → Chung. */
function validPlace(wsId: string, place: string | undefined): string {
  return place && place !== CHUNG && wsOf(wsId)?.projects?.some((p) => p.id === place) ? place : CHUNG
}

/** Chỗ của agent (project của nó, hoặc Chung). */
export function agentPlace(wsId: string, agent: Pick<Agent, 'projectId'>): string {
  return placeOf(wsOf(wsId), agent)
}

/** Lưu canvas của một chỗ ở main. */
function persist(wsId: string, place: string, layout: CanvasLayout): void {
  void window.stag.agent.saveLayout(wsId, layout, place === CHUNG ? null : place)
}

interface AgentsState {
  byWs: Record<string, WorkspaceAgents>
  load: (wsId: string) => Promise<void>
  /** Tạo agent ở chỗ đang xem (hoặc `req.projectId`), đặt ô theo `place` (không có gì → giữa vùng đang nhìn). */
  create: (req: CreateAgentRequest, place?: Placement) => Promise<Agent>
  /** Agent mới do main tạo (tạo project, nhân bản): thêm vào danh sách và mở ô ở chỗ của nó; `show` = chuyển sang chỗ đó. */
  adopt: (wsId: string, agents: Agent[], opts?: { open?: boolean; show?: boolean }) => void
  start: (wsId: string, agentId: string, resume: boolean) => Promise<void>
  stop: (agentId: string) => Promise<void>
  remove: (wsId: string, agentId: string) => Promise<void>
  /** Project vừa bị xoá ở main: bỏ agent của nó khỏi danh sách (main đã dừng phiên) và canvas của nó. */
  dropProject: (wsId: string, projectId: string) => void
  /** Hiện ô của agent trên canvas (đã đóng thì mở lại đúng chỗ cũ; khác tab thì chuyển tab), chọn nó và đưa camera tới. */
  show: (wsId: string, agentId: string) => void
  /** Đóng ô của agent. Phiên (nếu có) vẫn chạy; agent vẫn ở thanh bên. */
  hide: (wsId: string, agentId: string) => void
  /** Chuyển tab (Chung / project) của workspace. */
  setPlace: (wsId: string, place: string) => void
  setLayout: (wsId: string, layout: CanvasLayout, persist?: boolean) => void
  /** Lưu camera của canvas (gọi thưa: sau khi kéo / cuộn xong). */
  setView: (wsId: string, view: CanvasView) => void
  /** Chọn ô (mã ô: id agent hoặc widgetKey) và đưa nó lên trên cùng. */
  focus: (wsId: string, key: string) => void
  /** Mở widget plugin ("<id plugin>/<id slot>") theo `place` (mặc định cạnh ô đang chọn); đã mở thì chọn ô đó. */
  openWidget: (wsId: string, widget: string, place?: Placement) => void
  /** Đóng ô widget (chỉ bỏ ô khỏi canvas). */
  closeWidget: (wsId: string, widget: string) => void
  /** Đổi tên agent (main đổi tên luôn note bộ nhớ trong vault). Lỗi thì ném ra để hộp thoại hiện. */
  rename: (wsId: string, agentId: string, name: string) => Promise<void>
  /** Đổi giao diện ô của agent (CLI ↔ chat); main từ chối nếu agent đang có phiên chạy. */
  setCell: (wsId: string, agentId: string, cell: AgentCell) => Promise<void>
  /** Chuyển agent tới vị trí `index` trong danh sách của workspace (thanh bên). */
  moveAgent: (wsId: string, agentId: string, index: number) => void
}

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const useAgents = create<AgentsState>((set, get) => {
  const patch = (wsId: string, fn: (w: WorkspaceAgents) => Partial<WorkspaceAgents>): void =>
    set((s) => {
      const cur = s.byWs[wsId] ?? empty()
      return { byWs: { ...s.byWs, [wsId]: { ...cur, ...fn(cur) } } }
    })

  /** Canvas của chỗ `place`. */
  const layoutAt = (w: WorkspaceAgents, place: string): CanvasLayout => (place === w.place ? w.layout : (w.layouts[place] ?? emptyCanvas()))

  /** Đặt canvas của chỗ `place` (chỗ đang xem → `layout`, chỗ khác → `layouts`) rồi lưu ở main. */
  const putLayout = (wsId: string, place: string, layout: CanvasLayout, save = true): void => {
    patch(wsId, (cur) => (place === cur.place ? { layout } : { layouts: { ...cur.layouts, [place]: layout } }))
    if (save) persist(wsId, place, layout)
  }

  /** Thêm ô agent vào canvas của chỗ nó (không đổi tab). Trả về true nếu vừa thêm ô ở chỗ đang xem. */
  const placeCell = (wsId: string, agent: Agent, where: Placement): boolean => {
    const w = get().byWs[wsId]
    if (!w) return false
    const place = agentPlace(wsId, agent)
    const cur = layoutAt(w, place)
    if (leaves(cur).includes(agent.id)) return false
    putLayout(wsId, place, addCell(cur, { type: 'leaf', agentId: agent.id }, sizeKind(agent), place === w.place ? where : {}))
    return place === w.place
  }

  startTerminalBus()
  // Agent đã bàn giao, phiên cũ vừa đóng: mở phiên mới trong cùng ô (phiên mới tự đọc bản bàn giao).
  window.stag.agent.onRestart((agentId) => {
    for (const [wsId, w] of Object.entries(get().byWs)) {
      if (!w.agents.some((a) => a.id === agentId)) continue
      if (w.running[agentId]) {
        patch(wsId, (cur) => {
          const running = { ...cur.running }
          delete running[agentId]
          return { running }
        })
      }
      void get().start(wsId, agentId, false)
    }
  })
  // Agent khác vừa tạo agent này (Agent API, người dùng đã xác nhận): thêm vào danh sách, đặt ô cạnh ô của agent đã
  // tạo nó và tự mở phiên (như tạo từ hộp thoại). Workspace chưa tải thì tải trước (snapshot đã có agent mới).
  window.stag.agent.onCreated(async ({ agent, nearAgentId, open }) => {
    const wsId = agent.workspaceId
    if (!get().byWs[wsId]) await get().load(wsId)
    const w = get().byWs[wsId]
    if (!w) return
    const agents = w.agents.some((a) => a.id === agent.id) ? w.agents : [...w.agents, agent]
    patch(wsId, () => ({ agents }))
    if (!open) return
    const here = placeCell(wsId, agent, { near: nearAgentId })
    patch(wsId, (cur) => ({ autoStart: { ...cur.autoStart, [agent.id]: true } }))
    if (here) revealCell(wsId, agent.id, false)
  })
  // Agent khác làm thay người dùng (Agent API): đổi thông tin, mở ô + phiên, hoặc đã xoá agent ở main.
  window.stag.agent.onApiEvent(async (e) => {
    if (e.type === 'updated') {
      const wsId = e.agent.workspaceId
      // Workspace chưa tải: lần tải sau lấy bản mới từ main.
      if (get().byWs[wsId]) patch(wsId, (cur) => ({ agents: cur.agents.map((a) => (a.id === e.agent.id ? e.agent : a)) }))
      return
    }
    if (!get().byWs[e.workspaceId]) await get().load(e.workspaceId)
    const w = get().byWs[e.workspaceId]
    if (!w) return
    if (e.type === 'open') {
      const agent = w.agents.find((a) => a.id === e.agentId)
      if (!agent) return
      const fresh = !w.running[e.agentId] && !w.starting[e.agentId]
      const here = placeCell(e.workspaceId, agent, { near: e.nearAgentId })
      if (fresh) patch(e.workspaceId, (cur) => ({ autoStart: { ...cur.autoStart, [e.agentId]: true } }))
      if (here) revealCell(e.workspaceId, e.agentId, false)
      return
    }
    // removed: như remove() nhưng main đã xoá xong.
    forget(e.workspaceId, [e.agentId])
  })
  // Ô chat không có pty nên không có sự kiện thoát của pty: tiến trình thoát thì main báo phase 'off'.
  window.stag.chat.onEvent((e) => {
    if (e.type !== 'state' || e.state.phase !== 'off') return
    for (const [wsId, w] of Object.entries(get().byWs)) {
      if (w.running[e.agentId]?.mode === 'chat') {
        patch(wsId, (cur) => {
          const running = { ...cur.running }
          delete running[e.agentId]
          return { running }
        })
      }
    }
  })
  onAgentExit((agentId) => {
    for (const [wsId, w] of Object.entries(get().byWs)) {
      if (w.running[agentId]) {
        patch(wsId, (cur) => {
          const running = { ...cur.running }
          delete running[agentId]
          return { running }
        })
      }
    }
  })

  // Workspace bị gỡ khỏi app: bỏ terminal (xterm + bộ đệm cuộn) và trạng thái agent của nó, không giữ tới lúc tắt app.
  useWorkspaces.subscribe((s, prev) => {
    if (s.items === prev.items) return
    for (const w of prev.items) {
      if (s.items.some((x) => x.id === w.id)) continue
      const cur = get().byWs[w.id]
      if (!cur) continue
      for (const a of cur.agents) disposeTerminal(a.id)
      set((st) => {
        const byWs = { ...st.byWs }
        delete byWs[w.id]
        return { byWs }
      })
    }
  })

  /** Bỏ agent khỏi mọi bảng và mọi canvas (đã xoá ở main). */
  function forget(wsId: string, ids: string[]): void {
    const gone = new Set(ids)
    for (const id of ids) disposeTerminal(id)
    const w = get().byWs[wsId]
    if (!w) return
    const without = <T>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(rec).filter(([k]) => !gone.has(k)))
    let layout = w.layout
    for (const id of ids) layout = removeCell(layout, id, true)
    const layouts: Record<string, CanvasLayout> = {}
    for (const [place, l] of Object.entries(w.layouts)) {
      let next = l
      for (const id of ids) next = removeCell(next, id, true)
      layouts[place] = next
      if (next !== l) persist(wsId, place, next)
    }
    patch(wsId, (cur) => ({
      agents: cur.agents.filter((a) => !gone.has(a.id)),
      layout,
      layouts,
      running: without(cur.running),
      starting: without(cur.starting),
      autoStart: without(cur.autoStart),
      errors: without(cur.errors),
      focused: cur.focused && gone.has(cur.focused) ? firstCell(layout) : cur.focused
    }))
    if (layout !== w.layout) persist(wsId, w.place, layout)
  }

  return {
    byWs: {},

    async load(wsId) {
      const snap = await window.stag.agent.snapshot(wsId)
      const running: Record<string, AgentRun> = {}
      for (const r of snap.running) {
        const agent = snap.agents.find((a) => a.id === r.agentId)
        // Tiến trình vừa thoát trong lúc nạp: không coi là đang chạy.
        if (r.mode !== 'chat' && !bindPty(r.agentId, r.ptyId, agent ? agentKind(agent) : 'terminal')) continue
        running[r.agentId] = r
      }
      const ws = wsOf(wsId)
      const idsAt = (place: string): string[] => snap.agents.filter((a) => placeOf(ws, a) === place).map((a) => a.id)
      // Canvas từng chỗ chỉ giữ ô của agent thuộc chỗ đó.
      const all: Record<string, CanvasLayout> = { [CHUNG]: reconcile(snap.layout, idsAt(CHUNG)) }
      if (JSON.stringify(all[CHUNG]) !== JSON.stringify(snap.layout)) persist(wsId, CHUNG, all[CHUNG])
      for (const p of ws?.projects ?? []) {
        const saved = snap.projectLayouts?.[p.id] ?? emptyCanvas()
        all[p.id] = reconcile(saved, idsAt(p.id))
        if (snap.projectLayouts?.[p.id] && all[p.id] !== saved) persist(wsId, p.id, all[p.id])
      }
      const place = validPlace(wsId, get().byWs[wsId]?.place ?? readPlaces()[wsId])
      const { [place]: layout, ...layouts } = all
      patch(wsId, () => ({ agents: snap.agents, layout: layout ?? emptyCanvas(), layouts, place, running, focused: firstCell(layout ?? emptyCanvas()) }))
    },

    async create(req, where = {}) {
      const wsId = req.workspaceId
      const cur = get().byWs[wsId]
      // Agent mới thuộc tab đang xem (trừ khi hộp thoại nói rõ project).
      const projectId = req.projectId ?? (cur && cur.place !== CHUNG ? cur.place : undefined)
      const agent = await window.stag.agent.create({ ...req, ...(projectId ? { projectId } : {}) })
      const place = agentPlace(wsId, agent)
      if (place !== get().byWs[wsId]?.place) get().setPlace(wsId, place)
      // Không nói đặt đâu (Ctrl+K, Ctrl+Shift+N) → giữa vùng đang nhìn.
      const center = where.at || where.center || where.near ? where.center : (viewCenter(wsId) ?? undefined)
      const layout = addCell(get().byWs[wsId]?.layout ?? emptyCanvas(), { type: 'leaf', agentId: agent.id }, sizeKind(agent), { ...where, center })
      patch(wsId, (c) => ({
        agents: [...c.agents, agent],
        layout,
        autoStart: { ...c.autoStart, [agent.id]: true },
        focused: agent.id
      }))
      persist(wsId, place, layout)
      revealCell(wsId, agent.id)
      return agent
    },

    adopt(wsId, list, opts = {}) {
      const w = get().byWs[wsId]
      if (!w) return
      const fresh = list.filter((a) => !w.agents.some((x) => x.id === a.id))
      patch(wsId, (cur) => ({ agents: [...cur.agents, ...fresh] }))
      if (opts.show && list[0]) get().setPlace(wsId, agentPlace(wsId, list[0]))
      if (opts.open === false) return
      for (const a of list) placeCell(wsId, a, { near: get().byWs[wsId]?.focused ?? null })
      const focused = list[0] && agentPlace(wsId, list[0]) === get().byWs[wsId]?.place ? list[0].id : undefined
      if (focused) {
        patch(wsId, () => ({ focused }))
        revealCell(wsId, focused)
      }
    },

    async start(wsId, agentId, resume) {
      const w = get().byWs[wsId]
      if (!w || w.running[agentId] || w.starting[agentId]) return
      patch(wsId, (cur) => {
        const autoStart = { ...cur.autoStart }
        delete autoStart[agentId]
        const errors = { ...cur.errors }
        delete errors[agentId]
        return { starting: { ...cur.starting, [agentId]: true }, autoStart, errors }
      })
      try {
        const run = await window.stag.agent.start({ agentId, resume, ...terminalSize(agentId) })
        const agent = get().byWs[wsId]?.agents.find((a) => a.id === agentId)
        // Phiên thoát ngay (adapter sai, CLI lỗi lúc mở) trước khi nhận được kết quả mở: không để ô kẹt "đang chạy".
        const alive = run.mode === 'chat' || bindPty(agentId, run.ptyId, agent ? agentKind(agent) : 'terminal')
        patch(wsId, (cur) => ({
          ...(alive ? { running: { ...cur.running, [agentId]: run } } : {}),
          // Id để "tiếp tục phiên" do main giữ (Codex: thread id, biết sau qua sự kiện 'updated').
          agents: cur.agents.map((a) => (a.id === agentId && run.lastSessionId ? { ...a, lastSessionId: run.lastSessionId } : a))
        }))
      } catch (e) {
        patch(wsId, (cur) => ({ errors: { ...cur.errors, [agentId]: errMsg(e) } }))
      } finally {
        patch(wsId, (cur) => {
          const starting = { ...cur.starting }
          delete starting[agentId]
          return { starting }
        })
      }
    },

    async setCell(wsId, agentId, cell) {
      const agent = await window.stag.agent.setCell(agentId, cell)
      patch(wsId, (cur) => ({ agents: cur.agents.map((a) => (a.id === agentId ? agent : a)) }))
    },

    async stop(agentId) {
      await window.stag.agent.stop(agentId)
    },

    async remove(wsId, agentId) {
      await window.stag.agent.remove(agentId)
      // Terminal đã gỡ nên sự kiện thoát của phiên sẽ không tới đây: tự bỏ agent khỏi các bảng trạng thái.
      forget(wsId, [agentId])
    },

    dropProject(wsId, projectId) {
      const w = get().byWs[wsId]
      if (!w) return
      const ids = w.agents.filter((a) => a.projectId === projectId).map((a) => a.id)
      // Bỏ canvas của project TRƯỚC khi bỏ agent: forget() lưu lại canvas nào có ô bị gỡ, không được ghi lại canvas này.
      if (w.place === projectId) get().setPlace(wsId, CHUNG)
      patch(wsId, (cur) => {
        const layouts = { ...cur.layouts }
        delete layouts[projectId]
        return { layouts }
      })
      forget(wsId, ids)
    },

    setPlace(wsId, raw) {
      const w = get().byWs[wsId]
      const place = validPlace(wsId, raw)
      writePlace(wsId, place)
      if (!w || w.place === place) return
      const layouts = { ...w.layouts, [w.place]: w.layout }
      const layout = layouts[place] ?? emptyCanvas()
      delete layouts[place]
      patch(wsId, () => ({ place, layout, layouts, focused: firstCell(layout) }))
      useUi.getState().setMaxCell(wsId, null)
    },

    show(wsId, agentId) {
      const w0 = get().byWs[wsId]
      const agent = w0?.agents.find((a) => a.id === agentId)
      if (!w0 || !agent) return
      // Agent ở tab khác: chuyển sang tab đó trước.
      const place = agentPlace(wsId, agent)
      if (place !== w0.place) get().setPlace(wsId, place)
      const w = get().byWs[wsId]!
      if (leaves(w.layout).includes(agentId)) {
        get().focus(wsId, agentId)
        return revealCell(wsId, agentId)
      }
      const layout = addCell(w.layout, { type: 'leaf', agentId }, sizeKind(agent), { near: w.focused })
      patch(wsId, () => ({ layout, focused: agentId }))
      persist(wsId, w.place, layout)
      revealCell(wsId, agentId)
    },

    hide(wsId, agentId) {
      const w = get().byWs[wsId]
      if (!w) return
      const agent = w.agents.find((a) => a.id === agentId)
      const place = agent ? agentPlace(wsId, agent) : w.place
      const cur = layoutAt(w, place)
      const layout = removeCell(cur, agentId)
      if (layout === cur) return
      putLayout(wsId, place, layout)
      if (place === w.place) patch(wsId, (c) => ({ focused: c.focused === agentId ? firstCell(layout) : c.focused }))
    },

    setLayout(wsId, layout, save = true) {
      const w = get().byWs[wsId]
      patch(wsId, () => ({ layout }))
      if (save) persist(wsId, w?.place ?? CHUNG, layout)
    },

    setView(wsId, view) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = { ...w.layout, view }
      patch(wsId, () => ({ layout }))
      persist(wsId, w.place, layout)
    },

    focus(wsId, key) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = toFront(w.layout, key)
      if (w.focused === key && layout === w.layout) return
      patch(wsId, () => ({ focused: key, layout }))
      if (layout !== w.layout) persist(wsId, w.place, layout)
    },

    openWidget(wsId, widget, where) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      // Mỗi widget chỉ một ô trong một tab.
      if (findCell(w.layout, key)) {
        get().focus(wsId, key)
        return revealCell(wsId, key)
      }
      const layout = addCell(w.layout, { type: 'widget', widget }, 'widget', where ?? { near: w.focused })
      patch(wsId, () => ({ layout, focused: key }))
      persist(wsId, w.place, layout)
      revealCell(wsId, key)
    },

    closeWidget(wsId, widget) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      const layout = removeCell(w.layout, key)
      patch(wsId, (cur) => ({ layout, focused: cur.focused === key ? firstCell(layout) : cur.focused }))
      persist(wsId, w.place, layout)
    },

    async rename(wsId, agentId, name) {
      let agent: Agent
      try {
        agent = await window.stag.agent.rename(agentId, name)
      } catch (e) {
        throw new Error(errMsg(e))
      }
      patch(wsId, (cur) => ({ agents: cur.agents.map((a) => (a.id === agentId ? { ...a, name: agent.name } : a)) }))
    },

    moveAgent(wsId, agentId, index) {
      const w = get().byWs[wsId]
      const from = w?.agents.findIndex((a) => a.id === agentId) ?? -1
      if (!w || from === -1) return
      const agents = [...w.agents]
      const [moved] = agents.splice(from, 1)
      agents.splice(Math.max(0, Math.min(index, agents.length)), 0, moved)
      if (agents.every((a, i) => a.id === w.agents[i].id)) return
      patch(wsId, () => ({ agents }))
      window.stag.agent.reorder(wsId, agents.map((a) => a.id))
    }
  }
})

/** Mở agent cho người dùng xem: chuyển workspace + tab Agents (+ tab project của agent), hiện ô và đặt con trỏ vào terminal. */
export function openAgent(wsId: string, agentId: string): void {
  useWorkspaces.getState().setActive(wsId)
  useUi.getState().setTab('agents')
  useAgents.getState().show(wsId, agentId)
  setTimeout(() => focusTerminal(agentId), 0)
}
