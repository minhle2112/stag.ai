import { useEffect, useState } from 'react'
import { CATALOG, methodLabel } from '@shared/catalog'
import { connectorSecrets, CONNECTOR_ID_RE, emptyConnector, ENV_KEY_RE, OAUTH_SECRET_PREFIX, SECRET_NAME_RE, slugify, toolPolicy } from '@shared/connectors'
import { splitArgs } from '@shared/settings'
import {
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
import { useApprovals } from '../../store/approvals'
import { useSecrets } from '../../store/secrets'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Icon } from '../Icon'
import { Button, Modal } from '../Modal'
import { Seg } from '../ui/Seg'
import { errText } from './AdaptersSection'
import { BrowseView, catalogOf, ConnectorLogo, ReviewView } from './ConnectorCatalog'
import {
  Badge,
  Callout,
  DetailHead,
  Empty,
  ErrorBar,
  Group,
  INPUT,
  INPUT_MONO,
  InfoTip,
  LogoTile,
  Row,
  SearchBox,
  SectionTitle,
  Select,
  SmallButton,
  TEXTAREA,
  Tile,
  Tiles,
  useSaveError,
  type Tone
} from './controls'
import { LevelBar, LevelToggle, setAtLevel, useLevel, type Level, type LevelKey } from './levels'
import { fmtDateTime, fmtNumber, fmtTime, t, tx, useT } from '../../i18n'

/**
 * Settings → Connector: máy chủ MCP cho phiên agent. Hai loại:
 * - Connector của stag.ai: người dùng thêm (mẫu / tự cấu hình / dán JSON), app đưa vào phiên Claude Code,
 *   Codex và adapter ngoài đọc được file MCP; bí mật lấy từ Settings → Kho bí mật.
 * - Máy chủ có sẵn trong Claude Code / Codex: CLI tự nạp, ở đây chỉ tắt bớt cho phiên agent.
 * Bật / tắt theo cấp app → workspace → agent (công tắc cấp ở tiêu đề trang).
 */

type View = { type: 'list' } | { type: 'detail'; id: string }

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
  const [q, setQ] = useState('')
  const t = useT()

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
  const inDetail = tab === 'connected' && view.type === 'detail'

  return (
    <>
      <SectionTitle
        title={t('connectors.section.title')}
        desc={t('connectors.section.desc')}
        right={<LevelBar level={level} setLevel={setLevel} field="connectors" />}
      />
      {!inDetail && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Seg
            value={tab}
            onChange={(id) => {
              setTab(id)
              if (id === 'connected') setView({ type: 'list' })
            }}
            options={[
              { value: 'connected', label: `${t('connectors.tab.connected')}${items.length ? ` · ${items.length}` : ''}`, tip: t('connectors.tab.connectedTip') },
              { value: 'browse', label: `${t('connectors.tab.browse')} · ${CATALOG.length}`, tip: t('connectors.tab.browseTip') },
              {
                value: 'review',
                label: (
                  <>
                    {t('connectors.tab.review')}
                    {pending > 0 && <span className="rounded-full bg-wait px-1.5 text-[11px] font-semibold text-wait-on">{pending}</span>}
                  </>
                ),
                tip: t('connectors.tab.reviewTip')
              }
            ]}
          />
          {tab === 'browse' ? <SearchBox className="min-w-[160px] flex-1" value={q} onChange={setQ} placeholder={t('connectors.search')} label={t('connectors.search')} /> : <div className="flex-1" />}
          {tab === 'connected' && (
            <SmallButton variant="primary" icon="plus" onClick={() => setTab('browse')}>
              {t('connectors.connectMore')}
            </SmallButton>
          )}
          {tab === 'browse' && (
            <SmallButton icon="plus" onClick={() => setAdding(true)} tip={t('connectors.customTip')}>
              {t('connectors.custom')}
            </SmallButton>
          )}
        </div>
      )}
      <div className="min-w-0">
        {tab === 'browse' && <BrowseView q={q} onOpen={open} />}
        {tab === 'review' && <ReviewView connectorLabel={(id) => items.find((c) => c.id === id)} />}
        {tab === 'connected' &&
          (view.type === 'list' ? (
            <ConnectorList level={level} open={(id) => setView({ type: 'detail', id })} />
          ) : (
            <ConnectorDetail key={view.id} id={view.id} level={level} onBack={() => setView({ type: 'list' })} onRenamed={(id) => setView({ type: 'detail', id })} />
          ))}
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

