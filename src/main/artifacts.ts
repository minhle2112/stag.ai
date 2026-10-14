import { createReadStream, mkdirSync, promises as fs, renameSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { projectRel } from '@shared/scope'
import type { Agent, ArtifactEvent, ArtifactStat, ArtifactText, Workspace } from '@shared/types'
import type { HookPayload } from './board'
import { readText, realPathInside } from './fsutil'
import { looksLikeWrite, shellCommand } from './scopeGuard'
import { ensureIgnored } from './workspace'

/** Số lần tạo/sửa giữ lại mỗi workspace (cũ nhất bị bỏ trước). */
const MAX_EVENTS = 3000
/** Cùng agent, cùng file, cùng kiểu trong khoảng này → gộp làm một (chỉ cập nhật giờ). */
const MERGE_MS = 5000
/** Lệnh shell: file nhắc tới trong lệnh và vừa đổi trong khoảng này mới tính là output của lệnh. */
const SHELL_RECENT_MS = 120_000
/** Đọc cả file (PDF, Office, zip, font…) để xem trước trong app: tối đa chừng này byte. */
export const MAX_BYTES = 150 * 1024 * 1024
/** Xem trước dạng chữ tối đa chừng này byte. */
const MAX_TEXT = 512 * 1024
/** Thư mục không bao giờ tính là output (ngoài các thư mục ẩn `.git`, `.stag`, `.sessions`…). */
const SKIP_SEGMENTS = new Set(['node_modules', '__pycache__'])

interface ArtifactsFile {
  version: 1
  events: ArtifactEvent[]
}

export type Touch = { path: string; kind: ArtifactEvent['kind'] }

/**
 * File một lần gọi tool có thể vừa tạo / sửa / xoá (chưa lọc theo dự án). Claude: Write = ghi cả file,
 * Edit/MultiEdit/NotebookEdit = sửa. Codex: apply_patch (Add/Update/Delete File, Move to). Lệnh shell: mọi
 * chữ trông như đường dẫn file (có đuôi) — bên gọi kiểm lại trên đĩa (xem `shellTouches`).
 */
export function toolTouches(p: HookPayload): { touches: Touch[]; shell: string[] } {
  const input = p.tool_input ?? {}
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  switch (p.tool_name) {
    case 'Write': {
      const f = str(input.file_path)
      return { touches: f ? [{ path: f, kind: 'write' }] : [], shell: [] }
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const f = str(input.file_path) ?? str(input.notebook_path)
      return { touches: f ? [{ path: f, kind: 'edit' }] : [], shell: [] }
    }
    case 'apply_patch': {
      const patch = str(input.command) ?? str(input.patch) ?? ''
      const touches: Touch[] = []
      for (const m of patch.matchAll(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm)) {
        const path = m[2].trim()
        if (m[1] === 'Move to') {
          // "Update File: a" + "Move to: b": a không còn, b là file mới.
          const prev = touches[touches.length - 1]
          if (prev?.kind === 'edit') prev.kind = 'delete'
          touches.push({ path, kind: 'write' })
        } else touches.push({ path, kind: m[1] === 'Update File' ? 'edit' : m[1] === 'Delete File' ? 'delete' : 'write' })
      }
      return { touches, shell: [] }
    }
  }
  const cmd = shellCommand(p)
  return { touches: [], shell: cmd ? pathTokens(cmd) : [] }
}

/** Các chữ trong lệnh shell trông như đường dẫn file có đuôi (trong nháy, sau `=`, hoặc chữ liền). */
export function pathTokens(cmd: string): string[] {
  const out = new Set<string>()
  for (const m of cmd.matchAll(/'([^'\n]+)'|"([^"\n]+)"|([^\s'"`|;&<>(),]+)/g)) {
    let t = m[1] ?? m[2] ?? m[3]
    // --out=chart.png, -o:file.txt
    if (!m[1] && !m[2]) t = t.replace(/^-{1,2}[\w-]*[=:]/, '').replace(/^\w+=/, '')
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) continue
    if (/\.[A-Za-z0-9]{1,8}$/.test(t) && !/^\.+$/.test(t)) out.add(t)
    if (out.size >= 40) break
  }
  return [...out]
}

