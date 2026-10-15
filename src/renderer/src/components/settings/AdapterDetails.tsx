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
import { Badge, ErrorBar, Group, INPUT_MONO, Note, Row, RowBlock, Select, SmallButton, Switch, TEXTAREA, useSaveError } from './controls'
import { LevelBar } from './levels'
import type { PlainKey } from '@shared/i18n'
import { fmtTime, t, tx, useT } from '../../i18n'

export const LABEL: Record<AdapterId, string> = { claude: 'Claude Code', codex: 'Codex', terminal: 'Terminal' }
const LOGIN_CMD: Record<CliAdapterId, string> = { claude: 'claude auth login', codex: 'codex login' }
const INSTALL_CMD: Record<CliAdapterId, string> = { claude: 'npm install -g @anthropic-ai/claude-code', codex: 'npm install -g @openai/codex' }
const CONFIG_FILE: Record<CliAdapterId, string> = { claude: '~/.claude/settings.json', codex: '~/.codex/config.toml' }

const EFFORT_LABEL: Record<string, PlainKey> = {
  minimal: 'adapters.effort.minimal',
  low: 'adapters.effort.low',
  medium: 'adapters.effort.medium',
  high: 'adapters.effort.high',
  xhigh: 'adapters.effort.xhigh',
  max: 'adapters.effort.max',
  ultra: 'adapters.effort.ultra'
}
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const MONO = 'break-all font-mono text-[11px]'

