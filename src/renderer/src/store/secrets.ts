import { create } from 'zustand'
import type { SecretsList } from '@shared/types'

/** Tên các bí mật đã lưu (không có giá trị). Main báo lại mỗi khi thêm / đổi / xoá. */
export const useSecrets = create<SecretsList & { loaded: boolean }>((set) => {
  window.stag.secrets.list().then((l) => set({ ...l, loaded: true }))
  window.stag.secrets.onChanged((l) => set({ ...l, loaded: true }))
  return { available: true, items: [], loaded: false }
})