/** Đường dẫn tương đối so với dự án, giữ hoa thường của đường dẫn gốc khi được; null = không phải output. */
export function outputRel(path: string, ws: Workspace, cwd: string): string | null {
  const rel = projectRel(path, ws.path, cwd)
  if (!rel) return null
  const segs = rel.split('/')
  if (segs.some((s) => s.startsWith('.') || SKIP_SEGMENTS.has(s))) return null
  // Note của vault là bộ nhớ của agent, không phải output (xem ở mục Vault).
  const vault = projectRel(ws.vaultPath, ws.path)
  if (vault !== null && (vault === '' || rel === vault || rel.startsWith(`${vault}/`))) return null
  const norm = path.replace(/\\/g, '/')
  return norm.length >= rel.length && norm.slice(-rel.length).toLowerCase() === rel ? norm.slice(-rel.length) : rel
}

/** Đuôi file Windows chạy được khi mở bằng shell (chương trình, script, lối tắt). */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|hta|msc|msi|msp|mst|scr|cpl|lnk|url|pif|reg|jar|appref-ms|application|gadget|inf|scf|settingcontent-ms|library-ms|search-ms|sys|dll)$/i

/**
 * File mở bằng shell sẽ chạy (không phải để xem). File do agent tạo: nút "Mở" không được chạy nó, kẻo agent bị
 * prompt-injection viết một `.cmd` rồi chờ người dùng bấm, lách bước duyệt lệnh Bash.
 */
export function isRunnableFile(path: string): boolean {
  return RUNNABLE.test(path.replace(/[\s.]+$/, ''))
}

/**
 * Đường dẫn thật của `rel` trong dự án (đã giải symlink / junction); chặn đường dẫn thoát ra ngoài, kể cả qua
 * junction trỏ ra ngoài. File chưa có: lỗi ENOENT, trừ khi `missingOk` (khi đó vẫn kiểm tra thư mục cha).
 */
export async function artifactPath(ws: Workspace, rel: string, missingOk = false): Promise<string> {
  // Rỗng / "." = chính thư mục dự án, không phải file artifact.
  if (!String(rel ?? '').split(/[\\/]+/).some((s) => s && s !== '.')) throw new Error('Đường dẫn nằm ngoài dự án')
  return realPathInside(ws.path, String(rel), missingOk)
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  pdf: 'application/pdf',
  css: 'text/css; charset=utf-8'
}

/**
 * Trả file của artifact cho giao thức `stag-file://<workspaceId>/<rel>` (ảnh / video trong tab Artifacts).
 * Hỗ trợ Range để tua video. Chỉ file trong thư mục dự án; luôn kèm `nosniff` + CSP chặn script (SVG).
 */
export async function serveArtifact(ws: Workspace, rel: string, range: string | null): Promise<Response> {
  let full: string
  try {
    full = await artifactPath(ws, rel, true)
  } catch {
    return new Response('Forbidden', { status: 403 })
  }
  let size: number
  try {
    const st = await fs.stat(full)
    if (!st.isFile()) return new Response('Not found', { status: 404 })
    size = st.size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const headers: Record<string, string> = {
    'Content-Type': MIME[extname(full).slice(1).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
    'Cache-Control': 'no-cache'
  }
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (m && (m[1] || m[2]) && size > 0) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    end = Math.min(end, size - 1)
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    start = Math.max(0, start)
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    headers['Content-Length'] = String(end - start + 1)
    return new Response(Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream, { status: 206, headers })
  }
  headers['Content-Length'] = String(size)
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, { status: 200, headers })
}

/** Nhật ký output (file agent tạo / sửa / xoá trong dự án), theo workspace, lưu ở `.stag/artifacts.json`. */
export class ArtifactLog {
  private lists = new Map<string, Promise<ArtifactEvent[]>>()
  /** Danh sách đã đọc xong (cho flushSync, không chờ được promise). */
  private loaded = new Map<string, ArtifactEvent[]>()
  private saveTimers = new Map<string, NodeJS.Timeout>()
  private writing = new Map<string, Promise<void>>()
  private pending = new Map<string, NodeJS.Timeout>()
  private ignored = new Set<string>()
  private paths = new Map<string, Workspace>()

  constructor(
    private notify: (workspaceId: string) => void,
    /** Mỗi lần ghi nhận (kể cả lần gộp vào dòng cũ): các file vừa tạo / sửa / xoá (plugin: sự kiện artifact.written). */
    private onRecord?: (ws: Workspace, agent: Agent, files: Array<{ rel: string; kind: ArtifactEvent['kind'] }>) => void
  ) {}

  private file(ws: Workspace): string {
    return join(ws.path, '.stag', 'artifacts.json')
  }

  private events(ws: Workspace): Promise<ArtifactEvent[]> {
    this.paths.set(ws.id, ws)
    let list = this.lists.get(ws.id)
    if (!list) {
      list = this.read(ws)
      this.lists.set(ws.id, list)
      const id = ws.id
      const mine = list
      void list.then((l) => {
        if (this.lists.get(id) === mine) this.loaded.set(id, l)
      })
    }
    return list
  }

