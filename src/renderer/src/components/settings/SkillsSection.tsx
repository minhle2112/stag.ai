import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { parseSkillMd, SKILL_DESC_MAX, SKILL_NAME_RE, skillOn, splitSkillMd } from '@shared/skills'
import {
  agentKind,
  type CliAdapterId,
  type InheritedSkill,
  type LibrarySkill,
  type SkillCatalogEntry,
  type SkillDoc,
  type SkillImportResult,
  type SkillScan,
  type SkillSource
} from '@shared/types'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useSkills } from '../../store/skills'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Button, Modal } from '../Modal'
import { renderNote } from '../vault/markdown'
import { noteHighlight, noteTheme } from '../vault/NoteEditor'
import { Badge, errText } from './AdaptersSection'
import { ErrorBar, SmallButton } from './controls'
import { LevelPicker, LevelToggle, setAtLevel, useAgentLevel, useLevel, type Level, type LevelKey } from './levels'

/**
 * Settings → Skill (bố cục theo trang Skills của Paperclip):
 * - Đã cài: thư viện của stag.ai (app đưa vào phiên Claude Code qua --add-dir, Codex / adapter ngoài qua luật phiên)
 *   + skill Claude Code / Codex tự nạp (chỉ tắt bớt cho phiên agent).
 * - Khám phá: danh mục kèm app (resources/skill-catalog).
 * Bật / tắt theo cấp app → workspace → agent.
 */

type Tab = 'installed' | 'discover'
type Detail = { type: 'lib'; name: string; edit?: boolean } | { type: 'cli'; skill: InheritedSkill } | { type: 'catalog'; slug: string }

const RUNTIME: Record<CliAdapterId, string> = { claude: 'Claude Code', codex: 'Codex' }
const SCOPE: Record<InheritedSkill['scope'], string> = {
  user: 'user',
  project: 'dự án',
  'claude.ai': 'claude.ai',
  plugin: 'plugin',
  repo: 'dự án',
  system: 'hệ thống',
  admin: 'admin'
}
const SOURCE: Record<SkillSource['kind'], string> = {
  created: 'Bạn tạo',
  folder: 'Nhập từ thư mục',
  zip: 'Nhập từ .zip',
  catalog: 'Từ danh mục',
  claude: 'Chép từ Claude Code',
  codex: 'Chép từ Codex'
}

/** Kết quả quét giữ lại khi chuyển trang. */
const scanCache: Partial<Record<CliAdapterId, SkillScan>> = {}

/** Lưu bật / tắt ở cấp app (vắng = bật). */
const skillSetApp =
  (k: string) =>
  (on: boolean): Promise<void> => {
    const toggles = { ...useSettings.getState().value.app.skills.toggles }
    if (on) delete toggles[k]
    else toggles[k] = false
    return useSettings.getState().save({ skills: { toggles } })
  }

/** Skill vừa thêm khi đang xem cấp workspace / agent: tắt ở app, bật riêng ở cấp đó. */
async function enableOnlyAt(level: Level, names: string[]): Promise<void> {
  if (level.lvl === 'app' || !names.length) return
  const st = useSettings.getState().value
  await useSettings.getState().save({ skills: { toggles: { ...st.app.skills.toggles, ...Object.fromEntries(names.map((n) => [n, false])) } } })
  for (const n of names) await setAtLevel(level, 'skills', n, true)
}

function importSummary(r: SkillImportResult): string {
  const parts: string[] = []
  if (r.added.length) parts.push(`Đã thêm: ${r.added.join(', ')}.`)
  if (r.skipped.length) parts.push(`Bỏ qua: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`)
  return parts.join(' ') || 'Không có gì để thêm.'
}

