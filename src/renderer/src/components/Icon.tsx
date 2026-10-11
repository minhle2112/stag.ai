import { ICONS, type IconName } from './icons'

export type { IconName }

const SIZE = { s: 14, m: 16, l: 18 } as const

/**
 * Icon của app (nét 1.5px ở mọi cỡ). `s` = 14px, `m` = 16px (mặc định), `l` = 18px.
 * Màu theo `currentColor`: đặt màu bằng class `text-*` của phần tử cha.
 */
export function Icon({ name, size = 'm', className = '' }: { name: IconName; size?: keyof typeof SIZE | number; className?: string }): React.JSX.Element {
  const px = typeof size === 'number' ? size : SIZE[size]
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`ic shrink-0 ${className}`}
      // Chuỗi SVG tĩnh trong icons.ts (không có dữ liệu người dùng).
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
