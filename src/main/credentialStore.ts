import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import {
  hostMatches,
  isTotpError,
  normalizeDomain,
  parseTotp,
  POLICIES,
  slugId,
  usernameHint,
  type CredentialInput,
  type CredentialLogEntry,
  type CredentialPatch,
  type CredentialsState,
  type CredentialView,
  type ImportRow,
  type TotpParams
} from '@shared/credentials'
import { isObject, JsonFile } from './jsonFile'
import type { Cipher } from './secrets'

/** Phần bí mật của một mục, mã hoá cả khối bằng safeStorage. */
export interface CredentialSecret {
  username: string
  password: string
  totp?: TotpParams
}

interface Stored extends Omit<CredentialView, 'username'> {
  /** base64 của bản mã JSON CredentialSecret. */
  data: string
}

/** Nhật ký giữ 90 ngày. */
export const LOG_DAYS = 90
const MAX_PASSWORD = 4000
const MAX_ITEMS = 2000

/**
 * Kho mật khẩu của app (dùng chung mọi workspace): userData/credentials.json, phần bí mật của mỗi mục (tên đăng nhập,
 * mật khẩu, khoá 2FA) mã hoá bằng safeStorage (DPAPI). Không bao giờ ghi vào vault, `.stag/`, settings.json hay log.
 * Nhật ký dùng: credentials-log.jsonl cạnh kho, không có giá trị bí mật.
 */
export class CredentialStore {
  private items: Stored[] = []
  private never: string[] = []
  private json: JsonFile
  private logChain: Promise<void> = Promise.resolve()

  constructor(
    file: string,
    private logFile: string,
    private cipher: Cipher,
    private onChange: (s: CredentialsState) => void = () => {},
    private now: () => number = Date.now
  ) {
    this.json = new JsonFile(file)
  }

  async load(): Promise<void> {
    const { data } = await this.json.read(isObject)
    const raw = Array.isArray(data?.items) ? (data.items as unknown[]) : []
    this.items = raw.filter(isObject).flatMap((x) => {
      const s = x as unknown as Stored
      if (typeof s.id !== 'string' || typeof s.data !== 'string' || !Array.isArray(s.domains)) return []
      return [
        {
          id: s.id,
          name: String(s.name ?? s.id),
          domains: s.domains.map(String),
          hint: String(s.hint ?? ''),
          hasPassword: !!s.hasPassword,
          hasTotp: !!s.hasTotp,
          agents: Array.isArray(s.agents) ? s.agents.map(String) : [],
          approved: Array.isArray(s.approved) ? s.approved.map(String) : [],
          workspaces: Array.isArray(s.workspaces) ? s.workspaces.map(String) : null,
          policy: POLICIES.includes(s.policy) ? s.policy : 'ask',
          createdAt: String(s.createdAt ?? ''),
          updatedAt: String(s.updatedAt ?? ''),
          ...(s.lastUsed && typeof s.lastUsed.at === 'string' ? { lastUsed: { at: s.lastUsed.at, agentName: String(s.lastUsed.agentName ?? '') } } : {}),
          data: s.data
        }
      ]
    })
    this.never = Array.isArray(data?.never) ? (data.never as unknown[]).map(String) : []
    await this.pruneLog()
  }

  available(): boolean {
    return this.cipher.available()
  }

  state(): CredentialsState {
    return { available: this.cipher.available(), items: this.items.map((s) => this.view(s)), never: [...this.never] }
  }

  private view(s: Stored): CredentialView {
    const { data: _data, ...rest } = s
    return { ...rest, username: this.secretOf(s)?.username ?? '' }
  }

  get(id: string): CredentialView | undefined {
    const s = this.items.find((x) => x.id === id)
    return s ? this.view(s) : undefined
  }

  /** Phần bí mật (chỉ dùng ở main: điền trang, Hiện / Chép của bạn). undefined = không giải mã được. */
  secret(id: string): CredentialSecret | undefined {
    const s = this.items.find((x) => x.id === id)
    return s ? this.secretOf(s) : undefined
  }

  private secretOf(s: Stored): CredentialSecret | undefined {
    try {
      const x = JSON.parse(this.cipher.decrypt(Buffer.from(s.data, 'base64'))) as CredentialSecret
      return { username: String(x.username ?? ''), password: String(x.password ?? ''), ...(x.totp ? { totp: x.totp } : {}) }
    } catch {
      return undefined
    }
  }

  private seal(sec: CredentialSecret): string {
    return this.cipher.encrypt(JSON.stringify(sec)).toString('base64')
  }

  /** Mục có tên miền khớp host. */
  matching(host: string): CredentialView[] {
    return this.items.filter((s) => hostMatches(host, s.domains)).map((s) => this.view(s))
  }

  isNever(host: string): boolean {
    return this.never.includes(host.toLowerCase())
  }

