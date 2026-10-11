import { memo, useEffect, useMemo, useState } from 'react'
import type { ChatBlock, ChatItem } from '@shared/chat'
import { Icon } from '../Icon'
import { Button } from '../Modal'
import { AgentAvatar } from '../ui/AgentAvatar'
import { AskCard } from './AskCard'
import { formatDuration, jsonEqual, stepsActive, stepsSummary, turnLine, type StepEntry, type ViewRow } from './chatLogic'
import { Markdown } from './Markdown'
import { DiffBox, DiffStat, StepRow } from './ToolCard'
import { describeTool, fileChanges, firstLine, mergeFileChanges, shortenPath, stepName, type DiffRow } from './toolSummary'

type Of<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>
type ToolBlock = Extract<ChatBlock, { type: 'tool' }>

/** Tin dài (bàn giao, lời mở): gập sau chừng này dòng / ký tự. */
const LONG_LINES = 10
const LONG_CHARS = 900
/** Chip tên tool tối đa trên dòng tóm tắt khối bước. */
const MAX_CHIPS = 4
/** Dòng diff thu gọn trên thẻ file. */
const MINI_DIFF_ROWS = 4
/** Thẻ file hiện sẵn; nhiều hơn thì gập. */
const FILES_SHOWN = 3

/** Dòng gập mở: chevron xoay + nhãn mờ. */
function Fold({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="inline-flex items-center gap-1 text-[12px] text-dim hover:text-muted">
      <Icon name="cr" size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      {children}
    </button>
  )
}

