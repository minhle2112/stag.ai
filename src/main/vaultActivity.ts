import { projectRel } from '@shared/scope'
import type { Agent, VaultActivity, Workspace } from '@shared/types'
import type { HookPayload } from './board'
import { editTargets, looksLikeWrite, shellCommand } from './scopeGuard'

/** Số lần đọc/ghi giữ lại mỗi workspace (chỉ trong bộ nhớ, mất khi tắt app). */
const MAX_EVENTS = 300
/** Cùng agent, cùng note, cùng kiểu trong khoảng này → gộp làm một (chỉ cập nhật giờ). */
const MERGE_MS = 5000

/**
 * Đường dẫn `.md` nhắc tới trong lệnh shell: trong nháy đơn / nháy kép (có thể có khoảng trắng), hoặc một
 * chữ liền không nháy.
 */
export function mdMentions(cmd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/'([^'\n]+?\.md)'|"([^"\n]+?\.md)"|(?:^|[\s=(,])([^\s'"`|;&<>(),]+\.md)(?=$|[\s'"`|;&<>(),])/gim))
    out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/**
 * Note trong vault mà một lần gọi tool (PostToolUse) vừa đọc / ghi. Claude: Read = đọc; Edit/Write… = ghi.
 * Codex: apply_patch = ghi. Lệnh shell: các `.md` nhắc tới trong lệnh, ghi nếu lệnh có dấu hiệu ghi, không thì đọc
 * (chỉ là đoán). `rel` giữ hoa thường của đường dẫn gốc khi được.
 */
export function vaultTouches(p: HookPayload, vaultPath: string, projectPath: string): Array<{ rel: string; kind: 'read' | 'write' }> {
  const cwd = p.cwd ?? projectPath
  let paths: string[] = []
  let kind: 'read' | 'write' = 'write'
  const edits = editTargets(p)
  const cmd = shellCommand(p)
  if (edits) paths = edits
  else if (p.tool_name === 'Read' && typeof p.tool_input?.file_path === 'string') {
    paths = [p.tool_input.file_path]
    kind = 'read'
  } else if (cmd) {
    paths = mdMentions(cmd)
    kind = looksLikeWrite(cmd) ? 'write' : 'read'
  }
  const out: Array<{ rel: string; kind: 'read' | 'write' }> = []
  for (const path of paths) {
    const rel = projectRel(path, vaultPath, cwd)
    if (!rel || !rel.endsWith('.md') || rel.split('/').some((s) => s.startsWith('.'))) continue
    const norm = path.replace(/\\/g, '/')
    const shown = norm.length >= rel.length && norm.slice(-rel.length).toLowerCase() === rel ? norm.slice(-rel.length) : rel
    if (!out.some((o) => o.rel.toLowerCase() === rel && o.kind === kind)) out.push({ rel: shown, kind })
  }
  return out
}

/** Nhật ký agent đọc / ghi note của vault, theo workspace. */
export class VaultActivityLog {
  private byWs = new Map<string, VaultActivity[]>()
  private pending = new Map<string, NodeJS.Timeout>()

  constructor(
    private notify: (workspaceId: string) => void,
    /** Agent vừa ghi các note này (rel trong vault; plugin: sự kiện vault.note.changed). */
    private onWrite?: (ws: Workspace, agent: Agent, rels: string[]) => void
  ) {}

  /** Ghi các note một lần gọi tool vừa đụng tới (hook PostToolUse). */
  onToolUse(ws: Workspace, agent: Agent, p: HookPayload): void {
    this.record(ws, agent, vaultTouches(p, ws.vaultPath, ws.path))
  }

  /** Ghi các note agent vừa đọc / ghi (từ hook, hoặc trực tiếp từ tool memory_* của MCP stag). */
  record(ws: Workspace, agent: Agent, touches: Array<{ rel: string; kind: 'read' | 'write' }>): void {
    if (!touches.length) return
    const list = this.byWs.get(ws.id) ?? []
    const now = new Date()
    for (const t of touches) {
      const last = list.findLast((e) => e.agentId === agent.id && e.rel.toLowerCase() === t.rel.toLowerCase() && e.kind === t.kind)
      if (last && now.getTime() - Date.parse(last.at) < MERGE_MS) {
        last.at = now.toISOString()
        continue
      }
      list.push({ agentId: agent.id, agentName: agent.name, rel: t.rel, kind: t.kind, at: now.toISOString() })
    }
    this.byWs.set(ws.id, list.slice(-MAX_EVENTS))
    this.notifySoon(ws.id)
    const written = touches.filter((t) => t.kind === 'write').map((t) => t.rel)
    if (written.length) this.onWrite?.(ws, agent, written)
  }

  list(workspaceId: string): VaultActivity[] {
    return this.byWs.get(workspaceId) ?? []
  }

  /** Agent đổi tên: các dòng cũ hiện tên mới. */
  renameAgent(agentId: string, name: string): void {
    for (const [wsId, list] of this.byWs) {
      if (!list.some((e) => e.agentId === agentId)) continue
      for (const e of list) if (e.agentId === agentId) e.agentName = name
      this.notifySoon(wsId)
    }
  }

  forgetWorkspace(workspaceId: string): void {
    this.byWs.delete(workspaceId)
  }

  private notifySoon(workspaceId: string): void {
    if (this.pending.has(workspaceId)) return
    this.pending.set(
      workspaceId,
      setTimeout(() => {
        this.pending.delete(workspaceId)
        this.notify(workspaceId)
      }, 200)
    )
  }
}
