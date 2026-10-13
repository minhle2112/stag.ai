import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  anchorLabel,
  assignBlockIds,
  isDocFile,
  isMarkdownFile,
  latestVersion,
  splitBlocks,
  type ArtifactComment,
  type ArtifactRecord,
  type ArtifactsSnapshot,
  type CommentAnchor,
  type CommentMessage,
  type DocBlock,
  type PublishFailure
} from '@shared/artifacts'
import type { Agent, Task, Workspace } from '@shared/types'
import { readText } from './fsutil'
import { renameRetry } from './jsonFile'
import { ensureIgnored } from './workspace'

/** File lớn nhất nộp được (bản chụp nằm trong `.stag/artifacts/`). */
export const MAX_PUBLISH_BYTES = 150 * 1024 * 1024
/** Tài liệu chữ lớn hơn chừng này thì không tách khối (vẫn nộp, xem như file thường). */
const MAX_DOC_BYTES = 2 * 1024 * 1024
/** Giữ chừng này lần nộp không thành mỗi workspace. */
const MAX_FAILURES = 30
const MAX_TEXT = 4000
const MAX_TITLE = 120
const MAX_DESC = 600
/** Thư mục không nộp được (dữ liệu của app / git / máy). */
const BLOCKED = new Set(['.stag', '.git', '.sessions', 'node_modules'])

export interface PublishInput {
  file: string
  title: string
  description: string
  note?: string
  fixes?: string[]
}

export interface ReplyInput {
  id: string
  text: string
  options?: string[]
}

/** Góp ý đang chờ gõ vào phiên một agent, gom theo sản phẩm. */
export interface Delivery {
  ws: Workspace
  artifact: ArtifactRecord
  comments: ArtifactComment[]
}

interface IndexFile {
  version: 1
  next: { a: number; c: number }
  artifacts: ArtifactRecord[]
  failures: PublishFailure[]
}

const now = (): string => new Date().toISOString()

/**
 * Sản phẩm agent nộp (tab "Sản phẩm"), theo workspace, lưu ở `<dự án>/.stag/artifacts/index.json`; mỗi lần nộp chụp lại
 * file ở `.stag/artifacts/<id>/v<N>.<đuôi>` (+ `v<N>.blocks.json` với tài liệu chữ). Góp ý của người dùng có hàng chờ gửi
 * vào phiên agent (AgentService gõ khi agent rảnh, xem `queuedFor` / `delivered`).
 */
export class ArtifactStore {
  private data = new Map<string, Promise<IndexFile>>()
  private chain = new Map<string, Promise<unknown>>()
  private ignored = new Set<string>()
  private pending = new Map<string, NodeJS.Timeout>()
  private known = new Map<string, Workspace>()

  constructor(
    private notify: (workspaceId: string) => void,
    /** Có góp ý mới vào hàng chờ của agent này (gửi ngay nếu agent rảnh). */
    private onQueued?: (agentId: string) => void
  ) {}

  private dir(ws: Workspace): string {
    return join(ws.path, '.stag', 'artifacts')
  }

  private load(ws: Workspace): Promise<IndexFile> {
    this.known.set(ws.id, ws)
    let d = this.data.get(ws.id)
    if (!d) {
      d = this.read(ws)
      this.data.set(ws.id, d)
    }
    return d
  }

  private async read(ws: Workspace): Promise<IndexFile> {
    const file = join(this.dir(ws), 'index.json')
    const raw = await readText(file)
    const empty: IndexFile = { version: 1, next: { a: 1, c: 1 }, artifacts: [], failures: [] }
    if (!raw) return empty
    try {
      const d = JSON.parse(raw) as Partial<IndexFile>
      if (d && Array.isArray(d.artifacts))
        return { version: 1, next: { a: d.next?.a ?? 1, c: d.next?.c ?? 1 }, artifacts: d.artifacts, failures: Array.isArray(d.failures) ? d.failures : [] }
    } catch {
      // hỏng: cất sang bên cạnh, bắt đầu lại
    }
    await fs.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
    return empty
  }

