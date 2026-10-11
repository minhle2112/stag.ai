import { create } from 'zustand'
import type { CreateWorkspaceResult, WorkspaceInspection } from '@shared/types'
import { useWorkspaces } from './workspaces'

/** Luồng "Workspace mới": chọn thư mục → xem trước → tạo → báo cáo. Hộp thoại vẽ ở `WorkspaceFlowDialogs`. */
interface FlowState {
  inspection: WorkspaceInspection | null
  report: CreateWorkspaceResult | null
  setInspection: (i: WorkspaceInspection | null) => void
  setReport: (r: CreateWorkspaceResult | null) => void
}

export const useWorkspaceFlow = create<FlowState>((set) => ({
  inspection: null,
  report: null,
  setInspection: (inspection) => set({ inspection }),
  setReport: (report) => set({ report })
}))

/** Mở hộp chọn thư mục rồi vào luồng tạo workspace; thư mục đã là workspace thì chuyển tới nó. */
export async function startNewWorkspace(): Promise<void> {
  const path = await window.stag.workspace.pick()
  if (!path) return
  const info = await window.stag.workspace.inspect(path)
  if (info.existing) {
    useWorkspaces.getState().setActive(info.existing.id)
    return
  }
  useWorkspaceFlow.getState().setInspection(info)
}
