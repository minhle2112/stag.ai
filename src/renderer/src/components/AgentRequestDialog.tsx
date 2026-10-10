import type { ReactNode } from 'react'
import { useAgentRequests } from '../store/agentRequests'
import { useWorkspaces } from '../store/workspaces'
import { permissionModes } from '../permissionModes'
import { Button, Modal } from './Modal'

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <>
      <div className="text-muted">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </>
  )
}

/**
 * Agent xin làm thay bạn một việc trên app (Agent API, vd. tạo agent mới): hỏi bạn trước (hộp thoại đầu hàng đợi).
 * Agent đang chờ câu trả lời; hết hạn thì main tự từ chối.
 */
export function AgentRequestDialog(): React.JSX.Element | null {
  const req = useAgentRequests((s) => s.list[0])
  const answer = useAgentRequests((s) => s.answer)
  const wsName = useWorkspaces((s) => s.items.find((w) => w.id === req?.workspaceId)?.name)
  if (!req) return null
  const d = req.create
  const minutes = Math.max(1, Math.round((Date.parse(req.until) - Date.now()) / 60_000))
  const perm = permissionModes(d.kind).find((p) => p.id === d.permissionMode)
  const cli = d.kind === 'claude' || d.kind === 'codex'
  return (
    <Modal
      title="Agent muốn tạo agent mới"
      width="w-[600px]"
      footer={
        <>
          <Button onClick={() => answer(req.id, false)}>Từ chối</Button>
          <Button primary onClick={() => answer(req.id, true)}>
            Tạo agent
          </Button>
        </>
      }
    >
      <p>
        Agent <b>{req.fromName}</b> muốn tạo {d.kind === 'terminal' ? 'một ô terminal' : 'một agent'} mới
        {wsName ? (
          <>
            {' '}
            trong workspace <b>{wsName}</b>
          </>
        ) : null}
        :
      </p>
      <div className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 rounded-md bg-panel-2 px-3 py-2.5 text-[13px]">
        <Row label="Tên">
          <b>{d.name}</b>
        </Row>
        <Row label="Loại">{d.kindLabel}</Row>
        {cli && <Row label="Model">{d.model ?? <span className="text-muted">mặc định</span>}</Row>}
        {cli && <Row label="Mức suy nghĩ">{d.effort ?? <span className="text-muted">mặc định</span>}</Row>}
        {cli && (
          <Row label="Quyền">
            <span className={d.permissionMode === 'auto' ? 'font-semibold text-amber-300' : ''}>{perm?.label ?? d.permissionMode}</span>
            {perm && <div className="text-[12px] text-muted">{perm.hint}</div>}
          </Row>
        )}
        {d.kind !== 'terminal' && <Row label="Vai trò">{d.role || <span className="text-muted">(không có)</span>}</Row>}
        {d.kind !== 'terminal' && (
          <Row label="Việc đầu tiên">
            {d.task ? (
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap">{d.task}</div>
            ) : (
              <span className="text-muted">(không có — agent mới chào và hỏi bạn)</span>
            )}
          </Row>
        )}
        <Row label="Mở ngay">{d.open ? 'Có — thêm ô cạnh ô của ' + req.fromName + ' và chạy phiên' : 'Không — chỉ thêm vào danh sách agent'}</Row>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        Chỉ đồng ý nếu chính bạn đã nhờ {req.fromName} làm việc này. {req.fromName} đang chờ bạn trả lời (tự từ chối sau khoảng {minutes} phút).
      </p>
    </Modal>
  )
}
