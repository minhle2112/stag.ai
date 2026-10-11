import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  GRID,
  fitView,
  rectOf,
  revealView,
  snapMove,
  snapResize,
  tidyRects,
  toWorld,
  zoomAt,
  type Edges,
  type Guide,
  type Point
} from '@shared/canvas'
import type { CanvasCell, CanvasLayout, CanvasRect, CanvasView, Workspace } from '@shared/types'
import { registerCanvas } from '../../canvasBus'
import { cellKey, findCell, rectsOf, setRects } from '../../layout'
import { useAgents } from '../../store/agents'
import { usePlugins, widgetsOf } from '../../store/plugins'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { suspendFit } from '../../terminals'
import { Icon, type IconName } from '../Icon'
import { SkillAvatar } from '../settings/SkillsSection'
import { FLY_EASE, FLY_MS, FrameCtx, Popover, dragWith, emitter, useEmitter, type Emitter, type FrameApi } from './frame'

/** Camera khi chưa có gì để vừa khung. */
const HOME: CanvasView = { x: 40, y: 40, zoom: 1 }
/** Ngưỡng hít (px màn hình) khi kéo ô. */
const SNAP_PX = 8
/** Lưu camera sau khi ngừng cuộn / kéo bấy lâu. */
const SAVE_VIEW_MS = 500
/** Chừa phía trên cho thanh công cụ nổi khi vừa khung / xếp gọn. */
const TOOLBAR_SPACE = 44
/** Vừa khung các hình trong khung canvas cỡ `size` (chừa chỗ thanh công cụ). */
const fitAllView = (rects: CanvasRect[], size: { w: number; h: number }): CanvasView => fitView(rects, size, 32, 1, TOOLBAR_SPACE)
/** Số bước hoàn tác giữ lại cho mỗi workspace. */
const UNDO_MAX = 30

/** Hoàn tác vị trí / kích thước ô (Ctrl+Z, nút "Hoàn tác"): mỗi bước = hình của mọi ô trước khi đổi. */
const undoStacks = new Map<string, Array<Record<string, CanvasRect>>>()

function pushUndo(wsId: string, layout: CanvasLayout): void {
  const stack = undoStacks.get(wsId) ?? []
  stack.push(rectsOf(layout))
  if (stack.length > UNDO_MAX) stack.shift()
  undoStacks.set(wsId, stack)
}

/** Phím đang gõ vào terminal / ô nhập: Esc, Ctrl+Z là của nó, không phải của canvas. */
function typingTarget(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null
  return !!e?.closest?.('.xterm, input, textarea, select, [contenteditable="true"], iframe')
}

interface Props {
  ws: Workspace
  layout: CanvasLayout
  /** Có agent nào trong workspace không (để chọn lời nhắc khi canvas trống). */
  hasAgents: boolean
  renderCell: (cell: CanvasCell) => ReactNode
}

/**
 * Canvas tự do của tab Agents: ô đặt ở bất kỳ đâu, kéo tiêu đề để di chuyển, kéo cạnh / góc để đổi cỡ (hít lưới chấm
 * 20px và cạnh ô khác), lăn chuột / kéo nền để di chuyển, Ctrl+lăn để phóng to thu nhỏ, chuột phải lên nền để tạo ô.
 * Nút phóng to trên ô: camera bay tới ô đó và ô lấp kín khung canvas; bấm lại (hoặc Esc) để bay về bản đồ.
 *
 * Camera không nằm trong store (đổi mỗi khung hình khi kéo): giữ trong ref, gắn thẳng vào style của lớp "thế giới",
 * lưu vào bố cục khi đã đứng yên.
 */
