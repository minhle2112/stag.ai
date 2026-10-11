import { useEffect, type ReactNode } from 'react'
import { useUi } from '../store/ui'
import { Icon, type IconName } from './Icon'

interface Props {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
  width?: string
  /** Icon trước tiêu đề. */
  icon?: IconName
  /** Viền + tiêu đề hổ phách (agent cần bạn quyết) hoặc teal (agent xin làm việc trên app). */
  tone?: 'wait' | 'accent'
}

/** Hộp thoại giữa màn hình (bản thiết kế "Xưởng"): đầu 44px có nút đóng, thân cuộn được, chân nền sâu hơn. */
export function Modal({ title, children, footer, onClose, width = 'w-[560px]', icon, tone }: Props): React.JSX.Element {
  useEffect(() => {
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(3,4,6,.66)]" onMouseDown={onClose}>
      <div
        className={`${width} flex max-h-[84vh] max-w-[94vw] flex-col overflow-hidden rounded-[10px] border bg-panel shadow-[0_24px_70px_rgba(0,0,0,.7)] ${
          tone === 'wait' ? 'border-wait/60' : tone === 'accent' ? 'border-accent/40' : 'border-line-2'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={`flex min-h-11 shrink-0 items-center gap-2 border-b border-line py-2.5 pr-3 pl-3.5 text-[14px] font-semibold ${
            tone === 'wait' ? 'text-wait' : tone === 'accent' ? 'text-accent' : ''
          }`}
        >
          {icon && <Icon name={icon} />}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              data-tip="Đóng · Esc"
              aria-label="Đóng"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
            >
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto p-3.5 select-text">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-bg px-3.5 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}

type ButtonVariant = 'default' | 'ghost' | 'danger'

/**
 * Nút: chính (teal, `primary`), phụ (mặc định), mờ (`variant="ghost"`), nguy hiểm (`variant="danger"`;
 * kèm `primary` = nền đỏ đặc cho hành động huỷ bỏ dữ liệu).
 */
export function Button({
  children,
  onClick,
  primary,
  disabled,
  variant = 'default',
  small
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  variant?: ButtonVariant
  small?: boolean
}): React.JSX.Element {
  const tone =
    variant === 'danger'
      ? primary
        ? 'border-danger bg-danger font-semibold text-[#240a07] hover:brightness-110'
        : 'border-transparent bg-transparent text-danger hover:bg-danger/12'
      : primary
        ? 'border-accent bg-accent font-semibold text-accent-on hover:brightness-110'
        : variant === 'ghost'
          ? 'border-transparent bg-transparent text-muted hover:bg-panel-3 hover:text-fg'
          : 'border-line-2 bg-panel-2 font-medium text-fg hover:border-line-3 hover:bg-panel-3'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border whitespace-nowrap disabled:opacity-40 ${small ? 'h-[22px] px-2 text-[12px]' : 'h-7 px-3 text-[12.5px]'} ${tone}`}
    >
      {children}
    </button>
  )
}
