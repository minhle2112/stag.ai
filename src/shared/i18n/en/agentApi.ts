import type { EnNamespace } from '../types'
import type vi from '../vi/agentApi'

const en: EnNamespace<typeof vi> = {
  // Cài đặt → Agent API (AgentApiSection.tsx)
  'desc': 'Agents use the app for you through the agent_* tools of the stag MCP server. Agents can always see the agent list and the agent kinds / models available on this computer (agent_list, adapter_models). Only approve what you yourself asked an agent to do.',
  'manage': 'Let agents manage other agents',
  'manageDesc': 'Tell an agent "create an agent named…, using model…, working on…" and it can do it: create, rename, change role / model / permissions, open, stop and delete agents (agent_create, agent_update, agent_open, agent_stop, agent_delete); create projects, rename them or change their goal (project_create, project_update; agents cannot delete projects). Whether it asks you first: see the "Ask you before an agent…" switch below.',
  'message': 'Let agents message other agents',
  'messageDesc': 'agent_send: the app types the message into the receiving agent\'s cell when it is idle and you are not typing there; the message clearly says it comes from an agent, not from you. Messages are capped so two agents can\'t message each other forever. Also covers agent_handoff: hand the current task to another agent (the task card + scope move to the receiver and the handoff is typed into its cell; if the receiver isn\'t running, a new session is opened, which also needs the manage permission).',
  'read': 'Let agents read other agents\' status and session log',
  'readDesc': 'agent_status: what the other agent is doing, context %, open task, last finished task. agent_log: the latest turns of the other agent\'s session (your messages, its replies, errors, optionally the tools it called), with keys / tokens masked; raw terminal output is not readable. Same workspace only.',
  'confirmCreate': 'Ask you before an agent creates, stops, deletes or changes permissions of agents / projects, sends work to another project, or runs a dev server',
  'confirmCreateDesc': 'On: shows a confirm card when an agent creates an agent or project, stops / deletes an agent, changes an agent\'s permissions, sends work to an agent in another project (no prompt from or to Shared, or for project pairs set to "Always allow"), sends work to an agent with higher permissions than itself, or runs a dev server for the first time (preview_start). Off: the agent does all of the above right away, without asking. Scope lock (editing another agent\'s files) has its own setting: Settings → Scope lock.',
  'note': 'Turning a group off: sessions opened afterwards no longer see those tools; running sessions that call them are refused right away. Agents learn about these tools from the session rules, which update from the next new session.'
}

export default en