export function CanvasBoard({ ws, layout, hasAgents, renderCell }: Props): React.JSX.Element {
  const wsId = ws.id
  const boxRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<CanvasView>(layout.view ?? HOME)
  const sizeRef = useRef({ w: 0, h: 0 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Camera đã chọn chưa (có camera đã lưu, hoặc đã vừa khung lần đầu). */
  const placedRef = useRef(!!layout.view)
  const frameEls = useRef(new Map<string, HTMLDivElement>())
  const zoomEm = useMemo(() => emitter(viewRef.current.zoom), [])
  const guidesEm = useMemo(() => emitter<Guide[]>([]), [])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Ô và camera đang bay (phóng to / thu về / xếp gọn): bật transition cho vị trí + cỡ ô. */
  const [anim, setAnim] = useState(false)
  const [menu, setMenu] = useState<{ at: Point; screen: Point; bounds: DOMRect } | null>(null)
  const [toast, setToast] = useState<{ text: string; undo: boolean } | null>(null)

  const setLayout = useAgents((s) => s.setLayout)
  const setView = useAgents((s) => s.setView)
  const setMaxCell = useUi((s) => s.setMaxCell)
  const maxRaw = useUi((s) => s.maxCell[wsId] ?? null)
  const maxKey = maxRaw && findCell(layout, maxRaw) ? maxRaw : null
  const maxRef = useRef(maxKey)
  /**
   * Ô phóng to ở lần vẽ trước: khác với hiện tại = đang đổi trạng thái phóng to (bật transition ngay lần vẽ này).
   * Bắt đầu từ null để canvas gắn lại khi đang phóng to một ô cũng đặt camera vào ô đó.
   */
  const shownMaxRef = useRef<string | null>(null)
  /** Camera trước khi phóng to, để bay về đúng chỗ. */
  const beforeMax = useRef<CanvasView | null>(null)

  const getLayout = useCallback((): CanvasLayout | undefined => useAgents.getState().byWs[wsId]?.layout, [wsId])

  /** Gắn camera vào DOM: lớp thế giới + lưới chấm nền (thưa ra khi thu nhỏ quá). */
  const apply = useCallback(
    (view: CanvasView, fly = false) => {
      viewRef.current = view
      const world = worldRef.current
      const box = boxRef.current
      if (!world || !box) return
      const tr = fly ? `${FLY_MS}ms ${FLY_EASE}` : ''
      world.style.transition = tr ? `transform ${tr}` : ''
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
      // Nét vạch gióng / tay nắm đổi cỡ giữ độ dày trên màn hình ở mọi mức zoom.
      world.style.setProperty('--inv', String(1 / view.zoom))
      let step = GRID * view.zoom
      while (step < 10) step *= 2
      box.style.transition = tr ? `background-position ${tr}, background-size ${tr}` : ''
      box.style.backgroundSize = `${step}px ${step}px`
      box.style.backgroundPosition = `${view.x}px ${view.y}px`
      zoomEm.set(view.zoom)
    },
    [zoomEm]
  )

  /** Lưu camera khi đã đứng yên (không lưu camera tạm lúc đang phóng to một ô). */
  const saveSoon = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      if (!maxRef.current) setView(wsId, viewRef.current)
    }, SAVE_VIEW_MS)
  }, [wsId, setView])

  /** Bật transition cho ô + tạm ngừng canh terminal trong lúc bay; xong thì canh lại một lần. */
  const flight = useCallback(() => {
    if (animTimer.current) clearTimeout(animTimer.current)
    suspendFit(true)
    setAnim(true)
    animTimer.current = setTimeout(() => {
      animTimer.current = null
      setAnim(false)
      suspendFit(false)
    }, FLY_MS + 40)
  }, [])

  const flyTo = useCallback(
    (view: CanvasView) => {
      apply(view, true)
      saveSoon()
    },
    [apply, saveSoon]
  )

  useLayoutEffect(() => {
    apply(viewRef.current)
  }, [apply])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (animTimer.current) {
        clearTimeout(animTimer.current)
        suspendFit(false)
      }
    },
    []
  )

  // Cỡ khung canvas (đổi khi kéo cửa sổ, bật / tắt thanh bên, pane trình duyệt).
  useLayoutEffect(() => {
    const box = boxRef.current!
    const measure = (): void => {
      const next = { w: box.clientWidth, h: box.clientHeight }
      sizeRef.current = next
      setSize(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // Lần đầu mở mà chưa có camera đã lưu: vừa khung mọi ô.
  useEffect(() => {
    if (placedRef.current || size.w <= 0 || size.h <= 0) return
    placedRef.current = true
    apply(fitAllView(layout.cells, size))
  }, [size, layout.cells, apply])

  // Phóng to / thu về / chuyển sang ô khác: camera bay cùng lúc với ô đổi cỡ (transition bật ngay lần vẽ này).
  useLayoutEffect(() => {
    const prev = shownMaxRef.current
    shownMaxRef.current = maxKey
    maxRef.current = maxKey
    if (maxRaw && !maxKey) setMaxCell(wsId, null) // ô đang phóng to đã đóng
    if (prev === maxKey) return
    const cell = maxKey ? findCell(layout, maxKey) : undefined
    flight()
    if (cell) {
      if (!prev) beforeMax.current = viewRef.current
      apply({ x: -cell.x, y: -cell.y, zoom: 1 }, true)
    } else {
      apply(beforeMax.current ?? fitAllView(layout.cells, sizeRef.current), true)
      beforeMax.current = null
      saveSoon()
    }
  }, [maxKey, maxRaw, layout, wsId, apply, flight, saveSoon, setMaxCell])

  // Store / bảng lệnh hỏi tâm vùng đang nhìn, nhờ bay tới ô.
  useEffect(
    () =>
      registerCanvas(wsId, {
        view: () => viewRef.current,
        size: () => sizeRef.current,
        reveal(key, user) {
          const cur = useUi.getState().maxCell[wsId]
          const l = getLayout()
          if (!l) return
          if (cur && findCell(l, cur)) {
            if (user && cur !== key && findCell(l, key)) setMaxCell(wsId, key)
            return
          }
          const cell = findCell(l, key)
          if (!cell) return
          const next = revealView(viewRef.current, cell, sizeRef.current, 32, TOOLBAR_SPACE)
          if (next !== viewRef.current) flyTo(next)
        }
      }),
    [wsId, getLayout, flyTo, setMaxCell]
  )

  // Lăn chuột. Pha capture: Ctrl+lăn phóng to thu nhỏ ở mọi chỗ (kể cả trên terminal, trước khi xterm cuộn).
  // Pha bubble: lăn trên nền / thanh tiêu đề ô = di chuyển bản đồ; trong thân ô thì để ô tự cuộn.
  useEffect(() => {
    const box = boxRef.current!
    const onCapture = (e: WheelEvent): void => {
      if (maxRef.current || !e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const r = box.getBoundingClientRect()
      apply(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top))
      saveSoon()
    }
    const onBubble = (e: WheelEvent): void => {
      if (maxRef.current || e.ctrlKey || (e.target as HTMLElement).closest?.('[data-cell-body]')) return
      e.preventDefault()
      let dx = e.deltaX
      let dy = e.deltaY
      if (e.shiftKey && !dx) {
        dx = dy
        dy = 0
      }
      const v = viewRef.current
      apply({ ...v, x: v.x - dx, y: v.y - dy })
      saveSoon()
    }
    box.addEventListener('wheel', onCapture, { capture: true, passive: false })
    box.addEventListener('wheel', onBubble, { passive: false })
    return () => {
      box.removeEventListener('wheel', onCapture, { capture: true })
      box.removeEventListener('wheel', onBubble)
    }
  }, [apply, saveSoon])

  const visible = (): boolean => {
    const ui = useUi.getState()
    return ui.tab === 'agents' && !ui.settings && useWorkspaces.getState().activeId === wsId
  }

  const applyRects = useCallback(
    (rects: Record<string, CanvasRect>, fly: boolean) => {
      const l = getLayout()
      if (!l) return
      pushUndo(wsId, l)
      if (fly) flight()
      setLayout(wsId, setRects(l, rects))
    },
    [wsId, getLayout, setLayout, flight]
  )

  const undo = useCallback(() => {
    const l = getLayout()
    const prev = undoStacks.get(wsId)?.pop()
    if (!l || !prev) return
    flight()
    setLayout(wsId, setRects(l, prev))
    setToast(null)
  }, [wsId, getLayout, setLayout, flight])

  // Esc: thu ô đang phóng to về bản đồ. Ctrl+Z: hoàn tác di chuyển / đổi cỡ / xếp gọn. Không đụng tới phím đang gõ
  // vào terminal / ô nhập (Esc là phím ngắt của Claude Code).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!visible() || typingTarget(e.target) || useUi.getState().modals > 0) return
      if (e.key === 'Escape' && maxRef.current) {
        e.preventDefault()
        setMaxCell(wsId, null)
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && !maxRef.current) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, undo, setMaxCell])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const fitAll = (): void => {
    const l = getLayout()
    if (l) flyTo(fitAllView(l.cells, sizeRef.current))
  }

  const zoomBy = (factor: number): void => {
    const { w, h } = sizeRef.current
    flyTo(zoomAt(viewRef.current, factor, w / 2, h / 2))
  }

  const tidy = (): void => {
    const l = getLayout()
    if (!l || !l.cells.length) return
    // Lưới vừa khung canvas ở 100% (trừ lề + thanh công cụ), rồi camera vừa khung lưới đó.
    const { w, h } = sizeRef.current
    const rects = tidyRects(
      l.cells.map((c) => ({ ...rectOf(c), key: cellKey(c) })),
      { w: w - 24, h: h - 24 - TOOLBAR_SPACE }
    )
    applyRects(rects, true)
    flyTo(fitAllView(Object.values(rects), sizeRef.current))
    setToast({ text: `Đã xếp gọn ${l.cells.length} ô`, undo: true })
  }

  /** Kéo nền (chuột trái) hoặc giữ chuột giữa ở bất kỳ đâu: di chuyển bản đồ. */
  function startPan(e: React.MouseEvent): void {
    e.preventDefault()
    const start = viewRef.current
    dragWith(
      e,
      'grabbing',
      (dx, dy) => apply({ ...start, x: start.x + dx, y: start.y + dy }),
      () => saveSoon()
    )
  }

  const onBackground = (e: React.MouseEvent): boolean => e.target === boxRef.current || e.target === worldRef.current

  function startMove(key: string, e: React.MouseEvent): void {
    const l = getLayout()
    const cell = l && findCell(l, key)
    const el = frameEls.current.get(key)
    if (e.button !== 0 || maxRef.current || !l || !cell || !el) return
    e.preventDefault()
    const others = l.cells.filter((c) => c !== cell)
    let rect = rectOf(cell)
    let moved = false
    dragWith(
      e,
      'grabbing',
      (dx, dy) => {
        if (!moved && Math.hypot(dx, dy) < 3) return
        moved = true
        const z = viewRef.current.zoom
        const res = snapMove({ ...rectOf(cell), x: cell.x + dx / z, y: cell.y + dy / z }, others, SNAP_PX / z)
        rect = res.rect
        el.style.left = `${rect.x}px`
        el.style.top = `${rect.y}px`
        guidesEm.set(res.guides)
      },
      () => {
        guidesEm.set([])
        if (moved) applyRects({ [key]: rect }, false)
      }
    )
  }

  function startResize(key: string, edges: Edges, e: React.MouseEvent): void {
    const l = getLayout()
    const cell = l && findCell(l, key)
    const el = frameEls.current.get(key)
    if (e.button !== 0 || maxRef.current || !l || !cell || !el) return
    e.preventDefault()
    e.stopPropagation()
    useAgents.getState().focus(wsId, key)
    const others = l.cells.filter((c) => c !== cell)
    let rect = rectOf(cell)
    let moved = false
    dragWith(
      e,
      HANDLE_CURSOR[edgeName(edges)],
      (dx, dy) => {
        moved = true
        const z = viewRef.current.zoom
        const raw = { ...rectOf(cell) }
        if (edges.l) {
          raw.x += dx / z
          raw.w -= dx / z
        }
        if (edges.r) raw.w += dx / z
        if (edges.t) {
          raw.y += dy / z
          raw.h -= dy / z
        }
        if (edges.b) raw.h += dy / z
        const res = snapResize(raw, edges, others, SNAP_PX / z)
        rect = res.rect
        el.style.left = `${rect.x}px`
        el.style.top = `${rect.y}px`
        el.style.width = `${rect.w}px`
        el.style.height = `${rect.h}px`
        guidesEm.set(res.guides)
      },
      () => {
        guidesEm.set([])
        if (moved) applyRects({ [key]: rect }, false)
      }
    )
  }

  const changing = shownMaxRef.current !== maxKey
  const flying = anim || changing

  return (
    <div
      ref={boxRef}
      className={`absolute inset-0 overflow-hidden bg-bg bg-[radial-gradient(var(--color-line-2)_1px,transparent_1.3px)] ${maxKey ? '' : 'cursor-grab'}`}
      onMouseDownCapture={(e) => {
        // Chuột giữa: di chuyển bản đồ kể cả khi đang trỏ vào ô (trước khi terminal / chat nhận sự kiện).
        if (e.button === 1 && !maxRef.current) {
          e.stopPropagation()
          startPan(e)
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 0 && !maxRef.current && onBackground(e)) startPan(e)
      }}
      onContextMenu={(e) => {
        if (maxRef.current || !onBackground(e)) return
        e.preventDefault()
        const r = boxRef.current!.getBoundingClientRect()
        setMenu({ at: toWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top), screen: { x: e.clientX, y: e.clientY }, bounds: r })
      }}
    >
      <div ref={worldRef} className="absolute top-0 left-0 origin-top-left">
        {layout.cells.map((c) => {
          const key = cellKey(c)
          const maximized = key === maxKey
          return (
            <CellFrame
              key={key}
              cell={c}
              maximized={maximized}
              size={size}
              flying={flying}
              register={(el) => (el ? frameEls.current.set(key, el) : frameEls.current.delete(key))}
              onResize={(edges, e) => startResize(key, edges, e)}
              api={{ startMove: (e) => startMove(key, e), maximized, toggleMax: () => setMaxCell(wsId, maximized ? null : key) }}
            >
              {renderCell(c)}
            </CellFrame>
          )
        })}
        <Guides em={guidesEm} />
      </div>

      {!layout.cells.length && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-dim">
          <Icon name="grid" size={28} />
          <div>{hasAgents ? 'Không có ô nào đang mở.' : 'Workspace này chưa có agent.'}</div>
          <div className="text-[12px]">
            {hasAgents ? 'Bấm agent ở thanh bên để mở lại ô của nó, hoặc chuột phải vào đây để tạo agent mới.' : 'Chuột phải vào đây → Agent mới (hoặc Ctrl+K).'}
          </div>
        </div>
      )}

      {!maxKey && (
        <Toolbar
          zoom={zoomEm}
          onBroadcast={() => useUi.getState().setBroadcast(wsId)}
          onZoomOut={() => zoomBy(1 / 1.2)}
          onZoomIn={() => zoomBy(1.2)}
          onReset={() => {
            const { w, h } = sizeRef.current
            const v = viewRef.current
            flyTo(zoomAt(v, 1 / v.zoom, w / 2, h / 2))
          }}
          onFit={fitAll}
          onTidy={tidy}
          canTidy={layout.cells.length > 0}
        />
      )}

      {toast && (
        <div className="absolute bottom-4 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-2 bg-panel-2 py-1.5 pr-1.5 pl-3 text-[12.5px] shadow-[0_10px_30px_rgba(0,0,0,.5)]">
          {toast.text}
          {toast.undo && (
            <button type="button" onClick={undo} className="rounded-md px-2 py-1 font-semibold text-accent hover:bg-panel-3" data-tip="Ctrl+Z">
              Hoàn tác
            </button>
          )}
        </div>
      )}

      {menu && (
        <CanvasMenu
          ws={ws}
          layout={layout}
          at={menu.at}
          screen={menu.screen}
          bounds={menu.bounds}
          onClose={() => setMenu(null)}
          onTidy={tidy}
          onFit={fitAll}
        />
      )}
    </div>
  )
}

