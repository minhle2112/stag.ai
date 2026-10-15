import { memo, useEffect, useMemo, useState } from 'react'
import type { ChatItem } from '@shared/chat'
import { useChat } from '../../store/chat'
import { Icon } from '../Icon'
import { Button } from '../Modal'
import { isImeKey } from './chatLogic'
import { Markdown } from './Markdown'
import { ToolDetailView } from './ToolCard'
import { useLocale, useT } from '../../i18n'
import { answersInput, answersOf, askHeadline, describeTool, parseQuestions, planOf, rememberLabel, type AskQuestion, type ToolView } from './toolSummary'

type AskItem = Extract<ChatItem, { kind: 'ask' }>

/** Thẻ đang chờ người dùng: viền hổ phách (màu hổ phách chỉ dành cho thứ chờ bạn) trên nền thẻ. */
const FRAME = 'rounded-xl border border-wait/55 bg-panel-2 p-3'

function Kbd({ children }: { children: string }): React.JSX.Element {
  return <span className="font-mono text-[11px] opacity-60 @max-[420px]/chat:hidden">{children}</span>
}

/** Tiêu đề: chấm chờ (hổ phách nhấp nháy) + "<Agent> muốn chạy lệnh". */
function Head({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-fg">
      <span className="sdot wa" />
      <span className="min-w-0 flex-1 truncate" data-tip={title.length > 40 ? title : undefined}>
        {title}
      </span>
    </div>
  )
}

const answer = (agentId: string, requestId: string, behavior: 'allow' | 'deny', opts?: { remember?: boolean; updatedInput?: unknown }): void =>
  useChat.getState().answer(agentId, requestId, behavior, opts)

