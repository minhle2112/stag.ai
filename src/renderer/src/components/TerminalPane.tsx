import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

interface Props {
  cwd: string
  command?: string
  args?: string[]
}

/** Một terminal thật: xterm.js ở renderer, node-pty (ConPTY) ở main. */
export function TerminalPane({ cwd, command, args }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current!
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue('--font-mono') || 'Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0f1115',
        foreground: '#e6e8ee',
        cursor: '#6ea8fe',
        selectionBackground: '#2f3b52',
        scrollbarSliderBackground: 'rgba(139, 147, 167, 0.2)',
        scrollbarSliderHoverBackground: 'rgba(139, 147, 167, 0.35)',
        scrollbarSliderActiveBackground: 'rgba(139, 147, 167, 0.5)',
        overviewRulerBorder: '#0f1115'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    let ptyId: string | null = null
    let disposed = false
    const cleanups: Array<() => void> = []

    window.stag.pty.spawn({ cwd, command, args, cols: term.cols, rows: term.rows }).then((id) => {
      if (disposed) {
        window.stag.pty.kill(id)
        return
      }
      ptyId = id
      cleanups.push(window.stag.pty.onData(id, (data) => term.write(data)))
      cleanups.push(
        window.stag.pty.onExit(id, ({ exitCode }) => {
          term.write(`\r\n\x1b[90m[tiến trình đã thoát, mã ${exitCode}]\x1b[0m\r\n`)
          ptyId = null
        })
      )
      const input = term.onData((data) => window.stag.pty.write(id, data))
      cleanups.push(() => input.dispose())
    })

    const ro = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      fit.fit()
      if (ptyId) window.stag.pty.resize(ptyId, term.cols, term.rows)
    })
    ro.observe(host)

    return () => {
      disposed = true
      ro.disconnect()
      cleanups.forEach((fn) => fn())
      if (ptyId) window.stag.pty.kill(ptyId)
      term.dispose()
    }
  }, [cwd, command, args])

  return (
    <div className="h-full w-full bg-bg pt-1.5 pl-2">
      <div ref={hostRef} className="h-full w-full overflow-hidden" />
    </div>
  )
}