type HandleName = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: Array<{ name: HandleName; edges: Edges; style: React.CSSProperties }> = (() => {
  // Độ dày tay nắm tính theo px màn hình (--inv = 1 / zoom), thò ra ngoài ô một nửa.
  const t = 'calc(8px * var(--inv, 1))'
  const half = 'calc(-4px * var(--inv, 1))'
  const c = 'calc(14px * var(--inv, 1))'
  const ch = 'calc(-7px * var(--inv, 1))'
  return [
    { name: 'n', edges: { t: true }, style: { top: half, left: c, right: c, height: t } },
    { name: 's', edges: { b: true }, style: { bottom: half, left: c, right: c, height: t } },
    { name: 'w', edges: { l: true }, style: { left: half, top: c, bottom: c, width: t } },
    { name: 'e', edges: { r: true }, style: { right: half, top: c, bottom: c, width: t } },
    { name: 'nw', edges: { t: true, l: true }, style: { top: ch, left: ch, width: c, height: c } },
    { name: 'ne', edges: { t: true, r: true }, style: { top: ch, right: ch, width: c, height: c } },
    { name: 'sw', edges: { b: true, l: true }, style: { bottom: ch, left: ch, width: c, height: c } },
    { name: 'se', edges: { b: true, r: true }, style: { bottom: ch, right: ch, width: c, height: c } }
  ]
})()

