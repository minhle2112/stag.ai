import type { EnNamespace } from '../types'
import type vi from '../vi/inspect'

const en: EnNamespace<typeof vi> = {
  // InspectPanel (Comments panel)
  'panel.hide': 'Hide comments',
  'panel.empty': 'No comments yet.',
  'panel.pending': 'Pending',
  'panel.sent': 'Sent',
  'panel.hideClosed': { one: 'Hide {count} closed comment', other: 'Hide {count} closed comments' },
  'panel.showClosed': { one: 'Show {count} closed comment', other: 'Show {count} closed comments' },
  'panel.count': { one: '{count} comment', other: '{count} comments' },
  'panel.elementGone': 'This element is no longer on the page',
  'draft.sendTip': { one: 'Send {count} comment to {name} in one message', other: 'Send {count} comments to {name} in one message' },
  'draft.gone': '{name} is no longer in the workspace',
  'draft.removeTip': 'Delete this comment',
  'draft.removeAria': 'Delete comment #{id}',
  'thread.reopen': 'Reopen',
  'thread.closeTip': 'Done, close comment',
  'thread.closeAria': 'Close comment',
  'thread.you': 'You',
  'thread.youInitial': 'Y',
  'thread.waitBusy': 'Waiting for {name} to finish its current work',
  'thread.waitSession': "Waiting for {name}'s session to open",
  'thread.replying': '{name} is replying',
  'thread.replyPlaceholder': 'Reply…',

  // Line shown in the chat cell when the packet is typed
  'packet.one': 'Comment #{id} from Inspect',
  'packet.many': { one: '{count} comment from Inspect ({ids})', other: '{count} comments from Inspect ({ids})' },

  // Inspect layer in the page (preload)
  'pin.queued': 'waiting for the agent',
  'pin.working': 'agent is replying',
  'pin.new': 'new reply',
  'pin.read': 'seen',
  'pin.draft': '#{id} · pending: {title}',
  'pin.draftFor': '#{id} · pending for {who}: {title}',
  'box.placeholder': 'Write a comment…',
  'box.addTip': 'Add to pending (Enter)',
  'box.whoTip': 'Which agent to send to',
  'box.noAgent': 'No agent',
  'box.notOpen': 'not open',
  'box.busy': 'busy',
  'box.noAgents': 'This workspace has no agents yet',
  'box.addFailed': "Couldn't add the comment: {message}",

  // Errors from main (shown in the panel / Inspect layer)
  'err.noWorkspace': 'The workspace no longer exists',
  'err.empty': 'The comment is empty',
  'err.agentGone': 'That agent is no longer in the workspace',
  'err.noElement': 'No element selected',
  'err.groupAgentGone': '{name} is no longer in the workspace: delete comment #{id} or pick another agent for it',

  // SourceSetupDialog (Find sources for Inspect)
  'setup.title': 'Find sources for Inspect',
  'setup.intro':
    'So the agent knows which file / line the element you comment on comes from and edits the right place. Without a source, comments still include the HTML, selector and a screenshot.',
  'setup.loading': 'Checking the project…',
  'setup.installedWp': 'Installed {file}. Reload the page to see sources.',
  'setup.copied': 'Copied {files}.',
  'setup.installFailed': "Couldn't install: {message}",
  'setup.askSent': 'Asked {name} to add the plugin to the config file.',
  'setup.askQueued': '{name} is busy; the request will be typed when it is free.',
  'setup.askNoSession': "This agent's session isn't open. Open it, then click again.",
  'setup.notOpen': '(not open)',
  'setup.copiedDone': 'Plugin copied to .stag/inspect/',
  'setup.pluginDesc': 'A small plugin that only runs during {cmd}: it adds {attr} to HTML tags. Builds are unchanged.',
  'setup.attr': 'data-stag-src="file:line"',
  'setup.copyAgain': 'Copy again',
  'setup.copyStep': '1. Copy the plugin to the project',
  'setup.askStep': '2. Ask the agent to add it to {file}',
  'setup.wpDone': 'stag-inspect mu-plugin installed',
  'setup.wpDesc':
    'The {plugin} mu-plugin tags sources for Gutenberg blocks (post #ID), template parts and theme template files (child vs. parent theme) and turns off page caching. It only runs on local / development / localhost sites, or with {define}; do not copy it to a live site. Elementor is read straight from {dataId}, nothing to install.',
  'setup.wpRemove': 'Remove mu-plugin',
  'setup.wpInstall': 'Install to {path}/mu-plugins',
  'setup.static': 'Static HTML',
  'setup.staticSub': '.html files in the project',
  'setup.auto': 'Automatic',
  'setup.staticDesc':
    'Pages opened from localhost or file:// that have a matching .html file in the project (root, public/, site/, dist/…) are matched to lines automatically, nothing to install.',
  'setup.none': 'No Vite, Next.js or WordPress (wp-content) found in the project folder.',
  'setup.noWpContent': 'No wp-content found in the project folder'
}

export default en
