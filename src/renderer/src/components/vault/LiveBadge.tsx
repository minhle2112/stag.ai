import { useEffect, useRef } from 'react'
import { ago } from '../../status'
import { agentInitial, avatarColor, LIVE_MS, type NoteTouch } from './activity'

export const kindLabel = (k: 'read' | 'write'): string => (k === 'write' ? 'ghi' : 'đọc')

/** "Kiên đang ghi note này" (vừa làm) hoặc "Kiên ghi note này · 5 phút trước". */
export function touchTip(t: NoteTouch, now: number): string {
  if (now - Date.parse(t.at) < LIVE_MS) return `${t.agentName} đang ${kindLabel(t.kind)} note này`
  const when = ago(t.at, now)
  return `${t.agentName} ${kindLabel(t.kind)} note này · ${when === 'vừa xong' ? when : `${when} trước`}`
}

/**
 * Huy hiệu agent đang đọc / ghi note: ô vuông chữ cái màu avatar của agent; vòng ngoài đập nhịp khi vừa làm
 * (LIVE_MS). Ghi = ô đặc, đọc = ô rỗng viền màu. Hết "gần đây" thì không còn được vẽ ở chỗ gọi.
 */
export function LiveBadge({ touch, now, size = 16 }: { touch: NoteTouch; now: number; size?: number }): React.JSX.Element {
  const color = avatarColor(touch.agentName)
  const live = now - Date.parse(touch.at) < LIVE_MS
  const write = touch.kind === 'write'
  const ring = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ring.current
    if (!live || !el) return
    const anim = el.animate(
      [
        { opacity: 0.9, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(1.5)' }
      ],
      { duration: 1400, iterations: Infinity }
    )
    return () => anim.cancel()
  }, [live])
  return (
    <span
      data-tip={touchTip(touch, now)}
      className={`relative inline-grid shrink-0 place-items-center rounded font-bold ${write ? 'text-[#0b0d10]' : ''} ${live ? '' : 'opacity-60'}`}
      style={{
        width: size,
        height: size,
        fontSize: 11,
        lineHeight: 1,
        background: write ? color : 'transparent',
        color: write ? undefined : color,
        boxShadow: write ? undefined : `inset 0 0 0 1px ${color}`
      }}
    >
      {agentInitial(touch.agentName)}
      {live && <span ref={ring} aria-hidden className="pointer-events-none absolute -inset-[3px] rounded-md border" style={{ borderColor: color }} />}
    </span>
  )
}

/** Dãy huy hiệu (tối đa `max`, còn lại gộp thành "+n"). */
export function LiveBadges({ touches, now, max = 2, size = 16 }: { touches: NoteTouch[]; now: number; max?: number; size?: number }): React.JSX.Element | null {
  if (!touches.length) return null
  const rest = touches.length - max
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {touches.slice(0, max).map((t) => (
        <LiveBadge key={t.agentId} touch={t} now={now} size={size} />
      ))}
      {rest > 0 && (
        <span data-tip={touches.slice(max).map((t) => touchTip(t, now)).join('\n')} className="font-mono text-[11px] text-dim">
          +{rest}
        </span>
      )}
    </span>
  )
}