  private async read(ws: Workspace): Promise<ArtifactEvent[]> {
    const raw = await readText(this.file(ws))
    if (!raw) return []
    try {
      const data = JSON.parse(raw) as Partial<ArtifactsFile> | null
      if (data && Array.isArray(data.events)) return data.events
    } catch {
      // File hỏng: bắt đầu lại, cất bản cũ sang bên cạnh để không mất.
    }
    await fs.rename(this.file(ws), `${this.file(ws)}.broken-${Date.now()}`).catch(() => {})
    return []
  }

  /** Ghi các file một lần gọi tool vừa tạo / sửa / xoá (hook PostToolUse). */
  async onToolUse(ws: Workspace, agent: Agent, p: HookPayload): Promise<void> {
    const cwd = p.cwd ?? ws.path
    const { touches, shell } = toolTouches(p)
    const found: Array<{ rel: string; kind: ArtifactEvent['kind'] }> = []
    for (const t of touches) {
      const rel = outputRel(t.path, ws, cwd)
      if (rel) found.push({ rel, kind: t.kind })
    }
    if (shell.length) found.push(...(await this.shellTouches(ws, cwd, shell, shellCommand(p) ?? '')))
    if (!found.length) return
    const list = await this.events(ws)
    const now = new Date()
    const tool = p.tool_name ?? '?'
    for (const t of found) {
      const key = t.rel.toLowerCase()
      const last = list.findLast((e) => e.agentId === agent.id && e.rel.toLowerCase() === key && e.kind === t.kind)
      if (last && now.getTime() - Date.parse(last.at) < MERGE_MS) {
        last.at = now.toISOString()
        continue
      }
      list.push({ agentId: agent.id, agentName: agent.name, rel: t.rel, kind: t.kind, tool, at: now.toISOString() })
    }
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
    this.changed(ws)
    this.onRecord?.(ws, agent, found)
  }

  /**
   * Lệnh shell: file nhắc tới trong lệnh mà vừa được ghi (mtime mới) = output; file đã từng là artifact mà
   * nay không còn, và lệnh có dấu hiệu xoá/chuyển = đã xoá. Chỉ là đoán, đủ cho `python gen.py --out a.png`,
   * `ffmpeg … out.mp4`, `echo … > notes.txt`.
   */
  private async shellTouches(ws: Workspace, cwd: string, tokens: string[], cmd: string): Promise<Array<{ rel: string; kind: ArtifactEvent['kind'] }>> {
    const out: Array<{ rel: string; kind: ArtifactEvent['kind'] }> = []
    const known = new Set((await this.events(ws)).map((e) => e.rel.toLowerCase()))
    const writes = looksLikeWrite(cmd)
    const now = Date.now()
    for (const t of tokens) {
      const rel = outputRel(t, ws, cwd)
      if (!rel || out.some((o) => o.rel.toLowerCase() === rel.toLowerCase())) continue
      let full: string
      try {
        full = await artifactPath(ws, rel, true)
      } catch {
        continue
      }
      try {
        const st = await fs.stat(full)
        if (st.isFile() && now - st.mtimeMs < SHELL_RECENT_MS && st.mtimeMs <= now + 5000) out.push({ rel, kind: 'write' })
      } catch {
        if (writes && known.has(rel.toLowerCase())) out.push({ rel, kind: 'delete' })
      }
    }
    return out
  }

  async list(ws: Workspace): Promise<ArtifactEvent[]> {
    return this.events(ws)
  }

  /** Thông tin file trên đĩa của các artifact (null = không còn). */
  async stat(ws: Workspace, rels: string[]): Promise<Record<string, ArtifactStat | null>> {
    const out: Record<string, ArtifactStat | null> = {}
    await Promise.all(
      rels.map(async (rel) => {
        try {
          const st = await fs.stat(await artifactPath(ws, rel))
          out[rel] = st.isFile() ? { size: st.size, mtime: st.mtime.toISOString() } : null
        } catch {
          out[rel] = null
        }
      })
    )
    return out
  }

