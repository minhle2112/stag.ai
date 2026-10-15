import { useBoard } from '../store/board'
import { Button, Modal } from './Modal'
import { tx, useT } from '../i18n'

/**
 * Agent Codex sắp sửa file trong vùng khoá của việc agent khác: hỏi người dùng (hộp thoại đầu hàng đợi).
 * Claude Code tự hỏi trong terminal của nó nên không qua đây.
 */
export function ScopeAskDialog(): React.JSX.Element | null {
  const t = useT()
  const ask = useBoard((s) => Object.values(s.byWs).flatMap((b) => b.scopeAsks ?? [])[0])
  if (!ask) return null
  const answer = (allow: boolean): void => {
    void window.stag.board.answerScope(ask.id, allow)
  }
  const minutes = Math.max(1, Math.round((Date.parse(ask.until) - Date.now()) / 60_000))
  return (
    <Modal
      title={t('scope.title')}
      icon="lock"
      tone="wait"
      width="w-[470px]"
      footer={
        <>
          <Button variant="danger" onClick={() => answer(false)}>
            {t('common.deny')}
          </Button>
          <span className="flex-1" />
          <Button primary onClick={() => answer(true)}>
            {t('scope.ask.allow')}
          </Button>
        </>
      }
    >
      {ask.command ? (
        <>
          <p>{tx('scope.ask.wantsRun', { name: <b>{ask.agentName}</b>, file: <span className="font-mono text-[12px]">{ask.file}</span> })}</p>
          <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-panel-2 px-3 py-2 font-mono text-[12px]">{ask.command}</p>
        </>
      ) : (
        <>
          <p>{tx('scope.ask.wantsEdit', { name: <b>{ask.agentName}</b> })}</p>
          <p className="mt-2 break-all rounded-md bg-panel-2 px-3 py-2 font-mono text-[12px]">{ask.file}</p>
        </>
      )}
      <p className="mt-3">
        {tx(ask.command ? 'scope.ask.holderPlace' : 'scope.ask.holderFile', {
          title: <b>"{ask.holder.title}"</b>,
          holder: <b>{ask.holder.agentName}</b>,
          entry: <span className="font-mono text-[12px]">{ask.holder.entry}</span>
        })}
      </p>
      <p className="mt-3 text-[12px] text-muted">
        {t(ask.command ? 'scope.ask.notePlace' : 'scope.ask.noteFile', { name: ask.agentName, minutes })}
      </p>
    </Modal>
  )
}
