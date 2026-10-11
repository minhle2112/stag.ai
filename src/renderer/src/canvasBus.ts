import { toWorld, type Point } from '@shared/canvas'
import type { CanvasView } from '@shared/types'

/**
 * Cầu nối tới canvas đang hiện của từng workspace (AgentGrid đăng ký khi gắn): store / phím tắt / bảng lệnh hỏi tâm
 * vùng đang nhìn và nhờ camera bay tới một ô, mà không phải đưa camera (đổi mỗi khung hình khi kéo) vào store.
 */
export interface CanvasController {
  view: () => CanvasView
  size: () => { w: number; h: number }
  /**
   * Bay camera tới ô (để thấy trọn nó). Đang phóng to một ô: `user` (người dùng chủ động mở ô) → phóng to ô này thay
   * thế; không thì để yên (vd. agent khác vừa tạo agent qua Agent API).
   */
  reveal: (key: string, user: boolean) => void
}

const controllers = new Map<string, CanvasController>()

export function registerCanvas(wsId: string, c: CanvasController): () => void {
  controllers.set(wsId, c)
  return () => {
    if (controllers.get(wsId) === c) controllers.delete(wsId)
  }
}

/** Tâm vùng đang nhìn của canvas (toạ độ thế giới); canvas chưa gắn → null. */
export function viewCenter(wsId: string): Point | null {
  const c = controllers.get(wsId)
  if (!c) return null
  const { w, h } = c.size()
  return toWorld(c.view(), w / 2, h / 2)
}

/** Nhờ canvas bay tới ô `key` sau khi ô đã vẽ (khung hình kế). */
export function revealCell(wsId: string, key: string, user = true): void {
  requestAnimationFrame(() => requestAnimationFrame(() => controllers.get(wsId)?.reveal(key, user)))
}
