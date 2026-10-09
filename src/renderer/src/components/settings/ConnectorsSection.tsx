import { useEffect, useState, type ReactNode } from 'react'
import { connectorOn, connectorSecrets, CONNECTOR_ID_RE, emptyConnector, ENV_KEY_RE, SECRET_NAME_RE, slugify, toolPolicy } from '@shared/connectors'
import { splitArgs } from '@shared/settings'
import {
  agentKind,
  type CliAdapterId,
  type Connector,
  type ConnectorImport,
  type ConnectorTestResult,
  type ConnectorValue,
  type InheritedScan,
  type InheritedServer,
  type ToolPolicy
} from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSecrets } from '../../store/secrets'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Button, Modal } from '../Modal'
import { Badge, errText, type Tone } from './AdaptersSection'
import { useApprovals } from '../../store/approvals'
import { BrowseView, catalogOf, ConnectorLogo, ReviewView } from './ConnectorCatalog'
import { methodLabel } from '@shared/catalog'
import { ErrorBar, Group, Row, Select, SmallButton, Switch, useSaveError } from './controls'

/**
 * Settings → Connector: máy chủ MCP cho phiên agent. Hai loại:
 * - Connector của stag.ai: người dùng thêm (mẫu / tự cấu hình / dán JSON), app đưa vào phiên Claude Code,
 *   Codex và adapter ngoài đọc được file MCP; bí mật lấy từ Settings → Secrets.
 * - Máy chủ có sẵn trong Claude Code / Codex: CLI tự nạp, ở đây chỉ tắt bớt cho phiên agent.
 * Bật / tắt theo cấp app → workspace → agent.
 */

type View = { type: 'list' } | { type: 'detail'; id: string }
/** 'app' | `ws:<id>` | `agent:<wsId>:<agentId>` */
type LevelKey = string

const TONE: Record<Tone, string> = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-400', muted: 'bg-muted/60' }
const RUNTIME: Record<CliAdapterId, string> = { claude: 'Claude Code', codex: 'Codex' }
const SOURCE: Record<InheritedServer['source'], string> = {
  'claude.ai': 'claude.ai',
  plugin: 'plugin',
  user: 'user',
  local: 'local',
  project: '.mcp.json',
  codex: 'config.toml'
}

/** Nguồn đoán theo tên khi chưa quét (máy chủ đã tắt ở đâu đó). */
const guessSource = (runtime: CliAdapterId, name: string): InheritedServer['source'] =>
  runtime === 'codex' ? 'codex' : name.startsWith('claude.ai ') ? 'claude.ai' : name.startsWith('plugin:') ? 'plugin' : 'user'

/** Kết quả quét giữ lại khi chuyển trang (quét Claude mất vài giây). */
const scanCache: Partial<Record<CliAdapterId, InheritedScan>> = {}

type Tab = 'browse' | 'connected' | 'review'

export function ConnectorsSection(): React.JSX.Element {
  const focus = useUi((s) => s.settingsFocus)
  const byWs = useAgents((s) => s.byWs)
  const items = useSettings((s) => s.value.app.connectors.items)
  const pending = useApprovals((s) => s.items.length)
  const agentLevel = (agentId?: string): LevelKey => {
    if (!agentId) return 'app'
    for (const [wsId, w] of Object.entries(byWs)) if (w.agents.some((a) => a.id === agentId)) return `agent:${wsId}:${agentId}`
    return 'app'
  }
  const initialTab: Tab = focus?.review ? 'review' : focus?.connector || focus?.agentId ? 'connected' : 'browse'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [view, setView] = useState<View>(focus?.connector ? { type: 'detail', id: focus.connector } : { type: 'list' })
  const [level, setLevel] = useState<LevelKey>(() => agentLevel(focus?.agentId))
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (focus?.review) setTab('review')
    if (focus?.connector) {
      setTab('connected')
      setView({ type: 'detail', id: focus.connector })
    }
    if (focus?.agentId) {
      setTab('connected')
      setLevel(agentLevel(focus.agentId))
      setView({ type: 'list' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const open = (id: string): void => {
    setTab('connected')
    setView({ type: 'detail', id })
  }
  const navItem = (id: Tab, label: string, icon: ReactNode, count?: number, alert?: boolean): React.JSX.Element => (
    <button
      type="button"
      onClick={() => {
        setTab(id)
        if (id === 'connected') setView({ type: 'list' })
      }}
      aria-current={tab === id}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] ${tab === id ? 'bg-panel-2 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count ? (
        <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${alert ? 'bg-amber-400 font-semibold text-black' : 'bg-line/70 text-muted'}`}>{count}</span>
      ) : null}
    </button>
  )

  return (
    <>
      <div className="-mt-2 mb-4 flex items-center gap-2 border-b border-line pb-3">
        <PlugIcon className="h-4 w-4 text-muted" />
        <span className="text-[12.5px] font-semibold uppercase tracking-wider">Connector</span>
        <span className="rounded-full border border-line px-2 py-px text-[10.5px] text-muted">MCP</span>
      </div>
      <div className="flex gap-6">
        <nav className="w-40 shrink-0" aria-label="Connector">
          {navItem('browse', 'Danh mục', <StoreIcon className="h-4 w-4" />)}
          {navItem('connected', 'Đã kết nối', <PlugIcon className="h-4 w-4" />, items.length)}
          {navItem('review', 'Duyệt', <ShieldIcon className="h-4 w-4" />, pending, true)}
        </nav>
        <div className="min-w-0 flex-1">
          {tab === 'browse' && <BrowseView onOpen={open} onCustom={() => setAdding(true)} />}
          {tab === 'review' && <ReviewView connectorLabel={(id) => items.find((c) => c.id === id)} />}
          {tab === 'connected' &&
            (view.type === 'list' ? (
              <ConnectorList level={level} setLevel={setLevel} open={(id) => setView({ type: 'detail', id })} onAdd={() => setTab('browse')} />
            ) : (
              <ConnectorDetail key={view.id} id={view.id} level={level} onBack={() => setView({ type: 'list' })} onRenamed={(id) => setView({ type: 'detail', id })} />
            ))}
        </div>
      </div>
      {adding && (
        <AddConnectorDialog
          level={level}
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false)
            setTab('connected')
            setView(id ? { type: 'detail', id } : { type: 'list' })
          }}
        />
      )}
    </>
  )
}

// ---- cấp áp dụng ----

interface Level {
  lvl: 'app' | 'ws' | 'agent'
  wsId?: string
  agentId?: string
  name: string
}

function useLevel(level: LevelKey): Level {
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [kind, wsId, agentId] = level.split(':') as ['app' | 'ws' | 'agent', string?, string?]
  const ws = workspaces.find((w) => w.id === wsId)
  const agent = agentId ? byWs[wsId!]?.agents.find((a) => a.id === agentId) : undefined
  if (kind === 'agent' && ws && agent) return { lvl: 'agent', wsId: ws.id, agentId: agent.id, name: `agent ${agent.name}` }
  if (kind === 'ws' && ws) return { lvl: 'ws', wsId: ws.id, name: `workspace ${ws.name}` }
  return { lvl: 'app', name: 'mọi agent' }
}

function LevelPicker({ level, setLevel }: { level: LevelKey; setLevel: (l: LevelKey) => void }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const cur = useLevel(level)
  const has = (o?: { connectors?: Record<string, boolean> }): string => (o?.connectors ? ' •' : '')
  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${has(settings.workspaces[w.id])}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${has(settings.agents[a.id])}` }))
    ])
  ]
  return (
    <Group title="Áp dụng cho">
      <Row
        label="Cấp"
        desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó. Dấu • = có bật / tắt riêng. Phiên đang chạy giữ nguyên, phiên mở sau mới nhận thay đổi."
      >
        <Select label="Cấp áp dụng connector" value={cur.lvl === 'app' ? 'app' : level} onChange={setLevel} options={options} />
      </Row>
    </Group>
  )
}

