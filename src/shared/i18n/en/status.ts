import type { EnNamespace } from '../types'
import type vi from '../vi/status'

const en: EnNamespace<typeof vi> = {
  'wait.turn': 'waiting for your reply',
  'wait.permission': 'needs your permission',
  'wait.question': 'asking you',
  'wait.idle': 'waiting for you for a while',
  'wait.interrupted': 'you interrupted',
  'terminal.opening': 'opening terminal',
  'terminal.closed': 'terminal closed',
  'terminal.open': 'terminal',
  'session.opening': 'opening session',
  'session.restarting': 'moving to a new session',
  'session.stopped': 'session stopped',
  'session.running': 'running',
  'session.starting': 'starting',
  'session.writingHandoff': 'writing handoff',
  'session.runningTool': 'running {tool}',
  'session.working': 'working',
  'ctx.autoAt': 'auto handoff at {percent}%',
  'ctx.autoOff': 'auto handoff is off',
  'ctx.failed': "The last auto handoff didn't happen (the agent ended its turn without handing off). Hand off manually from the agent's ⋯ menu.",
  'ctx.unknownSize': "Context: {used} tokens (window size unknown, so no % yet and no auto handoff)",
  'ctx.known': 'Context: {used} / {size} tokens ({percent}%) · {auto}',
  'ago.minutes': '{count} min',
  'ago.hours': { one: '{count} hr', other: '{count} hrs' },
  'ago.days': { one: '{count} day', other: '{count} days' }
}

export default en