/** Xin quyền chạy một tool: lý do, tóm tắt (lệnh / đường dẫn / diff) + Cho phép / Luôn cho phép / Từ chối (bên phải). */
function PermissionAsk({ item, view, agentId, agentName, primary }: { item: AskItem; view: ToolView; agentId: string; agentName: string; primary: boolean }): React.JSX.Element {
  const t = useT()
  const title = askHeadline(agentName, item.tool)
  return (
    <div role="group" aria-label={title} className={FRAME}>
      <Head title={title} />
      {item.reason && item.reason !== view.summary && <div className="mt-1 text-[12px] break-words text-muted">{item.reason}</div>}
      <div className="mt-2">
        <ToolDetailView detail={view.detail} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button primary onClick={() => answer(agentId, item.requestId, 'allow')}>
          {t('common.allow')} {primary && <Kbd>Enter</Kbd>}
        </Button>
        {item.canRemember && (
          <Button onClick={() => answer(agentId, item.requestId, 'allow', { remember: true })}>
            <span className="max-w-[260px] truncate" data-tip={t('chat.ask.rememberTip')}>
              {rememberLabel(item.tool, item.input)}
            </span>
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="danger" onClick={() => answer(agentId, item.requestId, 'deny')}>
          {t('common.deny')} {primary && <Kbd>Esc</Kbd>}
        </Button>
      </div>
    </div>
  )
}

/** Hộp chọn (radio / checkbox) vẽ bằng CSS cho một lựa chọn. */
function Pick({ on, multi }: { on: boolean; multi: boolean }): React.JSX.Element {
  return (
    <span
      className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center border ${multi ? 'rounded-[3px]' : 'rounded-full'} ${
        on ? 'border-accent bg-accent text-accent-on' : 'border-line-3'
      }`}
    >
      {on && <Icon name="check" size={10} />}
    </span>
  )
}

/** Lựa chọn đang dở của thẻ hỏi, theo agent + yêu cầu. */
const askDrafts = new Map<string, { picked: Record<string, string[]>; other: Record<string, string> }>()

/** Agent hỏi chọn đáp án (AskUserQuestion của Claude, request_user_input của Codex). Một câu chọn một: bấm là gửi; còn lại chọn đủ rồi bấm Gửi. */
function QuestionAsk({
  item,
  questions,
  agentId,
  agentName,
  primary
}: {
  item: AskItem
  questions: AskQuestion[]
  agentId: string
  agentName: string
  primary: boolean
}): React.JSX.Element {
  const t = useT()
  const draftKey = `${agentId}:${item.requestId}`
  const [picked, setPicked] = useState<Record<string, string[]>>(() => askDrafts.get(draftKey)?.picked ?? {})
  const [other, setOther] = useState<Record<string, string>>(() => askDrafts.get(draftKey)?.other ?? {})
  // Ô chat bị gỡ khi chuyển tab project: giữ lựa chọn đang dở để gắn lại thì còn.
  useEffect(() => {
    askDrafts.set(draftKey, { picked, other })
  }, [draftKey, picked, other])
  const single = questions.length === 1 && !questions[0].multiSelect

  /** Đáp án cuối của từng câu: các nhãn đã chọn + chữ "Khác" (ghi đè khi chọn một; thêm vào khi chọn nhiều). */
  const finalPicked = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const q of questions) {
      const base = picked[q.question] ?? []
      const o = (other[q.question] ?? '').trim()
      out[q.question] = o ? (q.multiSelect ? [...base, o] : [o]) : base
    }
    return out
  }, [questions, picked, other])
  const complete = questions.length > 0 && questions.every((q) => finalPicked[q.question].length > 0)

  const submit = (p: Record<string, string[]>): void => answer(agentId, item.requestId, 'allow', { updatedInput: answersInput(item.input, p) })

  const choose = (q: AskQuestion, label: string): void => {
    if (single) {
      submit({ [q.question]: [label] })
      return
    }
    setPicked((prev) => {
      const cur = prev[q.question] ?? []
      if (q.multiSelect) return { ...prev, [q.question]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] }
      return { ...prev, [q.question]: [label] }
    })
    // Chọn một nhãn thì bỏ chữ "Khác" của câu một-lựa-chọn để không mâu thuẫn.
    if (!q.multiSelect) setOther((o) => (o[q.question] ? { ...o, [q.question]: '' } : o))
  }

  return (
    <div role="group" aria-label={askHeadline(agentName, 'AskUserQuestion')} className={FRAME}>
      <Head title={askHeadline(agentName, 'AskUserQuestion')} />
      <div className="mt-2 flex flex-col gap-3">
        {questions.map((q) => (
          <div key={q.question} className="flex flex-col gap-1.5">
            <div className="text-[13px] text-fg">
              {q.header && <span className="mr-1.5 rounded bg-panel-3 px-1.5 py-px text-[11px] text-muted">{q.header}</span>}
              {q.question}
              {q.multiSelect && <span className="ml-1.5 text-[11px] text-dim">{t('chat.ask.multi')}</span>}
            </div>
            <div className="flex flex-col gap-1">
              {q.options.map((o) => {
                const on = (picked[q.question] ?? []).includes(o.label) && !(!q.multiSelect && (other[q.question] ?? '').trim())
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => choose(q, o.label)}
                    aria-pressed={on}
                    className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                      on ? 'border-accent/70 bg-accent/10' : 'border-line-2 bg-panel hover:border-line-3 hover:bg-panel-3'
                    }`}
                  >
                    <Pick on={on} multi={q.multiSelect} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-fg">{o.label}</span>
                      {o.description && <span className="block text-[11px] text-muted">{o.description}</span>}
                    </span>
                  </button>
                )
              })}
              <input
                value={other[q.question] ?? ''}
                onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isImeKey({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode }) && complete) {
                    e.preventDefault()
                    submit(finalPicked)
                  }
                }}
                placeholder={t('chat.ask.other')}
                spellCheck={false}
                className="h-7 rounded-md border border-line-2 bg-bg px-2.5 text-[12px] text-fg outline-none placeholder:text-dim focus:border-line-3"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button primary disabled={!complete} onClick={() => submit(finalPicked)}>
          {t('common.send')}
        </Button>
        <span className="flex-1" />
        <Button variant="danger" onClick={() => answer(agentId, item.requestId, 'deny')}>
          {t('chat.ask.skip')} {primary && <Kbd>Esc</Kbd>}
        </Button>
      </div>
    </div>
  )
}

