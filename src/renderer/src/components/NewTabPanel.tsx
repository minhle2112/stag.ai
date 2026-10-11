import { useEffect, useState } from 'react'
import { LAUNCH_FILE, type DevServerEntry, type DevServerList } from '@shared/launch'
import type { BrowserTab } from '@shared/types'
import { openAgent } from '../store/agents'
import { Button } from './Modal'
import { Icon } from './Icon'

/** Tab trống của người dùng: hiện bảng này thay cho trang (view của main bị ẩn). */
export function isBlankTab(tab: BrowserTab | undefined): boolean {
  if (!tab) return true
  return tab.owner.kind === 'user' && (!tab.url || tab.url === 'about:blank') && (!!tab.dev || !tab.loading)
}

/**
 * Trang Tab mới của browser (như Claude desktop): gợi ý dev server của dự án (đã lưu trong .stag/launch.json hoặc
 * đoán từ package.json), bấm "Dùng cái này" là chạy trong một ô terminal rồi mở trang khi cổng mở.
 */
export function NewTabPanel({ wsId, tab }: { wsId: string; tab: BrowserTab | undefined }): React.JSX.Element {
  const [list, setList] = useState<DevServerList | null>(null)
  /** Tab đã bấm "Quay lại duyệt web" (không hiện gợi ý nữa). */
  const [browsing, setBrowsing] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const tabKey = tab?.id ?? ''
  const dev = tab?.dev

  useEffect(() => {
    if (dev) return
    let live = true
    setList(null)
    window.stag.devServer.list(wsId).then(
      (l) => live && setList(l),
      () => live && setList({ saved: [], detected: [] })
    )
    return () => {
      live = false
    }
  }, [wsId, tabKey, dev])

  async function use(e: DevServerEntry): Promise<void> {
    setError('')
    try {
      await window.stag.devServer.start(wsId, e.name, tab?.id)
    } catch (err) {
      setError(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  if (dev && tab) {
    const cancel = (): Promise<void> => window.stag.devServer.cancel(wsId, tab.id, dev.name)
    const terminal = dev.agentId ? (
      <Button small onClick={() => openAgent(wsId, dev.agentId!)}>
        Xem terminal
      </Button>
    ) : null
    return (
      <Center>
        {dev.error ? (
          <>
            <div className="text-[13px] font-semibold text-danger">Không chạy được dev server</div>
            <p className="max-w-[340px] text-[12px] break-words text-muted">{dev.error}</p>
            <Command port={dev.port} command={dev.command} />
            <div className="flex gap-2">
              {terminal}
              <Button small primary onClick={() => void window.stag.devServer.start(wsId, dev.name, tab.id)}>
                Thử lại
              </Button>
            </div>
            <BackLink onClick={() => void cancel()} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[13px] text-fg">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
              Đang khởi động dev server…
            </div>
            <p className="text-[12px] text-muted">Trang tự mở khi cổng {dev.port} sẵn sàng.</p>
            <Command port={dev.port} command={dev.command} />
            <div className="flex gap-2">
              {terminal}
              <Button small variant="ghost" onClick={() => void cancel()}>
                Huỷ
              </Button>
            </div>
          </>
        )}
      </Center>
    )
  }

  const all = list ? [...list.saved.map((e) => ({ e, saved: true })), ...list.detected.map((e) => ({ e, saved: false }))] : []
  if (!list || !all.length || browsing[tabKey]) {
    return (
      <Center>
        <Icon name="globe" size={28} className="text-dim" />
        <div className="text-[12px] text-dim">
          Gõ địa chỉ ở trên, ví dụ <span className="font-mono text-muted">localhost:5173</span>. Agent cũng mở tab ở đây khi dùng trình duyệt.
        </div>
        {!tab && <Button onClick={() => void window.stag.browser.newTab(wsId)}>Tab mới</Button>}
        {list && all.length > 0 && (
          <button className="text-[12px] text-muted hover:text-fg" onClick={() => setBrowsing((b) => ({ ...b, [tabKey]: false }))}>
            Dev server của dự án →
          </button>
        )}
      </Center>
    )
  }

  return (
    <Center>
      <p className="max-w-[320px] text-[12.5px] text-muted">
        {list.saved.length ? 'Dev server của dự án.' : 'Đã phát hiện dev server.'} Lệnh chạy trong một ô terminal trên canvas khi bạn chọn.
      </p>
      <div className="flex w-full max-w-[400px] flex-col gap-2">
        {all.map(({ e, saved }) => (
          <div key={e.name} className="flex items-center gap-3 rounded-lg border border-line-2 bg-panel px-3 py-2 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] text-dim">
                <span>cổng {e.port}</span>
                {e.running && <span className="text-work">· đang chạy</span>}
                {saved && <span>· đã lưu</span>}
              </div>
              <div className="truncate font-mono text-[12px] text-fg" data-tip={e.command}>
                {e.command}
              </div>
            </div>
            <Button small onClick={() => void use(e)}>
              {e.running ? 'Mở' : 'Dùng cái này'}
            </Button>
          </div>
        ))}
      </div>
      {error && <p className="max-w-[340px] text-[12px] text-danger">{error}</p>}
      <p className="text-[11.5px] text-dim">
        Lựa chọn được lưu vào <span className="font-mono">{LAUNCH_FILE}</span> trong dự án.
      </p>
      <BackLink onClick={() => setBrowsing((b) => ({ ...b, [tabKey]: true }))} />
    </Center>
  )
}

function Center({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto px-6 text-center">{children}</div>
}

function Command({ port, command }: { port: number; command: string }): React.JSX.Element {
  return (
    <div className="w-full max-w-[400px] rounded-lg border border-line-2 bg-panel px-3 py-2 text-left">
      <div className="text-[11px] text-dim">cổng {port}</div>
      <div className="truncate font-mono text-[12px] text-fg">{command}</div>
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button className="flex items-center gap-1 text-[12px] text-muted hover:text-fg" onClick={onClick}>
      <Icon name="al" size="s" />
      Quay lại duyệt web
    </button>
  )
}
