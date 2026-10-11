import { useEffect, useRef } from 'react'
import { isHotkeyDown, isHotkeyUp, VOICE_HOTKEYS } from '@shared/voice'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { beginVoice, cancelVoice, endVoice, insertVoice, undoAiFix, useVoice, useVoiceFor, voiceTargetFor } from '../store/voice'
import { useWorkspaces } from '../store/workspaces'
import { Icon } from './Icon'

/**
 * Phím tắt nói (giữ để nói, thả để dừng) cho cả app + thông báo khi không có ô đích. Bắt ở pha capture để terminal
 * đang focus không nhận Ctrl+Space (xterm gửi NUL cho chương trình).
 */
export function VoiceHotkeys(): React.JSX.Element | null {
  const phase = useVoice((s) => s.phase)
  const target = useVoice((s) => s.target)
  const error = useVoice((s) => s.error)

  useEffect(() => {
    let holding = false
    const onDown = (e: KeyboardEvent): void => {
      const v = useVoice.getState()
      if (e.key === 'Escape' && (v.phase === 'opening' || v.phase === 'listening' || v.phase === 'processing')) {
        e.preventDefault()
        e.stopPropagation()
        holding = false
        cancelVoice()
        return
      }
      const vs = useSettings.getState().value.app.voice
      if (!vs.enabled || !isHotkeyDown(e, vs.hotkey)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat || holding) return
      const ui = useUi.getState()
      // Trang Cài đặt / hộp thoại đang mở: không có ô đích.
      if (ui.settings || ui.modals > 0) return
      const t = ui.tab === 'agents' ? voiceTargetFor(useWorkspaces.getState().activeId ?? undefined) : null
      if (!t) {
        useVoice.setState({ phase: 'error', target: null, error: 'Chọn một ô agent trong tab Agents rồi giữ phím tắt để nói.', needsModel: false })
        return
      }
      holding = true
      void beginVoice(t)
    }
    const onUp = (e: KeyboardEvent): void => {
      if (!holding || !isHotkeyUp(e, useSettings.getState().value.app.voice.hotkey)) return
      holding = false
      void endVoice()
    }
    // Chuyển cửa sổ khi đang giữ phím: không bao giờ nhận keyup → coi như thả.
    const onBlur = (): void => {
      if (!holding) return
      holding = false
      void endVoice()
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Lỗi không gắn với ô nào (chưa chọn ô): thông báo nổi, tự ẩn.
  useEffect(() => {
    if (phase !== 'error' || target) return
    const t = setTimeout(() => cancelVoice(), 4000)
    return () => clearTimeout(t)
  }, [phase, target])

  if (phase !== 'error' || target) return null
  return (
    <div className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-panel px-4 py-2 text-[13px] shadow-lg" role="status">
      {error}
    </div>
  )
}

/** Nút micro trên tiêu đề ô: bấm để nói, bấm lần nữa để dừng (thay cho giữ phím). Chỉ hiện khi rê chuột vào ô, trừ lúc đang nói. */
export function MicButton({ wsId, agentId }: { wsId: string; agentId: string }): React.JSX.Element | null {
  const enabled = useSettings((s) => s.value.app.voice.enabled)
  const hotkey = useSettings((s) => s.value.app.voice.hotkey)
  const mine = useVoiceFor(agentId)
  const phase = useVoice((s) => s.phase)
  if (!enabled) return null
  const live = mine && (phase === 'opening' || phase === 'listening')
  const tip = live ? 'Dừng nói' : `Nói để gõ (hoặc giữ ${VOICE_HOTKEYS[hotkey]})`
  return (
    <button
      type="button"
      data-tip={tip}
      aria-label={live ? 'Dừng nói' : 'Nói để gõ'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (live) void endVoice()
        else void beginVoice({ wsId, agentId })
      }}
      className={`h-[22px] w-[22px] place-items-center rounded-md ${
        live ? 'inline-grid animate-pulse bg-danger/20 text-danger' : 'hidden text-muted group-hover/cell:inline-grid hover:bg-panel-3 hover:text-fg'
      }`}
    >
      <Icon name="mic" />
    </button>
  )
}

/** Khung giọng nói ở đáy ô agent: đang nghe / đang nhận dạng / xem trước để sửa / lỗi. */
export function VoicePanel({ agentId }: { agentId: string }): React.JSX.Element | null {
  const mine = useVoiceFor(agentId)
  const { phase, level, text, error, needsModel, status, setText, live, livePartial, notice, aiBusy, aiBefore } = useVoice()
  const hotkey = useSettings((s) => s.value.app.voice.hotkey)
  const box = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (mine && phase === 'preview' && box.current) {
      const el = box.current
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [mine, phase])

  if (!mine) return null
  const key = VOICE_HOTKEYS[hotkey]
  return (
    <div
      className="absolute inset-x-2 bottom-2 z-10 rounded-lg border border-line-2 bg-panel-2/95 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,.5)]"
      // Không để ô / terminal bên dưới giành focus khi bấm vào khung.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {(phase === 'opening' || phase === 'listening') && (
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${phase === 'listening' ? 'animate-pulse bg-danger' : 'bg-muted'}`} />
          <span className="shrink-0 text-[13px]">{phase === 'opening' ? 'Đang mở micro…' : 'Đang nghe…'}</span>
          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded bg-line">
            <div className="h-full bg-work transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <span className="shrink-0 text-[12px] text-muted">
            {status.engine === 'loading' ? 'đang nạp model · ' : ''}thả {key} (hoặc bấm nút micro) để dừng · Esc huỷ
          </span>
        </div>
      )}
      {phase === 'processing' && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          {status.engine === 'loading' ? 'Đang nạp model (lần đầu sau một lúc không dùng)…' : 'Đang nhận dạng…'}
        </div>
      )}
      {(phase === 'listening' || phase === 'processing') && (live || livePartial) && (
        // Máy đám mây: chữ hiện dần trong lúc nói (chữ mờ = máy còn đang đoán).
        <p className="mt-1.5 max-h-24 overflow-y-auto text-[13px] leading-relaxed" aria-live="polite">
          {live} <span className="text-muted">{livePartial}</span>
        </p>
      )}
      {phase === 'preview' && notice && <p className="mb-1.5 text-[12px] text-wait">{notice}</p>}
      {phase === 'preview' && (
        <div className="flex flex-col gap-2">
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                insertVoice()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelVoice()
              }
            }}
            rows={Math.min(6, Math.max(2, Math.ceil(text.length / 80)))}
            spellCheck={false}
            aria-label="Chữ nhận được từ giọng nói"
            className="w-full resize-none rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2 text-[12px] text-muted">
            {aiBusy ? (
              <span className="flex items-center gap-1.5 text-accent">
                <span className="h-2 w-2 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                Đang sửa bằng AI…
              </span>
            ) : aiBefore ? (
              <span className="flex items-center gap-1.5 text-work">
                Đã sửa bằng AI
                <button onClick={undoAiFix} className="rounded px-1.5 py-0.5 text-muted underline hover:text-fg">
                  Hoàn tác
                </button>
              </span>
            ) : null}
            <span className="flex-1">Sửa nếu cần · giữ {key} để nói thêm · Shift+Enter xuống dòng · chèn xong vẫn chưa gửi</span>
            <button onClick={cancelVoice} className="rounded-md bg-panel-2 px-2.5 py-1 text-fg hover:bg-line">
              Bỏ (Esc)
            </button>
            <button onClick={() => insertVoice()} className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-on hover:brightness-110">
              Chèn (Enter)
            </button>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="flex-1 text-danger">{error}</span>
          {needsModel && (
            <button
              onClick={() => {
                cancelVoice()
                useUi.getState().openSettings('voice')
              }}
              className="rounded-md bg-accent px-2.5 py-1 font-medium text-accent-on hover:brightness-110"
            >
              Mở Cài đặt → Giọng nói
            </button>
          )}
          {text && (
            <button onClick={() => insertVoice()} className="rounded-md bg-panel-2 px-2.5 py-1 text-fg hover:bg-line">
              Thử chèn lại
            </button>
          )}
          <button onClick={cancelVoice} className="rounded-md bg-panel-2 px-2.5 py-1 text-fg hover:bg-line">
            Đóng
          </button>
        </div>
      )}
    </div>
  )
}
