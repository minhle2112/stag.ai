import { useEffect, useState, type ReactNode } from 'react'
import { agentKind, type AdapterId, type CliAdapterId, type ExternalAdapterStatus, type InstalledAdapter } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useExternalAdapters } from '../../store/externalAdapters'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { Button, Modal } from '../Modal'
import { AdvancedFields, CliDetail, LABEL, ModelInput, shortVersion, TerminalDetail, type StatusMap } from './AdapterDetails'
import { ErrorBar, Group, Row, SmallButton, Switch, useSaveError } from './controls'

/**
 * Settings → Adapter, bố cục theo trang Adapters của Paperclip: nhãn Alpha + nút "Cài adapter", băng cảnh
 * báo, mục "Adapter ngoài" (gói người dùng cài) và "Adapter có sẵn"; nút nguồn ẩn / hiện adapter trong hộp
 * Thêm agent. Bấm một dòng để mở trang chi tiết.
 */

type View = { type: 'list' } | { type: 'builtin'; id: AdapterId } | { type: 'external'; id: string }

export const errText = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

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
      {view.type === 'list' && (
        <AdapterList status={status} open={setView} onInstall={() => setInstalling(true)} />
      )}
      {view.type === 'builtin' && (
        <DetailFrame onBack={back} title={LABEL[view.id]} badge={<Badge>Có sẵn</Badge>} power={<BuiltinPower id={view.id} />}>
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

function AdapterList({ status, open, onInstall }: { status: StatusMap; open: (v: View) => void; onInstall: () => void }): React.JSX.Element {
  const external = useExternalAdapters((s) => s.items)
  const loaded = useExternalAdapters((s) => s.loaded)
  const adapters = useSettings((s) => s.value.app.adapters)
  const shell = adapters.terminal.shell

  const cliLine = (id: CliAdapterId): string => {
    const st = status[id]
    const parts: string[] = [id]
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
      <div className="mb-4 flex items-center gap-2.5">
        <ChipIcon className="h-5 w-5 text-muted" />
        <h1 className="text-[18px] font-semibold tracking-tight">Adapter</h1>
        <span className="rounded-full border border-amber-400/50 px-2 py-px text-[11px] text-amber-300">Alpha</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onInstall}
          className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
        >
          <span className="text-[15px] leading-none">+</span> Cài adapter
        </button>
      </div>

      <div className="mb-6 flex gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3 text-[12.5px]">
        <span className="mt-px text-amber-300">⚠</span>
        <div>
          <div className="font-medium text-amber-200">Adapter ngoài đang ở bản thử (alpha).</div>
          <div className="mt-0.5 leading-relaxed text-muted">
            Cách đóng gói adapter còn có thể đổi. Adapter chạy chương trình trên máy bạn, nên chỉ cài từ nguồn bạn tin. Bấm nút nguồn để
            ẩn một adapter khỏi hộp Thêm agent mà không gỡ nó.
          </div>
        </div>
      </div>

      <SectionHead>Adapter ngoài</SectionHead>
      {external.length === 0 ? (
        <div className="mb-7 flex flex-col items-center rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <ChipIcon className="mb-3 h-7 w-7 text-muted" />
          <div className="text-[13px] font-medium">{loaded ? 'Chưa cài adapter ngoài nào' : 'Đang tải…'}</div>
          <div className="mt-1 text-[12px] text-muted">Cài một gói adapter để chạy thêm CLI AI khác (vd. Aider) như một agent trong lưới.</div>
        </div>
      ) : (
        <div className="mb-7 divide-y divide-line rounded-lg border border-line bg-panel">
          {external.map((a) => (
            <ListRow
              key={a.manifest.id}
              title={a.manifest.label}
              badge={<Badge>{a.source.type === 'npm' ? 'npm' : 'Thư mục'}</Badge>}
              line={[a.manifest.id, `v${a.version}`, `${a.manifest.models.length} model`].join(' · ')}
              tone="muted"
              enabled={a.enabled}
              onToggle={(enabled) => void window.stag.externalAdapters.update(a.manifest.id, { enabled })}
              onOpen={() => open({ type: 'external', id: a.manifest.id })}
            />
          ))}
        </div>
      )}

      <SectionHead>Adapter có sẵn</SectionHead>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {(['claude', 'codex'] as const).map((id) => (
          <ListRow
            key={id}
            title={LABEL[id]}
            badge={<Badge>Có sẵn</Badge>}
            line={cliLine(id)}
            tone={cliTone(id)}
            enabled={adapters[id].enabled}
            onToggle={(enabled) => void useSettings.getState().save({ adapters: { [id]: { enabled } } })}
            onOpen={() => open({ type: 'builtin', id })}
          />
        ))}
        <ListRow
          title="Terminal"
          badge={<Badge>Có sẵn</Badge>}
          line={`terminal · ${{ powershell: 'Windows PowerShell', pwsh: 'PowerShell 7', gitbash: 'Git Bash', cmd: 'cmd' }[shell]}`}
          tone="ok"
          enabled={adapters.terminal.enabled}
          onToggle={(enabled) => void useSettings.getState().save({ adapters: { terminal: { enabled } } })}
          onOpen={() => open({ type: 'builtin', id: 'terminal' })}
        />
      </div>
    </>
  )
}

export type Tone = 'ok' | 'warn' | 'bad' | 'muted'
const TONE: Record<Tone, string> = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-red-400', muted: 'bg-muted/60' }

export function ListRow({
  title,
  badge,
  line,
  tone,
  enabled,
  onToggle,
  onOpen
}: {
  title: string
  badge: ReactNode
  line: string
  tone: Tone
  enabled: boolean
  onToggle: (enabled: boolean) => void
  onOpen: () => void
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-panel-2/60"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[tone]}`} />
      <div className={`min-w-0 flex-1 ${enabled ? '' : 'opacity-50'}`}>
        <div className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge}
          {!enabled && <span className="text-[11px] text-muted">đang ẩn</span>}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted">{line}</div>
      </div>
      <PowerButton label={title} enabled={enabled} onToggle={onToggle} />
      <span className="text-muted group-hover:text-fg">›</span>
    </div>
  )
}