/** Quét skill Claude Code / Codex cho thư mục của workspace (Claude: đọc đĩa; Codex: hỏi `codex app-server`). */
function useSkillScans(wsId: string | undefined): { scans: Partial<Record<CliAdapterId, SkillScan>>; busy: Partial<Record<CliAdapterId, boolean>>; scan: (r: CliAdapterId) => void } {
  const [scans, setScans] = useState<Partial<Record<CliAdapterId, SkillScan>>>({ ...scanCache })
  const [busy, setBusy] = useState<Partial<Record<CliAdapterId, boolean>>>({})
  const scan = (runtime: CliAdapterId): void => {
    setBusy((b) => ({ ...b, [runtime]: true }))
    window.stag.skills
      .scan(runtime, wsId)
      .then((r) => {
        scanCache[runtime] = r
        setScans((s) => ({ ...s, [runtime]: r }))
      })
      .catch((e) => setScans((s) => ({ ...s, [runtime]: { runtime, cwd: '', skills: [], error: errText(e), scannedAt: new Date().toISOString() } })))
      .finally(() => setBusy((b) => ({ ...b, [runtime]: false })))
  }
  useEffect(() => {
    // Quét lại khi đổi workspace (skill của dự án khác nhau).
    for (const r of ['claude', 'codex'] as const) if (!scanCache[r] || scanCache[r]!.cwd === '' || wsId) scan(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId])
  return { scans, busy, scan }
}

/** Số agent đang bật một khoá: skill có sẵn của một CLI chỉ tính agent chạy CLI đó; skill thư viện tính mọi agent (trừ ô terminal). */
function useAgentCount(): (key: string) => number {
  const settings = useSettings((s) => s.value)
  const byWs = useAgents((s) => s.byWs)
  return (key) => {
    const only = key.startsWith('codex:') ? 'codex' : /^claude(-plugin)?:/.test(key) ? 'claude' : null
    let n = 0
    for (const [wsId, w] of Object.entries(byWs))
      for (const a of w.agents) {
        const kind = agentKind(a)
        if (kind !== 'terminal' && (!only || kind === only) && skillOn(settings, key, wsId, a.id)) n++
      }
    return n
  }
}

export function SkillsSection(): React.JSX.Element {
  const focus = useUi((s) => s.settingsFocus)
  const agentLevel = useAgentLevel()
  const library = useSkills((s) => s.library)
  const catalog = useSkills((s) => s.catalog)
  const activeWs = useWorkspaces((s) => s.activeId)
  const [tab, setTab] = useState<Tab>('installed')
  const [detail, setDetail] = useState<Detail | null>(focus?.skill ? { type: 'lib', name: focus.skill } : null)
  const [level, setLevel] = useState<LevelKey>(() => agentLevel(focus?.agentId))
  const [creating, setCreating] = useState(false)
  const [msg, setMsg] = useState('')
  const lv = useLevel(level)
  const { scans, busy, scan } = useSkillScans(lv.wsId ?? activeWs ?? undefined)
  /** Mở trang chi tiết; skill thư viện / có sẵn thuộc mục Đã cài. */
  const open = (d: Detail | null): void => {
    if (d && d.type !== 'catalog') setTab('installed')
    setDetail(d)
  }

  useEffect(() => {
    if (focus?.agentId) {
      setTab('installed')
      setLevel(agentLevel(focus.agentId))
      setDetail(null)
    }
    if (focus?.skill) setDetail({ type: 'lib', name: focus.skill })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  /** Kết quả nhập / cài / chép: cập nhật danh sách, bật đúng cấp, báo lại. */
  const afterImport = async (r: SkillImportResult | null): Promise<string[]> => {
    if (!r) return []
    useSkills.getState().set(r.list)
    await enableOnlyAt(lv, r.added).catch(() => {})
    setMsg(importSummary(r))
    return r.added
  }
  const doImport = (kind: 'folder' | 'zip'): void => {
    setMsg('')
    window.stag.skills
      .import(kind)
      .then(afterImport)
      .catch((e) => setMsg(errText(e)))
  }

  const navItem = (id: Tab, label: string, icon: ReactNode, count?: number): React.JSX.Element => (
    <button
      type="button"
      onClick={() => {
        setTab(id)
        setDetail(null)
      }}
      aria-current={tab === id && !detail}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] ${tab === id ? 'bg-panel-2 font-medium text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count ? <span className="rounded-full bg-line/70 px-1.5 text-[10.5px] tabular-nums text-muted">{count}</span> : null}
    </button>
  )

  return (
    <>
      <div className="-mt-2 mb-4 flex items-center gap-2 border-b border-line pb-3">
        <BookIcon className="h-4 w-4 text-muted" />
        <span className="text-[12.5px] font-semibold uppercase tracking-wider">Skill</span>
        <span className="rounded-full border border-line px-2 py-px text-[10.5px] text-muted">SKILL.md</span>
      </div>
      <div className="flex gap-6">
        <nav className="w-40 shrink-0" aria-label="Skill">
          {navItem('installed', 'Đã cài', <BookIcon className="h-4 w-4" />, library.length)}
          {navItem('discover', 'Khám phá', <CompassIcon className="h-4 w-4" />, catalog.length)}
          <div className="mt-4 border-t border-line px-2.5 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Tự viết</div>
          <p className="mt-1 px-2.5 text-[11.5px] leading-snug text-muted">Skill bạn tạo, sửa, nhập.</p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-1.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-panel-2 hover:text-fg"
          >
            <PenIcon className="h-4 w-4" /> Tạo skill
          </button>
        </nav>
        <div className="min-w-0 flex-1">
          {detail ? (
            <SkillDetail
              key={detail.type === 'lib' ? `lib:${detail.name}` : detail.type === 'cli' ? `cli:${detail.skill.path}` : `cat:${detail.slug}`}
              detail={detail}
              level={lv}
              claudeNames={claudeNames(scans.claude)}
              onBack={() => setDetail(null)}
              onOpen={open}
              afterImport={afterImport}
            />
          ) : tab === 'installed' ? (
            <InstalledView
              level={level}
              setLevel={setLevel}
              lv={lv}
              scans={scans}
              busy={busy}
              scan={scan}
              msg={msg}
              onOpen={open}
              onCreate={() => setCreating(true)}
              onImport={doImport}
              onCopy={(s) => {
                setMsg('')
                window.stag.skills
                  .copy(s.runtime, s.path)
                  .then(afterImport)
                  .catch((e) => setMsg(errText(e)))
              }}
            />
          ) : (
            <DiscoverView
              onOpen={(slug) => setDetail({ type: 'catalog', slug })}
              onInstall={(slug) =>
                window.stag.skills
                  .install(slug)
                  .then(afterImport)
                  .then((added) => added[0] && open({ type: 'lib', name: added[0] }))
                  .catch((e) => setMsg(errText(e)))
              }
              msg={msg}
            />
          )}
        </div>
      </div>
      {creating && (
        <CreateSkillDialog
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false)
            await enableOnlyAt(lv, [name]).catch(() => {})
            open({ type: 'lib', name, edit: true })
          }}
        />
      )}
    </>
  )
}

