import { useEffect, useState, type ReactNode } from 'react'
import { agentKind, type AdapterId, type AgentKind, type CliAdapterId, type ExternalAdapterStatus, type InstalledAdapter } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useExternalAdapters } from '../../store/externalAdapters'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { Button, Modal } from '../Modal'
import { Seg } from '../ui/Seg'
import { AdvancedFields, CliDetail, LABEL, ModelInput, shortVersion, TerminalDetail, type StatusMap } from './AdapterDetails'
import { fmtDateTime, tx, useT } from '../../i18n'
import {
  Badge,
  Callout,
  DetailHead,
  Empty,
  ErrorBar,
  Group,
  INPUT_MONO,
  Row,
  SectionTitle,
  SmallButton,
  Switch,
  Tile,
  Tiles,
  useSaveError,
  type Tone
} from './controls'
import { LevelBar } from './levels'

/**
 * Settings → Adapter, bố cục theo trang Adapters của Paperclip: nhãn Alpha + nút "Cài adapter", băng cảnh
 * báo, mục "Adapter ngoài" (gói người dùng cài) và "Adapter có sẵn"; công tắc ẩn / hiện adapter trong hộp
 * Thêm agent. Bấm một thẻ để mở trang chi tiết.
 */

type View = { type: 'list' } | { type: 'builtin'; id: AdapterId } | { type: 'external'; id: string }

export type { Tone }
export { Badge }
export const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Logo 30px của adapter: cùng màu / chữ với ô nhận diện loại agent ở thanh bên (CC, CX, `>_`, 2 chữ đầu). */
const LOGO: Record<AgentKind, string> = {
  claude: 'bg-[#c96442] text-white',
  codex: 'bg-[#4a515a] text-white',
  external: 'bg-[#2f6fd0] text-white',
  terminal: 'bg-panel-3 font-mono text-muted shadow-[inset_0_0_0_1px_var(--color-line-3)]'
}
function AdapterLogo({ kind, label, size = 30 }: { kind: AgentKind; label?: string; size?: number }): React.JSX.Element {
  const text = kind === 'claude' ? 'CC' : kind === 'codex' ? 'CX' : kind === 'terminal' ? '>_' : (label ?? 'ai').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || 'ai'
  return (
    <span aria-hidden className={`inline-grid shrink-0 place-items-center rounded-[7px] text-[13px] font-bold ${LOGO[kind]}`} style={{ width: size, height: size }}>
      {text}
    </span>
  )
}

export function AdaptersSection(): React.JSX.Element {
  const focus = useUi((s) => s.settingsFocus)
  const initial: View = focus?.external ? { type: 'external', id: focus.external } : focus?.adapter ? { type: 'builtin', id: focus.adapter } : { type: 'list' }
  const [view, setView] = useState<View>(initial)
  const [status, setStatus] = useState<StatusMap>({})
  const [installing, setInstalling] = useState(false)
  const t = useT()

  const check = (id: CliAdapterId): void => {
    setStatus((s) => ({ ...s, [id]: 'loading' }))
    window.stag.settings
      .checkAdapter(id)
      .then((r) => setStatus((s) => ({ ...s, [id]: r })))
      .catch((e) =>
        setStatus((s) => ({
          ...s,
          [id]: {
            id,
            path: null,
            source: 'auto',
            version: null,
            login: { state: 'unknown', detail: '' },
            configModel: null,
            models: [],
            error: errText(e),
            checkedAt: new Date().toISOString()
          }
        }))
      )
  }

  useEffect(() => {
    check('claude')
    check('codex')
  }, [])
  useEffect(() => {
    if (focus?.external) setView({ type: 'external', id: focus.external })
    else if (focus?.adapter) setView({ type: 'builtin', id: focus.adapter })
  }, [focus])

  const back = (): void => setView({ type: 'list' })

  return (
    <>
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            Adapter
            <Badge>Alpha</Badge>
          </span>
        }
        right={
          <>
            {view.type === 'list' && (
              <SmallButton variant="primary" icon="plus" onClick={() => setInstalling(true)}>
                {t('adapters.install')}
              </SmallButton>
            )}
            <LevelBar appOnly />
          </>
        }
      />
      {view.type === 'list' && <AdapterList status={status} open={setView} />}
      {view.type === 'builtin' && (
        <DetailFrame
          onBack={back}
          kind={view.id}
          title={LABEL[view.id]}
          badge={<Badge>{t('adapters.builtinBadge')}</Badge>}
          power={<BuiltinPower id={view.id} />}
        >
          {view.id === 'terminal' ? (
            <TerminalDetail />
          ) : (
            <CliDetail key={view.id} id={view.id} status={status[view.id]} recheck={() => check(view.id as CliAdapterId)} focusAgentId={focus?.agentId} />
          )}
        </DetailFrame>
      )}
      {view.type === 'external' && <ExternalDetail id={view.id} onBack={back} />}
      {installing && (
        <InstallAdapterDialog
          onClose={() => setInstalling(false)}
          onInstalled={(a) => {
            setInstalling(false)
            setView({ type: 'external', id: a.manifest.id })
          }}
        />
      )}
    </>
  )
}

