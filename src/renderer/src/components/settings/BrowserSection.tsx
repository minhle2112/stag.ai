import { SectionTitle } from './controls'

/** Cài đặt → Trình duyệt (Settings S5): app.browser + bật / tắt tool trình duyệt theo workspace / agent (SettingsOverrides.browser). */
export function BrowserSection(): React.JSX.Element {
  return <SectionTitle title="Trình duyệt" desc="Trình duyệt trong app và việc agent dùng nó." />
}