/** Claude xin duyệt kế hoạch (ExitPlanMode): hiện kế hoạch markdown, Duyệt / Từ chối. */
function PlanAsk({ item, agentId, agentName, primary }: { item: AskItem; agentId: string; agentName: string; primary: boolean }): React.JSX.Element {
  const t = useT()
  const plan = planOf(item.input)
  const title = askHeadline(agentName, 'ExitPlanMode')
  return (
    <div role="group" aria-label={title} className={FRAME}>
      <Head title={title} />
      <div className="mt-2 max-h-[340px] overflow-y-auto rounded-lg border border-line bg-bg px-3 py-2">
        {plan ? <Markdown text={plan} /> : <div className="text-[12px] text-dim">{t('chat.ask.noPlan')}</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button primary onClick={() => answer(agentId, item.requestId, 'allow')}>
          {t('chat.ask.approvePlan')}
        </Button>
        <span className="flex-1" />
        <Button variant="danger" onClick={() => answer(agentId, item.requestId, 'deny')}>
          {t('common.deny')} {primary && <Kbd>Esc</Kbd>}
        </Button>
      </div>
    </div>
  )
}

/** Thẻ đã trả lời: thu về một dòng. */
function Resolved({ item, view }: { item: AskItem; view: ToolView }): React.JSX.Element {
  const t = useT()
  const allowed = item.state === 'allowed'
  const cancelled = item.state === 'cancelled'
  let head: string
  let tail = [view.label, view.summary].filter(Boolean).join(' · ')
  if (item.tool === 'AskUserQuestion') {
    head = allowed ? t('chat.ask.answered') : cancelled ? t('chat.ask.questionCancelled') : t('chat.ask.questionSkipped')
    tail = allowed ? Object.values(answersOf(item.input)).join(' · ') : (parseQuestions(item.input)[0]?.question ?? '')
  } else if (item.tool === 'ExitPlanMode') {
    head = allowed ? t('chat.ask.planApproved') : cancelled ? t('chat.ask.cancelled') : t('chat.ask.planDenied')
    tail = ''
  } else {
    head = allowed ? t('chat.ask.allowed') : cancelled ? t('chat.ask.cancelled') : t('chat.ask.denied')
  }
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 text-[12px] text-dim" data-tip={tail.length > 60 ? tail : undefined}>
      <Icon name={allowed ? 'check' : 'x'} size="s" className={allowed ? 'text-work' : cancelled ? 'text-dim' : 'text-danger'} />
      <span className="shrink-0">{head}</span>
      {tail && <span className="min-w-0 truncate font-mono">{tail}</span>}
    </div>
  )
}

/** Thẻ `ask`: xin quyền chạy tool, câu hỏi chọn đáp án, hoặc duyệt kế hoạch — tuỳ `item.tool`. */
export const AskCard = memo(function AskCard({
  item,
  agentId,
  agentName,
  root,
  primary
}: {
  item: AskItem
  agentId: string
  /** Tên agent cho tiêu đề ("Tester muốn chạy lệnh"). */
  agentName: string
  root?: string
  /** Thẻ đang nhận phím tắt Enter / Esc của composer (hiện gợi ý phím). */
  primary: boolean
}): React.JSX.Element {
  const locale = useLocale()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => describeTool(item.tool, item.input, { root }), [item.tool, item.input, root, locale])
  if (item.state !== 'pending') return <Resolved item={item} view={view} />
  if (item.tool === 'AskUserQuestion') {
    const questions = parseQuestions(item.input)
    if (questions.length) return <QuestionAsk item={item} questions={questions} agentId={agentId} agentName={agentName} primary={primary} />
  }
  if (item.tool === 'ExitPlanMode') return <PlanAsk item={item} agentId={agentId} agentName={agentName} primary={primary} />
  return <PermissionAsk item={item} view={view} agentId={agentId} agentName={agentName} primary={primary} />
})
