import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatImage, ChatItem, ChatState } from '@shared/chat'
import { registerComposer, useChat, type ComposerHandle } from '../../store/chat'
import { useSettings } from '../../store/settings'
import { beginVoice, endVoice, useVoice, useVoiceFor } from '../../store/voice'
import { Icon } from '../Icon'
import {
  appendText,
  checkImage,
  CHOICE_TOOLS,
  ctxInfo,
  dataUrlToImage,
  historyStep,
  IMAGE_TYPES,
  isImeKey,
  quotaLabel,
  shortModel,
  shouldSubmit
} from './chatLogic'

type AskItem = Extract<ChatItem, { kind: 'ask' }>

interface Attached {
  id: string
  /** data: URL để hiện thumbnail. */
  url: string
  image: ChatImage
}

export interface ComposerProps {
  agentId: string
  agentName: string
  /** Workspace (giọng nói lấy từ vựng gợi ý). */
  wsId: string
  /** Model dự kiến khi phiên chưa báo model (cài đặt của agent). */
  modelHint?: string
  /** Mức suy nghĩ đang dùng ('' = không rõ). */
  effort?: string
  /** Bấm pill model · effort (mở Cài đặt → Adapter của agent). */
  onModel?: () => void
  /** Phiên đang chạy. false = ô bị vô hiệu ("Phiên đã dừng"). */
  enabled: boolean
  state: ChatState
  /** Thẻ xin quyền đầu tiên đang chờ (Enter = Cho phép, Esc = Từ chối khi ô trống). */
  pending?: AskItem
  /** Tin đã gửi lúc Claude bận, chưa thấy được xử lý. */
  queued: string[]
  error?: string
  /** % context bắt đầu đỏ. */
  ctxLimit: number
  /** Chữ gợi ý khi ô bị vô hiệu (mặc định "Phiên đã dừng"). */
  offLabel?: string
  /** ChatCell nhận hàm đưa con trỏ vào ô soạn tin (bấm vào chỗ trống của hội thoại). */
  focusRef?: React.MutableRefObject<(() => void) | null>
}

/**
 * Bản nháp đang gõ theo agent: ô chat bị gỡ khi chuyển tab project (canvas mỗi tab một bản), gắn lại thì lấy về.
 */
const drafts = new Map<string, { text: string; images: Attached[] }>()

/**
 * Ô soạn tin: một hộp bo tròn — trên là chip tin xếp hàng + ảnh đã dán, giữa là ô nhập (Enter gửi, Shift+Enter xuống
 * dòng, ↑ tin cũ, Esc ngắt lượt), dưới là đính kèm, model · effort, ctx · hạn mức, mic, nút Gửi / Dừng.
 */
