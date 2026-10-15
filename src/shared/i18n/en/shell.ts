import type { EnNamespace } from '../types'
import type vi from '../vi/shell'

const en: EnNamespace<typeof vi> = {
  // Title bar
  'title.search': 'Search or run a command…',
  'title.waiting': { one: '{count} agent is waiting for you', other: '{count} agents are waiting for you' },
  'title.noneWaiting': 'No agent is waiting for you',
  'title.toLight': 'Switch to light · Ctrl+Shift+L',
  'title.toDark': 'Switch to dark · Ctrl+Shift+L',
  'title.sidebar': 'Sidebar · Ctrl+B',
  'title.hideBrowser': 'Hide browser · Ctrl+Shift+B',
  'title.browser': 'Browser · Ctrl+Shift+B',
  'title.agentUsing': ' · an agent is using it',
  'title.inspectReplies': { one: '{count} new reply in Inspect', other: '{count} new replies in Inspect' },
  'title.minimize': 'Minimize',
  'title.restore': 'Restore',
  'title.maximize': 'Maximize',
  'title.close': 'Close',
  'title.noneWaitingMenu': 'No agent is waiting for you.',

  // Rail
  'rail.agents': 'Agents · Ctrl+1',
  'rail.artifacts': 'Artifacts · what agents hand in for you to review · Ctrl+2',
  'rail.vault': 'Vault (memory) · Ctrl+3',
  'rail.log': 'Log & memory · Ctrl+4',
  'rail.pluginPage': '{page} · plugin {plugin}',
  'rail.settings': 'Settings · Ctrl+,',

  // Status bar
  'status.agentsTip': { one: '{count} agent · {running} running · {waiting} waiting for you', other: '{count} agents · {running} running · {waiting} waiting for you' },
  'status.waiting': '· {count} waiting for you',
  'status.locksTip': { one: '{count} scope lock held', other: '{count} scope locks held' },
  'status.locksTitle': 'SCOPE LOCKS HELD',
  'status.wholeProject': '(whole project)',
  'status.scopeSettings': 'Scope lock settings…',

  // App
  'app.noWorkspace': 'No workspace yet.',
  'app.newWorkspace': '+ New workspace',
  'app.pluginPageGone': "This plugin page can't be opened anymore (the plugin was removed, is off, or isn't running). See Settings → Plugins.",

  // Command palette (Ctrl+K)
  'palette.groupView': 'Views',
  'palette.groupAction': 'Actions',
  'palette.groupSettings': 'Settings',
  'palette.groupAgent': 'Agents',
  'palette.agents': 'Agents',
  'palette.artifacts': 'Artifacts',
  'palette.vault': 'Vault (memory)',
  'palette.log': 'Log & memory',
  'palette.newAgent': 'New agent',
  'palette.newProject': 'New project…',
  'palette.openProject': 'Open project {name}',
  'palette.broadcast': 'Broadcast to several agents…',
  'palette.newWorkspace': 'New workspace…',
  'palette.toggleSidebar': 'Toggle sidebar',
  'palette.toggleBrowser': 'Toggle browser',
  'palette.settings': 'Settings',
  'palette.toggleTheme': 'Toggle light / dark',
  'palette.theme': 'Appearance: {mode}',
  'palette.language': 'Language: {name}',
  'palette.empty': 'No results.',
  'palette.keyPick': '↑ ↓ select',
  'palette.keyRun': 'Enter run',
  'palette.keyClose': 'Esc close',
  'palette.keyPrefix': '@ agents · > commands',

  // Sidebar
  'side.removeAsk': 'Remove workspace "{name}" from the app?\n\nIts agents will be stopped and removed from the app. No files are deleted on disk (code, vault and agent notes stay as they are).',
  'side.workspaces': 'WORKSPACES',
  'side.newWorkspace': 'New workspace',
  'side.pickFolder': '+ Pick a project folder to create a workspace',
  'side.collapseTip': 'Click to collapse',
  'side.expandTip': 'Click to expand',
  'side.switchTip': 'Click to switch to this workspace',
  'side.waitingTip': { one: '{count} agent waiting for you', other: '{count} agents waiting for you' },
  'side.actions': 'Actions',
  'side.collapse': 'Collapse',
  'side.expand': 'Expand',
  'side.newProject': 'New project…',
  'side.openFolder': 'Open project folder',
  'side.removeWorkspace': 'Remove workspace from app…',
  'side.noAgents': 'No agents yet',
  'side.noAgentsHint': 'No agents yet. Right-click the canvas to create one',
  'side.working': 'Working on: {title}',
  'side.lockedScope': 'Locked scope: {scope}',
  'side.noTask': 'No task yet',
  'side.cellClosed': 'Cell is closed · click to open',
  'side.dragHint': 'Drag to reorder · double-click to rename',
  'side.rootTip': "The workspace's root folder · agents here see every project",
  'side.monorepo': 'This repo has {folders}{more}. Split it into projects, each with its own team?',
  'side.monorepoMore': { one: ' and {count} more folder', other: ' and {count} more folders' },
  'side.later': 'Later'
}

export default en
