import type { ThemePref } from './types'

/** Màu thật đang hiện (sau khi giải "Theo Windows"). */
export type Theme = 'dark' | 'light'

/** Trạng thái màu main gửi cho giao diện (và plugin / widget). */
export interface ThemeState {
  /** Lựa chọn trong Cài đặt → Giao diện. */
  pref: ThemePref
  /** Màu app đang dùng. */
  theme: Theme
  /** Windows đang ở chế độ tối (AppsUseLightTheme = 0). Trang web trong ô Trình duyệt theo màu này. */
  windowsDark: boolean
  /** Màu của ô terminal: theo app, hoặc luôn tối khi tắt "Terminal theo giao diện app". */
  terminal: Theme
}

export function resolveTheme(pref: ThemePref, windowsDark: boolean): Theme {
  if (pref === 'system') return windowsDark ? 'dark' : 'light'
  return pref
}

export function themeState(pref: ThemePref, windowsDark: boolean, terminalFollow: boolean): ThemeState {
  const theme = resolveTheme(pref, windowsDark)
  return { pref, theme, windowsDark, terminal: terminalFollow ? theme : 'dark' }
}

/** Nền cửa sổ trước khi trang vẽ xong (= token bg0), để mở app không chớp trắng / chớp đen. */
export const WINDOW_BG: Record<Theme, string> = { dark: '#08090b', light: '#e8ebef' }
/** Nền ô Trình duyệt trước khi trang web vẽ (= token panel). */
export const PAGE_BG: Record<Theme, string> = { dark: '#101215', light: '#ffffff' }

/** Ctrl+Shift+L / nút mặt trời: chọn hẳn màu ngược với màu đang hiện (thoát "Theo Windows"). */
export function flipTheme(current: Theme): ThemePref {
  return current === 'dark' ? 'light' : 'dark'
}

/** Bảng màu xterm (đủ 16 màu ANSI), giống bảng trong design/theme/index.html. */
export interface TerminalPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  scrollbarSliderBackground: string
  scrollbarSliderHoverBackground: string
  scrollbarSliderActiveBackground: string
  overviewRulerBorder: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export const TERMINAL_PALETTES: Record<Theme, TerminalPalette> = {
  dark: {
    background: '#101215',
    foreground: '#dde1e6',
    cursor: '#2de2c0',
    cursorAccent: '#101215',
    selectionBackground: '#2f3b52',
    scrollbarSliderBackground: 'rgba(139, 147, 167, 0.2)',
    scrollbarSliderHoverBackground: 'rgba(139, 147, 167, 0.35)',
    scrollbarSliderActiveBackground: 'rgba(139, 147, 167, 0.5)',
    overviewRulerBorder: '#101215',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#e3b341',
    blue: '#79c0ff',
    magenta: '#d2a8ff',
    cyan: '#56d4dd',
    white: '#c9d1d9',
    brightBlack: '#8b949e',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#f2cc60',
    brightBlue: '#a5d6ff',
    brightMagenta: '#e2c5ff',
    brightCyan: '#87e1e8',
    brightWhite: '#f0f6fc'
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#087a65',
    cursorAccent: '#ffffff',
    selectionBackground: '#cfe0fb',
    scrollbarSliderBackground: 'rgba(60, 70, 85, 0.28)',
    scrollbarSliderHoverBackground: 'rgba(60, 70, 85, 0.4)',
    scrollbarSliderActiveBackground: 'rgba(60, 70, 85, 0.55)',
    overviewRulerBorder: '#ffffff',
    black: '#1f2328',
    red: '#c4291c',
    green: '#116329',
    yellow: '#8a5a00',
    blue: '#0a5bd6',
    magenta: '#7c3aed',
    cyan: '#0b7285',
    white: '#57606a',
    brightBlack: '#5c6570',
    brightRed: '#d1242f',
    brightGreen: '#1a7f37',
    brightYellow: '#9a6700',
    brightBlue: '#0969da',
    brightMagenta: '#8250df',
    brightCyan: '#0a7a88',
    brightWhite: '#6e7781'
  }
}
