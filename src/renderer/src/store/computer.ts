import { create } from 'zustand'
import type { ComputerState } from '@shared/computer'

/** Trạng thái computer use (main giữ, xem src/main/computer/service.ts): ô Máy tính, chấm thanh tiêu đề, thẻ hỏi. */
export const useComputer = create<{ state: ComputerState | null }>(() => ({ state: null }))

let started = false

/** Nghe main báo đổi trạng thái (một lần cho cả app). */
export function startComputerBus(): void {
  if (started) return
  started = true
  void window.stag.computer
    .state()
    .then((state) => useComputer.setState({ state }))
    .catch(() => {})
  window.stag.computer.onState((state) => useComputer.setState({ state }))
}

/** Bảng chọn cửa sổ cho ô CLI (Ctrl+Shift+2): agent nào đang mở bảng. */
export const useWindowPicker = create<{ agentId: string | null; open: (agentId: string) => void; close: () => void }>((set) => ({
  agentId: null,
  open: (agentId) => set({ agentId }),
  close: () => set({ agentId: null })
}))
