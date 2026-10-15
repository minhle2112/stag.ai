import { useState } from 'react'
import type { PlainKey } from '@shared/i18n'
import { ALWAYS_SHARED, parseScope, projectRel } from '@shared/scope'
import { resolveScope } from '@shared/settings'
import { type ScopeLockSettings, type ScopeMode } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { Icon } from '../Icon'
import { Seg } from '../ui/Seg'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, INPUT_MONO, InfoTip, Row, SectionTitle, SmallButton, Switch, useSaveError } from './controls'
import { t as tt, useT } from '../../i18n'

const MODES: Array<{ value: ScopeMode; label: PlainKey; desc: PlainKey }> = [
  { value: 'ask', label: 'scope.mode.ask', desc: 'scope.mode.askDesc' },
  { value: 'block', label: 'scope.mode.block', desc: 'scope.mode.blockDesc' },
  { value: 'warn', label: 'scope.mode.warn', desc: 'scope.mode.warnDesc' },
  { value: 'off', label: 'scope.mode.off', desc: 'scope.mode.offDesc' }
]
const modeLabel = (m: ScopeMode): string => tt(MODES.find((x) => x.value === m)!.label)

/** Cài đặt → Khoá phạm vi (Settings S5): app.scope + ghi đè workspace / agent (SettingsOverrides.scope). */
export function ScopeSection(): React.JSX.Element {
  const t = useT()
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const [level, setLevel] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const cur = useLevel(level)
  const ws = workspaces.find((w) => w.id === cur.wsId)

  const own: Partial<ScopeLockSettings> =
    cur.lvl === 'ws' ? (settings.workspaces[cur.wsId!]?.scope ?? {}) : cur.lvl === 'agent' ? (settings.agents[cur.agentId!]?.scope ?? {}) : settings.app.scope
  const parent: ScopeLockSettings = cur.lvl === 'agent' ? resolveScope(settings, cur.wsId, null) : settings.app.scope
  const parentName = cur.lvl === 'agent' ? t('scope.parentWs', { name: ws?.name ?? '' }) : t('scope.parentApp')
  const effective = resolveScope(settings, cur.wsId, cur.agentId)

  function setField<K extends keyof ScopeLockSettings>(key: K, value: ScopeLockSettings[K] | undefined): void {
    if (cur.lvl === 'app') {
      if (value !== undefined) run(save({ scope: { [key]: value } }))
      return
    }
    const next = { ...own }
    if (value === undefined || (key === 'exempt' && !(value as string[]).length)) delete next[key]
    else next[key] = value
    run(saveOverrides(cur.lvl === 'ws' ? 'workspace' : 'agent', cur.lvl === 'ws' ? cur.wsId! : cur.agentId!, { scope: Object.keys(next).length ? next : null }))
  }

  const shellOn = effective.guessShell
  const off = effective.mode === 'off'

  return (
    <>
      <SectionTitle
        title={t('scope.title')}
        desc={t('scope.desc')}
        right={<LevelBar level={level} setLevel={setLevel} has={(o) => !!o?.scope} />}
      />
      <ErrorBar error={error} />

      <Group>
        <Row
          label={t('scope.mode.label')}
          desc={t('scope.mode.desc')}
          override={
            cur.lvl === 'app' ? undefined : { on: !!own.mode, onReset: () => setField('mode', undefined), parent: modeLabel(parent.mode) }
          }
        >
          <Seg
            value={effective.mode}
            onChange={(mode) => setField('mode', mode)}
            options={MODES.map((m) => ({ value: m.value, label: t(m.label), tip: t(m.desc) }))}
          />
        </Row>
        <Row
          label={t('scope.shell.label')}
          desc={`${t('scope.shell.desc')}${cur.lvl === 'agent' ? ` ${t('scope.shell.descAgent', { parent: parentName })}` : ''}`}
          disabled={off}
          override={
            cur.lvl === 'ws'
              ? { on: 'guessShell' in own, onReset: () => setField('guessShell', undefined), parent: parent.guessShell ? t('scope.on') : t('scope.off') }
              : undefined
          }
        >
          <Switch
            label={cur.lvl === 'app' ? t('scope.shell.label') : t('scope.shell.labelFor', { name: cur.name })}
            checked={shellOn}
            disabled={off || cur.lvl === 'agent'}
            onChange={(v) => setField('guessShell', v)}
          />
        </Row>
      </Group>

      <Group
        title={
          <span className="inline-flex items-center gap-1.5">
            {t('scope.exempt.title')}
            <InfoTip
              text={`${t('scope.exempt.tip')}${cur.lvl === 'ws' ? ` ${t('scope.exempt.tipWs')}` : ''}`}
            />
          </span>
        }
      >
        <div className={`border-b border-line py-2.5 ${off ? 'opacity-50' : ''}`}>
          <div className="flex flex-wrap gap-1">
            <Chip title={t('scope.exempt.vaultTip')}>{ws ? vaultLabel(ws.path, ws.vaultPath) : t('scope.exempt.vaultFallback')}</Chip>
            {ALWAYS_SHARED.map((p) => (
              <Chip key={p} title={t('scope.exempt.appData')}>
                {p}/
              </Chip>
            ))}
            {cur.lvl !== 'app' &&
              settings.app.scope.exempt.map((p) => (
                <Chip key={`app:${p}`} title={t('scope.exempt.fromApp')}>
                  {p}
                </Chip>
              ))}
            {cur.lvl === 'agent' &&
              (settings.workspaces[cur.wsId!]?.scope?.exempt ?? []).map((p) => (
                <Chip key={`ws:${p}`} title={t('scope.exempt.from', { parent: parentName })}>
                  {p}
                </Chip>
              ))}
          </div>
          {cur.lvl === 'agent' ? (
            <div className="mt-2 text-[12px] text-dim">{t('scope.exempt.agentNote')}</div>
          ) : (
            <ExemptEditor
              items={(cur.lvl === 'app' ? settings.app.scope.exempt : own.exempt) ?? []}
              inherited={cur.lvl === 'ws' ? settings.app.scope.exempt : []}
              root={ws?.path}
              onChange={(next) => setField('exempt', next)}
            />
          )}
        </div>
      </Group>
    </>
  )
}

