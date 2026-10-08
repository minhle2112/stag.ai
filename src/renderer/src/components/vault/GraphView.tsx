import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph from 'force-graph'
import type { VaultIndex } from '@shared/types'
import {
  GHOST_COLOR,
  buildGraph,
  filterGraph,
  neighborMap,
  nodeRadius,
  typeColor,
  typeStats,
  withAlpha,
  type GLink,
  type GNode,
  type VaultGraph
} from './graphData'
import { agentColor, type NoteTouch } from './activity'

export interface GraphViewProps {
  index: VaultIndex
  /** Note đang mở (rel), để làm nổi và để vẽ graph cục bộ quanh nó. */
  current: string | null
  /** Bấm một node note → mở note đó. */
  onOpen: (rel: string) => void
  /** Agent vừa đọc / ghi note nào (khoá = rel chữ thường): vẽ quầng màu của agent quanh node. */
  activity?: Map<string, NoteTouch[]>
}

/** Node trong mô phỏng: force-graph gắn thêm vị trí/vận tốc vào chính object này. */
interface SimNode extends GNode {
  r: number
  color: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}
interface SimLink {
  source: string | SimNode
  target: string | SimNode
}
type FG = ForceGraph<SimNode, SimLink>

interface Settings {
  mode: 'global' | 'local'
  depth: 1 | 2
  /** Loại bị ẩn (khoá `typeKey`). */
  hidden: string[]
  showGhosts: boolean
  hideOrphans: boolean
}

/**
 * Giữ lại theo vault khi graph bị gỡ (chuyển Note ↔ Graph): object node (kèm vị trí), khung nhìn, bộ lọc.
 * Mở lại graph thì không phải xếp lại từ đầu.
 */
interface Saved {
  pool: Map<string, SimNode>
  view: { x: number; y: number; k: number } | null
  settings: Settings
}
const saved = new Map<string, Saved>()
function savedFor(vaultPath: string): Saved {
  let s = saved.get(vaultPath)
  if (!s) {
    s = {
      pool: new Map(),
      view: null,
      settings: { mode: 'global', depth: 1, hidden: [], showGhosts: true, hideOrphans: false }
    }
    saved.set(vaultPath, s)
  }
  return s
}

