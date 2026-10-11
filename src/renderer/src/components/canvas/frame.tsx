import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Thời gian bay của camera / ô khi phóng to, thu về, xếp gọn. */
export const FLY_MS = 260
export const FLY_EASE = 'cubic-bezier(.2,.75,.25,1)'

/** Những gì một ô cần từ canvas: kéo tiêu đề để di chuyển, nút phóng to / thu về. */
export interface FrameApi {
  /** Gắn vào onMouseDown của thanh tiêu đề ô. */
  startMove: (e: React.MouseEvent) => void
  maximized: boolean
  toggleMax: () => void
}

const noop = (): void => {}
export const FrameCtx = createContext<FrameApi>({ startMove: noop, maximized: false, toggleMax: noop })
export const useFrame = (): FrameApi => useContext(FrameCtx)

/** Kênh phát giá trị nhỏ (mức zoom, vạch gióng) tới đúng một component, không vẽ lại cả canvas mỗi khung hình. */
export interface Emitter<T> {
  get: () => T
  set: (v: T) => void
  sub: (fn: (v: T) => void) => () => void
}

export function emitter<T>(initial: T): Emitter<T> {
  let value = initial
  const subs = new Set<(v: T) => void>()
  return {
    get: () => value,
    set(v) {
      value = v
      subs.forEach((fn) => fn(v))
    },
    sub(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
}

export function useEmitter<T>(em: Emitter<T>): T {
  const [v, setV] = useState(em.get())
  useEffect(() => {
    // Giá trị có thể đã đổi giữa lần vẽ đầu và lúc đăng ký (vd. camera bay về ngay khi thanh công cụ hiện lại).
    setV(em.get())
    return em.sub(setV)
  }, [em])
  return v
}

/**
 * Kéo bằng chuột: gọi `move(dx, dy)` (px màn hình so với lúc bấm) mỗi lần chuột di chuyển, `end()` khi thả. Phủ một lớp
 * trong suốt lên cả cửa sổ trong lúc kéo: chuột đi qua khung widget (iframe) hay terminal thì sự kiện vẫn tới đây.
 */
export function dragWith(e: { clientX: number; clientY: number }, cursor: string, move: (dx: number, dy: number) => void, end: () => void): void {
  const sx = e.clientX
  const sy = e.clientY
  const shield = document.createElement('div')
  shield.style.cssText = `position:fixed;inset:0;z-index:90;cursor:${cursor}`
  document.body.append(shield)
  document.body.style.cursor = cursor
  const onMove = (ev: MouseEvent): void => move(ev.clientX - sx, ev.clientY - sy)
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    shield.remove()
    document.body.style.cursor = ''
    end()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/**
 * Menu nổi gắn vào body, đặt dưới `anchor` (căn phải) hoặc tại điểm (x, y). Ô nằm dưới phần tử có transform (canvas)
 * nên "fixed" trong ô bám theo ô và bị thu nhỏ theo zoom — menu phải ra ngoài. Không đủ chỗ phía dưới thì lật lên.
 */
export function Popover({
  anchor,
  at,
  bounds,
  onClose,
  children
}: {
  anchor?: HTMLElement | null
  at?: { x: number; y: number }
  /** Giữ menu trong khung này (vd. khung canvas, để không rơi lên pane trình duyệt). Mặc định: cửa sổ. */
  bounds?: DOMRect | null
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = bounds ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left: number
    let top: number
    if (anchor) {
      const r = anchor.getBoundingClientRect()
      left = r.right - w
      top = r.bottom + 4 + h > box.bottom ? r.top - 4 - h : r.bottom + 4
    } else {
      left = at?.x ?? 0
      top = at?.y ?? 0
      if (top + h > box.bottom) top = Math.max(box.top, top - h)
    }
    left = Math.max(box.left + 4, Math.min(left, box.right - w - 4))
    top = Math.max(box.top + 4, Math.min(top, box.bottom - h - 4))
    setPos({ left, top })
  }, [anchor, at, bounds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80]"
        onMouseDown={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div ref={ref} className="fixed z-[81]" style={pos ?? { left: -9999, top: -9999 }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body
  )
}
