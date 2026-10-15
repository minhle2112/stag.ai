import { useEffect, useMemo, useRef } from 'react'
import { resolveModel } from '@shared/settings'
import { agentKind, type Agent, type Workspace } from '@shared/types'
import { useChat } from '../../store/chat'
import { useHandoffFor, useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { Button } from '../Modal'
import { ChatList } from './ChatList'
import { Composer } from './Composer'
import { chatZoom, DEFAULT_CTX_LIMIT, EMPTY_ITEMS, firstPendingAsk, OFF_STATE } from './chatLogic'
import { useT } from '../../i18n'

export interface ChatCellProps {
  ws: Workspace
  agent: Agent
  /** Agent có phiên đang chạy. */
  running: boolean
  starting: boolean
  /** Lỗi mở phiên. */
  error?: string
  /** Nút "Phiên mới" / "Tiếp tục phiên trước". */
  onStart: (resume: boolean) => void
}

const EMPTY_QUEUE: string[] = []

function Spinner(): React.JSX.Element {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
}

/**
 * Thân ô chat của một agent Claude Code: hội thoại vẽ từ dữ liệu có cấu trúc (thay cho TUI trong xterm) + ô soạn tin.
 * Chiếm `absolute inset-0` trong vùng thân ô (dưới tiêu đề do AgentGrid vẽ).
 */
export function ChatCell({ ws, agent, running, starting, error, onStart }: ChatCellProps): React.JSX.Element {
  const t = useT()
  const slice = useChat((s) => s.byAgent[agent.id])
  const ensure = useChat((s) => s.ensure)
  const handoff = useHandoffFor(agent.id)
  const settings = useSettings((s) => s.value)
  const zoom = chatZoom(settings.app.general.terminalFontSize)
  const openSettings = useUi((s) => s.openSettings)
  const kind = agentKind(agent) === 'codex' ? 'codex' : 'claude'
  // Model / effort theo cài đặt (app → workspace → agent); phiên đang chạy báo model thật qua state.model.
  const cfg = useMemo(() => resolveModel(settings, kind, ws.id, agent.id), [settings, kind, ws.id, agent.id])
  const focusRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    ensure(agent.id)
  }, [agent.id, ensure])

  const items = slice?.items ?? EMPTY_ITEMS
  const state = slice?.state ?? OFF_STATE
  const stopped = !running && !starting
  const pending = useMemo(() => firstPendingAsk(items), [items])
  // Ngưỡng đỏ của thanh context: ngưỡng tự bàn giao nếu đang bật, không thì 85%.
  const ctxLimit = handoff.autoHandoff ? handoff.handoffPercent : DEFAULT_CTX_LIMIT
  const booting = starting || (running && state.phase === 'starting')
  const empty = items.length === 0

  return (
    // Cỡ chữ (Cài đặt → Chung) phóng cả ô chat bằng `zoom`: chữ, khoảng cách và biểu tượng giữ đúng tỉ lệ; ô hẹp
    // tương đối hơn nên các mốc @container (ẩn chip, thu gọn) cũng đổi theo.
    <div className="@container/chat absolute inset-0 flex min-h-0 flex-col bg-panel text-[13px]" style={zoom === 1 ? undefined : { zoom }}>
      {empty ? (
        <div className="relative min-h-0 flex-1">
          {!stopped && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center text-dim">
              {booting ? (
                <>
                  <Spinner />
                  <div>{t('chat.starting')}</div>
                </>
              ) : (
                <>
                  <Icon name="chat" size={22} />
                  <div className="min-w-0 break-words">{t('chat.emptyHint', { name: agent.name })}</div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <ChatList
          items={items}
          phase={state.phase}
          agentId={agent.id}
          agentName={agent.name}
          wsId={ws.id}
          root={ws.path}
          primaryAsk={pending?.requestId ?? null}
          onBlankClick={() => focusRef.current?.()}
        />
      )}

      {/* Có lịch sử mà phiên đã dừng: thanh nhỏ phía trên ô soạn tin (ô soạn tin bị vô hiệu). */}
      {stopped && !empty && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel-2 px-3 py-2">
          {error ? (
            <div className="min-w-0 flex-1 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-danger">{error}</div>
          ) : (
            <span className="min-w-0 flex-1 text-dim @max-[420px]/chat:basis-full">{t('agents.grid.sessionStopped')}</span>
          )}
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <Button primary onClick={() => onStart(false)}>
              {t('agents.menu.newSession')}
            </Button>
            {agent.lastSessionId && <Button onClick={() => onStart(true)}>{t('agents.menu.resume')}</Button>}
          </div>
        </div>
      )}
      {starting && !empty && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-2 px-3 py-1.5 text-[12px] text-dim">
          <Spinner />
          {t('chat.starting')}
        </div>
      )}

      {!(stopped && empty) && (
        <Composer
          agentId={agent.id}
          agentName={agent.name}
          wsId={ws.id}
          modelHint={cfg.model}
          effort={cfg.effort}
          onModel={() => openSettings('adapters', { adapter: kind, agentId: agent.id })}
          enabled={running}
          state={state}
          pending={pending}
          queued={slice?.queued ?? EMPTY_QUEUE}
          error={slice?.error}
          ctxLimit={ctxLimit}
          offLabel={starting ? t('chat.starting') : undefined}
          focusRef={focusRef}
        />
      )}

      {/* Chưa có phiên và chưa có lịch sử: giống ô terminal — lời nhắc ở giữa + Phiên mới / Tiếp tục. */}
      {stopped && empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-panel px-4">
          {error ? (
            <div className="max-w-md rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-center text-danger">{error}</div>
          ) : (
            <div className="text-dim">{t('agents.grid.sessionStopped')}</div>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button primary onClick={() => onStart(false)}>
              {t('agents.menu.newSession')}
            </Button>
            {agent.lastSessionId && <Button onClick={() => onStart(true)}>{t('agents.menu.resume')}</Button>}
          </div>
        </div>
      )}
    </div>
  )
}
