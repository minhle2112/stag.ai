import type { EnNamespace } from '../types'
import type vi from '../vi/browser'

const en: EnNamespace<typeof vi> = {
  // BrowserPane: tab bar
  'tab.new': 'New tab',
  'tab.newTip': 'New tab · Ctrl+T',
  'tab.close': 'Close tab',
  'tab.drivenBy': '{name} is in control',
  'pane.more': 'More',
  'pane.collapse': 'Shrink pane',
  'pane.expand': 'Expand pane',
  'pane.close': 'Close · Ctrl+Shift+B',
  'pane.driving': 'is controlling this tab',
  'pane.releaseToKeep': 'Release to keep this width',
  'pane.resizeTip': 'Drag to resize · double-click to reset',

  // Inspect / Comments buttons on the address bar
  'inspect.on': 'Turn on Inspect (Ctrl+Shift+C)',
  'inspect.off': 'Turn off Inspect (Ctrl+Shift+C)',
  'comments.hide': 'Hide comments',
  'comments.fresh': { one: '{count} new reply', other: '{count} new replies' },
  'comments.drafts': '{count} pending',
  'comments.open': '{count} open',

  // Address bar
  'nav.back': 'Back',
  'nav.forward': 'Forward',
  'nav.reload': 'Reload',
  'nav.urlPlaceholder': 'Enter URL',
  'devtools.closeTip': 'Close DevTools for this tab',
  'devtools.openTip': 'Tab DevTools · F12',
  'devtools.close': 'Close DevTools',
  'devtools.open': 'Open DevTools',
  'key.count': {
    one: '{count} saved password for {host} (agents use it via credential_fill)',
    other: '{count} saved passwords for {host} (agents use them via credential_fill)'
  },
  'key.none': 'No saved password for {host}',

  // ⋮ menu
  'menu.devServer': 'Project dev server…',
  'menu.external': 'Open in external browser',
  'menu.inspectSource': 'Find sources for Inspect…',
  'menu.clearData': 'Clear cookies and site data',

  // External page request
  'ask.title': 'Agent wants to open an external page',
  'ask.always': 'Always allow this site',
  'ask.wants': 'Agent {name} wants to open:',
  'ask.note':
    'If you allow it, the agent can use any page on {origin} until the app quits. "Always allow this site" saves the origin in Settings → Browser (all agents, even after restarting the app). The agent is waiting for your answer (denied automatically after 2 minutes).',

  // NewTabPanel
  'newTab.viewTerminal': 'View terminal',
  'newTab.devFailed': "Couldn't start the dev server",
  'newTab.starting': 'Starting the dev server…',
  'newTab.opensWhenReady': 'The page opens when port {port} is ready.',
  'newTab.hint': 'Type an address above, e.g. {example}. Agents also open tabs here when they use the browser.',
  'newTab.projectDev': 'Project dev servers →',
  'newTab.savedIntro': 'Project dev servers. The command runs in a terminal cell on the canvas when you pick one.',
  'newTab.detectedIntro': 'Dev servers found. The command runs in a terminal cell on the canvas when you pick one.',
  'newTab.port': 'port {port}',
  'newTab.running': '· running',
  'newTab.saved': '· saved',
  'newTab.use': 'Use this',
  'newTab.savedTo': 'Your choice is saved to {file} in the project.',
  'newTab.back': 'Back to browsing',

  // Dev server start errors (main/devServer.ts → Browser tab)
  'dev.cancelled': 'Cancelled.',
  'dev.cellDeleted': 'The dev server terminal cell was deleted.',
  'dev.closed': 'The terminal closed before port {port} opened.',
  'dev.noCell': "The terminal cell couldn't be opened (open this workspace's Agents tab once, then try again).",
  'dev.failed': 'Command failed: {error}',
  'dev.timeout': 'Port {port} did not open within {minutes} min. Check the log in the terminal cell; is the port in {file} right?'
}

export default en