/** Tin của người dùng / agent khác: bong bóng căn phải (agent khác tông xanh dương kèm avatar + tên). Lời mở của app: dòng gập. */
export const UserItem = memo(function UserItem({ item }: { item: Of<'user'> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const long = item.text.length > LONG_CHARS || item.text.split('\n').length > LONG_LINES

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

  const peer = item.origin === 'agent'
  const collapsed = long && !open
  return (
    <div
      className={`max-w-[82%] self-end rounded-[14px] rounded-br-[4px] px-3 py-2 text-fg ${
        peer ? 'border border-info/25 bg-info/[0.08]' : 'bg-panel-3'
      }`}
    >
      {peer && item.from && (
        <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-info">
          <AgentAvatar name={item.from} size={14} />
          <span className="truncate">{item.from}</span>
        </div>
      )}
      <div className={`relative ${collapsed ? 'max-h-[13.5em] overflow-hidden' : ''}`}>
        <div className="break-words whitespace-pre-wrap">{item.text}</div>
        {collapsed && <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent ${peer ? 'from-panel' : 'from-panel-3'}`} />}
      </div>
      {long && (
        <div className="mt-1">
          <Fold open={open} onClick={() => setOpen(!open)}>
            {open ? 'Thu gọn' : 'Xem hết'}
          </Fold>
        </div>
      )}
      {!!item.images && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
          <Icon name="img" size={12} />+{item.images} ảnh
        </div>
      )}
    </div>
  )
})

const NOTICE_TONE = { info: 'text-muted', warn: 'text-wait', error: 'text-danger' } as const

export const NoticeItem = memo(function NoticeItem({ item }: { item: Of<'notice'> }): React.JSX.Element {
  return <div className={`px-2 text-center text-[12px] break-words whitespace-pre-wrap select-text ${NOTICE_TONE[item.level]}`}>{item.text}</div>
})

// ---------- khối "Đã làm N bước" ----------

/** Lúc renderer thấy mỗi tool bắt đầu chạy (tính "· 14s" cho tool đang chạy; main không gửi giờ bắt đầu). */
const firstSeen = new Map<string, number>()

function seenAt(id: string): number {
  let t = firstSeen.get(id)
  if (t === undefined) {
    t = Date.now()
    firstSeen.set(id, t)
    if (firstSeen.size > 500) firstSeen.delete(firstSeen.keys().next().value as string)
  }
  return t
}

/** Vẽ lại mỗi giây khi `on`. */
function useTick(on: boolean): void {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setN((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

/** Dòng suy nghĩ trong khối bước: dòng đầu mờ, bấm mở toàn văn. */
function ThinkingStep({ text, active }: { text: string; active: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const head = firstLine(text)
  return (
    <div className="border-t border-line">
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-[30px] w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] text-dim italic hover:bg-panel disabled:hover:bg-transparent"
      >
        <span className="min-w-[42px] shrink-0 font-semibold not-italic">Nghĩ</span>
        <span className="min-w-0 flex-1 truncate">{head || 'Đang suy nghĩ…'}</span>
        {active && <span className="sdot in" />}
      </button>
      {open && <div className="border-t border-line bg-panel px-3 py-2 text-[12px] leading-[1.55] break-words whitespace-pre-wrap text-dim italic select-text">{text}</div>}
    </div>
  )
}

/** Chữ cho tool đang chạy: lệnh của Bash, còn lại "Read src/a.ts". */
function runningText(b: ToolBlock, root?: string): string {
  const v = describeTool(b.name, b.input, { root })
  if (b.name === 'Bash') return v.summary || 'lệnh'
  return [stepName(b.name), v.summary].filter(Boolean).join(' ')
}

function entryEqual(a: StepEntry, b: StepEntry): boolean {
  if (a.type !== b.type || a.key !== b.key) return false
  if (a.type === 'thinking' && b.type === 'thinking') return a.text === b.text && a.active === b.active
  if (a.type === 'ask' && b.type === 'ask') return a.item.state === b.item.state && a.item.tool === b.item.tool
  if (a.type === 'tool' && b.type === 'tool') {
    const x = a.block
    const y = b.block
    return x.state === y.state && x.output === y.output && x.truncated === y.truncated && x.name === y.name && jsonEqual(x.input, y.input)
  }
  return false
}

/**
 * Mọi tool + suy nghĩ liên tiếp của một lượt: một dòng "Đã làm N bước" (chip tên tool bên phải), mặc định đóng.
 * Đang chạy thì tự mở và tiêu đề thành "Đang chạy <lệnh> · 14s".
 */
const StepsGroup = memo(
  function StepsGroup({ entries, agentId, agentName, root }: { entries: StepEntry[]; agentId: string; agentName: string; root?: string }): React.JSX.Element {
    const s = useMemo(() => stepsSummary(entries), [entries])
    const active = stepsActive(entries)
    const [userOpen, setUserOpen] = useState<boolean | null>(null)
    const open = userOpen ?? active
    useTick(!!s.running)
    const since = s.running ? Math.max(0, Date.now() - seenAt(s.running.toolUseId)) : 0
    const chips = s.chips.slice(0, MAX_CHIPS)
    const more = s.chips.length - chips.length

    return (
      <div className="overflow-hidden rounded-[10px] border border-line bg-bg">
        <button
          type="button"
          onClick={() => setUserOpen(!open)}
          aria-expanded={open}
          className="flex min-h-[32px] w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-muted hover:text-fg"
        >
          <Icon name="cr" size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          {active ? (
            <>
              <span className="sdot in" />
              <span className="min-w-0 truncate">
                {s.running ? (
                  <>
                    Đang chạy <span className="font-mono text-fg">{runningText(s.running, root)}</span>
                    {since >= 1000 && <> · {formatDuration(since)}</>}
                  </>
                ) : (
                  'Đang suy nghĩ…'
                )}
              </span>
            </>
          ) : (
            <span className="min-w-0 truncate">{s.label}</span>
          )}
          {s.failed > 0 && <span className="shrink-0 text-danger">· {s.failed} lỗi</span>}
          {chips.length > 0 && (
            <span className="ml-auto flex shrink-0 gap-1 @max-[420px]/chat:hidden">
              {chips.map((c) => (
                <span key={c} className="max-w-[110px] truncate rounded-full bg-panel-3 px-1.5 py-px font-mono text-[10.5px] text-muted">
                  {c}
                </span>
              ))}
              {more > 0 && <span className="rounded-full bg-panel-3 px-1.5 py-px font-mono text-[10.5px] text-dim">+{more}</span>}
            </span>
          )}
        </button>
        {open &&
          entries.map((e) =>
            e.type === 'tool' ? (
              <StepRow key={e.key} block={e.block} root={root} />
            ) : e.type === 'thinking' ? (
              <ThinkingStep key={e.key} text={e.text} active={e.active} />
            ) : (
              <div key={e.key} className="border-t border-line px-1.5 py-1.5">
                <AskCard item={e.item} agentId={agentId} agentName={agentName} root={root} primary={false} />
              </div>
            )
          )}
      </div>
    )
  },
  (a, b) =>
    a.agentId === b.agentId &&
    a.agentName === b.agentName &&
    a.root === b.root &&
    a.entries.length === b.entries.length &&
    a.entries.every((e, i) => entryEqual(e, b.entries[i]))
)

// ---------- thẻ file đã sửa ----------

/** Một file đã sửa trong lượt: tên, +/−, nút Mở, vài dòng diff (bấm để xem hết). */
function FileCard({ path, rows, add, del, root, wsId }: { path: string; rows: DiffRow[]; add: number; del: number; root?: string; wsId: string }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const changed = useMemo(() => rows.filter((r) => r.t === '+' || r.t === '-'), [rows])
  const mini = changed.slice(0, MINI_DIFF_ROWS)
  const name = shortenPath(path, root)
  const open = (): void => {
    setErr(null)
    window.stag.artifacts.open(wsId, path).catch((e: unknown) => setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)))
  }
  const errLabel = err && /ngoài dự án/.test(err) ? 'File nằm ngoài dự án' : 'Không mở được file'
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <Icon name="file" size="s" className="shrink-0 text-dim" />
        <span className="min-w-0 truncate font-mono text-[12px] text-fg" data-tip={name !== path ? path : undefined}>
          {name}
        </span>
        <DiffStat add={add} del={del} />
        <span className="flex-1" />
        {err && (
          <span className="min-w-0 truncate text-[11px] text-danger" data-tip={err}>
            {errLabel}
          </span>
        )}
        <Button small onClick={open}>
          Mở
        </Button>
      </div>
      {all ? (
        <div className="border-t border-line bg-bg p-2">
          <DiffBox rows={rows} />
          <button type="button" onClick={() => setAll(false)} className="mt-1 text-[11px] text-dim hover:text-fg">
            Thu gọn
          </button>
        </div>
      ) : (
        mini.length > 0 && (
          <button type="button" onClick={() => setAll(true)} data-tip="Xem hết diff" className="block w-full border-t border-line bg-bg py-0.5 text-left font-mono text-[11.5px] leading-[1.6]">
            {mini.map((r, i) => (
              <div key={i} className={`truncate px-2.5 whitespace-pre ${r.t === '+' ? 'bg-work/[0.08] text-[#9fe8bd]' : 'bg-danger/[0.08] text-[#f2a39c]'}`}>
                {r.t}
                {r.s || ' '}
              </div>
            ))}
            {changed.length > mini.length && <div className="px-2.5 font-sans text-[11px] text-dim">+{changed.length - mini.length} dòng nữa…</div>}
          </button>
        )
      )}
    </div>
  )
}

const FilesCard = memo(
  function FilesCard({ tools, root, wsId }: { tools: ToolBlock[]; root?: string; wsId: string }): React.JSX.Element | null {
    const files = useMemo(() => mergeFileChanges(tools.flatMap((t) => fileChanges(t.name, t.input))), [tools])
    const [all, setAll] = useState(false)
    if (!files.length) return null
    const shown = all ? files : files.slice(0, FILES_SHOWN)
    return (
      <div className="overflow-hidden rounded-[10px] border border-line-2 bg-panel-2">
        {shown.map((f) => (
          <FileCard key={f.path} path={f.path} rows={f.rows} add={f.add} del={f.del} root={root} wsId={wsId} />
        ))}
        {files.length > FILES_SHOWN && (
          <button type="button" onClick={() => setAll(!all)} className="block w-full border-t border-line px-2.5 py-1 text-left text-[11px] text-dim hover:text-fg">
            {all ? 'Thu gọn' : `+${files.length - FILES_SHOWN} file khác`}
          </button>
        )}
      </div>
    )
  },
  (a, b) => a.root === b.root && a.wsId === b.wsId && a.tools.length === b.tools.length && a.tools.every((t, i) => t.toolUseId === b.tools[i].toolUseId)
)

// ---------- cuối lượt ----------

/** "1m 42s · $0,21" + nút chép chữ trả lời của lượt. */
const MetaLine = memo(function MetaLine({ turn, copyText }: { turn: Of<'turn'> | null; copyText: string }): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const line = turn ? turnLine(turn) : null
  const failed = !!turn && turn.outcome !== 'success'
  if (!line && !copyText) return null
  return (
    <div className={`flex items-center gap-2 text-[11px] ${failed ? 'text-wait' : 'text-dim'}`}>
      {line && <span className="font-mono">{line}</span>}
      {copyText && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(copyText)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          data-tip={copied ? 'Đã chép' : 'Chép câu trả lời'}
          aria-label="Chép câu trả lời"
          className="inline-flex h-5 items-center gap-1 rounded px-1 text-dim hover:bg-panel-3 hover:text-fg"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
        </button>
      )}
    </div>
  )
})

const TextRow = memo(function TextRow({ text, caret }: { text: string; caret: boolean }): React.JSX.Element {
  return <Markdown text={text} caret={caret} />
})

export interface RowCtx {
  agentId: string
  agentName: string
  wsId: string
  root?: string
  primaryAsk: string | null
}

/** Một dòng của hội thoại (đã gom bằng buildRows). */
export function ChatRow({ row, ctx }: { row: ViewRow; ctx: RowCtx }): React.JSX.Element | null {
  switch (row.type) {
    case 'user':
      return <UserItem item={row.item} />
    case 'notice':
      return <NoticeItem item={row.item} />
    case 'ask':
      return <AskCard item={row.item} agentId={ctx.agentId} agentName={ctx.agentName} root={ctx.root} primary={row.item.requestId === ctx.primaryAsk} />
    case 'text':
      return <TextRow text={row.text} caret={row.caret} />
    case 'answering':
      return (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-dim">
          <span className="sdot in" />
          Đang trả lời…
        </div>
      )
    case 'steps':
      return <StepsGroup entries={row.entries} agentId={ctx.agentId} agentName={ctx.agentName} root={ctx.root} />
    case 'files':
      return <FilesCard tools={row.tools} root={ctx.root} wsId={ctx.wsId} />
    case 'meta':
      return <MetaLine turn={row.turn} copyText={row.copyText} />
  }
}