const HANDLE_CURSOR: Record<HandleName, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize'
}

function edgeName(e: Edges): HandleName {
  return `${e.t ? 'n' : e.b ? 's' : ''}${e.l ? 'w' : e.r ? 'e' : ''}` as HandleName
}

/** Khung định vị một ô trên canvas: vị trí / cỡ / thứ tự chồng, bo góc + bóng, tay nắm đổi cỡ. */
function CellFrame({
  cell,
  maximized,
  size,
  flying,
  register,
  onResize,
  api,
  children
}: {
  cell: CanvasCell
  maximized: boolean
  size: { w: number; h: number }
  flying: boolean
  register: (el: HTMLDivElement | null) => void
  onResize: (edges: Edges, e: React.MouseEvent) => void
  api: FrameApi
  children: ReactNode
}): React.JSX.Element {
  return (
    <FrameCtx.Provider value={api}>
      <div
        ref={register}
        data-canvas-cell={cellKey(cell)}
        className="absolute cursor-auto"
        style={{
          left: cell.x,
          top: cell.y,
          width: maximized ? size.w : cell.w,
          height: maximized ? size.h : cell.h,
          zIndex: maximized ? 100000 : cell.z,
          transition: flying ? `left ${FLY_MS}ms ${FLY_EASE}, top ${FLY_MS}ms ${FLY_EASE}, width ${FLY_MS}ms ${FLY_EASE}, height ${FLY_MS}ms ${FLY_EASE}` : undefined
        }}
      >
        <div className={`absolute inset-0 overflow-hidden ${maximized ? '' : 'rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,.45)]'}`}>{children}</div>
        {!maximized &&
          HANDLES.map((h) => (
            <div key={h.name} className="absolute z-[6]" style={{ ...h.style, cursor: HANDLE_CURSOR[h.name] }} onMouseDown={(e) => onResize(h.edges, e)} />
          ))}
      </div>
    </FrameCtx.Provider>
  )
}

