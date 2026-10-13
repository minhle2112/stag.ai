import { create } from 'zustand'
import type { ThemeState } from '@shared/theme'
import { setTerminalTheme } from '../terminals'

/**
 * Màu app đang dùng (main giữ lựa chọn và màu Windows, xem src/main/theme.ts). Đổi màu = đổi `data-theme` trên <html>:
 * mọi token trong styles.css đổi theo, component không phải làm gì. `data-termdark` = terminal luôn tối trong app sáng.
 */
const FALLBACK: ThemeState = { pref: 'dark', theme: 'dark', windowsDark: true, terminal: 'dark' }

export function applyThemeToDocument(s: ThemeState): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.style.colorScheme = s.theme
  if (s.terminal !== s.theme) root.dataset.termdark = ''
  else delete root.dataset.termdark
}

export const useTheme = create<ThemeState>(() => window.stag.theme.initial() ?? FALLBACK)

let started = false

/** Nghe main báo đổi màu (một lần cho cả app). */
export function startThemeBus(): void {
  if (started) return
  started = true
  const apply = (s: ThemeState): void => {
    applyThemeToDocument(s)
    setTerminalTheme(s.terminal)
    useTheme.setState(s, true)
  }
  apply(useTheme.getState())
  window.stag.theme.onChanged(apply)
}
