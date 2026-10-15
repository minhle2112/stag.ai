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
import { t, type PlainKey } from '@shared/i18n'
import { fmtTime, useT } from '../../i18n'
import { useAgents } from '../../store/agents'
import { useSettings } from '../../store/settings'
import { useSkills } from '../../store/skills'
import { useUi } from '../../store/ui'
import { useWorkspaces } from '../../store/workspaces'
import { Button, Modal } from '../Modal'
import { Seg } from '../ui/Seg'
import { renderNote } from '../vault/markdown'
import { noteHighlight, noteTheme } from '../vault/NoteEditor'
import { errText } from './AdaptersSection'
import { Badge, Callout, DetailHead, Empty, ErrorBar, Group, INPUT_MONO, InfoTip, Row, SearchBox, SectionTitle, SmallButton, TEXTAREA_TEXT, Tile, Tiles } from './controls'
import { LevelBar, LevelToggle, setAtLevel, useAgentLevel, useLevel, type Level, type LevelKey } from './levels'

/**
 * Settings → Skill (bố cục theo trang Skills của Paperclip):
 * - Đã cài: thư viện của stag.ai (app đưa vào phiên Claude Code qua --add-dir, Codex / adapter ngoài qua luật phiên)
 *   + skill Claude Code / Codex tự nạp (chỉ tắt bớt cho phiên agent).
 * - Khám phá: danh mục kèm app (resources/skill-catalog).
 * Bật / tắt theo cấp app → workspace → agent (công tắc cấp ở tiêu đề trang).
 */

type Tab = 'installed' | 'discover'
type Detail = { type: 'lib'; name: string; edit?: boolean } | { type: 'cli'; skill: InheritedSkill } | { type: 'catalog'; slug: string }

