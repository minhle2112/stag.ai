import { create } from 'zustand'
import type { ToolApproval } from '@shared/types'
import { fetchThenListen } from './sync'

/** Lần gọi tool connector đang chờ người dùng duyệt (main báo mỗi khi đổi). */
export const useApprovals = create<{ items: ToolApproval[] }>((set) => {
  fetchThenListen(window.stag.approvals.list, window.stag.approvals.onChanged, (items) => set({ items }))
  return { items: [] }
})
