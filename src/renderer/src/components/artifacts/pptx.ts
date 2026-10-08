// Vẽ slide PowerPoint (.pptx) thành HTML ngay trong app, không cần Office. Đọc thẳng XML (OOXML PresentationML):
// vị trí / cỡ hình, chữ (cỡ, màu, đậm, nghiêng, căn lề, gạch đầu dòng), ảnh, bảng, đường nối, nền, màu theme,
// thừa kế placeholder từ layout / master và hình trang trí của layout / master. Không vẽ: biểu đồ (chỉ khung),
// SmartArt, hiệu ứng, hình dạng phức tạp (vẽ thành chữ nhật / elip / bo góc).
import JSZip from 'jszip'

const EMU_PX = 9525
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface Deck {
  /** Kích thước slide (px ở 96 dpi). */
  width: number
  height: number
  count: number
  /** Vẽ slide thứ `i` (từ 0) vào `doc` (tài liệu chứa phần tử, vd. shadow root của khung xem trước). */
  render: (i: number, doc: Document) => Promise<HTMLElement>
}

type Rels = Map<string, { target: string; type: string; external: boolean }>

interface Part {
  path: string
  doc: Document
  rels: Rels
}

interface Theme {
  colors: Record<string, string>
  major: string
  minor: string
}

/** Phần tử con theo tên cục bộ (bỏ qua namespace). */
function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return []
  const out: Element[] = []
  for (const c of Array.from(el.children)) if (!name || c.localName === name) out.push(c)
  return out
}
function kid(el: Element | null | undefined, ...path: string[]): Element | null {
  let cur: Element | null | undefined = el
  for (const n of path) {
    cur = kids(cur, n)[0]
    if (!cur) return null
  }
  return cur ?? null
}
const num = (v: string | null | undefined, d = 0): number => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d)

function joinPath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = dir ? dir.split('/') : []
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')))

// ---------- màu ----------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

const PRESET: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080' }
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }

/** Màu CSS từ phần tử chứa a:srgbClr / a:schemeClr / a:sysClr / a:prstClr (kèm lumMod, lumOff, tint, shade, alpha). */
function colorOf(holder: Element | null, theme: Theme): string | null {
  if (!holder) return null
  const c = kids(holder).find((e) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(e.localName))
  if (!c) return null
  let hex: string | undefined
  if (c.localName === 'srgbClr') hex = c.getAttribute('val') ?? undefined
  else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') ?? (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000')
  else if (c.localName === 'prstClr') hex = PRESET[c.getAttribute('val') ?? '']
  else if (c.localName === 'schemeClr') {
    const v = c.getAttribute('val') ?? ''
    hex = theme.colors[SCHEME_ALIAS[v] ?? v]
  } else if (c.localName === 'scrgbClr') {
    const p = (a: string): string => Math.round(Math.min(100000, num(c.getAttribute(a))) / 100000 * 255).toString(16).padStart(2, '0')
    hex = p('r') + p('g') + p('b')
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
  let rgb = hexToRgb(hex)
  let alpha = 1
  for (const m of kids(c)) {
    const v = num(m.getAttribute('val')) / 100000
    if (m.localName === 'alpha') alpha = v
    else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const hsl = rgbToHsl(rgb)
      hsl[2] = m.localName === 'lumMod' ? hsl[2] * v : Math.min(1, hsl[2] + v)
      rgb = hslToRgb(hsl)
    } else if (m.localName === 'tint') rgb = rgb.map((x) => x + (255 - x) * (1 - v)) as [number, number, number]
    else if (m.localName === 'shade') rgb = rgb.map((x) => x * v) as [number, number, number]
  }
  const [r, g, b] = rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))))
  return alpha < 1 ? `rgba(${r},${g},${b},${alpha.toFixed(3)})` : `rgb(${r},${g},${b})`
}

/** Nền của một hình (solidFill / gradFill / noFill). undefined = không khai, null = noFill. */
function fillOf(spPr: Element | null, theme: Theme): string | null | undefined {
  if (!spPr) return undefined
  if (kid(spPr, 'noFill')) return null
  const solid = kid(spPr, 'solidFill')
  if (solid) return colorOf(solid, theme)
  const grad = kid(spPr, 'gradFill')
  if (grad) {
    const stops = kids(kid(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: num(gs.getAttribute('pos')) / 1000, color: colorOf(gs, theme) }))
      .filter((s) => s.color)
    const ang = num(kid(grad, 'lin')?.getAttribute('ang')) / 60000
    if (stops.length) return `linear-gradient(${ang + 90}deg, ${stops.map((s) => `${s.color} ${s.pos}%`).join(', ')})`
  }
  return undefined
}

