import { memo, useMemo, useState } from 'react'
import type { ChatBlock } from '@shared/chat'
import { Icon } from '../Icon'
import { jsonEqual } from './chatLogic'
import { Markdown } from './Markdown'
import { clipLines, describeTool, type AskQuestion, type DiffRow, type TodoItem, type ToolDetail, type ToolView } from './toolSummary'

type ToolBlock = Extract<ChatBlock, { type: 'tool' }>

const MONO_BOX = 'rounded bg-bg0 px-2 py-1.5 font-mono text-[12px] leading-[1.5] break-all whitespace-pre-wrap'
const OUTPUT_LINES = 12
const DIFF_ROWS = 40
const WRITE_LINES = 15

/** Trạng thái tool: vòng xoay (đang chạy) / dấu tick xanh / dấu x đỏ. */
export function ToolStatus({ state }: { state: ToolBlock['state'] }): React.JSX.Element {
  if (state === 'running') return <span className="sdot in" data-tip="Đang chạy" />
  if (state === 'ok') return <Icon name="check" size="s" className="text-work" />
  return (
    <span className="inline-flex" data-tip={state === 'denied' ? 'Bị từ chối' : 'Lỗi'}>
      <Icon name="x" size="s" className="text-danger" />
    </span>
  )
}

/** Gập / mở thêm cho khối dài. */
function MoreButton({ open, hidden, onClick }: { open: boolean; hidden: number; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="mt-1 inline-flex items-center gap-1 text-[11px] text-dim hover:text-fg">
      <Icon name="cd" size={12} className={open ? 'rotate-180' : ''} />
      {open ? 'Thu gọn' : `Hiện thêm ${hidden} dòng`}
    </button>
  )
}

/** Output của tool (mono, gập sau 12 dòng). */
function OutputBox({ text, truncated, error }: { text: string; truncated?: boolean; error?: boolean }): React.JSX.Element | null {
  const [all, setAll] = useState(false)
  const c = useMemo(() => clipLines(text, OUTPUT_LINES), [text])
  if (!text.trim()) return null
  return (
    <div>
      <div className={`${MONO_BOX} ${error ? 'text-danger' : 'text-muted'}`}>{all ? text : c.head}</div>
      {c.hidden > 0 && <MoreButton open={all} hidden={c.hidden} onClick={() => setAll(!all)} />}
      {truncated && <div className="mt-1 text-[11px] text-dim">Output đã bị cắt bớt.</div>}
    </div>
  )
}

/** Diff +/- (xanh lá nhạt / đỏ nhạt), gập sau `max` dòng. */
function DiffBox({ rows, max = DIFF_ROWS }: { rows: DiffRow[]; max?: number }): React.JSX.Element {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, max)
  return (
    <div>
      <div className="overflow-hidden rounded bg-bg0 py-1 font-mono text-[12px] leading-[1.5]">
        {shown.map((r, i) =>
          r.t === '~' ? (
            <div key={i} className="my-1 border-t border-dashed border-line-2" />
          ) : (
            <div key={i} className={`flex ${r.t === '+' ? 'bg-work/10 text-work' : r.t === '-' ? 'bg-danger/10 text-danger' : 'text-dim'}`}>
              <span className="w-5 shrink-0 text-center opacity-70 select-none">{r.t === ' ' ? '' : r.t}</span>
              <span className="min-w-0 flex-1 pr-2 break-all whitespace-pre-wrap">{r.s || ' '}</span>
            </div>
          )
        )}
      </div>
      {rows.length > max && <MoreButton open={all} hidden={rows.length - max} onClick={() => setAll(!all)} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
      <span className="shrink-0 text-dim">{label}</span>
      <span className="min-w-0 break-all text-muted">{children}</span>
    </div>
  )
}

