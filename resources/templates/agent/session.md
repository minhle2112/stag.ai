---
type: session
agent: {{AGENT}}
session: {{SESSION_ID}}
started: {{NOW}}
status: {{STATUS}}
---
# Session of {{AGENT}}

stag.ai creates this file when the session opens, updates it when the agent calls task_start / task_update / task_done, and deletes it when the session closes. Anything worth keeping must go into the vault.

## Task
{{TASK}}

## Scope
{{SCOPE}}

## Handoff
{{HANDOFF}}
