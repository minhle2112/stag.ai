/**
 * Usage của tài khoản Claude đang đăng nhập trong Claude Code (thanh trạng thái → mục "Claude").
 * Main đọc token OAuth trong `~/.claude/.credentials.json` và gọi endpoint mà lệnh `/usage` của Claude Code dùng
 * (`GET https://api.anthropic.com/api/oauth/usage`, không có tài liệu công khai — dạng trả về xem `parseUsage`).
 * Token không bao giờ rời main: renderer chỉ nhận `ClaudeUsageState`.
 */

/** Một giới hạn: % đã dùng + giờ reset (ms). */
export interface UsageWindow {
  percent: number
  resetsAt: number | null
  /** Server báo đã khoá (chạm giới hạn) dù % chưa tới 100. */
  locked: boolean
}

/** Giới hạn tuần riêng một model (Opus / Sonnet / …). */
export interface ModelWindow extends UsageWindow {
  label: string
}

export interface ClaudeUsage {
  /** Phiên 5 giờ. */
  session: UsageWindow | null
  /** Tuần, mọi model. */
  week: UsageWindow | null
  /** Tuần, riêng từng model (chỉ những cái server trả về). */
  models: ModelWindow[]
}

export interface ClaudeAccount {
  email: string
  /** Nhãn gói: "Max 5×", "Pro"… ('' = không rõ). */
  plan: string
}

export type ClaudeUsageStatus =
  /** Tắt trong Cài đặt. */
  | 'off'
  /** Đang hỏi lần đầu. */
  | 'loading'
  | 'ok'
  /** Không có token / token hết hạn / server từ chối token. */
  | 'signedOut'
  /** Lỗi mạng / server; vẫn giữ số lần trước nếu có. */
  | 'error'

export interface ClaudeUsageState {
  status: ClaudeUsageStatus
  usage: ClaudeUsage | null
  account: ClaudeAccount | null
  /** Lần lấy được số gần nhất (ms). */
  fetchedAt: number | null
  /** Mô tả lỗi ngắn cho người dùng (không chứa token). */
  error?: string
}

export const SESSION_MS = 5 * 3600_000
export const WEEK_MS = 7 * 24 * 3600_000

type Loose = Record<string, unknown>
const obj = (v: unknown): Loose | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function time(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const clampPct = (p: number): number => Math.max(0, Math.min(100, Math.round(p)))

/** `{ utilization, resets_at, locked_reason }` (dạng five_hour / seven_day…) → UsageWindow; thiếu % → null. */
function legacyWindow(v: unknown): UsageWindow | null {
  const o = obj(v)
  const p = o && num(o.utilization)
  if (!o || p === null) return null
  return { percent: clampPct(p), resetsAt: time(o.resets_at), locked: !!o.locked_reason }
}

/** Mục trong mảng `limits` (`{ kind, percent, severity, resets_at, scope }`) → UsageWindow. */
function limitWindow(o: Loose): UsageWindow | null {
  const p = num(o.percent)
  if (p === null) return null
  return { percent: clampPct(p), resetsAt: time(o.resets_at), locked: o.severity === 'blocked' || o.severity === 'exceeded' }
}

/**
 * Body JSON của `/api/oauth/usage` → ClaudeUsage. Dạng thấy thật (2026-10-12):
 * `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` = `{ utilization, resets_at, locked_reason }` hoặc null,
 * và mảng mới `limits` = `{ kind: 'session' | 'weekly_all' | 'weekly_scoped', percent, resets_at, scope: { model: { display_name } } }`.
 * Ưu tiên các trường cũ (ổn định hơn), thiếu thì lấy từ `limits`. Không đọc được gì → null.
 */
export function parseUsage(raw: unknown): ClaudeUsage | null {
  const r = obj(raw)
  if (!r) return null
  const limits = (Array.isArray(r.limits) ? r.limits : []).map(obj).filter((x): x is Loose => !!x)
  const byKind = (kind: string): Loose | undefined => limits.find((l) => l.kind === kind)

  const kSession = byKind('session')
  const kWeek = byKind('weekly_all')
  const session = legacyWindow(r.five_hour) ?? (kSession ? limitWindow(kSession) : null)
  const week = legacyWindow(r.seven_day) ?? (kWeek ? limitWindow(kWeek) : null)

  const models: ModelWindow[] = []
  const add = (label: string, w: UsageWindow | null): void => {
    if (w && label && !models.some((m) => m.label.toLowerCase() === label.toLowerCase())) models.push({ label, ...w })
  }
  add('Opus', legacyWindow(r.seven_day_opus))
  add('Sonnet', legacyWindow(r.seven_day_sonnet))
  for (const l of limits) {
    if (l.kind !== 'weekly_scoped') continue
    const model = obj(obj(l.scope)?.model)
    const name = typeof model?.display_name === 'string' ? model.display_name.trim().slice(0, 40) : ''
    add(name, limitWindow(l))
  }

  if (!session && !week && !models.length) return null
  return { session, week, models }
}

/** Nhãn gói từ credentials (`subscriptionType`, `rateLimitTier`): "Max 5×", "Max 20×", "Pro"…; không rõ → ''. */
export function planLabel(subscriptionType: unknown, rateLimitTier: unknown): string {
  const sub = typeof subscriptionType === 'string' ? subscriptionType.toLowerCase() : ''
  const tier = typeof rateLimitTier === 'string' ? rateLimitTier.toLowerCase() : ''
  const mult = /max_(\d+)x/.exec(tier)?.[1]
  if (sub === 'max' || tier.includes('claude_max')) return mult ? `Max ${mult}×` : 'Max'
  if (!sub) return ''
  return sub.charAt(0).toUpperCase() + sub.slice(1)
}

export type UsageLevel = 'ok' | 'high' | 'max' | 'na'

/** Mức màu: teal < 70% · hổ phách 70–90% · đỏ từ 90%. */
export function usageLevel(percent: number | null | undefined): UsageLevel {
  if (percent == null) return 'na'
  return percent >= 90 ? 'max' : percent >= 70 ? 'high' : 'ok'
}

/** Vạch "nhịp": % thời gian đã trôi trong cửa sổ (`windowMs`) tính tới `now`; không có giờ reset → null. */
export function pacePercent(resetsAt: number | null, windowMs: number, now: number): number | null {
  if (resetsAt === null) return null
  const elapsed = windowMs - (resetsAt - now)
  return Math.max(0, Math.min(100, (elapsed / windowMs) * 100))
}

/**
 * Với tốc độ dùng từ đầu cửa sổ tới giờ, chạm 100% trước giờ reset bao nhiêu ms (null = không chạm / không đủ số).
 */
export function msBeforeReset(w: UsageWindow, windowMs: number, now: number): number | null {
  if (w.resetsAt === null || w.percent <= 0 || w.percent >= 100) return null
  const elapsed = windowMs - (w.resetsAt - now)
  if (elapsed <= 0) return null
  const hitAt = now + ((100 - w.percent) * elapsed) / w.percent
  return hitAt < w.resetsAt ? w.resetsAt - hitAt : null
}

/** Thời lượng ngắn: "2 giờ 13 phút", "47 phút", "dưới 1 phút", "3 ngày 4 giờ". */
export function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'dưới 1 phút'
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d) return h ? `${d} ngày ${h} giờ` : `${d} ngày`
  if (h) return m ? `${h} giờ ${m} phút` : `${h} giờ`
  return `${m} phút`
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const pad = (n: number): string => String(n).padStart(2, '0')

