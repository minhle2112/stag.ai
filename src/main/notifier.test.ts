import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GENERAL } from '@shared/types'
import { notificationFor } from './notifier'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, Notification: class {} }))

describe('notificationFor', () => {
  const waiting = { kind: 'waiting', workspaceId: 'w', agentId: 'a', agentName: 'Lead', reason: 'question' } as const
  const done = { kind: 'taskDone', workspaceId: 'w', agentId: 'a', agentName: 'Lead', title: 'Sửa lỗi đăng nhập' } as const

  it('nội dung theo loại sự kiện', () => {
    expect(notificationFor(waiting, DEFAULT_GENERAL, 'Demo')).toEqual({ title: 'Lead đang hỏi bạn', body: 'Demo' })
    expect(notificationFor(done, DEFAULT_GENERAL, 'Demo')).toEqual({ title: 'Lead đã xong việc', body: 'Sửa lỗi đăng nhập · Demo' })
  })

  it('tắt loại nào thì không báo loại đó', () => {
    expect(notificationFor(waiting, { ...DEFAULT_GENERAL, notifyWaiting: false }, 'Demo')).toBeNull()
    expect(notificationFor(done, { ...DEFAULT_GENERAL, notifyTaskDone: false }, 'Demo')).toBeNull()
    expect(notificationFor(done, { ...DEFAULT_GENERAL, notifyWaiting: false }, 'Demo')).not.toBeNull()
  })
})
