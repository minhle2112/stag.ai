import { useEffect, useMemo, useRef, useState } from 'react'
import type { InstalledPlugin, PluginSlot } from '@shared/plugins'
import { useLocale } from '../i18n'
import { useUi } from '../store/ui'
import { openPluginUrl, pluginErr, usePluginToast } from '../store/plugins'
import { useTheme } from '../store/theme'

/** Ngữ cảnh app gửi cho trang plugin (host.context trong /__stag/ui.js). */
export interface PluginFrameContext {
  pluginId: string
  slotId: string
  slotType: PluginSlot['type']
  workspace: { id: string; name: string; path: string } | null
  /** Màu app đang dùng; đổi thì trang nhận lại sự kiện `context` và sự kiện `theme`. */
  theme: 'dark' | 'light'
  /** Ngôn ngữ giao diện app; đổi thì trang nhận lại sự kiện `context` và sự kiện `locale`. */
  locale: 'vi' | 'en'
}

/**
 * Trang của plugin (slot page / settingsPage / dashboardWidget) trong iframe cách ly: `sandbox` không có allow-same-origin nên trang
 * chạy với origin "null", không thấy window.stag hay DOM của app. Trang nói chuyện qua postMessage
 * ({ __stag: 1, id, method, params }); app điền ngữ cảnh và chuyển lời gọi cho main (kiểm quyền ở PluginHost.bridge).
 */
export function PluginFrame({
  plugin,
  slot,
  workspace,
  autoHeight,
  className
}: {
  plugin: InstalledPlugin
  slot: PluginSlot
  workspace?: { id: string; name: string; path: string }
  /** Cao theo nội dung (trang cài đặt); không thì lấp đầy chỗ chứa. Widget (ô trong lưới agent) luôn lấp đầy ô. */
  autoHeight?: boolean
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(240)
  const theme = useTheme((s) => s.theme)
  const locale = useLocale()
  const id = plugin.manifest.id
  const context = useMemo<PluginFrameContext>(
    () => ({
      pluginId: id,
      slotId: slot.id,
      slotType: slot.type,
      workspace: workspace ? { id: workspace.id, name: workspace.name, path: workspace.path } : null,
      theme,
      locale
    }),
    [id, slot.id, slot.type, workspace?.id, workspace?.name, workspace?.path, theme, locale] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const ctxRef = useRef(context)
  ctxRef.current = context
  const name = plugin.manifest.displayName
  const fit = autoHeight && slot.type !== 'dashboardWidget'

  const post = (m: Record<string, unknown>): void => ref.current?.contentWindow?.postMessage({ __stag: 1, ...m }, '*')

  // Ngữ cảnh đổi (chuyển workspace) → báo trang.
  useEffect(() => post({ event: 'context', context }), [context])
  // Đổi sáng / tối: sự kiện riêng (host.onTheme trong /__stag/ui.js); trang không nghe thì giữ màu của nó.
  useEffect(() => post({ event: 'theme', theme }), [theme])
  useEffect(() => post({ event: 'locale', locale }), [locale])

  useEffect(() => {
    const onMessage = async (e: MessageEvent): Promise<void> => {
      const win = ref.current?.contentWindow
      if (!win || e.source !== win) return
      const m = e.data as { __stag?: number; id?: number; method?: unknown; params?: unknown }
      if (!m || m.__stag !== 1 || typeof m.method !== 'string') return
      const p = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>
      const reply = (body: { result?: unknown; error?: string }): void => {
        if (m.id !== undefined) win.postMessage({ __stag: 1, id: m.id, ...body }, '*')
      }
      try {
        switch (m.method) {
          case 'ui.ready':
            win.postMessage({ __stag: 1, event: 'context', context: ctxRef.current }, '*')
            return
          case 'ui.resize':
            if (typeof p.height === 'number' && Number.isFinite(p.height)) setHeight(Math.min(Math.max(Math.ceil(p.height), 60), 5000))
            return
          case 'context.get':
            reply({ result: ctxRef.current })
            return
          case 'ui.toast':
            usePluginToast.getState().show(`${name}: ${String(p.text ?? '').slice(0, 1000)}`)
            reply({ result: null })
            return
          case 'ui.openUrl':
            await openPluginUrl(String(p.url ?? ''), p.target === 'external' ? 'external' : 'browser', ctxRef.current.workspace?.id)
            reply({ result: null })
            return
          case 'ui.pickFile': {
            const filters = Array.isArray(p.filters) ? (p.filters as Array<{ name: string; extensions: string[] }>) : undefined
            reply({ result: await window.stag.pickFile(`${name}: ${String(p.title ?? '').slice(0, 120)}`, undefined, filters) })
            return
          }
          case 'ui.reveal': {
            // Chỉ file trong dự án của workspace đang xem (main kiểm đường dẫn nằm trong dự án).
            const ws = ctxRef.current.workspace?.id
            if (!ws) throw new Error('No workspace')
            await window.stag.artifacts.reveal(ws, String(p.path ?? ''))
            reply({ result: null })
            return
          }
          case 'ui.openSettings':
            useUi.getState().openSettings('plugins', { plugin: id })
            reply({ result: null })
            return
          default:
            reply({ result: (await window.stag.plugins.bridge(id, m.method, p, ctxRef.current.workspace?.id)) ?? null })
        }
      } catch (err) {
        reply({ error: pluginErr(err) })
      }
    }
    const fn = (e: MessageEvent): void => void onMessage(e)
    window.addEventListener('message', fn)
    return () => window.removeEventListener('message', fn)
  }, [id, name])

  // Worker đẩy dữ liệu (ctx.streams.emit) → trang.
  useEffect(
    () =>
      window.stag.plugins.onStream((pid, channel, data) => {
        if (pid === id) post({ event: 'stream', channel, data })
      }),
    [id]
  )

  return (
    <iframe
      ref={ref}
      // Đọc lại gói / khởi động lại → tải lại trang.
      key={`${plugin.version}:${plugin.status.startedAt ?? ''}`}
      title={`${name} — ${slot.displayName}`}
      src={`stag-plugin://${id}/${slot.path ?? 'index.html'}`}
      sandbox="allow-scripts allow-forms allow-downloads"
      // Trình phát video trong trang plugin (vd. Stag Clip) được phóng toàn màn hình.
      allow="fullscreen"
      referrerPolicy="no-referrer"
      className={`block w-full border-0 bg-bg ${fit ? '' : 'h-full'} ${className ?? ''}`}
      style={fit ? { height } : undefined}
    />
  )
}
