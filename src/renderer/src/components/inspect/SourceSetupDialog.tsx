import { useEffect, useMemo, useState } from 'react'
import { agentKind } from '@shared/types'
import type { SourceKind, SourceSetup } from '@shared/inspect'
import { useAgents } from '../../store/agents'
import { Button, Modal } from '../Modal'
import { tx, useT } from '../../i18n'

const NO_RUN: Record<string, unknown> = {}

/**
 * "Tìm nguồn cho chế độ Soi": dự án dùng Vite / Next / WordPress thì chép plugin nhỏ (chỉ bản dev) để agent biết phần tử trên trang
 * đến từ file:dòng nào. HTML tĩnh và Elementor không cần cài. Không tìm được nguồn vẫn gửi HTML + ảnh.
 */
export function SourceSetupDialog({ wsId, onClose }: { wsId: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const [setup, setSetup] = useState<SourceSetup | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  // Chọn đúng tham chiếu trong store (lọc ngoài selector): selector trả mảng / đối tượng mới mỗi lần làm React vẽ lại mãi.
  const ws = useAgents((s) => s.byWs[wsId])
  const agents = useMemo(() => (ws?.agents ?? []).filter((a) => agentKind(a) !== 'terminal'), [ws])
  const running = ws?.running ?? NO_RUN
  const [agentId, setAgentId] = useState<string>('')
  const api = window.stag.inspect

  const refresh = (): void => void api.setup(wsId).then(setSetup, (e) => setNote(String(e?.message ?? e)))
  useEffect(refresh, [wsId])
  useEffect(() => {
    if (!agentId && agents.length) setAgentId((agents.find((a) => running[a.id]) ?? agents[0]).id)
  }, [agents, running, agentId])

  async function install(kind: SourceKind): Promise<void> {
    setBusy(kind)
    setNote(null)
    try {
      const files = await api.install(wsId, kind)
      setNote(kind === 'wordpress' ? t('inspect.setup.installedWp', { file: files[0] }) : t('inspect.setup.copied', { files: files.join(', ') }))
      refresh()
    } catch (e) {
      setNote(t('inspect.setup.installFailed', { message: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }))
    } finally {
      setBusy(null)
    }
  }

  async function askAgent(kind: 'vite' | 'next'): Promise<void> {
    if (!agentId) return
    setBusy(`ask-${kind}`)
    try {
      const text = await api.setupMessage(wsId, kind)
      const r = await window.stag.agent.broadcast({ workspaceId: wsId, agentIds: [agentId], text })
      const st = r.results[0]?.status
      setNote(
        st === 'sent'
          ? t('inspect.setup.askSent', { name: r.results[0].name })
          : st === 'queued'
            ? t('inspect.setup.askQueued', { name: r.results[0].name })
            : t('inspect.setup.askNoSession')
      )
    } catch (e) {
      setNote(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  const agentPicker = agents.length ? (
    <select
      value={agentId}
      onChange={(e) => setAgentId(e.target.value)}
      className="h-7 max-w-[180px] min-w-0 rounded-md border border-line-2 bg-bg px-1.5 text-[12px] text-fg"
    >
      {agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {running[a.id] ? '' : ` ${t('inspect.setup.notOpen')}`}
        </option>
      ))}
    </select>
  ) : null

  const code = (kind: 'vite' | 'next', info: { config: string; installed: boolean }, label: string): React.JSX.Element => (
    <Row title={label} sub={info.config} done={info.installed} doneText={t('inspect.setup.copiedDone')}>
      <p className="text-[12px] text-muted">
        {tx('inspect.setup.pluginDesc', {
          cmd: <span className="font-mono">{kind === 'vite' ? 'vite dev' : 'next dev'}</span>,
          attr: <span className="font-mono">{t('inspect.setup.attr')}</span>
        })}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button small onClick={() => void install(kind)} disabled={!!busy}>
          {info.installed ? t('inspect.setup.copyAgain') : t('inspect.setup.copyStep')}
        </Button>
        {agents.length > 0 && (
          <>
            <Button small onClick={() => void askAgent(kind)} disabled={!!busy || !info.installed}>
              {t('inspect.setup.askStep', { file: info.config.split('/').pop() ?? '' })}
            </Button>
            {agentPicker}
          </>
        )}
      </div>
    </Row>
  )

  return (
    <Modal
      title={t('inspect.setup.title')}
      onClose={onClose}
      width="w-[600px]"
      footer={
        <Button primary onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      <p className="text-[12.5px] text-muted">
        {t('inspect.setup.intro')}
      </p>
      {!setup ? (
        <p className="mt-4 text-[12px] text-dim">{t('inspect.setup.loading')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {setup.vite && code('vite', setup.vite, 'Vite (React, Vue, Svelte…)')}
          {setup.next && code('next', setup.next, 'Next.js')}
          {setup.wordpress && (
            <Row title="WordPress" sub={setup.wordpress.wpContent} done={setup.wordpress.installed} doneText={t('inspect.setup.wpDone')}>
              <p className="text-[12px] text-muted">
                {tx('inspect.setup.wpDesc', {
                  plugin: <span className="font-mono">stag-inspect</span>,
                  define: <span className="font-mono">define('STAG_INSPECT', true)</span>,
                  dataId: <span className="font-mono">data-id</span>
                })}
              </p>
              <div className="mt-2 flex gap-1.5">
                {setup.wordpress.installed ? (
                  <Button small variant="danger" disabled={!!busy} onClick={() => void api.uninstall(wsId).then(refresh)}>
                    {t('inspect.setup.wpRemove')}
                  </Button>
                ) : (
                  <Button small disabled={!!busy} onClick={() => void install('wordpress')}>
                    {t('inspect.setup.wpInstall', { path: setup.wordpress.wpContent })}
                  </Button>
                )}
              </div>
            </Row>
          )}
          <Row title={t('inspect.setup.static')} sub={t('inspect.setup.staticSub')} done doneText={t('inspect.setup.auto')}>
            <p className="text-[12px] text-muted">{t('inspect.setup.staticDesc')}</p>
          </Row>
          {!setup.vite && !setup.next && !setup.wordpress && (
            <p className="text-[12px] text-dim">{t('inspect.setup.none')}</p>
          )}
          {/* Chỗ cố định cho dòng trạng thái: hiện ra không đẩy các nút đang bấm. */}
          <p className={`min-h-[34px] rounded-md px-3 py-2 text-[12px] text-fg ${note ? 'bg-panel-2' : ''}`}>{note}</p>
        </div>
      )}
    </Modal>
  )
}

function Row({ title, sub, done, doneText, children }: { title: string; sub: string; done: boolean; doneText: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-line-2 bg-bg px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2 text-[12.5px]">
        <b className="font-semibold text-fg">{title}</b>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-dim">{sub}</span>
        <span className="flex-1" />
        {done && <span className="rounded bg-work/12 px-1.5 text-[11px] text-work">{doneText}</span>}
      </div>
      {children}
    </div>
  )
}
