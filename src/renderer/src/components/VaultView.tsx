import { useCallback, useEffect, useState } from 'react'
import type { VaultNode, Workspace } from '@shared/types'
import { useVaultIndex } from '../vaultIndex'
import { Button, Modal } from './Modal'
import { GraphView } from './vault/GraphView'

export function VaultView({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const { vaultPath } = workspace
  const [tree, setTree] = useState<VaultNode[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [guide, setGuide] = useState(false)
  const [view, setView] = useState<'note' | 'graph'>('note')
  const { index } = useVaultIndex(vaultPath)

  const refresh = useCallback(async () => {
    setTree(await window.stag.vault.tree(vaultPath))
    setRegistered(await window.stag.vault.isRegistered(vaultPath))
  }, [vaultPath])

  useEffect(() => {
    setSelected(null)
    setContent('')
    refresh()
    // Quay lại app (vd. sau khi đăng ký vault trong Obsidian) thì đọc lại.
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  useEffect(() => {
    if (selected) window.stag.vault.read(vaultPath, selected).then(setContent, (e) => setContent(`Không đọc được: ${e}`))
  }, [vaultPath, selected])

  // Mặc định mở _INDEX.md.
  useEffect(() => {
    if (!selected && tree.some((n) => n.rel === '_INDEX.md')) setSelected('_INDEX.md')
  }, [tree, selected])

  async function openObsidian(): Promise<void> {
    const r = await window.stag.vault.openInObsidian(vaultPath)
    if (r.status === 'needs-register') setGuide(true)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="min-w-0 truncate text-muted" title={vaultPath}>
          {vaultPath}
        </span>
        {registered !== null && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${registered ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel-2 text-muted'}`}>
            {registered ? 'đã đăng ký Obsidian' : 'chưa đăng ký Obsidian'}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-line">
          {(['note', 'graph'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2.5 py-1 text-[12px] ${view === v ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
            >
              {v === 'note' ? 'Note' : 'Graph'}
            </button>
          ))}
        </div>
        <Button onClick={refresh}>Làm mới</Button>
        <Button onClick={() => window.stag.openFolder(vaultPath)}>Mở thư mục</Button>
        <Button primary onClick={openObsidian}>
          Mở trong Obsidian
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-line py-2">
          {tree.length === 0 && <div className="px-3 text-muted">Vault trống hoặc không tồn tại.</div>}
          <Tree nodes={tree} depth={0} selected={selected} onSelect={setSelected} />
        </nav>
        {view === 'graph' ? (
          <div className="relative min-w-0 flex-1">
            {index ? (
              <GraphView
                index={index}
                current={selected}
                onOpen={(rel) => {
                  setSelected(rel)
                  setView('note')
                }}
              />
            ) : (
              <div className="p-4 text-muted">Đang đọc vault…</div>
            )}
          </div>
        ) : (
        <article className="min-w-0 flex-1 overflow-y-auto px-6 py-4 select-text">
          {selected ? (
            <>
              <div className="mb-3 text-[11px] text-muted">{selected}</div>
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed">{content}</pre>
            </>
          ) : (
            <div className="text-muted">Chọn một note bên trái.</div>
          )}
        </article>
        )}
      </div>

      {guide && (
        <Modal
          title="Đăng ký vault trong Obsidian (chỉ cần làm 1 lần)"
          onClose={() => setGuide(false)}
          footer={
            <>
              <Button onClick={() => setGuide(false)}>Đóng</Button>
              <Button
                primary
                onClick={async () => {
                  const ok = await window.stag.vault.isRegistered(vaultPath)
                  setRegistered(ok)
                  if (ok) {
                    setGuide(false)
                    window.stag.vault.openInObsidian(vaultPath)
                  }
                }}
              >
                Tôi đã đăng ký xong — mở vault
              </Button>
            </>
          }
        >
          <p className="mb-3 text-muted">
            Obsidian chưa biết vault này, và không có cách mở thẳng một vault chưa đăng ký. App đã mở Obsidian và{' '}
            <b className="text-fg">chép sẵn đường dẫn vault vào clipboard</b>.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Trong Obsidian, bấm tên vault ở góc dưới bên trái → <b>Manage vaults…</b>
            </li>
            <li>
              Ở mục <b>Open folder as vault</b>, bấm <b>Open</b>.
            </li>
            <li>
              Dán đường dẫn (<kbd>Ctrl</kbd>+<kbd>V</kbd>) vào ô địa chỉ của hộp chọn thư mục → <b>Select Folder</b>.
            </li>
          </ol>
          <div className="mt-3 rounded-md bg-panel-2 px-2 py-1.5 font-mono text-[12px] break-all">{vaultPath}</div>
          {registered === false && <p className="mt-3 text-[12px] text-muted">Chưa thấy vault trong danh sách của Obsidian.</p>}
        </Modal>
      )}
    </div>
  )
}

function Tree({
  nodes,
  depth,
  selected,
  onSelect
}: {
  nodes: VaultNode[]
  depth: number
  selected: string | null
  onSelect: (rel: string) => void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) =>
        n.dir ? (
          <Folder key={n.rel} node={n} depth={depth} selected={selected} onSelect={onSelect} />
        ) : (
          <div
            key={n.rel}
            onClick={() => onSelect(n.rel)}
            style={{ paddingLeft: 12 + depth * 14 }}
            className={`cursor-pointer truncate py-1 pr-2 ${selected === n.rel ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg'}`}
          >
            {n.name}
          </div>
        )
      )}
    </>
  )
}

function Folder({
  node,
  depth,
  selected,
  onSelect
}: {
  node: VaultNode
  depth: number
  selected: string | null
  onSelect: (rel: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div onClick={() => setOpen(!open)} style={{ paddingLeft: 12 + depth * 14 }} className="cursor-pointer truncate py-1 pr-2 text-fg">
        <span className="inline-block w-3 text-muted">{open ? '▾' : '▸'}</span>
        {node.name}
      </div>
      {open && node.children && <Tree nodes={node.children} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </>
  )
}
