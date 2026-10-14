import { create } from 'zustand'
import type { SecretsList } from '@shared/types'
import { fetchThenListen } from './sync'

/** Tên các bí mật đã lưu (không có giá trị). Main báo lại mỗi khi thêm / đổi / xoá. */
export const useSecrets = create<SecretsList & { loaded: boolean }>((set) => {
  fetchThenListen(window.stag.secrets.list, window.stag.secrets.onChanged, (l) => set({ ...l, loaded: true }))
  return { available: true, items: [], loaded: false }
})
