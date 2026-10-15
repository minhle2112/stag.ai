import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComputerWindow } from '@shared/computer'
import { computerToolsOn } from '@shared/settings'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { useAgents } from '../../store/agents'
import { useWindowPicker } from '../../store/computer'
import { pasteIntoTerminal } from '../../terminals'
import { Modal } from '../Modal'
import { TierChip } from './ComputerAskBody'
import { useT } from '../../i18n'

/** Lọc cửa sổ theo chữ gõ sau @ (tên app, tiêu đề, exe; không phân biệt dấu). */
export function filterWindows(list: ComputerWindow[], query: string): ComputerWindow[] {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
  const q = norm(query.trim())
  if (!q) return list
  return list.filter((w) => norm(`${w.displayName} ${w.title} ${w.key}`).includes(q))
}

/** Danh sách cửa sổ đang mở (một lần mỗi lần bảng mở). */
export function useOpenWindows(open: boolean): { list: ComputerWindow[] | null } {
  const [list, setList] = useState<ComputerWindow[] | null>(null)
  useEffect(() => {
    if (!open) {
      setList(null)
      return
    }
    let alive = true
    void window.stag.computer
      .windows()
      .then((w) => alive && setList(w))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [open])
  return { list }
}

/** Các dòng của bảng chọn cửa sổ: icon, tên app, tiêu đề, mức; app bị chặn hiện xám, không chọn được. */
export function WindowList({
  items,
  loading,
  sel,
  onHover,
  onPick
}: {
  items: ComputerWindow[]
  loading: boolean
  sel: number
  onHover: (i: number) => void
  onPick: (w: ComputerWindow) => void
}): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  if (loading) return <div className="px-3 py-2 text-[12px] text-dim">{t('computer.picker.loading')}</div>
  if (!items.length) return <div className="px-3 py-2 text-[12px] text-dim">{t('computer.picker.empty')}</div>
  return (
    <ul ref={ref} role="listbox" className="max-h-64 overflow-y-auto py-1">
      {items.map((w, i) => {
        const blocked = w.tier === 'blocked'
        return (
          <li
            key={w.id}
            data-i={i}
            role="option"
            aria-selected={i === sel}
            aria-disabled={blocked}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // Không để ô nhập mất focus (con trỏ ở chỗ @).
              e.preventDefault()
              if (!blocked) onPick(w)
            }}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] ${i === sel ? 'bg-panel-3' : ''} ${blocked ? 'cursor-not-allowed opacity-45' : ''}`}
          >
            {w.icon ? <img src={w.icon} alt="" className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded bg-panel-3" />}
            <b className="shrink-0">{w.displayName}</b>
            <span className="min-w-0 flex-1 truncate text-muted">{w.title}</span>
            {w.minimized && <span className="shrink-0 text-[11px] text-dim">{t('computer.picker.minimized')}</span>}
            <span className="shrink-0 font-mono text-[11px] text-dim">{w.key}</span>
            <TierChip tier={w.tier} reason={w.reason} />
          </li>
        )
      })}
    </ul>
  )
}

/** Dòng báo computer use đang tắt cho agent (vẫn gửi kèm ảnh) + nút mở Cài đặt → Máy tính. */
export function PickerOffNote({ wsId, agentId }: { wsId: string; agentId: string }): React.JSX.Element | null {
  const t = useT()
  const on = useSettings((s) => computerToolsOn(s.value, wsId, agentId))
  const openSettings = useUi((s) => s.openSettings)
  if (on) return null
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] text-wait">
      <span className="min-w-0 flex-1">{t('computer.picker.off')}</span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          openSettings('computer', { agentId })
        }}
        className="shrink-0 rounded border border-line-2 px-1.5 text-fg hover:border-line-3"
      >
        {t('computer.picker.enable')}
      </button>
    </div>
  )
}

/**
 * Bảng chọn cửa sổ cho ô CLI (Ctrl+Shift+2 trong terminal Claude Code: `@` ở đó là gợi ý file của CLI). Chọn xong:
 * cấp app cho phiên, gõ dòng ngữ cảnh vào dòng lệnh (không kèm ảnh, agent tự chụp).
 */
export function CliWindowPicker(): React.JSX.Element | null {
  const t = useT()
  const agentId = useWindowPicker((s) => s.agentId)
  const close = useWindowPicker((s) => s.close)
  const wsId = useAgents((s) => (agentId ? Object.entries(s.byWs).find(([, v]) => v.agents.some((a) => a.id === agentId))?.[0] : undefined))
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { list } = useOpenWindows(!!agentId)
  const items = useMemo(() => filterWindows(list ?? [], query), [list, query])
  useEffect(() => {
    setQuery('')
    setSel(0)
    setError('')
  }, [agentId])
  if (!agentId) return null

  const pick = async (w: ComputerWindow): Promise<void> => {
    setBusy(true)
    // Ô CLI không gửi được ảnh: bỏ chụp, agent tự gọi screenshot.
    const r = await window.stag.computer.attachWindow(agentId, w.id, false).catch((e: Error) => ({ ok: false as const, error: e.message }))
    setBusy(false)
    if (!r.ok || !r.context) return setError(t('computer.picker.failed', { error: r.error ?? '' }))
    close()
    pasteIntoTerminal(agentId, r.context)
  }

  return (
    <Modal title={t('computer.picker.cliTitle')} icon="monitor" width="w-[640px]" onClose={close}>
      <p className="text-[12px] text-muted">{t('computer.picker.cliHint')}</p>
      <input
        autoFocus
        value={query}
        placeholder={t('computer.picker.search')}
        onChange={(e) => {
          setQuery(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((i) => Math.min(items.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((i) => Math.max(0, i - 1))
          } else if ((e.key === 'Enter' || e.key === 'Tab') && items[sel] && items[sel].tier !== 'blocked') {
            e.preventDefault()
            void pick(items[sel])
          }
        }}
        className="mt-2 h-8 w-full rounded-md border border-line-2 bg-bg px-2.5 text-[13px] outline-none focus:border-line-3"
      />
      <div className="mt-2 overflow-hidden rounded-md border border-line bg-panel">
        {wsId && <PickerOffNote wsId={wsId} agentId={agentId} />}
        <WindowList items={items} loading={list === null} sel={sel} onHover={setSel} onPick={(w) => void pick(w)} />
      </div>
      <div className="mt-1.5 flex text-[11px] text-dim">
        <span>{busy ? t('computer.picker.attaching') : t('computer.picker.hint')}</span>
        {error && <span className="ml-auto text-danger">{error}</span>}
      </div>
    </Modal>
  )
}
