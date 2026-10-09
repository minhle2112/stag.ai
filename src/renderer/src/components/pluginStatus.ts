import { statusTextFrom, type PluginSlot, type PluginStatusText } from '@shared/plugins'

/** Kênh worker phát (ctx.streams.emit) để app đọc lại chữ trên thanh trạng thái. */
export const STATUS_BAR_CHANNEL = 'statusBar'
/** Đọc lại chữ của mọi mục mỗi 60 s (ngoài lúc mở và lúc worker phát kênh trên). */
export const STATUS_BAR_REFRESH_MS = 60_000

/** Màu theo tone: chấm nhỏ trước chữ (tone default không có chấm) + màu chữ. */
export const STATUS_TONE: Record<PluginStatusText['tone'], { dot: string | null; text: string }> = {
  default: { dot: null, text: 'text-muted' },
  ok: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  warn: { dot: 'bg-amber-400', text: 'text-amber-300' },
  error: { dot: 'bg-red-400', text: 'text-red-300' }
}

/** Mục bấm được khi có `open` (mở URL) hoặc `action` (gọi worker). */
export function statusSlotClickable(slot: Pick<PluginSlot, 'open' | 'action'>): boolean {
  return !!(slot.open || slot.action)
}

/**
 * Chữ của một mục statusBarItem: không có `dataKey` → displayName; có → worker getData(dataKey) qua `getData`
 * rồi chuẩn hoá bằng statusTextFrom (null = không hiện). Lỗi thì để người gọi bắt.
 */
export async function loadStatusText(
  slot: Pick<PluginSlot, 'displayName' | 'dataKey'>,
  getData: (key: string) => Promise<unknown>
): Promise<PluginStatusText | null> {
  if (!slot.dataKey) return statusTextFrom(slot.displayName)
  return statusTextFrom(await getData(slot.dataKey))
}

/**
 * Ghi lỗi ra console một lần cho mỗi mục (đọc lại 60 s / lần, không muốn lặp mãi). Đọc được lại (`ok`) thì lần lỗi
 * sau lại được ghi.
 */
export function errorLogOnce(log: (msg: string, err: unknown) => void = console.warn): { fail: (key: string, err: unknown) => void; ok: (key: string) => void } {
  const logged = new Set<string>()
  return {
    fail: (key, err) => {
      if (logged.has(key)) return
      logged.add(key)
      log(`[plugin ${key}] không đọc được chữ cho thanh trạng thái:`, err)
    },
    ok: (key) => void logged.delete(key)
  }
}
