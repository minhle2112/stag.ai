import type { ReactNode } from 'react'

/** Nút chọn một trong vài chế độ (khối bo tròn, mục đang chọn sáng hơn). */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  className = ''
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label?: ReactNode; tip?: string }>
  className?: string
}): React.JSX.Element {
  return (
    <div className={`flex shrink-0 rounded-md border border-line-2 bg-bg0 p-0.5 ${className}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          data-tip={o.tip}
          aria-pressed={value === o.value}
          className={`flex h-5 items-center gap-1 rounded px-2.5 text-[12px] whitespace-nowrap ${
            value === o.value ? 'bg-panel-3 text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label ?? o.value}
        </button>
      ))}
    </div>
  )
}