export function PowerButton({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? `Ẩn ${label} khỏi hộp Thêm agent` : `Hiện ${label} trong hộp Thêm agent`}
      title={enabled ? 'Đang hiện trong hộp Thêm agent — bấm để ẩn' : 'Đang ẩn — bấm để hiện trong hộp Thêm agent'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(!enabled)
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-md border ${
        enabled ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10' : 'border-line text-muted hover:bg-panel-2'
      }`}
    >
      <PowerIcon className="h-4 w-4" />
    </button>
  )
}

function BuiltinPower({ id }: { id: AdapterId }): React.JSX.Element {
  const enabled = useSettings((s) => s.value.app.adapters[id].enabled)
  return <PowerButton label={LABEL[id]} enabled={enabled} onToggle={(v) => void useSettings.getState().save({ adapters: { [id]: { enabled: v } } })} />
}

function DetailFrame({
  title,
  badge,
  power,
  sub,
  onBack,
  children
}: {
  title: string
  badge: ReactNode
  power?: ReactNode
  sub?: ReactNode
  onBack: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <>
      <button type="button" onClick={onBack} className="-ml-2 mb-3 rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-panel-2 hover:text-fg">
        ← Tất cả adapter
      </button>
      <div className="mb-1 flex items-center gap-2.5">
        <ChipIcon className="h-5 w-5 text-muted" />
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        {badge}
        <div className="flex-1" />
        {power}
      </div>
      <div className="mb-5 text-[12.5px] leading-relaxed text-muted">
        {sub ?? 'Thay đổi áp dụng cho phiên mở sau; phiên đang chạy giữ nguyên. Kiểm tra CLI không gọi model, không tốn quota.'}
      </div>
      {children}
    </>
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

  const check = (): void => {
    setStatus('loading')
    window.stag.externalAdapters
      .check(id)
      .then(setStatus)
      .catch((e) => setStatus({ id, path: null, version: null, error: errText(e), checkedAt: new Date().toISOString() }))
  }
  useEffect(check, [id, a?.installedAt])

  if (!a) {
    return (
      <DetailFrame onBack={onBack} title={id} badge={<Badge>Adapter ngoài</Badge>} sub={loaded ? 'Adapter này đã bị gỡ.' : 'Đang tải…'}>
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

  return (
    <DetailFrame
      onBack={onBack}
      title={m.label}
      badge={<Badge>{a.source.type === 'npm' ? 'npm' : 'Thư mục'}</Badge>}
      power={<PowerButton label={m.label} enabled={a.enabled} onToggle={(enabled) => run(update({ enabled }))} />}
      sub={m.description || undefined}
    >
      <ErrorBar error={error} />
      <Group title="Gói">
        <Row
          label="Nguồn"
          desc={
            a.source.type === 'npm' ? (
              <code>
                {a.source.name}@{a.source.version}
              </code>
            ) : (
              <code className="break-all">{a.source.path}</code>
            )
          }
        >
          <SmallButton onClick={() => void window.stag.openFolder(a.dir)}>Mở thư mục</SmallButton>
        </Row>
        <Row label="Phiên bản gói" desc={`${a.version} · id ${m.id} · cài lúc ${new Date(a.installedAt).toLocaleString('vi-VN')}`}>
          <SmallButton onClick={reinstall} disabled={!!busy}>
            {busy === 'reinstall' ? 'Đang cài…' : a.source.type === 'npm' ? 'Cài lại / cập nhật' : 'Đọc lại gói'}
          </SmallButton>
        </Row>
        {m.homepage && <Row label="Trang chủ" desc={<code className="break-all">{m.homepage}</code>} />}
      </Group>

      <Group title="Trên máy này">
        <Row
          label="Chương trình"
          desc={
            st?.error ? (
              <span className="text-red-300">{st.error}</span>
            ) : st?.path ? (
              <code className="break-all">{st.path}</code>
            ) : (
              'Đang tìm…'
            )
          }
        />
        <Row label="Phiên bản" desc={st?.version ?? (status === 'loading' ? 'Đang kiểm tra…' : '—')}>
          <SmallButton onClick={check} disabled={status === 'loading'}>
            {status === 'loading' ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </SmallButton>
        </Row>
        <Row
          label="Lệnh mỗi phiên"
          desc={
            <code className="break-all">
              {[m.command, ...m.args, m.modelFlag && a.model ? `${m.modelFlag} ${a.model}` : '', m.rules && 'flag' in m.rules ? `${m.rules.flag} <luật phiên>` : '', m.mcpConfigFlag ? `${m.mcpConfigFlag} <mcp stag>` : '', a.extraArgs, m.prompt ? ('flag' in m.prompt ? `${m.prompt.flag} "<lời mở>"` : '"<lời mở>"') : '']
                .filter(Boolean)
                .join(' ')}
            </code>
          }
        />
      </Group>

      <Group title="Agent mới">
        <Row label='Hiện trong hộp "Thêm agent"' desc={`Tắt thì không tạo mới được. ${users.length} agent đang dùng adapter này.`}>
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
        <table className="w-full text-[12.5px]">
          <tbody className="divide-y divide-line">
            {caps.map(([label, v]) => (
              <tr key={label}>
                <td className="px-4 py-2">{label}</td>
                <td className={`px-4 py-2 text-right font-mono text-[12px] ${v.startsWith('✓') ? 'text-emerald-300' : 'text-muted'}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>

      <Group title="Gỡ">
        <Row
          label="Gỡ adapter"
          desc={a.source.type === 'npm' ? 'Gỡ gói khỏi thư mục adapter của app. Agent đã tạo vẫn còn, mở phiên sẽ báo cần cài lại.' : 'Bỏ khỏi danh sách; thư mục của bạn không bị xoá.'}
        >
          <button
            type="button"
            onClick={remove}
            disabled={!!busy}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
          >
            {busy === 'remove' ? 'Đang gỡ…' : 'Gỡ adapter'}
          </button>
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

  const tabBtn = (id: 'npm' | 'local', label: string, icon: ReactNode): React.JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] ${
        tab === id ? 'border-fg/60 bg-panel-2 text-fg' : 'border-line text-muted hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  )
  const input = 'w-full rounded-md border border-line bg-bg px-2.5 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent'

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
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          Thêm một adapter từ npm hoặc từ một thư mục trên máy. Gói cần có mục <code>stagAdapter</code> trong package.json (xem{' '}
          <code>docs/adapters.md</code>).
        </p>
        <div className="mb-4 flex gap-2">
          {tabBtn('npm', 'Gói npm', <span className="text-[11px]">⬢</span>)}
          {tabBtn('local', 'Thư mục', <span className="text-[11px]">▣</span>)}
        </div>
        {tab === 'npm' ? (
          <>
            <label className="mb-1.5 block text-[12.5px]" htmlFor="adapter-npm-name">
              Tên gói
            </label>
            <input id="adapter-npm-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="stag-adapter-aider" spellCheck={false} className={input} />
            <label className="mb-1.5 mt-3 block text-[12.5px]" htmlFor="adapter-npm-version">
              Phiên bản (tuỳ chọn)
            </label>
            <input id="adapter-npm-version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="latest" spellCheck={false} className={input} />
            <p className="mt-2 text-[11.5px] text-muted">
              Cài bằng <code>npm install --ignore-scripts</code> vào thư mục riêng của app (script cài đặt của gói không được chạy).
            </p>
          </>
        ) : (
          <>
            <label className="mb-1.5 block text-[12.5px]" htmlFor="adapter-local-path">
              Đường dẫn tới thư mục gói
            </label>
            <div className="flex gap-2">
              <input id="adapter-local-path" autoFocus value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\code\stag-adapter-aider" spellCheck={false} className={input} />
              <SmallButton onClick={choose}>Chọn</SmallButton>
            </div>
            <p className="mt-2 text-[11.5px] text-muted">Dùng tại chỗ, không chép: sửa gói rồi bấm "Đọc lại gói" ở trang adapter là có tác dụng.</p>
          </>
        )}
        <p className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-amber-200/90">
          Adapter chạy chương trình trên máy bạn với quyền của bạn. Chỉ cài từ nguồn bạn tin.
        </p>
        {error && <div className="mt-3 whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
      </form>
    </Modal>
  )
}

function SectionHead({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      <ChipIcon className="h-4 w-4 text-muted" />
      {children}
    </div>
  )
}

export function Badge({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="rounded-full border border-line px-2 py-px text-[10.5px] text-muted">{children}</span>
}

/** Biểu tượng con chip (như trang Adapters của Paperclip). */
function ChipIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  )
}

export function PowerIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </svg>
  )
}