const claudeNames = (scan?: SkillScan): Set<string> => new Set((scan?.skills ?? []).filter((s) => s.scope !== 'plugin').map((s) => s.name))

// ---- Đã cài ----

function InstalledView(p: {
  level: LevelKey
  setLevel: (l: LevelKey) => void
  lv: Level
  scans: Partial<Record<CliAdapterId, SkillScan>>
  busy: Partial<Record<CliAdapterId, boolean>>
  scan: (r: CliAdapterId) => void
  msg: string
  onOpen: (d: Detail) => void
  onCreate: () => void
  onImport: (kind: 'folder' | 'zip') => void
  onCopy: (s: InheritedSkill) => void
}): React.JSX.Element {
  const library = useSkills((s) => s.library)
  const loaded = useSkills((s) => s.loaded)
  const count = useAgentCount()
  const [q, setQ] = useState('')
  const match = (name: string, desc: string): boolean => !q.trim() || `${name} ${desc}`.toLowerCase().includes(q.trim().toLowerCase())
  const claude = claudeNames(p.scans.claude)
  const lib = library.filter((s) => match(s.name, s.description))

  return (
    <>
      <div className="mb-1 flex items-center gap-2.5">
        <h1 className="text-[18px] font-semibold tracking-tight">Skill đã cài</h1>
        <div className="flex-1" />
        <SmallButton onClick={() => p.onImport('folder')}>Nhập thư mục…</SmallButton>
        <SmallButton onClick={() => p.onImport('zip')}>Nhập .zip…</SmallButton>
        <button
          type="button"
          onClick={p.onCreate}
          className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90"
        >
          <span className="text-[15px] leading-none">+</span> Tạo skill
        </button>
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Skill = thư mục có <code>SKILL.md</code>: hướng dẫn agent tự mở khi việc khớp mô tả. Skill trong thư viện của stag.ai dùng được cho Claude Code, Codex và
        adapter ngoài; skill có sẵn của từng CLI chỉ tắt bớt được cho phiên agent.
      </p>
      <LevelPicker level={p.level} setLevel={p.setLevel} field="skills" />
      <div className="mb-4 flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5">
        <SearchIcon className="h-4 w-4 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm skill…"
          aria-label="Tìm skill"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
        />
      </div>
      {p.msg && <div className="mb-3 rounded-md border border-line bg-panel-2/60 px-3 py-2 text-[12px]">{p.msg}</div>}

      <GroupHead icon={<BookIcon className="h-4 w-4 text-muted" />} count={library.length}>
        Thư viện của stag.ai
      </GroupHead>
      {!loaded ? null : library.length === 0 ? (
        <div className="mb-7 flex flex-col items-center rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <BookIcon className="mb-3 h-7 w-7 text-muted" />
          <div className="text-[13px] font-medium">Chưa có skill nào</div>
          <div className="mt-1 text-[12px] text-muted">Tạo mới, nhập thư mục / .zip, cài ở Khám phá, hoặc chép một skill có sẵn bên dưới.</div>
        </div>
      ) : (
        <div className="mb-7 divide-y divide-line rounded-lg border border-line bg-panel">
          {lib.length === 0 && <div className="px-4 py-4 text-[12.5px] text-muted">Không có skill nào khớp.</div>}
          {lib.map((s) => (
            <SkillRow
              key={s.name}
              name={s.name}
              by={SOURCE[s.source.kind]}
              description={s.description}
              problem={s.problem}
              warn={claude.has(s.name) ? 'Trùng tên skill có sẵn của Claude Code: phiên Claude dùng bản của Claude Code.' : undefined}
              footer={[`${s.files} file`, s.problem ? 'không đưa vào phiên' : `bật cho ${count(s.name)} agent`]}
              onOpen={() => p.onOpen({ type: 'lib', name: s.name })}
              control={<LevelToggle k={s.name} level={p.lv} label={s.name} field="skills" setApp={skillSetApp(s.name)} />}
            />
          ))}
        </div>
      )}

      {(['claude', 'codex'] as const).map((r) => (
        <InheritedGroup key={r} runtime={r} lv={p.lv} scan={p.scans[r]} busy={!!p.busy[r]} rescan={() => p.scan(r)} match={match} onOpen={p.onOpen} onCopy={p.onCopy} />
      ))}
    </>
  )
}

