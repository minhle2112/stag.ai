import { create } from 'zustand'
import type { Agent, AgentRun, CreateAgentRequest, LayoutNode, SplitDir } from '@shared/types'
import { cells, insertCell, insertLeaf, leaves, reconcile, removeLeaf, swapLeaves, widgetKey, widgets } from '../layout'
import { bindPty, disposeTerminal, focusTerminal, onAgentExit, startTerminalBus, terminalSize } from '../terminals'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

export interface WorkspaceAgents {
  agents: Agent[]
  layout: LayoutNode | null
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
const firstCell = (layout: LayoutNode | null): string | null => leaves(layout)[0] ?? cells(layout)[0] ?? null

const empty = (): WorkspaceAgents => ({ agents: [], layout: null, running: {}, starting: {}, autoStart: {}, errors: {}, focused: null })

interface AgentsState {
  byWs: Record<string, WorkspaceAgents>
  load: (wsId: string) => Promise<void>
  create: (req: CreateAgentRequest, near: { agentId: string | null; dir: SplitDir }) => Promise<Agent>
  start: (wsId: string, agentId: string, resume: boolean) => Promise<void>
  stop: (agentId: string) => Promise<void>
  remove: (wsId: string, agentId: string) => Promise<void>
  /** Hiện ô của agent trong lưới (thêm cạnh ô đang chọn nếu đã đóng) và chọn nó. */
  show: (wsId: string, agentId: string) => void
  /** Đóng ô của agent. Phiên (nếu có) vẫn chạy; agent vẫn ở thanh bên. */
  hide: (wsId: string, agentId: string) => void
  setLayout: (wsId: string, layout: LayoutNode | null, persist?: boolean) => void
  /** Chọn ô (mã ô: id agent hoặc widgetKey). */
  focus: (wsId: string, key: string) => void
  /** Mở widget plugin ("<id plugin>/<id slot>") cạnh ô đang chọn; đã mở thì chọn ô đó. */
  openWidget: (wsId: string, widget: string) => void
  /** Đóng ô widget (chỉ bỏ ô khỏi lưới). */
  closeWidget: (wsId: string, widget: string) => void
  /** Đổi tên agent (main đổi tên luôn note bộ nhớ trong vault). Lỗi thì ném ra để hộp thoại hiện. */
  rename: (wsId: string, agentId: string, name: string) => Promise<void>
  /** Chuyển agent tới vị trí `index` trong danh sách của workspace (thanh bên). */
  moveAgent: (wsId: string, agentId: string, index: number) => void
  /** Đổi chỗ hai ô trong lưới (theo mã ô). */
  swapCells: (wsId: string, x: string, y: string) => void
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
    const layout = insertLeaf(w.layout, nearAgentId, agent.id, 'row')
    patch(wsId, (cur) => ({ agents, layout, autoStart: { ...cur.autoStart, [agent.id]: true } }))
    window.stag.agent.saveLayout(wsId, layout)
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
        bindPty(r.agentId, r.ptyId)
      }
      const layout = reconcile(snap.layout, snap.agents.map((a) => a.id))
      patch(wsId, () => ({ agents: snap.agents, layout, running, focused: firstCell(layout) }))
      if (JSON.stringify(layout) !== JSON.stringify(snap.layout)) window.stag.agent.saveLayout(wsId, layout)
    },

    async create(req, near) {
      const agent = await window.stag.agent.create(req)
      const wsId = req.workspaceId
      const layout = insertLeaf(get().byWs[wsId]?.layout ?? null, near.agentId, agent.id, near.dir)
      patch(wsId, (cur) => ({
        agents: [...cur.agents, agent],
        layout,
        autoStart: { ...cur.autoStart, [agent.id]: true },
        focused: agent.id
      }))
      window.stag.agent.saveLayout(wsId, layout)
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
        bindPty(agentId, run.ptyId)
        patch(wsId, (cur) => ({
          running: { ...cur.running, [agentId]: run },
          agents: cur.agents.map((a) => (a.id === agentId ? { ...a, lastSessionId: run.sessionId } : a))
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

    async stop(agentId) {
      await window.stag.agent.stop(agentId)
    },

    async remove(wsId, agentId) {
      await window.stag.agent.remove(agentId)
      disposeTerminal(agentId)
      const layout = removeLeaf(get().byWs[wsId]?.layout ?? null, agentId)
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
      if (leaves(w.layout).includes(agentId)) return get().focus(wsId, agentId)
      const layout = insertLeaf(w.layout, w.focused, agentId, 'row')
      patch(wsId, () => ({ layout, focused: agentId }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    hide(wsId, agentId) {
      const w = get().byWs[wsId]
      if (!w) return
      const layout = removeLeaf(w.layout, agentId)
      patch(wsId, (cur) => ({ layout, focused: cur.focused === agentId ? firstCell(layout) : cur.focused }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    setLayout(wsId, layout, persist = true) {
      patch(wsId, () => ({ layout }))
      if (persist) window.stag.agent.saveLayout(wsId, layout)
    },

    focus(wsId, key) {
      if (get().byWs[wsId]?.focused !== key) patch(wsId, () => ({ focused: key }))
    },

    openWidget(wsId, widget) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      // Mỗi widget chỉ một ô trong một workspace.
      if (widgets(w.layout).includes(widget)) return get().focus(wsId, key)
      const layout = insertCell(w.layout, w.focused, { type: 'widget', widget }, 'row')
      patch(wsId, () => ({ layout, focused: key }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    closeWidget(wsId, widget) {
      const w = get().byWs[wsId]
      if (!w) return
      const key = widgetKey(widget)
      const layout = removeLeaf(w.layout, key)
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
    },

    swapCells(wsId, x, y) {
      const w = get().byWs[wsId]
      if (!w || x === y || !cells(w.layout).includes(x) || !cells(w.layout).includes(y)) return
      get().setLayout(wsId, swapLeaves(w.layout, x, y))
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
