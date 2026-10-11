import { memo, useMemo, useState } from 'react'
import type { ChatItem } from '@shared/chat'
import { Icon } from '../Icon'
import { AgentAvatar } from '../ui/AgentAvatar'
import { AskCard } from './AskCard'
import { groupBlocks, turnLine } from './chatLogic'
import { Markdown } from './Markdown'
import { ToolCard } from './ToolCard'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** Tin dài (bàn giao, lời mở): gập sau chừng này dòng / ký tự. */
const LONG_LINES = 10
const LONG_CHARS = 900

/** Dòng gập mở: chevron xoay + nhãn mờ. */
function Fold({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="inline-flex items-center gap-1 text-[12px] text-dim hover:text-muted">
      <Icon name="cr" size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      {children}
    </button>
  )
}

export const UserItem = memo(function UserItem({ item }: { item: Of<'user'> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const long = item.text.length > LONG_CHARS || item.text.split('\n').length > LONG_LINES

  // Lời mở của app: một dòng mờ, bấm mới thấy.
  if (item.origin === 'app') {
    return (
      <div>
        <Fold open={open} onClick={() => setOpen(!open)}>
          Lời mở của app
        </Fold>
        {open && <div className="mt-1 rounded-md border border-line px-3 py-2 text-[12px] break-words whitespace-pre-wrap text-muted select-text">{item.text}</div>}
      </div>
    )
  }

  const collapsed = long && !open
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-fg">
      {item.origin === 'agent' && item.from && (
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-dim">
          <AgentAvatar name={item.from} size={14} />
          <span>
            từ <b className="font-semibold text-muted">{item.from}</b>
          </span>
        </div>
      )}
      <div className={`relative ${collapsed ? 'max-h-[13.5em] overflow-hidden' : ''}`}>
        <div className="break-words whitespace-pre-wrap">{item.text}</div>
        {collapsed && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel-2 to-transparent" />}
      </div>
      {long && (
        <div className="mt-1">
          <Fold open={open} onClick={() => setOpen(!open)}>
            {open ? 'Thu gọn' : 'Xem hết'}
          </Fold>
        </div>
      )}
      {!!item.images && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-panel-3 px-1.5 py-0.5 text-[11px] text-muted">
          <Icon name="img" size={12} />+{item.images} ảnh
        </div>
      )}
    </div>
  )
})

/** Khối suy nghĩ: gập mặc định; đang stream mà chưa có chữ thì chỉ hiện "Đang suy nghĩ…". */
function Thinking({ text, active }: { text: string; active: boolean }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!text.trim()) {
    return active ? (
      <div className="inline-flex items-center gap-1.5 text-[12px] text-dim italic">
        <span className="sdot in" />
        Đang suy nghĩ…
      </div>
    ) : null
  }
  return (
    <div>
      <Fold open={open} onClick={() => setOpen(!open)}>
        <span className="italic">{active ? 'Đang suy nghĩ…' : 'Suy nghĩ'}</span>
      </Fold>
      {open && <div className="mt-1 border-l border-line-2 pl-3 text-[12px] leading-[1.55] break-words whitespace-pre-wrap text-dim italic select-text">{text}</div>}
    </div>
  )
}

export const AssistantItem = memo(function AssistantItem({ item, root }: { item: Of<'assistant'>; root?: string }): React.JSX.Element {
  const groups = useMemo(() => groupBlocks(item.blocks), [item.blocks])
  const lastIdx = groups.length - 1
  if (!groups.length) {
    return item.streaming ? (
      <div className="inline-flex items-center gap-1.5 text-[12px] text-dim">
        <span className="sdot in" />
        Đang trả lời…
      </div>
    ) : (
      <div />
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, gi) => {
        const last = gi === lastIdx
        if (g.type === 'text') return g.text.trim() ? <Markdown key={g.index} text={g.text} caret={!!item.streaming && last} /> : null
        if (g.type === 'thinking') return <Thinking key={g.index} text={g.text} active={!!item.streaming && last} />
        return (
          <div key={g.index} className="flex flex-col gap-1">
            {g.blocks.map((b) => (
              <ToolCard key={b.toolUseId} block={b} root={root} />
            ))}
          </div>
        )
      })}
    </div>
  )
})

const NOTICE_TONE = { info: 'text-muted', warn: 'text-wait', error: 'text-danger' } as const

export const NoticeItem = memo(function NoticeItem({ item }: { item: Of<'notice'> }): React.JSX.Element {
  return <div className={`px-2 text-center text-[12px] break-words whitespace-pre-wrap select-text ${NOTICE_TONE[item.level]}`}>{item.text}</div>
})

export const TurnItem = memo(function TurnItem({ item }: { item: Of<'turn'> }): React.JSX.Element | null {
  const line = turnLine(item)
  if (!line) return null
  return <div className="text-center font-mono text-[11px] text-dim/70">{line}</div>
})

/** Một dòng của hội thoại. Mỗi loại là component memo riêng (chỉ mục đổi mới vẽ lại). */
export function ChatRow({
  item,
  agentId,
  root,
  primaryAsk
}: {
  item: ChatItem
  agentId: string
  root?: string
  primaryAsk: string | null
}): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <UserItem item={item} />
    case 'assistant':
      return <AssistantItem item={item} root={root} />
    case 'ask':
      return <AskCard item={item} agentId={agentId} root={root} primary={item.requestId === primaryAsk} />
    case 'notice':
      return <NoticeItem item={item} />
    case 'turn':
      return <TurnItem item={item} />
  }
}
