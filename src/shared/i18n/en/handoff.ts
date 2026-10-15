import type { EnNamespace } from '../types'
import type vi from '../vi/handoff'

const en: EnNamespace<typeof vi> = {
  // HandoffSection
  'title': 'Agents & handoff',
  'desc': "When an agent session's context reaches the threshold and the agent is waiting for you (turn ended, you haven't typed for a few seconds), the app asks the agent to update the vault and write a handoff, then closes the session and starts a new one that picks up from that handoff. The agent's current task is kept.",
  'group': 'Handoff when context is nearly full',
  'auto': 'Auto handoff',
  'threshold': 'Threshold',
  'thresholdDesc': '= {t200} tokens with a 200k window, {t1m} tokens with a 1M window. Claude Code auto-compacts at about 97% (1M window), so the maximum is {max}%.',
  'sliderLabel': 'Handoff threshold (slider)',
  'thresholdLabel': 'Handoff threshold',
  'note': 'Hand off manually anytime: the agent\'s ⋯ menu in the sidebar → "Hand off to a new session". The app reads context % through Claude Code\'s statusLine; your own statusLine (if any) still runs and shows as before in the agent session.',
  'strip': 'Current context',
  'stripTip': 'Each square is an agent · red line = handoff threshold',
  'thresholdTip': 'Threshold {pct}%',
  'soon': ' · handoff soon'
}

export default en
