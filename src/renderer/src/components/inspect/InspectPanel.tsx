import { useEffect, useRef, useState } from 'react'
import { agentColor, elementLabel, isOpen, pageKey, sortForList, type InspectPin, type PinPlace } from '@shared/inspect'
import { initials } from '@shared/artifacts'
import type { BrowserTab } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useInspect } from '../../store/inspect'
import { Icon } from '../Icon'
import { IconButton } from '../shell/IconButton'

/** Bình luận (kể cả nháp) đang ở trang của tab này. */
export function pagePins(pins: InspectPin[], tab: BrowserTab | undefined): InspectPin[] {
  if (!tab?.url) return []
  const key = pageKey(tab.url)
  return pins.filter((p) => p.url === key)
}

/** Số trên ghim / mạch: teal = đã gửi, vàng = có trả lời mới, viền teal = đã xem, xám = đã đóng. */
function dotClass(p: InspectPin): string {
  if (p.state === 'new') return 'bg-wait text-wait-on'
  if (p.state === 'read') return 'text-accent shadow-[inset_0_0_0_1.5px_var(--color-accent)]'
  if (p.state === 'closed') return 'bg-[#5d646d] text-white'
  return 'bg-accent text-accent-on'
}

/**
 * Ngăn "Bình luận" bên phải ô Browser (chế độ Soi): mỗi mạch gồm nhãn phần tử, tin của bạn, câu trả lời của agent, ô
 * "Trả lời…" và nút ✓ đóng / Mở lại. `overlay` = ô hẹp: ngăn phủ lên trang (trang thật là view gốc của main, nằm trên
 * HTML, nên pane ẩn view đi khi ngăn phủ).
 */
