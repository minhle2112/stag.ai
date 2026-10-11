import { useEffect, useMemo, useRef, useState } from 'react'
import { agentKind } from '@shared/types'
import { openAgent, useAgents } from '../../store/agents'
import { useBoard } from '../../store/board'
import { pageTab, slotsOf, usePlugins } from '../../store/plugins'
import { useSettings } from '../../store/settings'
import { useUi, type SettingsSection } from '../../store/ui'
import { startNewWorkspace } from '../../store/workspaceFlow'
import { useActiveWorkspace, useWorkspaces } from '../../store/workspaces'
import { statusView } from '../../status'
import { Icon, type IconName } from '../Icon'

interface Cmd {
  id: string
  group: string
  label: string
  hint?: string
  icon: IconName
  run: () => void
  /** Chữ thêm để tìm (không dấu). */
  keywords?: string
}

/** Bỏ dấu tiếng Việt + chữ thường, để gõ "ke hoach" vẫn tìm ra "Kế hoạch". */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()

const SETTINGS: Array<[SettingsSection, string]> = [
  ['general', 'Chung'],
  ['adapters', 'Adapter'],
  ['connectors', 'Connector (MCP)'],
  ['skills', 'Skill'],
  ['plugins', 'Plugin'],
  ['secrets', 'Kho bí mật'],
  ['handoff', 'Agent & bàn giao'],
  ['scope', 'Khoá phạm vi'],
  ['agentApi', 'Agent API'],
  ['vault', 'Vault & bộ nhớ'],
  ['browser', 'Trình duyệt'],
  ['voice', 'Giọng nói']
]

/** Bảng lệnh (Ctrl+K): nhảy tới màn hình, agent, mục Cài đặt hoặc chạy một hành động. `@` = agent, `>` = lệnh. */
export function CommandPalette(): React.JSX.Element | null {
  const open = useUi((s) => s.palette)
  if (!open) return null
  return <PaletteBody />
}

