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
                Cài adapter
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
          badge={<Badge>Có sẵn</Badge>}
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

  const cliLine = (id: CliAdapterId): string => {
    const st = status[id]
    const parts: string[] = []
    if (!st || st === 'loading') parts.push('đang kiểm tra…')
    else if (st.error) parts.push(st.path ? 'lỗi khi chạy' : 'không tìm thấy')
    else {
      parts.push(shortVersion(st.version), `${st.models.length} model`)
      parts.push(st.login.state === 'in' ? 'đã đăng nhập' : st.login.state === 'out' ? 'chưa đăng nhập' : 'không rõ đăng nhập')
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
        <span className="font-medium text-fg">Adapter ngoài đang ở bản thử (alpha).</span> Cách đóng gói adapter còn có thể đổi. Adapter chạy chương trình trên máy
        bạn, nên chỉ cài từ nguồn bạn tin. Công tắc ẩn một adapter khỏi hộp Thêm agent mà không gỡ nó.
      </Callout>

      <Group title="Adapter ngoài">
        {external.length === 0 ? (
          <Empty title={loaded ? 'Chưa cài adapter ngoài nào' : 'Đang tải…'}>
            Cài một gói adapter để chạy thêm CLI AI khác (vd. Aider) như một agent trong lưới.
          </Empty>
        ) : (
          <Tiles>
            {external.map((a) => (
              <AdapterTileCard
                key={a.manifest.id}
                logo={<AdapterLogo kind="external" label={a.manifest.label} />}
                title={a.manifest.label}
                badge={<Badge>{a.source.type === 'npm' ? 'npm' : 'Thư mục'}</Badge>}
                line={[a.manifest.id, `v${a.version}`, `${a.manifest.models.length} model`].join(' · ')}
                tone="muted"
                enabled={a.enabled}
                onToggle={(enabled) => void window.stag.externalAdapters.update(a.manifest.id, { enabled })}
                onOpen={() => open({ type: 'external', id: a.manifest.id })}
              />
            ))}
          </Tiles>
        )}
      </Group>

      <Group title="Adapter có sẵn">
        <Tiles>
          {(['claude', 'codex'] as const).map((id) => (
            <AdapterTileCard
              key={id}
              logo={<AdapterLogo kind={id} />}
              title={LABEL[id]}
              badge={<Badge>Có sẵn</Badge>}
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
            badge={<Badge>Có sẵn</Badge>}
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
  return (
    <Tile
      logo={logo}
      title={title}
      badge={badge}
      dot={tone}
      sub={line}
      tip={enabled ? line : `${line} · đang ẩn khỏi hộp Thêm agent`}
      dim={!enabled}
      onOpen={onOpen}
      control={<PowerButton label={title} enabled={enabled} onToggle={onToggle} />}
    />
  )
}

/** Công tắc hiện / ẩn một adapter trong hộp Thêm agent. */
export function PowerButton({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: (v: boolean) => void }): React.JSX.Element {
  return (
    <span data-tip={enabled ? 'Đang hiện trong hộp Thêm agent — bấm để ẩn' : 'Đang ẩn — bấm để hiện trong hộp Thêm agent'} className="inline-flex">
      <Switch label={enabled ? `Ẩn ${label} khỏi hộp Thêm agent` : `Hiện ${label} trong hộp Thêm agent`} checked={enabled} onChange={onToggle} />
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
  return (
    <div className="mt-2">
      <DetailHead
        onBack={onBack}
        backLabel="Tất cả adapter"
        logo={<AdapterLogo kind={kind} label={title} />}
        title={title}
        badge={badge}
        control={power}
        sub={sub ?? 'Thay đổi áp dụng cho phiên mở sau; phiên đang chạy giữ nguyên. Kiểm tra CLI không gọi model, không tốn quota.'}
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
      <DetailFrame onBack={onBack} kind="external" title={id} badge={<Badge>Adapter ngoài</Badge>} sub={loaded ? 'Adapter này đã bị gỡ.' : 'Đang tải…'}>
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
    const extra = users.length ? `\n\n${users.length} agent đang dùng adapter này (${users.map((u) => u.name).join(', ')}) sẽ không mở phiên được nữa cho tới khi bạn cài lại.` : ''
    const what = a!.source.type === 'npm' ? 'Gói npm sẽ bị gỡ khỏi thư mục adapter của app.' : 'Thư mục của bạn được giữ nguyên, chỉ bỏ khỏi danh sách.'
    if (!window.confirm(`Gỡ adapter "${m.label}"?\n\n${what}${extra}`)) return
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
    ['Luật phiên + bộ nhớ vault', m.rules ? ('flag' in m.rules ? `✓ ${m.rules.flag} <file>` : `✓ biến ${m.rules.env}`) : '—'],
    ['MCP stag (kanban, trình duyệt, bàn giao)', m.mcpConfigFlag ? `✓ ${m.mcpConfigFlag}` : '—'],
    ['Lời mở phiên', m.prompt ? ('flag' in m.prompt ? `✓ ${m.prompt.flag}` : '✓ tham số cuối') : '—'],
    ['Chọn model', m.modelFlag ? `✓ ${m.modelFlag}` : '—'],
    ['Trạng thái qua hook (đang làm / chờ bạn)', '—'],
    ['Tiếp tục phiên trước', '—'],
    ['% context + tự bàn giao', '—'],
    ['Khoá phạm vi', '—']
  ]
  const mono = 'break-all font-mono text-[11px]'

  return (
    <DetailFrame
      onBack={onBack}
      kind="external"
      title={m.label}
      badge={<Badge>{a.source.type === 'npm' ? 'npm' : 'Thư mục'}</Badge>}
      power={<PowerButton label={m.label} enabled={a.enabled} onToggle={(enabled) => run(update({ enabled }))} />}
      sub={m.description || undefined}
    >
      <ErrorBar error={error} />
      <Group title="Gói">
        <Row
          label="Nguồn"
          sub={<span className={mono}>{a.source.type === 'npm' ? `${a.source.name}@${a.source.version}` : a.source.path}</span>}
        >
          <SmallButton icon="folder" onClick={() => void window.stag.openFolder(a.dir)}>
            Mở thư mục
          </SmallButton>
        </Row>
        <Row label="Phiên bản gói" sub={`${a.version} · id ${m.id} · cài lúc ${new Date(a.installedAt).toLocaleString('vi-VN')}`}>
          <SmallButton onClick={reinstall} disabled={!!busy}>
            {busy === 'reinstall' ? 'Đang cài…' : a.source.type === 'npm' ? 'Cài lại / cập nhật' : 'Đọc lại gói'}
          </SmallButton>
        </Row>
        {m.homepage && <Row label="Trang chủ" sub={<span className={mono}>{m.homepage}</span>} />}
      </Group>

      <Group title="Trên máy này">
        <Row
          label="Chương trình"
          sub={st?.error ? <span className="text-danger">{st.error}</span> : st?.path ? <span className={mono}>{st.path}</span> : 'Đang tìm…'}
        />
        <Row label="Phiên bản" sub={st?.version ?? (status === 'loading' ? 'Đang kiểm tra…' : '—')}>
          <SmallButton onClick={() => check(true)} disabled={status === 'loading'}>
            {status === 'loading' ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </SmallButton>
        </Row>
        <Row
          label="Lệnh mỗi phiên"
          sub={
            <span className={mono}>
              {[m.command, ...m.args, m.modelFlag && a.model ? `${m.modelFlag} ${a.model}` : '', m.rules && 'flag' in m.rules ? `${m.rules.flag} <luật phiên>` : '', m.mcpConfigFlag ? `${m.mcpConfigFlag} <mcp stag>` : '', a.extraArgs, m.prompt ? ('flag' in m.prompt ? `${m.prompt.flag} "<lời mở>"` : '"<lời mở>"') : '']
                .filter(Boolean)
                .join(' ')}
            </span>
          }
        />
      </Group>

      <Group title="Agent mới">
        <Row label='Hiện trong hộp "Thêm agent"' desc="Tắt thì không tạo mới được." sub={`${users.length} agent đang dùng adapter này.`}>
          <Switch label={`Hiện ${m.label} khi thêm agent`} checked={a.enabled} onChange={(enabled) => run(update({ enabled }))} />
        </Row>
        {m.modelFlag && (
          <Row label="Model" desc={`Trống = mặc định của ${m.label}. Áp dụng cho mọi agent dùng adapter này.`}>
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
        envExample="TEN_BIEN=giá trị"
        storedIn="adapters/registry.json"
        onSave={(patch) => update(patch)}
      />

      <Group title="Khả năng trong stag.ai">
        {caps.map(([label, v]) => (
          <Row key={label} label={<span className="font-normal">{label}</span>}>
            <span className={`font-mono text-[12px] ${v.startsWith('✓') ? 'text-work' : 'text-dim'}`}>{v}</span>
          </Row>
        ))}
      </Group>

      <Group title="Gỡ">
        <Row
          label="Gỡ adapter"
          desc={a.source.type === 'npm' ? 'Gỡ gói khỏi thư mục adapter của app. Agent đã tạo vẫn còn, mở phiên sẽ báo cần cài lại.' : 'Bỏ khỏi danh sách; thư mục của bạn không bị xoá.'}
        >
          <SmallButton variant="danger" onClick={remove} disabled={!!busy}>
            {busy === 'remove' ? 'Đang gỡ…' : 'Gỡ adapter'}
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
    const dir = await window.stag.pickFolder('Chọn thư mục gói adapter (có package.json)', path || undefined)
    if (dir) setPath(dir)
  }

  const field = `${INPUT_MONO} w-full`
  const label = 'mb-1 block text-[12px] font-medium'
  const hint = 'mt-1.5 text-[12px] leading-relaxed text-dim'

  return (
    <Modal
      title="Cài adapter ngoài"
      width="w-[480px]"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button primary onClick={install} disabled={busy || !ready}>
            {busy ? (tab === 'npm' ? 'Đang chạy npm install…' : 'Đang đọc gói…') : 'Cài'}
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
          Thêm một adapter từ npm hoặc từ một thư mục trên máy. Gói cần có mục <code>stagAdapter</code> trong package.json (xem <code>docs/adapters.md</code>).
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
                  Gói npm
                </>
              )
            },
            {
              value: 'local',
              label: (
                <>
                  <Icon name="folder" size="s" />
                  Thư mục
                </>
              )
            }
          ]}
        />
        {tab === 'npm' ? (
          <>
            <label className={label} htmlFor="adapter-npm-name">
              Tên gói
            </label>
            <input id="adapter-npm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="stag-adapter-aider" spellCheck={false} className={field} />
            <label className={`${label} mt-3`} htmlFor="adapter-npm-version">
              Phiên bản (tuỳ chọn)
            </label>
            <input id="adapter-npm-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" spellCheck={false} className={field} />
            <p className={hint}>
              Cài bằng <code>npm install --ignore-scripts</code> vào thư mục riêng của app (script cài đặt của gói không được chạy).
            </p>
          </>
        ) : (
          <>
            <label className={label} htmlFor="adapter-local-path">
              Đường dẫn tới thư mục gói
            </label>
            <div className="flex gap-2">
              <input id="adapter-local-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\code\stag-adapter-aider" spellCheck={false} className={field} />
              <SmallButton icon="folder" size="md" onClick={choose}>
                Chọn
              </SmallButton>
            </div>
            <p className={hint}>Dùng tại chỗ, không chép: sửa gói rồi bấm "Đọc lại gói" ở trang adapter là có tác dụng.</p>
          </>
        )}
        <Callout icon="shield" className="mt-4">
          Adapter chạy chương trình trên máy bạn với quyền của bạn. Chỉ cài từ nguồn bạn tin.
        </Callout>
        {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-danger">{error}</div>}
      </form>
    </Modal>
  )
}