function AdapterList({ status, open }: { status: StatusMap; open: (v: View) => void }): React.JSX.Element {
  const external = useExternalAdapters((s) => s.items)
  const loaded = useExternalAdapters((s) => s.loaded)
  const adapters = useSettings((s) => s.value.app.adapters)
  const shell = adapters.terminal.shell
  const t = useT()

  const cliLine = (id: CliAdapterId): string => {
    const st = status[id]
    const parts: string[] = []
    if (!st || st === 'loading') parts.push(t('adapters.list.checking'))
    else if (st.error) parts.push(st.path ? t('adapters.list.runError') : t('adapters.list.notFound'))
    else {
      parts.push(shortVersion(st.version), t('adapters.modelCount', { count: st.models.length }))
      parts.push(st.login.state === 'in' ? t('adapters.list.signedIn') : st.login.state === 'out' ? t('adapters.list.signedOut') : t('adapters.list.signInUnknown'))
    }
    return parts.join(' · ')
  }
  const cliTone = (id: CliAdapterId): Tone => {
    const st = status[id]
    if (!st || st === 'loading') return 'muted'
    if (st.error) return 'bad'
    return st.login.state === 'in' ? 'ok' : 'warn'
  }

  return (
    <>
      <Callout icon="shield" className="mt-2">
        <span className="font-medium text-fg">{t('adapters.list.alphaTitle')}</span> {t('adapters.list.alphaDesc')}
      </Callout>

      <Group title={t('adapters.list.external')}>
        {external.length === 0 ? (
          <Empty title={loaded ? t('adapters.list.externalEmpty') : t('common.loading')}>{t('adapters.list.externalEmptyDesc')}</Empty>
        ) : (
          <Tiles>
            {external.map((a) => (
              <AdapterTileCard
                key={a.manifest.id}
                logo={<AdapterLogo kind="external" label={a.manifest.label} />}
                title={a.manifest.label}
                badge={<Badge>{a.source.type === 'npm' ? 'npm' : t('adapters.folderBadge')}</Badge>}
                line={[a.manifest.id, `v${a.version}`, t('adapters.modelCount', { count: a.manifest.models.length })].join(' · ')}
                tone="muted"
                enabled={a.enabled}
                onToggle={(enabled) => void window.stag.externalAdapters.update(a.manifest.id, { enabled })}
                onOpen={() => open({ type: 'external', id: a.manifest.id })}
              />
            ))}
          </Tiles>
        )}
      </Group>

      <Group title={t('adapters.list.builtin')}>
        <Tiles>
          {(['claude', 'codex'] as const).map((id) => (
            <AdapterTileCard
              key={id}
              logo={<AdapterLogo kind={id} />}
              title={LABEL[id]}
              badge={<Badge>{t('adapters.builtinBadge')}</Badge>}
              line={cliLine(id)}
              tone={cliTone(id)}
              enabled={adapters[id].enabled}
              onToggle={(enabled) => void useSettings.getState().save({ adapters: { [id]: { enabled } } })}
              onOpen={() => open({ type: 'builtin', id })}
            />
          ))}
          <AdapterTileCard
            logo={<AdapterLogo kind="terminal" />}
            title="Terminal"
            badge={<Badge>{t('adapters.builtinBadge')}</Badge>}
            line={{ powershell: 'Windows PowerShell', pwsh: 'PowerShell 7', gitbash: 'Git Bash', cmd: 'cmd' }[shell]}
            tone="ok"
            enabled={adapters.terminal.enabled}
            onToggle={(enabled) => void useSettings.getState().save({ adapters: { terminal: { enabled } } })}
            onOpen={() => open({ type: 'builtin', id: 'terminal' })}
          />
        </Tiles>
      </Group>
    </>
  )
}

