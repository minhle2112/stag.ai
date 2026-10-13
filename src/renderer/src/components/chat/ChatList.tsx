import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatItem } from '@shared/chat'
import { Icon } from '../Icon'
import { ChatRow, type RowCtx } from './ChatItems'
import { buildRows, nearBottom, showWorking } from './chatLogic'

/**
 * Danh sách hội thoại cuộn được. Tự cuộn theo nội dung mới nếu người dùng đang ở đáy (±40px); cuộn lên thì dừng
 * và hiện nút "Mới nhất". Giữ vị trí khi ô đổi kích thước (ResizeObserver cả khung lẫn nội dung).
 */
export function ChatList({
  items,
  phase,
  agentId,
  agentName,
  wsId,
  root,
  primaryAsk,
  onBlankClick
}: {
  items: ChatItem[]
  phase: string
  agentId: string
  agentName: string
  wsId: string
  root?: string
  primaryAsk: string | null
  /** Bấm vào chỗ trống (không chọn chữ, không bấm nút) → đưa con trỏ về ô soạn tin. */
  onBlankClick?: () => void
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [away, setAway] = useState(false)
  // Tool + suy nghĩ liên tiếp gom thành khối "Đã làm N bước", cuối lượt có thẻ file + dòng số liệu.
  const rows = useMemo(() => buildRows(items, phase), [items, phase])
  const ctx = useMemo<RowCtx>(() => ({ agentId, agentName, wsId, root, primaryAsk }), [agentId, agentName, wsId, root, primaryAsk])

  const toBottom = (): void => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Có nội dung mới (mục thêm / đổi, đổi phase): bám đáy nếu đang ở đáy. Trước khi vẽ để không nháy.
  useLayoutEffect(() => {
    if (stick.current) toBottom()
  }, [items, phase])

  useEffect(() => {
    const el = scroller.current
    const body = inner.current
    if (!el || !body) return
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom()
    })
    ro.observe(el)
    ro.observe(body)
    return () => ro.disconnect()
  }, [])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    const near = nearBottom(el)
    stick.current = near
    setAway((cur) => (cur === !near ? cur : !near))
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        onMouseUp={(e) => {
          if (!onBlankClick || window.getSelection()?.toString()) return
          if ((e.target as HTMLElement).closest('button,a,input,textarea,summary,[data-copy]')) return
          onBlankClick()
        }}
        className="absolute inset-0 overflow-y-auto select-text"
      >
        <div ref={inner} className="mx-auto flex w-full max-w-[860px] flex-col gap-3.5 px-4 pt-4 pb-5 @max-[420px]/chat:gap-2.5 @max-[420px]/chat:px-2.5">
          {rows.map((r) => (
            <ChatRow key={r.key} row={r} ctx={ctx} />
          ))}
          {showWorking(items, phase) && (
            <div className="inline-flex items-center gap-1.5 text-[12px] text-dim">
              <span className="sdot in" />
              Đang làm…
            </div>
          )}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => {
            stick.current = true
            setAway(false)
            toBottom()
          }}
          className="absolute right-4 bottom-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-line-2 bg-panel-2 px-3 text-[12px] text-fg shadow-tip hover:border-line-3 hover:bg-panel-3"
        >
          <Icon name="send" size="s" className="rotate-180" />
          Mới nhất
        </button>
      )}
    </div>
  )
}
