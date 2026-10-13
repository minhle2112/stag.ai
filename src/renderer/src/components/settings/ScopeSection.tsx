import { useState } from 'react'
import { ALWAYS_SHARED, parseScope, projectRel } from '@shared/scope'
import { resolveScope } from '@shared/settings'
import { type ScopeLockSettings, type ScopeMode } from '@shared/types'
import { useSettings } from '../../store/settings'
import { useWorkspaces } from '../../store/workspaces'
import { Icon } from '../Icon'
import { Seg } from '../ui/Seg'
import { LevelBar, useLevel, type LevelKey } from './levels'
import { ErrorBar, Group, INPUT_MONO, InfoTip, Row, SectionTitle, SmallButton, Switch, useSaveError } from './controls'

const MODES: Array<{ value: ScopeMode; label: string; desc: string }> = [
  {
    value: 'ask',
    label: 'Hỏi bạn',
    desc: 'Claude hỏi ngay trong terminal của nó (hộp xin quyền, kèm lý do); Codex: app hiện hộp thoại, chờ bạn cho sửa hay từ chối.'
  },
  {
    value: 'block',
    label: 'Chặn luôn',
    desc: 'Không bao giờ hỏi bạn: agent bị từ chối và tự bàn với agent kia (xem việc của nó, nhắn nhờ thu hẹp phạm vi hay báo khi xong), trong lúc chờ thì làm phần khác của việc mình.'
  },
  { value: 'warn', label: 'Chỉ cảnh báo', desc: 'Cho sửa. Vẫn cảnh báo agent khi nhận việc trùng phạm vi.' },
  { value: 'off', label: 'Tắt', desc: 'Không khoá, không cảnh báo.' }
]
const modeLabel = (m: ScopeMode): string => MODES.find((x) => x.value === m)!.label

/** Cài đặt → Khoá phạm vi (Settings S5): app.scope + ghi đè workspace / agent (SettingsOverrides.scope). */
export function ScopeSection(): React.JSX.Element {
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

  const shellOn = effective.guessShell
  const off = effective.mode === 'off'

  return (
    <>
      <SectionTitle
        title="Khoá phạm vi"
        desc="Mỗi việc đang mở của agent giữ một vùng code: phạm vi agent khai khi nhận việc (task_start) cộng các file agent đó đã sửa. Agent khác định sửa vào vùng đó thì app làm theo chế độ dưới đây; việc xong hoặc bị bỏ thì nhả khoá. Thay đổi có tác dụng ngay, cả với phiên đang chạy."
        right={<LevelBar level={level} setLevel={setLevel} has={(o) => !!o?.scope} />}
      />
      <ErrorBar error={error} />

      <Group>
        <Row
          label="Khi agent định sửa vào phạm vi của agent khác"
          desc="Chế độ tính theo agent đang định sửa. Rê chuột vào từng chế độ để xem nghĩa."
          override={
            cur.lvl === 'app' ? undefined : { on: !!own.mode, onReset: () => setField('mode', undefined), parent: modeLabel(parent.mode) }
          }
        >
          <Seg
            value={effective.mode}
            onChange={(mode) => setField('mode', mode)}
            options={MODES.map((m) => ({ value: m.value, label: m.label, tip: m.desc }))}
          />
        </Row>
        <Row
          label="Đoán lệnh shell"
          desc={`Lệnh Bash / PowerShell (Codex: exec_command) có dấu hiệu ghi (>, rm, mv, cp, Set-Content, sed -i, git checkout…) và nhắc tới đường dẫn đang bị khoá thì coi như sửa chỗ đó. Chỉ là đoán: bỏ sót script hoặc lệnh không ghi rõ đường dẫn, đôi khi hỏi thừa lệnh chỉ đọc file bị khoá. Tắt thì chỉ xét tool sửa file (Edit / Write, apply_patch).${cur.lvl === 'agent' ? ` Cấp agent theo ${parentName}.` : ''}`}
          disabled={off}
          override={
            cur.lvl === 'ws'
              ? { on: 'guessShell' in own, onReset: () => setField('guessShell', undefined), parent: parent.guessShell ? 'bật' : 'tắt' }
              : undefined
          }
        >
          <Switch
            label={cur.lvl === 'app' ? 'Đoán lệnh shell' : `Đoán lệnh shell cho ${cur.name}`}
            checked={shellOn}
            disabled={off || cur.lvl === 'agent'}
            onChange={(v) => setField('guessShell', v)}
          />
        </Row>
      </Group>

      <Group
        title={
          <span className="inline-flex items-center gap-1.5">
            Không bao giờ khoá
            <InfoTip
              text={`Agent luôn sửa được các chỗ này, phạm vi trùng ở đây cũng không bị cảnh báo. Mẫu viết như phạm vi việc, tương đối so với thư mục dự án, không phân biệt hoa thường: docs/, package-lock.json, **/*.snap (mọi thư mục), *.md (chỉ ở gốc dự án).${cur.lvl === 'ws' ? ' Cộng thêm với danh sách của app.' : ''}`}
            />
          </span>
        }
      >
        <div className={`border-b border-line py-2.5 ${off ? 'opacity-50' : ''}`}>
          <div className="flex flex-wrap gap-1">
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
            <div className="mt-2 text-[12px] text-dim">Danh sách miễn khoá đặt ở cấp app và workspace.</div>
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
    <div className="mt-2">
      {items.map((p) => (
        <div key={p} className="flex items-center gap-2 border-t border-line py-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{p}</span>
          <button
            type="button"
            aria-label={`Bỏ ${p}`}
            data-tip="Bỏ mẫu này"
            onClick={() => onChange(items.filter((x) => x !== p))}
            className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-panel-3 hover:text-fg"
          >
            <Icon name="x" size="s" />
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
          className={`${INPUT_MONO} min-w-0 flex-1`}
        />
        <SmallButton icon="plus" onClick={add} disabled={!text.trim()}>
          Thêm
        </SmallButton>
      </div>
      {problem && <div className="mt-1 text-[12px] text-danger">{problem}</div>}
    </div>
  )
}
