import type { AgentKind } from '@shared/types'

const STYLE: Record<AgentKind, string> = {
  claude: 'bg-[#c96442] text-white',
  codex: 'bg-[#4a515a] text-white',
  external: 'bg-[#2f6fd0] text-white',
  terminal: 'bg-[#22262b] font-mono font-semibold text-[#b4bbc4] shadow-[inset_0_0_0_1px_#3a4048]'
}

/** Ô nhỏ nhận diện loại agent (CC = Claude Code, CX = Codex, `>_` = terminal, 2 chữ đầu = adapter ngoài): một bộ dùng cả app. */
export function AdapterTile({ kind, label, tip }: { kind: AgentKind; label?: string; tip?: string }): React.JSX.Element {
  const text = kind === 'claude' ? 'CC' : kind === 'codex' ? 'CX' : kind === 'terminal' ? '>_' : (label ?? 'ai').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || 'ai'
  return (
    <span
      data-tip={tip}
      className={`inline-grid h-3.5 min-w-4 shrink-0 cursor-default place-items-center rounded-[3px] px-0.5 text-[10px] leading-[14px] font-bold tracking-tight ${STYLE[kind]}`}
    >
      {text}
    </span>
  )
}
