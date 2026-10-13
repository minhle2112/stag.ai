import { useEffect, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../Icon'

/**
 * Ô điều khiển dùng chung cho trang Settings (bản "Xưởng", design/v2/1-xuong.html). Mọi thay đổi lưu ngay (không có nút Lưu).
 * Không có thẻ viền quanh nhóm: mỗi dòng có một vạch chân; mô tả chữ nằm trong chú thích ⓘ (chuỗi) hoặc dòng nhỏ mờ (ReactNode).
 */

// ---- kiểu chữ nhập ----

const FIELD =
  'rounded-md border border-input-line bg-bg px-2 text-fg outline-none placeholder:text-dim focus:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50'
/** Ô một dòng cao 28px. Thêm `w-*` / `flex-1` ở chỗ dùng. */
export const INPUT = `h-7 ${FIELD} text-[13px]`
/** Như INPUT, chữ đơn cách (đường dẫn, tên biến, lệnh). */
export const INPUT_MONO = `h-7 ${FIELD} font-mono text-[12px]`
/** Ô nhiều dòng (chữ đơn cách). */
export const TEXTAREA = `${FIELD} resize-y py-1.5 font-mono text-[12px]`
/** Ô nhiều dòng chữ thường (mô tả, văn bản). */
export const TEXTAREA_TEXT = `${FIELD} resize-y py-1.5 text-[13px]`

// ---- tiêu đề, nhóm, dòng ----

/** Dấu ⓘ: rê chuột để đọc mô tả (thay cho câu giải thích dưới nhãn). */
export function InfoTip({ text, className = '' }: { text: string; className?: string }): React.JSX.Element {
  return (
    <span data-tip={text} className={`inline-flex shrink-0 cursor-help text-dim hover:text-muted ${className}`}>
      <Icon name="info" size="s" />
    </span>
  )
}

/** Tiêu đề trang: 15px/600, mô tả dạng chuỗi nằm trong ⓘ; `right` = công tắc cấp áp dụng / nút hành động. */
export function SectionTitle({ title, desc, right }: { title: ReactNode; desc?: ReactNode; right?: ReactNode }): React.JSX.Element {
  const tip = typeof desc === 'string' ? desc : undefined
  return (
    <div className="mb-2">
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1.5">
        <h1 className="min-w-0 truncate text-[15px] font-semibold">{title}</h1>
        {tip && <InfoTip text={tip} />}
        {right && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
      </div>
      {desc && !tip && <p className="mt-1 text-[12px] leading-relaxed text-dim">{desc}</p>}
    </div>
  )
}

/** Nhóm các dòng cài đặt: tiêu đề nhỏ viết hoa mờ, không có khung. `action` = nút / công tắc ở cuối dòng tiêu đề. */
export function Group({
  title,
  action,
  children,
  flush
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** Không chừa khoảng trống phía trên (nhóm đầu tiên sau thanh công cụ). */
  flush?: boolean
}): React.JSX.Element {
  return (
    <section className={flush ? 'mt-1' : 'mt-5'}>
      {(title || action) && (
        <div className="mb-1 flex min-h-6 items-center gap-2">
          <h5 className="min-w-0 truncate text-[11px] font-semibold tracking-[0.07em] text-dim uppercase">{title}</h5>
          <div className="flex-1" />
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Chấm teal 6px: "dòng này đang ghi đè ở cấp đang chọn". Có `onReset` thì bấm vào để bỏ ghi đè (theo cấp trên). */
export function OverrideDot({ onReset, tip = 'Ghi đè ở cấp này' }: { onReset?: () => void; tip?: string }): React.JSX.Element {
  const dot = <span className="h-1.5 w-1.5 rounded-full bg-accent" />
  if (!onReset) return <span data-tip={tip} className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center">{dot}</span>
  return (
    <button
      type="button"
      data-tip={tip}
      aria-label={tip}
      onClick={(e) => {
        e.preventDefault()
        onReset()
      }}
      className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full hover:bg-accent/20"
    >
      {dot}
    </button>
  )
}

/**
 * Một dòng: nhãn bên trái (mô tả dạng chuỗi nằm trong ⓘ; ReactNode thì hiện dòng nhỏ mờ bên dưới), ô điều khiển bên phải.
 * `sub` = dòng trạng thái luôn hiện. `override` = dòng đang ghi đè ở cấp workspace / agent (chấm teal, bấm để theo cấp trên).
 */
export function Row({
  label,
  desc,
  sub,
  children,
  disabled,
  htmlFor,
  override
}: {
  label: ReactNode
  desc?: ReactNode
  sub?: ReactNode
  children?: ReactNode
  disabled?: boolean
  htmlFor?: string
  override?: { on: boolean; onReset: () => void; parent?: string }
}): React.JSX.Element {
  const tip = typeof desc === 'string' ? desc : undefined
  return (
    <div className={`flex min-h-[46px] items-center gap-4 border-b border-line py-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {override?.on && (
            <OverrideDot
              onReset={override.onReset}
              tip={`Ghi đè ở cấp này · bấm để theo cấp trên${override.parent ? ` (${override.parent})` : ''}`}
            />
          )}
          <label htmlFor={htmlFor} className="min-w-0 text-[13px] font-medium">
            {label}
          </label>
          {tip && <InfoTip text={tip} />}
        </div>
        {sub && <div className="mt-0.5 text-[12px] leading-snug text-dim">{sub}</div>}
        {desc && !tip && <div className="mt-0.5 text-[12px] leading-snug text-dim">{desc}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  )
}

/** Như Row nhưng ô nhập chiếm cả chiều rộng bên dưới nhãn (danh sách nhiều dòng, tham số, biến môi trường…). */
export function RowBlock({
  label,
  desc,
  sub,
  htmlFor,
  children,
  disabled
}: {
  label: ReactNode
  desc?: ReactNode
  sub?: ReactNode
  htmlFor?: string
  children: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  const tip = typeof desc === 'string' ? desc : undefined
  return (
    <div className={`border-b border-line py-2.5 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="min-w-0 text-[13px] font-medium">
          {label}
        </label>
        {tip && <InfoTip text={tip} />}
      </div>
      {desc && !tip && <div className="mt-0.5 text-[12px] leading-snug text-dim">{desc}</div>}
      {sub && <div className="mt-0.5 text-[12px] leading-snug text-dim">{sub}</div>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

// ---- ô điều khiển ----

/** Công tắc 30×17 (bản thiết kế): trượt, nền teal khi bật. */
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
      className={`relative inline-block h-[17px] w-[30px] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-accent bg-accent' : 'border-input-line bg-input-line hover:brightness-110'
      }`}
    >
      <span
        className={`absolute top-[2px] h-[11px] w-[11px] rounded-full transition-[left] ${checked ? 'left-[15px] bg-accent-on' : 'left-[2px] bg-white'}`}
      />
    </button>
  )
}

/**
 * Công tắc có "ghi đè": ở cấp workspace / agent hiện giá trị đang có hiệu lực; bấm công tắc = ghi đè ở cấp này,
 * chấm teal (bấm vào) = bỏ ghi đè để theo cấp trên.
 */
export function OverrideSwitch({
  own,
  inherited,
  onChange,
  disabled,
  label,
  parentLabel
}: {
  /** Giá trị riêng của cấp này (`undefined` = theo cấp trên). */
  own: boolean | undefined
  /** Giá trị của cấp trên. */
  inherited: boolean
  onChange: (v: boolean | undefined) => void
  disabled?: boolean
  label: string
  parentLabel?: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {own !== undefined && (
        <OverrideDot
          onReset={() => onChange(undefined)}
          tip={`Ghi đè ở cấp này · bấm để theo cấp trên (${parentLabel ?? (inherited ? 'bật' : 'tắt')})`}
        />
      )}
      <Switch label={label} checked={own ?? inherited} disabled={disabled} onChange={(v) => onChange(v)} />
    </span>
  )
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
  id,
  compact,
  className
}: {
  value: T
  options: Array<{ value: T; label: string; disabled?: boolean }>
  onChange: (v: T) => void
  disabled?: boolean
  label: string
  id?: string
  /** Bản thấp 26px (hàng tiêu đề, công tắc cấp). */
  compact?: boolean
  /** Thay độ rộng mặc định (`min-w-40`). */
  className?: string
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
      className={`max-w-full rounded-md border border-line-2 bg-bg text-fg outline-none focus:border-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${
        compact ? 'h-[26px] px-1.5 text-[12px]' : 'h-7 px-2 text-[13px]'
      } ${className ?? 'min-w-40'}`}
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
  const btn = 'grid h-full w-[26px] place-items-center text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className={`inline-flex h-7 shrink-0 items-center rounded-md border border-line-2 bg-bg focus-within:border-accent/40 ${disabled ? 'opacity-50' : ''}`}>
      <button type="button" className={`${btn} rounded-l-[5px]`} disabled={disabled || value <= min} onClick={() => commit(value - step)} aria-label={`Giảm ${label}`} data-tip="Giảm">
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
        className="w-[52px] bg-transparent text-center font-mono text-[12px] tabular-nums outline-none"
      />
      {suffix && <span className="pr-1 text-[12px] text-dim">{suffix}</span>}
      <button type="button" className={`${btn} rounded-r-[5px]`} disabled={disabled || value >= max} onClick={() => commit(value + step)} aria-label={`Tăng ${label}`} data-tip="Tăng">
        +
      </button>
    </div>
  )
}

type ButtonVariant = 'default' | 'primary' | 'danger' | 'dangerSolid' | 'ghost'
/** `xs` 22px (thẻ), `sm` 26px (mặc định, bản thiết kế `.btn`), `md` 28px (cùng hàng với ô nhập). */
type ButtonSize = 'xs' | 'sm' | 'md'

const BUTTON_SIZE: Record<ButtonSize, string> = { xs: 'h-[22px] px-2', sm: 'h-[26px] px-2.5', md: 'h-7 px-2.5' }

const BUTTON_TONE: Record<ButtonVariant, string> = {
  default: 'border-line-2 bg-panel-2 font-medium text-fg hover:border-line-3 hover:bg-panel-3',
  primary: 'border-accent bg-accent font-semibold text-accent-on hover:brightness-110',
  danger: 'border-transparent bg-transparent font-medium text-danger hover:bg-danger/12',
  dangerSolid: 'border-danger bg-danger font-semibold text-danger-on hover:brightness-110',
  ghost: 'border-transparent bg-transparent font-medium text-muted hover:bg-panel-3 hover:text-fg'
}

/** Nút 26px của trang Settings (bản thiết kế `.btn`). `variant`: phụ (mặc định) · chính (teal) · nguy hiểm · mờ. */
export function SmallButton({
  children,
  onClick,
  disabled,
  variant = 'default',
  size = 'sm',
  icon,
  tip,
  onBlur
}: {
  children?: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  tip?: string
  onBlur?: () => void
}): React.JSX.Element {
  const button = (
    <button
      type="button"
      onClick={onClick}
      onBlur={onBlur}
      disabled={disabled}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border text-[12px] whitespace-nowrap disabled:pointer-events-none disabled:opacity-40 ${BUTTON_SIZE[size]} ${BUTTON_TONE[variant]}`}
    >
      {icon && <Icon name={icon} size="s" />}
      {children}
    </button>
  )
  // Chú thích đặt ở vỏ ngoài để vẫn hiện khi nút bị khoá.
  return tip ? (
    <span data-tip={tip} className="inline-flex shrink-0">
      {button}
    </span>
  ) : (
    button
  )
}

/** Ô tìm kiếm (bản thiết kế `.srch`). */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  className = ''
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  label?: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-bg0 px-2 focus-within:border-accent/40 ${className}`}>
      <Icon name="search" size="s" className="text-dim" />
      <input
        aria-label={label ?? placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-dim"
      />
    </div>
  )
}

// ---- thẻ (Adapter / Connector / Plugin / Skill) ----

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'
/** Chấm trạng thái: xanh lá = chạy / ổn, hổ phách = cần bạn, đỏ = lỗi, xám = nghỉ / chưa biết. */
export const TONE_DOT: Record<Tone, string> = { ok: 'bg-work', warn: 'bg-wait', bad: 'bg-danger', muted: 'bg-dim' }
const TONE_BADGE: Record<Tone, string> = { ok: 'border-work/40 text-work', warn: 'border-wait/40 text-wait', bad: 'border-danger/40 text-danger', muted: 'border-line-2 text-muted' }

/** Nhãn nhỏ (nguồn, phiên bản, trạng thái). */
export function Badge({ children, tone }: { children: ReactNode; tone?: Tone }): React.JSX.Element {
  return (
    <span className={`shrink-0 rounded border px-1.5 text-[11px] leading-[18px] whitespace-nowrap ${TONE_BADGE[tone ?? 'muted']}`}>{children}</span>
  )
}

/** Lưới thẻ tự xuống dòng, rộng tối thiểu 230px (hoặc `min`). */
export function Tiles({ children, min = 230, className = '' }: { children: ReactNode; min?: number; className?: string }): React.JSX.Element {
  return (
    <div className={`grid gap-2 ${className}`} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` }}>
      {children}
    </div>
  )
}

/**
 * Thẻ: logo 30px, tên, một dòng mô tả mờ (đầy đủ ở chú thích), công tắc / nút bên phải.
 * `dot` = chấm trạng thái trước tên; `alert` = một dòng đỏ (lỗi); `dim` = mờ đi (đang ẩn / tắt).
 */
export function Tile({
  logo,
  title,
  badge,
  sub,
  tip,
  alert,
  dot,
  control,
  onOpen,
  dim,
  mono
}: {
  logo?: ReactNode
  title: ReactNode
  badge?: ReactNode
  sub?: ReactNode
  tip?: string
  alert?: ReactNode
  dot?: Tone
  control?: ReactNode
  onOpen?: () => void
  dim?: boolean
  mono?: boolean
}): React.JSX.Element {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onOpen && e.key === 'Enter' && e.target === e.currentTarget && onOpen()}
      className={`flex min-w-0 items-center gap-2.5 rounded-lg border border-line-2 bg-panel p-2.5 ${onOpen ? 'cursor-pointer hover:border-line-3' : ''}`}
    >
      {logo}
      <div className={`min-w-0 flex-1 ${dim ? 'opacity-50' : ''}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[dot]}`} />}
          <span className={`truncate font-medium ${mono ? 'font-mono text-[12px]' : 'text-[13px]'}`}>{title}</span>
          {badge}
        </div>
        {sub && (
          <div data-tip={tip} className="truncate text-[12px] text-dim">
            {sub}
          </div>
        )}
        {alert && <div className="truncate text-[12px] text-danger">{alert}</div>}
      </div>
      {control && (
        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {control}
        </div>
      )}
    </div>
  )
}

/** Logo 30px chữ cái cho thẻ không có logo riêng (tile tối giản). */
export function LogoTile({ children, bg = 'var(--color-panel-3)', size = 30 }: { children: ReactNode; bg?: string; size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-[7px] border border-line-2 text-[13px] font-bold text-fg"
      style={{ width: size, height: size, background: bg }}
    >
      {children}
    </span>
  )
}

// ---- khối phụ ----

/** Hộp thông báo: info (trung tính) · wait (cần bạn làm gì đó) · danger (lỗi / rủi ro) · ok. */
export function Callout({
  tone = 'info',
  icon,
  children,
  className = ''
}: {
  tone?: 'info' | 'wait' | 'danger' | 'ok'
  icon?: IconName
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const cls = {
    info: 'border-line-2 bg-panel text-muted',
    wait: 'border-wait/30 bg-wait/[0.07] text-wait',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    ok: 'border-work/40 bg-work/10 text-work'
  }[tone]
  return (
    <div className={`flex gap-2 rounded-md border px-3 py-2 text-[12px] leading-relaxed ${cls} ${className}`}>
      {icon && <Icon name={icon} size="s" className="mt-0.5" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Trạng thái rỗng (khung nét đứt). */
export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-line-2 px-6 py-8 text-center">
      <div className="text-[13px] font-medium">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-dim">{children}</div>}
    </div>
  )
}

/** Dòng chú thích cuối trang (mờ, nhỏ). */
export function Note({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <p className={`mt-4 text-[12px] leading-relaxed text-dim ${className}`}>{children}</p>
}

/** Nút "← Tất cả …" ở đầu trang chi tiết. */
export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className="-ml-1.5 mb-3 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-panel-3 hover:text-fg">
      <Icon name="al" size="s" />
      {children}
    </button>
  )
}

/** Đầu trang chi tiết: ← Tất cả …, logo, tên (15px), nhãn, công tắc bên phải, dòng mô tả mờ. */
export function DetailHead({
  onBack,
  backLabel,
  logo,
  title,
  badge,
  control,
  sub,
  mono
}: {
  onBack: () => void
  backLabel: string
  logo?: ReactNode
  title: ReactNode
  badge?: ReactNode
  control?: ReactNode
  sub?: ReactNode
  mono?: boolean
}): React.JSX.Element {
  return (
    <>
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      <div className="mb-2 flex items-center gap-2.5">
        {logo}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className={`min-w-0 truncate text-[15px] font-semibold ${mono ? 'font-mono' : ''}`}>{title}</h2>
            {badge}
          </div>
          {sub && <div className="mt-0.5 text-[12px] leading-snug text-dim">{sub}</div>}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
    </>
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
  return <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
}
