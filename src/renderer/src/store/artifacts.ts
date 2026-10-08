import { create } from 'zustand'
import type { ArtifactEvent } from '@shared/types'

interface ArtifactsState {
  /** File agent tạo / sửa / xoá trong dự án, theo workspace (cũ trước, mới sau). */
  byWs: Record<string, ArtifactEvent[]>
  load: (wsId: string) => Promise<void>
}

export const useArtifacts = create<ArtifactsState>((set, get) => {
  // Main báo workspace nào vừa có output mới: chỉ tải lại workspace đã từng mở.
  window.stag.artifacts.onChanged((wsId) => {
    if (get().byWs[wsId]) get().load(wsId)
  })
  return {
    byWs: {},
    async load(wsId) {
      const list = await window.stag.artifacts.list(wsId)
      set((s) => ({ byWs: { ...s.byWs, [wsId]: list } }))
    }
  }
})
