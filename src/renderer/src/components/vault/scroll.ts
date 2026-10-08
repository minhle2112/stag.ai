import { headingKey } from './markdown'

/** Chỗ cần cuộn tới sau khi note hiện ra. */
export type ScrollTarget = { top: number } | { heading: string; flash?: boolean } | { line: number; flash?: boolean }

/** Khối có `data-line` gần nhất phía trên (hoặc đúng) dòng `line`; khối lồng nhau thì lấy khối trong cùng. */
export function findLineEl(root: HTMLElement, line: number): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestLine = -1
  for (const el of root.querySelectorAll<HTMLElement>('[data-line]')) {
    const n = Number(el.dataset.line)
    if (n <= line && n >= bestLine) {
      best = el
      bestLine = n
    }
  }
  return best
}

/** Heading theo chữ (`[[note#A#B]]` → lấy `B`), không phân biệt hoa thường; khớp cả `id`. */
export function findHeadingEl(root: HTMLElement, heading: string): HTMLElement | null {
  const last = heading.split('#').filter(Boolean).pop() ?? heading
  const want = headingKey(last)
  // Chỉ heading (link cũng có `data-heading`).
  for (const el of root.querySelectorAll<HTMLElement>(':is(h1, h2, h3, h4, h5, h6)[data-heading]')) {
    if (headingKey(el.dataset.heading ?? '') === want || el.id === last.toLowerCase()) return el
  }
  return null
}

/** Tô sáng thoáng qua (lớp `md-flash` trong styles.css). */
export function flash(el: HTMLElement): void {
  el.classList.remove('md-flash')
  void el.offsetWidth // khởi động lại animation
  el.classList.add('md-flash')
  setTimeout(() => el.classList.remove('md-flash'), 1600)
}

export function scrollToTarget(scroller: HTMLElement, body: HTMLElement, t: ScrollTarget): void {
  if ('top' in t) {
    scroller.scrollTop = t.top
    return
  }
  const el = 'heading' in t ? findHeadingEl(body, t.heading) : findLineEl(body, t.line)
  if (!el) {
    scroller.scrollTop = 0
    return
  }
  el.scrollIntoView({ block: 'heading' in t ? 'start' : 'center' })
  if (t.flash) flash(el)
}