/** Khả năng của từng adapter trong stag.ai (Connector / Skill là việc của S2 / S3). Hàm: chữ theo ngôn ngữ lúc gọi. */
export function features(): Array<{ label: string; claude: string; codex: string; terminal: string }> {
  const soon2 = t('adapters.feature.soon', { phase: 'S2' })
  const soon3 = t('adapters.feature.soon', { phase: 'S3' })
  return [
    { label: t('adapters.feature.rules'), claude: '✓', codex: '✓ developer_instructions', terminal: '—' },
    { label: t('adapters.feature.mcp'), claude: '✓', codex: '✓', terminal: '—' },
    { label: t('adapters.feature.hooks'), claude: '✓', codex: '✓ (curl)', terminal: '—' },
    { label: t('adapters.feature.resume'), claude: '✓ --resume', codex: '✓ codex resume', terminal: '—' },
    { label: t('adapters.feature.context'), claude: '✓ statusLine', codex: '✓ rollout', terminal: '—' },
    { label: t('adapters.feature.scope'), claude: `✓ ${t('adapters.feature.scopeClaude')}`, codex: `✓ ${t('adapters.feature.scopeCodex')}`, terminal: '—' },
    { label: t('adapters.feature.connectors'), claude: soon2, codex: soon2, terminal: '—' },
    { label: 'Skill', claude: soon3, codex: soon3, terminal: '—' }
  ]
}

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
  const t = useT()

  async function pickExe(): Promise<void> {
    const file = await window.stag.pickFile(t('adapters.cli.pickExe', { name: LABEL[id] }), a.path || st?.path || undefined)
    if (file) {
      set({ path: file })
      // Kiểm tra lại sau khi main lưu xong.
      setTimeout(recheck, 50)
    }
  }

  return (
    <>
      <ErrorBar error={error} />
      <Group title={t('adapters.detail.thisComputer')}>
        <Row
          label={t('adapters.cli.exe')}
          sub={
            st?.error ? (
              <span className="text-danger">{st.error}</span>
            ) : st?.path ? (
              <>
                <span className={MONO}>{st.path}</span> {a.path ? t('adapters.cli.picked') : t('adapters.cli.auto')}
              </>
            ) : (
              t('adapters.detail.searching')
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
              {t('adapters.cli.autoFind')}
            </SmallButton>
          )}
          <SmallButton icon="folder" onClick={pickExe}>
            {t('adapters.cli.pickFile')}
          </SmallButton>
        </Row>
        {st && !st.path && (
          <Row label={t('adapters.cli.install')} sub={t('adapters.cli.installSub')}>
            <code className="rounded border border-line-2 bg-bg px-2 py-1 font-mono text-[11px]">{INSTALL_CMD[id]}</code>
          </Row>
        )}
        <Row label={t('adapters.detail.version')} sub={st?.version ?? (status === 'loading' ? t('adapters.detail.checking') : '—')} />
        <Row
          label={t('adapters.cli.login')}
          sub={
            !st || st.error ? (
              '—'
            ) : st.login.state === 'in' ? (
              st.login.detail
            ) : (
              <>
                {st.login.detail}. {tx('adapters.cli.loginHint', { command: <code className="font-mono text-[11px]">{LOGIN_CMD[id]}</code> })}
              </>
            )
          }
        >
          {st && !st.error && (
            <Badge tone={st.login.state === 'in' ? 'ok' : 'warn'}>
              {st.login.state === 'in' ? t('adapters.login.in') : st.login.state === 'out' ? t('adapters.login.out') : t('common.unknown')}
            </Badge>
          )}
        </Row>
        <Row label={t('adapters.cli.check')} sub={st ? t('adapters.cli.lastCheck', { time: fmtTime(st.checkedAt, true) }) : undefined}>
          <SmallButton onClick={recheck} disabled={status === 'loading'}>
            {status === 'loading' ? t('adapters.detail.checking') : t('adapters.detail.recheck')}
          </SmallButton>
        </Row>
      </Group>

      <Group title={t('adapters.detail.newAgents')}>
        <Row label={t('adapters.detail.showInAdd')} desc={t('adapters.cli.showInAddDesc')}>
          <Switch label={t('adapters.detail.showLabel', { name: LABEL[id] })} checked={a.enabled} onChange={(enabled) => set({ enabled })} />
        </Row>
        <Row label={t('adapters.cli.permission')} desc={t('adapters.cli.permissionDesc')}>
          <Select
            label={t('adapters.cli.permissionFor', { name: LABEL[id] })}
            value={a.defaultPermission}
            onChange={(defaultPermission) => set({ defaultPermission })}
            options={permissionModes(id).map((m) => ({ value: m.id, label: m.label }))}
          />
        </Row>
      </Group>

      <ModelGroup id={id} status={st} focusAgentId={focusAgentId} />

      <AdvancedGroup id={id} />

      <Group title={t('adapters.detail.features')}>
        {features().map((f) => (
          <Row key={f.label} label={<span className="font-normal">{f.label}</span>}>
            <span className={`font-mono text-[12px] ${f[id].startsWith('✓') ? 'text-work' : 'text-dim'}`}>{f[id]}</span>
          </Row>
        ))}
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
  const t = useT()

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
  const effective: ModelSettings = { ...parent, ...own }

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

  const models = status?.models ?? []
  const modelInfo = models.find((m) => m.id === (effective.model || status?.configModel))
  const efforts = modelInfo?.efforts.length ? modelInfo.efforts : models.length ? [...new Set(models.flatMap((m) => m.efforts))] : FALLBACK_EFFORTS
  const effortOptions = [
    { value: '', label: t('adapters.model.default') },
    ...efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ? `${t(EFFORT_LABEL[e])} (${e})` : e })),
    ...(effective.effort && !efforts.includes(effective.effort) ? [{ value: effective.effort, label: t('adapters.model.effortMissing', { effort: effective.effort }) }] : [])
  ]

  /** Dòng đang ghi đè ở cấp workspace / agent: chấm teal, bấm để theo cấp trên. */
  const override = (key: keyof ModelSettings): { on: boolean; onReset: () => void; parent: string } | undefined =>
    lvl === 'app' ? undefined : { on: key in own, onReset: () => setField(key, undefined), parent: parent[key] || t('common.default').toLowerCase() }
  const configNote = status?.configModel
    ? t('adapters.model.configFile', { file: CONFIG_FILE[id], model: status.configModel })
    : t('adapters.model.configOwn', { name: LABEL[id] })

  return (
    <Group
      title="Model"
      action={<LevelBar level={level} setLevel={setLevel} has={(o) => !!o?.models?.[id]} agentFilter={(x) => agentKind(x) === id} />}
    >
      <ErrorBar error={error} />
      <Row label="Model" desc={configNote} override={override('model')}>
        <ModelInput
          key={`${level}:${effective.model}`}
          name={LABEL[id]}
          listId={`models-${id}`}
          value={effective.model}
          suggestions={models.map((m) => ({ value: m.id, label: m.label }))}
          onCommit={(v) => setField('model', v)}
        />
      </Row>
      <Row
        label={t('adapters.model.effort')}
        desc={id === 'claude' ? t('adapters.model.effortClaude') : t('adapters.model.effortCodex')}
        override={override('effort')}
      >
        <Select label={t('adapters.model.effortFor', { name: LABEL[id] })} value={effective.effort} onChange={(v) => setField('effort', v)} options={effortOptions} />
      </Row>
    </Group>
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
  const t = useT()
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
        placeholder={t('adapters.model.placeholder')}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`w-56 ${INPUT_MONO} ${bad ? 'border-danger/60!' : ''}`}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </datalist>
      {bad && <div className="mt-1 text-[12px] text-danger">{t('adapters.model.badChars')}</div>}
    </div>
  )
}