// ---- cấp áp dụng (levels.tsx) ----

/** Bật / tắt ở cấp app: máy chủ có sẵn → map `inherited`; connector của stag.ai → trường `enabled` của nó. */
function connectorSetApp(k: string): (on: boolean) => Promise<unknown> {
  return (v) => {
    const settings = useSettings.getState().value
    if (k.includes(':')) {
      const inherited = { ...settings.app.connectors.inherited }
      if (v) delete inherited[k]
      else inherited[k] = false
      return useSettings.getState().save({ connectors: { inherited } })
    }
    const c = settings.app.connectors.items.find((x) => x.id === k)
    return c ? window.stag.connectors.save({ ...c, enabled: v }) : Promise.resolve()
  }
}

function ConnToggle({ k, level, label }: { k: string; level: Level; label: string }): React.JSX.Element {
  return <LevelToggle k={k} level={level} label={label} field="connectors" setApp={connectorSetApp(k)} />
}

/** Connector vừa tạo: ở cấp app thì bật cho mọi agent; ở cấp workspace / agent thì tắt ở app, bật riêng ở cấp đó. */
async function enableOnlyAt(level: Level, c: Connector): Promise<void> {
  if (level.lvl === 'app') return
  if (c.enabled) await window.stag.connectors.save({ ...c, enabled: false })
  await setAtLevel(level, 'connectors', c.id, true)
}

// ---- danh sách ----

