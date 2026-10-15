import { t, type PlainKey } from '.'

/**
 * Tên chỗ trên giao diện nhắc tới trong chữ gửi cho agent (tiếng Anh): theo ngôn ngữ giao diện người dùng đang chọn,
 * để agent gọi đúng tên người dùng thấy ("the Sản phẩm tab" / "the Artifacts tab"). Gọi lúc dựng chuỗi, không ở đầu module.
 */
export const uiName = {
  artifacts: (): string => t('common.name.artifacts'),
  browser: (): string => t('common.name.browser'),
  inspect: (): string => t('common.name.inspect'),
  /** "Cài đặt → Agent API" / "Settings → Agent API". */
  settings: (section: 'agentApi' | 'vault' | 'passwords' | 'adapters'): string =>
    `${t('common.name.settings')} → ${t(`settings.nav.${section}` as PlainKey)}`
}
