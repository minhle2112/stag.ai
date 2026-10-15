import { useEffect, useState } from 'react'
import type { PlainKey } from '@shared/i18n'
import { homePageInput, originInput, SEARCH_ENGINE_LABELS } from '@shared/browser'
import { browserToolsOn } from '@shared/settings'
import { type BrowserSettings, type ExternalPagePolicy, type SearchEngine } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, INPUT_MONO, Row, SectionTitle, Select, SmallButton, Switch, useSaveError } from './controls'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { useT } from '../../i18n'

const EXTERNAL: Record<ExternalPagePolicy, { label: PlainKey; desc: PlainKey }> = {
  ask: { label: 'browserSettings.external.ask', desc: 'browserSettings.external.askDesc' },
  allow: { label: 'browserSettings.external.allow', desc: 'browserSettings.external.allowDesc' },
  deny: { label: 'browserSettings.external.deny', desc: 'browserSettings.external.denyDesc' }
}

/** Cài đặt → Trình duyệt (Settings S5): app.browser + bật / tắt tool trình duyệt theo workspace / agent (SettingsOverrides.browser). */
export function BrowserSection(): React.JSX.Element {
  const t = useT()
  const br = useSettings((s) => s.value.app.browser)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const [level, setLevel] = useState<LevelKey>('app')
  const set = (patch: Partial<BrowserSettings>): void => run(save({ browser: patch }))

  return (
    <>
      <SectionTitle
        title={t('browserSettings.title')}
        desc={t('browserSettings.desc')}
        right={<LevelBar level={level} setLevel={setLevel} has={(o) => o?.browser?.agentTools !== undefined} />}
      />
      <ErrorBar error={error} />

      <Group title={t('browserSettings.browsing')}>
        <HomePageRow value={br.homePage} onSave={(homePage) => set({ homePage })} />
        <Row label={t('browserSettings.search')} desc={t('browserSettings.searchDesc')}>
          <Select
            label={t('browserSettings.search')}
            value={br.searchEngine}
            onChange={(searchEngine: SearchEngine) => set({ searchEngine })}
            options={(Object.keys(SEARCH_ENGINE_LABELS) as SearchEngine[]).map((v) => ({ value: v, label: SEARCH_ENGINE_LABELS[v] }))}
          />
        </Row>
      </Group>

      <AgentToolsGroup run={run} level={level} />

      <Group title={t('browserSettings.externalGroup')}>
        <Row label={t('browserSettings.externalLabel')} desc={t(EXTERNAL[br.externalPages].desc)}>
          <Select
            label={t('browserSettings.externalLabel')}
            value={br.externalPages}
            onChange={(externalPages: ExternalPagePolicy) => set({ externalPages })}
            options={(Object.keys(EXTERNAL) as ExternalPagePolicy[]).map((v) => ({ value: v, label: t(EXTERNAL[v].label) }))}
          />
        </Row>
        <AllowedOrigins list={br.allowedOrigins} moot={br.externalPages === 'allow'} onSave={(allowedOrigins) => set({ allowedOrigins })} />
      </Group>

      <Group title={t('browserSettings.cookies')}>
        <Row
          label={t('browserSettings.keepCookies')}
          desc={t('browserSettings.keepCookiesDesc')}
        >
          <Switch label={t('browserSettings.keepCookies')} checked={br.keepCookies} onChange={(keepCookies) => set({ keepCookies })} />
        </Row>
        <ClearDataRow />
      </Group>
    </>
  )
}

/** Trang tab mới: lưu khi rời ô / Enter; gõ sai thì báo, không lưu. */
function HomePageRow({ value, onSave }: { value: string; onSave: (v: string) => void }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState(value)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(value)
    setBad(false)
  }, [value])
  const commit = (): void => {
    const v = homePageInput(text)
    setBad(v === null)
    if (v !== null && v !== value) onSave(v)
    else if (v !== null) setText(value)
  }
  return (
    <Row
      label={t('browserSettings.home')}
      htmlFor="browser-home"
      desc={t('browserSettings.homeDesc')}
      sub={bad ? <span className="text-danger">{t('browserSettings.homeBad')}</span> : undefined}
    >
      <input
        id="browser-home"
        value={text}
        placeholder={t('browserSettings.homePlaceholder')}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`w-72 ${INPUT_MONO} ${bad ? 'border-danger/60!' : ''}`}
      />
    </Row>
  )
}