function ConnectorList({ level, open }: { level: LevelKey; open: (id: string) => void }): React.JSX.Element {
  const items = useSettings((s) => s.value.app.connectors.items)
  const secrets = useSecrets((s) => s.items)
  const lv = useLevel(level)
  const t = useT()
  const missing = (c: Connector): string[] => connectorSecrets(c).filter((n) => !secrets.some((x) => x.name === n))

  return (
    <>
      <Group title={t('connectors.list.own')} flush>
        {items.length === 0 ? (
          <Empty title={t('connectors.list.emptyTitle')}>{t('connectors.list.empty')}</Empty>
        ) : (
          <Tiles>
            {items.map((c) => {
              const miss = missing(c)
              const tone: Tone = miss.length ? 'bad' : c.testedAt ? 'ok' : 'muted'
              const line = [
                c.id,
                ...(c.oauth ? [t('connectors.list.oauth')] : []),
                c.transport === 'http' ? c.url : [c.command, ...c.args].join(' '),
                c.testedAt ? t('connectors.toolCount', { count: c.tools.length }) : t('connectors.list.untested')
              ].join(' · ')
              return (
                <Tile
                  key={c.id}
                  logo={<ConnectorLogo slug={c.catalog?.slug} name={c.label || c.id} size={30} />}
                  dot={tone}
                  title={c.label || c.id}
                  badge={<Badge>{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>}
                  sub={<span className="font-mono text-[11px]">{line}</span>}
                  tip={line}
                  alert={miss.length ? t('connectors.list.missingSecrets', { names: miss.join(', ') }) : undefined}
                  onOpen={() => open(c.id)}
                  control={<ConnToggle k={c.id} level={lv} label={c.label || c.id} />}
                />
              )
            })}
          </Tiles>
        )}
      </Group>

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
  const t = useT()
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
      rows.push({ key: k, runtime, name: k.slice(runtime.length + 1), source: guessSource(runtime, k.slice(runtime.length + 1)), target: '', status: scan ? t('connectors.inherited.notFound') : t('connectors.inherited.notScanned'), copyable: false })

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

  const help =
    runtime === 'claude'
      ? ws
        ? t('connectors.inherited.claudeHelpWs', { runtime: RUNTIME.claude, workspace: ws.name })
        : t('connectors.inherited.claudeHelp', { runtime: RUNTIME.claude })
      : t('connectors.inherited.codexHelp')

  return (
    <Group
      title={
        <span className="inline-flex items-center gap-1.5">
          {t('connectors.inherited.title', { runtime: RUNTIME[runtime] })}
          <InfoTip text={help} />
        </span>
      }
      action={
        <SmallButton onClick={doScan} disabled={busy}>
          {busy ? t('connectors.inherited.scanning') : scan ? t('connectors.inherited.rescan') : t('connectors.inherited.scan')}
        </SmallButton>
      }
    >
      {scan?.cwd && (
        <div className="mb-2 truncate text-[11px] text-dim" data-tip={scan.cwd}>
          {t('connectors.inherited.scannedAt', { time: fmtTime(scan.scannedAt, true), folder: scan.cwd })}
        </div>
      )}
      {scan?.error && <ErrorBar error={scan.error} />}
      {copyMsg && <Callout className="mb-2">{copyMsg}</Callout>}
      {rows.length === 0 ? (
        <div className="border-b border-line py-3 text-[12px] text-dim">{busy ? t('connectors.inherited.scanning') : scan ? t('connectors.inherited.none') : t('connectors.inherited.pressScan')}</div>
      ) : (
        <Tiles min={260}>
          {rows.map((s) => {
            const tone: Tone = /connected|enabled in|bật/i.test(s.status) ? 'ok' : /fail|error|not found|lỗi|không thấy/i.test(s.status) ? 'bad' : /auth|pending|approval/i.test(s.status) ? 'warn' : 'muted' // i18n-ignore: matches status text in either UI language
            const line = [s.target, s.status].filter(Boolean).join(' · ')
            return (
              <Tile
                key={s.key}
                logo={<LogoTile>{(s.name.replace(/[^\p{L}\p{N}]/gu, '')[0] ?? '?').toUpperCase()}</LogoTile>}
                dot={tone}
                title={s.name}
                badge={<Badge>{SOURCE[s.source]}</Badge>}
                sub={<span className="font-mono text-[11px]">{line}</span>}
                tip={line}
                control={
                  <>
                    {s.copyable && (
                      <SmallButton
                        variant="ghost"
                        size="xs"
                        tip={t('connectors.inherited.copyTip')}
                        onClick={() => copy(s)}
                      >
                        {t('common.copy')}
                      </SmallButton>
                    )}
                    <ConnToggle k={s.key} level={level} label={s.name} />
                  </>
                }
              />
            )
          })}
        </Tiles>
      )}
    </Group>
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
  const t = useT()

  if (!c) {
    return <DetailHead onBack={onBack} backLabel={t('connectors.detail.back')} title={id} sub={loaded ? t('connectors.detail.removed') : t('common.loading')} />
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

  const toolNames = [...new Set([...c.tools.map((x) => x.name), ...Object.keys(c.toolPolicy)])]

  return (
    <>
      <DetailHead
        onBack={onBack}
        backLabel={t('connectors.detail.back')}
        logo={<ConnectorLogo slug={c.catalog?.slug} name={c.label || c.id} size={30} />}
        title={c.label || c.id}
        badge={<Badge>{c.transport === 'http' ? 'HTTP' : 'stdio'}</Badge>}
        control={<ConnToggle k={c.id} level={lv} label={c.label || c.id} />}
        sub={t('connectors.detail.levelHint', { level: lv.name })}
      />
      <ErrorBar error={error} />
      {(cat || c.oauth || c.urlSecret) && (
        <Group title={t('connectors.detail.service')}>
          {cat && (
            <Row label={cat.entry.name} sub={methodLabel(cat.entry, cat.method)}>
              {cat.entry.docsUrl && (
                <a href={cat.entry.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">
                  {t('connectors.detail.docs')}
                  <Icon name="ext" size="s" />
                </a>
              )}
            </Row>
          )}
          {c.oauth && (
            <Row
              label={t('connectors.detail.oauth')}
              desc={t('connectors.detail.oauthDesc')}
              sub={reauth ? t('connectors.detail.waitingBrowser') : undefined}
            >
              {reauth ? (
                <SmallButton onClick={() => void window.stag.connectors.cancelConnect()}>{t('common.cancel')}</SmallButton>
              ) : (
                <SmallButton onClick={doReauth}>{t('connectors.detail.reauth')}</SmallButton>
              )}
            </Row>
          )}
          {c.urlSecret && <Row label={t('connectors.detail.urlSecret')} desc={t('connectors.detail.urlSecretDesc', { secret: c.urlSecret, url: c.url })} />}
        </Group>
      )}
      <Group title={t('connectors.detail.server')}>
        <Row label={t('connectors.detail.label')} htmlFor="conn-label">
          <TextField id="conn-label" value={c.label} placeholder={c.id} onCommit={(label) => save({ label })} />
        </Row>
        <Row label={t('connectors.detail.id')} desc={t('connectors.detail.idDesc', { pattern: `mcp__${c.id}__<tool>` })} htmlFor="conn-id">
          <TextField id="conn-id" mono value={c.id} onCommit={(v) => v && v !== c.id && save({ id: v })} />
        </Row>
        <Row label={t('connectors.detail.transport')} desc={t('connectors.detail.transportDesc')}>
          <Select
            label={t('connectors.detail.transport')}
            value={c.transport}
            onChange={(transport) => save({ transport })}
            options={[
              { value: 'stdio', label: t('connectors.detail.stdio') },
              { value: 'http', label: 'HTTP' }
            ]}
          />
        </Row>
        {c.transport === 'stdio' ? (
          <>
            <Row label={t('connectors.detail.command')} desc={t('connectors.detail.commandDesc')} htmlFor="conn-cmd">
              <TextField id="conn-cmd" mono value={c.command} placeholder="npx" onCommit={(command) => save({ command })} />
            </Row>
            <Row label={t('connectors.detail.args')} desc={t('connectors.detail.argsDesc')} htmlFor="conn-args">
              <TextField id="conn-args" mono wide value={joinArgs(c.args)} placeholder="-y @playwright/mcp@latest" onCommit={(v) => save({ args: splitArgs(v) })} />
            </Row>
          </>
        ) : (
          <>
            {!c.urlSecret && (
              <Row label={t('connectors.detail.url')} htmlFor="conn-url">
                <TextField id="conn-url" mono wide value={c.url} placeholder="https://example.com/mcp" onCommit={(url) => save({ url })} />
              </Row>
            )}
            {!c.oauth && (
              <Row label="Bearer token" desc={t('connectors.detail.bearerDesc')}>
                <SecretPicker value={c.bearerSecret} onChange={(bearerSecret) => save({ bearerSecret })} allowNone suggest={`${c.id}_TOKEN`} />
              </Row>
            )}
          </>
        )}
      </Group>

      <ValueRows
        key={`${c.id}-${c.transport}`}
        title={c.transport === 'stdio' ? t('connectors.values.env') : t('connectors.values.headers')}
        keyLabel={c.transport === 'stdio' ? t('connectors.values.envPlaceholder') : 'X-Header'}
        keyRe={c.transport === 'stdio' ? ENV_KEY_RE : /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/}
        values={c.transport === 'stdio' ? c.env : c.headers}
        suggest={(k) => `${c.id}_${k}`.toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}
        onSave={(v) => save(c.transport === 'stdio' ? { env: v } : { headers: v })}
      />

      <Group title={t('connectors.test.title')}>
        <Row
          label={t('connectors.test.label')}
          desc={t('connectors.test.desc')}
          sub={
            test === 'loading'
              ? t('connectors.test.connecting')
              : test
                ? test.ok
                  ? t('connectors.test.ok', {
                      server: test.server || t('connectors.test.server'),
                      tools: t('connectors.toolCount', { count: test.tools.length }),
                      seconds: fmtNumber(test.ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                    })
                  : undefined
                : c.testedAt
                  ? t('connectors.test.last', { time: fmtDateTime(c.testedAt), tools: t('connectors.toolCount', { count: c.tools.length }) })
                  : undefined
          }
        >
          <SmallButton onClick={doTest} disabled={test === 'loading'}>
            {test === 'loading' ? t('connectors.test.testing') : t('connectors.test.title')}
          </SmallButton>
        </Row>
        {test && test !== 'loading' && !test.ok && <div className="border-b border-line py-2.5 text-[12px] whitespace-pre-wrap text-danger">{test.error}</div>}
      </Group>

      <Group title={t('connectors.tools.title')}>
        <Row
          label={t('connectors.tools.default')}
          desc={t('connectors.tools.defaultDesc')}
        >
          <Select
            label={t('connectors.tools.defaultLabel')}
            value={c.approval}
            onChange={(approval) => save({ approval })}
            options={[
              { value: 'ask', label: t('connectors.policy.ask') },
              { value: 'allow', label: t('connectors.policy.allow') }
            ]}
          />
        </Row>
        {toolNames.length === 0 ? (
          <div className="border-b border-line py-3 text-[12px] text-dim">{t('connectors.tools.empty')}</div>
        ) : (
          toolNames.map((name) => {
            const tool = c.tools.find((x) => x.name === name)
            const own = c.toolPolicy[name]
            const blocked = toolPolicy(c, name) === 'block'
            return (
              <Row key={name} label={<span className="font-mono text-[12px]">{name}</span>} desc={tool?.description || (tool ? undefined : t('connectors.tools.notSeen'))}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${blocked ? 'bg-danger' : 'bg-transparent'}`} data-tip={blocked ? t('connectors.tools.blocked') : undefined} />
                <Select<ToolPolicy | 'default'>
                  label={t('connectors.tools.levelOf', { name })}
                  value={own ?? 'default'}
                  onChange={(v) => {
                    const toolPolicyNext = { ...c.toolPolicy }
                    if (v === 'default') delete toolPolicyNext[name]
                    else toolPolicyNext[name] = v
                    save({ toolPolicy: toolPolicyNext })
                  }}
                  options={[
                    { value: 'default', label: c.approval === 'allow' ? t('connectors.policy.defaultAllow') : t('connectors.policy.defaultAsk') },
                    { value: 'allow', label: t('connectors.policy.allow') },
                    { value: 'ask', label: t('connectors.policy.ask') },
                    { value: 'block', label: t('connectors.policy.block') }
                  ]}
                />
              </Row>
            )
          })
        )}
      </Group>

      <Group title={t('connectors.remove.group')}>
        <Row
          label={t('connectors.remove.label')}
          desc={t('connectors.remove.desc')}
          sub={confirmRemove ? t('connectors.remove.confirm') : undefined}
        >
          <SmallButton
            variant={confirmRemove ? 'dangerSolid' : 'danger'}
            onClick={() => {
              if (!confirmRemove) return setConfirmRemove(true)
              run(window.stag.connectors.remove(c.id).then(onBack))
            }}
          >
            {confirmRemove ? t('connectors.remove.really') : t('connectors.remove.label')}
          </SmallButton>
        </Row>
      </Group>
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
      className={`${wide ? 'w-80' : 'w-56'} ${mono ? INPUT_MONO : INPUT}`}
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
  const t = useT()
  const missing = value && !items.some((x) => x.name === value)
  if (creating) return <NewSecret suggest={suggest} onDone={(n) => (setCreating(false), n && onChange(n))} />
  return (
    <Select
      label={t('connectors.secretPicker.label')}
      value={value}
      onChange={(v) => (v === '+new' ? setCreating(true) : onChange(v))}
      options={[
        ...(allowNone ? [{ value: '', label: t('connectors.secretPicker.none') }] : []),
        ...(missing ? [{ value, label: t('connectors.secretPicker.missing', { name: value }) }] : []),
        // Bí mật đăng nhập OAuth (khối JSON có refresh token) không dùng làm bí mật thường: chỉ connector OAuth của nó dùng.
        ...items.filter((x) => !x.name.startsWith(OAUTH_SECRET_PREFIX) || x.name === value).map((x) => ({ value: x.name, label: x.name })),
        { value: '+new', label: t('connectors.secretPicker.new'), disabled: !available }
      ]}
    />
  )
}

function NewSecret({ suggest, onDone }: { suggest: string; onDone: (name: string | null) => void }): React.JSX.Element {
  const [name, setName] = useState(suggest)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const t = useT()
  const ok = SECRET_NAME_RE.test(name) && value !== ''
  const submit = (): void => {
    if (!ok) return
    window.stag.secrets
      .set(name, value)
      .then(() => onDone(name))
      .catch((e) => setError(errText(e)))
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <input aria-label={t('connectors.secretPicker.newName')} value={name} onChange={(e) => setName(e.target.value)} className={`${INPUT_MONO} w-40`} spellCheck={false} />
        <input
          aria-label={t('connectors.secretPicker.newValue')}
          type="password"
          autoFocus
          value={value}
          placeholder={t('connectors.secretPicker.valuePlaceholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onDone(null)
          }}
          className={`${INPUT_MONO} w-40`}
        />
        <SmallButton onClick={submit} disabled={!ok}>
          {t('common.save')}
        </SmallButton>
        <SmallButton onClick={() => onDone(null)}>{t('common.cancel')}</SmallButton>
      </div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
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
  const t = useT()
  const valuesJson = JSON.stringify(values)
  useEffect(() => setRows(toRows(values)), [valuesJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: ValueRow[]): void => {
    const filled = next.filter((r) => r.key.trim() || r.value)
    const out: Record<string, ConnectorValue> = {}
    for (const r of filled) {
      const k = r.key.trim()
      if (!keyRe.test(k)) return setProblem(k ? t('connectors.values.badName', { name: k }) : t('connectors.values.emptyName'))
      if (k in out) return setProblem(t('connectors.values.duplicate', { name: k }))
      if (r.kind === 'secret' && !r.value) return setProblem(t('connectors.values.pickSecret', { name: k }))
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

  return (
    <Group title={title}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 border-b border-line py-2">
          <input
            aria-label={t('connectors.values.nameN', { n: i + 1 })}
            value={r.key}
            placeholder={keyLabel}
            spellCheck={false}
            onChange={(e) => update(i, { key: e.target.value })}
            onBlur={() => commit(rows)}
            className={`${INPUT_MONO} w-48`}
          />
          <Select
            label={t('connectors.values.kindN', { n: i + 1 })}
            value={r.kind}
            onChange={(kind) => update(i, { kind, value: '' }, kind === 'value')}
            options={[
              { value: 'value', label: t('connectors.values.text') },
              { value: 'secret', label: t('connectors.values.secret') }
            ]}
          />
          <div className="flex min-w-0 flex-1 justify-end">
            {r.kind === 'secret' ? (
              <SecretPicker value={r.value} suggest={suggest(r.key || 'KEY')} onChange={(v) => update(i, { value: v }, true)} />
            ) : (
              <input
                aria-label={t('connectors.values.valueN', { n: i + 1 })}
                value={r.value}
                spellCheck={false}
                onChange={(e) => update(i, { value: e.target.value })}
                onBlur={() => commit(rows)}
                className={`${INPUT_MONO} w-full`}
              />
            )}
          </div>
          <button
            type="button"
            aria-label={t('connectors.values.removeN', { n: i + 1 })}
            data-tip={t('connectors.values.remove')}
            onClick={() => {
              const next = rows.filter((_, j) => j !== i)
              setRows(next)
              commit(next)
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-danger"
          >
            <Icon name="x" size="s" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3 py-2">
        <SmallButton icon="plus" onClick={() => setRows([...rows, { key: '', kind: 'value', value: '' }])}>
          {t('connectors.values.addRow')}
        </SmallButton>
        {problem ? (
          <span className="text-[12px] text-danger">{problem}</span>
        ) : (
          <span className="text-[12px] text-dim">{t('connectors.values.hint')}</span>
        )}
      </div>
    </Group>
  )
}

// ---- thêm connector ----

function importSummary(r: ConnectorImport): string {
  const parts: string[] = []
  if (r.connectors.length) parts.push(t('connectors.summary.added', { ids: r.connectors.map((c) => c.id).join(', ') }))
  if (r.secrets.length) parts.push(t('connectors.summary.secrets', { count: r.secrets.length, names: r.secrets.join(', ') }))
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
  const t = useT()

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
          setError(r.errors.join('\n') || t('connectors.add.nothing'))
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

  const field = `${INPUT_MONO} w-full`
  const hint = 'mt-1.5 text-[12px] leading-relaxed text-dim'

  return (
    <Modal
      title={t('connectors.add.title')}
      width="w-[560px]"
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <Button primary onClick={() => onCreated(result.connectors.length === 1 ? result.connectors[0].id : null)}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button primary onClick={create} disabled={busy || !ready}>
              {busy ? t('connectors.add.adding') : t('common.add')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="text-[12px] leading-relaxed">{importSummary(result)}</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <p className="mb-3 text-[12px] leading-relaxed text-dim">
            {lv.lvl === 'app' ? t('connectors.add.introApp') : t('connectors.add.introLevel', { level: lv.name })} {t('connectors.add.introTest')}
          </p>
          <Seg
            className="mb-4 self-start"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'custom', label: t('connectors.add.custom') },
              { value: 'json', label: t('connectors.add.json') }
            ]}
          />
          {tab === 'custom' && (
            <>
              <label className="mb-1 block text-[12px] font-medium" htmlFor="conn-new-name">
                {t('connectors.add.name')}
              </label>
              <input id="conn-new-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Linear" className={`${INPUT} w-full`} />
              {name && <p className={hint}>{t('connectors.add.idPreview', { id: freeId(slugify(name)) })}</p>}
              <div className="mt-3 mb-1.5 flex gap-4">
                {(['stdio', 'http'] as const).map((tp) => (
                  <label key={tp} className="flex items-center gap-1.5 text-[13px]">
                    <input type="radio" className="accent-accent" checked={transport === tp} onChange={() => setTransport(tp)} />
                    {tp === 'stdio' ? t('connectors.add.stdio') : t('connectors.add.http')}
                  </label>
                ))}
              </div>
              <input
                aria-label={transport === 'stdio' ? t('connectors.add.commandLabel') : t('connectors.add.urlLabel')}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={transport === 'stdio' ? 'npx -y @modelcontextprotocol/server-memory' : 'https://mcp.example.com/mcp'}
                spellCheck={false}
                className={field}
              />
              <p className={hint}>{t('connectors.add.later')}</p>
            </>
          )}
          {tab === 'json' && (
            <>
              <textarea
                aria-label={t('connectors.add.jsonLabel')}
                autoFocus
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={10}
                spellCheck={false}
                placeholder={'{\n  "mcpServers": {\n    "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }\n  }\n}'}
                className={`${TEXTAREA} w-full`}
              />
              <p className={hint}>{tx('connectors.add.jsonHint', { mcpServers: <code>mcpServers</code>, servers: <code>servers</code> })}</p>
            </>
          )}
          {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">{error}</div>}
        </form>
      )}
    </Modal>
  )
}
