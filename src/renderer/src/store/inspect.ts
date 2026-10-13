import { create } from 'zustand'
import type { InspectAction, InspectSnapshot } from '@shared/inspect'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

interface InspectStore {
  byWs: Record<string, InspectSnapshot>
  /** Ngăn Bình luận bên phải ô Browser, theo workspace; vắng = chưa bấm tay (tự mở khi trang có bình luận). */
  side: Record<string, boolean>
  /** Mạch đang sáng (bấm ghim trên trang). */
  highlight: { wsId: string; id: number; at: number } | null
  /** Chữ đang gõ trong ô "Trả lời…" của từng mạch ("<ws>:<id>"): giữ khi ngăn vẽ lại. */
  replies: Record<string, string>
  load: (wsId: string) => Promise<void>
  act: (wsId: string, action: InspectAction) => Promise<unknown>
  setSide: (wsId: string, open: boolean) => void
  setReply: (key: string, text: string) => void
  focus: (wsId: string, id: number) => void
}

export const useInspect = create<InspectStore>((set, get) => {
  window.stag.inspect.onChanged((wsId) => void get().load(wsId))
  // Bấm ghim trên trang: mở ngăn, sáng mạch, đánh dấu đã xem.
  window.stag.inspect.onFocus((wsId, _tabId, id) => {
    if (useWorkspaces.getState().activeId === wsId) useUi.getState().setBrowserOpen(true)
    get().focus(wsId, id)
    void get().act(wsId, { type: 'read', id })
  })

  return {
    byWs: {},
    side: {},
    highlight: null,
    replies: {},

    async load(wsId) {
      const snap = await window.stag.inspect.snapshot(wsId)
      set((s) => ({ byWs: { ...s.byWs, [wsId]: snap } }))
    },

    act: (wsId, action) => window.stag.inspect.act(wsId, action),

    setSide: (wsId, open) => set((s) => ({ side: { ...s.side, [wsId]: open } })),

    setReply: (key, text) => set((s) => ({ replies: { ...s.replies, [key]: text } })),

    focus(wsId, id) {
      set((s) => ({ side: { ...s.side, [wsId]: true }, highlight: { wsId, id, at: Date.now() } }))
    }
  }
})