  /** Chạy lần lượt các thay đổi của một workspace, ghi file + báo giao diện sau mỗi lần. */
  private mutate<T>(ws: Workspace, fn: (d: IndexFile) => Promise<T> | T): Promise<T> {
    const prev = this.chain.get(ws.id) ?? Promise.resolve()
    const run = prev.then(async () => {
      const d = await this.load(ws)
      const out = await fn(d)
      await this.save(ws, d)
      this.changed(ws.id)
      return out
    })
    this.chain.set(
      ws.id,
      run.catch(() => {})
    )
    return run
  }

  private async save(ws: Workspace, d: IndexFile): Promise<void> {
    const file = join(this.dir(ws), 'index.json')
    await fs.mkdir(dirname(file), { recursive: true })
    if (!this.ignored.has(ws.id)) {
      await ensureIgnored(ws.path, ['.stag/'], 'stag.ai kanban data').catch(() => {})
      this.ignored.add(ws.id)
    }
    await fs.writeFile(`${file}.tmp`, JSON.stringify(d, null, 2), 'utf8')
    await renameRetry(`${file}.tmp`, file)
  }

  private changed(workspaceId: string): void {
    if (this.pending.has(workspaceId)) return
    this.pending.set(
      workspaceId,
      setTimeout(() => {
        this.pending.delete(workspaceId)
        this.notify(workspaceId)
      }, 120)
    )
  }

  async snapshot(ws: Workspace): Promise<ArtifactsSnapshot> {
    const d = await this.load(ws)
    return { artifacts: d.artifacts, failures: d.failures }
  }

  /** Khối của một bản tài liệu chữ (rỗng nếu bản đó không có). */
  async blocks(ws: Workspace, id: string, v: number): Promise<DocBlock[]> {
    const raw = await readText(join(this.dir(ws), safeId(id), `v${Math.floor(v)}.blocks.json`))
    if (!raw) return []
    try {
      const b = JSON.parse(raw) as DocBlock[]
      return Array.isArray(b) ? b : []
    } catch {
      return []
    }
  }

  // ---------- agent ----------

  /**
   * artifact_publish: chụp file vào `.stag/artifacts/<id>/`, thêm bản mới (hoặc chỉ cập nhật tiêu đề / mô tả nếu nội dung
   * không đổi), đánh dấu các góp ý trong `fixes` là đã sửa. Lỗi → ném Error (tiếng Anh, agent đọc) và ghi lại lần nộp hỏng.
   */
  async publish(ws: Workspace, agent: Agent, task: Task | null, input: PublishInput, cwd = ws.path): Promise<string> {
    try {
      return await this.doPublish(ws, agent, task, input, cwd)
    } catch (e) {
      const error = String((e as Error)?.message ?? e)
      await this.mutate(ws, (d) => {
        d.failures.push({ at: now(), agentId: agent.id, agentName: agent.name, taskId: task?.id ?? null, file: String(input.file ?? '').slice(0, 300), error })
        if (d.failures.length > MAX_FAILURES) d.failures.splice(0, d.failures.length - MAX_FAILURES)
      }).catch(() => {})
      throw e
    }
  }

  private async doPublish(ws: Workspace, agent: Agent, task: Task | null, input: PublishInput, cwd: string): Promise<string> {
    if (!task) throw new Error('You have no open task in the task list. Call task_start first: artifacts are grouped under your task.')
    const title = clean(input.title, MAX_TITLE)
    const description = clean(input.description, MAX_DESC)
    if (!title) throw new Error('title is empty.')
    const rel = projectFile(ws.path, cwd, input.file)
    const full = join(ws.path, ...rel.split('/'))
    let size: number
    try {
      const st = await fs.stat(full)
      if (!st.isFile()) throw new Error(`"${rel}" is not a file.`)
      size = st.size
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`File "${rel}" does not exist in the project. Write it first, then publish.`)
      throw e
    }
    if (size > MAX_PUBLISH_BYTES) throw new Error(`File is too large to publish (${Math.round(size / 1024 / 1024)} MB, max ${MAX_PUBLISH_BYTES / 1024 / 1024} MB).`)
    const bytes = await fs.readFile(full)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const note = clean(input.note ?? '', MAX_DESC)
    const fixes = [...new Set((input.fixes ?? []).map((x) => String(x).trim()).filter(Boolean))]