function InheritedGroup(p: {
  runtime: CliAdapterId
  lv: Level
  scan?: SkillScan
  busy: boolean
  rescan: () => void
  match: (name: string, desc: string) => boolean
  onOpen: (d: Detail) => void
  onCopy: (s: InheritedSkill) => void
}): React.JSX.Element {
  const library = useSkills((s) => s.library)
  const count = useAgentCount()
  const all = p.scan?.skills ?? []
  const own = all.filter((s) => s.scope !== 'plugin' && p.match(s.name, s.description))
  // Skill của plugin Claude Code: tắt cả plugin, gộp một dòng.
  const plugins = new Map<string, InheritedSkill[]>()
  for (const s of all) if (s.plugin) plugins.set(s.plugin, [...(plugins.get(s.plugin) ?? []), s])
  const pluginRows = [...plugins].filter(([id, list]) => p.match(id, list.map((s) => s.name).join(' ')))

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <ServerIcon className="h-4 w-4 text-muted" />
        Có sẵn trong {RUNTIME[p.runtime]}
        {all.length > 0 && <span className="text-[11.5px] font-normal text-muted">{all.length}</span>}
        <div className="flex-1" />
        <SmallButton onClick={p.rescan} disabled={p.busy}>
          {p.busy ? 'Đang quét…' : 'Quét lại'}
        </SmallButton>
      </div>
      <div className="mb-2 text-[12px] leading-relaxed text-muted">
        {p.runtime === 'claude' ? (
          <>
            <code>~/.claude/skills</code>, skill đồng bộ từ claude.ai, <code>.claude/skills</code> của dự án, plugin đã bật. Skill của plugin chỉ tắt được cả
            plugin. Tắt ở đây chỉ áp dụng cho phiên agent của stag.ai.
          </>
        ) : (
          <>
            <code>~/.codex/skills</code>, <code>~/.agents/skills</code>, <code>.agents/skills</code> của dự án, skill hệ thống của Codex (danh sách do chính Codex
            trả, không tốn quota). Tắt ở đây chỉ áp dụng cho phiên agent của stag.ai.
          </>
        )}
      </div>
      {p.scan?.cwd && (
        <div className="mb-2 truncate text-[11.5px] text-muted" title={p.scan.cwd}>
          Quét lúc {new Date(p.scan.scannedAt).toLocaleTimeString()} ở {p.scan.cwd}
        </div>
      )}
      {p.scan?.error && <ErrorBar error={p.scan.error} />}
      <div className="mb-7 divide-y divide-line rounded-lg border border-line bg-panel">
        {own.length + pluginRows.length === 0 ? (
          <div className="px-4 py-4 text-[12.5px] text-muted">{p.busy ? 'Đang quét…' : p.scan ? 'Không có skill nào.' : 'Chưa quét.'}</div>
        ) : (
          <>
            {own.map((s) => (
              <SkillRow
                key={s.path || s.name}
                name={s.name}
                by={SCOPE[s.scope]}
                description={s.description}
                footer={[s.disabledInCli ? 'đã tắt trong config.toml của bạn' : `bật cho ${count(s.toggleKey)} agent`]}
                onOpen={() => p.onOpen({ type: 'cli', skill: s })}
                control={
                  <>
                    {!library.some((l) => l.name === s.name) && s.path && (
                      <button
                        type="button"
                        title="Chép vào thư viện của stag.ai (dùng được cả với CLI khác / adapter ngoài)"
                        onClick={(e) => {
                          e.stopPropagation()
                          p.onCopy(s)
                        }}
                        className="rounded-md px-2 py-1 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg"
                      >
                        Chép
                      </button>
                    )}
                    <LevelToggle k={s.toggleKey} level={p.lv} label={s.name} field="skills" setApp={skillSetApp(s.toggleKey)} />
                  </>
                }
              />
            ))}
            {pluginRows.map(([id, list]) => (
              <SkillRow
                key={id}
                name={id.split('@')[0]}
                by={`plugin · ${id.split('@')[1] ?? ''}`}
                description={`${list.length} skill: ${list.map((s) => s.name.split(':').pop()).join(', ')}`}
                footer={[`bật cho ${count(`claude-plugin:${id}`)} agent`, 'tắt = tắt cả plugin trong phiên']}
                control={<LevelToggle k={`claude-plugin:${id}`} level={p.lv} label={`plugin ${id}`} field="skills" setApp={skillSetApp(`claude-plugin:${id}`)} />}
              />
            ))}
          </>
        )}
      </div>
    </>
  )
}

