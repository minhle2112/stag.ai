import type { VaultIndex } from '@shared/types'

export interface GraphViewProps {
  index: VaultIndex
  /** Note đang mở (rel), để làm nổi và để vẽ graph cục bộ quanh nó. */
  current: string | null
  /** Bấm một node note → mở note đó. */
  onOpen: (rel: string) => void
}

/** Graph view của vault (đang làm). */
export function GraphView({ index }: GraphViewProps): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center text-muted">
      Graph: {index.notes.length} note, {index.links.length} link (đang làm)
    </div>
  )
}
