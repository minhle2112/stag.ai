// Lớp Soi của trang trong ô Browser (chế độ Soi). Preload riêng của mỗi tab, chạy trong thế giới cô lập
// (contextIsolation): trang không đọc / gọi được gì ở đây, chỉ dùng chung DOM. Không cài gì lên `window` của trang.
// Vẽ mọi thứ (viền rê chuột, nhãn, ghim, hộp bình luận) trong một shadow root đóng.
// Nói chuyện với main qua PAGE_IPC (xem src/shared/inspect.ts, src/main/inspect.ts).
import { ipcRenderer } from 'electron'
import { agentColor, PAGE_IPC, type AnchorUpdate, type CaptureResult, type InspectGroup, type InspectSource, type InspectTarget, type PageCmd, type PagePin, type PageState, type PinPlace, type SaveInput } from '@shared/inspect'
import { classKey, parseSrc, tagKey, type StaticTag } from '@shared/inspectSource'
import { initials } from '@shared/artifacts'

if (window.top === window) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start(), { once: true })
  else start()
}

// ---------- trạng thái ----------

let state: PageState = { on: false, viewport: 'desk', pins: [], agents: [], lastAgentId: null }
let host: HTMLElement
let root: ShadowRoot
let layer: HTMLDivElement
let ovl: HTMLDivElement
let tagEl: HTMLDivElement
let pickEl: HTMLDivElement
let peekEl: HTMLDivElement
let pinsEl: HTMLDivElement
let toastEl: HTMLDivElement
let cursorStyle: HTMLStyleElement | null = null
/** Phần tử đang rê chuột. */
let cur: Element | null = null
/** Hộp bình luận đang mở. */
let cmp: Composer | null = null
let pendingReload = false
let reloadTimer = 0
let lastUrl = ''
let lastPlaces = ''
let peekId: number | null = null
let flashTimer = 0
/** Phần tử tìm được cho từng ghim (chỉ là bộ nhớ đệm: node mất thì dò lại theo selector / đường dẫn). */
const found = new Map<number, Element | null>()
/** Nút ghim đang vẽ, theo số (cập nhật chỗ thay vì vẽ lại: bấm ghim ngay sau khi gõ không bị mất). */
const pinNodes = new Map<number, HTMLButtonElement>()
/** Khoá mới đã báo main (tránh báo lặp). */
const anchored = new Map<number, string>()

interface Composer {
  el: Element
  /** Ngữ cảnh lúc mở hộp (dò lại phần tử nếu node bị thay). */
  target: InspectTarget
  /** Điểm bấm trong phần tử (0..1). */
  pt: { x: number; y: number }
  /** Bình luận chờ gửi có sẵn của phần tử này. */
  draftId?: number
  /** Chữ / agent của bình luận chờ gửi lúc mở (đóng hộp mà không đổi gì thì không ghi lại). */
  saved: { text: string; agentId: string }
  text: string
  agentId: string
  menu: boolean
  focus: number
  /** Hộp đang ẩn vì phần tử cuộn khuất (cuộn lại thì trả con trỏ về ô chữ). */
  hid: boolean
  box: HTMLDivElement
  ta: HTMLTextAreaElement
  who: HTMLDivElement
  /** Nút "Thêm". */
  add: HTMLButtonElement
}

function start(): void {
  host = document.createElement('stag-inspect')
  host.setAttribute('style', 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block')
  root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  root.appendChild(style)
  layer = div('layer')
  ovl = div('ovl')
  tagEl = div('tag')
  pickEl = div('ovl pick')
  peekEl = div('ovl peek')
  pinsEl = div('pins')
  toastEl = div('toast')
  layer.append(ovl, pickEl, peekEl, tagEl, pinsEl)
  root.append(layer, toastEl)
  document.documentElement.appendChild(host)
  // Trang thay cả <html> / xoá phần tử lạ: gắn lại. HMR thay node: vẽ lại để dò lại ghim.
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.appendChild(host)
    schedule()
  }).observe(document.documentElement, { childList: true, subtree: true })

  // Phím gõ trong hộp bình luận không lọt ra trang (phím tắt của trang).
  for (const t of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut'] as const) host.addEventListener(t, (e) => e.stopPropagation())

  window.addEventListener('mousemove', onMove, { capture: true, passive: true })
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const)
    window.addEventListener(t, onPointer, { capture: true })
  window.addEventListener('keydown', onKey, { capture: true })
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  document.addEventListener('mouseleave', hideHover)

  // Chỉ có trong thế giới cô lập (trang không thấy): xem trạng thái khi thử bằng CDP.
  ;(globalThis as Record<string, unknown>).__stagInspect = () => ({
    state,
    cmds: cmdLog,
    cmp: cmp && { el: label(cmp.el), text: cmp.text, agentId: cmp.agentId, menu: cmp.menu, hid: cmp.hid },
    cur: cur && label(cur),
    found: [...found].map(([k, v]) => [k, v && label(v)])
  })
  // Shadow root đóng: thử bằng CDP thì bắn sự kiện thẳng vào hộp bình luận qua đây.
  ;(globalThis as Record<string, unknown>).__stagInspectRoot = () => root
  ipcRenderer.on(PAGE_IPC.state, (_e, s: PageState) => apply(s))
  ipcRenderer.on(PAGE_IPC.cmd, (_e, c: PageCmd) => void onCmd(c))
  void hello()
  // Trang đổi URL trong trang (SPA): chào lại để lấy ghim của trang mới.
  setInterval(() => {
    if (pageUrl() !== lastUrl) void hello()
  }, 700)
}