/** Thẻ adapter: logo, tên, nhãn nguồn, một dòng trạng thái, công tắc hiện / ẩn trong hộp Thêm agent. */
function AdapterTileCard({
  logo,
  title,
  badge,
  line,
  tone,
  enabled,
  onToggle,
  onOpen
}: {
  logo: ReactNode
  title: string
  badge: ReactNode
  line: string
  tone: Tone
  enabled: boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <Tile
      logo={logo}
      title={title}
      badge={badge}
      dot={tone}
      sub={line}
      tip={enabled ? line : `${line} · ${t('adapters.power.hiddenSuffix')}`}
      dim={!enabled}
      onOpen={onOpen}
      control={<PowerButton label={title} enabled={enabled} onToggle={onToggle} />}
    />
  )
}

/** Công tắc hiện / ẩn một adapter trong hộp Thêm agent. */
export function PowerButton({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: (v: boolean) => void }): React.JSX.Element {
  const t = useT()
  return (
    <span data-tip={enabled ? t('adapters.power.shownTip') : t('adapters.power.hiddenTip')} className="inline-flex">
      <Switch label={enabled ? t('adapters.power.hide', { name: label }) : t('adapters.power.show', { name: label })} checked={enabled} onChange={onToggle} />
    </span>
  )
}

function BuiltinPower({ id }: { id: AdapterId }): React.JSX.Element {
  const enabled = useSettings((s) => s.value.app.adapters[id].enabled)
  return <PowerButton label={LABEL[id]} enabled={enabled} onToggle={(v) => void useSettings.getState().save({ adapters: { [id]: { enabled: v } } })} />
}

function DetailFrame({
  kind,
  title,
  badge,
  power,
  sub,
  onBack,
  children
}: {
  kind: AgentKind
  title: string
  badge: ReactNode
  power?: ReactNode
  sub?: ReactNode
  onBack: () => void
  children: ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="mt-2">
      <DetailHead
        onBack={onBack}
        backLabel={t('adapters.detail.back')}
        logo={<AdapterLogo kind={kind} label={title} />}
        title={title}
        badge={badge}
        control={power}
        sub={sub ?? t('adapters.detail.sub')}
      />
      {children}
    </div>
  )
}

