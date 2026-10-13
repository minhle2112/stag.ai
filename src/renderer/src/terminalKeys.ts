import type { AgentKind } from '@shared/types'

/** Chuỗi Alt+Enter (ESC + CR): Claude Code CLI và Codex CLI coi là xuống dòng trong ô soạn tin, không gửi. */
export const SOFT_NEWLINE = '\x1b\r'

/** Ô terminal của loại agent này đổi Shift+Enter thành xuống dòng (ô Terminal thường / adapter ngoài giữ nguyên). */
export function wantsSoftNewline(kind: AgentKind): boolean {
  return kind === 'claude' || kind === 'codex'
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'isComposing'>

/**
 * Shift+Enter (không kèm Ctrl / Alt / Win, không đang gõ bộ gõ tiếng Việt): xterm gửi '\r' giống Enter nên CLI gửi
 * tin luôn. Ô Claude / Codex đổi phím này thành SOFT_NEWLINE.
 */
export function isSoftNewlineKey(ev: KeyLike): boolean {
  return ev.key === 'Enter' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.isComposing
}
