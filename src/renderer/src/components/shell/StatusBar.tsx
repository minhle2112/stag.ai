import { useState } from 'react'
import { scopeLocks } from '@shared/scope'
import { useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { useUi } from '../../store/ui'
import { useActiveWorkspace } from '../../store/workspaces'
import { Icon } from '../Icon'
import { PluginStatusItems } from '../PluginStatusBar'
import { useWaitingAgents } from './useWaiting'

/** Thanh trạng thái dưới cùng (cao 24px): khoá phạm vi đang giữ, mục của plugin, số agent đang chạy / chờ bạn. */
export function StatusBar(): React.JSX.Element {
  const ws = useActiveWorkspace()
  const board = useBoard((s) => (ws ? s.byWs[ws.id] : undefined))
  const agents = useAgents((s) => (ws ? s.byWs[ws.id] : undefined))
  const openSettings = useUi((s) => s.openSettings)
  const waiting = useWaitingAgents().filter((w) => w.wsId === ws?.id).length
  const locks = board && ws ? scopeLocks(board.tasks, ws.path).filter((l) => l.entries.length > 0) : []
  const running = agents ? Object.keys(agents.running).length : 0
  const total = agents?.agents.length ?? 0
  const [lockOpen, setLockOpen] = useState(false)

  return (
    <footer className="relative flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-t border-line bg-bg0 px-1.5 text-[12px] whitespace-nowrap text-muted">
      {ws && (
        <span className="flex h-[22px] items-center gap-1.5 px-2" data-tip={`${total} agent · ${running} đang chạy · ${waiting} chờ bạn`}>
          <span className={`sdot ${waiting ? 'wa' : running ? 'ok' : 'off'}`} />
          {running}/{total}
          {waiting > 0 && <span className="text-wait">· {waiting} chờ bạn</span>}
        </span>
      )}
      {locks.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setLockOpen((v) => !v)}
            data-tip={`${locks.length} khoá phạm vi đang giữ`}
            className="flex h-[22px] items-center gap-1.5 rounded px-2 hover:bg-panel-2 hover:text-fg"
          >
            <Icon name="lock" size="s" />
            {locks.length}
          </button>
          {lockOpen && (
            <>
              <div className="fixed inset-0 z-40" onMouseDown={() => setLockOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-1 w-80 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[12px] shadow-[0_14px_40px_rgba(0,0,0,.6)]">
                <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.07em] text-dim">KHOÁ PHẠM VI ĐANG GIỮ</div>
                {locks.map((l) => {
                  const a = agents?.agents.find((x) => x.id === l.task.agentId)
                  return (
                    <div key={l.task.id} className="flex items-center gap-2 px-2.5 py-1.5">
                      <span className="shrink-0 font-medium text-fg">{a?.name ?? 'agent'}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">{l.entries.map((e) => e.label || '(cả dự án)').join(', ')}</span>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => {
                    setLockOpen(false)
                    openSettings('scope')
                  }}
                  className="mt-1 block w-full rounded-md px-2.5 py-1.5 text-left text-muted hover:bg-panel-3 hover:text-fg"
                >
                  Cài đặt Khoá phạm vi…
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <PluginStatusItems />
      <span className="flex-1" />
    </footer>
  )
}
