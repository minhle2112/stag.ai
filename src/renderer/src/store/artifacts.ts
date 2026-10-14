import { create } from 'zustand'
import type { ArtifactsSnapshot } from '@shared/artifacts'
import { latestWins } from './sync'

interface ProductsState {
  /** Sản phẩm agent nộp (tab Sản phẩm), theo workspace. */
  byWs: Record<string, ArtifactsSnapshot>
  load: (wsId: string) => Promise<void>
}

export const useProducts = create<ProductsState>((set, get) => {
  const latest = latestWins()
  // Main báo workspace nào vừa đổi (agent nộp / trả lời, góp ý được gửi…): chỉ tải lại workspace đã từng mở.
  window.stag.products.onChanged((wsId) => {
    if (get().byWs[wsId]) void get().load(wsId)
  })
  return {
    byWs: {},
    async load(wsId) {
      const fresh = latest.begin(wsId)
      const snap = await window.stag.products.list(wsId)
      // Lần tải sau đã gọi (main vừa báo đổi tiếp): bỏ bản này để không đè bản mới hơn.
      if (!fresh()) return
      set((s) => ({ byWs: { ...s.byWs, [wsId]: snap } }))
    }
  }
})
