import { useEffect, useState } from 'react'
import { homePageInput, originInput, SEARCH_ENGINE_LABELS } from '@shared/browser'
import { browserToolsOn } from '@shared/settings'
import { agentKind, type BrowserSettings, type ExternalPagePolicy, type SearchEngine } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { ErrorBar, Group, Row, SectionTitle, Select, SmallButton, Switch, useSaveError } from './controls'
import { useLevel, type LevelKey } from './levels'

const input = 'rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent'

const EXTERNAL: Record<ExternalPagePolicy, { label: string; desc: string }> = {
  ask: { label: 'Hỏi bạn', desc: 'Hiện hộp thoại khi agent mở một trang ngoài localhost lần đầu; cho phép thì dùng được tới khi tắt app.' },
  allow: { label: 'Luôn cho', desc: 'Agent mở mọi trang http(s) mà không hỏi.' },
  deny: { label: 'Luôn chặn', desc: 'Agent chỉ mở được localhost và các trang luôn cho phép bên dưới, không hỏi bạn.' }
}

/** Cài đặt → Trình duyệt (Settings S5): app.browser + bật / tắt tool trình duyệt theo workspace / agent (SettingsOverrides.browser). */
export function BrowserSection(): React.JSX.Element {
  const br = useSettings((s) => s.value.app.browser)
  const save = useSettings((s) => s.save)
  const [error, run] = useSaveError()
  const set = (patch: Partial<BrowserSettings>): void => run(save({ browser: patch }))

  return (
    <>
      <SectionTitle title="Trình duyệt" desc="Trình duyệt trong app (nút Browser trên thanh trên) và việc agent dùng nó. Thay đổi được lưu ngay." />
      <ErrorBar error={error} />

      <Group title="Duyệt web">
        <HomePageRow value={br.homePage} onSave={(homePage) => set({ homePage })} />
        <Row label="Máy tìm kiếm" desc="Chữ gõ vào thanh địa chỉ không phải địa chỉ web thì tìm bằng máy này.">
          <Select
            label="Máy tìm kiếm"
            value={br.searchEngine}
            onChange={(searchEngine: SearchEngine) => set({ searchEngine })}
            options={(Object.keys(SEARCH_ENGINE_LABELS) as SearchEngine[]).map((v) => ({ value: v, label: SEARCH_ENGINE_LABELS[v] }))}
          />
        </Row>
      </Group>

      <AgentToolsGroup run={run} />

      <Group title="Agent mở trang ngoài localhost">
        <Row label="Khi agent mở trang ngoài" desc={EXTERNAL[br.externalPages].desc}>
          <Select
            label="Khi agent mở trang ngoài"
            value={br.externalPages}
            onChange={(externalPages: ExternalPagePolicy) => set({ externalPages })}
            options={(Object.keys(EXTERNAL) as ExternalPagePolicy[]).map((v) => ({ value: v, label: EXTERNAL[v].label }))}
          />
        </Row>
        <AllowedOrigins list={br.allowedOrigins} moot={br.externalPages === 'allow'} onSave={(allowedOrigins) => set({ allowedOrigins })} />
      </Group>

      <Group title="Cookie & dữ liệu trang">
        <Row
          label="Giữ cookie sau khi tắt app"
          desc="Giữ đăng nhập của các trang (mỗi workspace riêng). Áp dụng cho tab mở sau khi đổi; tab đang mở giữ như cũ."
        >
          <Switch label="Giữ cookie sau khi tắt app" checked={br.keepCookies} onChange={(keepCookies) => set({ keepCookies })} />
        </Row>
        <ClearDataRow />
      </Group>
    </>
  )
}

/** Trang tab mới: lưu khi rời ô / Enter; gõ sai thì báo, không lưu. */
function HomePageRow({ value, onSave }: { value: string; onSave: (v: string) => void }): React.JSX.Element {
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
      label="Trang tab mới"
      htmlFor="browser-home"
      desc={
        bad ? (
          <span className="text-red-300">Cần một địa chỉ web, vd. localhost:5173 hoặc github.com.</span>
        ) : (
          'Trang mở khi bấm "+" trong trình duyệt. Bỏ trống = trang trống.'
        )
      }
    >
      <input
        id="browser-home"
        value={text}
        placeholder="(trang trống)"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`w-72 ${input} ${bad ? 'border-red-500/60' : ''}`}
      />
    </Row>
  )
}