// ---------- tải file ----------

export async function loadPptx(data: Uint8Array | ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(data)
  const parser = new DOMParser()
  const parts = new Map<string, Promise<Part | null>>()
  const media = new Map<string, Promise<string | null>>()

  const part = (path: string): Promise<Part | null> => {
    let p = parts.get(path)
    if (!p) {
      p = (async () => {
        const f = zip.file(path)
        if (!f) return null
        const doc = parser.parseFromString(await f.async('text'), 'application/xml')
        const rels: Rels = new Map()
        const rf = zip.file(`${dirOf(path)}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`)
        if (rf) {
          const rd = parser.parseFromString(await rf.async('text'), 'application/xml')
          for (const r of Array.from(rd.getElementsByTagName('Relationship'))) {
            const external = r.getAttribute('TargetMode') === 'External'
            const target = r.getAttribute('Target') ?? ''
            rels.set(r.getAttribute('Id') ?? '', { target: external ? target : joinPath(dirOf(path), target), type: (r.getAttribute('Type') ?? '').split('/').pop() ?? '', external })
          }
        }
        return { path, doc, rels }
      })()
      parts.set(path, p)
    }
    return p
  }

  const image = (path: string): Promise<string | null> => {
    let p = media.get(path)
    if (!p) {
      p = (async () => {
        const f = zip.file(path)
        const ext = path.split('.').pop()?.toLowerCase() ?? ''
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' }[ext]
        if (!f || !mime) return null
        return `data:${mime};base64,${await f.async('base64')}`
      })()
      media.set(path, p)
    }
    return p
  }

  const pres = await part('ppt/presentation.xml')
  if (!pres) throw new Error('Không phải file PowerPoint (.pptx) hợp lệ')
  const root = pres.doc.documentElement
  const sz = kid(root, 'sldSz')
  const width = num(sz?.getAttribute('cx'), 9144000) / EMU_PX
  const height = num(sz?.getAttribute('cy'), 6858000) / EMU_PX
  const slidePaths = kids(kid(root, 'sldIdLst'), 'sldId')
    .map((s) => pres.rels.get(s.getAttributeNS(NS_R, 'id') ?? s.getAttribute('r:id') ?? '')?.target)
    .filter((t): t is string => !!t)

  const relTarget = (p: Part, type: string): string | undefined => [...p.rels.values()].find((r) => r.type === type && !r.external)?.target

  async function themeOf(master: Part | null): Promise<Theme> {
    const t = master && relTarget(master, 'theme')
    const tp = t ? await part(t) : null
    const colors: Record<string, string> = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' }
    let major = 'Calibri Light'
    let minor = 'Calibri'
    const te = tp?.doc.documentElement
    const scheme = te && kid(te, 'themeElements', 'clrScheme')
    for (const c of kids(scheme)) {
      const v = kids(c)[0]
      const hex = v?.localName === 'srgbClr' ? v.getAttribute('val') : v?.localName === 'sysClr' ? v.getAttribute('lastClr') : null
      if (hex) colors[c.localName] = hex
    }
    const fonts = te && kid(te, 'themeElements', 'fontScheme')
    major = kid(fonts, 'majorFont', 'latin')?.getAttribute('typeface') || major
    minor = kid(fonts, 'minorFont', 'latin')?.getAttribute('typeface') || minor
    return { colors, major, minor }
  }

  async function render(i: number, doc: Document): Promise<HTMLElement> {
    const slide = await part(slidePaths[i])
    const box = doc.createElement('div')
    box.className = 'pptx-slide'
    Object.assign(box.style, { position: 'relative', width: `${width}px`, height: `${height}px`, overflow: 'hidden', background: '#fff' })
    if (!slide) return box
    const layoutPath = relTarget(slide, 'slideLayout')
    const layout = layoutPath ? await part(layoutPath) : null
    const masterPath = layout ? relTarget(layout, 'slideMaster') : undefined
    const master = masterPath ? await part(masterPath) : null
    const theme = await themeOf(master)
    const ctx: Ctx = { doc, theme, image, slide, layout, master }

    // Nền: slide → layout → master.
    for (const p of [slide, layout, master]) {
      const bg = p && kid(p.doc.documentElement, 'cSld', 'bg')
      if (!bg) continue
      const bgPr = kid(bg, 'bgPr')
      const fill = bgPr ? fillOf(bgPr, theme) : colorOf(kid(bg, 'bgRef'), theme)
      const blip = bgPr && kid(bgPr, 'blipFill', 'blip')
      const embed = blip && (blip.getAttributeNS(NS_R, 'embed') ?? blip.getAttribute('r:embed'))
      const img = embed && p.rels.get(embed) ? await image(p.rels.get(embed)!.target) : null
      if (img) Object.assign(box.style, { backgroundImage: `url("${img}")`, backgroundSize: 'cover' })
      else if (fill) box.style.background = fill
      else continue
      break
    }

    // Hình trang trí (không phải placeholder) của master rồi layout, rồi nội dung slide.
    const showMaster = slide.doc.documentElement.getAttribute('showMasterSp') !== '0' && layout?.doc.documentElement.getAttribute('showMasterSp') !== '0'
    if (master && showMaster) await drawTree(kid(master.doc.documentElement, 'cSld', 'spTree'), box, { ...ctx, part: master }, ident, true)
    if (layout && slide.doc.documentElement.getAttribute('showMasterSp') !== '0')
      await drawTree(kid(layout.doc.documentElement, 'cSld', 'spTree'), box, { ...ctx, part: layout }, ident, true)
    await drawTree(kid(slide.doc.documentElement, 'cSld', 'spTree'), box, { ...ctx, part: slide }, ident, false)
    return box
  }

  return { width, height, count: slidePaths.length, render }
}

