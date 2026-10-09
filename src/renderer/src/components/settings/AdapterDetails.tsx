import { useEffect, useState } from 'react'
import { MODEL_RE, parseEnv, resolveModel, splitArgs } from '@shared/settings'
import {
  agentKind,
  type AdapterId,
  type AdapterStatus,
  type CliAdapterId,
  type CliAdapterSettings,
  type ModelSettings,
  type ShellInfo
} from '@shared/types'
import { permissionModes } from '../../permissionModes'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, Row, Select, SmallButton, Switch, useSaveError } from './controls'

export const LABEL: Record<AdapterId, string> = { claude: 'Claude Code', codex: 'Codex', terminal: 'Terminal' }
const LOGIN_CMD: Record<CliAdapterId, string> = { claude: 'claude auth login', codex: 'codex login' }
const INSTALL_CMD: Record<CliAdapterId, string> = { claude: 'npm install -g @anthropic-ai/claude-code', codex: 'npm install -g @openai/codex' }
const CONFIG_FILE: Record<CliAdapterId, string> = { claude: '~/.claude/settings.json', codex: '~/.codex/config.toml' }

const EFFORT_LABEL: Record<string, string> = {
  minimal: 'Tối thiểu',
  low: 'Thấp',
  medium: 'Vừa',
  high: 'Cao',
  xhigh: 'Rất cao',
  max: 'Tối đa',
  ultra: 'Ultra'
}
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Khả năng của từng adapter trong stag.ai (Connector / Skill là việc của S2 / S3). */
export const FEATURES: Array<{ label: string; claude: string; codex: string; terminal: string }> = [
  { label: 'Luật phiên + bộ nhớ vault', claude: '✓', codex: '✓ developer_instructions', terminal: '—' },
  { label: 'MCP stag (kanban, trình duyệt, bàn giao)', claude: '✓', codex: '✓', terminal: '—' },
  { label: 'Trạng thái qua hook (đang làm / chờ bạn)', claude: '✓', codex: '✓ (curl)', terminal: '—' },
  { label: 'Tiếp tục phiên trước', claude: '✓ --resume', codex: '✓ codex resume', terminal: '—' },
  { label: '% context + tự bàn giao', claude: '✓ statusLine', codex: '✓ rollout', terminal: '—' },
  { label: 'Khoá phạm vi', claude: '✓ hộp quyền của Claude', codex: '✓ app hỏi bạn', terminal: '—' },
  { label: 'Connector (MCP của bạn)', claude: 'sắp có (S2)', codex: 'sắp có (S2)', terminal: '—' },
  { label: 'Skill', claude: 'sắp có (S3)', codex: 'sắp có (S3)', terminal: '—' }
]

export type StatusMap = Partial<Record<CliAdapterId, AdapterStatus | 'loading'>>

/** "2.1.295 (Claude Code)" → "2.1.295", "codex-cli 0.162.0" → "0.162.0". */
export function shortVersion(v: string | null): string {
  return (v && /\d+\.\d+[\w.-]*/.exec(v)?.[0]) || v || '?'
}

