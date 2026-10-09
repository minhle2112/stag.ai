import { BrowserWindow, Notification } from 'electron'
import type { GeneralSettings } from '@shared/types'
import type { BoardEvent } from './board'

const WAIT_TEXT = {
  turn: 'đã xong lượt, đang chờ bạn',
  question: 'đang hỏi bạn',
  permission: 'đang xin quyền'
} as const

/** Nội dung thông báo cho một sự kiện, hoặc null nếu người dùng đã tắt loại đó. */
export function notificationFor(e: BoardEvent, g: GeneralSettings, workspaceName: string): { title: string; body: string } | null {
  if (e.kind === 'waiting') {
    if (!g.notifyWaiting) return null
    return { title: `${e.agentName} ${WAIT_TEXT[e.reason]}`, body: workspaceName }
  }
  if (!g.notifyTaskDone) return null
  return { title: `${e.agentName} đã xong việc`, body: `${e.title} · ${workspaceName}` }
}

/**
 * Thông báo Windows khi agent chờ bạn / xong việc. Chỉ báo khi cửa sổ app không được chọn
 * (đang nhìn app thì đã thấy trên lưới và kanban). Bấm thông báo → mở app tại agent đó.
 */
export class Notifier {
  constructor(
    private general: () => GeneralSettings,
    private workspaceName: (id: string) => string | undefined,
    private reveal: (workspaceId: string, agentId: string) => void
  ) {}

  onBoardEvent(e: BoardEvent): void {
    if (BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocused())) return
    const ws = this.workspaceName(e.workspaceId)
    if (!ws) return
    const n = notificationFor(e, this.general(), ws)
    if (n) this.show(n.title, n.body, () => this.reveal(e.workspaceId, e.agentId))
  }

  /** Nút "Gửi thử" trong Settings: luôn hiện (kể cả khi cửa sổ đang được chọn). */
  test(): void {
    this.show('stag.ai', 'Thông báo thử: agent sẽ báo bạn như thế này.')
  }

  /** Thông báo của chính app (vd. vẫn chạy dưới khay). */
  info(title: string, body: string): void {
    this.show(title, body)
  }

  private show(title: string, body: string, onClick?: () => void): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: !this.general().notifySound })
    if (onClick) n.on('click', onClick)
    n.show()
  }
}