/** Vạch gióng teal khi ô hít vào cạnh ô khác. */
function Guides({ em }: { em: Emitter<Guide[]> }): React.JSX.Element {
  const guides = useEmitter(em)
  return (
    <>
      {guides.map((g, i) => (
        <div
          key={i}
          className="pointer-events-none absolute z-[100001] bg-accent"
          style={
            g.axis === 'x'
              ? { left: g.at, top: g.from - 12, height: g.to - g.from + 24, width: 'calc(1px * var(--inv, 1))' }
              : { top: g.at, left: g.from - 12, width: g.to - g.from + 24, height: 'calc(1px * var(--inv, 1))' }
          }
        />
      ))}
    </>
  )
}

function ToolBtn({ icon, label, tip, onClick, disabled }: { icon?: IconName; label?: string; tip: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tip={tip}
      aria-label={tip}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-panel-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    >
      {icon && <Icon name={icon} size="s" />}
      {label}
    </button>
  )
}

/** Thanh nổi giữa trên canvas: phát lệnh, zoom − % +, vừa khung, xếp gọn. */
function Toolbar({
  zoom,
  onBroadcast,
  onZoomOut,
  onZoomIn,
  onReset,
  onFit,
  onTidy,
  canTidy
}: {
  zoom: Emitter<number>
  onBroadcast: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
  onFit: () => void
  onTidy: () => void
  canTidy: boolean
}): React.JSX.Element {
  const z = useEmitter(zoom)
  return (
    <div
      className="absolute top-2.5 left-1/2 z-[5] flex -translate-x-1/2 cursor-auto items-center gap-0.5 rounded-[10px] border border-line-2 bg-panel/90 p-1 shadow-[0_10px_30px_rgba(0,0,0,.45)] backdrop-blur"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <ToolBtn icon="send" tip="Phát lệnh cho nhiều agent" onClick={onBroadcast} />
      <span className="mx-1 h-4 w-px bg-line-2" />
      <ToolBtn icon="minus" tip="Thu nhỏ · Ctrl+lăn chuột" onClick={onZoomOut} />
      <button
        type="button"
        onClick={onReset}
        data-tip="Về 100%"
        className="h-[26px] w-[46px] rounded-md text-center font-mono text-[11.5px] text-muted hover:bg-panel-3 hover:text-fg"
      >
        {Math.round(z * 100)}%
      </button>
      <ToolBtn icon="plus" tip="Phóng to · Ctrl+lăn chuột" onClick={onZoomIn} />
      <span className="mx-1 h-4 w-px bg-line-2" />
      <ToolBtn icon="fit" label="Vừa khung" tip="Thu vừa mọi ô vào màn hình" onClick={onFit} />
      <ToolBtn icon="tidy" label="Xếp gọn" tip="Xếp mọi ô thành lưới ngăn nắp (hoàn tác: Ctrl+Z)" onClick={onTidy} disabled={!canTidy} />
    </div>
  )
}