const RUNTIME: Record<CliAdapterId, string> = { claude: 'Claude Code', codex: 'Codex' }
const SCOPE: Record<InheritedSkill['scope'], PlainKey> = {
  user: 'skills.scope.user',
  project: 'skills.scope.project',
  'claude.ai': 'skills.scope.claudeAi',
  plugin: 'skills.scope.plugin',
  repo: 'skills.scope.project',
  system: 'skills.scope.system',
  admin: 'skills.scope.admin'
}
const SOURCE: Record<SkillSource['kind'], PlainKey> = {
  created: 'skills.source.created',
  folder: 'skills.source.folder',
  zip: 'skills.source.zip',
  catalog: 'skills.source.catalog',
  claude: 'skills.source.claude',
  codex: 'skills.source.codex'
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
  if (r.added.length) parts.push(t('skills.import.added', { names: r.added.join(', ') }))
  if (r.skipped.length) parts.push(t('skills.import.skipped', { items: r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ') }))
  return parts.join(' ') || t('skills.import.nothing')
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
  const t = useT()
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
  const [qInstalled, setQInstalled] = useState('')
  const [qCatalog, setQCatalog] = useState('')
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

  return (
    <>
      <SectionTitle
        title={t('skills.section.title')}
        desc={t('skills.section.desc')}
        right={<LevelBar level={level} setLevel={setLevel} field="skills" />}
      />
      {!detail && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Seg
            value={tab}
            onChange={(id) => {
              setTab(id)
              setDetail(null)
            }}
            options={[
              {
                value: 'installed',
                label: library.length ? t('skills.tab.installedCount', { count: library.length }) : t('skills.tab.installed'),
                tip: t('skills.tab.installedTip')
              },
              {
                value: 'discover',
                label: catalog.length ? t('skills.tab.discoverCount', { count: catalog.length }) : t('skills.tab.discover'),
                tip: t('skills.tab.discoverTip')
              }
            ]}
          />
          {tab === 'installed' ? (
            <SearchBox className="min-w-[160px] flex-1" value={qInstalled} onChange={setQInstalled} placeholder={t('skills.search.installedPlaceholder')} label={t('skills.search.installed')} />
          ) : (
            <SearchBox className="min-w-[160px] flex-1" value={qCatalog} onChange={setQCatalog} placeholder={t('skills.search.catalogPlaceholder')} label={t('skills.search.catalog')} />
          )}
          {tab === 'installed' && (
            <>
              <SmallButton icon="folder" onClick={() => doImport('folder')}>
                {t('skills.importFolder')}
              </SmallButton>
              <SmallButton onClick={() => doImport('zip')}>{t('skills.importZip')}</SmallButton>
            </>
          )}
          <SmallButton variant="primary" icon="plus" tip={t('skills.createTip')} onClick={() => setCreating(true)}>
            {t('skills.create')}
          </SmallButton>
        </div>
      )}
      <div className="min-w-0">
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
            lv={lv}
            q={qInstalled}
            scans={scans}
            busy={busy}
            scan={scan}
            msg={msg}
            onOpen={open}
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
            q={qCatalog}
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
  lv: Level
  q: string
  scans: Partial<Record<CliAdapterId, SkillScan>>
  busy: Partial<Record<CliAdapterId, boolean>>
  scan: (r: CliAdapterId) => void
  msg: string
  onOpen: (d: Detail) => void
  onCopy: (s: InheritedSkill) => void
}): React.JSX.Element {
  const t = useT()
  const library = useSkills((s) => s.library)
  const loaded = useSkills((s) => s.loaded)
  const count = useAgentCount()
  const { q } = p
  const match = (name: string, desc: string): boolean => !q.trim() || `${name} ${desc}`.toLowerCase().includes(q.trim().toLowerCase())
  const claude = claudeNames(p.scans.claude)
  const lib = library.filter((s) => match(s.name, s.description))

  return (
    <>
      {p.msg && <Callout className="mb-2">{p.msg}</Callout>}

      <Group title={library.length ? t('skills.library.titleCount', { count: library.length }) : t('skills.library.title')} flush>
        {!loaded ? null : library.length === 0 ? (
          <Empty title={t('skills.library.emptyTitle')}>{t('skills.library.emptyBody')}</Empty>
        ) : lib.length === 0 ? (
          <div className="border-b border-line py-3 text-[12px] text-dim">{t('skills.library.noMatch')}</div>
        ) : (
          <Tiles>
            {lib.map((s) => (
              <SkillTile
                key={s.name}
                name={s.name}
                by={t(SOURCE[s.source.kind])}
                description={s.description}
                problem={s.problem}
                warn={claude.has(s.name) ? t('skills.library.dupWarn') : undefined}
                footer={[t('skills.count.files', { count: s.files }), s.problem ? t('skills.library.notInSessions') : t('skills.count.onFor', { count: count(s.name) })]}
                onOpen={() => p.onOpen({ type: 'lib', name: s.name })}
                control={<LevelToggle k={s.name} level={p.lv} label={s.name} field="skills" setApp={skillSetApp(s.name)} />}
              />
            ))}
          </Tiles>
        )}
      </Group>

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
  const t = useT()
  const library = useSkills((s) => s.library)
  const count = useAgentCount()
  const all = p.scan?.skills ?? []
  const own = all.filter((s) => s.scope !== 'plugin' && p.match(s.name, s.description))
  // Skill của plugin Claude Code: tắt cả plugin, gộp một dòng.
  const plugins = new Map<string, InheritedSkill[]>()
  for (const s of all) if (s.plugin) plugins.set(s.plugin, [...(plugins.get(s.plugin) ?? []), s])
  const pluginRows = [...plugins].filter(([id, list]) => p.match(id, list.map((s) => s.name).join(' ')))

  const help =
    p.runtime === 'claude'
      ? t('skills.inherited.helpClaude')
      : t('skills.inherited.helpCodex')

  return (
    <Group
      title={
        <span className="inline-flex items-center gap-1.5">
          {t('skills.inherited.title', { runtime: RUNTIME[p.runtime] })}
          {all.length > 0 && <span className="font-normal tracking-normal">· {all.length}</span>}
          <InfoTip text={help} />
        </span>
      }
      action={
        <SmallButton onClick={p.rescan} disabled={p.busy}>
          {p.busy ? t('skills.inherited.scanning') : t('skills.inherited.rescan')}
        </SmallButton>
      }
    >
      {p.scan?.cwd && (
        <div className="mb-2 truncate text-[11px] text-dim" data-tip={p.scan.cwd}>
          {t('skills.inherited.scannedAt', { time: fmtTime(p.scan.scannedAt, true), cwd: p.scan.cwd })}
        </div>
      )}
      {p.scan?.error && <ErrorBar error={p.scan.error} />}
      {own.length + pluginRows.length === 0 ? (
        <div className="border-b border-line py-3 text-[12px] text-dim">{p.busy ? t('skills.inherited.scanning') : p.scan ? t('skills.inherited.none') : t('skills.inherited.notScanned')}</div>
      ) : (
        <Tiles>
          {own.map((s) => (
            <SkillTile
              key={s.path || s.name}
              name={s.name}
              by={t(SCOPE[s.scope])}
              description={s.description}
              footer={[s.disabledInCli ? t('skills.inherited.disabledInCli') : t('skills.count.onFor', { count: count(s.toggleKey) })]}
              onOpen={() => p.onOpen({ type: 'cli', skill: s })}
              control={
                <>
                  {!library.some((l) => l.name === s.name) && s.path && (
                    <SmallButton
                      variant="ghost"
                      size="xs"
                      tip={t('skills.inherited.copyTip')}
                      onClick={() => p.onCopy(s)}
                    >
                      {t('common.copy')}
                    </SmallButton>
                  )}
                  <LevelToggle k={s.toggleKey} level={p.lv} label={s.name} field="skills" setApp={skillSetApp(s.toggleKey)} />
                </>
              }
            />
          ))}
          {pluginRows.map(([id, list]) => (
            <SkillTile
              key={id}
              name={id.split('@')[0]}
              by={`plugin · ${id.split('@')[1] ?? ''}`}
              description={t('skills.inherited.pluginSkills', { count: list.length, names: list.map((s) => s.name.split(':').pop()).join(', ') })}
              footer={[t('skills.count.onFor', { count: count(`claude-plugin:${id}`) }), t('skills.inherited.pluginOff')]}
              control={<LevelToggle k={`claude-plugin:${id}`} level={p.lv} label={`plugin ${id}`} field="skills" setApp={skillSetApp(`claude-plugin:${id}`)} />}
            />
          ))}
        </Tiles>
      )}
    </Group>
  )
}

// ---- Khám phá ----

function DiscoverView({ q, onOpen, onInstall, msg }: { q: string; onOpen: (slug: string) => void; onInstall: (slug: string) => void; msg: string }): React.JSX.Element {
  const t = useT()
  const catalog = useSkills((s) => s.catalog)
  const library = useSkills((s) => s.library)
  const list = catalog.filter((e) => !q.trim() || `${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      {msg && <Callout className="mb-2">{msg}</Callout>}
      <Group
        flush
        title={
          <span className="inline-flex items-center gap-1.5">
            {t('skills.discover.count', { count: list.length })}
            <InfoTip text={t('skills.discover.info')} />
          </span>
        }
      >
        <Tiles>
          {list.map((e) => {
            const installed = library.some((l) => l.name === e.name)
            return (
              <SkillTile
                key={e.slug}
                name={e.name}
                by={e.source === 'stag.ai' ? t('skills.discover.byStag') : t('skills.discover.byPaperclip')}
                description={e.description}
                footer={[t('skills.count.files', { count: e.files }), ...e.tags.slice(0, 3)]}
                onOpen={() => onOpen(e.slug)}
                control={installed ? <Badge tone="ok">{t('skills.tab.installed')}</Badge> : <InstallButton onClick={() => onInstall(e.slug)} />}
              />
            )
          })}
        </Tiles>
      </Group>
    </>
  )
}

function InstallButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <SmallButton size="xs" onClick={onClick}>
      {t('common.install')}
    </SmallButton>
  )
}

// ---- thẻ skill ----

const AVATAR = ['#22c55e', '#f59e0b', '#60a5fa', '#c084fc', '#f87171', '#2dd4bf', '#f472b6', '#a3e635']

export function SkillAvatar({ name, size = 34 }: { name: string; size?: number }): React.JSX.Element {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const letter = (name.split(':').pop() ?? name).replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?'
  return (
    <span
      className="flex shrink-0 items-center justify-center font-bold text-black/80"
      style={{ width: size, height: size, background: AVATAR[h % AVATAR.length], fontSize: size * 0.42, borderRadius: size >= 28 ? 7 : 5 }}
      aria-hidden
    >
      {letter}
    </span>
  )
}

/** Thẻ skill: logo chữ cái, tên, một dòng mô tả; nguồn / số file / số agent bật nằm trong chú thích. */
function SkillTile(p: {
  name: string
  by: string
  description: string
  footer: string[]
  problem?: string
  warn?: string
  control: ReactNode
  onOpen?: () => void
}): React.JSX.Element {
  const t = useT()
  const tip = [p.description || t('skills.noDescription'), [p.by, ...p.footer.filter(Boolean)].join(' · '), p.warn].filter(Boolean).join('\n')
  return (
    <Tile
      logo={<SkillAvatar name={p.name} size={30} />}
      title={p.name}
      mono
      badge={
        p.warn ? (
          <span data-tip={p.warn} className="inline-flex">
            <Badge>{t('skills.dupBadge')}</Badge>
          </span>
        ) : undefined
      }
      sub={p.description || <i>{t('skills.noDescription')}</i>}
      tip={tip}
      alert={p.problem}
      onOpen={p.onOpen}
      control={p.control}
    />
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
  const t = useT()
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
      setNote(r.problem ? { text: t('skills.detail.savedWithProblem', { problem: r.problem }), bad: true } : { text: t('skills.detail.saved') })
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
        ? `${t(SOURCE[lib.source.kind])}${lib.source.from ? ` · ${lib.source.from}` : ''}`
        : ''
      : detail.type === 'cli'
        ? `${RUNTIME[detail.skill.runtime]} · ${t(SCOPE[detail.skill.scope])}${detail.skill.plugin ? ` · ${detail.skill.plugin}` : ''}`
        : t('skills.detail.catalogSource')

  const tabs: Array<{ value: DetailTab; label: string }> = [
    { value: 'content', label: t('skills.detail.content') },
    { value: 'files', label: doc ? t('skills.detail.filesCount', { count: doc.files.length }) : t('skills.detail.files') },
    ...(toggleKey ? [{ value: 'agents' as const, label: t('skills.detail.agents') }] : [])
  ]

  return (
    <>
      <DetailHead
        onBack={p.onBack}
        backLabel={t('skills.detail.back')}
        logo={<SkillAvatar name={name} size={30} />}
        title={name}
        mono
        sub={description}
        control={
          <>
            {toggleKey && !(detail.type === 'cli' && detail.skill.plugin) && (
              <>
                <span className="text-[12px] text-dim">{p.level.lvl === 'app' ? t('skills.detail.allAgents') : p.level.name}</span>
                <LevelToggle k={toggleKey} level={p.level} label={name} field="skills" setApp={skillSetApp(toggleKey)} />
              </>
            )}
            {detail.type === 'catalog' &&
              (library.some((l) => l.name === name) ? (
                <SmallButton onClick={() => p.onOpen({ type: 'lib', name })}>{t('skills.detail.openInstalled')}</SmallButton>
              ) : (
                <SmallButton
                  variant="primary"
                  onClick={() =>
                    window.stag.skills
                      .install(detail.slug)
                      .then(p.afterImport)
                      .then((added) => added[0] && p.onOpen({ type: 'lib', name: added[0] }))
                      .catch((e) => setNote({ text: errText(e), bad: true }))
                  }
                >
                  {t('common.install')}
                </SmallButton>
              ))}
          </>
        }
      />

      <ErrorBar error={loadErr} />
      {lib?.problem && !editing && <ErrorBar error={t('skills.detail.problem', { problem: lib.problem })} />}
      {detail.type === 'lib' && p.claudeNames.has(detail.name) && (
        <Callout className="mb-3" icon="info">
          {t('skills.detail.claudeDup', { name: detail.name })}
        </Callout>
      )}
      {note && (
        <Callout tone={note.bad ? 'danger' : 'info'} className="mb-3">
          {note.text}
        </Callout>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_14rem] gap-6">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <Seg value={tab} onChange={setTab} options={tabs.map((x) => ({ value: x.value, label: x.label }))} />
            <div className="flex-1" />
            {tab === 'content' && doc?.editable && !editing && (
              <SmallButton
                icon="pen"
                onClick={() => {
                  setDraft(doc.md)
                  setEditing(true)
                  setNote(null)
                }}
              >
                {t('common.edit')}
              </SmallButton>
            )}
          </div>
          {tab === 'content' && editing && (
            <div className="mb-2 flex items-center justify-end gap-1.5">
              <span className="mr-auto text-[12px] text-dim">{dirty ? t('skills.detail.unsaved') : t('skills.detail.noChanges')}</span>
              <SmallButton
                onClick={() => {
                  setEditing(false)
                  setDraft(doc?.md ?? '')
                }}
              >
                {t('common.cancel')}
              </SmallButton>
              <SmallButton variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
                {saving ? t('common.saving') : t('common.save')}
              </SmallButton>
            </div>
          )}
          {tab === 'content' &&
            (!doc ? (
              <div className="text-[12px] text-dim">{loadErr ? '' : t('skills.detail.reading')}</div>
            ) : editing ? (
              <SkillEditor value={draft} onChange={setDraft} onSave={() => void save()} />
            ) : (
              <MarkdownView md={doc.md} />
            ))}
          {tab === 'files' && doc && (
            <div>
              {doc.files.map((f) => (
                <div key={f.path} className="flex items-center gap-3 border-b border-line py-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate font-mono">{f.path}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-dim">{size(f.bytes)}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'agents' && toggleKey && <AgentsTab k={toggleKey} label={name} />}
        </div>

        <aside className="space-y-4 text-[12px]">
          <Side title={t('skills.detail.source')}>{source}</Side>
          {doc && (
            <Side title={t('skills.detail.folder')}>
              <div className="font-mono text-[11px] break-all text-muted">{doc.dir}</div>
              <div className="mt-1.5 flex gap-1.5">
                <SmallButton onClick={() => void navigator.clipboard.writeText(doc.dir)}>{t('skills.detail.copyPath')}</SmallButton>
                <SmallButton onClick={() => void window.stag.skills.reveal(detail.type === 'lib' ? detail.name : `${doc.dir}/SKILL.md`).catch(() => {})}>{t('common.open')}</SmallButton>
              </div>
            </Side>
          )}
          <Side title={t('skills.detail.mode')}>
            {detail.type === 'lib' ? t('skills.detail.modeEditable') : detail.type === 'cli' ? t('skills.detail.modeCli') : t('skills.detail.modeCatalog')}
          </Side>
          {doc && (
            <Side title={t('skills.detail.size')}>{t('skills.detail.sizeValue', { count: doc.files.length, size: size(doc.files.reduce((n, f) => n + f.bytes, 0)) })}</Side>
          )}
          <Side title={t('skills.detail.usedIn')}>
            {detail.type === 'cli'
              ? detail.skill.plugin
                ? t('skills.detail.usedCliPlugin', { runtime: RUNTIME[detail.skill.runtime] })
                : t('skills.detail.usedCli', { runtime: RUNTIME[detail.skill.runtime] })
              : t('skills.detail.usedLib')}
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
              {t('skills.detail.copyToLibrary')}
            </SmallButton>
          )}
          {detail.type === 'lib' && (
            <SmallButton variant={confirmDel ? 'dangerSolid' : 'danger'} onClick={remove} onBlur={() => setConfirmDel(false)}>
              {confirmDel ? t('skills.detail.deleteConfirm') : t('skills.detail.delete')}
            </SmallButton>
          )}
        </aside>
      </div>
    </>
  )
}

function Side({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-[0.07em] text-dim uppercase">{title}</div>
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}

const size = (b: number): string => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/** Bật / tắt cho từng workspace và từng agent. */
function AgentsTab({ k, label }: { k: string; label: string }): React.JSX.Element {
  const workspaces = useWorkspaces((s) => s.items)
  const t = useT()
  const byWs = useAgents((s) => s.byWs)
  const app: Level = { lvl: 'app', name: t('skills.agents.allLower') }
  return (
    <div>
      <Row label={t('skills.agents.default')}>
        <LevelToggle k={k} level={app} label={label} field="skills" setApp={skillSetApp(k)} />
      </Row>
      {workspaces.map((w) => {
        const agents = (byWs[w.id]?.agents ?? []).filter((a) => agentKind(a) !== 'terminal')
        return (
          <div key={w.id}>
            <Row label={`Workspace ${w.name}`}>
              <LevelToggle k={k} level={{ lvl: 'ws', wsId: w.id, name: `workspace ${w.name}` }} label={label} field="skills" setApp={skillSetApp(k)} />
            </Row>
            {agents.map((a) => (
              <div key={a.id} className="pl-5">
                <Row
                  label={
                    <span className="font-normal">
                      {a.name} <span className="text-dim">· {agentKind(a) === 'codex' ? 'Codex' : agentKind(a) === 'external' ? t('skills.agents.external') : 'Claude Code'}</span>
                    </span>
                  }
                >
                  <LevelToggle k={k} level={{ lvl: 'agent', wsId: w.id, agentId: a.id, name: `agent ${a.name}` }} label={label} field="skills" setApp={skillSetApp(k)} />
                </Row>
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
  return <div ref={host} className="h-[60vh] overflow-hidden rounded-lg border border-line-2 bg-panel" />
}

// ---- tạo skill ----

function CreateSkillDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }): React.JSX.Element {
  const t = useT()
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
      title={t('skills.create')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button primary onClick={create} disabled={busy || !nameOk || !desc.trim()}>
            {t('skills.createDialog.submit')}
          </Button>
        </>
      }
    >
      <label className="mb-1 block text-[12px] font-medium">{t('skills.createDialog.name')}</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value.toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, ''))}
        placeholder={t('skills.createDialog.namePlaceholder')}
        className={`${INPUT_MONO} w-full`}
      />
      <p className="mt-1 mb-3 text-[12px] text-dim">{t('skills.createDialog.nameHint', { cmd: name || t('skills.createDialog.cmdPlaceholder') })}</p>
      <label className="mb-1 block text-[12px] font-medium">{t('skills.createDialog.description')}</label>
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value.slice(0, SKILL_DESC_MAX))}
        rows={4}
        placeholder={t('skills.createDialog.descPlaceholder')}
        className={`${TEXTAREA_TEXT} w-full`}
      />
      <p className="mt-1 text-[12px] text-dim">{t('skills.createDialog.descHint')}</p>
      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
    </Modal>
  )
}
