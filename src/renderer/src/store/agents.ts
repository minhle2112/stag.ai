import { create } from 'zustand'
import { emptyCanvas, type CellSizeKind } from '@shared/canvas'
import { agentKind, type Agent, type AgentCell, type AgentRun, type CanvasLayout, type CanvasView, type CreateAgentRequest } from '@shared/types'
import { revealCell, viewCenter } from '../canvasBus'
import { addCell, cells, findCell, leaves, reconcile, removeCell, toFront, widgetKey, type Placement } from '../layout'
import { bindPty, disposeTerminal, focusTerminal, onAgentExit, startTerminalBus, terminalSize } from '../terminals'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

export interface WorkspaceAgents {
  agents: Agent[]
  layout: CanvasLayout
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

const empty = (): WorkspaceAgents => ({ agents: [], layout: emptyCanvas(), running: {}, starting: {}, autoStart: {}, errors: {}, focused: null })

interface AgentsState {
  byWs: Record<string, WorkspaceAgents>
  load: (wsId: string) => Promise<void>
  /** Tạo agent, đặt ô theo `place` (không có gì → giữa vùng đang nhìn). */
  create: (req: CreateAgentRequest, place?: Placement) => Promise<Agent>
  start: (wsId: string, agentId: string, resume: boolean) => Promise<void>
  stop: (agentId: string) => Promise<void>
  remove: (wsId: string, agentId: string) => Promise<void>
  /** Hiện ô của agent trên canvas (đã đóng thì mở lại đúng chỗ cũ), chọn nó và đưa camera tới. */
  show: (wsId: string, agentId: string) => void
  /** Đóng ô của agent. Phiên (nếu có) vẫn chạy; agent vẫn ở thanh bên. */
  hide: (wsId: string, agentId: string) => void
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
    if (!open || leaves(w.layout).includes(agent.id)) return patch(wsId, () => ({ agents }))
    const layout = addCell(w.layout, { type: 'leaf', agentId: agent.id }, sizeKind(agent), { near: nearAgentId })
    patch(wsId, (cur) => ({ agents, layout, autoStart: { ...cur.autoStart, [agent.id]: true } }))
    window.stag.agent.saveLayout(wsId, layout)
    revealCell(wsId, agent.id, false)
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
      const layout = addCell(w.layout, { type: 'leaf', agentId: e.agentId }, sizeKind(agent), { near: e.nearAgentId })
      const fresh = !w.running[e.agentId] && !w.starting[e.agentId]
      patch(e.workspaceId, (cur) => ({ layout, ...(fresh ? { autoStart: { ...cur.autoStart, [e.agentId]: true } } : {}) }))
      if (layout !== w.layout) {
        window.stag.agent.saveLayout(e.workspaceId, layout)
        revealCell(e.workspaceId, e.agentId, false)
      }
      return
    }
    // removed: như remove() nhưng main đã xoá xong.
    disposeTerminal(e.agentId)
    const layout = removeCell(w.layout, e.agentId, true)
    const without = <T,>(rec: Record<string, T>): Record<string, T> => {
      const next = { ...rec }
      delete next[e.agentId]
      return next
    }
    patch(e.workspaceId, (cur) => ({
      agents: cur.agents.filter((a) => a.id !== e.agentId),
      layout,
      running: without(cur.running),
      starting: without(cur.starting),
      autoStart: without(cur.autoStart),
      errors: without(cur.errors),
      focused: cur.focused === e.agentId ? firstCell(layout) : cur.focused
    }))
    window.stag.agent.saveLayout(e.workspaceId, layout)
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

