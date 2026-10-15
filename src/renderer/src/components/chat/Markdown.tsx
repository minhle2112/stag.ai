import { memo, useMemo } from 'react'
import { CHAT_PROSE, renderChatMarkdown } from './chatMarkdown'
import { t, useLocale } from '../../i18n'

const OPENABLE = /^(https?|mailto):/i

/** Ủy quyền sự kiện cho HTML do chatMarkdown.ts sinh ra: nút Sao chép của khối code và link http(s). */
function onClick(e: React.MouseEvent<HTMLDivElement>): void {
  const target = e.target as HTMLElement
  const copy = target.closest<HTMLElement>('[data-copy]')
  if (copy) {
    const code = copy.closest('.cc-code')?.querySelector('pre')?.textContent ?? ''
    void navigator.clipboard.writeText(code)
    const label = copy.querySelector<HTMLElement>('[data-copy-label]')
    if (label) {
      label.textContent = t('common.copied')
      setTimeout(() => {
        label.textContent = t('chat.copy')
      }, 1200)
    }
    return
  }
  const a = target.closest<HTMLElement>('a[data-href]')
  const href = a?.getAttribute('data-href')
  // Main chặn mọi điều hướng và mở http(s) / mailto bằng trình duyệt hệ thống (setWindowOpenHandler).
  if (href && OPENABLE.test(href)) {
    e.preventDefault()
    window.open(href)
  }
}

/** Chữ markdown của assistant. `caret` = đang stream (con trỏ nhấp nháy cuối chữ). */
export const Markdown = memo(function Markdown({ text, caret }: { text: string; caret?: boolean }): React.JSX.Element {
  // Nút Sao chép trong HTML theo ngôn ngữ giao diện: đổi ngôn ngữ thì dựng lại.
  const locale = useLocale()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => renderChatMarkdown(text, { caret }), [text, caret, locale])
  // `html` do chatMarkdown.ts sinh: html:false nên chữ thô trong tin đã bị escape, chỉ có thẻ do ta thêm.
  return <div className={CHAT_PROSE} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
})
