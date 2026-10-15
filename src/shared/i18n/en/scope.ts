import type { EnNamespace } from '../types'
import type vi from '../vi/scope'

const en: EnNamespace<typeof vi> = {
  title: 'Scope lock',

  // ScopeAskDialog (Codex: the app asks the user)
  'ask.allow': 'Allow edit',
  'ask.wantsRun': 'Agent {name} wants to run a command that may modify {file}:',
  'ask.wantsEdit': 'Agent {name} wants to edit:',
  'ask.holderPlace': "That path is in agent {holder}'s task {title} (scope {entry}), which is not done yet.",
  'ask.holderFile': "This file is in agent {holder}'s task {title} (scope {entry}), which is not done yet.",
  'ask.notePlace':
    'If you allow it, {name} can edit that path for the rest of the session without asking again. Shell commands are guessed from the command text and may be flagged by mistake. The agent is waiting for your answer (denied automatically in about {minutes} min).',
  'ask.noteFile':
    'If you allow it, {name} can edit this file for the rest of the session without asking again. Shell commands are guessed from the command text and may be flagged by mistake. The agent is waiting for your answer (denied automatically in about {minutes} min).',
  'ask.more': '{label} (+{count} more)',

  // Settings → Scope lock
  desc: 'Each open task of an agent holds an area of code: the scope the agent declared when it took the task (task_start) plus the files it has edited. When another agent is about to edit inside that area, the app follows the mode below; the lock is released when the task is done or dropped. Changes apply right away, including to running sessions.',
  'mode.ask': 'Ask first',
  'mode.askDesc': 'Claude asks right in its terminal (a permission prompt with the reason); Codex: the app shows a dialog and waits for you to allow or deny.',
  'mode.block': 'Block',
  'mode.blockDesc':
    'Never asks you: the agent is refused and works it out with the other agent (checks its task, asks it to narrow its scope or to say when it is done), doing other parts of its own task in the meantime.',
  'mode.warn': 'Warn only',
  'mode.warnDesc': 'Allows the edit. Still warns the agent when it takes a task with an overlapping scope.',
  'mode.off': 'Off',
  'mode.offDesc': 'No lock, no warnings.',
  'mode.label': "When an agent is about to edit inside another agent's scope",
  'mode.desc': 'The mode follows the agent that is about to edit. Hover a mode to see what it does.',
  parentWs: 'workspace {name}',
  parentApp: 'the app default',
  on: 'on',
  off: 'off',
  'shell.label': 'Guess shell commands',
  'shell.labelFor': 'Guess shell commands for {name}',
  'shell.desc':
    'Bash / PowerShell commands (Codex: exec_command) that look like writes (>, rm, mv, cp, Set-Content, sed -i, git checkout…) and mention a locked path count as editing it. It is only a guess: it misses scripts and commands without explicit paths, and sometimes asks about commands that only read a locked file. When off, only file-editing tools count (Edit / Write, apply_patch).',
  'shell.descAgent': 'At agent level this follows {parent}.',
  'exempt.title': 'Never lock',
  'exempt.tip':
    'Agents can always edit these places, and overlapping scopes here are not warned about. Patterns are written like task scopes, relative to the project folder, case-insensitive: docs/, package-lock.json, **/*.snap (any folder), *.md (project root only).',
  'exempt.tipWs': "Added to the app's list.",
  'exempt.vaultTip': 'Shared memory: every agent writes logs / indexes',
  'exempt.vaultFallback': 'workspace vault',
  'exempt.appData': 'App / git data',
  'exempt.fromApp': 'From the app default',
  'exempt.from': 'From {parent}',
  'exempt.agentNote': 'The exempt list is set at app and workspace level.',
  'exempt.outside': '{name} (outside the project)',
  'exempt.badPattern': "Can't read this pattern (a path outside the project?).",
  'exempt.wholeProject': 'This pattern covers the whole project. To turn the lock off entirely, choose "Off".',
  'exempt.dup': 'Already in the list.',
  'exempt.removeAria': 'Remove {pattern}',
  'exempt.removeTip': 'Remove this pattern',
  'exempt.newAria': 'New exempt pattern',
  'exempt.placeholder': 'e.g. docs/ or **/*.snap'
}

export default en