// ---------- vẽ ----------

interface Ctx {
  doc: Document
  theme: Theme
  image: (path: string) => Promise<string | null>
  slide: Part
  layout: Part | null
  master: Part | null
  /** Phần đang vẽ (để tra rels của ảnh). */
  part?: Part
}

type Xf = (x: number, y: number, w: number, h: number) => [number, number, number, number]
const ident: Xf = (x, y, w, h) => [x, y, w, h]

interface Rect {
  x: number
  y: number
  w: number
  h: number
  rot: number
  flipH: boolean
  flipV: boolean
}

function rectOf(xfrm: Element | null): Rect | null {
  const off = kid(xfrm, 'off')
  const ext = kid(xfrm, 'ext')
  if (!xfrm || !off || !ext) return null
  return {
    x: num(off.getAttribute('x')),
    y: num(off.getAttribute('y')),
    w: num(ext.getAttribute('cx')),
    h: num(ext.getAttribute('cy')),
    rot: num(xfrm.getAttribute('rot')) / 60000,
    flipH: xfrm.getAttribute('flipH') === '1',
    flipV: xfrm.getAttribute('flipV') === '1'
  }
}

/** Placeholder của shape (type, idx) nếu có. */
function phOf(sp: Element): { type: string; idx: string | null } | null {
  const nv = kids(sp).find((e) => e.localName.startsWith('nv'))
  const ph = kid(nv, 'nvPr', 'ph')
  if (!ph) return null
  return { type: ph.getAttribute('type') ?? 'body', idx: ph.getAttribute('idx') }
}

/** Shape placeholder tương ứng trong layout / master (khớp idx trước, rồi type). */
function findPh(p: Part | null, ph: { type: string; idx: string | null }, byType = false): Element | null {
  if (!p) return null
  const all = Array.from(p.doc.getElementsByTagNameNS('*', 'sp'))
  const norm = (t: string): string => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t)
  if (!byType && ph.idx != null) {
    const hit = all.find((s) => phOf(s)?.idx === ph.idx)
    if (hit) return hit
  }
  return all.find((s) => {
    const o = phOf(s)
    return o && norm(o.type) === norm(ph.type)
  }) ?? null
}