export function CliDetail({
  id,
  status,
  recheck,
  focusAgentId
}: {
  id: CliAdapterId
  status: AdapterStatus | 'loading' | undefined
  recheck: () => void
  focusAgentId?: string
}): React.JSX.Element {
  const a = useSettings((s) => s.value.app.adapters[id])
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const set = (patch: Partial<CliAdapterSettings>): void => run(save({ adapters: { [id]: patch } }))
  const st = status && status !== 'loading' ? status : null

  async function pickExe(): Promise<void> {
    const file = await window.stag.pickFile(`Chọn file chạy ${LABEL[id]}`, a.path || st?.path || undefined)
    if (file) {
      set({ path: file })
      // Kiểm tra lại sau khi main lưu xong.
      setTimeout(recheck, 50)
    }
  }

  return (
    <>
      <ErrorBar error={error} />
      <Group title="Trên máy này">
        <Row
          label="File chạy"
          desc={
            st?.error ? (
              <span className="text-red-300">{st.error}</span>
            ) : st?.path ? (
              <>
                <code className="break-all">{st.path}</code> {a.path ? '(bạn chọn)' : '(tự tìm trong PATH)'}
              </>
            ) : (
              'Đang tìm…'
            )
          }
        >
          {a.path && (
            <SmallButton
              onClick={() => {
                set({ path: '' })
                setTimeout(recheck, 50)
              }}
            >
              Tự tìm
            </SmallButton>
          )}
          <SmallButton onClick={pickExe}>Chọn file…</SmallButton>
        </Row>
        {st && !st.path && (
          <Row label="Cài đặt" desc={<>Chạy trong một ô Terminal rồi bấm Kiểm tra lại:</>}>
            <code className="rounded bg-panel-2 px-2 py-1 text-[12px]">{INSTALL_CMD[id]}</code>
          </Row>
        )}
        <Row label="Phiên bản" desc={st?.version ?? (status === 'loading' ? 'Đang kiểm tra…' : '—')} />
        <Row
          label="Đăng nhập"
          desc={
            !st || st.error ? (
              '—'
            ) : st.login.state === 'in' ? (
              st.login.detail
            ) : (
              <>
                {st.login.detail}. Mở một ô Terminal, chạy <code>{LOGIN_CMD[id]}</code> rồi bấm Kiểm tra lại.
              </>
            )
          }
        >
          {st && !st.error && (
            <span
              className={`rounded px-2 py-0.5 text-[12px] ${
                st.login.state === 'in' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {st.login.state === 'in' ? 'Đã đăng nhập' : st.login.state === 'out' ? 'Chưa đăng nhập' : 'Không rõ'}
            </span>
          )}
        </Row>
        <Row label="Kiểm tra" desc={st ? `Lần cuối: ${new Date(st.checkedAt).toLocaleTimeString('vi-VN')}` : undefined}>
          <SmallButton onClick={recheck} disabled={status === 'loading'}>
            {status === 'loading' ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
          </SmallButton>
        </Row>
      </Group>

      <Group title="Agent mới">
        <Row label='Hiện trong hộp "Thêm agent"' desc="Tắt thì không tạo mới được; agent đã có vẫn chạy bình thường.">
          <Switch label={`Hiện ${LABEL[id]} khi thêm agent`} checked={a.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label="Quyền chọn sẵn" desc="Mức quyền được chọn sẵn trong hộp Thêm agent. Mỗi agent vẫn giữ mức quyền riêng của nó.">
          <Select
            label={`Quyền chọn sẵn cho ${LABEL[id]}`}
            value={a.defaultPermission}
            onChange={(defaultPermission) => set({ defaultPermission })}
            options={permissionModes(id).map((m) => ({ value: m.id, label: m.label }))}
          />
        </Row>
      </Group>

      <ModelGroup id={id} status={st} focusAgentId={focusAgentId} />

      <AdvancedGroup id={id} />

      <Group title="Khả năng trong stag.ai">
        <table className="w-full text-[12.5px]">
          <tbody className="divide-y divide-line">
            {FEATURES.map((f) => (
              <tr key={f.label}>
                <td className="px-4 py-2">{f.label}</td>
                <td className={`px-4 py-2 text-right ${f[id].startsWith('✓') ? 'text-emerald-300' : 'text-muted'}`}>{f[id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Group>
    </>
  )
}

/** Cấp đang sửa model: 'app' hoặc `ws:<id>` hoặc `agent:<wsId>:<agentId>`. */
type LevelKey = string

function ModelGroup({ id, status, focusAgentId }: { id: CliAdapterId; status: AdapterStatus | null; focusAgentId?: string }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [error, run] = useSaveError()

  const focusWs = focusAgentId ? Object.entries(byWs).find(([, w]) => w.agents.some((x) => x.id === focusAgentId))?.[0] : undefined
  const [level, setLevel] = useState<LevelKey>(focusWs ? `agent:${focusWs}:${focusAgentId}` : 'app')
  useEffect(() => {
    if (focusWs && focusAgentId) setLevel(`agent:${focusWs}:${focusAgentId}`)
  }, [focusWs, focusAgentId])

  const [kind, wsId, agentId] = level.split(':') as ['app' | 'ws' | 'agent', string?, string?]
  const ws = workspaces.find((w) => w.id === wsId)
  const agent = agentId ? byWs[wsId!]?.agents.find((x) => x.id === agentId) : undefined
  // Workspace / agent đã bị xoá trong lúc đang chọn → quay về cấp app.
  const lvl: 'app' | 'ws' | 'agent' = kind === 'ws' && ws ? 'ws' : kind === 'agent' && ws && agent ? 'agent' : 'app'

  const appValue: ModelSettings = { model: settings.app.adapters[id].model, effort: settings.app.adapters[id].effort }
  const own: Partial<ModelSettings> =
    lvl === 'ws' ? (settings.workspaces[ws!.id]?.models?.[id] ?? {}) : lvl === 'agent' ? (settings.agents[agent!.id]?.models?.[id] ?? {}) : appValue
  const parent: ModelSettings = lvl === 'agent' ? resolveModel(settings, id, ws!.id, null) : appValue
  const parentName = lvl === 'agent' ? `workspace ${ws!.name}` : 'mặc định của adapter'
  const effective: ModelSettings = { ...parent, ...own }
  const inherits = (key: keyof ModelSettings): boolean => lvl !== 'app' && !(key in own)

  function setField(key: keyof ModelSettings, value: string | undefined): void {
    if (lvl === 'app') {
      if (value !== undefined) run(save({ adapters: { [id]: { [key]: value } } }))
      return
    }
    const next: Partial<ModelSettings> = { ...own }
    if (value === undefined) delete next[key]
    else next[key] = value
    const target = lvl === 'ws' ? settings.workspaces[ws!.id] : settings.agents[agent!.id]
    const models = { ...target?.models, [id]: next }
    if (!Object.keys(next).length) delete models[id]
    run(saveOverrides(lvl === 'ws' ? 'workspace' : 'agent', lvl === 'ws' ? ws!.id : agent!.id, { models: Object.keys(models).length ? models : null }))
  }

  const options = [
    { value: 'app', label: `Mặc định cho mọi agent ${LABEL[id]}` },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${settings.workspaces[w.id]?.models?.[id] ? ' •' : ''}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((x) => agentKind(x) === id)
        .map((x) => ({ value: `agent:${w.id}:${x.id}`, label: `↳ Agent: ${x.name}${settings.agents[x.id]?.models?.[id] ? ' •' : ''}` }))
    ])
  ]

  const models = status?.models ?? []
  const modelInfo = models.find((m) => m.id === (effective.model || status?.configModel))
  const efforts = modelInfo?.efforts.length ? modelInfo.efforts : models.length ? [...new Set(models.flatMap((m) => m.efforts))] : FALLBACK_EFFORTS
  const effortOptions = [
    { value: '', label: 'Mặc định của model' },
    ...efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ? `${EFFORT_LABEL[e]} (${e})` : e })),
    ...(effective.effort && !efforts.includes(effective.effort) ? [{ value: effective.effort, label: `${effective.effort} (model này không có)` }] : [])
  ]

  const overrideToggle = (key: keyof ModelSettings): React.JSX.Element | null =>
    lvl === 'app' ? null : (
      <label className="mr-2 flex items-center gap-1.5 text-[12px] text-muted">
        <input type="checkbox" checked={key in own} onChange={(e) => setField(key, e.target.checked ? effective[key] : undefined)} />
        Riêng
      </label>
    )
  const configNote = status?.configModel ? `Trống = theo ${CONFIG_FILE[id]} (hiện là ${status.configModel}).` : `Trống = theo cấu hình ${LABEL[id]} của bạn.`

  return (
    <section className="mb-6">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Model</div>
      <ErrorBar error={error} />
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        <Row label="Áp dụng cho" desc="Workspace ghi đè mặc định; agent ghi đè workspace của nó. Dấu • = đang có giá trị riêng.">
          <Select label={`Cấp cài đặt model ${LABEL[id]}`} value={lvl === 'app' ? 'app' : level} onChange={setLevel} options={options} />
        </Row>
        <Row label="Model" desc={inherits('model') ? `Đang theo ${parentName}.` : configNote} disabled={inherits('model')}>
          {overrideToggle('model')}
          <ModelInput
            key={`${level}:${effective.model}`}
            name={LABEL[id]}
            listId={`models-${id}`}
            value={effective.model}
            disabled={inherits('model')}
            suggestions={models.map((m) => ({ value: m.id, label: m.label }))}
            onCommit={(v) => setField('model', v)}
          />
        </Row>
        <Row
          label="Mức suy nghĩ"
          desc={inherits('effort') ? `Đang theo ${parentName}.` : id === 'claude' ? 'Cờ --effort của Claude Code.' : 'model_reasoning_effort của Codex.'}
          disabled={inherits('effort')}
        >
          {overrideToggle('effort')}
          <Select
            label={`Mức suy nghĩ ${LABEL[id]}`}
            value={effective.effort}
            disabled={inherits('effort')}
            onChange={(v) => setField('effort', v)}
            options={effortOptions}
          />
        </Row>
      </div>
    </section>
  )
}

/** Ô gõ tên model (có gợi ý). Lưu khi rời ô / Enter; sai dạng thì báo, không lưu. */
export function ModelInput({
  name,
  listId,
  value,
  disabled,
  suggestions,
  onCommit
}: {
  /** Tên adapter (cho aria-label). */
  name: string
  listId: string
  value: string
  disabled?: boolean
  suggestions: Array<{ value: string; label: string }>
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const bad = !MODEL_RE.test(text.trim())
  const commit = (): void => {
    if (!bad && text.trim() !== value) onCommit(text.trim())
  }
  return (
    <div className="flex flex-col items-end">
      <input
        aria-label={`Model ${name}`}
        list={listId}
        value={text}
        disabled={disabled}
        placeholder="theo cấu hình của bạn"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`w-56 rounded-md border bg-bg px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent disabled:cursor-not-allowed ${
          bad ? 'border-red-500/60' : 'border-line'
        }`}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </datalist>
      {bad && <div className="mt-1 text-[11.5px] text-red-300">Chỉ dùng chữ, số và . _ : - / [ ] @</div>}
    </div>
  )
}

function AdvancedGroup({ id }: { id: CliAdapterId }): React.JSX.Element {
  const a = useSettings((s) => s.value.app.adapters[id])
  const save = useSettings((s) => s.save)
  return (
    <AdvancedFields
      fieldId={id}
      name={LABEL[id]}
      extraArgs={a.extraArgs}
      env={a.env}
      argsExample={id === 'claude' ? 'Vd. --add-dir "D:\\shared docs"' : 'Vd. -c model_verbosity="low"'}
      envExample={id === 'claude' ? 'CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000' : 'RUST_LOG=warn'}
      storedIn="settings.json"
      onSave={(patch) => save({ adapters: { [id]: patch } })}
    />
  )
}

/** Tham số thêm + biến môi trường của một adapter. Lưu khi rời ô. */
export function AdvancedFields({
  fieldId,
  name,
  extraArgs,
  env: savedEnv,
  argsExample,
  envExample,
  storedIn,
  onSave
}: {
  fieldId: string
  name: string
  extraArgs: string
  env: string
  argsExample: string
  envExample: string
  /** File lưu các giá trị này (để cảnh báo không để key bí mật). */
  storedIn: string
  onSave: (patch: { extraArgs?: string; env?: string }) => Promise<unknown>
}): React.JSX.Element {
  const [error, run] = useSaveError()
  const [args, setArgs] = useState(extraArgs)
  const [env, setEnv] = useState(savedEnv)
  useEffect(() => setArgs(extraArgs), [extraArgs])
  useEffect(() => setEnv(savedEnv), [savedEnv])
  const envCheck = parseEnv(env)
  const parsedArgs = splitArgs(args)

  return (
    <section className="mb-6">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Nâng cao</div>
      <ErrorBar error={error} />
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        <div className="px-4 py-3">
          <label htmlFor={`args-${fieldId}`} className="block text-[13px]">
            Tham số thêm
          </label>
          <div className="mt-0.5 text-[12px] text-muted">
            Thêm vào lệnh mỗi phiên {name}, cách nhau bằng dấu cách; dùng "…" cho giá trị có dấu cách. {argsExample}
          </div>
          <input
            id={`args-${fieldId}`}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            onBlur={() => args !== extraArgs && run(onSave({ extraArgs: args }))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            spellCheck={false}
            className="mt-2 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent"
          />
          {parsedArgs.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {parsedArgs.map((p, i) => (
                <code key={i} className="rounded bg-panel-2 px-1.5 py-0.5 text-[11.5px]">
                  {p || '""'}
                </code>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3">
          <label htmlFor={`env-${fieldId}`} className="block text-[13px]">
            Biến môi trường
          </label>
          <div className="mt-0.5 text-[12px] text-muted">
            Mỗi dòng TÊN=giá trị, dòng # là ghi chú. Lưu không mã hoá trong {storedIn}, nên{' '}
            <span className="text-amber-300">đừng để API key hay mật khẩu ở đây</span> (mục Secrets sẽ lo việc đó).
          </div>
          <textarea
            id={`env-${fieldId}`}
            value={env}
            rows={3}
            onChange={(e) => setEnv(e.target.value)}
            onBlur={() => env !== savedEnv && run(onSave({ env }))}
            spellCheck={false}
            placeholder={envExample}
            className="mt-2 w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent"
          />
          {envCheck.errors.length > 0 && (
            <div className="mt-1 space-y-0.5 text-[11.5px] text-red-300">
              {envCheck.errors.map((e) => (
                <div key={e}>{e} — dòng này bị bỏ qua.</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function TerminalDetail(): React.JSX.Element {
  const t = useSettings((s) => s.value.app.adapters.terminal)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const [shells, setShells] = useState<ShellInfo[] | null>(null)
  useEffect(() => {
    window.stag.settings.shells().then(setShells)
  }, [])
  const missing = shells && !shells.some((s) => s.id === t.shell)

  return (
    <>
      <ErrorBar error={error} />
      <Group title="Ô Terminal">
        <Row label='Hiện trong hộp "Thêm agent"' desc="Tắt thì không tạo ô Terminal mới được; ô đã có vẫn mở bình thường.">
          <Switch label="Hiện Terminal khi thêm agent" checked={t.enabled} onChange={(enabled) => run(save({ adapters: { terminal: { enabled } } }))} />
        </Row>
        <Row
          label="Shell"
          desc={
            missing
              ? 'Shell đã chọn không còn trên máy, ô Terminal sẽ dùng Windows PowerShell.'
              : 'Áp dụng cho ô Terminal mở sau khi đổi. Ô agent Claude / Codex không bị ảnh hưởng.'
          }
        >
          <Select
            label="Shell cho ô Terminal"
            value={t.shell}
            onChange={(shell) => run(save({ adapters: { terminal: { shell } } }))}
            options={
              shells
                ? [
                    ...shells.map((s) => ({ value: s.id, label: s.label })),
                    ...(missing ? [{ value: t.shell, label: `${t.shell} (không tìm thấy)`, disabled: true }] : [])
                  ]
                : [{ value: t.shell, label: 'Đang tìm…' }]
            }
          />
        </Row>
      </Group>
      <Group title="Shell tìm thấy trên máy">
        {(shells ?? []).map((s) => (
          <Row key={s.id} label={s.label} desc={<code className="break-all">{[s.path, ...s.args].join(' ')}</code>} />
        ))}
      </Group>
      <p className="text-[12px] leading-relaxed text-muted">
        Ô Terminal không có luật phiên, bộ nhớ hay kanban. Chạy <code>claude</code> / <code>codex</code> bên trong vẫn là một phiên độc lập
        (app bỏ biến môi trường "phiên con" trước khi mở shell).
      </p>
    </>
  )
}