    return this.mutate(ws, async (d) => {
      const key = rel.toLowerCase()
      let a = d.artifacts.find((x) => x.rel.toLowerCase() === key)
      const at = now()
      const isNew = !a
      if (!a) {
        a = {
          id: `a${d.next.a++}`,
          rel,
          title,
          description,
          agentId: agent.id,
          agentName: agent.name,
          taskId: task.id,
          taskTitle: task.title,
          createdAt: at,
          updatedAt: at,
          versions: [],
          seen: 0,
          comments: []
        }
        d.artifacts.push(a)
      }
      a.title = title
      a.description = description
      a.agentId = agent.id
      a.agentName = agent.name
      a.taskId = task.id
      a.taskTitle = task.title
      a.updatedAt = at
      const wasHidden = a.hidden
      delete a.hidden
      const last = a.versions.at(-1)
      const lines: string[] = []
      let v: number
      if (last && last.sha256 === sha256) {
        v = last.v
        if (note && !last.note) last.note = note
        lines.push(`Content unchanged since v${v}: no new version. Title and description updated.`)
      } else {
        v = (last?.v ?? 0) + 1
        const ext = extname(rel).toLowerCase().replace(/[^.a-z0-9]/g, '')
        const snapRel = `.stag/artifacts/${a.id}/v${v}${ext}`
        await fs.mkdir(join(this.dir(ws), a.id), { recursive: true })
        await fs.writeFile(join(ws.path, ...snapRel.split('/')), bytes)
        let blocks = false
        if (isDocFile(rel) && size <= MAX_DOC_BYTES && !bytes.subarray(0, 8192).includes(0)) {
          const text = bytes.toString('utf8')
          const prevV = [...a.versions].reverse().find((x) => x.blocks)
          const prev = prevV ? await this.blocks(ws, a.id, prevV.v) : []
          let k = 0
          const list = assignBlockIds(prev, splitBlocks(text, isMarkdownFile(rel)), () => `v${v}.${++k}`)
          await fs.writeFile(join(this.dir(ws), a.id, `v${v}.blocks.json`), JSON.stringify(list), 'utf8')
          blocks = true
        }
        a.versions.push({ v, at, note, snapshot: snapRel, size, sha256, agentId: agent.id, agentName: agent.name, taskId: task.id, ...(blocks ? { blocks } : {}) })
        lines.push(`Published "${title}" as v${v} (artifact ${a.id}, file ${rel}) under your task "${task.title}". stag.ai saved a snapshot; the user sees it in the stag.ai "Sản phẩm" (Artifacts) tab${isNew ? '' : ' with a diff against the previous version'}.`)
      }
      if (wasHidden) lines.push('It was hidden from the list before; it is shown again.')
      // Góp ý đã sửa.
      const done: string[] = []
      const unknown: string[] = []
      for (const id of fixes) {
        const c = a.comments.find((x) => x.id === id)
        if (!c || c.state === 'draft') {
          unknown.push(id)
          continue
        }
        if (c.state === 'closed') continue
        c.state = 'fixed'
        c.fixedIn = v
        delete c.prevState
        c.updatedAt = at
        done.push(id)
      }
      if (done.length) {
        const cur = a.versions.find((x) => x.v === v)!
        cur.fixes = [...new Set([...(cur.fixes ?? []), ...done])]
        lines.push(`Marked fixed in v${v}: ${done.join(', ')} (the user will check them).`)
      }
      if (unknown.length) lines.push(`Not comments on this artifact (ignored): ${unknown.join(', ')}.`)
      const open = a.comments.filter((c) => c.state === 'sent')
      if (open.length) lines.push(`Comments still open on this artifact: ${open.map((c) => `${c.id} (${anchorLabel(c.anchor, 40)})`).join('; ')}. Fix them and re-publish with fixes, or answer with artifact_reply.`)
      return lines.join('\n')
    })
  }

  /** artifact_reply: agent trả lời một góp ý (có thể kèm nút trả lời nhanh) → chờ người dùng. */
  async reply(ws: Workspace, agent: Agent, input: ReplyInput): Promise<string> {
    const text = clean(input.text, MAX_TEXT, true)
    if (!text) throw new Error('text is empty.')
    const options = (input.options ?? []).map((o) => clean(o, 60)).filter(Boolean).slice(0, 4)
    return this.mutate(ws, (d) => {
      const { a, c } = findComment(d, input.id)
      if (c.state === 'draft') throw new Error(`Comment ${c.id} was not sent to you.`)
      const msg: CommentMessage = { by: 'agent', name: agent.name, text, at: now(), ...(options.length ? { options } : {}) }
      c.thread.push(msg)
      c.state = 'you'
      delete c.prevState
      c.updatedAt = msg.at
      a.updatedAt = msg.at
      return `Reply added to ${c.id} on "${a.title}". The user sees it under "Needs you" and answers in the stag.ai "Sản phẩm" (Artifacts) tab; the answer comes back to your session.`
    })
  }

  // ---------- người dùng ----------

  async markSeen(ws: Workspace, id: string): Promise<void> {
    await this.mutate(ws, (d) => {
      const a = findArtifact(d, id)
      a.seen = latestVersion(a)?.v ?? 0
    })
  }

  /** Góp ý mới: nháp, hoặc gửi luôn (vào hàng chờ, gõ vào phiên agent khi agent rảnh). */
  async addComment(ws: Workspace, id: string, input: { v: number; anchor: CommentAnchor; text: string; send: boolean }): Promise<ArtifactComment> {
    const text = clean(input.text, MAX_TEXT, true)
    if (!text) throw new Error('Góp ý trống')
    const c = await this.mutate(ws, (d) => {
      const a = findArtifact(d, id)
      const at = now()
      const c: ArtifactComment = {
        id: `c${d.next.c++}`,
        v: input.v,
        no: a.comments.reduce((n, x) => Math.max(n, x.no), 0) + 1,
        anchor: sanitizeAnchor(input.anchor),
        state: input.send ? 'queued' : 'draft',
        thread: [{ by: 'user', text, at }],
        createdAt: at,
        updatedAt: at
      }
      a.comments.push(c)
      return c
    })
    if (input.send) this.kick(ws, id)
    return c
  }

  /** Sửa chữ của góp ý nháp (giữ chỗ neo). */
  async editDraft(ws: Workspace, cid: string, text: string): Promise<void> {
    const t = clean(text, MAX_TEXT, true)
    if (!t) throw new Error('Góp ý trống')
    await this.mutate(ws, (d) => {
      const { c } = findComment(d, cid)
      if (c.state !== 'draft') throw new Error('Chỉ sửa được góp ý nháp')
      c.thread[0] = { ...c.thread[0], text: t, at: now() }
      c.updatedAt = now()
    })
  }

  async deleteDraft(ws: Workspace, cid: string): Promise<void> {
    await this.mutate(ws, (d) => {
      const { a, c } = findComment(d, cid)
      if (c.state !== 'draft') throw new Error('Chỉ xoá được góp ý nháp')
      a.comments = a.comments.filter((x) => x !== c)
    })
  }

  /** "Gửi N góp ý": mọi nháp của sản phẩm vào hàng chờ. Trả về số góp ý. */
  async sendDrafts(ws: Workspace, id: string): Promise<number> {
    const n = await this.mutate(ws, (d) => {
      const a = findArtifact(d, id)
      let n = 0
      for (const c of a.comments)
        if (c.state === 'draft') {
          c.state = 'queued'
          c.updatedAt = now()
          n++
        }
      return n
    })
    if (n) this.kick(ws, id)
    return n
  }

  /** Người dùng viết tiếp trong mạch (trả lời, nút trả lời nhanh, "Chưa ổn…", "Mở lại…") → vào hàng chờ gửi agent. */
  async say(ws: Workspace, cid: string, text: string): Promise<void> {
    const t = clean(text, MAX_TEXT, true)
    if (!t) throw new Error('Tin trống')
    const artifactId = await this.mutate(ws, (d) => {
      const { a, c } = findComment(d, cid)
      if (c.state === 'draft') throw new Error('Góp ý này còn là nháp')
      if (c.state !== 'queued') c.prevState = c.state
      c.thread.push({ by: 'user', text: t, at: now() })
      c.state = 'queued'
      c.updatedAt = now()
      return a.id
    })
    this.kick(ws, artifactId)
  }

  async close(ws: Workspace, cid: string): Promise<void> {
    await this.mutate(ws, (d) => {
      const { c } = findComment(d, cid)
      if (c.state === 'draft') throw new Error('Góp ý nháp thì xoá, không đóng')
      c.state = 'closed'
      delete c.prevState
      c.updatedAt = now()
    })
  }

  /**
   * "Huỷ gửi" một góp ý còn trong hàng chờ: tin cuối của người dùng được lấy ra (trả về để đặt lại vào ô soạn). Góp ý
   * mới một tin → về nháp (giữ chữ); mạch có trả lời trước đó → về trạng thái trước khi gửi.
   */
  async unsend(ws: Workspace, cid: string): Promise<{ text: string; draft: boolean }> {
    return this.mutate(ws, (d) => {
      const { c } = findComment(d, cid)
      if (c.state !== 'queued') throw new Error('Góp ý đã được gửi cho agent, không huỷ được nữa')
      if (c.thread.length <= 1) {
        c.state = 'draft'
        c.updatedAt = now()
        return { text: c.thread[0]?.text ?? '', draft: true }
      }
      const last = c.thread[c.thread.length - 1]
      c.thread.pop()
      c.state = c.prevState ?? 'sent'
      delete c.prevState
      c.updatedAt = now()
      return { text: last.by === 'user' ? last.text : '', draft: false }
    })
  }

  /** Gỡ khỏi danh sách (file trong dự án và bản chụp vẫn giữ; nộp lại thì hiện lại). */
  async hide(ws: Workspace, id: string): Promise<void> {
    await this.mutate(ws, (d) => {
      findArtifact(d, id).hidden = true
    })
  }

  // ---------- gửi vào phiên agent ----------

  private kick(ws: Workspace, artifactId: string): void {
    void this.load(ws).then((d) => {
      const a = d.artifacts.find((x) => x.id === artifactId)
      if (a) this.onQueued?.(a.agentId)
    })
  }

  /** Góp ý đang chờ gửi cho agent này (mọi workspace đã mở), gom theo sản phẩm. */
  async queuedFor(agentId: string): Promise<Delivery[]> {
    const out: Delivery[] = []
    for (const ws of this.known.values()) {
      const d = await this.load(ws)
      for (const a of d.artifacts) {
        if (a.agentId !== agentId) continue
        const comments = a.comments.filter((c) => c.state === 'queued')
        if (comments.length) out.push({ ws, artifact: a, comments })
      }
    }
    return out
  }

  /** Đã gõ các góp ý này vào phiên agent. */
  async delivered(ws: Workspace, ids: string[]): Promise<void> {
    const set = new Set(ids)
    await this.mutate(ws, (d) => {
      for (const a of d.artifacts)
        for (const c of a.comments)
          if (set.has(c.id) && c.state === 'queued') {
            c.state = 'sent'
            delete c.prevState
            c.updatedAt = now()
          }
    })
  }

  /** Nạp sẵn workspace (lúc mở app) để hàng chờ được xét ngay cả khi người dùng chưa mở tab. */
  async warm(ws: Workspace): Promise<void> {
    await this.load(ws)
  }

  async renameAgent(agentId: string, name: string): Promise<void> {
    for (const ws of this.known.values()) {
      const d = await this.load(ws)
      if (!d.artifacts.some((a) => a.agentId === agentId || a.versions.some((v) => v.agentId === agentId))) continue
      await this.mutate(ws, (x) => {
        for (const a of x.artifacts) {
          if (a.agentId === agentId) a.agentName = name
          for (const v of a.versions) if (v.agentId === agentId) v.agentName = name
        }
      })
    }
  }

  forgetWorkspace(workspaceId: string): void {
    this.data.delete(workspaceId)
    this.known.delete(workspaceId)
  }

  async flush(): Promise<void> {
    await Promise.all(this.chain.values())
  }
}