/** Màu giao diện đọc từ biến CSS của theme (styles.css). */
function themeColors(): Record<'bg' | 'fg' | 'muted' | 'accent' | 'font', string> {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, d: string): string => s.getPropertyValue(name).trim() || d
  return {
    bg: v('--color-bg', '#0f1115'),
    fg: v('--color-fg', '#e6e8ee'),
    muted: v('--color-muted', '#8b93a7'),
    accent: v('--color-accent', '#6ea8fe'),
    font: v('--font-sans', 'system-ui, sans-serif')
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const idOf = (x: string | SimNode): string => (typeof x === 'string' ? x : x.id)
const shortName = (s: string): string => (s.length > 40 ? s.slice(0, 39) + '…' : s)
/** Chữ ký node + cạnh: index đổi mà cấu trúc graph không đổi (vd. chỉ sửa nội dung note) thì khỏi nạp lại mô phỏng. */
const signature = (g: VaultGraph<SimNode>): string =>
  g.nodes.map((n) => n.id).join('\n') + '\n\n' + g.links.map((l) => `${l.source}\t${l.target}`).join('\n')

/** Vừa khung (như zoomToFit) nhưng không phóng quá FIT_MAX_ZOOM: graph nhỏ khỏi bị phóng to tướng. */
const FIT_MAX_ZOOM = 3
function fitView(fg: FG, ms: number, pad = 40): void {
  const b = fg.getGraphBbox()
  if (!b) return
  const w = Math.max(1, b.x[1] - b.x[0])
  const h = Math.max(1, b.y[1] - b.y[0])
  const k = Math.min(FIT_MAX_ZOOM, (fg.width() - pad * 2) / w, (fg.height() - pad * 2) / h)
  fg.centerAt((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, ms)
  fg.zoom(Math.max(0.01, k), ms)
}

/** Lực d3 (hàm nhận alpha, kèm các hàm cấu hình). */
type D3Force = ((alpha: number) => void) & { initialize?: (...a: any[]) => void; [k: string]: unknown }

/**
 * Bọc một lực d3 để nhân alpha với `heat()`. Giữ `id`/`links` vì force-graph gọi `.id(..).links(..)` trên lực
 * 'link' mỗi lần nạp dữ liệu.
 */
function damped(inner: D3Force, heat: () => number): D3Force {
  const f = Object.assign((alpha: number) => inner(alpha * heat()), {
    initialize: (...a: unknown[]) => inner.initialize?.(...a)
  }) as D3Force
  for (const m of ['id', 'links']) {
    const fn = inner[m]
    if (typeof fn === 'function')
      f[m] = (...a: unknown[]) => {
        const r = fn.apply(inner, a)
        return a.length ? f : r
      }
  }
  return f
}

/** Từ mức zoom này nhãn tên bắt đầu hiện (mờ dần lên tới đủ ở LABEL_ZOOM + 0.6). */
const LABEL_ZOOM = 1.1

/** Graph view của vault: node = note (+ node ma), cạnh = link; vẽ bằng force-graph (canvas 2D). */
export function GraphView({ index, current, onOpen, activity }: GraphViewProps): React.JSX.Element {
  const [store] = useState(() => savedFor(index.vaultPath))
  const [settings, setSettingsState] = useState<Settings>(store.settings)
  const setSettings = (patch: Partial<Settings>): void => {
    const next = { ...settings, ...patch }
    store.settings = next
    setSettingsState(next)
  }

  const hostRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<FG | null>(null)
  const currentRef = useRef(current)
  currentRef.current = current
  const activityRef = useRef(activity)
  activityRef.current = activity
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  /** Trạng thái hover (đọc trong hàm vẽ, không qua React để khỏi render lại). */
  const hover = useRef<{ id: string | null; near: Set<string> | null }>({ id: null, near: null })
  const neighbors = useRef(new Map<string, Set<string>>())
  const lastSig = useRef('')
  const lastFitKey = useRef('')
  const fitPending = useRef(false)
  const ticks = useRef(0)
  const heat = useRef(1)

  // Chỉ mục → graph; dùng lại object node cũ theo id để giữ vị trí.
  const graph = useMemo<VaultGraph<SimNode>>(() => {
    const g = buildGraph(index)
    const ids = new Set<string>()
    const nodes = g.nodes.map((n) => {
      ids.add(n.id)
      const old = store.pool.get(n.id)
      const sim: SimNode = old ? Object.assign(old, n) : { ...n, r: 0, color: '' }
      sim.r = nodeRadius(n.degree)
      sim.color = n.ghost ? GHOST_COLOR : typeColor(n.type)
      store.pool.set(n.id, sim)
      return sim
    })
    for (const id of [...store.pool.keys()]) if (!ids.has(id)) store.pool.delete(id)
    return { nodes, links: g.links }
  }, [index, store])

  const canLocal = current !== null && graph.nodes.some((n) => n.id === current)
  const local = settings.mode === 'local' && canLocal
  const localCenter = local ? current : null
  const display = useMemo(
    () =>
      filterGraph(graph, {
        hiddenTypes: new Set(settings.hidden),
        showGhosts: settings.showGhosts,
        hideOrphans: settings.hideOrphans,
        local: localCenter ? { center: localCenter, depth: settings.depth } : null
      }),
    [graph, settings, localCenter]
  )
  const stats = useMemo(() => typeStats(graph), [graph])
  const ghostCount = useMemo(() => graph.nodes.filter((n) => n.ghost).length, [graph])

  // Hoạt động agent đổi → vẽ lại khung hình (không cần chạy lại mô phỏng).
  useEffect(() => {
    fgRef.current?.nodeRelSize(1)
  }, [activity])

  // Tạo graph một lần khi mount, dọn khi unmount.
  useEffect(() => {
    const host = hostRef.current!
    const t = themeColors()
    const linkColor = withAlpha(t.muted, 0.3)
    const linkDim = withAlpha(t.muted, 0.06)
    const linkHl = withAlpha(t.accent, 0.85)
    const touches = (l: SimLink, id: string): boolean => idOf(l.source) === id || idOf(l.target) === id

    const fg = new ForceGraph<SimNode, SimLink>(host)
      .width(host.clientWidth)
      .height(host.clientHeight)
      .backgroundColor(t.bg)
      .nodeId('id')
      .nodeRelSize(1)
      .nodeVal((n) => n.r * n.r) // vùng bấm/hover = hình tròn bán kính r
      .nodeLabel((n) => (n.ghost ? `${esc(n.name)} — <i>Chưa có note</i>` : esc(n.id)))
      .showPointerCursor((o) => !!o && !(o as SimNode).ghost)
      .linkColor((l) => (hover.current.id ? (touches(l, hover.current.id) ? linkHl : linkDim) : linkColor))
      .linkWidth((l) => (hover.current.id && touches(l, hover.current.id) ? 1.6 : 1))
      .d3AlphaDecay(0.03)
      .d3AlphaMin(0.01) // mặc định 0 → chỉ dừng khi hết cooldownTime
      .cooldownTime(12000)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n, ctx, k) => {
        const h = hover.current
        const x = n.x ?? 0
        const y = n.y ?? 0
        ctx.globalAlpha = h.id && n.id !== h.id && !h.near?.has(n.id) ? 0.12 : 1
        // Quầng hoạt động: mỗi agent vừa đụng tới note một vòng màu riêng (ghi = vòng liền, đọc = vòng đứt).
        const touches = !n.ghost ? activityRef.current?.get(n.id.toLowerCase()) : undefined
        touches?.slice(0, 3).forEach((tc, i) => {
          const c = agentColor(tc.agentId)
          ctx.beginPath()
          ctx.arc(x, y, n.r + (3 + i * 3) / k, 0, 2 * Math.PI)
          if (tc.kind === 'write' && i === 0) {
            ctx.fillStyle = c.replace('hsl(', 'hsla(').replace(')', ', 0.22)')
            ctx.fill()
          }
          ctx.setLineDash(tc.kind === 'read' ? [3 / k, 2 / k] : [])
          ctx.lineWidth = 1.6 / k
          ctx.strokeStyle = c
          ctx.stroke()
          ctx.setLineDash([])
        })
        if (n.id === currentRef.current) {
          // Vòng sáng cho note đang mở.
          ctx.beginPath()
          ctx.arc(x, y, n.r + 5 / k, 0, 2 * Math.PI)
          ctx.fillStyle = withAlpha(t.accent, 0.25)
          ctx.fill()
          ctx.lineWidth = 1.5 / k
          ctx.strokeStyle = t.accent
          ctx.stroke()
        }
        ctx.beginPath()
        ctx.arc(x, y, n.r, 0, 2 * Math.PI)
        if (n.ghost) {
          ctx.fillStyle = t.bg
          ctx.fill()
          ctx.setLineDash([n.r * 0.55, n.r * 0.4])
          ctx.lineWidth = Math.min(n.r * 0.35, 1.2 / k)
          ctx.strokeStyle = GHOST_COLOR
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.fillStyle = n.color
          ctx.fill()
        }
        if (n.id === h.id) {
          ctx.lineWidth = 1.5 / k
          ctx.strokeStyle = t.fg
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      })
      .onRenderFramePost((ctx, k) => {
        // Nhãn tên vẽ sau cùng để không bị node khác che. Chỉ vẽ nhãn trong khung nhìn.
        const h = hover.current
        const cur = currentRef.current
        const fade = Math.max(0, Math.min(1, (k - LABEL_ZOOM) / 0.6))
        const inv = ctx.getTransform().inverse()
        const p0 = inv.transformPoint({ x: 0, y: 0 })
        const p1 = inv.transformPoint({ x: ctx.canvas.width, y: ctx.canvas.height })
        const pad = 200 / k
        ctx.font = `${11 / k}px ${t.font}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.lineJoin = 'round'
        const special: SimNode[] = []
        for (const n of fg.graphData().nodes) {
          if (n.id === h.id || n.id === cur) {
            special.push(n)
            continue
          }
          if (!fade) continue
          const x = n.x ?? 0
          const y = n.y ?? 0
          if (x < p0.x - pad || x > p1.x + pad || y < p0.y - pad || y > p1.y + pad) continue
          const a = fade * (h.id && !h.near?.has(n.id) ? 0.12 : n.ghost ? 0.55 : 0.85)
          if (a < 0.02) continue
          ctx.globalAlpha = a
          ctx.fillStyle = t.fg
          ctx.fillText(shortName(n.name), x, y + n.r + 2 / k)
        }
        // Node đang hover và note đang mở: luôn có nhãn, có viền nền cho dễ đọc.
        ctx.globalAlpha = 1
        ctx.lineWidth = 3 / k
        ctx.strokeStyle = t.bg
        for (const n of special) {
          const label = n.ghost ? `${shortName(n.name)} (chưa có)` : shortName(n.name)
          ctx.strokeText(label, n.x ?? 0, (n.y ?? 0) + n.r + 2 / k)
          ctx.fillStyle = t.fg
          ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + n.r + 2 / k)
        }
      })
      .onNodeHover((n) => {
        hover.current = { id: n?.id ?? null, near: n ? (neighbors.current.get(n.id) ?? null) : null }
        fg.nodeRelSize(1) // ép vẽ lại khung hình (autoPauseRedraw)
      })
      .onNodeClick((n) => {
        if (!n.ghost) onOpenRef.current(n.id)
      })
      .onEngineTick(() => {
        // Vừa khung sớm một lần cho khỏi phải chờ mô phỏng dừng hẳn.
        if (++ticks.current === 40 && fitPending.current) fitView(fg, 300)
      })
      .onEngineStop(() => {
        // Dev: mốc thời gian mô phỏng dừng, để đo qua CDP.
        if (import.meta.env.DEV) host.dataset.settledAt = String(Math.round(performance.now()))
        if (fitPending.current) {
          fitPending.current = false
          fitView(fg, 400)
        }
      })

    // Lực: đẩy nhau vừa phải, link dài hơn mặc định một chút, kéo nhẹ về tâm để note mồ côi không trôi xa.
    // Mọi lực nhân thêm `heat`: force-graph luôn đặt alpha = 1 khi nạp dữ liệu, vault đổi nhẹ thì chỉ cần "ấm".
    const charge = fg.d3Force('charge')!
    const linkForce = fg.d3Force('link')!
    // Node to (nhiều link) đẩy mạnh hơn và đứng xa hơn để nhãn đỡ chồng nhau.
    charge.strength((n: SimNode) => -40 - 4 * n.r).distanceMax(600)
    linkForce.distance((l: SimLink) => 24 + (l.source as SimNode).r + (l.target as SimNode).r)
    fg.d3Force('charge', damped(charge, () => heat.current))
    fg.d3Force('link', damped(linkForce, () => heat.current))
    let simNodes: SimNode[] = []
    const gravity = Object.assign(
      (alpha: number) => {
        const a = alpha * heat.current * 0.02
        for (const n of simNodes) {
          n.vx = (n.vx ?? 0) - (n.x ?? 0) * a
          n.vy = (n.vy ?? 0) - (n.y ?? 0) * a
        }
      },
      { initialize: (ns: SimNode[]) => void (simNodes = ns) }
    )
    fg.d3Force('gravity', gravity)

    // Người dùng tự zoom/kéo thì thôi tự vừa khung.
    const stopFit = (): void => void (fitPending.current = false)
    host.addEventListener('wheel', stopFit, { passive: true })
    host.addEventListener('pointerdown', stopFit)

    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 0 && height > 0) fg.width(width).height(height)
    })
    ro.observe(host)

    fgRef.current = fg
    if (import.meta.env.DEV) Object.assign(host, { __fg: fg }) // test qua CDP
    lastSig.current = ''
    lastFitKey.current = ''
    return () => {
      ro.disconnect()
      host.removeEventListener('wheel', stopFit)
      host.removeEventListener('pointerdown', stopFit)
      if (lastSig.current) store.view = { ...fg.centerAt(), k: fg.zoom() }
      fg._destructor()
      host.replaceChildren()
      fgRef.current = null
    }
  }, [store])

  // Nạp dữ liệu mỗi khi phần hiển thị đổi; node cũ giữ vị trí.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    neighbors.current = neighborMap(display.links)
    const h = hover.current
    if (h.id) hover.current = { id: h.id, near: neighbors.current.get(h.id) ?? null }

    // Đổi chế độ/bộ lọc (không phải vault đổi) → vừa khung khi xếp xong.
    const fitKey = JSON.stringify([settings, localCenter])
    const first = !lastSig.current
    const userChange = !!lastFitKey.current && fitKey !== lastFitKey.current
    if (userChange) fitPending.current = true
    lastFitKey.current = fitKey

    const sig = signature(display)
    if (sig === lastSig.current) {
      fg.nodeRelSize(1) // chỉ đổi tên/loại/màu → vẽ lại
      return
    }
    lastSig.current = sig

    // Node mới: đặt cạnh một hàng xóm đã có vị trí thay vì bay từ giữa vào.
    let fresh = 0
    for (const n of display.nodes) {
      if (n.x !== undefined) continue
      fresh++
      for (const id of neighbors.current.get(n.id) ?? []) {
        const o = store.pool.get(id)
        if (o?.x !== undefined && o.y !== undefined) {
          n.x = o.x + (Math.random() - 0.5) * 20
          n.y = o.y + (Math.random() - 0.5) * 20
          break
        }
      }
    }
    // Đổi chế độ/bộ lọc → xếp lại hẳn; vault đổi hoặc mở lại graph (node đã có vị trí) → chỉ "ấm".
    heat.current = userChange ? 1 : Math.min(1, Math.max(0.05, (fresh / Math.max(1, display.nodes.length)) * 3))
    ticks.current = 0
    if (import.meta.env.DEV) hostRef.current!.dataset.loadedAt = String(Math.round(performance.now()))
    fg.graphData({ nodes: display.nodes, links: display.links.map((l: GLink) => ({ source: l.source, target: l.target })) })
    if (first) {
      if (store.view) {
        fg.centerAt(store.view.x, store.view.y)
        fg.zoom(store.view.k)
      } else fitPending.current = true
    }
  }, [display, settings, localCenter, store])

  // Đổi note đang mở → vẽ lại vòng sáng.
  useEffect(() => {
    fgRef.current?.nodeRelSize(1)
  }, [current])

  const hidden = new Set(settings.hidden)
  const toggleType = (key: string): void =>
    setSettings({ hidden: hidden.has(key) ? settings.hidden.filter((k) => k !== key) : [...settings.hidden, key] })
  const btn = (on: boolean): string =>
    `px-2 py-0.5 text-[12px] ${on ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'} disabled:cursor-default disabled:opacity-40 disabled:hover:text-muted`

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />

      {display.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted">
          {graph.nodes.length === 0 ? 'Vault chưa có note.' : 'Không có note nào khớp bộ lọc.'}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel/90 px-2 py-1.5 shadow">
          <div className="flex overflow-hidden rounded border border-line">
            <button className={btn(!local)} onClick={() => setSettings({ mode: 'global' })}>
              Toàn vault
            </button>
            <button
              className={btn(local)}
              disabled={!canLocal}
              title={canLocal ?'Graph quanh note đang mở' : 'Mở một note để xem graph cục bộ'}
              onClick={() => setSettings({ mode: 'local' })}
            >
              Cục bộ
            </button>
          </div>
          {local && (
            <div className="flex items-center gap-1 text-[12px] text-muted">
              Độ sâu
              <div className="flex overflow-hidden rounded border border-line">
                {([1, 2] as const).map((d) => (
                  <button key={d} className={btn(settings.depth === d)} onClick={() => setSettings({ depth: d })}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-1 text-[12px] text-muted hover:text-fg">
            <input
              type="checkbox"
              className="accent-accent"
              checked={settings.showGhosts}
              onChange={(e) => setSettings({ showGhosts: e.target.checked })}
            />
            Hiện note chưa có{ghostCount ? ` (${ghostCount})` : ''}
          </label>
          <label className="flex cursor-pointer items-center gap-1 text-[12px] text-muted hover:text-fg">
            <input
              type="checkbox"
              className="accent-accent"
              checked={settings.hideOrphans}
              onChange={(e) => setSettings({ hideOrphans: e.target.checked })}
            />
            Ẩn note mồ côi
          </label>
          <button
            className="rounded border border-line px-2 py-0.5 text-[12px] text-muted hover:text-fg"
            onClick={() => {
              fitPending.current = false
              if (fgRef.current) fitView(fgRef.current, 400)
            }}
          >
            Vừa khung
          </button>
        </div>

        <div className="flex-1" />

        {stats.length > 0 && (
          <div className="pointer-events-auto max-h-[60vh] min-w-36 overflow-y-auto rounded-md border border-line bg-panel/90 py-1 shadow">
            {stats.map(({ key, count }) => {
              const off = hidden.has(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleType(key)}
                  title={off ? 'Bấm để hiện loại này' : 'Bấm để ẩn loại này'}
                  className={`flex w-full items-center gap-2 px-2.5 py-0.5 text-left text-[12px] hover:bg-panel-2 ${off ? 'text-muted line-through opacity-50' : 'text-fg'}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: typeColor(key || null) }} />
                  <span className="flex-1 truncate">{key || 'không loại'}</span>
                  <span className="text-muted">{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 text-[11px] text-muted">
        {display.nodes.length} node · {display.links.length} link
        {local && ' · cục bộ'}
      </div>
    </div>
  )
}
