import { useWorkspaceFlow } from '../../store/workspaceFlow'
import { useWorkspaces } from '../../store/workspaces'
import { CreateReport, CreateWorkspaceDialog } from '../CreateWorkspaceDialog'

/** Hộp thoại của luồng "Workspace mới" (mở được từ thanh bên, bảng lệnh, hoặc màn hình trống). */
export function WorkspaceFlowDialogs(): React.JSX.Element | null {
  const { inspection, report, setInspection, setReport } = useWorkspaceFlow()
  const add = useWorkspaces((s) => s.add)
  return (
    <>
      {inspection && (
        <CreateWorkspaceDialog
          inspection={inspection}
          onClose={() => setInspection(null)}
          onCreated={(r) => {
            add(r.workspace)
            setInspection(null)
            setReport(r)
          }}
        />
      )}
      {report && <CreateReport result={report} onClose={() => setReport(null)} />}
    </>
  )
}
