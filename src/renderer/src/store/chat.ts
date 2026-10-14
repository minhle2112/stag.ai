import { create } from 'zustand'
import type { ChatEvent, ChatImage, ChatItem } from '@shared/chat'
import { applyEvent, emptySlice, pushHistory, type ChatSlice } from '../components/chat/chatLogic'

// Dữ liệu ô chat của từng agent. Main giữ danh sách `ChatItem` làm nguồn sự thật và đẩy thay đổi sang đây;
// store chỉ áp sự kiện, nhớ lịch sử ↑ và vài thứ cục bộ (tin đang xếp hàng, lỗi gửi).
//
// Selector KHÔNG được trả mảng / đối tượng mới mỗi lần gọi (zustand 5 sẽ lặp vô hạn): đọc `s.byAgent[id]` rồi
// useMemo ở component.

interface ChatState {
  byAgent: Record<string, ChatSlice>
  /** Tin đã gửi theo agent (cho ↑ ở composer), cũ → mới. */
  history: Record<string, string[]>
  /** Nạp snapshot lần đầu cho agent (an toàn khi gọi nhiều lần). */
  ensure: (agentId: string) => void
  send: (agentId: string, text: string, images?: ChatImage[]) => Promise<boolean>
  interrupt: (agentId: string) => void
  /**
   * Trả lời thẻ xin quyền. Cập nhật thẻ ngay (main sẽ gửi lại bản chính thức).
   * `updatedInput`: tham số mới cho tool (AskUserQuestion: kèm `answers`).
   */
  answer: (agentId: string, requestId: string, behavior: 'allow' | 'deny', opts?: { remember?: boolean; updatedInput?: unknown }) => void
  clearError: (agentId: string) => void
}

function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Gom sự kiện stream vài chục lần / giây thành một lần cập nhật mỗi khung (không tính lại cả danh sách mỗi delta). */
const FLUSH_MS = 30