// ---- Khám phá ----

function DiscoverView({ onOpen, onInstall, msg }: { onOpen: (slug: string) => void; onInstall: (slug: string) => void; msg: string }): React.JSX.Element {
  const catalog = useSkills((s) => s.catalog)
  const library = useSkills((s) => s.library)
  const [q, setQ] = useState('')
  const list = catalog.filter((e) => !q.trim() || `${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <h1 className="mb-1 text-[18px] font-semibold tracking-tight">Khám phá skill</h1>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Skill dùng chung kèm app, lấy từ danh mục skill của Paperclip (MIT). Cài = chép vào thư viện của stag.ai để bật cho agent, sửa thoải mái.
      </p>
      <div className="mb-4 flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-1.5">
        <SearchIcon className="h-4 w-4 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm trong danh mục…"
          aria-label="Tìm trong danh mục"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
        />
      </div>
      {msg && <div className="mb-3 rounded-md border border-line bg-panel-2/60 px-3 py-2 text-[12px]">{msg}</div>}
      <div className="mb-2 text-[12px] text-muted">{list.length} skill</div>
      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {list.map((e) => {
          const installed = library.some((l) => l.name === e.name)
          return (
            <SkillRow
              key={e.slug}
              name={e.name}
              by="Danh mục · Paperclip"
              description={e.description}
              footer={[`${e.files} file`, ...e.tags.slice(0, 3)]}
              onOpen={() => onOpen(e.slug)}
              control={
                installed ? (
                  <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[11px] text-emerald-300">Đã cài</span>
                ) : (
                  <InstallButton onClick={() => onInstall(e.slug)} />
                )
              }
            />
          )
        })}
      </div>
    </>
  )
}

function InstallButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded-md border border-line px-3 py-1 text-[12px] font-medium hover:bg-panel-2"
    >
      Cài
    </button>
  )
}

// ---- dòng skill ----

const AVATAR = ['#22c55e', '#f59e0b', '#60a5fa', '#c084fc', '#f87171', '#2dd4bf', '#f472b6', '#a3e635']

export function SkillAvatar({ name, size = 34 }: { name: string; size?: number }): React.JSX.Element {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const letter = (name.split(':').pop() ?? name).replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-semibold text-black/80"
      style={{ width: size, height: size, background: AVATAR[h % AVATAR.length], fontSize: size * 0.42 }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

function SkillRow(p: {
  name: string
  by: string
  description: string
  footer: string[]
  problem?: string
  warn?: string
  control: ReactNode
  onOpen?: () => void
}): React.JSX.Element {
  return (
    <div
      role={p.onOpen ? 'button' : undefined}
      tabIndex={p.onOpen ? 0 : undefined}
      onClick={p.onOpen}
      onKeyDown={(e) => p.onOpen && e.key === 'Enter' && e.target === e.currentTarget && p.onOpen()}
      className={`group flex items-start gap-3 px-4 py-3 ${p.onOpen ? 'cursor-pointer hover:bg-panel-2/60' : ''}`}
    >
      <SkillAvatar name={p.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-mono text-[13px] font-medium">{p.name}</span>
          <span className="shrink-0 text-[11.5px] text-muted">{p.by}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">{p.description || <i>(không có mô tả)</i>}</div>
        {p.problem && <div className="mt-1 text-[11.5px] text-red-300">{p.problem}</div>}
        {p.warn && <div className="mt-1 text-[11.5px] text-amber-300/90">{p.warn}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {p.footer.filter(Boolean).map((f) => (
            <Badge key={f}>{f}</Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-center">{p.control}</div>
      {p.onOpen && <span className="self-center text-muted group-hover:text-fg">›</span>}
    </div>
  )
}

function GroupHead({ icon, count, children }: { icon: ReactNode; count?: number; children: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
      {icon}
      {children}
      {count ? <span className="text-[11.5px] font-normal text-muted">{count}</span> : null}
    </div>
  )
}

// ---- trang chi tiết ----

type DetailTab = 'content' | 'files' | 'agents'

function SkillDetail(p: {
  detail: Detail
  level: Level
  claudeNames: Set<string>
  onBack: () => void
  onOpen: (d: Detail) => void
  afterImport: (r: SkillImportResult | null) => Promise<string[]>
}): React.JSX.Element {
  const { detail } = p
  const library = useSkills((s) => s.library)
  const catalog = useSkills((s) => s.catalog)
  const [doc, setDoc] = useState<SkillDoc | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [tab, setTab] = useState<DetailTab>('content')
  const [editing, setEditing] = useState(detail.type === 'lib' && !!detail.edit)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  const lib: LibrarySkill | undefined = detail.type === 'lib' ? library.find((s) => s.name === detail.name) : undefined
  const cat: SkillCatalogEntry | undefined = detail.type === 'catalog' ? catalog.find((e) => e.slug === detail.slug) : undefined
  const toggleKey = detail.type === 'lib' ? detail.name : detail.type === 'cli' ? detail.skill.toggleKey : null

  useEffect(() => {
    const load = detail.type === 'lib' ? window.stag.skills.read(detail.name) : detail.type === 'cli' ? window.stag.skills.readPath(detail.skill.path) : window.stag.skills.catalogDoc(detail.slug)
    load
      .then((d) => {
        setDoc(d)
        setDraft(d.md)
      })
      .catch((e) => setLoadErr(errText(e)))
  }, [detail])

  const parsed = useMemo(() => parseSkillMd(doc?.md ?? ''), [doc])
  const name = detail.type === 'lib' ? detail.name : detail.type === 'cli' ? detail.skill.name : (cat?.name ?? detail.slug)
  const description = parsed.description || (detail.type === 'cli' ? detail.skill.description : (cat?.description ?? ''))

  const save = async (): Promise<void> => {
    if (detail.type !== 'lib' || saving) return
    setSaving(true)
    setNote(null)
    try {
      const r = await window.stag.skills.save(detail.name, draft)
      useSkills.getState().set(r.list)
      setDoc((d) => (d ? { ...d, md: draft, name: r.name } : d))
      setEditing(false)
      setNote(r.problem ? { text: `Đã lưu, nhưng: ${r.problem} Skill lỗi không được đưa vào phiên.`, bad: true } : { text: 'Đã lưu. Phiên mở sau nhận bản mới.' })
      if (r.name !== detail.name) p.onOpen({ type: 'lib', name: r.name })
    } catch (e) {
      setNote({ text: errText(e), bad: true })
    } finally {
      setSaving(false)
    }
  }

  const remove = (): void => {
    if (detail.type !== 'lib') return
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    window.stag.skills
      .remove(detail.name)
      .then((l) => {
        useSkills.getState().set(l)
        p.onBack()
      })
      .catch((e) => setNote({ text: errText(e), bad: true }))
  }

  const dirty = editing && doc && draft !== doc.md
  const source =
    detail.type === 'lib'
      ? lib
        ? `${SOURCE[lib.source.kind]}${lib.source.from ? ` · ${lib.source.from}` : ''}`
        : ''
      : detail.type === 'cli'
        ? `${RUNTIME[detail.skill.runtime]} · ${SCOPE[detail.skill.scope]}${detail.skill.plugin ? ` · ${detail.skill.plugin}` : ''}`
        : 'Danh mục kèm app · @paperclipai/skills-catalog (MIT)'

  return (
    <>
      <button type="button" onClick={p.onBack} className="mb-3 text-[12.5px] text-muted hover:text-fg">
        ← Tất cả skill
      </button>
      <div className="mb-4 flex items-start gap-3">
        <SkillAvatar name={name} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-mono text-[18px] font-semibold">{name}</h1>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {toggleKey && !(detail.type === 'cli' && detail.skill.plugin) && (
            <>
              <span className="text-[11.5px] text-muted">{p.level.lvl === 'app' ? 'Mọi agent' : p.level.name}</span>
              <LevelToggle k={toggleKey} level={p.level} label={name} field="skills" setApp={skillSetApp(toggleKey)} />
            </>
          )}
          {detail.type === 'catalog' &&
            (library.some((l) => l.name === name) ? (
              <SmallButton onClick={() => p.onOpen({ type: 'lib', name })}>Mở bản đã cài</SmallButton>
            ) : (
              <InstallButton
                onClick={() =>
                  window.stag.skills
                    .install(detail.slug)
                    .then(p.afterImport)
                    .then((added) => added[0] && p.onOpen({ type: 'lib', name: added[0] }))
                    .catch((e) => setNote({ text: errText(e), bad: true }))
                }
              />
            ))}
        </div>
      </div>

      <ErrorBar error={loadErr} />
      {lib?.problem && !editing && <ErrorBar error={`${lib.problem} Skill lỗi không được đưa vào phiên.`} />}
      {detail.type === 'lib' && p.claudeNames.has(detail.name) && (
        <div className="mb-4 rounded-md border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[12px] text-amber-200/90">
          Claude Code đã có skill tên "{detail.name}" (của bạn / claude.ai / dự án): phiên Claude dùng bản đó, bản này chỉ vào phiên Codex / adapter ngoài. Đổi tên nếu
          muốn dùng bản này cho Claude.
        </div>
      )}
      {note && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-[12px] ${note.bad ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-line bg-panel-2/60'}`}>{note.text}</div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_15rem] gap-6">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-1 border-b border-line">
            {(
              [
                ['content', 'Nội dung'],
                ['files', `File${doc ? ` (${doc.files.length})` : ''}`],
                ...(toggleKey ? [['agents', 'Agent']] : [])
              ] as Array<[DetailTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-[12.5px] ${tab === id ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            {tab === 'content' && doc?.editable && !editing && (
              <SmallButton
                onClick={() => {
                  setDraft(doc.md)
                  setEditing(true)
                  setNote(null)
                }}
              >
                Sửa
              </SmallButton>
            )}
          </div>
          {tab === 'content' && editing && (
            <div className="mb-2 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-[11.5px] text-muted">{dirty ? 'Chưa lưu · Ctrl+S để lưu' : 'Không có thay đổi'}</span>
              <SmallButton
                onClick={() => {
                  setEditing(false)
                  setDraft(doc?.md ?? '')
                }}
              >
                Huỷ
              </SmallButton>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty}
                className="rounded-md bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:opacity-90 disabled:opacity-40"
              >
                {saving ? 'Đang lưu…' : 'Lưu'}
              </button>
            </div>
          )}
          {tab === 'content' &&
            (!doc ? (
              <div className="text-[12.5px] text-muted">{loadErr ? '' : 'Đang đọc…'}</div>
            ) : editing ? (
              <SkillEditor value={draft} onChange={setDraft} onSave={() => void save()} />
            ) : (
              <MarkdownView md={doc.md} />
            ))}
          {tab === 'files' && doc && (
            <div className="divide-y divide-line rounded-lg border border-line bg-panel">
              {doc.files.map((f) => (
                <div key={f.path} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-muted">{size(f.bytes)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'agents' && toggleKey && <AgentsTab k={toggleKey} label={name} />}
        </div>

        <aside className="space-y-4 text-[12px]">
          <Side title="Nguồn">{source}</Side>
          {doc && (
            <Side title="Thư mục">
              <div className="break-all font-mono text-[11.5px] text-muted">{doc.dir}</div>
              <div className="mt-1.5 flex gap-1.5">
                <SmallButton onClick={() => void navigator.clipboard.writeText(doc.dir)}>Chép đường dẫn</SmallButton>
                <SmallButton onClick={() => void window.stag.skills.reveal(detail.type === 'lib' ? detail.name : `${doc.dir}/SKILL.md`).catch(() => {})}>Mở</SmallButton>
              </div>
            </Side>
          )}
          <Side title="Chế độ">{detail.type === 'lib' ? 'Sửa được (thư viện của stag.ai)' : detail.type === 'cli' ? 'Chỉ đọc (của CLI, app không sửa)' : 'Chỉ đọc (cài để sửa)'}</Side>
          {doc && <Side title="Dung lượng">{`${doc.files.length} file · ${size(doc.files.reduce((n, f) => n + f.bytes, 0))}`}</Side>}
          <Side title="Dùng ở đâu">
            {detail.type === 'cli'
              ? `Chỉ phiên ${RUNTIME[detail.skill.runtime]}.${detail.skill.plugin ? ' Tắt = tắt cả plugin.' : ''}`
              : 'Claude Code (nạp qua thư mục riêng của phiên), Codex và adapter ngoài (liệt kê trong luật phiên, agent tự mở SKILL.md).'}
          </Side>
          {detail.type === 'cli' && detail.skill.path && !library.some((l) => l.name === detail.skill.name) && (
            <SmallButton
              onClick={() =>
                window.stag.skills
                  .copy(detail.skill.runtime, detail.skill.path)
                  .then(p.afterImport)
                  .then((added) => added[0] && p.onOpen({ type: 'lib', name: added[0] }))
                  .catch((e) => setNote({ text: errText(e), bad: true }))
              }
            >
              Chép vào thư viện
            </SmallButton>
          )}
          {detail.type === 'lib' && (
            <button
              type="button"
              onClick={remove}
              onBlur={() => setConfirmDel(false)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] ${confirmDel ? 'bg-red-500/90 text-white' : 'bg-panel-2 text-red-300 hover:bg-line'}`}
            >
              {confirmDel ? 'Bấm lần nữa để xoá' : 'Xoá skill'}
            </button>
          )}
        </aside>
      </div>
    </>
  )
}

function Side({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{title}</div>
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

const size = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/** Bật / tắt cho từng workspace và từng agent. */
function AgentsTab({ k, label }: { k: string; label: string }): React.JSX.Element {
  const workspaces = useWorkspaces((s) => s.items)
  const byWs = useAgents((s) => s.byWs)
  const app: Level = { lvl: 'app', name: 'mọi agent' }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-2.5">
        <span className="flex-1 text-[12.5px] font-medium">Mặc định cho mọi agent</span>
        <LevelToggle k={k} level={app} label={label} field="skills" setApp={skillSetApp(k)} />
      </div>
      {workspaces.map((w) => {
        const agents = (byWs[w.id]?.agents ?? []).filter((a) => agentKind(a) !== 'terminal')
        return (
          <div key={w.id} className="divide-y divide-line rounded-lg border border-line bg-panel">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1 text-[12.5px] font-medium">Workspace {w.name}</span>
              <LevelToggle k={k} level={{ lvl: 'ws', wsId: w.id, name: `workspace ${w.name}` }} label={label} field="skills" setApp={skillSetApp(k)} />
            </div>
            {agents.map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-2 pl-8">
                <span className="flex-1 text-[12.5px]">
                  {a.name} <span className="text-muted">· {agentKind(a) === 'codex' ? 'Codex' : agentKind(a) === 'external' ? 'adapter ngoài' : 'Claude Code'}</span>
                </span>
                <LevelToggle k={k} level={{ lvl: 'agent', wsId: w.id, agentId: a.id, name: `agent ${a.name}` }} label={label} field="skills" setApp={skillSetApp(k)} />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function MarkdownView({ md }: { md: string }): React.JSX.Element {
  // Tên + mô tả đã ở đầu trang: chỉ hiện phần thân.
  const html = useMemo(() => renderNote(splitSkillMd(md).body, { current: 'SKILL.md', notes: null }).html, [md])
  return (
    <div
      className="md-body rounded-lg border border-line bg-panel px-6 py-5"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:/i.test(href)) window.open(href)
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Soạn SKILL.md (CodeMirror, cùng giao diện trình soạn note). Ctrl+S lưu. */
function SkillEditor({ value, onChange, onSave }: { value: string; onChange: (v: string) => void; onSave: () => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const cb = useRef({ onChange, onSave })
  cb.current = { onChange, onSave }
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (cb.current.onSave(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          yamlFrontmatter({ content: markdown() }),
          syntaxHighlighting(noteHighlight),
          noteTheme,
          EditorView.theme({ '.cm-content': { padding: '12px 16px 30vh', maxWidth: 'none', fontFamily: 'var(--font-mono)', fontSize: '12.5px' } }),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString()))
        ]
      })
    })
    view.focus()
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <div ref={host} className="h-[60vh] overflow-hidden rounded-lg border border-line bg-panel" />
}

// ---- tạo skill ----

function CreateSkillDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nameOk = SKILL_NAME_RE.test(name)
  const create = (): void => {
    setError('')
    setBusy(true)
    window.stag.skills
      .create(name, desc)
      .then((l) => {
        useSkills.getState().set(l)
        onCreated(name)
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal
      title="Tạo skill"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button primary onClick={create} disabled={busy || !nameOk || !desc.trim()}>
            Tạo và mở
          </Button>
        </>
      }
    >
      <label className="mb-1 block text-[12.5px] font-medium">Tên</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, ''))}
        placeholder="vd. review-pr"
        className="w-full rounded-md border border-line bg-panel-2 px-3 py-1.5 font-mono text-[13px] outline-none focus:border-accent"
      />
      <p className="mb-3 mt-1 text-[11.5px] text-muted">Cũng là tên thư mục và tên gọi (Claude: /{name || 'tên'}). Chỉ a-z, 0-9, "-".</p>
      <label className="mb-1 block text-[12.5px] font-medium">Mô tả</label>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value.slice(0, SKILL_DESC_MAX))}
        rows={4}
        placeholder="Làm gì, và khi nào agent nên dùng. vd. Review a pull request for bugs and style. Use when asked to review a PR or a diff."
        className="w-full resize-none rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
      />
      <p className="mt-1 text-[11.5px] text-muted">Agent chỉ thấy tên + mô tả cho tới khi cần, nên mô tả phải nói rõ lúc nào dùng. Viết tiếng Anh để mọi CLI hiểu tốt.</p>
      {error && <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
    </Modal>
  )
}

// ---- biểu tượng ----

function BookIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </svg>
  )
}

function CompassIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2z" />
    </svg>
  )
}

function PenIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function ServerIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <rect x="3" y="13" width="18" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  )
}

function SearchIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