/** Danh sách origin luôn cho agent mở: thêm (chuẩn hoá, báo lỗi nếu sai) / bỏ. */
function AllowedOrigins({ list, moot, onSave }: { list: string[]; moot: boolean; onSave: (v: string[]) => void }): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [bad, setBad] = useState('')
  const add = (): void => {
    const typed = text.trim()
    if (!typed) return
    const o = originInput(typed)
    if (!o) return setBad(t('browserSettings.originBad'))
    if (list.includes(o)) return setBad(t('browserSettings.originDup', { origin: o }))
    setBad('')
    setText('')
    onSave([...list, o])
  }
  return (
    <>
      <Row
        label={t('browserSettings.allowed')}
        desc={t('browserSettings.allowedDesc')}
        sub={
          bad ? (
            <span className="text-danger">{bad}</span>
          ) : moot ? (
            t('browserSettings.allowedMoot')
          ) : undefined
        }
      >
        <input
          aria-label={t('browserSettings.allowedAria')}
          value={text}
          placeholder="github.com"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setBad('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className={`w-56 ${INPUT_MONO} ${bad ? 'border-danger/60!' : ''}`}
        />
        <SmallButton icon="plus" onClick={add} disabled={!text.trim()}>
          {t('common.add')}
        </SmallButton>
      </Row>
      {list.map((o) => (
        <Row key={o} label={<span className="font-mono text-[12px]">{o}</span>}>
          <SmallButton onClick={() => onSave(list.filter((x) => x !== o))}>{t('browserSettings.remove')}</SmallButton>
        </Row>
      ))}
    </>
  )
}

/** "Cho agent dùng trình duyệt" theo cấp: mặc định cho mọi agent → workspace → agent (cấp chọn ở tiêu đề trang). */
function AgentToolsGroup({ run, level: key }: { run: (p: Promise<unknown>) => void; level: LevelKey }): React.JSX.Element {
  const t = useT()
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const level = useLevel(key)

  const own = level.lvl === 'ws' ? settings.workspaces[level.wsId!]?.browser?.agentTools : level.lvl === 'agent' ? settings.agents[level.agentId!]?.browser?.agentTools : undefined
  const parent = level.lvl === 'agent' ? browserToolsOn(settings, level.wsId, null) : settings.app.browser.agentTools
  const setOwn = (v: boolean | undefined): void =>
    run(
      saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, {
        browser: v === undefined ? null : { agentTools: v }
      })
    )

  return (
    <Group title={t('browserSettings.agentGroup')}>
      <Row
        label={t('browserSettings.agentTools')}
        desc={t('browserSettings.agentToolsDesc')}
        override={level.lvl === 'app' ? undefined : { on: own !== undefined, onReset: () => setOwn(undefined), parent: parent ? t('browserSettings.on') : t('browserSettings.off') }}
      >
        {level.lvl === 'app' ? (
          <Switch label={t('browserSettings.agentToolsAll')} checked={settings.app.browser.agentTools} onChange={(agentTools) => run(save({ browser: { agentTools } }))} />
        ) : (
          <Switch label={t('browserSettings.agentToolsFor', { name: level.name })} checked={own ?? parent} onChange={(v) => setOwn(v)} />
        )}
      </Row>
    </Group>
  )
}

/** Xoá cookie và dữ liệu trang (một workspace hoặc tất cả); bấm hai lần để chắc chắn. */
function ClearDataRow(): React.JSX.Element {
  const t = useT()
  const workspaces = useWorkspaces((s) => s.items)
  const [target, setTarget] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [state, setState] = useState<'' | 'busy' | 'done'>('')
  const [error, setError] = useState('')
  const valid = !target || workspaces.some((w) => w.id === target)
  const scope = valid ? target : ''

  async function clear(): Promise<void> {
    setState('busy')
    setError('')
    try {
      await window.stag.browser.clearData(scope || undefined)
      setState('done')
    } catch (e) {
      setState('')
      setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setConfirm(false)
  }

  return (
    <Row
      label={t('browserSettings.clear')}
      desc={t('browserSettings.clearDesc')}
      sub={error ? <span className="text-danger">{error}</span> : state === 'done' ? t('browserSettings.cleared') : undefined}
    >
      <Select
        label={t('browserSettings.clearFor')}
        value={scope}
        onChange={(v) => {
          setTarget(v)
          setConfirm(false)
          setState('')
        }}
        options={[{ value: '', label: t('browserSettings.allWorkspaces') }, ...workspaces.map((w) => ({ value: w.id, label: t('browserSettings.workspaceOption', { name: w.name }) }))]}
      />
      <SmallButton
        variant={confirm ? 'dangerSolid' : 'danger'}
        disabled={state === 'busy'}
        onClick={() => (confirm ? void clear() : (setConfirm(true), setState('')))}
      >
        {state === 'busy' ? t('browserSettings.clearing') : confirm ? t('browserSettings.clickAgain') : t('common.delete')}
      </SmallButton>
    </Row>
  )
}