export const useChat = create<ChatState>((set, get) => {
  const inflight = new Set<string>()
  /** Số lần main gửi 'reset' (phiên mới / hội thoại mới) theo agent: snapshot gọi trước một reset là bản cũ. */
  const resets = new Map<string, number>()
  let queue: ChatEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    timer = null
    const events = queue
    queue = []
    if (!events.length) return
    set((s) => {
      let by = s.byAgent
      for (const ev of events) by = applyEvent(by, ev)
      return by === s.byAgent ? s : { byAgent: by }
    })
  }

  // Một listener cho cả app (module chỉ được nạp một lần).
  window.stag.chat.onEvent((ev) => {
    if (ev.type === 'reset') resets.set(ev.agentId, (resets.get(ev.agentId) ?? 0) + 1)
    queue.push(ev)
    if (!timer) timer = setTimeout(flush, FLUSH_MS)
  })

  const patch = (agentId: string, fn: (cur: ChatSlice) => Partial<ChatSlice>): void =>
    set((s) => {
      const cur = s.byAgent[agentId] ?? emptySlice()
      return { byAgent: { ...s.byAgent, [agentId]: { ...cur, ...fn(cur) } } }
    })

  return {
    byAgent: {},
    history: {},

    ensure(agentId) {
      if (get().byAgent[agentId]?.loaded || inflight.has(agentId)) return
      inflight.add(agentId)
      const epoch = resets.get(agentId) ?? 0
      window.stag.chat
        .snapshot(agentId)
        .then((snap) => {
          flush()
          // Main đọc transcript bất đồng bộ: trong lúc đó phiên mới có thể đã gửi 'reset' (đã áp ở trên) → snapshot
          // này là hội thoại cũ, bỏ. Không có reset thì phản hồi tới sau mọi sự kiện gửi trước nó → mới nhất.
          if ((resets.get(agentId) ?? 0) !== epoch) return
          patch(agentId, () => ({ items: snap.items, state: snap.state, loaded: true }))
        })
        .catch(() => {
          // Main chưa đăng ký / lỗi: coi như chưa có hội thoại, để ô vẫn dùng được; reset từ main sẽ phủ lên.
          patch(agentId, () => ({ loaded: true }))
        })
        .finally(() => inflight.delete(agentId))
    },

    async send(agentId, text, images) {
      const t = text.trim()
      if (!t && !images?.length) return false
      const phase = get().byAgent[agentId]?.state.phase
      const busy = phase === 'busy' || phase === 'waiting'
      set((s) => ({ history: { ...s.history, [agentId]: pushHistory(s.history[agentId] ?? [], t) } }))
      patch(agentId, (cur) => ({ error: undefined, queued: busy && t ? [...cur.queued, t] : cur.queued }))
      try {
        await window.stag.chat.send({ agentId, text: t, images: images?.length ? images : undefined })
        return true
      } catch (e) {
        patch(agentId, (cur) => {
          const at = cur.queued.lastIndexOf(t)
          return { error: errMsg(e), queued: at < 0 ? cur.queued : cur.queued.filter((_, i) => i !== at) }
        })
        return false
      }
    },

    interrupt(agentId) {
      void window.stag.chat.interrupt(agentId).catch(() => {})
    },

    answer(agentId, requestId, behavior, opts) {
      patch(agentId, (cur) => ({
        items: cur.items.map((it): ChatItem =>
          it.kind === 'ask' && it.requestId === requestId && it.state === 'pending'
            ? { ...it, state: behavior === 'allow' ? 'allowed' : 'denied', input: opts?.updatedInput ?? it.input }
            : it
        )
      }))
      const req = { agentId, requestId, behavior, remember: opts?.remember || undefined, updatedInput: opts?.updatedInput }
      void window.stag.chat.permission(req).catch((e) => {
        patch(agentId, () => ({ error: errMsg(e) }))
      })
    },

    clearError(agentId) {
      patch(agentId, () => ({ error: undefined }))
    }
  }
})

// ---------- composer ↔ giọng nói ----------

/** Ô soạn tin của một ô chat, đăng ký để giọng nói / phần khác đưa chữ vào (terminals.pasteIntoTerminal). */
export interface ComposerHandle {
  /** Thêm chữ vào cuối ô soạn; `submit` = gửi luôn (người dùng nói "gửi"). false = ô đang bị vô hiệu (phiên đã dừng). */
  insert: (text: string, submit: boolean) => boolean
}

const composers = new Map<string, ComposerHandle>()

/**
 * ChatCell gọi khi gắn ô soạn tin (null = gỡ ngay). Trả về hàm gỡ, chỉ có tác dụng khi vẫn là chính handle đó
 * (ô mới của cùng agent có thể đã đăng ký đè lên).
 */
export function registerComposer(agentId: string, handle: ComposerHandle | null): () => void {
  if (!handle) {
    composers.delete(agentId)
    return () => {}
  }
  composers.set(agentId, handle)
  return () => {
    if (composers.get(agentId) === handle) composers.delete(agentId)
  }
}

export function composerFor(agentId: string): ComposerHandle | undefined {
  return composers.get(agentId)
}

/** Chữ gần nhất của hội thoại (làm gợi ý từ vựng cho giọng nói, như `terminalText` của ô terminal). */
export function chatRecentText(agentId: string, maxChars = 6000): string {
  const items = useChat.getState().byAgent[agentId]?.items
  if (!items?.length) return ''
  const parts: string[] = []
  let size = 0
  for (let i = items.length - 1; i >= 0 && size < maxChars; i--) {
    const it = items[i]
    let t = ''
    if (it.kind === 'user') t = it.text
    else if (it.kind === 'assistant') t = it.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
    if (t) {
      parts.push(t)
      size += t.length
    }
  }
  return parts.reverse().join('\n').slice(-maxChars)
}