/** Công tắc bật / tắt một connector / máy chủ có sẵn ở cấp đang chọn. Cấp dưới: theo cấp trên / bật / tắt. */
function LevelToggle({ k, level, label }: { k: string; level: Level; label: string }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const [, run] = useSaveError()
  if (level.lvl === 'app') {
    const on = connectorOn(settings, k)
    const set = (v: boolean): void => {
      if (k.includes(':')) {
        const inherited = { ...settings.app.connectors.inherited }
        if (v) delete inherited[k]
        else inherited[k] = false
        run(useSettings.getState().save({ connectors: { inherited } }))
      } else {
        const c = settings.app.connectors.items.find((x) => x.id === k)
        if (c) run(window.stag.connectors.save({ ...c, enabled: v }))
      }
    }
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Switch label={`${on ? 'Tắt' : 'Bật'} ${label} cho mọi agent`} checked={on} onChange={set} />
      </span>
    )
  }
  const own = (level.lvl === 'ws' ? settings.workspaces[level.wsId!] : settings.agents[level.agentId!])?.connectors ?? {}
  const parent = level.lvl === 'agent' ? connectorOn(settings, k, level.wsId) : connectorOn(settings, k)
  const value = k in own ? (own[k] ? 'on' : 'off') : 'inherit'
  const set = (v: 'inherit' | 'on' | 'off'): void => {
    const next = { ...own }
    if (v === 'inherit') delete next[k]
    else next[k] = v === 'on'
    const empty = Object.keys(next).length === 0
    run(
      useSettings
        .getState()
        .saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, { connectors: empty ? null : next })
    )
  }
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <Select
        label={`${label} cho ${level.name}`}
        value={value}
        onChange={set}
        options={[
          { value: 'inherit', label: `Theo cấp trên (${parent ? 'bật' : 'tắt'})` },
          { value: 'on', label: 'Bật' },
          { value: 'off', label: 'Tắt' }
        ]}
      />
    </span>
  )
}

/** Connector vừa tạo: ở cấp app thì bật cho mọi agent; ở cấp workspace / agent thì tắt ở app, bật riêng ở cấp đó. */
async function enableOnlyAt(level: Level, c: Connector): Promise<void> {
  if (level.lvl === 'app') return
  if (c.enabled) await window.stag.connectors.save({ ...c, enabled: false })
  const st = useSettings.getState().value
  const own = (level.lvl === 'ws' ? st.workspaces[level.wsId!] : st.agents[level.agentId!])?.connectors ?? {}
  await useSettings
    .getState()
    .saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, { connectors: { ...own, [c.id]: true } })
}

// ---- danh sách ----

