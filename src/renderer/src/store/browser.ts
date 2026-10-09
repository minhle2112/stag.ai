import { create } from 'zustand'
import type { BrowserPermissionAsk, BrowserState } from '@shared/types'
import { useSettings } from './settings'
import { useUi } from './ui'
import { useWorkspaces } from './workspaces'

/** Độ rộng mặc định của pane: tỉ lệ so với vùng nội dung (bên phải thanh bên). */
export const PANE_DEFAULT = 0.42
const WIDTH_KEY = 'stag.browserWidth'

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return v > 0 && v < 1 ? v : PANE_DEFAULT
  } catch {
    return PANE_DEFAULT
  }
}

function writeWidth(ratio: number | null): void {
  try {
    if (ratio === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(ratio))
  } catch {
    // Không lưu được thì lần sau về mặc định, không sao.
  }
}

interface BrowserStore {
  byWs: Record<string, BrowserState>
  /** Agent đang xin mở trang ngoài, chờ người dùng trả lời. */
  asks: BrowserPermissionAsk[]
  /** Độ rộng pane (tỉ lệ 0–1 của vùng nội dung). Giới hạn px áp ở `BrowserDock`. */
  width: number
  /** Đang kéo đổi độ rộng: ẩn view trang để nó không nuốt sự kiện chuột. */
  resizing: boolean
  load: (wsId: string) => Promise<void>
  answer: (askId: string, allow: boolean) => Promise<void>
  /** "Luôn cho trang này": thêm origin vào Cài đặt → Trình duyệt → Trang luôn cho phép, rồi cho phép. */
  allowAlways: (ask: BrowserPermissionAsk) => Promise<void>
  /** `save` = ghi lại cho lần mở sau (chỉ khi thả chuột, không ghi mỗi khung hình). */
  setWidth: (ratio: number, save?: boolean) => void
  resetWidth: () => void
  setResizing: (resizing: boolean) => void
}

export const useBrowser = create<BrowserStore>((set, get) => {
  window.stag.browser.onChanged((wsId, state) => set((s) => ({ byWs: { ...s.byWs, [wsId]: state } })))
  // Agent vừa mở trang trong workspace đang xem → mở pane để người dùng thấy.
  window.stag.browser.onReveal((wsId) => {
    if (useWorkspaces.getState().activeId === wsId) useUi.getState().setBrowserOpen(true)
  })
  window.stag.browser.onAsk((ask) => set((s) => ({ asks: [...s.asks, ask] })))
  // App tự trả lời (hết giờ, Cài đặt đổi, xoá workspace) → bỏ hộp thoại.
  window.stag.browser.onAskClosed((id) => set((s) => ({ asks: s.asks.filter((a) => a.id !== id) })))

  return {
    byWs: {},
    asks: [],
    width: readWidth(),
    resizing: false,

    async load(wsId) {
      const state = await window.stag.browser.state(wsId)
      set((s) => ({ byWs: { ...s.byWs, [wsId]: state } }))
    },

    async answer(askId, allow) {
      set({ asks: get().asks.filter((a) => a.id !== askId) })
      await window.stag.browser.answer(askId, allow)
    },

    async allowAlways(ask) {
      set({ asks: get().asks.filter((a) => a.id !== ask.id) })
      // Lưu Cài đặt trước: main trả lời luôn mọi câu hỏi đang chờ cho cùng origin (cả câu hỏi này).
      const cur = useSettings.getState().value.app.browser.allowedOrigins
      try {
        if (!cur.includes(ask.origin)) await useSettings.getState().save({ browser: { allowedOrigins: [...cur, ask.origin] } })
      } finally {
        await window.stag.browser.answer(ask.id, true)
      }
    },

    setWidth(ratio, save = false) {
      set({ width: ratio })
      if (save) writeWidth(ratio)
    },

    resetWidth() {
      set({ width: PANE_DEFAULT })
      writeWidth(null)
    },

    setResizing: (resizing) => set({ resizing })
  }
})