async function drawTree(tree: Element | null, parent: HTMLElement, ctx: Ctx, xf: Xf, decorOnly: boolean): Promise<void> {
  for (const el of kids(tree)) {
    try {
      if (el.localName === 'sp') {
        const ph = phOf(el)
        if (decorOnly && ph) continue
        await drawShape(el, parent, ctx, xf, ph)
      } else if (el.localName === 'pic') await drawPic(el, parent, ctx, xf)
      else if (el.localName === 'grpSp') {
        const g = kid(el, 'grpSpPr', 'xfrm')
        const r = rectOf(g)
        const chOff = kid(g, 'chOff')
        const chExt = kid(g, 'chExt')
        if (!r || !chOff || !chExt) {
          await drawTree(el, parent, ctx, xf, decorOnly)
          continue
        }
        const cx = num(chOff.getAttribute('x'))
        const cy = num(chOff.getAttribute('y'))
        const sx = num(chExt.getAttribute('cx')) ? r.w / num(chExt.getAttribute('cx')) : 1
        const sy = num(chExt.getAttribute('cy')) ? r.h / num(chExt.getAttribute('cy')) : 1
        const inner: Xf = (x, y, w, h) => xf(r.x + (x - cx) * sx, r.y + (y - cy) * sy, w * sx, h * sy)
        await drawTree(el, parent, ctx, inner, decorOnly)
      } else if (el.localName === 'graphicFrame') await drawFrame(el, parent, ctx, xf)
      else if (el.localName === 'cxnSp') drawLine(el, parent, ctx, xf)
      else if (el.localName === 'AlternateContent') {
        // mc:AlternateContent: dùng nhánh Fallback (thường là ảnh / hình đơn giản).
        const fb = kid(el, 'Fallback')
        if (fb) await drawTree(fb, parent, ctx, xf, decorOnly)
      }
    } catch (e) {
      console.warn('[pptx] bỏ qua một hình:', e)
    }
  }
}

function place(div: HTMLElement, r: Rect, xf: Xf): void {
  const [x, y, w, h] = xf(r.x, r.y, r.w, r.h)
  const t: string[] = []
  if (r.rot) t.push(`rotate(${r.rot}deg)`)
  if (r.flipH) t.push('scaleX(-1)')
  if (r.flipV) t.push('scaleY(-1)')
  Object.assign(div.style, {
    position: 'absolute',
    left: `${x / EMU_PX}px`,
    top: `${y / EMU_PX}px`,
    width: `${w / EMU_PX}px`,
    height: `${h / EMU_PX}px`,
    transform: t.join(' ')
  })
}

function lineOf(spPr: Element | null, style: Element | null, theme: Theme): { width: number; color: string } | null {
  const ln = kid(spPr, 'ln')
  if (ln && kid(ln, 'noFill')) return null
  // Màu viền: khai trong a:ln, không có thì theo kiểu của shape (p:style/a:lnRef, idx 0 = không viền).
  const ref = kid(style, 'lnRef')
  const color = colorOf(kid(ln, 'solidFill'), theme) ?? (ref && num(ref.getAttribute('idx')) > 0 ? colorOf(ref, theme) : null)
  if (!color) return null
  const w = ln?.getAttribute('w')
  return { width: Math.max(1, num(w, 12700) / EMU_PX), color }
}

async function drawShape(sp: Element, parent: HTMLElement, ctx: Ctx, xf: Xf, ph: { type: string; idx: string | null } | null): Promise<void> {
  const { doc, theme } = ctx
  const spPr = kid(sp, 'spPr')
  // Thừa kế placeholder: slide → layout → master.
  const inherited: Element[] = []
  if (ph && ctx.part === ctx.slide) {
    const l = findPh(ctx.layout, ph)
    if (l) inherited.push(l)
    const m = findPh(ctx.master, ph, true)
    if (m) inherited.push(m)
  } else if (ph && ctx.part === ctx.layout) {
    const m = findPh(ctx.master, ph, true)
    if (m) inherited.push(m)
  }
  const r = rectOf(kid(spPr, 'xfrm')) ?? inherited.map((s) => rectOf(kid(s, 'spPr', 'xfrm'))).find(Boolean) ?? null
  if (!r) return
  const div = doc.createElement('div')
  place(div, r, xf)
  const style = kid(sp, 'style')
  let fill = fillOf(spPr, theme)
  if (fill === undefined) {
    const ref = kid(style, 'fillRef')
    fill = ref && num(ref.getAttribute('idx')) > 0 ? colorOf(ref, theme) : undefined
  }
  if (fill) div.style.background = fill
  const line = lineOf(spPr, style, theme)
  if (line) div.style.border = `${line.width}px solid ${line.color}`
  div.style.boxSizing = 'border-box'
  const geom = kid(spPr, 'prstGeom')?.getAttribute('prst')
  if (geom === 'ellipse') div.style.borderRadius = '50%'
  else if (geom === 'roundRect') div.style.borderRadius = `${Math.min(r.w, r.h) / EMU_PX / 6}px`

  const body = kid(sp, 'txBody')
  if (body) drawText(body, div, ctx, ph, inherited)
  parent.appendChild(div)
}