function PaletteBody(): React.JSX.Element {
  const setPalette = useUi((s) => s.setPalette)
  const setTab = useUi((s) => s.setTab)
  const openSettings = useUi((s) => s.openSettings)
  const setNewAgent = useUi((s) => s.setNewAgent)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const toggleBrowser = useUi((s) => s.toggleBrowser)
  const active = useActiveWorkspace()
  const workspaces = useWorkspaces((s) => s.items)
  const setActive = useWorkspaces((s) => s.setActive)
  const agentsByWs = useAgents((s) => s.byWs)
  const boards = useBoard((s) => s.byWs)
  const pluginItems = usePlugins((s) => s.items)
  const settingsValue = useSettings((s) => s.value)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Bảng lệnh phủ lên trình duyệt (view gốc): ẩn trình duyệt khi đang mở.
  useEffect(() => {
    const ui = useUi.getState()
    ui.modalOpened()
    return () => ui.modalClosed()
  }, [])

  const close = (): void => setPalette(false)

  const all = useMemo<Cmd[]>(() => {
    const go = (fn: () => void) => (): void => {
      setPalette(false)
      fn()
    }
    const cmds: Cmd[] = [
      { id: 'v-agents', group: 'Màn hình', label: 'Agent', hint: 'Ctrl 1', icon: 'grid', run: go(() => setTab('agents')), keywords: 'luoi cell' },
      { id: 'v-kanban', group: 'Màn hình', label: 'Kanban', hint: 'Ctrl 2', icon: 'kanban', run: go(() => setTab('kanban')), keywords: 'viec cho ban' },
      { id: 'v-artifacts', group: 'Màn hình', label: 'Artifacts', hint: 'Ctrl 3', icon: 'fdiff', run: go(() => setTab('artifacts')), keywords: 'tep file diff' },
      { id: 'v-vault', group: 'Màn hình', label: 'Vault Obsidian', hint: 'Ctrl 4', icon: 'vault', run: go(() => setTab('vault')), keywords: 'note do thi graph' },
      { id: 'v-log', group: 'Màn hình', label: 'Nhật ký & bộ nhớ', hint: 'Ctrl 5', icon: 'brain', run: go(() => setTab('log')), keywords: 'log memory' }
    ]
    for (const { plugin, slot } of slotsOf(pluginItems, settingsValue, 'page', active?.id))
      cmds.push({
        id: `plg-${plugin.manifest.id}-${slot.id}`,
        group: 'Màn hình',
        label: slot.displayName,
        hint: 'plugin',
        icon: 'plug',
        run: go(() => setTab(pageTab(plugin.manifest.id, slot.id)))
      })
    cmds.push(
      {
        id: 'a-newagent',
        group: 'Hành động',
        label: 'Tạo agent',
        hint: active?.name,
        icon: 'plus',
        run: go(() => {
          if (!active) return
          setTab('agents')
          setNewAgent({ wsId: active.id, agentId: agentsByWs[active.id]?.focused ?? null, dir: 'row' })
        })
      },
      {
        id: 'a-broadcast',
        group: 'Hành động',
        label: 'Phát lệnh cho nhiều agent…',
        hint: active?.name,
        icon: 'send',
        keywords: 'broadcast gui tin nhieu agent',
        run: go(() => active && useUi.getState().setBroadcast(active.id))
      },
      { id: 'a-newws', group: 'Hành động', label: 'Workspace mới…', icon: 'folder', run: go(() => void startNewWorkspace()) },
      { id: 'a-sidebar', group: 'Hành động', label: 'Bật / tắt thanh bên', hint: 'Ctrl B', icon: 'side', run: go(toggleSidebar) },
      { id: 'a-browser', group: 'Hành động', label: 'Bật / tắt trình duyệt', hint: 'Ctrl Shift B', icon: 'globe', run: go(toggleBrowser) },
      { id: 'a-settings', group: 'Hành động', label: 'Cài đặt', hint: 'Ctrl ,', icon: 'gear', run: go(() => openSettings()) }
    )
    for (const [id, label] of SETTINGS)
      cmds.push({ id: `s-${id}`, group: 'Cài đặt', label, icon: 'gear', run: go(() => openSettings(id)), keywords: 'cai dat settings' })
    for (const w of workspaces) {
      const st = agentsByWs[w.id]
      if (!st) continue
      for (const a of st.agents) {
        const view = statusView(!!st.running[a.id], !!st.starting[a.id], boards[w.id]?.statuses.find((x) => x.agentId === a.id), agentKind(a))
        cmds.push({
          id: `ag-${a.id}`,
          group: 'Agent',
          label: `@${a.name}`,
          hint: `${workspaces.length > 1 ? `${w.name} · ` : ''}${view.label}`,
          icon: 'bot',
          run: go(() => {
            setActive(w.id)
            openAgent(w.id, a.id)
          }),
          keywords: a.name
        })
      }
    }
    return cmds
  }, [active, workspaces, agentsByWs, boards, pluginItems, settingsValue, setPalette, setTab, setNewAgent, setActive, openSettings, toggleSidebar, toggleBrowser])

  const shown = useMemo(() => {
    let text = q.trim()
    let only: string | null = null
    if (text.startsWith('@')) {
      only = 'Agent'
      text = text.slice(1)
    } else if (text.startsWith('>')) {
      only = 'Hành động'
      text = text.slice(1)
    }
    const needle = norm(text.trim())
    return all.filter((c) => (!only || c.group === only) && (!needle || norm(`${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`).includes(needle)))
  }, [all, q])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel, shown])

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((i) => Math.min(shown.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      shown[sel]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-[84px]" onMouseDown={close}>
      <div
        className="flex max-h-[80vh] w-[620px] max-w-[92vw] flex-col overflow-hidden rounded-[10px] border border-line-2 bg-panel shadow-[0_24px_70px_rgba(0,0,0,.7)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Tìm hoặc chạy lệnh…"
          spellCheck={false}
          autoComplete="off"
          className="w-full border-0 border-b border-line bg-transparent px-3.5 py-3 text-[15px] text-fg outline-none select-text placeholder:text-dim"
        />
        <div ref={listRef} className="max-h-[400px] overflow-y-auto p-1.5">
          {shown.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-dim">Không có kết quả.</div>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {head && <div className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-[0.06em] text-dim">{c.group.toUpperCase()}</div>}
                <button
                  type="button"
                  data-sel={i === sel}
                  onMouseMove={() => setSel(i)}
                  onClick={c.run}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${i === sel ? 'bg-panel-3' : ''}`}
                >
                  <Icon name={c.icon} className={i === sel ? 'text-accent' : 'text-dim'} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="shrink-0 text-[12px] text-dim">{c.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3.5 border-t border-line px-3 py-2 text-[11px] text-dim">
          <span>↑ ↓ chọn</span>
          <span>Enter chạy</span>
          <span>Esc đóng</span>
          <span className="flex-1" />
          <span>@ agent · &gt; lệnh</span>
        </div>
      </div>
    </div>
  )
}