/** Tin gõ vào phiên agent cho các góp ý đang chờ (tiếng Anh, agent đọc). */
export function commentMessage(items: Delivery[]): string {
  const lines: string[] = ['[stag.ai] Comments from the user on your artifacts (tab "Sản phẩm"):']
  for (const { artifact: a, comments } of items) {
    const v = latestVersion(a)?.v ?? 1
    lines.push('', `Artifact ${a.id} "${a.title}" — file ${a.rel}, latest v${v}:`)
    for (const c of comments) {
      const users = c.thread.filter((m) => m.by === 'user')
      const first = c.thread.length === 1
      const where = `${anchorLabel(c.anchor)}${c.v !== v ? ` (on v${c.v})` : ''}`
      if (first) lines.push(`- [${c.id}] on ${where}: ${c.thread[0].text}`)
      else {
        const lastAgent = [...c.thread].reverse().find((m) => m.by === 'agent')
        const said = lastAgent ? ` You said: "${short(lastAgent.text, 160)}".` : ''
        const fixed = c.fixedIn ? ` You marked it fixed in v${c.fixedIn}.` : ''
        lines.push(`- [${c.id}] follow-up on ${where}.${fixed}${said} The user answers: ${users.at(-1)?.text ?? ''}`)
      }
    }
  }
  lines.push(
    '',
    'For each comment: answer or ask back with artifact_reply(id, text, options?) when it needs words; when you change the file, re-publish it with artifact_publish(file, title, description, note, fixes: [ids you fixed]). Do not edit outside your task scope without asking.'
  )
  return lines.join('\n')
}

