import { useState } from 'react'
import { ALWAYS_SHARED, parseScope, projectRel } from '@shared/scope'
import { resolveScope } from '@shared/settings'
import { agentKind, type ScopeLockSettings, type ScopeMode } from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, Row, SectionTitle, Select, SmallButton, Switch, useSaveError } from './controls'

const MODES: Array<{ value: ScopeMode; label: string; desc: string }> = [
  {
    value: 'ask',
    label: 'Hỏi bạn',
    desc: 'Claude hỏi ngay trong terminal của nó (hộp xin quyền, kèm lý do); Codex: app hiện hộp thoại, chờ bạn cho sửa hay từ chối.'
  },
  { value: 'block', label: 'Chặn luôn', desc: 'Không hỏi: agent bị từ chối, kèm lời nhắn bàn với bạn hoặc với agent kia trước.' },
  { value: 'warn', label: 'Chỉ cảnh báo', desc: 'Cho sửa. Vẫn cảnh báo agent khi nhận việc trùng phạm vi và hiện ⚠ trên kanban.' },
  { value: 'off', label: 'Tắt', desc: 'Không khoá, không cảnh báo.' }
]
const modeLabel = (m: ScopeMode): string => MODES.find((x) => x.value === m)!.label

/** Cài đặt → Khoá phạm vi (Settings S5): app.scope + ghi đè workspace / agent (SettingsOverrides.scope). */
export function ScopeSection(): React.JSX.Element {
  const settings = useSettings((s) => s.value)
  const save = useSettings((s) => s.save)
  const saveOverrides = useSettings((s) => s.saveOverrides)
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const [level, setLevel] = useState<LevelKey>('app')
  const [error, run] = useSaveError()
  const cur = useLevel(level)
  const ws = workspaces.find((w) => w.id === cur.wsId)

  const own: Partial<ScopeLockSettings> =
    cur.lvl === 'ws' ? (settings.workspaces[cur.wsId!]?.scope ?? {}) : cur.lvl === 'agent' ? (settings.agents[cur.agentId!]?.scope ?? {}) : settings.app.scope
  const parent: ScopeLockSettings = cur.lvl === 'agent' ? resolveScope(settings, cur.wsId, null) : settings.app.scope
  const parentName = cur.lvl === 'agent' ? `workspace ${ws?.name ?? ''}` : 'mặc định của app'
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

  const has = (o?: { scope?: Partial<ScopeLockSettings> }): string => (o?.scope ? ' •' : '')
  const options = [
    { value: 'app', label: 'Mặc định cho mọi agent' },
    ...workspaces.flatMap((w) => [
      { value: `ws:${w.id}`, label: `Workspace: ${w.name}${has(settings.workspaces[w.id])}` },
      ...(byWs[w.id]?.agents ?? [])
        .filter((a) => agentKind(a) !== 'terminal')
        .map((a) => ({ value: `agent:${w.id}:${a.id}`, label: `↳ Agent: ${a.name}${has(settings.agents[a.id])}` }))
    ])
  ]

  const modeValue: ScopeMode | 'inherit' = cur.lvl !== 'app' && !own.mode ? 'inherit' : effective.mode
  const shellOn = effective.guessShell

  return (
    <>
      <SectionTitle
        title="Khoá phạm vi"
        desc="Mỗi việc đang mở trên kanban giữ một vùng code: phạm vi agent khai khi nhận việc (task_start) cộng các file agent đó đã sửa. Agent khác định sửa vào vùng đó thì app làm theo chế độ dưới đây; việc xong hoặc bị bỏ thì nhả khoá. Thay đổi có tác dụng ngay, cả với phiên đang chạy."
      />
      <ErrorBar error={error} />

      <Group title="Áp dụng cho">
        <Row
          label="Cấp"
          desc="Workspace ghi đè mặc định của app; agent ghi đè workspace của nó (chỉ chế độ). Chế độ tính theo agent đang định sửa; dấu ⚠ trên kanban theo cấp workspace. Dấu • = đang có giá trị riêng."
        >
          <Select label="Cấp cài đặt khoá phạm vi" value={cur.lvl === 'app' ? 'app' : level} onChange={setLevel} options={options} />
        </Row>
      </Group>

      <Group title="Khi agent định sửa vào phạm vi của agent khác">
        {cur.lvl !== 'app' && (
          <ModeOption
            checked={modeValue === 'inherit'}
            onChange={() => setField('mode', undefined)}
            label={`Theo ${parentName} (${modeLabel(parent.mode)})`}
          />
        )}
        {MODES.map((m) => (
          <ModeOption key={m.value} checked={modeValue === m.value} onChange={() => setField('mode', m.value)} label={m.label} desc={m.desc} />
        ))}
      </Group>

      <Group title="Lệnh shell">
        <Row
          label="Đoán lệnh shell"
          desc={
            <>
              Lệnh Bash / PowerShell (Codex: exec_command) có dấu hiệu ghi (<code>&gt;</code>, rm, mv, cp, Set-Content, sed -i, git checkout…) và nhắc tới
              đường dẫn đang bị khoá thì coi như sửa chỗ đó. Chỉ là đoán: bỏ sót script hoặc lệnh không ghi rõ đường dẫn, đôi khi hỏi thừa lệnh chỉ đọc file
              bị khoá. Tắt thì chỉ xét tool sửa file (Edit / Write, apply_patch).
              {cur.lvl === 'agent' && ` Đang theo ${parentName}.`}
            </>
          }
          disabled={effective.mode === 'off'}
        >
          {cur.lvl === 'app' ? (
            <Switch label="Đoán lệnh shell" checked={shellOn} disabled={effective.mode === 'off'} onChange={(v) => setField('guessShell', v)} />
          ) : cur.lvl === 'ws' ? (
            <Select
              label={`Đoán lệnh shell cho ${cur.name}`}
              value={'guessShell' in own ? (own.guessShell ? 'on' : 'off') : 'inherit'}
              disabled={effective.mode === 'off'}
              onChange={(v) => setField('guessShell', v === 'inherit' ? undefined : v === 'on')}
              options={[
                { value: 'inherit', label: `Theo ${parentName} (${parent.guessShell ? 'bật' : 'tắt'})` },
                { value: 'on', label: 'Bật' },
                { value: 'off', label: 'Tắt' }
              ]}
            />
          ) : (
            <span className="text-[12.5px] text-muted">{shellOn ? 'Bật' : 'Tắt'}</span>
          )}
        </Row>
      </Group>

      <Group title="Không bao giờ khoá">
        <div className={`px-4 py-3 ${effective.mode === 'off' ? 'opacity-50' : ''}`}>
          <div className="text-[12px] leading-relaxed text-muted">
            Agent luôn sửa được các chỗ này, phạm vi trùng ở đây cũng không bị cảnh báo. Mẫu viết như phạm vi việc, tương đối so với thư mục dự án, không
            phân biệt hoa thường: <code>docs/</code>, <code>package-lock.json</code>, <code>**/*.snap</code> (mọi thư mục), <code>*.md</code> (chỉ ở gốc dự án).
            {cur.lvl === 'ws' && ' Cộng thêm với danh sách của app.'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip title="Bộ nhớ chung: agent nào cũng ghi log / index">{ws ? vaultLabel(ws.path, ws.vaultPath) : 'vault của workspace'}</Chip>
            {ALWAYS_SHARED.map((p) => (
              <Chip key={p} title="Dữ liệu của app / git">
                {p}/
              </Chip>
            ))}
            {cur.lvl !== 'app' &&
              settings.app.scope.exempt.map((p) => (
                <Chip key={`app:${p}`} title="Từ mặc định của app">
                  {p}
                </Chip>
              ))}
            {cur.lvl === 'agent' &&
              (settings.workspaces[cur.wsId!]?.scope?.exempt ?? []).map((p) => (
                <Chip key={`ws:${p}`} title={`Từ ${parentName}`}>
                  {p}
                </Chip>
              ))}
          </div>
          {cur.lvl === 'agent' ? (
            <div className="mt-2 text-[12px] text-muted">Danh sách miễn khoá đặt ở cấp app và workspace.</div>
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

/** Một lựa chọn chế độ trong nhóm (dòng có nút tròn và một dòng giải thích). */
function ModeOption({ checked, onChange, label, desc }: { checked: boolean; onChange: () => void; label: string; desc?: string }): React.JSX.Element {
  return (
    <label className={`flex cursor-pointer gap-2.5 px-4 py-2.5 ${checked ? 'bg-accent/10' : 'hover:bg-panel-2/60'}`}>
      <input type="radio" name="scope-mode" checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px]">{label}</span>
        {desc && <span className="mt-0.5 block text-[12px] leading-snug text-muted">{desc}</span>}
      </span>
    </label>
  )
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }): React.JSX.Element {
  return (
    <span title={title} className="rounded-full border border-line px-2 py-px font-mono text-[11px] text-muted">
      {children}
    </span>
  )
}

