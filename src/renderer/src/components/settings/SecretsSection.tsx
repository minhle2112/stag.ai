import { useState } from 'react'
import { connectorSecrets, SECRET_NAME_RE } from '@shared/connectors'
import { useSecrets } from '../../store/secrets'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { errText } from './AdaptersSection'
import { ErrorBar, Group, Row, SectionTitle, SmallButton } from './controls'

/**
 * Settings → Secrets: token / API key cho connector. Mã hoá bằng Windows (safeStorage), chỉ tên đi tới giao diện;
 * giá trị không đọc lại được, chỉ thay hoặc xoá.
 */
export function SecretsSection(): React.JSX.Element {
  const { available, items, loaded } = useSecrets()
  const connectors = useSettings((s) => s.value.app.connectors.items)
  const openSettings = useUi((s) => s.openSettings)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [newValue, setNewValue] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const usedBy = (n: string): string[] => connectors.filter((c) => connectorSecrets(c).includes(n)).map((c) => c.id)
  const exists = items.some((x) => x.name === name.trim())
  const nameOk = SECRET_NAME_RE.test(name.trim())

  const run = (p: Promise<unknown>, done?: () => void): void => {
    setError('')
    p.then(done).catch((e) => setError(errText(e)))
  }
  const add = (): void => {
    if (!nameOk || !value) return
    run(window.stag.secrets.set(name.trim(), value), () => {
      setName('')
      setValue('')
    })
  }
  const input = 'rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent'
  // Bí mật connector cần mà chưa lưu.
  const missing = [...new Set(connectors.flatMap((c) => connectorSecrets(c)))].filter((n) => !items.some((x) => x.name === n))

  return (
    <>
      <SectionTitle
        title="Secrets"
        desc="Token và API key cho connector. App mã hoá bằng Windows (gắn với tài khoản Windows của bạn), truyền cho phiên agent qua biến môi trường — không đưa lên dòng lệnh, không ghi vào cài đặt hay vault. Giá trị đã lưu không xem lại được, chỉ thay hoặc xoá."
      />
      {!available && (
        <ErrorBar error="Windows chưa cho mã hoá dữ liệu (safeStorage) nên app không lưu bí mật được. Connector cần bí mật sẽ không chạy." />
      )}
      <ErrorBar error={error} />

      {missing.length > 0 && (
        <div className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3 text-[12.5px]">
          <div className="font-medium text-amber-200">Connector đang cần bí mật chưa lưu</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {missing.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setName(n)}
                className="rounded border border-amber-400/40 px-2 py-0.5 font-mono text-[11.5px] text-amber-200 hover:bg-amber-400/10"
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <Group title="Thêm bí mật">
        <Row label="Tên" desc="Chữ, số và _ (vd. GITHUB_TOKEN). Trùng tên = thay giá trị cũ." htmlFor="secret-name">
          <input
            id="secret-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GITHUB_TOKEN"
            spellCheck={false}
            className={`${input} w-56 ${name && !nameOk ? 'border-red-500/60' : ''}`}
          />
        </Row>
        <Row label="Giá trị" htmlFor="secret-value">
          <input
            id="secret-value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className={`${input} w-56`}
          />
          <SmallButton onClick={add} disabled={!available || !nameOk || !value}>
            {exists ? 'Thay' : 'Lưu'}
          </SmallButton>
        </Row>
      </Group>

      <Group title={`Đã lưu (${items.length})`}>
        {items.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-muted">{loaded ? 'Chưa có bí mật nào.' : 'Đang tải…'}</div>
        ) : (
          items.map((s) => {
            const users = usedBy(s.name)
            return (
              <Row
                key={s.name}
                label={
                  <span className="font-mono text-[12.5px]">
                    {s.name}
                    {s.name.startsWith('OAUTH_') && <span className="ml-2 font-sans text-[11px] text-muted">đăng nhập OAuth (app tự quản lý)</span>}
                  </span>
                }
                desc={
                  <>
                    {s.updatedAt ? `Lưu ${new Date(s.updatedAt).toLocaleString()}` : ''}
                    {users.length ? (
                      <>
                        {' · dùng bởi '}
                        {users.map((id, i) => (
                          <span key={id}>
                            {i > 0 && ', '}
                            <button type="button" className="underline decoration-dotted hover:text-fg" onClick={() => openSettings('connectors', { connector: id })}>
                              {id}
                            </button>
                          </span>
                        ))}
                      </>
                    ) : (
                      ' · chưa connector nào dùng'
                    )}
                  </>
                }
              >
                {editing === s.name ? (
                  <>
                    <input
                      aria-label={`Giá trị mới cho ${s.name}`}
                      type="password"
                      autoFocus
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newValue) run(window.stag.secrets.set(s.name, newValue), () => (setEditing(null), setNewValue('')))
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      className={`${input} w-44`}
                    />
                    <SmallButton disabled={!newValue} onClick={() => run(window.stag.secrets.set(s.name, newValue), () => (setEditing(null), setNewValue('')))}>
                      Lưu
                    </SmallButton>
                    <SmallButton onClick={() => setEditing(null)}>Huỷ</SmallButton>
                  </>
                ) : (
                  <>
                    {!s.name.startsWith('OAUTH_') && (
                      <SmallButton
                        onClick={() => {
                          setEditing(s.name)
                          setNewValue('')
                        }}
                        disabled={!available}
                      >
                        Thay giá trị
                      </SmallButton>
                    )}
                    <button
                      type="button"
                      disabled={users.length > 0}
                      title={users.length ? `Đang được dùng bởi ${users.join(', ')}` : undefined}
                      onClick={() => {
                        if (confirm !== s.name) return setConfirm(s.name)
                        setConfirm(null)
                        run(window.stag.secrets.remove(s.name))
                      }}
                      className="rounded-md border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {confirm === s.name ? 'Xoá thật' : 'Xoá'}
                    </button>
                  </>
                )}
              </Row>
            )
          })
        )}
      </Group>

      <p className="text-[12px] leading-relaxed text-muted">
        Lưu ý: agent đọc được bí mật của connector trong phiên của nó (nằm trong biến môi trường của phiên). Chỉ bật connector cho agent bạn tin. File
        bí mật nằm ở thư mục dữ liệu của app (secrets.json), chép sang máy / tài khoản Windows khác sẽ không giải mã được.
      </p>
    </>
  )
}
