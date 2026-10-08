import { create } from 'zustand'
import type { Agent, AgentRun, CreateAgentRequest, LayoutNode, SplitDir } from '@shared/types'
import { insertLeaf, reconcile, removeLeaf } from '../layout'
import { bindPty, disposeTerminal, onAgentExit, startTerminalBus, terminalSize } from '../terminals'

export interface WorkspaceAgents {
  agents: Agent[]
  layout: LayoutNode | null
  running: Record<string, AgentRun>
  /** Agent đang khởi động (chờ main tạo tiến trình). */
  starting: Record<string, boolean>
  /** Agent vừa tạo: ô sẽ tự mở phiên mới khi đã gắn terminal và biết kích thước. */
  autoStart: Record<string, boolean>
  errors: Record<string, string>
  focused: string | null
}

const empty = (): WorkspaceAgents => ({ agents: [], layout: null, running: {}, starting: {}, autoStart: {}, errors: {}, focused: null })

interface AgentsState {
  byWs: Record<string, WorkspaceAgents>
  load: (wsId: string) => Promise<void>
  create: (req: CreateAgentRequest, near: { agentId: string | null; dir: SplitDir }) => Promise<Agent>
  start: (wsId: string, agentId: string, resume: boolean) => Promise<void>
  stop: (agentId: string) => Promise<void>
  remove: (wsId: string, agentId: string) => Promise<void>
  setLayout: (wsId: string, layout: LayoutNode | null, persist?: boolean) => void
  focus: (wsId: string, agentId: string) => void
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
      patch(wsId, () => ({ agents: snap.agents, layout, running, focused: snap.agents[0]?.id ?? null }))
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
      patch(wsId, (cur) => ({
        agents: cur.agents.filter((a) => a.id !== agentId),
        layout,
        focused: cur.focused === agentId ? null : cur.focused
      }))
      window.stag.agent.saveLayout(wsId, layout)
    },

    setLayout(wsId, layout, persist = true) {
      patch(wsId, () => ({ layout }))
      if (persist) window.stag.agent.saveLayout(wsId, layout)
    },

    focus(wsId, agentId) {
      if (get().byWs[wsId]?.focused !== agentId) patch(wsId, () => ({ focused: agentId }))
    }
  }
})
