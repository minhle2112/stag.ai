import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Tip {
  text: string
  /** Điểm neo: giữa cạnh dưới phần tử (side = 'bottom') hoặc giữa cạnh phải (side = 'right'). */
  x: number
  y: number
  side: 'bottom' | 'right'
}

/**
 * Chú thích nổi dùng chung cho cả app: đọc `data-tip` (hoặc `title` của mọi phần tử, tạm gỡ lúc rê chuột để
 * Chromium không hiện chú thích gốc). `data-tip-side="right"` đặt chú thích bên phải phần tử (hàng ở thanh bên).
 */
export function Tooltips(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let current: HTMLElement | null = null
    let restore: (() => void) | null = null

    const hide = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      restore?.()
      restore = null
      current = null
      setTip(null)
    }

    const onOver = (e: MouseEvent): void => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-tip],[title]') ?? null
      if (el === current) return
      hide()
      if (!el) return
      current = el
      const title = el.getAttribute('title')
      if (title) {
        el.removeAttribute('title')
        restore = () => el.setAttribute('title', title)
      }
      const text = el.getAttribute('data-tip') || title
      if (!text) return
      timer = setTimeout(() => {
        if (!el.isConnected) return
        const r = el.getBoundingClientRect()
        const side = el.getAttribute('data-tip-side') === 'right' ? 'right' : 'bottom'
        setTip(
          side === 'right'
            ? { text, side, x: r.right + 8, y: r.top + r.height / 2 }
            : { text, side, x: r.left + r.width / 2, y: r.bottom + 6 }
        )
      }, 380)
    }

    window.addEventListener('mouseover', onOver)
    window.addEventListener('mousedown', hide, true)
    window.addEventListener('blur', hide)
    window.addEventListener('wheel', hide, { passive: true })
    return () => {
      hide()
      window.removeEventListener('mouseover', onOver)
      window.removeEventListener('mousedown', hide, true)
      window.removeEventListener('blur', hide)
      window.removeEventListener('wheel', hide)
    }
  }, [])

  // Giữ chú thích trong cửa sổ: dịch vào khi tràn mép phải / dưới.
  useLayoutEffect(() => {
    const el = box.current
    if (!tip || !el) return
    const r = el.getBoundingClientRect()
    let dx = 0
    let dy = 0
    if (r.right > window.innerWidth - 8) dx = window.innerWidth - 8 - r.right
    if (r.left + dx < 8) dx = 8 - r.left
    if (r.bottom > window.innerHeight - 8) dy = -(r.height + (tip.side === 'bottom' ? 30 : 0))
    el.style.translate = `${dx}px ${dy}px`
  }, [tip])

  if (!tip) return null
  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[200] w-max max-w-[360px] rounded-md border border-line-2 bg-panel-3 px-2 py-1 text-[12px] leading-snug whitespace-pre-line text-fg shadow-[0_6px_18px_rgba(0,0,0,.45)]"
      style={{ left: tip.x, top: tip.y, transform: tip.side === 'right' ? 'translateY(-50%)' : 'translateX(-50%)' }}
    >
      {tip.text}
    </div>
  )
}
