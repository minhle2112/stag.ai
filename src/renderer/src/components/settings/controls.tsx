import { useEffect, useState, type ReactNode } from 'react'

/** Ô điều khiển dùng chung cho trang Settings. Mọi thay đổi lưu ngay (không có nút Lưu). */

export function SectionTitle({ title, desc }: { title: string; desc?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-5">
      <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
      {desc && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{desc}</p>}
    </div>
  )
}

/** Nhóm các dòng cài đặt có tiêu đề nhỏ. */
export function Group({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="mb-6">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">{children}</div>
    </section>
  )
}

/** Một dòng: nhãn + mô tả bên trái, ô điều khiển bên phải. */
export function Row({
  label,
  desc,
  children,
  disabled,
  htmlFor
}: {
  label: ReactNode
  desc?: ReactNode
  children?: ReactNode
  disabled?: boolean
  htmlFor?: string
}): React.JSX.Element {
  return (
    <div className={`flex items-center gap-4 px-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[13px]">
          {label}
        </label>
        {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{desc}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** Nhãn cho trình đọc màn hình / kiểm thử. */
  label: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
  id
}: {
  value: T
  options: Array<{ value: T; label: string; disabled?: boolean }>
  onChange: (v: T) => void
  disabled?: boolean
  label: string
  id?: string
}): React.JSX.Element {
  return (
    <select
      id={id}
      aria-label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value)
        if (o) onChange(o.value)
      }}
      className="min-w-40 rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent disabled:cursor-not-allowed"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Ô số có nút −/+. Gõ tay thì lưu khi rời ô / Enter; ngoài khoảng thì kẹp lại. */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  label,
  suffix
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  disabled?: boolean
  label: string
  suffix?: string
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (v: number): void => {
    const n = Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : value
    setText(String(n))
    if (n !== value) onChange(n)
  }
  const btn = 'h-7 w-7 rounded-md bg-panel-2 text-fg hover:bg-line disabled:opacity-40'
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => commit(value - step)} aria-label={`Giảm ${label}`}>
        −
      </button>
      <input
        aria-label={label}
        value={text}
        disabled={disabled}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(Number(text))}
        onKeyDown={(e) => e.key === 'Enter' && commit(Number(text))}
        className="w-12 rounded-md border border-line bg-bg px-1 py-1 text-center tabular-nums outline-none focus:border-accent"
      />
      <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => commit(value + step)} aria-label={`Tăng ${label}`}>
        +
      </button>
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  )
}

export function SmallButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-panel-2 px-3 py-1.5 text-[12.5px] text-fg hover:bg-line disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** Báo lỗi lưu cài đặt (main từ chối, ghi file hỏng…). */
export function useSaveError(): [string, (p: Promise<unknown>) => void] {
  const [error, setError] = useState('')
  const run = (p: Promise<unknown>): void => {
    setError('')
    p.catch((e) => setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  return [error, run]
}

export function ErrorBar({ error }: { error: string }): React.JSX.Element | null {
  if (!error) return null
  return <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">{error}</div>
}
