// Agent API (agent điều khiển app thay người dùng, xem vault "Agent API"): kiểu dữ liệu + kiểm tra dùng chung main / renderer.

import { MODEL_RE } from './settings'
import type { Agent, AgentKind, CliAdapterId, PermissionMode } from './types'

const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'auto', 'plan']
const EFFORT_RE = /^[a-z]{0,20}$/
/** Vai trò / việc đầu tiên agent khác gửi: đủ dài cho một đoạn mô tả, không để phình file. */
export const ROLE_MAX = 300
export const TASK_MAX = 4000

/** Bản nháp agent mà một agent xin tạo (đã kiểm tra, chờ người dùng xác nhận). */
export interface AgentCreateDraft {
  name: string
  role: string
  kind: AgentKind
  /** kind = 'external'. */
  adapterId?: string
  /** Tên hiển thị của loại (Claude Code, Codex, Terminal, tên adapter ngoài). */
  kindLabel: string
  /** null = không đổi (theo mặc định workspace / app); chỉ Claude Code / Codex. */
  model: string | null
  effort: string | null
  permissionMode: PermissionMode
  /** Việc đầu tiên giao cho phiên mới ('' = không có, agent mới chào và hỏi người dùng như thường). */
  task: string
  /** Mở ô + chạy phiên ngay. */
  open: boolean
}

/** Một yêu cầu của agent đang chờ người dùng xác nhận trong app. */
export interface AgentRequest {
  id: string
  workspaceId: string
  fromAgentId: string
  fromName: string
  action: 'create'
  create: AgentCreateDraft
  /** Hết hạn lúc này (ISO) → coi như từ chối. */
  until: string
}

/** Main báo renderer: agent vừa được tạo qua Agent API, thêm ô cạnh ô của agent đã tạo nó. */
export interface AgentCreatedEvent {
  agent: Agent
  /** Agent đã xin tạo (đặt ô mới cạnh ô này). */
  nearAgentId: string
  open: boolean
}

/** Tham số tool agent_create (đã qua zod, chưa kiểm tra nghiệp vụ). */
export interface AgentCreateInput {
  name: string
  role?: string
  kind: string
  model?: string
  effort?: string
  permission_mode?: string
  task?: string
  open?: boolean
}

/** `kind` của tool → loại agent ('claude' | 'codex' | 'terminal' | 'external:<id>'); null = sai. */
export function parseKind(raw: string): { kind: AgentKind; adapterId?: string } | null {
  const k = raw.trim().toLowerCase()
  if (k === 'claude' || k === 'claude code' || k === 'claude-code') return { kind: 'claude' }
  if (k === 'codex') return { kind: 'codex' }
  if (k === 'terminal') return { kind: 'terminal' }
  const m = /^external:([a-z0-9-]+)$/.exec(k)
  return m ? { kind: 'external', adapterId: m[1] } : null
}

export function isCliKind(kind: AgentKind): kind is CliAdapterId {
  return kind === 'claude' || kind === 'codex'
}

/**
 * Kiểm tra tham số agent_create (phần không cần tới app: loại, model, effort, quyền, độ dài). Trả về lỗi bằng tiếng
 * Anh (agent đọc) hoặc phần đã chuẩn hoá. Tên agent / adapter có thật hay không do main kiểm tiếp.
 */
export function checkCreateInput(
  input: AgentCreateInput,
  defaultPermission: (kind: CliAdapterId) => PermissionMode
): { error: string } | { draft: Omit<AgentCreateDraft, 'kindLabel'> } {
  const parsed = parseKind(input.kind)
  if (!parsed) return { error: `Unknown kind "${input.kind}". Use "claude", "codex", "terminal" or "external:<adapter id>" (see adapter_models).` }
  const { kind, adapterId } = parsed
  const terminal = kind === 'terminal'
  const role = (input.role ?? '').trim()
  const task = (input.task ?? '').trim()
  if (role.length > ROLE_MAX) return { error: `role is too long (max ${ROLE_MAX} characters). Put details in task instead.` }
  if (task.length > TASK_MAX) return { error: `task is too long (max ${TASK_MAX} characters).` }
  if (terminal && task) return { error: 'A terminal cell cannot receive a task (it is a plain shell, not an AI agent). Leave task empty.' }

  const model = input.model?.trim() || null
  const effort = input.effort?.trim().toLowerCase() || null
  if ((model || effort) && !isCliKind(kind)) return { error: `model / effort only apply to "claude" and "codex" agents, not "${input.kind}".` }
  if (model && !MODEL_RE.test(model)) return { error: `Invalid model id "${model}".` }
  if (effort && !EFFORT_RE.test(effort)) return { error: `Invalid effort "${effort}" (e.g. low, medium, high, xhigh, max).` }

  let permissionMode: PermissionMode = 'default'
  if (input.permission_mode?.trim()) {
    const p = PERMISSION_MODES.find((x) => x.toLowerCase() === input.permission_mode!.trim().toLowerCase())
    if (!p) return { error: `Invalid permission_mode "${input.permission_mode}". Use one of: ${PERMISSION_MODES.join(', ')}.` }
    if (!isCliKind(kind)) return { error: 'permission_mode only applies to "claude" and "codex" agents.' }
    permissionMode = p
  } else if (isCliKind(kind)) {
    permissionMode = defaultPermission(kind)
  }

  return {
    draft: {
      name: input.name.trim(),
      role: terminal ? '' : role,
      kind,
      ...(adapterId ? { adapterId } : {}),
      model,
      effort,
      permissionMode,
      task,
      open: input.open ?? true
    }
  }
}

/** Lời mở của phiên đầu tiên khi agent mới có việc do agent khác giao (thay lời chào hỏi việc thường lệ). */
export function firstTaskOpening(fromName: string, task: string): string {
  return (
    `Agent "${fromName}" created you in stag.ai on the user's behalf (the user approved it) and gave you this first task:\n\n` +
    `${task}\n\n` +
    'Greet the user in one sentence, say what you are about to do, then start on the task right away without waiting for an answer. ' +
    'Call task_start as soon as the task and scope are clear. If something essential is missing, ask the user.'
  )
}
