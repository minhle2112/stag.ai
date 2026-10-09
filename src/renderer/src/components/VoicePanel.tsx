import { useEffect, useRef } from 'react'
import { isHotkeyDown, isHotkeyUp, VOICE_HOTKEYS } from '@shared/voice'
import { useSettings } from '../store/settings'
import { useUi } from '../store/ui'
import { beginVoice, cancelVoice, endVoice, insertVoice, useVoice, useVoiceFor, voiceTargetFor } from '../store/voice'
import { useWorkspaces } from '../store/workspaces'

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

/** Nút micro trên thanh của ô: bấm để nói, bấm lần nữa để dừng (thay cho giữ phím). */
export function MicButton({ wsId, agentId }: { wsId: string; agentId: string }): React.JSX.Element | null {
  const enabled = useSettings((s) => s.value.app.voice.enabled)
  const hotkey = useSettings((s) => s.value.app.voice.hotkey)
  const mine = useVoiceFor(agentId)
  const phase = useVoice((s) => s.phase)
  if (!enabled) return null
  const live = mine && (phase === 'opening' || phase === 'listening')
  return (
    <button
      title={live ? 'Dừng nói' : `Nói để gõ (hoặc giữ ${VOICE_HOTKEYS[hotkey]})`}
      aria-label={live ? 'Dừng nói' : 'Nói để gõ'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (live) void endVoice()
        else void beginVoice({ wsId, agentId })
      }}
      className={`rounded px-1.5 py-0.5 ${live ? 'bg-red-500/20 text-red-300' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
    >
      <MicIcon />
    </button>
  )
}

function MicIcon(): React.JSX.Element {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden className="inline-block">
      <rect x="3.5" y="0.75" width="5" height="8" rx="2.5" />
      <path d="M1 6.5a5 5 0 0 0 10 0M6 11.5V13.5" strokeLinecap="round" />
    </svg>
  )
}

/** Khung giọng nói ở đáy ô agent: đang nghe / đang nhận dạng / xem trước để sửa / lỗi. */
export function VoicePanel({ agentId }: { agentId: string }): React.JSX.Element | null {
  const mine = useVoiceFor(agentId)
  const { phase, level, text, error, needsModel, status, setText, live, livePartial, notice } = useVoice()
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
      className="absolute inset-x-2 bottom-2 z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-lg"
      // Không để ô / terminal bên dưới giành focus khi bấm vào khung.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {(phase === 'opening' || phase === 'listening') && (
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${phase === 'listening' ? 'animate-pulse bg-red-500' : 'bg-muted'}`} />
          <span className="shrink-0 text-[13px]">{phase === 'opening' ? 'Đang mở micro…' : 'Đang nghe…'}</span>
          <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded bg-line">
            <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
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
      {phase === 'preview' && notice && <p className="mb-1.5 text-[12px] text-amber-300">{notice}</p>}
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
            <span className="flex-1">Sửa nếu cần · giữ {key} để nói thêm · Shift+Enter xuống dòng · chèn xong vẫn chưa gửi</span>
            <button onClick={cancelVoice} className="rounded-md bg-panel-2 px-2.5 py-1 text-fg hover:bg-line">
              Bỏ (Esc)
            </button>
            <button onClick={() => insertVoice()} className="rounded-md bg-accent px-2.5 py-1 font-medium text-[#0b1220] hover:brightness-110">
              Chèn (Enter)
            </button>
          </div>
        </div>
      )}
      {phase === 'error' && (
        <div className="flex items-center gap-3 text-[13px]">
          <span className="flex-1 text-red-300">{error}</span>
          {needsModel && (
            <button
              onClick={() => {
                cancelVoice()
                useUi.getState().openSettings('voice')
              }}
              className="rounded-md bg-accent px-2.5 py-1 font-medium text-[#0b1220] hover:brightness-110"
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
