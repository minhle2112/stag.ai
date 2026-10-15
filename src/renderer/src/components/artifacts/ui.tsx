// Mảnh giao diện dùng chung của tab Sản phẩm.
import { useCallback, useEffect, useRef, useState } from 'react'
import { initials } from '@shared/artifacts'
import { fmtTime, t, type PlainKey } from '@shared/i18n'

/**
 * Màu riêng cho từng agent ở tab Sản phẩm: không trùng màu trạng thái của app (teal = thao tác / nháp, xanh lá = đang
 * chạy / đã sửa, hổ phách = cần bạn, đỏ = lỗi, xanh dương = thay đổi). Chọn theo tên nên mỗi agent luôn một màu.
 */
const PALETTE = ['#9aa7ff', '#c79bff', '#ff8fb4', '#e3b38a', '#d6a6d0', '#a9b7c9', '#b8c4ff', '#e7a3a3']

export function productColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Ô chữ tắt có màu của agent (2 ký tự). */
export function ProductAvatar({ name, small }: { name: string; small?: boolean }): React.JSX.Element {
  const c = productColor(name)
  const size = small ? 15 : 18
  return (
    <span
      aria-hidden
      title={name}
      className="inline-grid shrink-0 place-items-center font-bold tracking-[0.02em]"
      style={{
        width: size,
        height: size,
        borderRadius: small ? 4 : 5,
        fontSize: small ? 8 : 9,
        // Tối: đúng màu agent; sáng: pha với màu chữ (--avatar-ink trong styles.css) để đọc được trên nền pastel.
        color: `color-mix(in srgb, ${c} var(--avatar-ink), var(--color-fg))`,
        background: `color-mix(in srgb, ${c} 18%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`
      }}
    >
      {initials(name)}
    </span>
  )
}

const PATHS = {
  cmt: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
  pin: (
    <>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6.5" r="1.5" fill="currentColor" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  pen: <path d="M3 13l1-3.2 6.5-6.5 2.2 2.2L6.2 12z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />,
  warn: (
    <>
      <path d="M8 2.5l6 10.5H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.2v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  play: <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />,
  cell: <path d="M2.5 3.5h11v9h-11zM2.5 6.5h11M6.5 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.2" />
} as const

export type MiniIconName = keyof typeof PATHS

/** Biểu tượng 13px của tab Sản phẩm (SVG nét 1.3 như bản thiết kế). */
export function Mi({ name, className = '' }: { name: MiniIconName; className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} aria-hidden className={`inline-block shrink-0 align-[-2px] ${className}`}>
      {PATHS[name]}
    </svg>
  )
}

export const BTN = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-line-2 bg-panel px-2.5 py-1 text-[12px] text-fg hover:bg-panel-2 disabled:opacity-45'
export const BTN_PRI = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-accent bg-accent px-2.5 py-1 text-[12px] font-semibold text-accent-on hover:brightness-110 disabled:opacity-45'
export const BTN_GHOST = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-1 text-[12px] text-muted hover:bg-panel-2 hover:text-fg'

/** Công tắc nhỏ kiểu bản thiết kế. */
export function Switch({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className={`relative inline-block h-[14px] w-[26px] shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line-2'}`}>
      <span className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all ${on ? 'left-[14px] bg-accent-on' : 'left-[2px] bg-muted'}`} />
    </span>
  )
}

/** Thông báo ngắn ở đáy màn hình (tự tắt sau ~2.6 s). */
export function useToast(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((t: string) => {
    setText(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setText(null), 2600)
  }, [])
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const node = (
    <div
      role="status"
      className={`pointer-events-none fixed bottom-8 left-1/2 z-50 max-w-[560px] -translate-x-1/2 rounded-lg border border-line-3 bg-panel-3 px-3.5 py-2 text-center text-[12.5px] shadow-float transition-opacity ${text ? 'opacity-100' : 'opacity-0'}`}
    >
      {text}
    </div>
  )
  return [node, show]
}

/** "hôm nay 11:38" / "hôm qua 21:14" / "T7 11/10 18:20". */
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const hm = fmtTime(d)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= start) return t('artifacts.when.today', { time: hm })
  if (d.getTime() >= start - 86_400_000) return t('artifacts.when.yesterday', { time: hm })
  return `${dayLabel(d)} ${hm}`
}

/** "T7 11/10" / "Sat 10/11". */
function dayLabel(d: Date): string {
  const wd = t('artifacts.when.weekdays').split(' ')[d.getDay()]
  return t('artifacts.when.date', { wd, d: String(d.getDate()), m: String(d.getMonth() + 1) })
}

/** Giờ ngắn cho dòng việc: hôm nay "15:05", trước đó "hôm qua" / "T7 11/10". */
export function shortWhen(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= start) return fmtTime(d)
  if (d.getTime() >= start - 86_400_000) return t('artifacts.when.yesterdayShort')
  return dayLabel(d)
}

/** Loại sản phẩm (nhãn trên thẻ). */
export function typeLabel(kind: string): string {
  const key = TYPE_LABELS[kind]
  return t(key ?? 'artifacts.type.other')
}

const TYPE_LABELS: Record<string, PlainKey | undefined> = {
  markdown: 'artifacts.type.markdown',
  text: 'artifacts.type.text',
  image: 'artifacts.type.image',
  video: 'artifacts.type.video',
  audio: 'artifacts.type.audio',
  pdf: 'artifacts.type.pdf',
  docx: 'artifacts.type.docx',
  sheet: 'artifacts.type.sheet',
  pptx: 'artifacts.type.pptx',
  html: 'artifacts.type.html',
  zip: 'artifacts.type.zip',
  font: 'artifacts.type.font'
}