  /** Thêm (không có id) hoặc sửa một mục. */
  async save(input: CredentialInput): Promise<CredentialView> {
    if (!this.cipher.available()) throw new Error('Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu mật khẩu được.')
    const name = input.name.trim()
    if (!name) throw new Error('Mục cần có tên.')
    const domains = cleanDomains(input.domains)
    if (!domains.length) {
      const wild = input.domains.map((d) => d.trim()).find((d) => d.startsWith('*.'))
      throw new Error(
        wild
          ? `“${wild}” khớp với quá nhiều trang. Dùng tên miền của chính trang, vd. *.shop-abc.vn hoặc admin.shop-abc.vn.`
          : 'Mục cần ít nhất một tên miền (vd. admin.shop-abc.vn).'
      )
    }
    if ((input.password?.length ?? 0) > MAX_PASSWORD) throw new Error('Mật khẩu dài quá.')
    let totp: TotpParams | undefined | null
    if (input.totp === null) totp = null
    else if (typeof input.totp === 'string' && input.totp.trim()) {
      const p = parseTotp(input.totp)
      if (isTotpError(p)) throw new Error(p.error)
      totp = p
    }
    const at = new Date(this.now()).toISOString()
    const old = input.id ? this.items.find((x) => x.id === input.id) : undefined
    if (input.id && !old) throw new Error('Mục này không còn trong kho.')
    const prev = old ? this.secretOf(old) : undefined
    if (old && !prev) throw new Error('Không giải mã được mục này (kho chép từ tài khoản Windows khác?).')
    const sec: CredentialSecret = {
      username: input.username.trim(),
      password: input.password ?? prev?.password ?? '',
      ...(totp === null ? {} : totp ? { totp } : prev?.totp ? { totp: prev.totp } : {})
    }
    if (!sec.password && !sec.totp) throw new Error('Mục cần mật khẩu hoặc khoá 2FA.')
    if (!old && this.items.length >= MAX_ITEMS) throw new Error('Kho đã đầy.')
    const policy = input.policy ?? old?.policy ?? 'ask'
    const agents = input.agents ?? old?.agents ?? []
    const next: Stored = {
      id: old?.id ?? slugId(name, new Set(this.items.map((x) => x.id))),
      name,
      domains,
      hint: usernameHint(sec.username),
      hasPassword: !!sec.password,
      hasTotp: !!sec.totp,
      agents,
      approved: (old?.approved ?? []).filter((a) => agents.includes(a)),
      workspaces: input.workspaces !== undefined ? input.workspaces : (old?.workspaces ?? null),
      policy,
      createdAt: old?.createdAt ?? at,
      updatedAt: at,
      ...(old?.lastUsed ? { lastUsed: old.lastUsed } : {}),
      data: this.seal(sec)
    }
    this.items = old ? this.items.map((x) => (x === old ? next : x)) : [...this.items, next]
    await this.commit()
    return this.view(next)
  }

  /** Đổi phần không bí mật (agent được dùng, chế độ hỏi, workspace, tên, tên miền). */
  async patch(id: string, p: CredentialPatch): Promise<CredentialView> {
    const old = this.items.find((x) => x.id === id)
    if (!old) throw new Error('Mục này không còn trong kho.')
    const agents = p.agents ?? old.agents
    const next: Stored = {
      ...old,
      ...(p.name !== undefined && p.name.trim() ? { name: p.name.trim() } : {}),
      ...(p.domains ? { domains: cleanDomains(p.domains).length ? cleanDomains(p.domains) : old.domains } : {}),
      ...(p.policy && POLICIES.includes(p.policy) ? { policy: p.policy } : {}),
      ...(p.workspaces !== undefined ? { workspaces: p.workspaces } : {}),
      agents,
      // Bỏ chọn agent thì cũng bỏ "Luôn cho" của nó.
      approved: (p.approved ?? old.approved).filter((a) => agents.includes(a)),
      updatedAt: new Date(this.now()).toISOString()
    }
    this.items = this.items.map((x) => (x === old ? next : x))
    await this.commit()
    return this.view(next)
  }

  /** "Luôn cho agent này": chọn agent và nhớ đã cho (không hỏi lại ở chế độ hỏi lần đầu / không hỏi). */
  async approve(id: string, agentId: string): Promise<void> {
    const it = this.items.find((x) => x.id === id)
    if (!it) return
    await this.patch(id, { agents: [...new Set([...it.agents, agentId])], approved: [...new Set([...it.approved, agentId])] })
  }

  async setPassword(id: string, password: string): Promise<void> {
    const old = this.items.find((x) => x.id === id)
    const sec = old && this.secretOf(old)
    if (!old || !sec) throw new Error('Mục này không còn trong kho.')
    await this.replace(old, { ...sec, password })
  }

