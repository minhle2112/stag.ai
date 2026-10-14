import { create } from 'zustand'
import type { VaultActivity } from '@shared/types'
import { latestWins } from './sync'

interface VaultActivityState {
  /** Nhật ký agent đọc / ghi note, theo workspace (cũ trước, mới sau). */
  byWs: Record<string, VaultActivity[]>
  load: (wsId: string) => Promise<void>
}

export const useVaultActivity = create<VaultActivityState>((set, get) => {
  const latest = latestWins()
  // Main báo workspace nào vừa có hoạt động: chỉ tải lại workspace đã từng mở.
  window.stag.vault.onActivity((wsId) => {
    if (get().byWs[wsId]) get().load(wsId)
  })
  return {
    byWs: {},
    async load(wsId) {
      const fresh = latest.begin(wsId)
      const list = await window.stag.vault.activity(wsId)
      // Lần tải sau đã gọi: bỏ bản này để không đè bản mới hơn.
      if (!fresh()) return
      set((s) => ({ byWs: { ...s.byWs, [wsId]: list } }))
    }
  }
})
