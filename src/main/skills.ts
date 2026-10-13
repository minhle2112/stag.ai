import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import JSZip from 'jszip'
import { parseSkillMd, setSkillName, SKILL_NAME_RE, skillMd, skillProblem, type EffectiveSkills } from '@shared/skills'
import type { InheritedSkill, LibrarySkill, SkillCatalogEntry, SkillDoc, SkillFile, SkillScan, SkillSource } from '@shared/types'
import { codexHome, tomlString } from './codex'
import { claudeConfigDir } from './context'
import { exists, readText } from './fsutil'
import { isObject, JsonFile } from './jsonFile'

/**
 * Skill (Cài đặt → Skill):
 * - Thư viện của stag.ai: userData/skills/<tên>/SKILL.md (+ file kèm). Tạo trong app, nhập thư mục / .zip,
 *   cài từ danh mục kèm app (resources/skill-catalog), chép skill có sẵn của Claude Code / Codex.
 * - Đưa vào phiên: chép skill bật cho agent vào userData/skill-sessions/<phiên>/.claude/skills/ (bản riêng của phiên,
 *   agent sửa cũng không hỏng thư viện; nằm ngoài dự án để agent khác trong cùng dự án không vô tình nạp).
 *   Claude Code: `--add-dir <thư mục phiên>` (nạp `.claude/skills` của thư mục thêm, đã thử với 2.1.295).
 *   Codex / adapter ngoài: không có cách thêm thư mục skill cho một phiên → liệt kê trong luật phiên (tên, mô tả,
 *   đường dẫn SKILL.md), agent tự mở file khi việc khớp — giống cách Codex tự giới thiệu skill của nó.
 * - Skill có sẵn của CLI chỉ tắt bớt: Claude `skillOverrides` / `enabledPlugins` trong file --settings của phiên,
 *   Codex `-c skills.config=[{name=…,enabled=false}]`.
 */

/** Giới hạn một skill (chép / nhập): đủ cho skill có script / tài liệu kèm, chặn nhầm cả một dự án. */
export const SKILL_MAX_FILES = 400
export const SKILL_MAX_BYTES = 20 * 1024 * 1024
/** Không chép: thư mục / file của công cụ. */
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', 'Thumbs.db', '.venv'])
/** Nguồn gốc các skill trong thư viện. */
const INDEX = '.stag-skills.json'

const now = (): string => new Date().toISOString()
const posix = (p: string): string => p.split(sep).join('/')

/** File trong một thư mục skill (bỏ link tượng trưng, thư mục công cụ). Vượt giới hạn → ném lỗi tiếng Việt. */
export async function skillFiles(dir: string): Promise<SkillFile[]> {
  const out: SkillFile[] = []
  let bytes = 0
  async function walk(d: string): Promise<void> {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) {
        const size = (await fs.stat(p)).size
        bytes += size
        out.push({ path: posix(relative(dir, p)), bytes: size })
        if (out.length > SKILL_MAX_FILES) throw new Error(`Skill ${basename(dir)} có hơn ${SKILL_MAX_FILES} file.`)
        if (bytes > SKILL_MAX_BYTES) throw new Error(`Skill ${basename(dir)} lớn hơn ${SKILL_MAX_BYTES / 1024 / 1024} MB.`)
      }
    }
  }
  await walk(dir)
  return out.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)))
}

async function copySkill(src: string, dst: string): Promise<void> {
  const files = await skillFiles(src)
  await fs.mkdir(dst, { recursive: true })
  for (const f of files) {
    const to = join(dst, ...f.path.split('/'))
    await fs.mkdir(dirname(to), { recursive: true })
    await fs.copyFile(join(src, ...f.path.split('/')), to)
  }
}

/** Thư mục skill trong một thư mục nhập: chính nó (có SKILL.md) hoặc các thư mục con có SKILL.md (sâu tối đa 3 cấp). */
export async function findSkillDirs(root: string, depth = 3): Promise<string[]> {
  if (await exists(join(root, 'SKILL.md'))) return [root]
  if (depth <= 0) return []
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name)) out.push(...(await findSkillDirs(join(root, e.name), depth - 1)))
  return out
}

export interface SessionSkill {
  name: string
  description: string
  /** SKILL.md trong bản chép của phiên. */
  path: string
}

