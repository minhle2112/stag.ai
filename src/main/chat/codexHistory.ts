// Nạp lịch sử ô chat Codex từ rollout (~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl): "Tiếp tục phiên
// trước" và đổi CLI ↔ chat hiện lại hội thoại. Codex 0.162 ghi mỗi item đã xong thành `event_msg` / `item_completed`
// (cùng các item như app-server gửi, nhưng tên kiểu PascalCase và trường snake_case) → đổi về dạng app-server rồi dùng
// lại CodexChatModel. Rollout của bản cũ chỉ có `user_message` / `agent_message`: lấy chữ hai bên.
import { promises as fs } from 'node:fs'
import type { ChatItem } from '@shared/chat'
import { CodexChatModel } from './codexProtocol'
import { userItem } from './history'

/** Chỉ đọc phần cuối file chừng này (rollout có thể rất lớn). */
const TAIL_BYTES = 3 * 1024 * 1024
/** Giữ tối đa chừng này mục cuối. */
const MAX_ITEMS = 400

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Chữ của nội dung người dùng (khối text). */
function userText(content: unknown): { text: string; images: number } {
  let text = ''
  let images = 0
  for (const c of arr(content)) {
    if (!isObj(c)) continue
    if (c.type === 'text' && str(c.text)) text += (text ? '\n' : '') + str(c.text)
    else if (c.type === 'image' || c.type === 'localImage' || c.type === 'local_image') images++
  }
  return { text, images }
}

/** Item trong rollout (PascalCase / snake_case) → dạng ThreadItem của app-server (camelCase). */
export function normalizeRolloutItem(raw: Json): Json {
  const t = str(raw.type)
  const type = t ? t.charAt(0).toLowerCase() + t.slice(1) : ''
  switch (type) {
    case 'agentMessage': {
      const text = typeof raw.text === 'string' ? raw.text : arr(raw.content).map((c) => (isObj(c) ? str(c.text) : '')).join('')
      return { type, id: raw.id, text, phase: raw.phase ?? null }
    }
    case 'reasoning':
      return { type, id: raw.id, summary: arr(raw.summary ?? raw.summary_text), content: arr(raw.content ?? raw.raw_content) }
    case 'commandExecution': {
      const parsed = arr(raw.commandActions ?? raw.parsed_cmd)
      return {
        type,
        id: raw.id,
        command: raw.command,
        cwd: str(raw.cwd).replace(/^file:\/\/\//, ''),
        commandActions: parsed.map((p) => (isObj(p) ? { ...p, command: str(p.command) || str(p.cmd) } : p)),
        status: raw.status,
        aggregatedOutput: raw.aggregatedOutput ?? raw.aggregated_output ?? null,
        exitCode: raw.exitCode ?? raw.exit_code ?? null
      }
    }
    case 'fileChange': {
      // Rollout: { "<đường dẫn>": { type: add | delete | update, content | unified_diff, move_path } }.
      const changes = Array.isArray(raw.changes)
        ? raw.changes
        : Object.entries(isObj(raw.changes) ? raw.changes : {}).map(([path, c]) => {
            const v = isObj(c) ? c : {}
            return { path, kind: { type: str(v.type) || 'update', move_path: v.move_path ?? null }, diff: str(v.unified_diff) || str(v.content) || str(v.diff) }
          })
      return { type, id: raw.id, changes, status: raw.status }
    }
    default:
      // mcpToolCall, webSearch, plan…: cùng tên trường với app-server.
      return { ...raw, type }
  }
}

/** Biến nội dung rollout (chuỗi JSONL) thành danh sách mục. `partial`: dòng đầu có thể bị cắt dở → bỏ. */
export function itemsFromRollout(text: string, partial = false): ChatItem[] {
  const model = new CodexChatModel()
  const lines = text.split('\n')
  if (partial) lines.shift()
  // Bản mới ghi item_completed (đủ tool); bản cũ chỉ có user_message / agent_message.
  const modern = text.includes('"type":"item_completed"')
  let turn = ''
  let legacy = 0
  for (const line of lines) {
    if (!line.trim()) continue
    let e: unknown
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(e) || e.type !== 'event_msg' || !isObj(e.payload)) continue
    if (typeof e.timestamp === 'string') {
      const ts = e.timestamp
      model.now = () => ts
    }
    const p = e.payload
    switch (str(p.type)) {
      case 'task_started':
        turn = str(p.turn_id) || turn
        break
      case 'item_completed': {
        if (!isObj(p.item)) break
        const item = normalizeRolloutItem(p.item)
        turn = str(p.turn_id) || turn
        if (item.type === 'userMessage') {
          const u = userText(p.item.content)
          if (u.text.trim() || u.images) userItem(model, u.text.trim(), u.images)
        } else model.addCompletedItem(item, turn)
        break
      }
      case 'user_message':
        if (!modern && str(p.message).trim()) userItem(model, str(p.message).trim(), arr(p.images).length)
        break
      case 'agent_message':
        if (!modern && str(p.message).trim()) model.addCompletedItem({ type: 'agentMessage', id: `legacy-${++legacy}`, text: str(p.message) }, turn)
        break
      case 'task_complete':
        model.addTurn(typeof p.duration_ms === 'number' ? p.duration_ms : 0, 'success')
        break
      case 'turn_aborted':
        model.addTurn(typeof p.duration_ms === 'number' ? p.duration_ms : 0, str(p.reason) === 'interrupted' ? 'interrupted' : 'error_during_execution')
        break
      case 'context_compacted':
        model.addNotice('info', 'Đã nén context')
        break
    }
  }
  return model.items.slice(-MAX_ITEMS)
}

/** Đọc lịch sử từ file rollout (chỉ phần cuối). File chưa có / không đọc được → []. */
export async function loadCodexHistory(file: string | null): Promise<ChatItem[]> {
  if (!file) return []
  try {
    const st = await fs.stat(file)
    const start = Math.max(0, st.size - TAIL_BYTES)
    const fh = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(st.size - start)
      await fh.read(buf, 0, buf.length, start)
      return itemsFromRollout(buf.toString('utf8'), start > 0)
    } finally {
      await fh.close()
    }
  } catch {
    return []
  }
}