function MenuRow({ icon, label, hint, onClick, sub }: { icon?: IconName; label: string; hint?: string; onClick?: () => void; sub?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left whitespace-nowrap hover:bg-panel-3"
    >
      {icon ? <Icon name={icon} size="s" className="text-muted" /> : <span className="w-[14px]" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[12px] text-dim">{hint}</span>}
      {sub && <Icon name="cr" size="s" className="text-dim" />}
    </button>
  )
}

const PANEL = 'w-56 overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 text-[13px] shadow-[0_14px_40px_rgba(0,0,0,.6)]'

/** Menu chuột phải trên nền canvas: tạo ô ngay tại chỗ bấm, xếp gọn, vừa khung. */
function CanvasMenu({
  ws,
  layout,
  at,
  screen,
  bounds,
  onClose,
  onTidy,
  onFit
}: {
  ws: Workspace
  layout: CanvasLayout
  at: Point
  screen: Point
  bounds: DOMRect
  onClose: () => void
  onTidy: () => void
  onFit: () => void
}): React.JSX.Element {
  const items = usePlugins((s) => s.items)
  const settings = useSettings((s) => s.value)
  const openWidget = useAgents((s) => s.openWidget)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const [sub, setSub] = useState<HTMLElement | null>(null)
  const list = widgetsOf(items, settings, ws.id)
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <Popover at={screen} bounds={bounds} onClose={onClose}>
      <div className={PANEL} role="menu" onMouseOver={(e) => sub && !sub.contains(e.target as Node) && setSub(null)}>
        <MenuRow icon="plus" label="Agent mới" hint="Ctrl+Alt+N" onClick={run(() => setNewAgent({ wsId: ws.id, at }))} />
        <MenuRow icon="term" label="Terminal mới" onClick={run(() => setNewAgent({ wsId: ws.id, at, kind: 'terminal' }))} />
        <div onMouseEnter={(e) => setSub(e.currentTarget)} onClick={(e) => setSub(e.currentTarget)}>
          <MenuRow icon="widget" label="Widget" sub />
        </div>
        <div className="my-1 border-t border-line-2" />
        <MenuRow icon="tidy" label="Xếp gọn" onClick={run(onTidy)} />
        <MenuRow icon="fit" label="Vừa khung" onClick={run(onFit)} />
      </div>
      {sub && (
        <WidgetSubmenu
          anchor={sub}
          bounds={bounds}
          list={list}
          shown={layout.cells.flatMap((c) => (c.type === 'widget' ? [c.widget] : []))}
          onPick={(id) => {
            onClose()
            openWidget(ws.id, id, { at })
          }}
          onLeave={() => setSub(null)}
        />
      )}
    </Popover>
  )
}