export class SkillLibrary {
  constructor(
    /** userData/skills */
    readonly root: string,
    /** resources/skill-catalog */
    readonly catalogDir: string,
    /** userData/skill-sessions */
    readonly sessionsRoot: string
  ) {}

  private indexFile?: JsonFile
  private get indexJson(): JsonFile {
    return (this.indexFile ??= new JsonFile(join(this.root, INDEX)))
  }
  private indexing: Promise<unknown> = Promise.resolve()

  private async index(): Promise<Record<string, SkillSource>> {
    return ((await this.indexJson.read(isObject)).data ?? {}) as Record<string, SkillSource>
  }

  /** Đọc → sửa → ghi lần lượt: hai lần cài skill sát nhau không làm mất nguồn của nhau. */
  private setIndex(fn: (i: Record<string, SkillSource>) => void): Promise<void> {
    const p = this.indexing.then(async () => {
      const i = await this.index()
      fn(i)
      await this.indexJson.write(i)
    })
    this.indexing = p.catch(() => {})
    return p
  }

  private dir(name: string): string {
    if (!SKILL_NAME_RE.test(name)) throw new Error(`Tên skill không hợp lệ: ${name}`)
    return join(this.root, name)
  }

  async list(): Promise<LibrarySkill[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true })
    } catch {
      return []
    }
    const index = await this.index()
    const out: LibrarySkill[] = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || !SKILL_NAME_RE.test(e.name)) continue
      const dir = join(this.root, e.name)
      const md = await readText(join(dir, 'SKILL.md'))
      const p = md === null ? null : parseSkillMd(md, e.name)
      let files: SkillFile[] = []
      let problem = md === null ? 'Thiếu file SKILL.md.' : (p!.error ?? undefined)
      try {
        files = await skillFiles(dir)
      } catch (err) {
        problem = (err as Error).message
      }
      const st = await fs.stat(join(dir, md === null ? '.' : 'SKILL.md'))
      out.push({
        name: e.name,
        description: p?.description ?? '',
        files: files.length,
        bytes: files.reduce((n, f) => n + f.bytes, 0),
        source: index[e.name] ?? { kind: 'created', at: st.birthtime.toISOString() },
        updatedAt: st.mtime.toISOString(),
        ...(problem ? { problem } : {})
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Tên các skill dùng được (SKILL.md hợp lệ). */
  async usable(): Promise<string[]> {
    return (await this.list()).filter((s) => !s.problem).map((s) => s.name)
  }

  async has(name: string): Promise<boolean> {
    return SKILL_NAME_RE.test(name) && (await exists(join(this.root, name)))
  }

  async read(name: string): Promise<SkillDoc> {
    const dir = this.dir(name)
    const md = await readText(join(dir, 'SKILL.md'))
    if (md === null && !(await exists(dir))) throw new Error(`Không có skill ${name}.`)
    return { name, dir, md: md ?? '', files: await skillFiles(dir).catch(() => []), editable: true }
  }

  async create(name: string, description: string, body?: string): Promise<void> {
    const problem = skillProblem(name, description.trim())
    if (problem) throw new Error(problem)
    if (await this.has(name)) throw new Error(`Đã có skill "${name}" trong thư viện.`)
    const dir = this.dir(name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), skillMd(name, description, body ?? defaultBody(name)), 'utf8')
    await this.setIndex((i) => (i[name] = { kind: 'created', at: now() }))
  }

  /**
   * Lưu SKILL.md. Tên trong frontmatter khác tên thư mục → đổi tên thư mục theo (trả tên mới).
   * Nội dung lỗi (thiếu mô tả…) vẫn lưu, chỉ báo lỗi; đổi tên sang tên đã có / tên sai thì không đổi tên.
   */
  async save(name: string, md: string): Promise<{ name: string; problem: string | null }> {
    const dir = this.dir(name)
    if (!(await exists(dir))) throw new Error(`Không có skill ${name}.`)
    const p = parseSkillMd(md)
    let target = name
    if (p.name && p.name !== name && SKILL_NAME_RE.test(p.name)) {
      if (await this.has(p.name)) throw new Error(`Đã có skill "${p.name}" trong thư viện; chọn tên khác.`)
      target = p.name
    }
    await fs.writeFile(join(dir, 'SKILL.md'), md, 'utf8')
    if (target !== name) {
      await fs.rename(dir, join(this.root, target))
      await this.setIndex((i) => {
        if (i[name]) i[target] = i[name]
        delete i[name]
      })
    }
    return { name: target, problem: parseSkillMd(md, target).error }
  }

  async remove(name: string): Promise<void> {
    await fs.rm(this.dir(name), { recursive: true, force: true })
    await this.setIndex((i) => delete i[name])
  }

  /**
   * Thêm các skill trong một thư mục (một skill hoặc thư mục chứa nhiều skill). Tên lấy từ frontmatter
   * (sai / thiếu → thử tên thư mục). Tên đã có trong thư viện → bỏ qua, báo lại.
   */
  async importDir(root: string, source: Omit<SkillSource, 'at'>): Promise<{ added: string[]; skipped: Array<{ name: string; reason: string }> }> {
    const dirs = await findSkillDirs(root)
    if (!dirs.length) throw new Error('Không thấy SKILL.md nào trong thư mục này (tìm sâu 3 cấp).')
    const added: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    for (const d of dirs) {
      const md = (await readText(join(d, 'SKILL.md'))) ?? ''
      const p = parseSkillMd(md)
      const folder = basename(d).toLowerCase()
      const name = SKILL_NAME_RE.test(p.name) ? p.name : SKILL_NAME_RE.test(folder) ? folder : ''
      const label = p.name || basename(d)
      if (!name) {
        skipped.push({ name: label, reason: 'tên không hợp lệ (chỉ a-z, 0-9, "-")' })
        continue
      }
      if ((await this.has(name)) || added.includes(name)) {
        skipped.push({ name, reason: 'đã có trong thư viện' })
        continue
      }
      try {
        await copySkill(d, join(this.root, name))
        // Tên lấy từ thư mục (frontmatter sai): sửa luôn frontmatter cho khớp.
        if (p.name !== name) await fs.writeFile(join(this.root, name, 'SKILL.md'), setSkillName(md, name), 'utf8')
        added.push(name)
      } catch (err) {
        await fs.rm(join(this.root, name), { recursive: true, force: true })
        skipped.push({ name, reason: (err as Error).message })
      }
    }
    const at = now()
    if (added.length) await this.setIndex((i) => added.forEach((n) => (i[n] = { ...source, at })))
    return { added, skipped }
  }

  /** Nhập file .zip: giải nén vào thư mục tạm (chặn đường dẫn ra ngoài, giới hạn dung lượng) rồi như importDir. */
  async importZip(file: string): Promise<{ added: string[]; skipped: Array<{ name: string; reason: string }> }> {
    const zip = await JSZip.loadAsync(await fs.readFile(file))
    const tmp = join(this.root, `.import-${randomUUID()}`)
    try {
      let bytes = 0
      let count = 0
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue
        // JSZip tự bỏ `../` trong tên; tên gốc vẫn kiểm để từ chối hẳn file zip kiểu này.
        const raw = (entry as { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
        const rel = normalize(entry.name.replace(/\\/g, '/'))
        const to = resolve(tmp, rel)
        if (/(^|[\\/])\.\.([\\/]|$)/.test(raw) || isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || rel.startsWith('..') || !to.startsWith(tmp + sep))
          throw new Error(`File zip có đường dẫn không an toàn: ${raw}`)
        if (++count > SKILL_MAX_FILES * 5) throw new Error('File zip có quá nhiều file.')
        const buf = await entry.async('nodebuffer')
        bytes += buf.length
        if (bytes > SKILL_MAX_BYTES * 3) throw new Error('File zip giải nén ra quá lớn.')
        await fs.mkdir(dirname(to), { recursive: true })
        await fs.writeFile(to, buf)
      }
      return await this.importDir(tmp, { kind: 'zip', from: file })
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }

  async catalog(): Promise<SkillCatalogEntry[]> {
    try {
      return (JSON.parse((await readText(join(this.catalogDir, 'catalog.json'))) ?? '{}') as { entries?: SkillCatalogEntry[] }).entries ?? []
    } catch {
      return []
    }
  }

  /** Đường dẫn SKILL.md của một skill trong danh mục (xem trước). */
  async catalogDoc(slug: string): Promise<SkillDoc> {
    if (!(await this.catalog()).some((e) => e.slug === slug)) throw new Error(`Không có skill ${slug} trong danh mục.`)
    return readSkillDir(join(this.catalogDir, slug), false)
  }

  async installCatalog(slug: string): Promise<{ added: string[]; skipped: Array<{ name: string; reason: string }> }> {
    if (!(await this.catalog()).some((e) => e.slug === slug)) throw new Error(`Không có skill ${slug} trong danh mục.`)
    return this.importDir(join(this.catalogDir, slug), { kind: 'catalog', from: slug })
  }

  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(sessionId)) throw new Error('id phiên không hợp lệ')
    return join(this.sessionsRoot, sessionId)
  }

  /**
   * Chép các skill bật cho phiên vào thư mục riêng của phiên. Trả thư mục cho `--add-dir` (Claude) và danh sách
   * cho luật phiên (Codex / adapter ngoài). Không có skill nào → dir null.
   */
  async prepareSession(sessionId: string, names: string[]): Promise<{ dir: string | null; skills: SessionSkill[] }> {
    const base = this.sessionDir(sessionId)
    await fs.rm(base, { recursive: true, force: true })
    if (!names.length) return { dir: null, skills: [] }
    const skills: SessionSkill[] = []
    for (const name of names) {
      const md = await readText(join(this.root, name, 'SKILL.md'))
      const p = md === null ? null : parseSkillMd(md, name)
      if (!p || p.error) continue
      const dst = join(base, '.claude', 'skills', name)
      await copySkill(join(this.root, name), dst)
      skills.push({ name, description: p.description, path: join(dst, 'SKILL.md') })
    }
    return { dir: skills.length ? base : null, skills }
  }

  async cleanSession(sessionId: string): Promise<void> {
    await fs.rm(this.sessionDir(sessionId), { recursive: true, force: true }).catch(() => {})
  }

  /** Lúc mở app: phiên cũ không còn chạy (pty chết theo app) → bỏ hết bản chép. */
  async cleanAllSessions(): Promise<void> {
    await fs.rm(this.sessionsRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function defaultBody(name: string): string {
  return `# ${name}\n\n## When to use\n\n- Describe the situations where the agent should use this skill.\n\n## Steps\n\n1. First step.\n2. Second step.\n`
}

/** Đọc một thư mục skill bất kỳ (skill có sẵn của CLI, danh mục) để xem. */
export async function readSkillDir(dir: string, editable: boolean): Promise<SkillDoc> {
  const md = await readText(join(dir, 'SKILL.md'))
  if (md === null) throw new Error(`Không đọc được ${join(dir, 'SKILL.md')}.`)
  return { name: parseSkillMd(md).name || basename(dir), dir, md, files: await skillFiles(dir).catch(() => []), editable }
}

// ---- skill có sẵn của Claude Code ----

async function skillsIn(root: string): Promise<Array<{ dir: string; name: string; description: string }>> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Array<{ dir: string; name: string; description: string }> = []
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue
    const dir = join(root, e.name)
    const md = await readText(join(dir, 'SKILL.md'))
    if (md === null) continue
    const p = parseSkillMd(md)
    out.push({ dir, name: p.name || e.name, description: p.description })
  }
  return out
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse((await readText(file)) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Skill Claude Code tự nạp cho thư mục `cwd` (đọc đĩa, không chạy claude): ~/.claude/skills (user),
 * ~/.claude/skills/synced/<tài khoản>/ (claude.ai), <cwd>/.claude/skills (project), plugin đã bật
 * (~/.claude/plugins/installed_plugins.json + enabledPlugins). Skill của plugin chỉ tắt được cả plugin.
 */
export async function scanClaudeSkills(cwd: string, home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<InheritedSkill[]> {
  const claude = claudeConfigDir(env, home)
  const out: InheritedSkill[] = []
  const add = (s: { dir: string; name: string; description: string }, scope: InheritedSkill['scope'], plugin?: string): void => {
    const name = plugin ? `${plugin.split('@')[0]}:${s.name}` : s.name
    if (out.some((x) => x.name === name && x.scope === scope)) return
    out.push({
      runtime: 'claude',
      name,
      description: s.description,
      scope,
      path: join(s.dir, 'SKILL.md'),
      toggleKey: plugin ? `claude-plugin:${plugin}` : `claude:${s.name}`,
      ...(plugin ? { plugin } : {})
    })
  }
  for (const s of await skillsIn(join(claude, 'skills'))) if (basename(s.dir) !== 'synced') add(s, 'user')
  for (const bucket of await fs.readdir(join(claude, 'skills', 'synced')).catch(() => [] as string[])) for (const s of await skillsIn(join(claude, 'skills', 'synced', bucket))) add(s, 'claude.ai')
  for (const s of await skillsIn(join(cwd, '.claude', 'skills'))) add(s, 'project')
  // Plugin: bật ở settings của người dùng hoặc của dự án.
  const enabled: Record<string, unknown> = {}
  for (const f of [join(claude, 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')])
    Object.assign(enabled, (await readJson(f)).enabledPlugins)
  const installed = (await readJson(join(claude, 'plugins', 'installed_plugins.json'))).plugins as Record<string, Array<{ installPath?: string }>> | undefined
  for (const [id, list] of Object.entries(installed ?? {})) {
    if (enabled[id] !== true || !Array.isArray(list) || !list.length) continue
    const path = list[list.length - 1]?.installPath
    if (typeof path === 'string') for (const s of await skillsIn(join(path, 'skills'))) add(s, 'plugin', id)
  }
  return out
}

// ---- skill có sẵn của Codex ----

/**
 * Skill Codex nạp cho `cwd`, hỏi chính Codex qua `codex app-server` (JSON-RPC `skills/list`, không gọi model):
 * ~/.codex/skills, ~/.agents/skills, .agents/skills / .codex/skills của dự án, skill hệ thống, plugin.
 */
export function scanCodexSkills(exe: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 20000): Promise<InheritedSkill[]> {
  return new Promise((resolveP, reject) => {
    const p = spawn(exe, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let buf = ''
    let err = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      p.kill()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('Codex không trả lời danh sách skill sau 20 giây.'))), timeoutMs)
    const send = (o: unknown): void => {
      p.stdin.write(JSON.stringify(o) + '\n')
    }
    p.on('error', (e) => finish(() => reject(e)))
    p.on('exit', (code) => finish(() => reject(new Error(`Codex thoát (mã ${code}). ${err.trim().split('\n').pop() ?? ''}`.trim()))))
    p.stderr.on('data', (d) => (err = (err + String(d)).slice(-2000)))
    p.stdout.on('data', (d) => {
      buf += String(d)
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: { id?: number; result?: unknown; error?: { message?: string } }
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.id === 1) {
          send({ method: 'initialized' })
          send({ id: 2, method: 'skills/list', params: { cwds: [cwd], forceReload: true } })
        } else if (m.id === 2) {
          if (m.error) finish(() => reject(new Error(m.error?.message ?? 'Codex báo lỗi khi liệt kê skill.')))
          else finish(() => resolveP(codexSkillsFromList(m.result)))
        }
      }
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'stag.ai', version: '1' } } })
  })
}

const CODEX_SCOPES = new Set(['user', 'repo', 'system', 'admin'])

/** Kết quả `skills/list` → danh sách skill (bỏ trùng). */
export function codexSkillsFromList(result: unknown): InheritedSkill[] {
  const out: InheritedSkill[] = []
  const data = (result as { data?: Array<{ skills?: unknown[] }> })?.data ?? []
  for (const entry of data)
    for (const raw of entry.skills ?? []) {
      const s = raw as { name?: string; description?: string; shortDescription?: string; scope?: string; path?: string; enabled?: boolean }
      if (!s.name || out.some((x) => x.name === s.name)) continue
      out.push({
        runtime: 'codex',
        name: s.name,
        description: s.description || s.shortDescription || '',
        scope: (CODEX_SCOPES.has(s.scope ?? '') ? s.scope : 'user') as InheritedSkill['scope'],
        path: s.path ?? '',
        toggleKey: `codex:${s.name}`,
        ...(s.enabled === false ? { disabledInCli: true } : {})
      })
    }
  return out.sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope.localeCompare(b.scope)))
}