export function InspectPanel({ wsId, tab, overlay, onClose }: { wsId: string; tab: BrowserTab | undefined; overlay: boolean; onClose: () => void }): React.JSX.Element {
  const snap = useInspect((s) => s.byWs[wsId])
  const act = useInspect((s) => s.act)
  const highlight = useInspect((s) => s.highlight)
  const [showClosed, setShowClosed] = useState(false)
  const [hl, setHl] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const pins = pagePins(snap?.pins ?? [], tab).filter((p) => p.state !== 'draft')
  const places = (tab && snap?.places[tab.id]) || {}
  const open = sortForList(pins.filter((p) => isOpen(p.state)))
  const closed = sortForList(pins.filter((p) => p.state === 'closed'))
  const tabId = tab?.id

  // Bấm ghim trên trang → cuộn tới mạch, sáng một chút, con trỏ vào ô Trả lời.
  useEffect(() => {
    if (!highlight || highlight.wsId !== wsId) return
    if (closed.some((p) => p.id === highlight.id)) setShowClosed(true)
    setHl(highlight.id)
    const t = setTimeout(() => setHl(null), 1000)
    requestAnimationFrame(() => {
      const card = list.current?.querySelector<HTMLElement>(`[data-pin="${highlight.id}"]`)
      card?.scrollIntoView({ block: 'nearest' })
      card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    })
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight?.at])

  const peek = (id: number | null): void => {
    if (tabId) void act(wsId, { type: 'peek', tabId, id })
  }
  // Ngăn đóng / đổi tab: bỏ viền phần tử đang rê.
  useEffect(() => () => peek(null), [tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside
      className={`flex flex-col border-line bg-bg ${
        overlay ? 'absolute inset-0 z-10 rounded-b-[11px]' : 'w-[clamp(260px,40%,320px)] shrink-0 rounded-br-[11px] border-l'
      }`}
      onKeyDown={(e) => {
        // Esc trong ô Trả lời: rời ô; ngoài ô (ngăn phủ): đóng ngăn.
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
        const input = (e.target as Element).closest('input')
        e.stopPropagation()
        if (input) (input as HTMLInputElement).blur()
        else if (overlay) onClose()
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3.5 text-[13px] font-semibold">
        Bình luận
        {open.length > 0 && <span className="font-medium text-dim">{open.length}</span>}
        <span className="flex-1" />
        <IconButton icon="x" tip="Ẩn bình luận" size="s" onClick={onClose} />
      </div>
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5" onMouseLeave={() => peek(null)}>
        {!open.length && !(showClosed && closed.length) && <div className="px-4 py-10 text-center text-[12.5px] text-dim">Chưa có bình luận.</div>}
        {[...open, ...(showClosed ? closed : [])].map((p) => (
          <Thread
            key={p.id}
            wsId={wsId}
            pin={p}
            place={places[p.id]}
            hl={hl === p.id}
            onPeek={peek}
            onShow={() => {
              if (p.state === 'new') void act(wsId, { type: 'read', id: p.id })
              if (tabId && places[p.id] === 'ok') {
                void act(wsId, { type: 'focus', tabId, id: p.id })
                // Ngăn phủ trang: đóng để thấy phần tử.
                if (overlay) onClose()
              }
            }}
          />
        ))}
      </div>
      {closed.length > 0 && (
        <div className="shrink-0 border-t border-line px-3.5 py-2.5">
          <button type="button" className="text-[12px] text-muted hover:text-fg" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? 'Ẩn' : 'Hiện'} {closed.length} bình luận đã đóng
          </button>
        </div>
      )}
    </aside>
  )
}

function Avatar({ name, me }: { name: string; me?: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[8px] font-bold"
      style={me ? { background: '#5d646d', color: '#fff' } : { background: agentColor(name), color: '#0b0d10' }}
    >
      {me ? 'B' : initials(name)}
    </span>
  )
}

function Thread({
  wsId,
  pin: p,
  place,
  hl,
  onPeek,
  onShow
}: {
  wsId: string
  pin: InspectPin
  place: PinPlace | undefined
  hl: boolean
  onPeek: (id: number | null) => void
  onShow: () => void
}): React.JSX.Element {
  const act = useInspect((s) => s.act)
  const key = `${wsId}:${p.id}`
  const reply = useInspect((s) => s.replies[key] ?? '')
  const setReply = useInspect((s) => s.setReply)
  const running = useAgents((s) => !!s.byWs[wsId]?.running[p.agentId])
  const l = elementLabel(p.target)
  const gone = place === 'orphan'
  const closed = p.state === 'closed'

  const send = (): void => {
    const t = reply.trim()
    if (!t) return
    void act(wsId, { type: 'reply', id: p.id, text: t })
    setReply(key, '')
  }

  return (
    <div
      data-pin={p.id}
      onMouseEnter={() => onPeek(closed ? null : p.id)}
      onClick={(e) => {
        if (!(e.target as Element).closest('button, input')) onShow()
      }}
      className={`cursor-pointer rounded-[9px] border bg-panel px-[11px] py-2.5 ${hl ? 'border-line-3 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : 'border-line hover:border-line-3'} ${
        closed ? 'opacity-55' : ''
      }`}
    >
      <div className="flex items-center gap-[7px]">
        <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[10px] font-bold ${dotClass(p)}`}>{p.id}</span>
        <span className={`min-w-0 flex-1 truncate text-[12px] ${gone ? 'text-dim line-through' : 'text-muted'}`} data-tip={gone ? 'Phần tử này không còn trên trang' : undefined}>
          <b className="mr-[5px] font-mono text-[11.5px] font-medium text-dim">{l.t}</b>
          {l.txt}
        </span>
        <button
          type="button"
          data-tip={closed ? 'Mở lại' : 'Xong, đóng bình luận'}
          aria-label={closed ? 'Mở lại' : 'Đóng bình luận'}
          onClick={() => void act(wsId, { type: closed ? 'reopen' : 'close', id: p.id })}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-muted hover:bg-panel-3 hover:text-fg"
        >
          <Icon name={closed ? 'ref' : 'check'} size="s" />
        </button>
      </div>
      {p.thread.map((m, i) => (
        <div key={i} className="mt-2 flex gap-2">
          <Avatar name={p.agentName} me={m.by === 'user'} />
          <div className="min-w-0 flex-1 text-[13px] leading-[1.45]">
            <b className="text-[12px] font-semibold" style={m.by === 'agent' ? { color: agentColor(p.agentName) } : undefined}>
              {m.by === 'user' ? 'Bạn' : p.agentName}
            </b>
            <div className="whitespace-pre-wrap text-fg [overflow-wrap:anywhere]">{m.text}</div>
          </div>
        </div>
      ))}
      {p.state === 'queued' && <div className="mt-2 text-[12px] text-muted">{running ? `Chờ ${p.agentName} xong việc đang làm` : `Chờ phiên của ${p.agentName} mở`}</div>}
      {p.state === 'working' && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <span className="flex gap-[3px]">
            {[0, 150, 300].map((d) => (
              <i key={d} className="h-1 w-1 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
          {p.agentName} đang sửa
        </div>
      )}
      {(p.state === 'new' || p.state === 'read') && (
        <input
          value={reply}
          onChange={(e) => setReply(key, e.target.value)}
          onFocus={() => p.state === 'new' && void act(wsId, { type: 'read', id: p.id })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              send()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Trả lời…"
          className="mt-[9px] h-7 w-full rounded-md border border-line-2 bg-bg px-[9px] text-[12.5px] text-fg outline-none placeholder:text-dim focus:border-line-3"
        />
      )}
    </div>
  )
}
