import { Icon, type IconName } from '../Icon'

/** Nút icon vuông 24px của thanh tiêu đề / thanh công cụ. `on` = đang bật (teal); `badge` = số đếm hổ phách. */
export function IconButton({
  icon,
  tip,
  onClick,
  on,
  badge,
  dot,
  size = 'm',
  className = ''
}: {
  icon: IconName
  tip: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  on?: boolean
  badge?: number
  /** Chấm xanh lá (vd. agent đang điều khiển trình duyệt). */
  dot?: boolean
  size?: 's' | 'm' | 'l'
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={tip}
      aria-label={tip}
      aria-pressed={on === undefined ? undefined : on}
      className={`no-drag relative inline-grid h-6 w-6 shrink-0 place-items-center rounded-md hover:bg-panel-3 hover:text-fg ${on ? 'text-accent' : 'text-muted'} ${className}`}
    >
      <Icon name={icon} size={size} />
      {!!badge && (
        <span className="pointer-events-none absolute top-0 right-0 box-content flex h-3.5 min-w-3.5 translate-x-[42%] -translate-y-[22%] items-center justify-center rounded-full border-[1.5px] border-bg0 bg-wait px-[3px] text-[11px] leading-none font-bold text-[#2a1c00]">
          {badge}
        </span>
      )}
      {dot && <span className="pointer-events-none absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-work" />}
    </button>
  )
}
