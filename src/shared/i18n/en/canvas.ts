import type { EnNamespace } from '../types'
import type vi from '../vi/canvas'

const en: EnNamespace<typeof vi> = {
  // CanvasBoard
  'tidied': { one: 'Tidied {count} cell', other: 'Tidied {count} cells' },
  'empty.noCells': 'No cells are open.',
  'empty.noAgents': 'This workspace has no agents yet.',
  'empty.noCellsHint': 'Click an agent in the sidebar to reopen its cell, or right-click here to create a new agent.',
  'empty.noAgentsHint': 'Right-click here → New agent (or Ctrl+K).',
  'undo': 'Undo',
  'broadcastTip': 'Broadcast to several agents',
  'zoomOutTip': 'Zoom out · Ctrl+scroll',
  'resetZoomTip': 'Reset to 100%',
  'zoomInTip': 'Zoom in · Ctrl+scroll',
  'fit': 'Fit',
  'fitTip': 'Fit all cells on screen',
  'tidy': 'Tidy',
  'tidyTip': 'Arrange all cells in a neat grid (undo: Ctrl+Z)',
  'newAgent': 'New agent',
  'newTerminal': 'New terminal',
  'widgetOpenTip': 'Already open — click to go to its cell',
  'widgetPlaceTip': 'Open where you right-clicked',
  'widgetOpen': 'open',
  'noWidgets': 'No widgets yet — install plugins in Settings → Plugins.'
}

export default en