/** Menu con "Widget": đặt cạnh mục Widget, lật sang trái nếu bên phải không đủ chỗ trong khung canvas. */
function WidgetSubmenu({
  anchor,
  bounds,
  list,
  shown,
  onPick,
  onLeave
}: {
  anchor: HTMLElement
  bounds: DOMRect
  list: ReturnType<typeof widgetsOf>
  shown: string[]
  onPick: (id: string) => void
  onLeave: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = r.right + 2 + w <= bounds.right ? r.right + 2 : r.left - 2 - w
    const top = Math.max(bounds.top + 4, Math.min(r.top - 4, bounds.bottom - h - 4))
    setPos({ left, top })
  }, [anchor, bounds])
  return (
    <div ref={ref} className={`fixed ${PANEL}`} style={pos ?? { left: -9999, top: -9999 }} onMouseLeave={(e) => !anchor.contains(e.relatedTarget as Node) && onLeave()}>
      {list.length ? (
        list.map(({ id, plugin, slot }) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            data-widget={id}
            onClick={() => onPick(id)}
            data-tip={shown.includes(id) ? 'Đã mở — bấm để tới ô đó' : 'Mở tại chỗ vừa bấm chuột phải'}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-panel-3"
          >
            <SkillAvatar name={plugin.manifest.displayName} size={16} />
            <span className="min-w-0 flex-1 truncate">
              {plugin.manifest.displayName} · {slot.displayName}
            </span>
            {shown.includes(id) && <span className="shrink-0 text-[11px] text-dim">đang mở</span>}
          </button>
        ))
      ) : (
        <div className="px-2.5 py-1.5 text-[12px] text-dim">Chưa có widget nào — cài plugin ở Cài đặt → Plugin.</div>
      )}
    </div>
  )
}