function ConnectorList({
  level,
  setLevel,
  open,
  onAdd
}: {
  level: LevelKey
  setLevel: (l: LevelKey) => void
  open: (id: string) => void
  onAdd: () => void
}): React.JSX.Element {
  const items = useSettings((s) => s.value.app.connectors.items)
  const secrets = useSecrets((s) => s.items)
  const lv = useLevel(level)
  const missing = (c: Connector): string[] => connectorSecrets(c).filter((n) => !secrets.some((x) => x.name === n))

  return (
    <>
      <div className="mb-2 flex items-center gap-2.5">
        <h1 className="text-[18px] font-semibold tracking-tight">Đã kết nối</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
        >
          <span className="text-[15px] leading-none">+</span> Kết nối thêm
        </button>
      </div>
      <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
        Máy chủ MCP cho agent thêm tool. App đưa chúng vào phiên Claude Code, Codex và adapter
        ngoài đọc được file MCP. Token / API key cất ở <b className="font-medium text-fg">Secrets</b>, truyền qua biến môi trường, không nằm trên dòng lệnh.
      </p>

      <LevelPicker level={level} setLevel={setLevel} />

      <SectionHead icon={<PlugIcon className="h-4 w-4 text-muted" />}>Connector của stag.ai</SectionHead>
      {items.length === 0 ? (
        <div className="mb-7 flex flex-col items-center rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <PlugIcon className="mb-3 h-7 w-7 text-muted" />
          <div className="text-[13px] font-medium">Chưa kết nối gì</div>
          <div className="mt-1 text-[12px] text-muted">Chọn một dịch vụ ở Danh mục, hoặc chép một máy chủ có sẵn bên dưới.</div>
        </div>
      ) : (
        <div className="mb-7 divide-y divide-line rounded-lg border border-line bg-panel">
          {items.map((c) => {
            const miss = missing(c)
            const tone: Tone = miss.length ? 'bad' : c.testedAt ? 'ok' : 'muted'
            const line = [
              c.id,
              ...(c.oauth ? ['đăng nhập OAuth'] : []),
              c.transport === 'http' ? c.url : [c.command, ...c.args].join(' '),
              c.testedAt ? `${c.tools.length} tool` : 'chưa thử',
              ...(miss.length ? [`thiếu bí mật ${miss.join(', ')}`] : [])
            ].join(' · ')
            return (
              <Line
                key={c.id}
                logo={<ConnectorLogo slug={c.catalog?.slug} name={c.label || c.id} size={30} />}
                tone={tone}
                title={c.label || c.id}
                badge={<Badge>{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>}
                line={line}
                lineBad={miss.length > 0}
                onOpen={() => open(c.id)}
                control={<LevelToggle k={c.id} level={lv} label={c.label || c.id} />}
              />
            )
          })}
        </div>
      )}

      <InheritedGroup runtime="claude" level={lv} />
      <InheritedGroup runtime="codex" level={lv} />
    </>
  )
}

function InheritedGroup({ runtime, level }: { runtime: CliAdapterId; level: Level }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const workspaces = useWorkspaces((s) => s.items)
  const activeWs = useWorkspaces((s) => s.activeId)
  const [scan, setScan] = useState<InheritedScan | undefined>(scanCache[runtime])
  const [busy, setBusy] = useState(false)
  const [copyMsg, setCopyMsg] = useState('')
  const wsId = level.wsId ?? activeWs ?? undefined
  const ws = workspaces.find((w) => w.id === wsId)

  const doScan = (): void => {
    setBusy(true)
    window.stag.connectors
      .scan(runtime, wsId)
      .then((r) => {
        scanCache[runtime] = r
        setScan(r)
      })
      .catch((e) => setScan({ runtime, cwd: '', servers: [], error: errText(e), scannedAt: new Date().toISOString() }))
      .finally(() => setBusy(false))
  }
  // Codex quét nhanh (chỉ đọc config) → tự quét; Claude kiểm tra sức khoẻ từng máy chủ (vài giây) → chờ người dùng bấm.
  useEffect(() => {
    if (runtime === 'codex' && !scanCache.codex) doScan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Máy chủ đã tắt ở đâu đó nhưng chưa quét lại (hoặc không còn trong cấu hình): vẫn hiện để bật lại được.
  const keys = new Set([
    ...Object.keys(settings.app.connectors.inherited),
    ...Object.values(settings.workspaces).flatMap((o) => Object.keys(o.connectors ?? {})),
    ...Object.values(settings.agents).flatMap((o) => Object.keys(o.connectors ?? {}))
  ])
  const rows: InheritedServer[] = [...(scan?.servers ?? [])]
  for (const k of keys)
    if (k.startsWith(`${runtime}:`) && !rows.some((r) => r.key === k))
      rows.push({ key: k, runtime, name: k.slice(runtime.length + 1), source: guessSource(runtime, k.slice(runtime.length + 1)), target: '', status: scan ? 'không thấy khi quét' : 'chưa quét', copyable: false })

  const copy = (s: InheritedServer): void => {
    setCopyMsg('')
    window.stag.connectors
      .copy(runtime, s.name, wsId)
      .then(async (r) => {
        // Đang xem cấp workspace / agent: bản chép chỉ bật ở cấp đó (máy chủ của một dự án không nên chạy ở mọi nơi).
        for (const c of r.connectors) await enableOnlyAt(level, c)
        setCopyMsg(importSummary(r))
      })
      .catch((e) => setCopyMsg(errText(e)))
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <ServerIcon className="h-4 w-4 text-muted" />
        Có sẵn trong {RUNTIME[runtime]}
        <div className="flex-1" />
        <SmallButton onClick={doScan} disabled={busy}>
          {busy ? 'Đang quét…' : scan ? 'Quét lại' : 'Quét'}
        </SmallButton>
      </div>
      <div className="mb-2 text-[12px] leading-relaxed text-muted">
        {runtime === 'claude' ? (
          <>
            Máy chủ {RUNTIME.claude} tự nạp: connector claude.ai, plugin, <code>claude mcp add</code>, <code>.mcp.json</code> của dự án
            {ws ? ` (theo thư mục của workspace ${ws.name})` : ''}. Quét chạy <code>claude mcp list</code> (có kiểm tra kết nối, không tốn quota). Tắt ở đây
            chỉ áp dụng cho phiên agent của stag.ai.
          </>
        ) : (
          <>
            Máy chủ trong <code>~/.codex/config.toml</code> (và <code>.codex/config.toml</code> của dự án). Tắt ở đây chỉ áp dụng cho phiên agent của stag.ai.
          </>
        )}
      </div>
      {scan?.cwd && (
        <div className="mb-2 truncate text-[11.5px] text-muted" title={scan.cwd}>
          Quét lúc {new Date(scan.scannedAt).toLocaleTimeString()} ở {scan.cwd}
        </div>
      )}
      {scan?.error && <ErrorBar error={scan.error} />}
      {copyMsg && <div className="mb-2 rounded-md border border-line bg-panel-2/60 px-3 py-2 text-[12px]">{copyMsg}</div>}
      <div className="mb-7 divide-y divide-line rounded-lg border border-line bg-panel">
        {rows.length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-muted">{busy ? 'Đang quét…' : scan ? 'Không có máy chủ nào.' : 'Bấm Quét để xem.'}</div>
        ) : (
          rows.map((s) => {
            const tone: Tone = /connected|bật/i.test(s.status) ? 'ok' : /fail|error|lỗi|không thấy/i.test(s.status) ? 'bad' : /auth|pending|approval/i.test(s.status) ? 'warn' : 'muted'
            return (
              <Line
                key={s.key}
                tone={tone}
                title={s.name}
                badge={<Badge>{SOURCE[s.source]}</Badge>}
                line={[s.target, s.status].filter(Boolean).join(' · ')}
                control={
                  <>
                    {s.copyable && (
                      <button
                        type="button"
                        title="Chép thành connector của stag.ai (dùng được cả với Codex / adapter ngoài)"
                        onClick={() => copy(s)}
                        className="rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg"
                      >
                        Chép
                      </button>
                    )}
                    <LevelToggle k={s.key} level={level} label={s.name} />
                  </>
                }
              />
            )
          })
        )}
      </div>
    </>
  )
}

function Line({
  logo,
  tone,
  title,
  badge,
  line,
  lineBad,
  control,
  onOpen
}: {
  logo?: ReactNode
  tone: Tone
  title: string
  badge: ReactNode
  line: string
  lineBad?: boolean
  control: ReactNode
  onOpen?: () => void
}): React.JSX.Element {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => onOpen && e.key === 'Enter' && e.target === e.currentTarget && onOpen()}
      className={`group flex items-center gap-3 px-4 py-3 ${onOpen ? 'cursor-pointer hover:bg-panel-2/60' : ''}`}
    >
      {logo ?? <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[tone]}`} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {logo && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[tone]}`} />}
          <span className="truncate font-medium">{title}</span>
          {badge}
        </div>
        <div className={`mt-0.5 truncate font-mono text-[11.5px] ${lineBad ? 'text-red-300' : 'text-muted'}`}>{line}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{control}</div>
      {onOpen && <span className="text-muted group-hover:text-fg">›</span>}
    </div>
  )
}

