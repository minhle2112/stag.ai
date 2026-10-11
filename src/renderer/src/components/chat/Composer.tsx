import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatImage, ChatItem, ChatState } from '@shared/chat'
import { registerComposer, useChat, type ComposerHandle } from '../../store/chat'
import { Icon } from '../Icon'
import {
  appendText,
  checkImage,
  CHOICE_TOOLS,
  ctxInfo,
  dataUrlToImage,
  historyStep,
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

/** Ô soạn tin: Enter gửi, Shift+Enter xuống dòng, dán ảnh, ↑ lấy lại tin cũ, Esc ngắt lượt; dưới là model / ctx / hạn mức. */
export function Composer({ agentId, agentName, enabled, state, pending, queued, error, ctxLimit, offLabel, focusRef }: ComposerProps): React.JSX.Element {
  const [text, setTextState] = useState('')
  const [images, setImagesState] = useState<Attached[]>([])
  const [note, setNote] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // Bản sao mới nhất để handler đăng ký một lần (giọng nói) luôn đọc đúng.
  const textRef = useRef('')
  const imagesRef = useRef<Attached[]>([])
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const hist = useRef<{ index: number | null; draft: string }>({ index: null, draft: '' })
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idSeq = useRef(0)

  const setText = (v: string): void => {
    textRef.current = v
    setTextState(v)
  }
  const setImages = (v: Attached[]): void => {
    imagesRef.current = v
    setImagesState(v)
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
  const waitingHint = phase === 'waiting' ? (pending?.tool === 'AskUserQuestion' ? 'Chờ bạn trả lời ở thẻ phía trên' : 'Chờ bạn duyệt ở thẻ phía trên') : null

  return (
    <div className="shrink-0 border-t border-line bg-panel px-3 pt-2 pb-2 @max-[420px]/chat:px-2">
      <div className="mx-auto w-full max-w-[860px]">
        {error && (
          <div className="mb-1.5 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button type="button" onClick={() => useChat.getState().clearError(agentId)} aria-label="Đóng" className="shrink-0 text-danger/80 hover:text-danger">
              <Icon name="x" size="s" />
            </button>
          </div>
        )}
        {queued.length > 0 && (
          <div className="mb-1.5 flex flex-col gap-1">
            {queued.map((q, i) => (
              <div key={`${i}:${q}`} className="flex min-w-0 items-center gap-1.5 text-[11px] text-dim">
                <Icon name="hist" size={12} className="shrink-0" />
                <span className="shrink-0">đang xếp hàng</span>
                <span className="min-w-0 truncate text-muted">{q}</span>
              </div>
            ))}
          </div>
        )}
        {waitingHint && <div className="mb-1.5 text-[11px] text-dim">{waitingHint}</div>}

        <div
          className={`rounded-lg border bg-bg transition-colors ${enabled ? 'border-line-2 focus-within:border-line-3' : 'border-line opacity-60'}`}
          onMouseDown={(e) => {
            // Bấm vùng trống của khung (không phải nút / ô nhập) → vào ô nhập.
            if (e.target === e.currentTarget) {
              e.preventDefault()
              taRef.current?.focus()
            }
          }}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-2 pt-2">
              {images.map((im) => (
                <div key={im.id} className="group/img relative h-10 w-10 overflow-hidden rounded-md border border-line-2 bg-bg0">
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
                </div>
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
            placeholder={enabled ? `Nhắn cho ${agentName} · Shift+Enter xuống dòng` : (offLabel ?? 'Phiên đã dừng')}
            onChange={(e) => {
              setText(e.target.value)
              // Gõ tiếp thì thôi duyệt lịch sử (bản đang hiện thành bản nháp).
              if (hist.current.index !== null) hist.current = { index: null, draft: e.target.value }
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className="block max-h-[168px] min-h-[34px] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-[1.5] text-fg outline-none field-sizing-content placeholder:text-dim"
          />
          <div className="flex min-h-7 items-center gap-2.5 px-2 pb-1.5 font-mono text-[11px] text-dim">
            {state.model && (
              <span className="min-w-0 shrink truncate" data-tip={state.model}>
                {shortModel(state.model)}
              </span>
            )}
            {ctx && (
              <span className={`inline-flex shrink-0 items-center gap-1.5 ${ctx.tone === 'full' ? 'text-danger' : 'text-muted'}`} data-tip={ctx.title}>
                ctx {ctx.text}
                {ctx.pct !== null && (
                  <span className="h-[3px] w-10 overflow-hidden rounded-sm bg-panel-3 @max-[340px]/chat:hidden">
                    <i className={`block h-full ${ctx.tone === 'full' ? 'bg-danger' : ctx.tone === 'warn' ? 'bg-wait' : 'bg-neutral'}`} style={{ width: `${ctx.pct}%` }} />
                  </span>
                )}
              </span>
            )}
            {quota && (
              <span className="shrink-0 text-muted @max-[380px]/chat:hidden" data-tip={quotaTip}>
                {quota.text}
              </span>
            )}
            <div className="flex-1" />
            {note && <span className="min-w-0 truncate font-sans text-wait">{note}</span>}
            {busy && (
              <button
                type="button"
                onClick={() => useChat.getState().interrupt(agentId)}
                data-tip="Dừng lượt này · Esc"
                aria-label="Dừng"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line-2 bg-panel-2 text-danger hover:border-line-3 hover:bg-panel-3"
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
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-accent bg-accent text-accent-on hover:brightness-110 disabled:border-line-2 disabled:bg-panel-2 disabled:text-dim disabled:hover:brightness-100"
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