/** Thư mục vault so với dự án (vault nằm ngoài dự án thì vốn không bị khoá). */
function vaultLabel(root: string, vaultPath: string): string {
  const rel = projectRel(vaultPath, root)
  const name = vaultPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'vault'
  return rel === null ? `${name} (ngoài dự án)` : `${name}/`
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
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const input = 'rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-accent'
  const add = (): void => {
    const t = text.trim()
    if (!t) return
    // Kiểm theo một thư mục giả khi ở cấp app (chưa biết dự án nào).
    const entries = parseScope(t, root ?? 'C:/project')
    if (!entries.length) return setProblem('Không đọc được mẫu này (đường dẫn ngoài dự án?).')
    if (entries.some((e) => e.key === '' && !e.glob)) return setProblem('Mẫu này là cả dự án. Muốn bỏ khoá hẳn thì chọn chế độ "Tắt".')
    if (items.includes(t) || inherited.includes(t)) return setProblem('Đã có trong danh sách.')
    onChange([...items, t])
    setText('')
    setProblem('')
  }
  return (
    <div className="mt-3">
      {items.map((p) => (
        <div key={p} className="flex items-center gap-2 border-t border-line py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{p}</span>
          <button
            type="button"
            aria-label={`Bỏ ${p}`}
            onClick={() => onChange(items.filter((x) => x !== p))}
            className="rounded px-1.5 text-muted hover:bg-line hover:text-fg"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="mt-2 flex gap-1.5">
        <input
          aria-label="Mẫu miễn khoá mới"
          value={text}
          placeholder="vd. docs/ hoặc **/*.snap"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            setProblem('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className={`${input} flex-1`}
        />
        <SmallButton onClick={add} disabled={!text.trim()}>
          Thêm
        </SmallButton>
      </div>
      {problem && <div className="mt-1 text-[11.5px] text-red-300">{problem}</div>}
    </div>
  )
}
