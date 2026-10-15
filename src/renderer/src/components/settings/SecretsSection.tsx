import { useState } from 'react'
import { connectorSecrets, SECRET_NAME_RE } from '@shared/connectors'
import { useSecrets } from '../../store/secrets'
import { useSettings } from '../../store/settings'
import { useUi } from '../../store/ui'
import { errText } from './AdaptersSection'
import { Callout, ErrorBar, Group, INPUT_MONO, Note, Row, SectionTitle, SmallButton } from './controls'
import { LevelBar } from './levels'
import { fmtDateTime, tx, useT } from '../../i18n'

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
  const t = useT()

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
  // Bí mật connector cần mà chưa lưu.
  const missing = [...new Set(connectors.flatMap((c) => connectorSecrets(c)))].filter((n) => !items.some((x) => x.name === n))

  return (
    <>
      <SectionTitle
        title={t('secrets.title')}
        desc={t('secrets.desc')}
        right={<LevelBar appOnly />}
      />
      {!available && (
        <ErrorBar error={t('secrets.unavailable')} />
      )}
      <ErrorBar error={error} />

      {missing.length > 0 && (
        <Callout tone="wait" icon="key" className="mb-3">
          <div className="font-medium">{t('secrets.missing')}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {missing.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setName(n)}
                className="h-[22px] rounded border border-wait/40 px-2 font-mono text-[11px] text-wait hover:bg-wait/10"
              >
                {n}
              </button>
            ))}
          </div>
        </Callout>
      )}

      <Group title={t('secrets.add')}>
        <Row label={t('secrets.name')} desc={t('secrets.nameDesc')} htmlFor="secret-name">
          <input
            id="secret-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GITHUB_TOKEN"
            spellCheck={false}
            className={`${INPUT_MONO} w-56 ${name && !nameOk ? 'border-danger/60!' : ''}`}
          />
        </Row>
        <Row label={t('secrets.value')} htmlFor="secret-value">
          <input
            id="secret-value"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className={`${INPUT_MONO} w-56`}
          />
          <SmallButton onClick={add} disabled={!available || !nameOk || !value}>
            {exists ? t('secrets.replace') : t('common.save')}
          </SmallButton>
        </Row>
      </Group>

      <Group title={t('secrets.saved', { count: items.length })}>
        {items.length === 0 ? (
          <div className="border-b border-line py-3 text-[12px] text-dim">{loaded ? t('secrets.empty') : t('common.loading')}</div>
        ) : (
          items.map((s) => {
            const users = usedBy(s.name)
            return (
              <Row
                key={s.name}
                label={
                  <span className="font-mono text-[12px]">
                    {s.name}
                    {s.name.startsWith('OAUTH_') && <span className="ml-2 font-sans text-[11px] text-dim">{t('secrets.oauth')}</span>}
                  </span>
                }
                sub={
                  <>
                    {s.updatedAt ? t('secrets.savedAt', { time: fmtDateTime(s.updatedAt) }) : ''}
                    {users.length ? (
                      <>
                        {' · '}
                        {tx('secrets.usedBy', {
                          list: users.map((id, i) => (
                            <span key={id}>
                              {i > 0 && ', '}
                              <button type="button" className="underline decoration-dotted hover:text-muted" onClick={() => openSettings('connectors', { connector: id })}>
                                {id}
                              </button>
                            </span>
                          ))
                        })}
                      </>
                    ) : (
                      ` · ${t('secrets.unused')}`
                    )}
                  </>
                }
              >
                {editing === s.name ? (
                  <>
                    <input
                      aria-label={t('secrets.newValueFor', { name: s.name })}
                      type="password"
                      autoFocus
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newValue) run(window.stag.secrets.set(s.name, newValue), () => (setEditing(null), setNewValue('')))
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      className={`${INPUT_MONO} w-44`}
                    />
                    <SmallButton disabled={!newValue} onClick={() => run(window.stag.secrets.set(s.name, newValue), () => (setEditing(null), setNewValue('')))}>
                      {t('common.save')}
                    </SmallButton>
                    <SmallButton onClick={() => setEditing(null)}>{t('common.cancel')}</SmallButton>
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
                        {t('secrets.replaceValue')}
                      </SmallButton>
                    )}
                    <SmallButton
                      variant={confirm === s.name ? 'dangerSolid' : 'danger'}
                      disabled={users.length > 0}
                      tip={users.length ? t('secrets.inUse', { names: users.join(', ') }) : undefined}
                      onClick={() => {
                        if (confirm !== s.name) return setConfirm(s.name)
                        setConfirm(null)
                        run(window.stag.secrets.remove(s.name))
                      }}
                    >
                      {confirm === s.name ? t('secrets.reallyDelete') : t('common.delete')}
                    </SmallButton>
                  </>
                )}
              </Row>
            )
          })
        )}
      </Group>

      <Note>{t('secrets.note')}</Note>
    </>
  )
}