export async function scanSkills(runtime: 'claude' | 'codex', cwd: string, codexExe?: () => Promise<string>, env: NodeJS.ProcessEnv = process.env): Promise<SkillScan> {
  const scannedAt = now()
  try {
    const skills = runtime === 'claude' ? await scanClaudeSkills(cwd, homedir(), env) : await scanCodexSkills(await codexExe!(), cwd, env)
    return { runtime, cwd, skills, error: null, scannedAt }
  } catch (e) {
    return { runtime, cwd, skills: [], error: (e as Error).message, scannedAt }
  }
}

// ---- dịch sang từng CLI ----

/** Phần thêm vào file --settings của phiên Claude: tắt skill có sẵn / plugin. */
export function claudeSkillSettings(eff: EffectiveSkills): { skillOverrides?: Record<string, 'off'>; enabledPlugins?: Record<string, false> } {
  const out: { skillOverrides?: Record<string, 'off'>; enabledPlugins?: Record<string, false> } = {}
  if (eff.denied.claude.length) out.skillOverrides = Object.fromEntries(eff.denied.claude.map((n) => [n, 'off' as const]))
  if (eff.plugins.length) out.enabledPlugins = Object.fromEntries(eff.plugins.map((n) => [n, false as const]))
  return out
}

/** Mục `[[skills.config]]` người dùng tự khai trong config.toml (giữ lại khi app đặt `-c skills.config`, vì `-c` thay cả mảng). */
export function codexSkillConfigEntries(toml: string): Array<{ path?: string; name?: string; enabled: boolean }> {
  const out: Array<{ path?: string; name?: string; enabled: boolean }> = []
  const lines = toml.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\[\[\s*skills\s*\.\s*config\s*\]\]\s*(#.*)?$/.test(lines[i])) continue
    const e: { path?: string; name?: string; enabled: boolean } = { enabled: true }
    for (i++; i < lines.length && !/^\s*\[/.test(lines[i]); i++) {
      const m = /^\s*(path|name|enabled)\s*=\s*(.+?)\s*(#.*)?$/.exec(lines[i])
      if (!m) continue
      if (m[1] === 'enabled') e.enabled = m[2] !== 'false'
      else {
        const v = m[2]
        e[m[1] as 'path' | 'name'] = v.startsWith('"') ? (JSON.parse(v) as string) : v.replace(/^'|'$/g, '')
      }
    }
    i--
    if (e.path || e.name) out.push(e)
  }
  return out
}

/** Tham số Codex tắt skill có sẵn (theo tên), giữ mục của người dùng. Không tắt gì → không đụng tới. */
export async function codexSkillArgs(denied: string[], cwd: string): Promise<string[]> {
  if (!denied.length) return []
  const own: Array<{ path?: string; name?: string; enabled: boolean }> = []
  for (const f of [join(codexHome(), 'config.toml'), join(cwd, '.codex', 'config.toml')]) own.push(...codexSkillConfigEntries((await readText(f)) ?? ''))
  const items = [
    ...own.filter((e) => !(e.name && denied.includes(e.name))).map((e) => `{${e.path ? `path=${tomlString(e.path)}` : `name=${tomlString(e.name!)}`},enabled=${e.enabled}}`),
    ...denied.map((n) => `{name=${tomlString(n)},enabled=false}`)
  ]
  return ['-c', `skills.config=[${items.join(',')}]`]
}

/** Mục skill trong luật phiên (Codex / adapter ngoài): agent tự mở SKILL.md khi việc khớp mô tả. */
export function skillInstructions(skills: SessionSkill[]): string {
  if (!skills.length) return ''
  return [
    '',
    '## Skills from stag.ai',
    '',
    'The user gave you these skills. A skill is a folder of instructions (SKILL.md, sometimes with scripts, templates or references next to it).',
    "When a task matches a skill's description, open its SKILL.md with your file tools before starting and follow it. Paths inside a skill are relative to its folder. Do not edit these files.",
    '',
    ...skills.map((s) => `- **${s.name}**: ${s.description} (file: ${s.path.replace(/\\/g, '/')})`),
    ''
  ].join('\n')
}
