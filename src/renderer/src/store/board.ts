import { create } from 'zustand'
import type { BoardSnapshot } from '@shared/types'
import { latestWins } from './sync'

interface BoardState {
  byWs: Record<string, BoardSnapshot>
  load: (wsId: string) => Promise<void>
  completeTask: (wsId: string, taskId: string) => Promise<void>
  dropTask: (wsId: string, taskId: string) => Promise<void>
}

export const useBoard = create<BoardState>((set, get) => {
  const latest = latestWins()
  // Main báo workspace nào vừa đổi: chỉ tải lại bảng đã từng mở.
  window.stag.board.onChanged((wsId) => {
    if (get().byWs[wsId]) get().load(wsId)
  })

  return {
    byWs: {},

    async load(wsId) {
      const fresh = latest.begin(wsId)
      const snap = await window.stag.board.snapshot(wsId)
      // Lần tải sau đã gọi (main vừa báo đổi tiếp): bỏ bản này để không đè bản mới hơn.
      if (!fresh()) return
      set((s) => ({ byWs: { ...s.byWs, [wsId]: snap } }))
    },

    async completeTask(wsId, taskId) {
      await window.stag.board.completeTask(wsId, taskId)
    },

    async dropTask(wsId, taskId) {
      await window.stag.board.dropTask(wsId, taskId)
    }
  }
})
