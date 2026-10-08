import { create } from 'zustand'
import type { BrowserPermissionAsk, BrowserState } from '@shared/types'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

interface BrowserStore {
  byWs: Record<string, BrowserState>
  /** Agent đang xin mở trang ngoài, chờ người dùng trả lời. */
  asks: BrowserPermissionAsk[]
  load: (wsId: string) => Promise<void>
  answer: (askId: string, allow: boolean) => Promise<void>
}

export const useBrowser = create<BrowserStore>((set, get) => {
  window.stag.browser.onChanged((wsId, state) => set((s) => ({ byWs: { ...s.byWs, [wsId]: state } })))
  // Agent vừa mở trang trong workspace đang xem → mở pane để người dùng thấy.
  window.stag.browser.onReveal((wsId) => {
    if (useWorkspaces.getState().activeId === wsId) useUi.getState().setBrowserOpen(true)
  })
  window.stag.browser.onAsk((ask) => set((s) => ({ asks: [...s.asks, ask] })))

  return {
    byWs: {},
    asks: [],

    async load(wsId) {
      const state = await window.stag.browser.state(wsId)
      set((s) => ({ byWs: { ...s.byWs, [wsId]: state } }))
    },

    async answer(askId, allow) {
      set({ asks: get().asks.filter((a) => a.id !== askId) })
      await window.stag.browser.answer(askId, allow)
    }
  }
})
