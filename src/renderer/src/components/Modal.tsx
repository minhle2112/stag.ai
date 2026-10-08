import { useEffect, type ReactNode } from 'react'
import { useUi } from '../store/ui'

interface Props {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose?: () => void
  width?: string
}

export function Modal({ title, children, footer, onClose, width = 'w-[560px]' }: Props): React.JSX.Element {
  useEffect(() => {
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className={`${width} max-h-[85vh] overflow-hidden rounded-lg border border-line bg-panel shadow-2xl flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line px-5 py-3 text-[14px] font-semibold">{title}</div>
        <div className="min-h-0 overflow-y-auto px-5 py-4 select-text">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Button({
  children,
  onClick,
  primary,
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 disabled:opacity-40 ${
        primary ? 'bg-accent text-[#0b1220] font-medium hover:brightness-110' : 'bg-panel-2 text-fg hover:bg-line'
      }`}
    >
      {children}
    </button>
  )
}