function AdvancedGroup({ id }: { id: CliAdapterId }): React.JSX.Element {
  const a = useSettings((s) => s.value.app.adapters[id])
  const save = useSettings((s) => s.save)
  const t = useT()
  return (
    <AdvancedFields
      fieldId={id}
      name={LABEL[id]}
      extraArgs={a.extraArgs}
      env={a.env}
      argsExample={id === 'claude' ? t('adapters.adv.example', { example: '--add-dir "D:\\shared docs"' }) : t('adapters.adv.example', { example: '-c model_verbosity="low"' })}
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
  const t = useT()
  const [args, setArgs] = useState(extraArgs)
  const [env, setEnv] = useState(savedEnv)
  useEffect(() => setArgs(extraArgs), [extraArgs])
  useEffect(() => setEnv(savedEnv), [savedEnv])
  const envCheck = parseEnv(env)
  const parsedArgs = splitArgs(args)

  return (
    <Group title={t('adapters.adv.title')}>
      <ErrorBar error={error} />
      <RowBlock
        label={t('adapters.adv.args')}
        htmlFor={`args-${fieldId}`}
        desc={`${t('adapters.adv.argsDesc', { name })}${argsExample ? ` ${argsExample}` : ''}`}
      >
        <input
          id={`args-${fieldId}`}
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          onBlur={() => args !== extraArgs && run(onSave({ extraArgs: args }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
          className={`${INPUT_MONO} w-full`}
        />
        {parsedArgs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {parsedArgs.map((p, i) => (
              <code key={i} className="rounded border border-line-2 bg-bg px-1.5 font-mono text-[11px] leading-5">
                {p || '""'}
              </code>
            ))}
          </div>
        )}
      </RowBlock>
      <RowBlock
        label={t('adapters.adv.env')}
        htmlFor={`env-${fieldId}`}
        desc={t('adapters.adv.envDesc')}
        sub={tx('adapters.adv.envSub', { file: storedIn, warning: <span className="font-medium text-muted">{t('adapters.adv.noSecrets')}</span> })}
      >
        <textarea
          id={`env-${fieldId}`}
          value={env}
          rows={3}
          onChange={(e) => setEnv(e.target.value)}
          onBlur={() => env !== savedEnv && run(onSave({ env }))}
          spellCheck={false}
          placeholder={envExample}
          className={`${TEXTAREA} w-full`}
        />
        {envCheck.errors.length > 0 && (
          <div className="mt-1 space-y-0.5 text-[12px] text-danger">
            {envCheck.errors.map((e) => (
              <div key={e}>{t('adapters.adv.lineSkipped', { error: e })}</div>
            ))}
          </div>
        )}
      </RowBlock>
    </Group>
  )
}

export function TerminalDetail(): React.JSX.Element {
  const term = useSettings((s) => s.value.app.adapters.terminal)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const t = useT()
  const [shells, setShells] = useState<ShellInfo[] | null>(null)
  useEffect(() => {
    window.stag.settings.shells().then(setShells)
  }, [])
  const missing = shells && !shells.some((s) => s.id === term.shell)

  return (
    <>
      <ErrorBar error={error} />
      <Group title={t('adapters.term.title')}>
        <Row label={t('adapters.detail.showInAdd')} desc={t('adapters.term.showInAddDesc')}>
          <Switch label={t('adapters.detail.showLabel', { name: 'Terminal' })} checked={term.enabled} onChange={(enabled) => run(save({ adapters: { terminal: { enabled } } }))} />
        </Row>
        <Row
          label="Shell"
          desc={t('adapters.term.shellDesc')}
          sub={missing ? t('adapters.term.shellMissing') : undefined}
        >
          <Select
            label={t('adapters.term.shellLabel')}
            value={term.shell}
            onChange={(shell) => run(save({ adapters: { terminal: { shell } } }))}
            options={
              shells
                ? [
                    ...shells.map((s) => ({ value: s.id, label: s.label })),
                    ...(missing ? [{ value: term.shell, label: t('adapters.term.notFound', { shell: term.shell }), disabled: true }] : [])
                  ]
                : [{ value: term.shell, label: t('adapters.detail.searching') }]
            }
          />
        </Row>
      </Group>
      <Group title={t('adapters.term.found')}>
        {(shells ?? []).map((s) => (
          <Row key={s.id} label={s.label} sub={<span className={MONO}>{[s.path, ...s.args].join(' ')}</span>} />
        ))}
      </Group>
      <Note>{tx('adapters.term.note', { claude: <code>claude</code>, codex: <code>codex</code> })}</Note>
    </>
  )
}