/** Mẫu miễn khoá (kiểu thẻ nhỏ chữ đơn cách của bản thiết kế). */
function Chip({ children, title }: { children: React.ReactNode; title?: string }): React.JSX.Element {
  return (
    <span data-tip={title} className="inline-flex h-[22px] items-center rounded border border-line-2 bg-bg px-2 font-mono text-[11px] text-muted">
      {children}
    </span>
  )
}

/** Thư mục vault so với dự án (vault nằm ngoài dự án thì vốn không bị khoá). */
function vaultLabel(root: string, vaultPath: string): string {
  const rel = projectRel(vaultPath, root)
  const name = vaultPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'vault'
  return rel === null ? tt('scope.exempt.outside', { name }) : `${name}/`
}

/** Thêm / bỏ mẫu miễn khoá của cấp đang sửa. */
function ExemptEditor({
  items,
  inherited,
  root,
  onChange
}: {
  items: string[]
  inherited: string[]
  root?: string
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const add = (): void => {
    const pat = text.trim()
    if (!pat) return
    // Kiểm theo một thư mục giả khi ở cấp app (chưa biết dự án nào).
    const entries = parseScope(pat, root ?? 'C:/project')
    if (!entries.length) return setProblem(t('scope.exempt.badPattern'))
    if (entries.some((e) => e.key === '' && !e.glob)) return setProblem(t('scope.exempt.wholeProject'))
    if (items.includes(pat) || inherited.includes(pat)) return setProblem(t('scope.exempt.dup'))
    onChange([...items, pat])
    setText('')
    setProblem('')
  }
  return (
    <div className="mt-2">
      {items.map((p) => (
        <div key={p} className="flex items-center gap-2 border-t border-line py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{p}</span>
          <button
            type="button"
            aria-label={t('scope.exempt.removeAria', { pattern: p })}
            data-tip={t('scope.exempt.removeTip')}
            onClick={() => onChange(items.filter((x) => x !== p))}
            className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
          >
            <Icon name="x" size="s" />
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-1.5">
        <input
          aria-label={t('scope.exempt.newAria')}
          value={text}
          placeholder={t('scope.exempt.placeholder')}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setProblem('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className={`${INPUT_MONO} min-w-0 flex-1`}
        />
        <SmallButton icon="plus" onClick={add} disabled={!text.trim()}>
          {t('common.add')}
        </SmallButton>
      </div>
      {problem && <div className="mt-1 text-[12px] text-danger">{problem}</div>}
    </div>
  )
}
