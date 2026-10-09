import { SectionTitle } from './controls'

/** Cài đặt → Khoá phạm vi (Settings S5): app.scope + ghi đè workspace / agent (SettingsOverrides.scope). */
export function ScopeSection(): React.JSX.Element {
  return <SectionTitle title="Khoá phạm vi" desc="Khi một agent định sửa vào phạm vi việc đang mở của agent khác." />
}
