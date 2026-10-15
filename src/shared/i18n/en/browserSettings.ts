import type { EnNamespace } from '../types'
import type vi from '../vi/browserSettings'

const en: EnNamespace<typeof vi> = {
  title: 'Browser',
  desc: 'The in-app browser (Browser button in the top bar) and how agents use it. Changes are saved right away. At workspace / agent level you can only turn the browser tools on or off for agents.',
  on: 'on',
  off: 'off',
  remove: 'Remove',

  browsing: 'Browsing',
  home: 'New tab page',
  homeDesc: 'The page that opens when you click "+" in the browser. Leave empty for a blank page.',
  homeBad: 'Needs a web address, e.g. localhost:5173 or github.com.',
  homePlaceholder: '(blank page)',
  search: 'Search engine',
  searchDesc: "Text typed in the address bar that isn't a web address is searched with this engine.",

  agentGroup: 'Agents using the browser',
  agentTools: 'Let agents use the browser',
  agentToolsDesc:
    'The browser_* tools (open, read, click, type, screenshot, console). When off, sessions opened later do not see these tools; running sessions are refused right away when they call one.',
  agentToolsAll: 'Let every agent use the browser',
  agentToolsFor: 'Browser for {name}',

  externalGroup: 'Agents opening pages outside localhost',
  externalLabel: 'When an agent opens an external page',
  'external.ask': 'Ask first',
  'external.askDesc': 'Shows a dialog the first time an agent opens a page outside localhost; once allowed, it can be used until the app quits.',
  'external.allow': 'Always allow',
  'external.allowDesc': 'Agents open any http(s) page without asking.',
  'external.deny': 'Always block',
  'external.denyDesc': 'Agents can only open localhost and the always-allowed sites below, without asking you.',
  allowed: 'Always-allowed sites',
  allowedDesc: 'Agents open these origins without asking, even after restarting the app. The "Agent wants to open an external page" dialog has an "Always allow this site" button.',
  allowedMoot: 'Set to "Always allow", so this list is not needed yet; it applies when you switch back to "Ask first" or "Always block".',
  allowedAria: 'Always-allowed origin',
  originBad: 'Not an http(s) web address.',
  originDup: '{origin} is already in the list.',

  cookies: 'Cookies & site data',
  keepCookies: 'Keep cookies after quitting',
  keepCookiesDesc: 'Keeps you signed in to sites (separately per workspace). Applies to tabs opened after the change; open tabs stay as they are.',
  clear: 'Clear cookies and site data',
  clearDesc: 'Signs out of every site and deletes stored site data (localStorage, cache…) of the in-app browser.',
  cleared: 'Cleared. Open pages may need a reload.',
  clearFor: 'Clear data for',
  allWorkspaces: 'All workspaces',
  workspaceOption: 'Workspace: {name}',
  clearing: 'Clearing…',
  clickAgain: 'Click again to clear'
}

export default en