async function hello(): Promise<void> {
  lastUrl = pageUrl()
  found.clear()
  try {
    apply((await ipcRenderer.invoke(PAGE_IPC.hello, location.href)) as PageState)
    void loadStaticMap()
  } catch {
    // Không phải tab của stag.ai (hoặc main chưa sẵn sàng): lớp Soi nằm im.
  }
}

function pageUrl(): string {
  return location.href.split('#')[0]
}

function apply(s: PageState): void {
  state = s
  // Main bỏ bảng "ghim nào còn trên trang" mỗi lần đẩy trạng thái: gửi lại dù không đổi.
  lastPlaces = ''
  for (const id of [...found.keys()]) if (!s.pins.some((p) => p.id === id)) found.delete(id)
  if (!s.on) {
    if (cmp) closeCmp()
    hideHover()
  }
  if (s.on && !cursorStyle) {
    cursorStyle = document.createElement('style')
    cursorStyle.textContent = '*{cursor:crosshair!important}'
    document.documentElement.appendChild(cursorStyle)
  } else if (!s.on && cursorStyle) {
    cursorStyle.remove()
    cursorStyle = null
  }
  if (cmp) drawWho()
  render()
}

// ---------- tiện ích ----------

function div(cls: string, html?: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  if (html !== undefined) d.innerHTML = html
  return d
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Chờ một khung hình, tối đa 50ms: cửa sổ app bị che thì Chromium ngừng vẽ, requestAnimationFrame không bao giờ chạy. */
const raf = (): Promise<void> =>
  new Promise((r) => {
    let done = false
    const go = (): void => {
      if (done) return
      done = true
      r()
    }
    requestAnimationFrame(go)
    setTimeout(go, 50)
  })

function ours(e: Event): boolean {
  return e.composedPath().includes(host)
}

/** Phần tử của trang bình luận được (bỏ html, body, lớp Soi: bấm vào đó = bấm chỗ trống). */
function pickable(t: EventTarget | null): t is Element {
  return t instanceof Element && t !== host && t !== document.documentElement && t !== document.body && !host.contains(t)
}

/** Bộ gõ tiếng Việt đang ghép chữ: Enter lúc này là chốt chữ, không phải gửi. */
const composing = (e: KeyboardEvent): boolean => e.isComposing || e.keyCode === 229

function rectOf(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

function label(el: Element): string {
  let s = el.tagName.toLowerCase()
  if (el.id && !generatedId(el.id)) s += '#' + el.id
  const c = goodClasses(el).slice(0, 3)
  if (c.length) s += '.' + c.join('.')
  return s
}

/** Nhãn ngắn khi rê chuột: tên thẻ + vài chữ đầu (không có chữ thì lớp đầu tiên). */
function shortText(el: Element): string {
  const t = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().split('\n')[0].trim()
  if (t) return t.length > 22 ? t.slice(0, 21) + '…' : t
  const c = goodClasses(el)[0]
  return c ? '.' + c : ''
}

function generatedId(id: string): boolean {
  return /\d{4,}|^[a-f0-9-]{10,}$|^:r|^radix-|^headlessui-|^react-|^mui-|^ember\d|^__/.test(id)
}

function goodClasses(el: Element): string[] {
  return [...el.classList].filter((c) => !/^(css|sc|jsx|emotion|svelte|astro)-|^_|[0-9a-f]{6,}|__[a-zA-Z0-9]{5}$|^(hover|focus|active):/.test(c) && c.length < 40)
}

function unique(sel: string, el: Element): boolean {
  try {
    const all = document.querySelectorAll(sel)
    return all.length === 1 && all[0] === el
  } catch {
    return false
  }
}

/** Selector ổn định: id / thuộc tính test / lớp không băm, thêm :nth-of-type khi cần, tối đa 5 cấp. */
function stableSelector(el: Element): string {
  if (el.id && !generatedId(el.id) && unique('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id)
  for (const a of ['data-testid', 'data-test', 'data-cy', 'data-id', 'data-src', 'data-stag-src', 'name', 'aria-label']) {
    const v = el.getAttribute(a)
    if (!v || v.length > 80) continue
    const s = `${el.tagName.toLowerCase()}[${a}="${CSS.escape(v)}"]`
    if (unique(s, el)) return s
  }
  const parts: string[] = []
  let node: Element | null = el
  for (let depth = 0; node && node !== document.body && node !== document.documentElement && depth < 6; depth++) {
    if (node.id && !generatedId(node.id) && depth > 0) {
      parts.unshift('#' + CSS.escape(node.id))
      const s = parts.join(' > ')
      if (unique(s, el)) return s
      break
    }
    let part = node.tagName.toLowerCase() + goodClasses(node).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
    const parent: Element | null = node.parentElement
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === node!.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`
    }
    parts.unshift(part)
    const s = parts.join(' > ')
    if (unique(s, el)) return s
    node = parent
  }
  return parts.join(' > ')
}

/** Đường dẫn :nth-child từ body. */
function nthPath(el: Element): string {
  const a: string[] = []
  let n: Element | null = el
  while (n && n !== document.body && n !== document.documentElement) {
    const p: Element | null = n.parentElement
    a.unshift(`${n.tagName.toLowerCase()}:nth-child(${p ? [...p.children].indexOf(n) + 1 : 1})`)
    n = p
  }
  return ['body', ...a].join(' > ')
}

function textOf(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

function styleLine(el: Element): string {
  const c = getComputedStyle(el)
  const bg = c.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : c.backgroundColor
  const parts = [
    `font ${c.fontSize}/${c.fontWeight} ${c.fontFamily.split(',')[0].replace(/["']/g, '')}`,
    `color ${c.color}`,
    `bg ${bg}${c.backgroundImage !== 'none' ? ' + image/gradient' : ''}`,
    `padding ${c.padding}`,
    `margin ${c.margin}`,
    `display ${c.display}`
  ]
  if (c.borderRadius !== '0px') parts.push(`radius ${c.borderRadius}`)
  if (c.borderStyle !== 'none' && c.borderWidth !== '0px') parts.push(`border ${c.borderWidth} ${c.borderStyle} ${c.borderColor}`)
  if (c.boxShadow !== 'none') parts.push('shadow')
  return parts.join(' · ')
}

function htmlOf(el: Element): string {
  const h = el.outerHTML.replace(/\s+data-stag-ref="\d+"/g, '').replace(/\s+/g, ' ')
  return h.length > 600 ? h.slice(0, 600) + '…' : h
}

/** Nguồn của phần tử (gửi agent): data-src / data-stag-src (plugin dev server, mu-plugin WordPress), Elementor, block WordPress. */
function sourceOf(el: Element): InspectSource {
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const raw = n.getAttribute('data-stag-src') ?? n.getAttribute('data-src')
    if (raw && /[:/]|\.\w+/.test(raw) && !/^https?:|^data:|\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(raw)) return parseSrc(raw, n !== el)
    const elId = n.getAttribute('data-id')
    const elType = n.getAttribute('data-element_type') ?? n.getAttribute('data-widget_type')
    if (elId && elType) {
      const page = n.closest('[data-elementor-id]')?.getAttribute('data-elementor-id')
      const widget = n.getAttribute('data-widget_type')?.replace(/\.default$/, '') ?? elType
      return {
        chip: 'el',
        label: `Elementor ${widget} #${elId}${page ? ` · trang #${page}` : ''}`,
        hint: `Elementor element id ${elId} (${widget})${page ? ` in post ${page} meta _elementor_data` : ''}: edit the JSON with WP-CLI (wp post meta get/update), then wp elementor flush-css.`,
        ...(n !== el ? { inherited: true } : {})
      }
    }
    const block = [...n.classList].find((c) => /^wp-block-/.test(c))
    if (block) {
      const name = block.replace(/^wp-block-/, '')
      return {
        chip: 'wp',
        label: `Block ${name.includes('-') ? name : `core/${name}`}`,
        hint: 'Gutenberg block content in post_content: edit with WP-CLI (wp post get/update) on the local copy; a revision is kept.',
        ...(n !== el ? { inherited: true } : {})
      }
    }
  }
  const fromFile = staticSource(el)
  if (fromFile) return fromFile
  // mu-plugin WordPress: template chính của trang (front-page.php…) cho phần không có nguồn riêng.
  const tpl = document.querySelector('meta[name="stag-template"]')?.getAttribute('content')
  if (tpl) return { ...parseSrc(tpl, true), label: `${tpl} (template của trang)` }
  return { chip: 'none', label: 'Không rõ nguồn' }
}

/** File HTML tĩnh của trang (main tìm trong dự án) + thẻ mở của nó, theo khoá thẻ#id.lớp → các dòng theo thứ tự. */
let staticMap: { file: string; lines: Map<string, number[]> } | null = null

function domKey(el: Element): string {
  return tagKey({ t: el.tagName.toLowerCase(), id: el.id, c: classKey(el.getAttribute('class') ?? '') })
}

/** Dòng trong file tĩnh: phần tử thứ k (theo thứ tự trang) cùng khoá ↔ thẻ thứ k cùng khoá trong file. */
function staticLine(el: Element): number | undefined {
  if (!staticMap) return undefined
  const key = domKey(el)
  const lines = staticMap.lines.get(key)
  if (!lines) return undefined
  const same = [...document.querySelectorAll(el.tagName)].filter((x) => !host.contains(x) && domKey(x) === key)
  const k = same.indexOf(el)
  return k >= 0 && k < lines.length && same.length === lines.length ? lines[k] : undefined
}

function staticSource(el: Element): InspectSource | null {
  if (!staticMap) return null
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const line = staticLine(n)
    if (line) return parseSrc(`${staticMap.file}:${line}`, n !== el)
  }
  return null
}

/** Trang tĩnh trên máy (localhost / file://): hỏi main file HTML tương ứng; khớp được phần lớn thẻ thì dùng. */
async function loadStaticMap(): Promise<void> {
  staticMap = null
  if (!/^(https?:\/\/(localhost|127\.|\[::1\]|[^/]+\.localhost)|file:)/i.test(location.href)) return
  if (document.querySelector('[data-stag-src]')) return
  type Res = { file: string; tags: StaticTag[] } | null
  let res: Res = null
  try {
    res = (await ipcRenderer.invoke(PAGE_IPC.staticMap, location.href)) as Res
  } catch {
    return
  }
  if (!res?.tags.length) return
  const lines = new Map<string, number[]>()
  for (const t of res.tags) lines.set(tagKey(t), [...(lines.get(tagKey(t)) ?? []), t.line])
  // Trang do JS dựng (SPA) thì phần lớn thẻ trong file không có trên trang: bỏ.
  let hit = 0
  for (const [key, ls] of lines) {
    const tag = key.split('#')[0]
    const n = [...document.querySelectorAll(tag)].filter((x) => !host.contains(x) && domKey(x) === key).length
    if (n === ls.length) hit += ls.length
  }
  if (hit / res.tags.length < 0.6) return
  staticMap = { file: res.file, lines }
}

/** Phần tử lặp lại quanh `el` (anh em cùng thẻ + cùng lớp) — để agent biết chỉ sửa đúng mục này. */
function groupOf(el: Element): InspectGroup | undefined {
  const p = el.parentElement
  if (!p || p === document.body) return undefined
  const cls = goodClasses(el).join(' ')
  const same = [...p.children].filter((c) => c.tagName === el.tagName && goodClasses(c).join(' ') === cls)
  if (same.length < 2 || (!cls && !/^(LI|TR|ARTICLE)$/.test(el.tagName))) return undefined
  const ids = same.map((c) => c.getAttribute('data-id'))
  const similar = ids.every((x) => x) && new Set(ids).size === same.length
  const tag = el.tagName.toLowerCase() + goodClasses(el).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('')
  return { n: same.length, kind: similar ? 'similar' : 'loop', selector: `${stableSelector(p)} > ${tag}` }
}

function snapshotTarget(el: Element, pt: { x: number; y: number }): InspectTarget {
  const g = groupOf(el)
  return {
    tag: label(el),
    label: shortText(el),
    selector: stableSelector(el),
    path: nthPath(el),
    text: textOf(el),
    rect: rectOf(el),
    pt,
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
    viewport: { kind: state.viewport, w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    style: styleLine(el),
    html: htmlOf(el),
    source: sourceOf(el),
    ...(g ? { group: g } : {})
  }
}

/**
 * Tìm lại phần tử theo khoá (không theo node cũ: sửa xong trang tải lại / HMR thay node). Selector duy nhất → selector
 * khớp chữ → phần tử theo đường dẫn nằm trong số khớp selector → đường dẫn cùng thẻ. `fresh` = đã phải dò lại (không
 * thấy qua selector duy nhất): báo main khoá mới.
 */
function resolve(k: { selector: string; path: string; text: string; tag: string }): { el: Element | null; fresh: boolean } {
  let all: Element[] = []
  try {
    all = [...document.querySelectorAll(k.selector)].filter((x) => !host.contains(x))
  } catch {
    all = []
  }
  if (all.length === 1) return { el: all[0], fresh: false }
  let byPath: Element | null = null
  try {
    byPath = document.querySelector(k.path)
  } catch {
    byPath = null
  }
  const byText = all.find((x) => textOf(x) === k.text)
  if (byText) return { el: byText, fresh: true }
  if (byPath && all.includes(byPath)) return { el: byPath, fresh: true }
  if (byPath && byPath.tagName.toLowerCase() === k.tag.split(/[.#]/)[0] && !host.contains(byPath)) return { el: byPath, fresh: true }
  return { el: null, fresh: false }
}

function locate(p: PagePin): Element | null {
  const c = found.get(p.id)
  if (c && c.isConnected) return c
  const { el, fresh } = resolve(p)
  found.set(p.id, el)
  if (el && fresh) reanchor(p.id, el)
  return el
}

/** Báo main khoá mới của ghim (một lần cho mỗi khoá). */
function reanchor(id: number, el: Element): void {
  const a: AnchorUpdate = { id, selector: stableSelector(el), path: nthPath(el), text: textOf(el), label: shortText(el) }
  const key = `${a.selector}|${a.path}|${a.text}`
  if (anchored.get(id) === key) return
  anchored.set(id, key)
  ipcRenderer.send(PAGE_IPC.anchor, a)
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 || r.height > 0
}

function offscreen(r: DOMRect | { left: number; top: number; right: number; bottom: number }, pad = 0): boolean {
  return r.bottom < pad || r.top > window.innerHeight - pad || r.right < pad || r.left > window.innerWidth - pad
}

// ---------- vẽ ----------

let frame = 0
function schedule(): void {
  if (!frame)
    frame = requestAnimationFrame(() => {
      frame = 0
      render()
    })
}

function onScroll(): void {
  hideHover()
  schedule()
}

function render(): void {
  if (!layer) return
  if (cur && cur.isConnected && ovl.style.display === 'block') placeBox(ovl, rectOf(cur))
  else if (cur && !cur.isConnected) hideHover()
  renderPins()
  if (cmp) posCmp()
  const pk = peekId !== null ? state.pins.find((p) => p.id === peekId) : undefined
  const pe = pk ? locate(pk) : null
  if (pe) placeBox(peekEl, rectOf(pe))
  else peekEl.style.display = 'none'
}

function placeBox(b: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  b.style.display = 'block'
  b.style.left = r.x + 'px'
  b.style.top = r.y + 'px'
  b.style.width = r.w + 'px'
  b.style.height = r.h + 'px'
}

const PIN_TIP: Record<string, string> = { queued: 'đang chờ agent', working: 'agent đang trả lời', new: 'có trả lời mới', read: 'đã xem' }

function renderPins(): void {
  const places: Record<number, PinPlace> = {}
  const seen: Array<{ x: number; y: number }> = []
  // Ghim trùng chỗ: dịch sang phải, hết chỗ thì xuống hàng.
  const spot = (x0: number, y0: number): { x: number; y: number } => {
    let x = x0
    let y = y0
    while (seen.some((q) => Math.abs(q.x - x) < 18 && Math.abs(q.y - y) < 18)) {
      x += 20
      if (x > window.innerWidth - 14) {
        x = x0
        y += 20
      }
    }
    seen.push({ x, y })
    return { x, y }
  }
  const keep = new Set<number>()
  // Mạch đã gửi trước, chờ gửi sau (chờ gửi nhường chỗ).
  const order = [...state.pins].sort((a, b) => Number(a.state === 'draft') - Number(b.state === 'draft') || a.id - b.id)
  for (const p of order) {
    const el = locate(p)
    places[p.id] = !el ? 'orphan' : visible(el) ? 'ok' : 'hidden'
    if (!el || places[p.id] !== 'ok' || p.state === 'closed') continue
    if (cmp && p.state === 'draft' && cmp.draftId === p.id) continue
    const r = el.getBoundingClientRect()
    if (offscreen(r)) continue
    keep.add(p.id)
    let n = pinNodes.get(p.id)
    if (!n) {
      n = document.createElement('button')
      const id = p.id
      n.addEventListener('click', (e) => {
        e.stopPropagation()
        onPinClick(id)
      })
      pinsEl.append(n)
      pinNodes.set(p.id, n)
    }
    const draft = p.state === 'draft'
    // Ghim đặt đúng điểm đã bấm; chờ gửi = nét đứt.
    const pos = spot(r.left + r.width * (p.pt?.x ?? 1), r.top + r.height * (p.pt?.y ?? 0))
    const cls = draft ? 'draft' : p.state === 'queued' || p.state === 'working' ? 'sent' : p.state
    n.className = `pin ${cls}${peekId === p.id ? ' hl' : ''}`
    n.textContent = String(p.id)
    const who = state.agents.find((a) => a.id === p.agentId)?.name
    n.title = draft ? `#${p.id} · chờ gửi${who ? ` cho ${who}` : ''}: ${p.title.slice(0, 60)}` : `#${p.id} · ${PIN_TIP[p.state] ?? ''}`
    n.style.left = pos.x + 'px'
    n.style.top = pos.y + 'px'
  }
  for (const [id, n] of pinNodes)
    if (!keep.has(id)) {
      n.remove()
      pinNodes.delete(id)
    }
  const key = JSON.stringify(places)
  if (key !== lastPlaces) {
    lastPlaces = key
    ipcRenderer.send(PAGE_IPC.places, places)
  }
}

function onPinClick(id: number): void {
  const p = state.pins.find((x) => x.id === id)
  if (!p) return
  if (p.state === 'draft') {
    const el = locate(p)
    if (!el) return
    if (!state.on) {
      state = { ...state, on: true }
      ipcRenderer.send(PAGE_IPC.soi, true)
    }
    openCmp(el, p.pt ?? { x: 0.5, y: 0.5 })
    return
  }
  if (cmp) closeCmp()
  ipcRenderer.send(PAGE_IPC.focus, id)
}

// ---------- rê chuột / bấm / phím ----------

function hideHover(): void {
  if (!ovl) return
  ovl.style.display = 'none'
  tagEl.style.display = 'none'
  cur = null
}

function showHover(el: Element): void {
  cur = el
  const r = rectOf(el)
  placeBox(ovl, r)
  const txt = shortText(el)
  tagEl.innerHTML = `<b>${esc(el.tagName.toLowerCase())}</b>${esc(txt)}`
  tagEl.style.display = 'block'
  const th = tagEl.offsetHeight
  const tw = tagEl.offsetWidth
  let top = r.y - th - 4
  if (top < 4) top = Math.min(r.y + r.h + 4, window.innerHeight - th - 4)
  tagEl.style.top = Math.max(4, top) + 'px'
  tagEl.style.left = Math.max(4, Math.min(r.x, window.innerWidth - tw - 4)) + 'px'
}

function onMove(e: MouseEvent): void {
  if (!state.on || ours(e)) {
    if (state.on && cur) hideHover()
    return
  }
  const t = e.target
  if (!pickable(t)) return hideHover()
  if (t === cur) return
  // Phần tử đang có hộp bình luận: đã có viền chọn, không vẽ thêm.
  if (cmp && t === cmp.el) {
    hideHover()
    cur = t
    return
  }
  showHover(t)
}

function onPointer(e: MouseEvent): void {
  if (!state.on || ours(e)) return
  // Soi bật: link / nút của trang không nhận bấm.
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.type === 'pointerdown') {
    // Bấm vào chỗ trống: đóng hộp (chữ còn → thành chờ gửi). (preventDefault ở pointerdown làm trình duyệt bỏ mousedown.)
    if (cmp && !pickable(e.target)) closeCmp()
    return
  }
  const open = (e.type === 'click' && e.button === 0) || e.type === 'contextmenu'
  if (!open || !pickable(e.target)) return
  const el = e.target
  const r = el.getBoundingClientRect()
  openCmp(el, { x: r.width ? (e.clientX - r.left) / r.width : 0.5, y: r.height ? (e.clientY - r.top) / r.height : 0.5 })
}

function onKey(e: KeyboardEvent): void {
  if (ours(e) || e.key !== 'Escape' || composing(e)) return
  // Esc khi trang giữ bàn phím: đóng hộp, rồi tắt Soi.
  if (cmp) {
    e.preventDefault()
    e.stopImmediatePropagation()
    closeCmp()
  } else if (state.on) {
    e.preventDefault()
    e.stopImmediatePropagation()
    ipcRenderer.send(PAGE_IPC.soi, false)
  }
}

// ---------- hộp bình luận ----------

function openCmp(el: Element, pt: { x: number; y: number }): void {
  if (cmp && cmp.el === el) {
    cmp.ta.focus()
    return
  }
  if (cmp) closeCmp()
  hideHover()
  const draft = state.pins.find((p) => p.state === 'draft' && locate(p) === el)
  const agentId = (draft && state.agents.some((a) => a.id === draft.agentId) ? draft.agentId : state.lastAgentId) ?? state.agents[0]?.id ?? ''
  const text = draft?.title ?? ''
  const box = div('cmp')
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Bình luận')
  box.innerHTML = `<textarea rows="2" placeholder="Nhập bình luận…"></textarea><div class="row"><div class="whow"></div><button class="send" type="button" title="Thêm vào danh sách chờ gửi (Enter)">Thêm</button></div>`
  const ta = box.querySelector('textarea')!
  const who = box.querySelector<HTMLDivElement>('.whow')!
  const add = box.querySelector<HTMLButtonElement>('.send')!
  cmp = {
    el,
    target: snapshotTarget(el, pt),
    pt,
    draftId: draft?.id,
    saved: { text, agentId },
    text,
    agentId,
    menu: false,
    focus: -1,
    hid: false,
    box,
    ta,
    who,
    add
  }
  layer.appendChild(box)
  ta.value = text
  ta.addEventListener('input', () => {
    if (!cmp) return
    cmp.text = ta.value
    syncSend()
    grow()
    posCmp()
  })
  ta.addEventListener('keydown', cmpKeys)
  who.addEventListener('keydown', cmpKeys)
  who.addEventListener('click', (e) => {
    const c = cmp
    if (!c) return
    const o = (e.target as Element).closest<HTMLElement>('[data-ag]')
    if (o) return pickAgent(o.dataset.ag!)
    if ((e.target as Element).closest('.who')) {
      c.menu = !c.menu
      c.focus = Math.max(0, state.agents.findIndex((a) => a.id === c.agentId))
      drawWho()
      who.querySelector<HTMLButtonElement>('.who')?.focus()
    }
  })
  who.addEventListener('focusout', (e) => {
    // drawWho gỡ nút đang có focus: Chromium bắn focusout (relatedTarget null) — không phải bấm ra ngoài.
    if (redrawingWho || !(e.target as Node).isConnected) return
    if (cmp?.menu && !who.contains(e.relatedTarget as Node | null)) {
      cmp.menu = false
      drawWho()
    }
  })
  add.addEventListener('click', () => void addCmp())
  drawWho()
  syncSend()
  grow()
  renderPins()
  posCmp()
  setTimeout(() => {
    if (cmp?.ta !== ta) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, 0)
}

function syncSend(): void {
  if (cmp) cmp.add.disabled = !cmp.text.trim() || !state.agents.some((a) => a.id === cmp!.agentId)
}

function grow(): void {
  if (!cmp) return
  cmp.ta.style.height = 'auto'
  cmp.ta.style.height = Math.min(160, cmp.ta.scrollHeight) + 'px'
}

function avatar(name: string): string {
  return `<span class="av" style="background:${agentColor(name)}">${esc(initials(name))}</span>`
}

/** drawWho đang thay nút chọn agent (focusout lúc này là do gỡ nút, bỏ qua). */
let redrawingWho = false

/** Nút chọn agent + menu (vẽ lại riêng phần này, ô chữ giữ nguyên con trỏ). */
function drawWho(): void {
  const c = cmp
  if (!c) return
  redrawingWho = true
  try {
    paintWho(c)
  } finally {
    redrawingWho = false
  }
  syncSend()
}

function paintWho(c: Composer): void {
  const a = state.agents.find((x) => x.id === c.agentId)
  const had = !!root.activeElement && c.who.contains(root.activeElement)
  const chev = '<svg class="ic" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'
  c.who.innerHTML = `<button class="who" type="button" aria-haspopup="listbox" aria-expanded="${c.menu}" title="Gửi cho agent nào">${
    a ? `${avatar(a.name)}<span class="nm">${esc(a.name)}</span>` : '<span class="nm">Chưa có agent</span>'
  }${chev}</button>${
    c.menu
      ? `<div class="menu ${c.box.getBoundingClientRect().top < 180 ? 'down' : 'up'}" role="listbox">${
          state.agents.length
            ? state.agents
                .map(
                  (x, i) =>
                    `<button type="button" role="option" aria-selected="${x.id === c.agentId}" data-ag="${esc(x.id)}" class="${i === c.focus ? 'f' : ''}">${avatar(x.name)}<span class="nm">${esc(x.name)}</span>${
                      !x.running ? '<span class="d">chưa mở</span>' : x.busy || x.load ? '<span class="d">đang bận</span>' : ''
                    }</button>`
                )
                .join('')
            : '<div class="none">Workspace chưa có agent nào</div>'
        }</div>`
      : ''
  }`
  if (had) c.who.querySelector<HTMLButtonElement>('.who')?.focus()
}

function pickAgent(id: string): void {
  if (!cmp) return
  cmp.agentId = id
  cmp.menu = false
  drawWho()
  cmp.ta.focus()
}

function cmpKeys(e: KeyboardEvent): void {
  const c = cmp
  if (!c || composing(e)) return
  const n = state.agents.length
  if (c.menu && n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    c.focus = (c.focus + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
    drawWho()
    c.who.querySelector<HTMLButtonElement>('.who')?.focus()
    return
  }
  if (c.menu && e.key === 'Enter' && n) {
    e.preventDefault()
    pickAgent(state.agents[Math.max(0, c.focus)].id)
    return
  }
  if (e.key === 'Escape') {
    // Esc lần lượt: menu agent → hộp (chữ còn → thành chờ gửi). Tắt Soi là Esc tiếp theo, khi trang giữ bàn phím.
    e.preventDefault()
    if (c.menu) {
      c.menu = false
      drawWho()
      c.ta.focus()
    } else closeCmp()
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && e.target === c.ta) {
    e.preventDefault()
    if (!c.hid) void addCmp()
  }
}

/** Kẹp hộp trong khung nhìn; phần tử cuộn khuất → ẩn hộp; node bị thay (HMR) → dò lại, mất hẳn → đóng, giữ chữ (chờ gửi). */
function posCmp(): void {
  const c = cmp
  if (!c) return
  if (!c.el.isConnected) {
    const again = resolve(c.target).el
    if (!again) {
      closeCmp()
      return
    }
    c.el = again
  }
  const r = rectOf(c.el)
  const vw = window.innerWidth
  const vh = window.innerHeight
  const off = offscreen(c.el.getBoundingClientRect(), 8)
  c.box.style.visibility = off ? 'hidden' : ''
  if (off) {
    pickEl.style.display = 'none'
    if (c.box.contains(root.activeElement)) {
      c.hid = true
      ;(root.activeElement as HTMLElement | null)?.blur()
    }
    return
  }
  placeBox(pickEl, r)
  if (c.hid) {
    c.hid = false
    c.ta.focus({ preventScroll: true })
  }
  const W = c.box.offsetWidth
  const H = c.box.offsetHeight
  const L = 8
  const R = vw - 8
  const T = 8
  const B = vh - 8
  // Ngay dưới điểm bấm (con trỏ chuột; điểm lưu theo tỉ lệ trong phần tử nên cuộn trang vẫn bám theo); dưới không đủ
  // chỗ → ngay trên điểm bấm; luôn kẹp trong khung nhìn.
  const px = r.x + r.w * c.pt.x
  const py = r.y + r.h * c.pt.y
  const x = px - 12
  const y = py + 14 + H <= B ? py + 14 : py - 14 - H
  c.box.style.left = Math.max(L, Math.min(x, R - W)) + 'px'
  c.box.style.top = Math.max(T, Math.min(y, B - H)) + 'px'
}

/** Đóng hộp: chữ còn → lưu thành bình luận chờ gửi (như "Thêm", không chụp ảnh); xoá hết chữ → bỏ bình luận chờ gửi. */
function closeCmp(): void {
  const c = cmp
  if (!c) return
  cmp = null
  c.box.remove()
  pickEl.style.display = 'none'
  const text = c.text.trim()
  if (text && (text !== c.saved.text.trim() || c.agentId !== c.saved.agentId) && c.agentId) {
    const target = c.el.isConnected ? snapshotTarget(c.el, c.pt) : c.target
    void save({ ...(c.draftId !== undefined ? { pinId: c.draftId } : {}), target, url: location.href, title: document.title, text, agentId: c.agentId })
  } else if (!text && c.draftId !== undefined) void ipcRenderer.invoke(PAGE_IPC.remove, c.draftId).catch(() => {})
  render()
  if (pendingReload) {
    pendingReload = false
    scheduleReload()
  }
}

async function save(input: SaveInput): Promise<number | null> {
  try {
    return (await ipcRenderer.invoke(PAGE_IPC.save, input)) as number
  } catch (e) {
    toast(`Không thêm được bình luận: ${errText(e)}`)
    return null
  }
}

/** "Thêm": chụp vùng phần tử (lớp Soi ẩn đi) để sau này gửi kèm gói tin, rồi lưu thành bình luận chờ gửi. */
async function addCmp(): Promise<void> {
  const c = cmp
  if (!c) return
  const text = c.text.trim()
  if (!text || !state.agents.some((a) => a.id === c.agentId)) return
  cmp = null
  c.box.remove()
  pickEl.style.display = 'none'
  const el = c.el.isConnected ? c.el : resolve(c.target).el
  const target = el ? snapshotTarget(el, c.pt) : c.target
  const cap = el ? await captureEl(el) : null
  const id = await save({
    ...(c.draftId !== undefined ? { pinId: c.draftId } : {}),
    ...(cap ? { captureId: cap.captureId } : {}),
    target,
    url: location.href,
    title: document.title,
    text,
    agentId: c.agentId
  })
  if (id === null && el?.isConnected && !cmp) {
    // Không thêm được: mở lại hộp với chữ vừa gõ.
    openCmp(el, c.pt)
    if (cmp) {
      const k = cmp as Composer
      k.text = text
      k.ta.value = text
      syncSend()
    }
  }
  render()
  if (pendingReload && !cmp) {
    pendingReload = false
    scheduleReload()
  }
}

/** Chụp vùng phần tử với lớp Soi ẩn đi. */
async function captureEl(el: Element): Promise<CaptureResult | null> {
  host.style.visibility = 'hidden'
  try {
    await raf()
    await raf()
    const r = rectOf(el)
    const x = Math.max(0, r.x)
    const y = Math.max(0, r.y)
    const w = Math.min(window.innerWidth, r.x + r.w) - x
    const h = Math.min(window.innerHeight, r.y + r.h) - y
    if (w < 2 || h < 2) return null
    const shot = ipcRenderer.invoke(PAGE_IPC.capture, { rect: { x, y, w, h }, scroll: { x: window.scrollX, y: window.scrollY } }) as Promise<CaptureResult | null>
    // Không chụp được trong 4 giây: vẫn gửi (không kèm ảnh), lớp Soi không bị ẩn mãi.
    return await Promise.race([shot, new Promise<null>((r) => setTimeout(() => r(null), 4000))])
  } catch {
    return null
  } finally {
    host.style.visibility = ''
  }
}

function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

// ---------- lệnh từ main ----------

function scheduleReload(): void {
  clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(() => location.reload(), 600)
}

const cmdLog: string[] = []

async function onCmd(c: PageCmd): Promise<void> {
  cmdLog.push(`${new Date().toISOString().slice(11, 23)} ${c.type}`)
  if (cmdLog.length > 30) cmdLog.shift()
  const pinOf = (id: number): PagePin | undefined => state.pins.find((p) => p.id === id)
  switch (c.type) {
    case 'flash': {
      const p = pinOf(c.id)
      const el = p && locate(p)
      if (!el || !visible(el)) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const f = div('flash')
      layer.appendChild(f)
      const tick = (): void => placeBox(f, rectOf(el))
      tick()
      const iv = setInterval(tick, 50)
      clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => {
        clearInterval(iv)
        f.remove()
      }, 1700)
      return
    }
    case 'peek':
      peekId = c.id
      render()
      return
    case 'reload':
      if (cmp) pendingReload = true
      else scheduleReload()
      return
    case 'resnap': {
      const p = pinOf(c.id)
      const el = p && locate(p)
      return reply(c.reqId, el ? { style: styleLine(el), html: htmlOf(el), text: textOf(el) } : null)
    }
  }
}

function reply(reqId: string, value: unknown): void {
  ipcRenderer.send(PAGE_IPC.res, { reqId, value })
}

let toastTimer = 0
function toast(text: string): void {
  toastEl.textContent = text
  toastEl.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 3500)
}

// ---------- giao diện ----------

const STYLE = `
:host{all:initial}
*{box-sizing:border-box}
.layer{position:fixed;inset:0;pointer-events:none;font:13px/1.45 'Segoe UI Variable','Segoe UI',system-ui,sans-serif;color:#dde1e6;
  --accent:#2de2c0;--accentOn:#03201a;--wait:#f4b544;--waitOn:#2a1c00;--panel2:#16191d;--panel3:#1d2126;--line2:#2a2f36;--muted:#99a0aa;--dim:#7d858f;--fg:#dde1e6}
.ovl{position:fixed;display:none;border:1.5px solid var(--accent);border-radius:3px;background:rgba(45,226,192,.08)}
.ovl.pick{background:none}
.ovl.peek{background:none;border-style:dashed}
.tag{position:fixed;display:none;background:#0b0d10;color:#dde1e6;font:11.5px 'Segoe UI',system-ui,sans-serif;padding:3px 8px;border-radius:5px;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.3)}
.tag b{color:var(--accent);font:500 11.5px 'Cascadia Mono',Consolas,monospace;margin-right:6px}
.pin{position:fixed;pointer-events:auto;cursor:pointer;width:22px;height:22px;margin:-11px 0 0 -11px;padding:0;border-radius:50%;display:grid;place-items:center;font:700 11px 'Segoe UI',system-ui,sans-serif;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.28),0 2px 8px rgba(0,0,0,.3);transition:transform .12s}
.pin.sent{background:var(--accent);color:var(--accentOn)}
.pin.new{background:var(--wait);color:var(--waitOn)}
.pin.read{background:#fff;color:#0d6e5d;border-color:var(--accent)}
.pin.draft{background:#f1f3f5;color:#3f454d;border:1.5px dashed #3f454d;box-shadow:0 2px 6px rgba(0,0,0,.2)}
.pin.hl,.pin:hover{transform:scale(1.25)}
.flash{position:fixed;border:2px solid var(--wait);border-radius:4px;animation:flash 1.6s ease-out forwards}
@keyframes flash{0%,30%{box-shadow:0 0 0 4px rgba(244,181,68,.9)}100%{box-shadow:0 0 0 0 rgba(244,181,68,0);border-color:transparent}}
.cmp{position:fixed;pointer-events:auto;width:min(300px,calc(100vw - 16px));background:var(--panel2);border:1px solid var(--line2);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.45);padding:8px;cursor:default;color:var(--fg)}
.cmp *{cursor:default}
.cmp textarea{display:block;width:100%;min-height:44px;max-height:160px;resize:none;border:0;outline:0;background:transparent;color:var(--fg);font:13px/1.45 'Segoe UI',system-ui,sans-serif;padding:4px;overflow-y:auto;cursor:text}
.cmp textarea::placeholder{color:var(--dim)}
.row{display:flex;align-items:center;gap:6px;margin-top:4px}
.whow{position:relative;min-width:0}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.who{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;border-radius:6px;color:var(--muted);font-size:12px;max-width:200px}
.nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who:hover,.who:focus-visible{background:var(--panel3);color:var(--fg);outline:0}
.av{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:8px;font-weight:700;color:#0b0d10;flex:none}
.ic{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;flex:none}
.send{margin-left:auto;height:26px;padding:0 12px;border-radius:6px;background:var(--accent);color:var(--accentOn);font-weight:600;font-size:12px;flex:none}
.send:disabled{opacity:.4;cursor:default}
.menu{position:absolute;left:0;width:220px;background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:4px;box-shadow:0 14px 40px rgba(0,0,0,.5);z-index:2}
.menu.up{bottom:30px}.menu.down{top:30px}
.menu button{width:100%;display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;text-align:left;color:var(--fg);font-size:12.5px}
.menu button.f,.menu button:hover{background:var(--panel3)}
.menu .d{margin-left:auto;color:var(--dim);font-size:11px;flex:none}
.menu .none{padding:6px 8px;color:var(--dim);font-size:12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(16px);background:var(--panel3);border:1px solid var(--line2);border-radius:8px;padding:7px 12px;font:12.5px 'Segoe UI',system-ui,sans-serif;color:var(--fg);opacity:0;transition:.2s;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.toast.on{opacity:1;transform:translateX(-50%)}
`
