import type { EnNamespace } from '../types'
import type vi from '../vi/memory'

const en: EnNamespace<typeof vi> = {
  // Settings → Vault & memory
  title: 'Vault & memory',
  desc: "Each workspace has a vault (a folder of markdown notes) as its memory, created from the template below. Agents read / edit the vault through the app's tools; the app writes finished agent work into the vault and keeps each agent's own note within its budget.",
  on: 'on',
  off: 'off',
  kb: '{n} KB',
  days: { one: '{count} day', other: '{count} days' },
  daysSuffix: 'days',
  // Tool modes
  'tools.full': 'Read and write',
  'tools.fullDesc':
    "Agents read, search, edit and rename notes through the app (memory_read, memory_search, memory_patch, memory_move…). The app blocks writing secrets and won't overwrite someone else's changes.",
  'tools.read': 'Read only',
  'tools.readDesc': 'Agents read and search through the app; to write, they edit the note files directly as before.',
  'tools.off': 'Off',
  'tools.offDesc': 'No memory_* tools: agents read / edit vault files with their own file tools.',
  // Template
  'tpl.group': 'Template',
  'tpl.label': 'Vault template',
  'tpl.desc': "Vault structure, CLAUDE.md, agent session rules. Files edited in this folder replace the app's built-in versions (file by file).",
  'tpl.open': 'Open template folder',
  // Memory tools
  'agentTools.group': 'Memory tools for agents',
  'agentTools.label': 'Agents use the vault through the app',
  // Work log
  'workLog.group': 'Work log',
  'workLog.label': 'Log finished tasks in the daily log',
  'workLog.desc':
    'Every task an agent finishes (task_done), hands to another agent (agent_handoff) or you mark done (the agent\'s ⋯ menu) → one line in the vault\'s 40 Log/<date>.md, under "Agent work (auto)": task name, agent, time, a one-line English summary by the agent, scope. Only written to vaults with the stag.ai structure.',
  'workDone.label': 'Write to the "Work done" section of the agent note',
  'workDone.desc': 'At the same time, add a line to the "Work done" section of 60 Agents/<agent name>.md so the agent remembers what it did.',
  // Agent memory note
  'note.group': 'Agent memory note',
  'note.budget': 'Note budget',
  'note.budgetDesc':
    'Note over budget → the app moves old "Work done" lines to 60 Agents/<name> archive.md (no quota used). If it is still over, the agent is asked to tighten the rest in its next session.',
  'note.keep': 'How many "Work done" lines to keep',
  'note.keepDesc': 'When archiving, keep this many of the newest lines in the note.',
  'note.keepLabel': '"Work done" lines to keep',
  // _INDEX.md
  'index.group': 'Vault _INDEX.md',
  'index.archive': 'Move old finished items out of _INDEX',
  'index.archiveDesc':
    '_INDEX.md is the first thing every agent session reads. When it is over budget, the app moves old finished items ("- [x]") in "Open items" to _INDEX archive.md (in 00 Meta/), grouped by date. Unfinished items ("- [ ]") always stay. App → workspace levels.',
  'index.budget': '_INDEX budget',
  'index.budgetDesc': 'Only move items when _INDEX.md is larger than this.',
  'index.keepDays': 'Keep finished items (days)',
  'index.keepDaysDesc':
    'Finished items whose latest date (YYYY-MM-DD) is within this many days stay in _INDEX. Items without a date count as old.',
  'index.clean': 'Clean up now',
  'index.cleanDescWs': "Move old finished items (per the days above) out of this workspace's _INDEX.md now, without waiting for it to go over budget.",
  'index.cleanDescAll':
    "Move old finished items out of every workspace's _INDEX.md now (each per its own settings; workspaces with this turned off are skipped), without waiting for them to go over budget.",
  'index.cleaning': 'Cleaning…',
  'index.cleanAll': 'Clean all workspaces',
  'index.skipped': '{name}: skipped ({reason})',
  'index.moved': { one: '{name}: moved {count} item, _INDEX is now {kb} KB', other: '{name}: moved {count} items, _INDEX is now {kb} KB' },
  'index.nothing': '{name}: nothing old enough to move ({kb} KB)',
  'index.noWorkspaces': 'No workspaces.',
  note: 'Agents no longer write a "task done" line themselves, only things worth remembering (decisions, errors hit, lessons). The note budget is checked when an agent session opens and after each finished task. Changing the memory tool mode takes effect from the next agent session (a running session that calls a disabled tool gets an error).'
}

export default en