// ---- trang chi tiết ----

/** Hiện tham số trong một dòng: tham số có khoảng trắng / nháy thì bọc "…" (đọc lại bằng splitArgs). */
const joinArgs = (args: string[]): string => args.map((a) => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')

function ConnectorDetail({ id, level, onBack, onRenamed }: { id: string; level: LevelKey; onBack: () => void; onRenamed: (id: string) => void }): React.JSX.Element {
  const c = useSettings((s) => s.value.app.connectors.items.find((x) => x.id === id))
  const loaded = useSettings((s) => s.loaded)
  const lv = useLevel(level)
  const activeWs = useWorkspaces((s) => s.activeId)
  const [error, run] = useSaveError()
  const [test, setTest] = useState<ConnectorTestResult | 'loading' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [reauth, setReauth] = useState<'busy' | null>(null)

  if (!c) {
    return (
      <DetailHead onBack={onBack} title={id} sub={loaded ? 'Connector này đã bị gỡ.' : 'Đang tải…'}>
        {null}
      </DetailHead>
    )
  }
  const save = (patch: Partial<Connector>): void => {
    const next = { ...c, ...patch }
    run(
      window.stag.connectors.save(next, c.id).then((s) => {
        if (next.id !== c.id && s.app.connectors.items.some((x) => x.id === next.id)) onRenamed(next.id)
      })
    )
  }
  const doTest = (): void => {
    setTest('loading')
    window.stag.connectors
      .test(c.id, lv.wsId ?? activeWs ?? undefined)
      .then(setTest)
      .catch((e) => setTest({ ok: false, server: '', tools: [], error: errText(e), ms: 0 }))
  }

  const cat = catalogOf(c)
  const doReauth = (): void => {
    setReauth('busy')
    setTest(null)
    window.stag.connectors
      .reauth(c.id, lv.wsId ?? activeWs ?? undefined)
      .then(setTest)
      .catch((e) => setTest({ ok: false, server: '', tools: [], error: errText(e), ms: 0 }))
      .finally(() => setReauth(null))
  }

  const toolNames = [...new Set([...c.tools.map((t) => t.name), ...Object.keys(c.toolPolicy)])]

  return (
    <DetailHead
      onBack={onBack}
      logo={<ConnectorLogo slug={c.catalog?.slug} name={c.label || c.id} size={32} />}
      title={c.label || c.id}
      badge={<Badge>{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>}
      control={<LevelToggle k={c.id} level={lv} label={c.label || c.id} />}
      sub={`Công tắc bên phải áp dụng cho ${lv.name} (đổi cấp ở trang danh sách). Sửa cấu hình áp dụng cho mọi nơi; phiên đang chạy giữ nguyên.`}
    >
      <ErrorBar error={error} />
      {(cat || c.oauth || c.urlSecret) && (
        <Group title="Dịch vụ">
          {cat && (
            <Row label={cat.entry.name} desc={methodLabel(cat.entry, cat.method)}>
              {cat.entry.docsUrl && (
                <a href={cat.entry.docsUrl} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
                  Tài liệu ↗
                </a>
              )}
            </Row>
          )}
          {c.oauth && (
            <Row
              label="Đăng nhập OAuth"
              desc={
                reauth
                  ? 'Đang chờ bạn đăng nhập trong trình duyệt…'
                  : 'Token cất ở Secrets, app tự làm mới trước mỗi phiên. Bị thu hồi / hết hạn hẳn thì đăng nhập lại. Phiên rất dài có thể gặp token hết hạn giữa chừng: mở phiên mới.'
              }
            >
              {reauth ? (
                <SmallButton onClick={() => void window.stag.connectors.cancelConnect()}>Huỷ</SmallButton>
              ) : (
                <SmallButton onClick={doReauth}>Đăng nhập lại</SmallButton>
              )}
            </Row>
          )}
          {c.urlSecret && <Row label="URL có token" desc={`URL đầy đủ cất ở bí mật ${c.urlSecret}; cài đặt chỉ giữ ${c.url}. Đổi URL: thay giá trị bí mật ở Secrets.`} />}
        </Group>
      )}
      <Group title="Máy chủ">
        <Row label="Tên hiển thị" htmlFor="conn-label">
          <TextField id="conn-label" value={c.label} placeholder={c.id} onCommit={(label) => save({ label })} />
        </Row>
        <Row label="Tên trong phiên" desc={`Agent thấy tool dạng mcp__${c.id}__<tool>. Chỉ a-z, 0-9, "_" và "-".`} htmlFor="conn-id">
          <TextField id="conn-id" mono value={c.id} onCommit={(v) => v && v !== c.id && save({ id: v })} />
        </Row>
        <Row label="Kiểu kết nối" desc="stdio = app chạy một chương trình trên máy; HTTP = máy chủ ở xa (Streamable HTTP).">
          <Select
            label="Kiểu kết nối"
            value={c.transport}
            onChange={(transport) => save({ transport })}
            options={[
              { value: 'stdio', label: 'stdio (chương trình)' },
              { value: 'http', label: 'HTTP' }
            ]}
          />
        </Row>
        {c.transport === 'stdio' ? (
          <>
            <Row label="Chương trình" desc="Vd. npx, uvx, node, hoặc đường dẫn file .exe. Trên Windows npx / npm tự được chạy qua cmd /c." htmlFor="conn-cmd">
              <TextField id="conn-cmd" mono value={c.command} placeholder="npx" onCommit={(command) => save({ command })} />
            </Row>
            <Row label="Tham số" desc='Cách nhau bằng dấu cách; "…" giữ khoảng trắng.' htmlFor="conn-args">
              <TextField id="conn-args" mono wide value={joinArgs(c.args)} placeholder="-y @playwright/mcp@latest" onCommit={(v) => save({ args: splitArgs(v) })} />
            </Row>
          </>
        ) : (
          <>
            {!c.urlSecret && (
              <Row label="Địa chỉ" htmlFor="conn-url">
                <TextField id="conn-url" mono wide value={c.url} placeholder="https://example.com/mcp" onCommit={(url) => save({ url })} />
              </Row>
            )}
            {!c.oauth && (
              <Row label="Bearer token" desc="Gửi thành header Authorization: Bearer <bí mật>.">
                <SecretPicker value={c.bearerSecret} onChange={(bearerSecret) => save({ bearerSecret })} allowNone suggest={`${c.id}_TOKEN`} />
              </Row>
            )}
          </>
        )}
      </Group>

      <ValueRows
        key={`${c.id}-${c.transport}`}
        title={c.transport === 'stdio' ? 'Biến môi trường' : 'Header thêm'}
        keyLabel={c.transport === 'stdio' ? 'TÊN_BIẾN' : 'X-Header'}
        keyRe={c.transport === 'stdio' ? ENV_KEY_RE : /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/}
        values={c.transport === 'stdio' ? c.env : c.headers}
        suggest={(k) => `${c.id}_${k}`.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}
        onSave={(v) => save(c.transport === 'stdio' ? { env: v } : { headers: v })}
      />

      <Group title="Thử kết nối">
        <Row
          label="Nối thử và lấy danh sách tool"
          desc={
            test === 'loading'
              ? 'Đang nối… (lần đầu chạy npx có thể phải tải gói)'
              : test
                ? test.ok
                  ? `Được: ${test.server || 'máy chủ'} · ${test.tools.length} tool · ${(test.ms / 1000).toFixed(1)} s`
                  : null
                : c.testedAt
                  ? `Lần thử gần nhất ${new Date(c.testedAt).toLocaleString()}: ${c.tools.length} tool.`
                  : 'Chạy máy chủ với cấu hình này (cả bí mật), hỏi danh sách tool rồi đóng. Không gọi tool nào.'
          }
        >
          <SmallButton onClick={doTest} disabled={test === 'loading'}>
            {test === 'loading' ? 'Đang thử…' : 'Thử kết nối'}
          </SmallButton>
        </Row>
        {test && test !== 'loading' && !test.ok && (
          <div className="whitespace-pre-wrap px-4 py-3 text-[12px] text-red-300">{test.error}</div>
        )}
      </Group>

      <Group title="Tool">
        <Row
          label="Mặc định"
          desc="Tool chưa chọn riêng: hỏi bạn trước khi agent dùng, hay tự cho phép. (Agent chạy ở mức quyền bỏ qua mọi câu hỏi thì không hỏi.)"
        >
          <Select
            label="Mức mặc định của tool"
            value={c.approval}
            onChange={(approval) => save({ approval })}
            options={[
              { value: 'ask', label: 'Hỏi trước' },
              { value: 'allow', label: 'Tự cho phép' }
            ]}
          />
        </Row>
        {toolNames.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-muted">Bấm "Thử kết nối" để thấy tool và chọn mức cho từng tool.</div>
        ) : (
          toolNames.map((name) => {
            const t = c.tools.find((x) => x.name === name)
            const own = c.toolPolicy[name]
            return (
              <Row key={name} label={<span className="font-mono text-[12.5px]">{name}</span>} desc={t?.description || (t ? null : 'không thấy ở lần thử gần nhất')}>
                <Select<ToolPolicy | 'default'>
                  label={`Mức của tool ${name}`}
                  value={own ?? 'default'}
                  onChange={(v) => {
                    const toolPolicyNext = { ...c.toolPolicy }
                    if (v === 'default') delete toolPolicyNext[name]
                    else toolPolicyNext[name] = v
                    save({ toolPolicy: toolPolicyNext })
                  }}
                  options={[
                    { value: 'default', label: `Theo mặc định (${c.approval === 'allow' ? 'tự cho phép' : 'hỏi trước'})` },
                    { value: 'allow', label: 'Tự cho phép' },
                    { value: 'ask', label: 'Hỏi trước' },
                    { value: 'block', label: 'Chặn' }
                  ]}
                />
                <span className={`w-2 text-center text-[11px] ${toolPolicy(c, name) === 'block' ? 'text-red-300' : 'text-transparent'}`}>●</span>
              </Row>
            )
          })
        )}
      </Group>

      <Group title="Gỡ">
        <Row label="Gỡ connector" desc={confirmRemove ? 'Bấm lần nữa để gỡ. Bí mật của nó vẫn giữ trong Secrets.' : 'Bỏ khỏi mọi phiên agent mở sau, cùng các bật / tắt riêng của nó.'}>
          <button
            type="button"
            onClick={() => {
              if (!confirmRemove) return setConfirmRemove(true)
              run(window.stag.connectors.remove(c.id).then(onBack))
            }}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-300 hover:bg-red-500/10"
          >
            {confirmRemove ? 'Gỡ thật' : 'Gỡ connector'}
          </button>
        </Row>
      </Group>
    </DetailHead>
  )
}

function DetailHead({
  logo,
  title,
  badge,
  control,
  sub,
  onBack,
  children
}: {
  logo?: ReactNode
  title: string
  badge?: ReactNode
  control?: ReactNode
  sub: ReactNode
  onBack: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <>
      <button type="button" onClick={onBack} className="-ml-2 mb-3 rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-panel-2 hover:text-fg">
        ← Tất cả connector
      </button>
      <div className="mb-1 flex items-center gap-2.5">
        {logo ?? <PlugIcon className="h-5 w-5 text-muted" />}
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        {badge}
        <div className="flex-1" />
        {control}
      </div>
      <div className="mb-5 text-[12.5px] leading-relaxed text-muted">{sub}</div>
      {children}
    </>
  )
}

/** Ô chữ lưu khi rời ô / Enter (Esc = huỷ sửa). */
function TextField({
  id,
  value,
  placeholder,
  mono,
  wide,
  onCommit
}: {
  id: string
  value: string
  placeholder?: string
  mono?: boolean
  wide?: boolean
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = (): void => {
    if (text.trim() !== value) onCommit(text.trim())
  }
  return (
    <input
      id={id}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setText(value)
      }}
      className={`${wide ? 'w-80' : 'w-56'} rounded-md border border-line bg-bg px-2 py-1.5 text-[12.5px] outline-none focus:border-accent ${mono ? 'font-mono' : ''}`}
    />
  )
}

