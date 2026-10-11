// Nạp lịch sử ô chat từ transcript của Claude Code (~/.claude/projects/<dự án>/<phiên>.jsonl): mỗi dòng `user` /
// `assistant` có cùng dạng với sự kiện stream-json (một khối mỗi dòng), nên dùng lại ChatModel. Nhờ vậy
// "tiếp tục phiên" hiện lại hội thoại, cả khi phiên đó trước kia chạy ở ô CLI.
import { promises as fs } from 'node:fs'
import type { ChatItem } from '@shared/chat'
import { ChatModel } from './protocol'

/** Chỉ đọc phần cuối file chừng này (transcript có thể rất lớn). */
const TAIL_BYTES = 3 * 1024 * 1024
/** Giữ tối đa chừng này mục cuối. */
const MAX_ITEMS = 400

/** Lời mở của app (xem agents.ts: `opening`). */
const APP_OPENINGS = new Set(['Start a new session.', 'Continue from the handoff of the previous session.'])
const AGENT_MESSAGE = /^\[stag\.ai\] (?:Message|Handoff) from agent "([^"]+)"[^\n]*:\n\n([\s\S]*)$/

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Chữ + số ảnh của một tin `user` (không phải tool_result). */
function userParts(content: unknown): { text: string; images: number; hasToolResult: boolean } {
  if (typeof content === 'string') return { text: content, images: 0, hasToolResult: false }
  if (!Array.isArray(content)) return { text: '', images: 0, hasToolResult: false }
  let text = ''
  let images = 0
  let hasToolResult = false
  for (const c of content) {
    if (!isObj(c)) continue
    if (c.type === 'text' && typeof c.text === 'string') text += (text ? '\n' : '') + c.text
    else if (c.type === 'image') images++
    else if (c.type === 'tool_result') hasToolResult = true
  }
  return { text, images, hasToolResult }
}

/** Biến nội dung transcript (chuỗi JSONL) thành danh sách mục. `partial`: dòng đầu có thể bị cắt dở → bỏ. */
export function itemsFromTranscript(text: string, partial = false): ChatItem[] {
  const model = new ChatModel()
  const lines = text.split('\n')
  if (partial) lines.shift()
  for (const line of lines) {
    if (!line.trim()) continue
    let e: unknown
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (!isObj(e) || e.isSidechain === true) continue
    if (typeof e.timestamp === 'string') {
      const ts = e.timestamp
      model.now = () => ts
    }
    if (e.type === 'assistant') {
      model.ingest(e)
    } else if (e.type === 'user') {
      if (e.isMeta === true || e.isCompactSummary === true) continue
      const m = isObj(e.message) ? e.message : null
      const parts = userParts(m?.content)
      if (parts.hasToolResult) {
        model.ingest(e)
        continue
      }
      const t = parts.text.trim()
      if (!t && !parts.images) continue
      userItem(model, t, parts.images)
    }
  }
  return model.items.slice(-MAX_ITEMS)
}

/**
 * Một lời "người dùng" trong transcript / rollout → mục user (lời mở của app, tin agent khác gửi, lời người dùng) hoặc
 * thông báo. Bỏ lệnh / thông báo hệ thống của CLI.
 */
export function userItem(model: ChatModel, text: string, images = 0): void {
  if (/^<(command-name|command-message|local-command|system-reminder|turn_aborted)/.test(text)) return
  // Claude Code ghi dòng này vào transcript khi người dùng ngắt lượt.
  if (/^\[Request interrupted by user/.test(text)) {
    model.addNotice('info', 'Đã ngắt lượt')
    return
  }
  if (APP_OPENINGS.has(text)) {
    model.addUser(text, 'app')
    return
  }
  const am = AGENT_MESSAGE.exec(text)
  if (am) model.addUser(am[2].trim(), 'agent', { from: am[1] })
  else model.addUser(text, 'user', { images })
}

/** Đọc lịch sử từ file transcript (chỉ phần cuối). File chưa có / không đọc được → []. */
export async function loadHistory(file: string): Promise<ChatItem[]> {
  try {
    const st = await fs.stat(file)
    const start = Math.max(0, st.size - TAIL_BYTES)
    const fh = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(st.size - start)
      await fh.read(buf, 0, buf.length, start)
      return itemsFromTranscript(buf.toString('utf8'), start > 0)
    } finally {
      await fh.close()
    }
  } catch {
    return []
  }
}