  /** Nội dung chữ để xem trước (tối đa `max` ≤ MAX_TEXT byte; có byte 0 trong đoạn đầu → coi là file nhị phân). */
  async text(ws: Workspace, rel: string, max = MAX_TEXT): Promise<ArtifactText> {
    let handle: fs.FileHandle
    try {
      handle = await fs.open(await artifactPath(ws, rel), 'r')
    } catch {
      return { status: 'missing' }
    }
    try {
      const { size } = await handle.stat()
      const buf = Buffer.alloc(Math.min(size, Math.max(1, Math.min(max, MAX_TEXT))))
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      const data = buf.subarray(0, bytesRead)
      if (data.subarray(0, 8192).includes(0)) return { status: 'binary' }
      // Cắt giữa ký tự nhiều byte thì bỏ ký tự hỏng ở cuối.
      return { status: 'ok', text: data.toString('utf8').replace(/�+$/, ''), truncated: size > bytesRead }
    } finally {
      await handle.close()
    }
  }

  /** Cả nội dung file, để renderer tự hiện (PDF, Word, Excel, PowerPoint, zip, font). null = không còn file. */
  async bytes(ws: Workspace, rel: string): Promise<Uint8Array | null> {
    const full = await artifactPath(ws, rel, true)
    let size: number
    try {
      size = (await fs.stat(full)).size
    } catch {
      return null
    }
    if (size > MAX_BYTES) throw new Error(`File quá lớn để xem trong app (${Math.round(size / 1024 / 1024)} MB, tối đa ${MAX_BYTES / 1024 / 1024} MB). Bấm “Mở”.`)
    return new Uint8Array(await fs.readFile(full))
  }

  /** Bỏ một file khỏi danh sách artifact (không đụng file trên đĩa). */
  async forget(ws: Workspace, rel: string): Promise<void> {
    const list = await this.events(ws)
    const key = rel.toLowerCase()
    const kept = list.filter((e) => e.rel.toLowerCase() !== key)
    if (kept.length === list.length) return
    list.splice(0, list.length, ...kept)
    this.changed(ws)
  }

  /** Agent đổi tên: các dòng cũ hiện tên mới. */
  async renameAgent(agentId: string, name: string): Promise<void> {
    for (const ws of this.paths.values()) {
      const list = await this.events(ws)
      if (!list.some((e) => e.agentId === agentId)) continue
      for (const e of list) if (e.agentId === agentId) e.agentName = name
      this.changed(ws)
    }
  }

  forgetWorkspace(workspaceId: string): void {
    this.lists.delete(workspaceId)
    this.loaded.delete(workspaceId)
    this.paths.delete(workspaceId)
    // Lần lưu đang hẹn sẽ ghi lại `.stag/` vào thư mục vừa gỡ khỏi app.
    const t = this.saveTimers.get(workspaceId)
    if (t) clearTimeout(t)
    this.saveTimers.delete(workspaceId)
  }

  /**
   * Windows đăng xuất / tắt máy: tiến trình bị tắt ngay, không chờ được việc bất đồng bộ → ghi đồng bộ các danh sách
   * còn đang hẹn giờ lưu.
   */
  flushSync(): void {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t)
      this.saveTimers.delete(id)
      const ws = this.paths.get(id)
      const list = this.loaded.get(id)
      if (!ws || !list) continue
      const file = this.file(ws)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, events: list } satisfies ArtifactsFile, null, 2), 'utf8')
      renameSync(`${file}.tmp`, file)
    }
  }

  /** Đợi mọi lần ghi xuống đĩa (khi tắt app). */
  async flush(): Promise<void> {
    for (const [id, t] of this.saveTimers) {
      clearTimeout(t)
      this.saveTimers.delete(id)
      const ws = this.paths.get(id)
      if (ws) await this.save(ws)
    }
    await Promise.all(this.writing.values())
  }

  private changed(ws: Workspace): void {
    if (!this.saveTimers.has(ws.id)) {
      this.saveTimers.set(
        ws.id,
        setTimeout(() => {
          this.saveTimers.delete(ws.id)
          void this.save(ws).catch((e) => console.error('[artifacts]', e))
        }, 500)
      )
    }
    if (this.pending.has(ws.id)) return
    this.pending.set(
      ws.id,
      setTimeout(() => {
        this.pending.delete(ws.id)
        this.notify(ws.id)
      }, 200)
    )
  }

  private async save(ws: Workspace): Promise<void> {
    const list = await this.events(ws)
    const file = this.file(ws)
    const prev = this.writing.get(ws.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      await fs.mkdir(dirname(file), { recursive: true })
      if (!this.ignored.has(ws.id)) {
        await ensureIgnored(ws.path, ['.stag/'], 'stag.ai kanban data')
        this.ignored.add(ws.id)
      }
      const data: ArtifactsFile = { version: 1, events: list }
      await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(`${file}.tmp`, file)
    })
    this.writing.set(
      ws.id,
      next.catch(() => {})
    )
    await next
  }
}