  return {
    byWs: {},

    async load(wsId) {
      const snap = await window.stag.agent.snapshot(wsId)
      const running: Record<string, AgentRun> = {}
      for (const r of snap.running) {
        running[r.agentId] = r
        if (r.mode !== 'chat') bindPty(r.agentId, r.ptyId)
      }
      const layout = reconcile(snap.layout, snap.agents.map((a) => a.id))
      patch(wsId, () => ({ agents: snap.agents, layout, running, focused: firstCell(layout) }))
      if (JSON.stringify(layout) !== JSON.stringify(snap.layout)) window.stag.agent.saveLayout(wsId, layout)
    },

    async create(req, place = {}) {
      const agent = await window.stag.agent.create(req)
      const wsId = req.workspaceId
      // Không nói đặt đâu (Ctrl+K, Ctrl+Alt+N) → giữa vùng đang nhìn.
      const center = place.at || place.center || place.near ? place.center : (viewCenter(wsId) ?? undefined)
      const layout = addCell(get().byWs[wsId]?.layout ?? emptyCanvas(), { type: 'leaf', agentId: agent.id }, sizeKind(agent), { ...place, center })
      patch(wsId, (cur) => ({
        agents: [...cur.agents, agent],
        layout,
        autoStart: { ...cur.autoStart, [agent.id]: true },
        focused: agent.id
      }))
      window.stag.agent.saveLayout(wsId, layout)
      revealCell(wsId, agent.id)
      return agent
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
        if (run.mode !== 'chat') bindPty(agentId, run.ptyId)
        patch(wsId, (cur) => ({
          running: { ...cur.running, [agentId]: run },
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
      disposeTerminal(agentId)
      const layout = removeCell(get().byWs[wsId]?.layout ?? emptyCanvas(), agentId, true)
      // Terminal đã gỡ nên sự kiện thoát của phiên sẽ không tới đây: tự bỏ agent khỏi các bảng trạng thái.
      const without = <T>(rec: Record<string, T>): Record<string, T> => {
        const next = { ...rec }
        delete next[agentId]
        return next
      }
      patch(wsId, (cur) => ({
        agents: cur.agents.filter((a) => a.id !== agentId),
        layout,
        running: without(cur.running),
        starting: without(cur.starting),
        autoStart: without(cur.autoStart),
        errors: without(cur.errors),
        focused: cur.focused === agentId ? firstCell(layout) : cur.focused
      }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    show(wsId, agentId) {
      const w = get().byWs[wsId]
      if (!w || !w.agents.some((a) => a.id === agentId)) return
      if (leaves(w.layout).includes(agentId)) {
        get().focus(wsId, agentId)
        return revealCell(wsId, agentId)
      }
      const agent = w.agents.find((a) => a.id === agentId)
      const layout = addCell(w.layout, { type: 'leaf', agentId }, sizeKind(agent), { near: w.focused })
      patch(wsId, () => ({ layout, focused: agentId }))
      window.stag.agent.saveLayout(wsId, layout)
      revealCell(wsId, agentId)
    },

    hide(wsId, agentId) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = removeCell(w.layout, agentId)
      patch(wsId, (cur) => ({ layout, focused: cur.focused === agentId ? firstCell(layout) : cur.focused }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    setLayout(wsId, layout, persist = true) {
      patch(wsId, () => ({ layout }))
      if (persist) window.stag.agent.saveLayout(wsId, layout)
    },

    setView(wsId, view) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = { ...w.layout, view }
      patch(wsId, () => ({ layout }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    focus(wsId, key) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = toFront(w.layout, key)
      if (w.focused === key && layout === w.layout) return
      patch(wsId, () => ({ focused: key, layout }))
      if (layout !== w.layout) window.stag.agent.saveLayout(wsId, layout)
    },

    openWidget(wsId, widget, place) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      // Mỗi widget chỉ một ô trong một workspace.
      if (findCell(w.layout, key)) {
        get().focus(wsId, key)
        return revealCell(wsId, key)
      }
      const layout = addCell(w.layout, { type: 'widget', widget }, 'widget', place ?? { near: w.focused })
      patch(wsId, () => ({ layout, focused: key }))
      window.stag.agent.saveLayout(wsId, layout)
      revealCell(wsId, key)
    },

    closeWidget(wsId, widget) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      const layout = removeCell(w.layout, key)
      patch(wsId, (cur) => ({ layout, focused: cur.focused === key ? firstCell(layout) : cur.focused }))
      window.stag.agent.saveLayout(wsId, layout)
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

/** Mở agent cho người dùng xem: chuyển workspace + tab Agents, hiện ô (nếu đã đóng) và đặt con trỏ vào terminal. */
export function openAgent(wsId: string, agentId: string): void {
  useWorkspaces.getState().setActive(wsId)
  useUi.getState().setTab('agents')
  useAgents.getState().show(wsId, agentId)
  setTimeout(() => focusTerminal(agentId), 0)
}