/** Chọn một bí mật đã lưu, hoặc tạo bí mật mới ngay tại chỗ. */
function SecretPicker({
  value,
  onChange,
  allowNone,
  suggest
}: {
  value: string
  onChange: (name: string) => void
  allowNone?: boolean
  suggest: string
}): React.JSX.Element {
  const { items, available } = useSecrets()
  const [creating, setCreating] = useState(false)
  const missing = value && !items.some((x) => x.name === value)
  if (creating) return <NewSecret suggest={suggest} onDone={(n) => (setCreating(false), n && onChange(n))} />
  return (
    <Select
      label="Bí mật"
      value={value}
      onChange={(v) => (v === '+new' ? setCreating(true) : onChange(v))}
      options={[
        ...(allowNone ? [{ value: '', label: '— Không —' }] : []),
        ...(missing ? [{ value, label: `${value} (chưa lưu!)` }] : []),
        ...items.map((x) => ({ value: x.name, label: x.name })),
        { value: '+new', label: '+ Bí mật mới…', disabled: !available }
      ]}
    />
  )
}

function NewSecret({ suggest, onDone }: { suggest: string; onDone: (name: string | null) => void }): React.JSX.Element {
  const [name, setName] = useState(suggest)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const ok = SECRET_NAME_RE.test(name) && value !== ''
  const submit = (): void => {
    if (!ok) return
    window.stag.secrets
      .set(name, value)
      .then(() => onDone(name))
      .catch((e) => setError(errText(e)))
  }
  const input = 'rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent'
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <input aria-label="Tên bí mật mới" value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-40`} spellCheck={false} />
        <input
          aria-label="Giá trị bí mật mới"
          type="password"
          autoFocus
          value={value}
          placeholder="giá trị"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onDone(null)
          }}
          className={`${input} w-40`}
        />
        <SmallButton onClick={submit} disabled={!ok}>
          Lưu
        </SmallButton>
        <SmallButton onClick={() => onDone(null)}>Huỷ</SmallButton>
      </div>
      {error && <div className="text-[11.5px] text-red-300">{error}</div>}
    </div>
  )
}

interface ValueRow {
  key: string
  kind: 'value' | 'secret'
  value: string
}

/** Sửa biến môi trường / header: mỗi dòng TÊN + chữ thường hoặc bí mật. Lưu khi rời ô. */
function ValueRows({
  title,
  keyLabel,
  keyRe,
  values,
  suggest,
  onSave
}: {
  title: string
  keyLabel: string
  keyRe: RegExp
  values: Record<string, ConnectorValue>
  suggest: (key: string) => string
  onSave: (v: Record<string, ConnectorValue>) => void
}): React.JSX.Element {
  const toRows = (v: Record<string, ConnectorValue>): ValueRow[] =>
    Object.entries(v).map(([key, x]) => ('secret' in x ? { key, kind: 'secret', value: x.secret } : { key, kind: 'value', value: x.value }))
  const [rows, setRows] = useState<ValueRow[]>(() => toRows(values))
  const [problem, setProblem] = useState('')
  const valuesJson = JSON.stringify(values)
  useEffect(() => setRows(toRows(values)), [valuesJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: ValueRow[]): void => {
    const filled = next.filter((r) => r.key.trim() || r.value)
    const out: Record<string, ConnectorValue> = {}
    for (const r of filled) {
      const k = r.key.trim()
      if (!keyRe.test(k)) return setProblem(`Tên "${k || '(trống)'}" không hợp lệ`)
      if (k in out) return setProblem(`Tên ${k} bị trùng`)
      if (r.kind === 'secret' && !r.value) return setProblem(`${k}: chọn bí mật`)
      out[k] = r.kind === 'secret' ? { secret: r.value } : { value: r.value }
    }
    setProblem('')
    if (JSON.stringify(out) !== valuesJson) onSave(out)
  }
  const update = (i: number, patch: Partial<ValueRow>, save = false): void => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r))
    setRows(next)
    if (save) commit(next)
  }
  const input = 'rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent'

  return (
    <Group title={title}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 px-4 py-2">
          <input
            aria-label={`Tên ${i + 1}`}
            value={r.key}
            placeholder={keyLabel}
            spellCheck={false}
            onChange={(e) => update(i, { key: e.target.value })}
            onBlur={() => commit(rows)}
            className={`${input} w-48`}
          />
          <Select
            label={`Loại giá trị ${i + 1}`}
            value={r.kind}
            onChange={(kind) => update(i, { kind, value: '' }, kind === 'value')}
            options={[
              { value: 'value', label: 'Chữ' },
              { value: 'secret', label: 'Bí mật' }
            ]}
          />
          <div className="flex min-w-0 flex-1 justify-end">
            {r.kind === 'secret' ? (
              <SecretPicker value={r.value} suggest={suggest(r.key || 'KEY')} onChange={(v) => update(i, { value: v }, true)} />
            ) : (
              <input
                aria-label={`Giá trị ${i + 1}`}
                value={r.value}
                spellCheck={false}
                onChange={(e) => update(i, { value: e.target.value })}
                onBlur={() => commit(rows)}
                className={`${input} w-full`}
              />
            )}
          </div>
          <button
            type="button"
            aria-label={`Xoá dòng ${i + 1}`}
            onClick={() => {
              const next = rows.filter((_, j) => j !== i)
              setRows(next)
              commit(next)
            }}
            className="rounded px-1.5 text-muted hover:bg-panel-2 hover:text-red-300"
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3 px-4 py-2">
        <SmallButton onClick={() => setRows([...rows, { key: '', kind: 'value', value: '' }])}>+ Thêm dòng</SmallButton>
        {problem ? (
          <span className="text-[12px] text-red-300">{problem}</span>
        ) : (
          <span className="text-[11.5px] text-muted">Token / key: chọn "Bí mật" — giá trị cất ở Secrets, không nằm trong cài đặt.</span>
        )}
      </div>
    </Group>
  )
}

// ---- thêm connector ----

function importSummary(r: ConnectorImport): string {
  const parts: string[] = []
  if (r.connectors.length) parts.push(`Đã thêm ${r.connectors.map((c) => c.id).join(', ')}.`)
  if (r.secrets.length) parts.push(`Tách ${r.secrets.length} giá trị thành bí mật: ${r.secrets.join(', ')}.`)
  if (r.errors.length) parts.push(r.errors.join(' · '))
  return parts.join(' ')
}

function AddConnectorDialog({ level, onClose, onCreated }: { level: LevelKey; onClose: () => void; onCreated: (id: string | null) => void }): React.JSX.Element {
  const items = useSettings((s) => s.value.app.connectors.items)
  const lv = useLevel(level)
  const [tab, setTab] = useState<'custom' | 'json'>('custom')
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [target, setTarget] = useState('')
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConnectorImport | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const freeId = (base: string): string => {
    let id = base
    for (let i = 2; items.some((c) => c.id === id); i++) id = `${base}-${i}`
    return id
  }

  const ready = tab === 'custom' ? CONNECTOR_ID_RE.test(slugify(name)) && target.trim() !== '' : json.trim() !== ''

  async function create(): Promise<void> {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      if (tab === 'json') {
        const r = await window.stag.connectors.importJson(json)
        for (const c of r.connectors) await enableOnlyAt(lv, c)
        if (!r.connectors.length) {
          setError(r.errors.join('\n') || 'Không thêm được connector nào')
          setBusy(false)
          return
        }
        if (r.errors.length || r.secrets.length) {
          setResult(r)
          setBusy(false)
          return
        }
        onCreated(r.connectors.length === 1 ? r.connectors[0].id : null)
        return
      }
      const c: Connector = { ...emptyConnector(freeId(slugify(name))), label: name.trim(), transport }
      if (transport === 'http') c.url = target.trim()
      else {
        const [command, ...args] = splitArgs(target.trim())
        c.command = command ?? ''
        c.args = args
      }
      await window.stag.connectors.save(c)
      await enableOnlyAt(lv, c)
      onCreated(c.id)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  const tabBtn = (id: typeof tab, label: string): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`rounded-md border px-2.5 py-1 text-[12.5px] ${tab === id ? 'border-fg/60 bg-panel-2 text-fg' : 'border-line text-muted hover:text-fg'}`}
    >
      {label}
    </button>
  )
  const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent'

  return (
    <Modal
      title="Kết nối công cụ riêng"
      width="w-[560px]"
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <Button primary onClick={() => onCreated(result.connectors.length === 1 ? result.connectors[0].id : null)}>
            Xong
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Huỷ
            </Button>
            <Button primary onClick={create} disabled={busy || !ready}>
              {busy ? 'Đang thêm…' : 'Thêm'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="text-[12.5px] leading-relaxed">{importSummary(result)}</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            {lv.lvl === 'app' ? 'Connector mới bật cho mọi agent.' : `Connector mới chỉ bật cho ${lv.name} (mặc định của app: tắt).`} Sau khi thêm, bấm "Thử kết nối" ở
            trang của nó.
          </p>
          <div className="mb-4 flex gap-2">
            {tabBtn('custom', 'Tự cấu hình')}
            {tabBtn('json', 'Dán JSON')}
          </div>
          {tab === 'custom' && (
            <>
              <label className="mb-1.5 block text-[12.5px]" htmlFor="conn-new-name">
                Tên
              </label>
              <input id="conn-new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear" className={input} />
              {name && <p className="mt-1 text-[11.5px] text-muted">Tên trong phiên: {freeId(slugify(name))}</p>}
              <div className="mb-1.5 mt-3 flex gap-2">
                {(['stdio', 'http'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-[12.5px]">
                    <input type="radio" checked={transport === t} onChange={() => setTransport(t)} />
                    {t === 'stdio' ? 'Chương trình (stdio)' : 'Máy chủ HTTP'}
                  </label>
                ))}
              </div>
              <input
                aria-label={transport === 'stdio' ? 'Lệnh chạy máy chủ' : 'Địa chỉ máy chủ'}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={transport === 'stdio' ? 'npx -y @modelcontextprotocol/server-memory' : 'https://mcp.example.com/mcp'}
                spellCheck={false}
                className={input}
              />
              <p className="mt-1.5 text-[11.5px] text-muted">Biến môi trường, header, bí mật: thêm ở trang của connector sau khi tạo.</p>
            </>
          )}
          {tab === 'json' && (
            <>
              <textarea
                aria-label="JSON cấu hình MCP"
                autoFocus
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={'{\n  "mcpServers": {\n    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }\n  }\n}'}
                className={`${input} resize-y`}
              />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                Dạng của Claude Code / Cursor / VS Code (<code>mcpServers</code> hoặc <code>servers</code>). Giá trị có tên giống token (KEY, TOKEN, SECRET…) và
                header Authorization được tách thành bí mật, không lưu vào cài đặt.
              </p>
            </>
          )}
          {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
        </form>
      )}
    </Modal>
  )
}

function SectionHead({ icon, children }: { icon: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      {icon}
      {children}
    </div>
  )
}

function PlugIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 2v6M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8z" />
      <path d="M12 17v5" />
    </svg>
  )
}

function ServerIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  )
}

function StoreIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9z" />
      <path d="M5 13v7h14v-7" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  )
}
