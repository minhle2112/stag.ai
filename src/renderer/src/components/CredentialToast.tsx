import { tx, useT } from '../i18n'
import { useCredentialNotices } from '../store/credentials'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

/**
 * Agent muốn điền mật khẩu trên trang sai tên miền (có thể là trang giả): app đã chặn, báo bạn ở góc dưới bên trái
 * (bên phải là trang web của ô Browser, vẽ đè lên mọi HTML).
 */
export function CredentialToast(): React.JSX.Element | null {
  const list = useCredentialNotices((s) => s.list)
  const dismiss = useCredentialNotices((s) => s.dismiss)
  const open = useUi((s) => s.openSettings)
  const t = useT()
  if (!list.length) return null
  return (
    <div className="fixed bottom-[84px] left-3.5 z-30 flex w-[380px] max-w-[92vw] flex-col gap-2">
      {list.map((n, i) => (
        <div key={i} role="alert" className="flex gap-3 rounded-lg border border-l-[3px] border-line-2 border-l-danger bg-panel-2 px-3 py-2.5 shadow-float">
          <Icon name="shieldx" className="mt-0.5 text-danger" />
          <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
            <div className="text-[13px] font-medium">{t('passwords.blocked.title')}</div>
            <div className="text-muted">
              {tx('passwords.blocked.body', {
                agent: n.agentName,
                item: n.itemName,
                host: <b className="font-medium break-all text-danger">{n.host}</b>,
                allowed: <b className="font-medium text-fg">{n.allowed.join(', ')}</b>
              })}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                className="h-[22px] rounded-md border border-line-2 bg-panel-3 px-2 text-[12px] hover:border-line-3"
                onClick={() => {
                  dismiss(n)
                  open('passwords', { credential: n.itemId })
                }}
              >
                {t('passwords.blocked.viewLog')}
              </button>
              <button type="button" className="h-[22px] rounded-md px-2 text-[12px] text-muted hover:bg-panel-3 hover:text-fg" onClick={() => dismiss(n)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
