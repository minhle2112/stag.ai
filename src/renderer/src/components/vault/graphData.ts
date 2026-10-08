import type { VaultIndex } from '@shared/types'

/** Node của graph: một note, hoặc một node "ma" (link tới note chưa có). */
export interface GNode {
  /** `rel` của note; node ma: `ghost:` + tên đích viết thường. */
  id: string
  name: string
  type: string | null
  ghost: boolean
  /** Số hàng xóm (sau khi bỏ cạnh trùng), dùng tính cỡ node. */
  degree: number
}

/** Cạnh vô hướng giữa hai id node. */
export interface GLink {
  source: string
  target: string
}

export interface VaultGraph<N extends GNode = GNode> {
  nodes: N[]
  links: GLink[]
}

export interface GraphFilter {
  /** Loại bị ẩn (khoá theo `typeKey`). */
  hiddenTypes: ReadonlySet<string>
  showGhosts: boolean
  hideOrphans: boolean
  /** Graph cục bộ quanh một note (null = toàn vault). */
  local: { center: string; depth: 1 | 2 } | null
}

export const GHOST_PREFIX = 'ghost:'
export const ghostId = (target: string): string => GHOST_PREFIX + target.trim().toLowerCase()

/** Khoá loại để lọc và chú thích (viết thường): '' = note không có `type`. */
export const typeKey = (n: Pick<GNode, 'type'>): string => (n.type ?? '').trim().toLowerCase()

/**
 * Dựng graph từ chỉ mục vault: node = mọi note + node ma (gộp theo tên đích, không phân biệt hoa thường);
 * cạnh = link, bỏ tự trỏ và bỏ trùng (A→B và B→A vẽ một cạnh).
 */
export function buildGraph(index: Pick<VaultIndex, 'notes' | 'links'>): VaultGraph {
  const nodes: GNode[] = []
  const byId = new Map<string, GNode>()
  for (const n of index.notes) {
    if (byId.has(n.rel)) continue
    const node: GNode = { id: n.rel, name: n.name, type: n.type, ghost: false, degree: 0 }
    byId.set(n.rel, node)
    nodes.push(node)
  }
  const links: GLink[] = []
  const seen = new Set<string>()
  for (const l of index.links) {
    const from = byId.get(l.from)
    if (!from || from.ghost) continue
    let to: GNode | undefined
    if (l.to !== null) {
      to = byId.get(l.to)
      if (!to || to.ghost) continue
    } else {
      const name = l.target.trim()
      if (!name) continue
      const id = ghostId(name)
      to = byId.get(id)
      if (!to) {
        to = { id, name, type: null, ghost: true, degree: 0 }
        byId.set(id, to)
        nodes.push(to)
      }
    }
    if (to === from) continue
    const key = from.id < to.id ? `${from.id}\n${to.id}` : `${to.id}\n${from.id}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ source: from.id, target: to.id })
    from.degree++
    to.degree++
  }
  return { nodes, links }
}

/** Bảng hàng xóm (vô hướng) theo id. */
export function neighborMap(links: readonly GLink[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  const add = (a: string, b: string): void => {
    let s = m.get(a)
    if (!s) m.set(a, (s = new Set()))
    s.add(b)
  }
  for (const l of links) {
    add(l.source, l.target)
    add(l.target, l.source)
  }
  return m
}

/**
 * Lọc graph: ẩn loại, ẩn/hiện node ma, ẩn note mồ côi, graph cục bộ (độ sâu 1/2).
 * Node trả về là chính các object của `g` (để giữ vị trí khi vẽ lại). Note tâm của graph cục bộ luôn hiện.
 */
export function filterGraph<N extends GNode>(g: VaultGraph<N>, f: GraphFilter): VaultGraph<N> {
  const center = f.local && g.nodes.some((n) => n.id === f.local!.center) ? f.local.center : null
  const pass = (n: N): boolean =>
    n.id === center || (n.ghost ? f.showGhosts : !f.hiddenTypes.has(typeKey(n)))
  let keep = new Set(g.nodes.filter(pass).map((n) => n.id))
  let links = g.links.filter((l) => keep.has(l.source) && keep.has(l.target))

  if (center && f.local) {
    // BFS trong phần còn lại sau khi lọc loại.
    const nb = neighborMap(links)
    const reached = new Set([center])
    let frontier = [center]
    for (let d = 0; d < f.local.depth; d++) {
      const next: string[] = []
      for (const id of frontier)
        for (const o of nb.get(id) ?? [])
          if (!reached.has(o)) {
            reached.add(o)
            next.push(o)
          }
      frontier = next
    }
    keep = reached
    links = links.filter((l) => keep.has(l.source) && keep.has(l.target))
  }

  if (f.hideOrphans) {
    const linked = new Set<string>()
    for (const l of links) {
      linked.add(l.source)
      linked.add(l.target)
    }
    keep = new Set([...keep].filter((id) => id === center || linked.has(id)))
  }

  return { nodes: g.nodes.filter((n) => keep.has(n.id)), links }
}

/** Số note theo loại (không tính node ma), nhiều nhất trước; cùng số thì theo tên, '' (không loại) cuối. */
export function typeStats(g: VaultGraph): Array<{ key: string; count: number }> {
  const m = new Map<string, number>()
  for (const n of g.nodes) if (!n.ghost) m.set(typeKey(n), (m.get(typeKey(n)) ?? 0) + 1)
  return [...m]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.count - a.count || a.key.localeCompare(b.key)))
}

/** Màu cố định cho các loại note quen thuộc của vault stag.ai. */
export const TYPE_COLORS: Record<string, string> = {
  index: '#fbbf24',
  project: '#6ea8fe',
  feature: '#4ade80',
  decision: '#f472b6',
  log: '#a78bfa',
  workflow: '#22d3ee',
  protocol: '#fb923c',
  agent: '#f87171',
  session: '#a3e635',
  ticket: '#2dd4bf'
}
export const NO_TYPE_COLOR = '#7c8496'
export const GHOST_COLOR = '#5b6275'

/** Băm chuỗi ổn định (FNV-1a 32 bit). */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Màu theo loại: bảng cố định; loại lạ → màu băm ổn định; không có loại → xám. */
export function typeColor(type: string | null): string {
  if (!type) return NO_TYPE_COLOR
  const t = type.trim().toLowerCase()
  if (!t) return NO_TYPE_COLOR
  return TYPE_COLORS[t] ?? hslToHex(hashString(t) % 360, 0.62, 0.66)
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** `#rgb`/`#rrggbb` → `rgba(...)` với độ trong `a`. Chuỗi khác trả nguyên. */
export function withAlpha(color: string, a: number): string {
  let hex = color.trim()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return color
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('')
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Bán kính node (đơn vị graph) theo bậc. */
export const nodeRadius = (degree: number): number => Math.min(12, 3 + 1.1 * Math.sqrt(degree))