function ExternalDetail({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const a = useExternalAdapters((s) => s.items.find((x) => x.manifest.id === id))
  const loaded = useExternalAdapters((s) => s.loaded)
  // Chọn byWs (giữ nguyên tham chiếu) rồi mới lọc: chọn thẳng một mảng mới mỗi lần sẽ làm zustand render vô hạn.
  const byWs = useAgents((s) => s.byWs)
  const users = Object.values(byWs).flatMap((w) => w.agents.filter((x) => agentKind(x) === 'external' && x.adapterId === id))
  const [status, setStatus] = useState<ExternalAdapterStatus | 'loading' | null>(null)
  const [error, run] = useSaveError()
  const [busy, setBusy] = useState<'reinstall' | 'remove' | null>(null)
  const t = useT()

  // Mở trang: chỉ tìm file chạy. Bấm "Kiểm tra lại": chạy cả lệnh lấy phiên bản (mã của gói).
  const check = (runVersion = false): void => {
    setStatus('loading')
    window.stag.externalAdapters
      .check(id, runVersion)
      .then(setStatus)
      .catch((e) => setStatus({ id, path: null, version: null, error: errText(e), checkedAt: new Date().toISOString() }))
  }
  useEffect(() => check(), [id, a?.installedAt])

  if (!a) {
    return (
      <DetailFrame onBack={onBack} kind="external" title={id} badge={<Badge>{t('adapters.list.external')}</Badge>} sub={loaded ? t('adapters.ext.removed') : t('common.loading')}>
        {null}
      </DetailFrame>
    )
  }
  const m = a.manifest
  const st = status && status !== 'loading' ? status : null
  const update = (patch: Parameters<typeof window.stag.externalAdapters.update>[1]): Promise<unknown> => window.stag.externalAdapters.update(id, patch)

  async function reinstall(): Promise<void> {
    setBusy('reinstall')
    run(
      window.stag.externalAdapters
        .install(a!.source.type === 'npm' ? { type: 'npm', name: a!.source.name, version: a!.source.version } : { type: 'local', path: a!.source.path })
        .finally(() => setBusy(null))
    )
  }

  async function remove(): Promise<void> {
    const extra = users.length ? `\n\n${t('adapters.ext.removeUsers', { count: users.length, names: users.map((u) => u.name).join(', ') })}` : ''
    const what = a!.source.type === 'npm' ? t('adapters.ext.removeNpm') : t('adapters.ext.removeLocal')
    if (!window.confirm(`${t('adapters.ext.removeAsk', { name: m.label })}\n\n${what}${extra}`)) return
    setBusy('remove')
    try {
      await window.stag.externalAdapters.remove(id)
      onBack()
    } catch (e) {
      run(Promise.reject(e))
      setBusy(null)
    }
  }

  const caps: Array<[string, string]> = [
    [t('adapters.feature.rules'), m.rules ? ('flag' in m.rules ? `✓ ${m.rules.flag} <file>` : `✓ ${t('adapters.ext.envVar', { name: m.rules.env })}`) : '—'],
    [t('adapters.feature.mcp'), m.mcpConfigFlag ? `✓ ${m.mcpConfigFlag}` : '—'],
    [t('adapters.feature.prompt'), m.prompt ? ('flag' in m.prompt ? `✓ ${m.prompt.flag}` : `✓ ${t('adapters.ext.lastArg')}`) : '—'],
    [t('adapters.feature.model'), m.modelFlag ? `✓ ${m.modelFlag}` : '—'],
    [t('adapters.feature.hooks'), '—'],
    [t('adapters.feature.resume'), '—'],
    [t('adapters.feature.context'), '—'],
    [t('adapters.feature.scope'), '—']
  ]
  const mono = 'break-all font-mono text-[11px]'

  return (
    <DetailFrame
      onBack={onBack}
      kind="external"
      title={m.label}
      badge={<Badge>{a.source.type === 'npm' ? 'npm' : t('adapters.folderBadge')}</Badge>}
      power={<PowerButton label={m.label} enabled={a.enabled} onToggle={(enabled) => run(update({ enabled }))} />}
      sub={m.description || undefined}
    >
      <ErrorBar error={error} />
      <Group title={t('adapters.ext.package')}>
        <Row
          label={t('adapters.ext.source')}
          sub={<span className={mono}>{a.source.type === 'npm' ? `${a.source.name}@${a.source.version}` : a.source.path}</span>}
        >
          <SmallButton icon="folder" onClick={() => void window.stag.openFolder(a.dir)}>
            {t('adapters.ext.openFolder')}
          </SmallButton>
        </Row>
        <Row label={t('adapters.ext.version')} sub={t('adapters.ext.versionSub', { version: a.version, id: m.id, time: fmtDateTime(a.installedAt) })}>
          <SmallButton onClick={reinstall} disabled={!!busy}>
            {busy === 'reinstall' ? t('adapters.ext.installing') : a.source.type === 'npm' ? t('adapters.ext.reinstall') : t('adapters.ext.reload')}
          </SmallButton>
        </Row>
        {m.homepage && <Row label={t('adapters.ext.homepage')} sub={<span className={mono}>{m.homepage}</span>} />}
      </Group>

      <Group title={t('adapters.detail.thisComputer')}>
        <Row
          label={t('adapters.ext.program')}
          sub={st?.error ? <span className="text-danger">{st.error}</span> : st?.path ? <span className={mono}>{st.path}</span> : t('adapters.detail.searching')}
        />
        <Row label={t('adapters.detail.version')} sub={st?.version ?? (status === 'loading' ? t('adapters.detail.checking') : '—')}>
          <SmallButton onClick={() => check(true)} disabled={status === 'loading'}>
            {status === 'loading' ? t('adapters.detail.checking') : t('adapters.detail.recheck')}
          </SmallButton>
        </Row>
        <Row
          label={t('adapters.ext.command')}
          sub={
            <span className={mono}>
              {[m.command, ...m.args, m.modelFlag && a.model ? `${m.modelFlag} ${a.model}` : '', m.rules && 'flag' in m.rules ? `${m.rules.flag} ${t('adapters.ext.cmdRules')}` : '', m.mcpConfigFlag ? `${m.mcpConfigFlag} <mcp stag>` : '', a.extraArgs, m.prompt ? ('flag' in m.prompt ? `${m.prompt.flag} "${t('adapters.ext.cmdPrompt')}"` : `"${t('adapters.ext.cmdPrompt')}"`) : '']
                .filter(Boolean)
                .join(' ')}
            </span>
          }
        />
      </Group>

      <Group title={t('adapters.detail.newAgents')}>
        <Row label={t('adapters.detail.showInAdd')} desc={t('adapters.ext.showInAddDesc')} sub={t('adapters.ext.usersCount', { count: users.length })}>
          <Switch label={t('adapters.detail.showLabel', { name: m.label })} checked={a.enabled} onChange={(enabled) => run(update({ enabled }))} />
        </Row>
        {m.modelFlag && (
          <Row label="Model" desc={t('adapters.ext.modelDesc', { name: m.label })}>
            <ModelInput
              key={a.model}
              name={m.label}
              listId={`models-ext-${m.id}`}
              value={a.model}
              suggestions={m.models.map((x) => ({ value: x.id, label: x.label }))}
              onCommit={(model) => run(update({ model }))}
            />
          </Row>
        )}
      </Group>

      <AdvancedFields
        fieldId={`ext-${m.id}`}
        name={m.label}
        extraArgs={a.extraArgs}
        env={a.env}
        argsExample=""
        envExample={t('adapters.adv.envExample')}
        storedIn="adapters/registry.json"
        onSave={(patch) => update(patch)}
      />

      <Group title={t('adapters.detail.features')}>
        {caps.map(([label, v]) => (
          <Row key={label} label={<span className="font-normal">{label}</span>}>
            <span className={`font-mono text-[12px] ${v.startsWith('✓') ? 'text-work' : 'text-dim'}`}>{v}</span>
          </Row>
        ))}
      </Group>

      <Group title={t('adapters.ext.removeGroup')}>
        <Row
          label={t('adapters.ext.remove')}
          desc={a.source.type === 'npm' ? t('adapters.ext.removeNpmDesc') : t('adapters.ext.removeLocalDesc')}
        >
          <SmallButton variant="danger" onClick={remove} disabled={!!busy}>
            {busy === 'remove' ? t('adapters.ext.removing') : t('adapters.ext.remove')}
          </SmallButton>
        </Row>
      </Group>
    </DetailFrame>
  )
}

/** Hộp "Cài adapter ngoài": gói npm (tên + phiên bản) hoặc thư mục trên máy. */
function InstallAdapterDialog({ onClose, onInstalled }: { onClose: () => void; onInstalled: (a: InstalledAdapter) => void }): React.JSX.Element {
  const [tab, setTab] = useState<'npm' | 'local'>('npm')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = useT()
  const ready = tab === 'npm' ? name.trim() !== '' : path.trim() !== ''

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

  async function install(): Promise<void> {
    if (!ready || busy) return
    setBusy(true)
    setError('')
    try {
      const a = await window.stag.externalAdapters.install(
        tab === 'npm' ? { type: 'npm', name: name.trim(), version: version.trim() || undefined } : { type: 'local', path: path.trim() }
      )
      onInstalled(a)
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  async function choose(): Promise<void> {
    const dir = await window.stag.pickFolder(t('adapters.installDialog.pick'), path || undefined)
    if (dir) setPath(dir)
  }

  const field = `${INPUT_MONO} w-full`
  const label = 'mb-1 block text-[12px] font-medium'
  const hint = 'mt-1.5 text-[12px] leading-relaxed text-dim'

  return (
    <Modal
      title={t('adapters.installDialog.title')}
      width="w-[480px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button primary onClick={install} disabled={busy || !ready}>
            {busy ? (tab === 'npm' ? t('adapters.installDialog.runningNpm') : t('adapters.installDialog.reading')) : t('common.install')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void install()
        }}
      >
        <p className="mb-3 text-[12px] leading-relaxed text-dim">
          {tx('adapters.installDialog.intro', { field: <code>stagAdapter</code>, docs: <code>docs/adapters.md</code> })}
        </p>
        <Seg
          className="mb-4 self-start"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'npm',
              label: (
                <>
                  <Icon name="hex" size="s" />
                  {t('adapters.installDialog.npm')}
                </>
              )
            },
            {
              value: 'local',
              label: (
                <>
                  <Icon name="folder" size="s" />
                  {t('adapters.folderBadge')}
                </>
              )
            }
          ]}
        />
        {tab === 'npm' ? (
          <>
            <label className={label} htmlFor="adapter-npm-name">
              {t('adapters.installDialog.name')}
            </label>
            <input id="adapter-npm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="stag-adapter-aider" spellCheck={false} className={field} />
            <label className={`${label} mt-3`} htmlFor="adapter-npm-version">
              {t('adapters.installDialog.version')}
            </label>
            <input id="adapter-npm-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" spellCheck={false} className={field} />
            <p className={hint}>{tx('adapters.installDialog.npmHint', { command: <code>npm install --ignore-scripts</code> })}</p>
          </>
        ) : (
          <>
            <label className={label} htmlFor="adapter-local-path">
              {t('adapters.installDialog.path')}
            </label>
            <div className="flex gap-2">
              <input id="adapter-local-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\code\stag-adapter-aider" spellCheck={false} className={field} />
              <SmallButton icon="folder" size="md" onClick={choose}>
                {t('adapters.installDialog.choose')}
              </SmallButton>
            </div>
            <p className={hint}>{t('adapters.installDialog.localHint')}</p>
          </>
        )}
        <Callout icon="shield" className="mt-4">
          {t('adapters.installDialog.warning')}
        </Callout>
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">{error}</div>}
      </form>
    </Modal>
  )
}
