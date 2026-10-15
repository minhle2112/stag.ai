import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './fonts.css'
import './styles.css'
import { App } from './App'
import { getLocale, setLocale } from '@shared/i18n'

// Ngôn ngữ giao diện trước lần vẽ đầu; đổi sau đó: store/settings.ts.
setLocale(window.stag.locale.initial() ?? 'vi')
document.documentElement.lang = getLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
