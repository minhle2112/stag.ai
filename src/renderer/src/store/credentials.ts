import { create } from 'zustand'
import type { CredentialNotice, CredentialsState } from '@shared/credentials'
import { fetchThenListen } from './sync'

/** Kho mật khẩu (không có mật khẩu / khoá 2FA). Main báo lại mỗi khi đổi. */
export const useCredentials = create<CredentialsState & { loaded: boolean }>((set) => {
  fetchThenListen(window.stag.credentials.list, window.stag.credentials.onChanged, (s) => set({ ...s, loaded: true }))
  return { available: true, items: [], never: [], loaded: false }
})

/** Agent vừa bị chặn điền mật khẩu (tên miền không khớp): toast góc dưới trái. */
export const useCredentialNotices = create<{ list: CredentialNotice[]; dismiss: (n: CredentialNotice) => void }>((set) => {
  window.stag.credentials.onNotice((n) => {
    set((s) => ({ list: [...s.list.slice(-2), n] }))
    setTimeout(() => set((s) => ({ list: s.list.filter((x) => x !== n) })), 60_000)
  })
  return { list: [], dismiss: (n) => set((s) => ({ list: s.list.filter((x) => x !== n) })) }
})