export function Composer({
  agentId,
  agentName,
  wsId,
  modelHint,
  effort,
  onModel,
  enabled,
  state,
  pending,
  queued,
  error,
  ctxLimit,
  offLabel,
  focusRef
}: ComposerProps): React.JSX.Element {
  const [text, setTextState] = useState(() => drafts.get(agentId)?.text ?? '')
  const [images, setImagesState] = useState<Attached[]>(() => drafts.get(agentId)?.images ?? [])
  const [note, setNote] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Bản sao mới nhất để handler đăng ký một lần (giọng nói) luôn đọc đúng.
  const textRef = useRef(text)
  const imagesRef = useRef<Attached[]>(images)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const hist = useRef<{ index: number | null; draft: string }>({ index: null, draft: '' })
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idSeq = useRef(0)

  const keepDraft = (): void => {
    if (textRef.current || imagesRef.current.length) drafts.set(agentId, { text: textRef.current, images: imagesRef.current })
    else drafts.delete(agentId)
  }
  const setText = (v: string): void => {
    textRef.current = v
    setTextState(v)
    keepDraft()
  }
  const setImages = (v: Attached[]): void => {
    imagesRef.current = v
    setImagesState(v)
    keepDraft()
  }
  const flash = (msg: string): void => {
    setNote(msg)
    if (noteTimer.current) clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => setNote(null), 4000)
  }
  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current)
    },
    []
  )

  const phase = state.phase
  const busy = phase === 'busy' || phase === 'waiting'

  const doSend = (override?: string): boolean => {
    if (!enabledRef.current) return false
    const t = (override ?? textRef.current).trim()
    const imgs = imagesRef.current
    if (!t && !imgs.length) return false
    void useChat.getState().send(agentId, t, imgs.map((i) => i.image))
    setText('')
    setImages([])
    hist.current = { index: null, draft: '' }
    return true
  }
  const sendRef = useRef(doSend)
  sendRef.current = doSend

  const caretToEnd = (): void => {
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }

  // Đăng ký để giọng nói (pasteIntoTerminal) đưa chữ vào ô này.
  useEffect(() => {
    const handle: ComposerHandle = {
      insert(add, submit) {
        if (!enabledRef.current) return false
        const next = appendText(textRef.current, add)
        if (submit) sendRef.current(next)
        else {
          setText(next)
          hist.current = { index: null, draft: '' }
          caretToEnd()
        }
        return true
      }
    }
    return registerComposer(agentId, handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ phụ thuộc agentId; mọi thứ khác đọc qua ref
  }, [agentId])

  useEffect(() => {
    if (!focusRef) return
    focusRef.current = () => taRef.current?.focus()
    return () => {
      focusRef.current = null
    }
  }, [focusRef])

  // Mở ô khi phiên đang chạy thì đưa con trỏ vào ngay (nếu chưa có gì đang giữ focus).
  useEffect(() => {
    if (enabled && (document.activeElement === document.body || !document.activeElement)) taRef.current?.focus()
  }, [enabled])

  function addFiles(files: File[]): void {
    let count = imagesRef.current.length
    for (const f of files) {
      const ck = checkImage(f, count)
      if (!ck.ok) {
        flash(ck.reason)
        continue
      }
      count++
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        const image = dataUrlToImage(url)
        if (image) setImages([...imagesRef.current, { id: `img${++idSeq.current}`, url, image }])
      }
      reader.onerror = () => flash('Không đọc được ảnh vừa dán')
      reader.readAsDataURL(f)
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const files: File[] = []
    for (const it of Array.from(e.clipboardData.items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    }
    if (!files.length) return
    // Chỉ chặn dán mặc định khi clipboard không có chữ (chụp màn hình): chữ kèm ảnh vẫn dán bình thường.
    if (!e.clipboardData.getData('text/plain').trim()) e.preventDefault()
    addFiles(files)
  }

  function recall(dir: 'up' | 'down'): void {
    const history = useChat.getState().history[agentId] ?? []
    if (hist.current.index === null && dir === 'up') hist.current.draft = textRef.current
    const r = historyStep(history, hist.current.index, dir, hist.current.draft)
    hist.current.index = r.index
    if (r.text !== null) {
      setText(r.text)
      caretToEnd()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const k = { key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }
    // Đang gõ IME (Telex): Enter / Esc / mũi tên thuộc về bộ gõ.
    if (isImeKey(k)) return
    const empty = !textRef.current.trim() && !imagesRef.current.length
    if (shouldSubmit(k)) {
      e.preventDefault()
      if (!empty) doSend()
      // Ô trống + có thẻ xin quyền thường: Enter = Cho phép (câu hỏi / kế hoạch phải bấm có chủ ý).
      else if (pending && !CHOICE_TOOLS.has(pending.tool)) useChat.getState().answer(agentId, pending.requestId, 'allow')
      return
    }
    if (e.key === 'Escape') {
      if (phase === 'busy') {
        e.preventDefault()
        useChat.getState().interrupt(agentId)
      } else if (pending && empty) {
        e.preventDefault()
        useChat.getState().answer(agentId, pending.requestId, 'deny')
      }
      return
    }
    // ↑ / ↓ duyệt tin đã gửi: khi ô trống, hoặc đang duyệt và con trỏ ở dòng đầu / dòng cuối (nhiều dòng thì để mũi tên di chuyển).
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const ta = e.currentTarget
      const browsing = hist.current.index !== null
      if (e.key === 'ArrowUp') {
        const firstLine = !ta.value.slice(0, ta.selectionStart).includes('\n')
        if (!textRef.current || (browsing && firstLine)) {
          e.preventDefault()
          recall('up')
        }
      } else if (browsing) {
        const lastLine = !ta.value.slice(ta.selectionEnd).includes('\n')
        if (lastLine) {
          e.preventDefault()
          recall('down')
        }
      }
    }
  }

  const ctx = ctxInfo(state.contextUsed, state.contextSize, ctxLimit)
  const q5 = quotaLabel(state.quota?.fiveHour, '5h')
  const q7 = quotaLabel(state.quota?.sevenDay, '7d')
  const quota = q5 ?? q7
  const quotaTip = useMemo(() => [q5?.title, q7?.title].filter(Boolean).join('\n'), [q5?.title, q7?.title])
  const canSend = enabled && (!!text.trim() || images.length > 0)
  const waiting = phase === 'waiting'
  const waitingHint = waiting ? (pending?.tool === 'AskUserQuestion' ? 'Chờ bạn trả lời ở thẻ phía trên' : 'Chờ bạn duyệt ở thẻ phía trên') : null
  const model = shortModel(state.model) || shortModel(modelHint)
  const pill = [model, effort].filter(Boolean).join(' · ')
  const placeholder = !enabled ? (offLabel ?? 'Phiên đã dừng') : (waitingHint ?? `Nhắn cho ${agentName}…`)

  return (
    <div className="shrink-0 px-3 pt-1 pb-3 @max-[420px]/chat:px-2 @max-[420px]/chat:pb-2">
      <div className="mx-auto w-full max-w-[860px]">
        {error && (
          <div className="mb-1.5 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button type="button" onClick={() => useChat.getState().clearError(agentId)} aria-label="Đóng" className="shrink-0 text-danger/80 hover:text-danger">
              <Icon name="x" size="s" />
            </button>
          </div>
        )}

        <div
          className={`rounded-[14px] border bg-panel-2 transition-[border-color,opacity] ${
            !enabled ? 'border-line opacity-60' : waiting && !text ? 'border-line-2 opacity-70 focus-within:opacity-100' : 'border-line-2 focus-within:border-line-3'
          }`}
          onMouseDown={(e) => {
            // Bấm vùng trống của khung (không phải nút / ô nhập) → vào ô nhập.
            if (e.target === e.currentTarget) {
              e.preventDefault()
              taRef.current?.focus()
            }
          }}
        >
          {(queued.length > 0 || images.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2">
              {/* Tin đã gửi lúc agent bận: đã nằm trong hàng đợi của CLI nên không rút lại được (không có ×). */}
              {queued.map((q, i) => (
                <span
                  key={`${i}:${q}`}
                  data-tip={q.length > 40 ? q : undefined}
                  className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-dashed border-line-3 px-2 py-px text-[11px] text-muted"
                >
                  <Icon name="hist" size={11} className="shrink-0 text-dim" />
                  <span className="shrink-0 text-dim">Xếp hàng:</span>
                  <span className="min-w-0 truncate">{q}</span>
                </span>
              ))}
              {images.map((im) => (
                <span key={im.id} className="group/img relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-line-2 bg-bg0">
                  <img src={im.url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages(imagesRef.current.filter((x) => x.id !== im.id))}
                    data-tip="Bỏ ảnh"
                    aria-label="Bỏ ảnh"
                    className="absolute top-0 right-0 grid h-4 w-4 place-items-center rounded-bl-md bg-bg0/85 text-muted hover:text-fg"
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={text}
            rows={1}
            disabled={!enabled}
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            data-tip={enabled && !waitingHint ? 'Enter gửi · Shift+Enter xuống dòng · ↑ tin cũ' : undefined}
            onChange={(e) => {
              setText(e.target.value)
              // Gõ tiếp thì thôi duyệt lịch sử (bản đang hiện thành bản nháp).
              if (hist.current.index !== null) hist.current = { index: null, draft: e.target.value }
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="block max-h-[168px] min-h-[44px] w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-[1.5] text-fg outline-none field-sizing-content placeholder:text-dim"
          />
          <div className="flex min-h-8 items-center gap-1.5 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={!enabled}
              onClick={() => fileRef.current?.click()}
              data-tip="Đính kèm ảnh (hoặc dán thẳng vào ô)"
              aria-label="Đính kèm ảnh"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 text-muted hover:border-line-3 hover:text-fg disabled:opacity-40"
            >
              <Icon name="img" size="s" />
            </button>
            {pill && (
              <button
                type="button"
                onClick={onModel}
                disabled={!onModel}
                data-tip={state.model ? `${state.model} · đổi model / effort` : 'Đổi model / effort'}
                className="inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-full border border-line-2 px-2 text-[11px] text-muted hover:border-line-3 hover:text-fg disabled:hover:border-line-2 disabled:hover:text-muted"
              >
                <span className="min-w-0 truncate">{pill}</span>
                {onModel && <Icon name="cd" size={10} className="shrink-0" />}
              </button>
            )}
            {(ctx || quota) && (
              <span className="inline-flex min-w-0 shrink-0 items-center gap-1 font-mono text-[11px] text-dim">
                {ctx && (
                  <span className={ctx.tone === 'full' ? 'text-danger' : ctx.tone === 'warn' ? 'text-wait' : ''} data-tip={ctx.title}>
                    ctx {ctx.text}
                  </span>
                )}
                {ctx && quota && <span className="@max-[380px]/chat:hidden">·</span>}
                {quota && (
                  <span className="@max-[380px]/chat:hidden" data-tip={quotaTip}>
                    {quota.text}
                  </span>
                )}
              </span>
            )}
            <div className="min-w-0 flex-1" />
            {note && <span className="min-w-0 truncate text-[11px] text-wait">{note}</span>}
            {enabled && <ComposerMic wsId={wsId} agentId={agentId} />}
            {busy && (
              <button
                type="button"
                onClick={() => useChat.getState().interrupt(agentId)}
                data-tip="Dừng lượt này · Esc"
                aria-label="Dừng"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fg text-bg0 hover:brightness-90"
              >
                <Icon name="stop" size="s" />
              </button>
            )}
            {(!busy || canSend) && (
              <button
                type="button"
                disabled={!canSend}
                onClick={() => doSend()}
                data-tip={busy ? 'Gửi (xếp hàng) · Enter' : 'Gửi · Enter'}
                aria-label="Gửi"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-accent-on hover:brightness-110 disabled:bg-panel-3 disabled:text-dim disabled:hover:brightness-100"
              >
                <Icon name="send" size="s" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mic trên hàng nút của ô soạn tin: bấm để nói (chữ vào ô này), bấm lần nữa để dừng. Ẩn khi tắt giọng nói trong Cài đặt. */
function ComposerMic({ wsId, agentId }: { wsId: string; agentId: string }): React.JSX.Element | null {
  const on = useSettings((s) => s.value.app.voice.enabled)
  const mine = useVoiceFor(agentId)
  const phase = useVoice((s) => s.phase)
  if (!on) return null
  const live = mine && (phase === 'opening' || phase === 'listening')
  return (
    <button
      type="button"
      onClick={() => (live ? void endVoice() : void beginVoice({ wsId, agentId }))}
      data-tip={live ? 'Dừng nói' : 'Nói để gõ'}
      aria-label={live ? 'Dừng nói' : 'Nói để gõ'}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${live ? 'animate-pulse bg-danger/20 text-danger' : 'text-muted hover:bg-panel-3 hover:text-fg'}`}
    >
      <Icon name="mic" size="s" />
    </button>
  )
}