function Todos({ items }: { items: TodoItem[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-[12px]">
          <span
            className={`mt-[3px] grid h-3 w-3 shrink-0 place-items-center rounded-[3px] border ${
              t.status === 'completed' ? 'border-work bg-work text-accent-on' : t.status === 'in_progress' ? 'border-accent' : 'border-line-3'
            }`}
          >
            {t.status === 'completed' && <Icon name="check" size={10} />}
          </span>
          <span className={t.status === 'completed' ? 'text-dim line-through' : t.status === 'in_progress' ? 'text-fg' : 'text-muted'}>{t.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Câu hỏi + các lựa chọn (chỉ đọc); nhãn đã chọn được tô viền teal. */
function QuestionsView({ questions, answers }: { questions: AskQuestion[]; answers: Record<string, string> }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      {questions.map((q, i) => {
        const picked = (answers[q.question] ?? '').split(', ')
        return (
          <div key={i} className="flex flex-col gap-1">
            <div className="text-[12px] text-fg">
              {q.header && <span className="mr-1.5 rounded bg-panel-3 px-1.5 py-px text-[11px] text-muted">{q.header}</span>}
              {q.question}
            </div>
            <div className="flex flex-wrap gap-1">
              {q.options.map((o) => (
                <span
                  key={o.label}
                  data-tip={o.description || undefined}
                  className={`rounded border px-1.5 py-0.5 text-[11px] ${picked.includes(o.label) ? 'border-accent/60 text-accent' : 'border-line-2 text-muted'}`}
                >
                  {o.label}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Phần mở rộng của một tool: tham số (lệnh / diff / đường dẫn…) rồi kết quả. Dùng chung cho thẻ tool và thẻ xin quyền. */
export function ToolDetailView({
  detail,
  output,
  truncated,
  error
}: {
  detail: ToolDetail
  output?: string
  truncated?: boolean
  error?: boolean
}): React.JSX.Element {
  const out = output ? <OutputBox text={output} truncated={truncated} error={error} /> : null
  switch (detail.kind) {
    case 'bash':
      return (
        <div className="flex flex-col gap-1.5">
          {detail.description && <div className="text-[12px] text-muted">{detail.description}</div>}
          <div className={`${MONO_BOX} text-fg`}>{detail.command || '…'}</div>
          {out}
        </div>
      )
    case 'read':
      return (
        <div className="flex flex-col gap-1.5">
          <Field label="File">
            <span className="font-mono">{detail.path}</span>
            {detail.range && <span className="ml-2 font-mono text-dim">{detail.range}</span>}
          </Field>
          {out}
        </div>
      )
    case 'edit':
      return (
        <div className="flex flex-col gap-1.5">
          <Field label="File">
            <span className="font-mono">{detail.path}</span>
            {detail.replaceAll && <span className="ml-2 text-dim">thay mọi chỗ</span>}
            {detail.edits > 1 && <span className="ml-2 text-dim">{detail.edits} chỗ sửa</span>}
          </Field>
          <DiffBox rows={detail.rows} />
          {out}
        </div>
      )
    case 'write':
      return (
        <div className="flex flex-col gap-1.5">
          <Field label="File">
            <span className="font-mono">{detail.path}</span>
            <span className="ml-2 text-dim">{detail.lines} dòng</span>
          </Field>
          <DiffBox rows={detail.content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((s): DiffRow => ({ t: '+', s }))} max={WRITE_LINES} />
          {out}
        </div>
      )
    case 'search':
      return (
        <div className="flex flex-col gap-1.5">
          <Field label="Mẫu">
            <span className="font-mono text-fg">{detail.pattern}</span>
          </Field>
          {detail.path && (
            <Field label="Trong">
              <span className="font-mono">{detail.path}</span>
            </Field>
          )}
          {detail.extra && <Field label="Lọc">{detail.extra}</Field>}
          {out}
        </div>
      )
    case 'web':
      return (
        <div className="flex flex-col gap-1.5">
          <Field label={detail.isQuery ? 'Tìm' : 'URL'}>
            <span className="font-mono">{detail.target}</span>
          </Field>
          {detail.prompt && <Field label="Hỏi">{detail.prompt}</Field>}
          {out}
        </div>
      )
    case 'agent':
      return (
        <div className="flex flex-col gap-1.5">
          {detail.description && <div className="text-[12px] text-fg">{detail.description}</div>}
          {detail.subagent && <Field label="Loại">{detail.subagent}</Field>}
          {detail.prompt && <div className={`${MONO_BOX} text-muted`}>{clipLines(detail.prompt, 10).head}</div>}
          {out}
        </div>
      )
    case 'todo':
      return <Todos items={detail.items} />
    case 'questions':
      return <QuestionsView questions={detail.questions} answers={detail.answers} />
    case 'plan':
      return (
        <div className="max-h-[320px] overflow-y-auto">
          <Markdown text={detail.plan} />
        </div>
      )
    case 'text':
      return (
        <div className="flex flex-col gap-1.5">
          <div className="text-[12px] break-words whitespace-pre-wrap text-muted">{detail.text}</div>
          {out}
        </div>
      )
    case 'json':
      return (
        <div className="flex flex-col gap-1.5">
          {detail.json && <div className={`${MONO_BOX} text-muted`}>{clipLines(detail.json, 20).head}</div>}
          {out}
        </div>
      )
  }
}

/** Số thêm / bớt cạnh tên tool: "+3 −1". */
function Stats({ view }: { view: ToolView }): React.JSX.Element | null {
  const s = view.stats
  if (!s || (!s.add && !s.del)) return null
  return (
    <span className="shrink-0 font-mono text-[11px]">
      {s.add > 0 && <span className="text-work">+{s.add}</span>}
      {s.add > 0 && s.del > 0 && ' '}
      {s.del > 0 && <span className="text-danger">−{s.del}</span>}
    </span>
  )
}

/** Mặc định gập cho mọi tool (gọn); mở ra thấy tham số đầy đủ + kết quả. */
export const ToolCard = memo(
  function ToolCard({ block, root }: { block: ToolBlock; root?: string }): React.JSX.Element {
    const view = useMemo(() => describeTool(block.name, block.input, { root }), [block.name, block.input, root])
    const [open, setOpen] = useState(false)
    const failed = block.state === 'error' || block.state === 'denied'
    // Lỗi: hiện sẵn dòng đầu của thông báo ngay dưới thẻ để khỏi phải mở ra mới biết.
    const errLine = failed && block.output ? clipLines(block.output.trim(), 1).head : ''

    return (
      <div className={`overflow-hidden rounded-md border bg-bg ${failed ? 'border-danger/30' : 'border-line hover:border-line-2'}`}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-[26px] w-full items-center gap-2 px-2 text-left text-[12px]"
        >
          <Icon name={view.icon} size="s" className="text-dim" />
          <span className="shrink-0 text-muted @max-[380px]/chat:hidden">{view.label}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-fg/90" data-tip={view.summary.length > 60 ? view.summary : undefined}>
            {view.summary || '…'}
          </span>
          <Stats view={view} />
          <ToolStatus state={block.state} />
          <Icon name="cr" size={12} className={`text-dim transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {!open && errLine && <div className="truncate border-t border-line px-2 py-1 font-mono text-[11px] text-danger/80">{errLine}</div>}
        {open && (
          <div className="border-t border-line p-2">
            <ToolDetailView detail={view.detail} output={block.output} truncated={block.truncated} error={failed} />
            {block.state === 'running' && !block.output && <div className="mt-1.5 text-[11px] text-dim">Đang chạy…</div>}
          </div>
        )}
      </div>
    )
  },
  // Main gửi lại cả mục mỗi lần stream (đối tượng mới sau structured clone): so theo nội dung.
  (a, b) =>
    a.root === b.root &&
    a.block.toolUseId === b.block.toolUseId &&
    a.block.name === b.block.name &&
    a.block.state === b.block.state &&
    a.block.output === b.block.output &&
    a.block.truncated === b.block.truncated &&
    jsonEqual(a.block.input, b.block.input)
)