function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

function clean(s: unknown, max: number, multiline = false): string {
  const t = String(s ?? '').replace(/\r\n?/g, '\n')
  return (multiline ? t.trim() : t.replace(/\s+/g, ' ').trim()).slice(0, max)
}

function safeId(id: string): string {
  if (!/^a\d+$/.test(id)) throw new Error('Mã sản phẩm không hợp lệ')
  return id
}

function findArtifact(d: IndexFile, id: string): ArtifactRecord {
  const a = d.artifacts.find((x) => x.id === id)
  if (!a) throw new Error(`Artifact ${id} not found.`)
  return a
}

function findComment(d: IndexFile, id: string): { a: ArtifactRecord; c: ArtifactComment } {
  const want = String(id).trim().replace(/^\[|\]$/g, '')
  for (const a of d.artifacts) {
    const c = a.comments.find((x) => x.id === want)
    if (c) return { a, c }
  }
  throw new Error(`Comment ${want} not found in this workspace.`)
}

function sanitizeAnchor(a: CommentAnchor): CommentAnchor {
  const num = (x: unknown, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number(x) || 0))
  switch (a?.type) {
    case 'text':
      return { type: 'text', block: String(a.block).slice(0, 40), off: Math.max(0, Math.floor(Number(a.off) || 0)), quote: String(a.quote ?? '').slice(0, 500) }
    case 'pin':
      return { type: 'pin', x: num(a.x, 0, 1), y: num(a.y, 0, 1), ...(a.page ? { page: Math.max(1, Math.floor(Number(a.page))) } : {}) }
    case 'time':
      return { type: 'time', t: Math.max(0, Number(a.t) || 0) }
    case 'cell':
      return { type: 'cell', cell: String(a.cell).slice(0, 20), ...(a.sheet ? { sheet: String(a.sheet).slice(0, 60) } : {}), value: String(a.value ?? '').slice(0, 200) }
    default:
      return { type: 'general' }
  }
}

/** Đường dẫn file nộp (tuyệt đối hoặc tương đối với `cwd`) → tương đối trong dự án ('/', giữ hoa thường). */
export function projectFile(root: string, cwd: string, file: string): string {
  let f = String(file ?? '').trim().replace(/^["']|["']$/g, '')
  if (!f) throw new Error('file is empty.')
  // Git Bash: /c/Users/… → c:/Users/…
  if (/^[a-z]:[\\/]/i.test(root) && /^\/[a-z]\//i.test(f)) f = `${f[1]}:${f.slice(2)}`
  const abs = isAbsolute(f) ? resolve(f) : resolve(cwd, f)
  const rel = relative(resolve(root), abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`"${file}" is outside the project folder. Only files inside the project can be published.`)
  const segs = rel.split(sep).join('/').split('/')
  if (segs.some((s) => BLOCKED.has(s.toLowerCase()))) throw new Error(`"${file}" is inside ${segs.find((s) => BLOCKED.has(s.toLowerCase()))}/, which cannot be published.`)
  return segs.join('/')
}
