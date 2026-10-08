import { useBoard } from '../store/board'
import { Button, Modal } from './Modal'

/**
 * Agent Codex sắp sửa file trong vùng khoá của việc agent khác: hỏi người dùng (hộp thoại đầu hàng đợi).
 * Claude Code tự hỏi trong terminal của nó nên không qua đây.
 */
export function ScopeAskDialog(): React.JSX.Element | null {
  const ask = useBoard((s) => Object.values(s.byWs).flatMap((b) => b.scopeAsks ?? [])[0])
  if (!ask) return null
  const answer = (allow: boolean): void => {
    void window.stag.board.answerScope(ask.id, allow)
  }
  const minutes = Math.max(1, Math.round((Date.parse(ask.until) - Date.now()) / 60_000))
  return (
    <Modal
      title="Hai agent đụng cùng một chỗ"
      footer={
        <>
          <Button onClick={() => answer(false)}>Từ chối</Button>
          <Button primary onClick={() => answer(true)}>
            Cho sửa
          </Button>
        </>
      }
    >
      {ask.command ? (
        <>
          <p>
            Agent <b>{ask.agentName}</b> muốn chạy lệnh có thể sửa <span className="font-mono text-[12px]">{ask.file}</span>:
          </p>
          <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-panel-2 px-3 py-2 font-mono text-[12px]">{ask.command}</p>
        </>
      ) : (
        <>
          <p>
            Agent <b>{ask.agentName}</b> muốn sửa:
          </p>
          <p className="mt-2 break-all rounded-md bg-panel-2 px-3 py-2 font-mono text-[12px]">{ask.file}</p>
        </>
      )}
      <p className="mt-3">
        {ask.command ? 'Chỗ đó' : 'File này'} thuộc việc <b>"{ask.holder.title}"</b> của agent <b>{ask.holder.agentName}</b> (phạm vi{' '}
        <span className="font-mono text-[12px]">{ask.holder.entry}</span>), việc đó chưa xong.
      </p>
      <p className="mt-3 text-[12px] text-muted">
        Cho sửa thì {ask.agentName} sửa được {ask.command ? 'chỗ đó' : 'file này'} tới hết phiên mà không hỏi lại. Lệnh shell được đoán theo chữ trong lệnh, có thể báo thừa. Agent đang chờ bạn trả lời (tự từ chối sau khoảng {minutes} phút).
      </p>
    </Modal>
  )
}