async function drawPic(pic: Element, parent: HTMLElement, ctx: Ctx, xf: Xf): Promise<void> {
  const r = rectOf(kid(pic, 'spPr', 'xfrm'))
  if (!r) return
  const blip = kid(pic, 'blipFill', 'blip')
  const embed = blip && (blip.getAttributeNS(NS_R, 'embed') ?? blip.getAttribute('r:embed'))
  const rel = embed ? ctx.part?.rels.get(embed) : undefined
  const src = rel && !rel.external ? await ctx.image(rel.target) : null
  const el = ctx.doc.createElement(src ? 'img' : 'div')
  place(el, r, xf)
  if (src) {
    ;(el as HTMLImageElement).src = src
    el.style.objectFit = 'fill'
  } else Object.assign(el.style, { background: 'repeating-linear-gradient(45deg,#eee 0 8px,#ddd 8px 16px)' })
  parent.appendChild(el)
}

function drawLine(cxn: Element, parent: HTMLElement, ctx: Ctx, xf: Xf): void {
  const spPr = kid(cxn, 'spPr')
  const r = rectOf(kid(spPr, 'xfrm'))
  if (!r) return
  const line = lineOf(spPr, kid(cxn, 'style'), ctx.theme) ?? { width: 1, color: '#000' }
  const [x, y, w, h] = xf(r.x, r.y, r.w, r.h)
  const svg = ctx.doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const W = Math.max(w / EMU_PX, 1)
  const H = Math.max(h / EMU_PX, 1)
  Object.assign(svg.style, { position: 'absolute', left: `${x / EMU_PX}px`, top: `${y / EMU_PX}px`, overflow: 'visible' })
  svg.setAttribute('width', String(W))
  svg.setAttribute('height', String(H))
  const l = ctx.doc.createElementNS('http://www.w3.org/2000/svg', 'line')
  l.setAttribute('x1', String(r.flipH ? W : 0))
  l.setAttribute('y1', String(r.flipV ? H : 0))
  l.setAttribute('x2', String(r.flipH ? 0 : W))
  l.setAttribute('y2', String(r.flipV ? 0 : H))
  l.setAttribute('stroke', line.color)
  l.setAttribute('stroke-width', String(line.width))
  svg.appendChild(l)
  parent.appendChild(svg)
}