  async setTotp(id: string, totp: TotpParams | null): Promise<void> {
    const old = this.items.find((x) => x.id === id)
    const sec = old && this.secretOf(old)
    if (!old || !sec) throw new Error('Mục này không còn trong kho.')
    const { totp: _t, ...rest } = sec
    await this.replace(old, totp ? { ...rest, totp } : rest)
  }

  private async replace(old: Stored, sec: CredentialSecret): Promise<void> {
    const next: Stored = { ...old, data: this.seal(sec), hasPassword: !!sec.password, hasTotp: !!sec.totp, hint: usernameHint(sec.username), updatedAt: new Date(this.now()).toISOString() }
    this.items = this.items.map((x) => (x === old ? next : x))
    await this.commit()
  }

  async touch(id: string, agentName: string): Promise<void> {
    const old = this.items.find((x) => x.id === id)
    if (!old) return
    const next = { ...old, lastUsed: { at: new Date(this.now()).toISOString(), agentName } }
    this.items = this.items.map((x) => (x === old ? next : x))
    await this.commit()
  }

  async remove(id: string): Promise<void> {
    if (!this.items.some((x) => x.id === id)) return
    this.items = this.items.filter((x) => x.id !== id)
    await this.commit()
  }

  async addNever(host: string): Promise<void> {
    const h = host.toLowerCase()
    if (this.never.includes(h)) return
    this.never = [...this.never, h]
    await this.commit()
  }

  async removeNever(host: string): Promise<void> {
    this.never = this.never.filter((x) => x !== host.toLowerCase())
    await this.commit()
  }

  /** Mục nhập đã có (cùng tên miền đầu + tên đăng nhập). */
  duplicateOf(row: Pick<ImportRow, 'domains' | 'username'>): CredentialView | undefined {
    const host = row.domains[0]
    return host ? this.matching(host).find((v) => v.username.toLowerCase() === row.username.toLowerCase()) : undefined
  }

  /** Nhập các mục từ file export: trùng (tên miền + tên đăng nhập) thì cập nhật mật khẩu / 2FA. */
  async importRows(rows: ImportRow[]): Promise<{ added: number; updated: number; errors: string[] }> {
    let added = 0
    let updated = 0
    const errors: string[] = []
    for (const r of rows) {
      try {
        const dup = this.duplicateOf(r)
        await this.save({
          ...(dup ? { id: dup.id } : {}),
          name: dup?.name ?? r.name,
          domains: dup ? [...new Set([...dup.domains, ...r.domains])] : r.domains,
          username: r.username,
          ...(r.password ? { password: r.password } : {}),
          ...(r.totp ? { totp: r.totp } : {})
        })
        if (dup) updated++
        else added++
      } catch (e) {
        errors.push(`${r.name}: ${(e as Error).message}`)
      }
    }
    return { added, updated, errors }
  }

  private async commit(): Promise<void> {
    await this.json.write({ version: 1, items: this.items, never: this.never })
    this.onChange(this.state())
  }

  // ---------- nhật ký ----------

  log(e: Omit<CredentialLogEntry, 'at'>): Promise<void> {
    const line = JSON.stringify({ at: new Date(this.now()).toISOString(), ...e }) + '\n'
    const p = this.logChain.then(async () => {
      await fs.mkdir(dirname(this.logFile), { recursive: true })
      await fs.appendFile(this.logFile, line, 'utf8')
    })
    this.logChain = p.catch(() => {})
    return p.catch((err) => console.error('[credentials] log', err))
  }

  /** Nhật ký mới nhất trước; `itemId` = chỉ của một mục. */
  async readLog(itemId?: string, limit = 200): Promise<CredentialLogEntry[]> {
    await this.logChain
    const raw = await fs.readFile(this.logFile, 'utf8').catch(() => '')
    const out: CredentialLogEntry[] = []
    for (const l of raw.split('\n').reverse()) {
      if (!l.trim()) continue
      try {
        const e = JSON.parse(l) as CredentialLogEntry
        if (!itemId || e.itemId === itemId) out.push(e)
      } catch {
        /* dòng hỏng */
      }
      if (out.length >= limit) break
    }
    return out
  }

  /** Bỏ dòng cũ hơn 90 ngày. */
  private async pruneLog(): Promise<void> {
    const raw = await fs.readFile(this.logFile, 'utf8').catch(() => '')
    if (!raw) return
    const cut = this.now() - LOG_DAYS * 86_400_000
    const keep = raw.split('\n').filter((l) => {
      if (!l.trim()) return false
      try {
        return Date.parse((JSON.parse(l) as CredentialLogEntry).at) >= cut
      } catch {
        return false
      }
    })
    if (keep.length !== raw.split('\n').filter((l) => l.trim()).length) await fs.writeFile(this.logFile, keep.map((l) => l + '\n').join(''), 'utf8')
  }
}

function cleanDomains(list: readonly string[]): string[] {
  const out: string[] = []
  for (const d of list) {
    const n = normalizeDomain(d)
    if (n && !out.includes(n)) out.push(n)
  }
  return out
}