/** Danh sách origin luôn cho agent mở: thêm (chuẩn hoá, báo lỗi nếu sai) / bỏ. */
function AllowedOrigins({ list, moot, onSave }: { list: string[]; moot: boolean; onSave: (v: string[]) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const [bad, setBad] = useState('')
  const add = (): void => {
    const t = text.trim()
    if (!t) return
    const o = originInput(t)
    if (!o) return setBad('Không phải địa chỉ web http(s).')
    if (list.includes(o)) return setBad(`${o} đã có trong danh sách.`)
    setBad('')
    setText('')
    onSave([...list, o])
  }
  return (
    <>
      <Row
        label="Trang luôn cho phép"
        desc={
          bad ? (
            <span className="text-red-300">{bad}</span>
          ) : moot ? (
            'Đang "Luôn cho" nên danh sách này chưa cần; nó có tác dụng khi bạn chuyển về "Hỏi bạn" hoặc "Luôn chặn".'
          ) : (
            'Agent mở các origin này mà không hỏi, kể cả sau khi mở lại app. Hộp thoại "Agent muốn mở trang ngoài" có nút "Luôn cho trang này".'
          )
        }
      >
        <input
          aria-label="Origin luôn cho phép"
          value={text}
          placeholder="github.com"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setBad('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className={`w-56 ${input} ${bad ? 'border-red-500/60' : ''}`}
        />
        <SmallButton onClick={add} disabled={!text.trim()}>
          Thêm
        </SmallButton>
      </Row>
      {list.map((o) => (
        <Row key={o} label={<span className="font-mono text-[12.5px]">{o}</span>}>
          <SmallButton onClick={() => onSave(list.filter((x) => x !== o))}>Bỏ</SmallButton>
        </Row>
      ))}
    </>
  )
}

/** "Cho agent dùng trình duyệt" theo cấp: mặc định cho mọi agent → workspace → agent. */
function AgentToolsGroup({ run }: { run: (p: Promise<unknown>) => void }): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [key, setKey] = useState<LevelKey>('app')
  const level = useLevel(key)

  const mark = (o?: { browser?: { agentTools?: boolean } }): string => (o?.browser?.agentTools !== undefined ? ' •' : '')
  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${mark(settings.workspaces[w.id])}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${mark(settings.agents[a.id])}` }))
    ])
  ]

  const own = level.lvl === 'ws' ? settings.workspaces[level.wsId!]?.browser?.agentTools : level.lvl === 'agent' ? settings.agents[level.agentId!]?.browser?.agentTools : undefined
  const parent = level.lvl === 'agent' ? browserToolsOn(settings, level.wsId, null) : settings.app.browser.agentTools
  const setOwn = (v: 'inherit' | 'on' | 'off'): void =>
    run(
      saveOverrides(level.lvl === 'ws' ? 'workspace' : 'agent', level.lvl === 'ws' ? level.wsId! : level.agentId!, {
        browser: v === 'inherit' ? null : { agentTools: v === 'on' }
      })
    )

  return (
    <Group title="Agent dùng trình duyệt">
      <Row label="Áp dụng cho" desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó. Dấu • = có cài đặt riêng.">
        <Select label="Cấp áp dụng trình duyệt" value={level.lvl === 'app' ? 'app' : key} onChange={setKey} options={options} />
      </Row>
      <Row
        label="Cho agent dùng trình duyệt"
        desc="Tool browser_* (mở trang, đọc trang, bấm, gõ, chụp màn hình, console). Tắt thì phiên mở sau không thấy các tool này; phiên đang chạy gọi tool sẽ bị từ chối ngay."
      >
        {level.lvl === 'app' ? (
          <Switch label="Cho mọi agent dùng trình duyệt" checked={settings.app.browser.agentTools} onChange={(agentTools) => run(save({ browser: { agentTools } }))} />
        ) : (
          <Select
            label={`Trình duyệt cho ${level.name}`}
            value={own === undefined ? 'inherit' : own ? 'on' : 'off'}
            onChange={setOwn}
            options={[
              { value: 'inherit', label: `Theo cấp trên (${parent ? 'bật' : 'tắt'})` },
              { value: 'on', label: 'Bật' },
              { value: 'off', label: 'Tắt' }
            ]}
          />
        )}
      </Row>
    </Group>
  )
}

/** Xoá cookie và dữ liệu trang (một workspace hoặc tất cả); bấm hai lần để chắc chắn. */
function ClearDataRow(): React.JSX.Element {
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
      label="Xoá cookie và dữ liệu trang"
      desc={
        error ? (
          <span className="text-red-300">{error}</span>
        ) : state === 'done' ? (
          'Đã xoá. Trang đang mở có thể cần tải lại.'
        ) : (
          'Đăng xuất khỏi mọi trang và xoá dữ liệu trang lưu (localStorage, cache…) của trình duyệt trong app.'
        )
      }
    >
      <Select
        label="Xoá dữ liệu của"
        value={scope}
        onChange={(v) => {
          setTarget(v)
          setConfirm(false)
          setState('')
        }}
        options={[{ value: '', label: 'Mọi workspace' }, ...workspaces.map((w) => ({ value: w.id, label: `Workspace: ${w.name}` }))]}
      />
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={() => (confirm ? void clear() : (setConfirm(true), setState('')))}
        className={`rounded-md px-3 py-1.5 text-[12.5px] disabled:opacity-40 ${confirm ? 'bg-red-500/90 text-white' : 'bg-panel-2 text-red-300 hover:bg-line'}`}
      >
        {state === 'busy' ? 'Đang xoá…' : confirm ? 'Bấm lần nữa để xoá' : 'Xoá'}
      </button>
    </Row>
  )
}