/** Giờ reset: dưới 24 giờ → "sau 2 giờ 13 phút"; xa hơn → "T5 09:00" (giờ máy). Không có → ''. */
export function formatReset(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return ''
  const left = resetsAt - now
  if (left <= 0) return 'đang reset'
  if (left < 24 * 3600_000) return `sau ${formatDuration(left)}`
  const d = new Date(resetsAt)
  return `${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "Cập nhật N phút trước". */
export function formatAgo(at: number | null, now: number): string {
  if (at === null) return 'Chưa cập nhật'
  const min = Math.floor((now - at) / 60_000)
  return min < 1 ? 'Cập nhật vừa xong' : `Cập nhật ${formatDuration(now - at)} trước`
}

const hit = (w: UsageWindow | null): boolean => !!w && (w.percent >= 100 || w.locked)

export interface UsageWarning {
  tone: 'danger' | 'amber'
  text: string
}

/** Cảnh báo đầu bảng: đã chạm giới hạn (đỏ), hoặc từ 70% mà đang dùng nhanh hơn nhịp (hổ phách). */
export function usageWarning(u: ClaudeUsage, now: number): UsageWarning | null {
  const after = (w: UsageWindow): string => {
    const r = formatReset(w.resetsAt, now)
    return r ? ` (reset ${r})` : ''
  }
  if (u.session && hit(u.session))
    return { tone: 'danger', text: `Đã chạm giới hạn phiên 5 giờ${after(u.session)}. Agent Claude sẽ báo lỗi giới hạn tới khi reset; agent Codex vẫn chạy được.` }
  if (u.week && hit(u.week))
    return { tone: 'danger', text: `Đã chạm giới hạn tuần${after(u.week)}. Agent Claude sẽ báo lỗi giới hạn tới khi reset; agent Codex vẫn chạy được.` }
  const m = u.models.find(hit)
  if (m) return { tone: 'danger', text: `Đã chạm giới hạn tuần của ${m.label}${after(m)}. Các model khác vẫn dùng được.` }
  for (const [w, ms, name] of [
    [u.session, SESSION_MS, 'phiên 5 giờ'],
    [u.week, WEEK_MS, 'tuần']
  ] as const) {
    if (!w || w.percent < 70) continue
    const early = msBeforeReset(w, ms, now)
    if (early !== null && early >= 60_000)
      return { tone: 'amber', text: `Đang dùng nhanh hơn nhịp — với tốc độ này sẽ chạm giới hạn ${name} trước giờ reset khoảng ${formatDuration(early)}.` }
  }
  if (u.session && u.session.percent >= 90) return { tone: 'amber', text: 'Sắp hết giới hạn phiên 5 giờ.' }
  return null
}