async function drawFrame(frame: Element, parent: HTMLElement, ctx: Ctx, xf: Xf): Promise<void> {
  const r = rectOf(kid(frame, 'xfrm'))
  if (!r) return
  const div = ctx.doc.createElement('div')
  place(div, r, xf)
  const data = kid(frame, 'graphic', 'graphicData')
  const tbl = kid(data, 'tbl')
  if (tbl) {
    const table = ctx.doc.createElement('table')
    Object.assign(table.style, { borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' })
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(c.getAttribute('w')) / EMU_PX)
    const cg = ctx.doc.createElement('colgroup')
    for (const w of cols) {
      const c = ctx.doc.createElement('col')
      c.style.width = `${w}px`
      cg.appendChild(c)
    }
    table.appendChild(cg)
    const firstRow = kid(tbl, 'tblPr')?.getAttribute('firstRow') === '1'
    kids(tbl, 'tr').forEach((tr, ri) => {
      const row = ctx.doc.createElement('tr')
      row.style.height = `${num(tr.getAttribute('h')) / EMU_PX}px`
      for (const tc of kids(tr, 'tc')) {
        if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') continue
        const td = ctx.doc.createElement('td')
        const span = num(tc.getAttribute('gridSpan'), 1)
        if (span > 1) td.colSpan = span
        const rs = num(tc.getAttribute('rowSpan'), 1)
        if (rs > 1) td.rowSpan = rs
        const tcPr = kid(tc, 'tcPr')
        const f = fillOf(tcPr, ctx.theme)
        Object.assign(td.style, {
          border: '1px solid #9aa4b2',
          padding: '4px 6px',
          verticalAlign: 'top',
          background: f ?? (firstRow && ri === 0 ? `#${ctx.theme.colors.accent1}` : 'transparent'),
          color: firstRow && ri === 0 && !f ? '#fff' : ''
        })
        const body = kid(tc, 'txBody')
        if (body) drawText(body, td, ctx, null, [], 18)
        row.appendChild(td)
      }
      table.appendChild(row)
    })
    div.appendChild(table)
  } else {
    const uri = data?.getAttribute('uri') ?? ''
    const label = uri.includes('chart') ? 'Biểu đồ' : uri.includes('diagram') ? 'SmartArt' : 'Đối tượng'
    Object.assign(div.style, { border: '1px dashed #9aa4b2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', background: 'rgba(148,163,184,.08)' })
    div.textContent = `${label} (app chưa vẽ được — bấm “Mở”)`
  }
  parent.appendChild(div)
}

// ---------- chữ ----------

/** Cỡ chữ mặc định theo loại placeholder khi không file nào khai (pt). */
function defaultSize(ph: { type: string } | null): number {
  if (!ph) return 18
  if (ph.type === 'title' || ph.type === 'ctrTitle') return 40
  if (ph.type === 'subTitle') return 24
  if (['dt', 'ftr', 'sldNum'].includes(ph.type)) return 12
  return 24
}

function drawText(body: Element, box: HTMLElement, ctx: Ctx, ph: { type: string; idx: string | null } | null, inherited: Element[], fallbackPt?: number): void {
  const { doc, theme } = ctx
  const bodyPr = kid(body, 'bodyPr')
  const inh = (name: string): string | null => {
    for (const el of [bodyPr, ...inherited.map((s) => kid(s, 'txBody', 'bodyPr'))]) {
      const v = el?.getAttribute(name)
      if (v != null) return v
    }
    return null
  }
  const anchor = inh('anchor') ?? (ph && (ph.type === 'title' || ph.type === 'ctrTitle') ? 'ctr' : 't')
  const ins = (n: string, d: number): string => `${num(inh(n), d) / EMU_PX}px`
  const wrap = doc.createElement('div')
  Object.assign(wrap.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start',
    padding: `${ins('tIns', 45720)} ${ins('rIns', 91440)} ${ins('bIns', 45720)} ${ins('lIns', 91440)}`,
    overflow: 'visible',
    whiteSpace: inh('wrap') === 'none' ? 'nowrap' : 'normal',
    overflowWrap: 'break-word',
    lineHeight: '1.15'
  })
  if (box.tagName === 'TD') Object.assign(wrap.style, { position: 'static', padding: '0', display: 'block' })
  const scale = num(kid(bodyPr, 'normAutofit')?.getAttribute('fontScale'), 100000) / 100000

  // Chuỗi thừa kế thuộc tính chữ theo cấp (lvl 1..9): lstStyle của shape → placeholder layout/master → txStyles của master.
  const masterStyles = ctx.master && kid(ctx.master.doc.documentElement, 'txStyles')
  const styleName = !ph ? 'otherStyle' : ph.type === 'title' || ph.type === 'ctrTitle' ? 'titleStyle' : ['dt', 'ftr', 'sldNum'].includes(ph.type) ? 'otherStyle' : 'bodyStyle'
  const lvlChain = (lvl: number): Element[] => {
    const n = `lvl${lvl + 1}pPr`
    return [kid(body, 'lstStyle', n), ...inherited.map((s) => kid(s, 'txBody', 'lstStyle', n)), kid(masterStyles, styleName, n)].filter((e): e is Element => !!e)
  }

  const paras = kids(body, 'p')
  let autoNum = 0
  for (const p of paras) {
    const pPr = kid(p, 'pPr')
    const lvl = num(pPr?.getAttribute('lvl'))
    const chain = [pPr, ...lvlChain(lvl)].filter((e): e is Element => !!e)
    const pAttr = (a: string): string | null => chain.map((e) => e.getAttribute(a)).find((v) => v != null) ?? null
    const pKid = (name: string): Element | null => chain.map((e) => kid(e, name)).find(Boolean) ?? null
    const defR = chain.map((e) => kid(e, 'defRPr')).filter((e): e is Element => !!e)

    const para = doc.createElement('div')
    const algn = pAttr('algn')
    para.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left'
    const marL = num(pAttr('marL')) / EMU_PX
    const indent = num(pAttr('indent')) / EMU_PX
    para.style.paddingLeft = `${marL}px`
    para.style.textIndent = `${indent}px`
    const spcBef = num(kid(pKid('spcBef'), 'spcPts')?.getAttribute('val')) / 100
    if (spcBef) para.style.marginTop = `${(spcBef * 4) / 3}px`

    const runs = kids(p).filter((e) => e.localName === 'r' || e.localName === 'br' || e.localName === 'fld')
    const runProps = (rPr: Element | null): Partial<CSSStyleDeclaration> => {
      const all = [rPr, ...defR].filter((e): e is Element => !!e)
      const attr = (a: string): string | null => all.map((e) => e.getAttribute(a)).find((v) => v != null) ?? null
      const sz = num(attr('sz'), (fallbackPt ?? defaultSize(ph)) * 100) / 100
      const color = all.map((e) => colorOf(kid(e, 'solidFill'), theme)).find(Boolean) ?? colorOf(kid(kid(body.parentElement, 'style'), 'fontRef'), theme) ?? `#${theme.colors.dk1}`
      let font = all.map((e) => kid(e, 'latin')?.getAttribute('typeface')).find(Boolean) ?? (styleName === 'titleStyle' ? '+mj-lt' : '+mn-lt')
      if (font === '+mj-lt') font = theme.major
      if (font === '+mn-lt') font = theme.minor
      return {
        fontSize: `${((sz * scale) * 4) / 3}px`,
        fontWeight: attr('b') === '1' ? '700' : '400',
        fontStyle: attr('i') === '1' ? 'italic' : 'normal',
        textDecoration: attr('u') && attr('u') !== 'none' ? 'underline' : attr('strike') && attr('strike') !== 'noStrike' ? 'line-through' : 'none',
        color,
        fontFamily: `"${font}", "Segoe UI", sans-serif`
      }
    }

    const hasText = runs.some((r) => r.localName !== 'br' && (kid(r, 't')?.textContent ?? '') !== '')
    // Gạch đầu dòng: theo buChar / buAutoNum; buNone hoặc không khai gì → không có.
    const bu = pKid('buNone') ? null : pKid('buChar') ?? pKid('buAutoNum')
    if (bu && hasText) {
      const span = doc.createElement('span')
      Object.assign(span.style, runProps(kid(runs.find((r) => r.localName === 'r') ?? null, 'rPr')))
      if (bu.localName === 'buAutoNum') {
        autoNum++
        const scheme = bu.getAttribute('type') ?? 'arabicPeriod'
        const n = num(bu.getAttribute('startAt'), 1) + autoNum - 1
        span.textContent = scheme.startsWith('alphaLc') ? `${String.fromCharCode(96 + n)}. ` : scheme.startsWith('alphaUc') ? `${String.fromCharCode(64 + n)}. ` : `${n}${scheme.includes('Paren') ? ')' : '.'} `
      } else {
        autoNum = 0
        span.textContent = `${bu.getAttribute('char') ?? '•'} `
      }
      span.style.textDecoration = 'none'
      para.appendChild(span)
    } else autoNum = 0

    for (const r of runs) {
      if (r.localName === 'br') {
        para.appendChild(doc.createElement('br'))
        continue
      }
      const span = doc.createElement('span')
      span.textContent = kid(r, 't')?.textContent ?? ''
      Object.assign(span.style, runProps(kid(r, 'rPr')))
      para.appendChild(span)
    }
    if (!hasText) {
      // Đoạn trống vẫn chiếm một dòng theo cỡ chữ của nó.
      const span = doc.createElement('span')
      span.innerHTML = '&nbsp;'
      Object.assign(span.style, runProps(kid(p, 'endParaRPr')))
      para.appendChild(span)
    }
    wrap.appendChild(para)
  }
  box.appendChild(wrap)
}
