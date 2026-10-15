---
name: stag-plugin-author
description: Write or change a stag.ai plugin — the stagPlugin manifest in package.json, the Node worker (tools for agents, buttons, events, scheduled jobs, webhooks) and sandboxed UI pages — following the stag.ai plugin API and its capability model.
---

# Writing a stag.ai plugin

A stag.ai plugin extends the stag.ai desktop app (Paperclip-style): agent tools, buttons in the app, its own pages, app events, scheduled jobs and local webhooks. The user installs it in **Settings → Plugins** (from a folder, npm, or "New plugin" which scaffolds one), approves its capabilities, and presses **"Reload package"** after each change. Plugins written for Paperclip do **not** run unchanged: names match Paperclip, the protocol is stag.ai's own.

## Package layout

```
my-plugin/
  package.json          # "type": "module" + "stagPlugin" manifest
  worker.mjs            # entrypoints.worker — runs in its own Node process
  stag-plugin-sdk.mjs   # copy of the SDK (this skill ships one: stag-plugin-sdk.mjs) — never edit it
  ui/index.html         # entrypoints.ui — optional pages
```

## Manifest (`package.json` → `stagPlugin`)

```json
{
  "name": "stag-plugin-weekly",
  "version": "0.1.0",
  "type": "module",
  "stagPlugin": {
    "id": "my.weekly",
    "apiVersion": 1,
    "displayName": "Weekly report",
    "description": "…",
    "author": "…",
    "capabilities": ["agent.tools.register", "board.read", "vault.write", "jobs.schedule", "ui.sidebar.register", "ui.page.register"],
    "entrypoints": { "worker": "./worker.mjs", "ui": "./ui" },
    "instanceConfigSchema": { "type": "object", "properties": { "folder": { "type": "string", "title": "Folder", "default": "Reports" } } },
    "tools": [{ "name": "word_count", "displayName": "Word count", "description": "When to call it, for the agent.", "parametersSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }],
    "events": ["task.done"],
    "jobs": [{ "key": "weekly", "displayName": "Weekly report", "schedule": "0 17 * * 5" }],
    "webhooks": [{ "endpointKey": "github", "displayName": "GitHub push" }],
    "ui": { "slots": [
      { "type": "sidebar", "id": "now", "displayName": "Report now", "action": "reportNow" },
      { "type": "page", "id": "home", "displayName": "Weekly", "path": "index.html" }
    ] }
  }
}
```

Rules (the app refuses the package otherwise, naming the field):
- `id`: `a-z 0-9 . _ -`, 2–64 chars; not `stag`, `claude`, `codex`, `terminal`. Changing it later loses the plugin's stored data.
- Every feature needs its capability; tools / events / jobs / webhooks / `action` buttons / `dataKey` need a worker; `page` / `settingsPage` / `dashboardWidget` need `entrypoints.ui`.
- Tool names `a-z0-9_`; agents see them in the `stag` MCP server as `<id with . and - turned into _>__<tool>` (e.g. `my_weekly__word_count`). Write the description for the agent. A tool that runs long (downloads, encoding) sets `"timeoutSec"` (1–1800, default 120).
- `icon` (optional): a key of the app's own icon set (Lucide, e.g. `"clip"`) shown for the plugin's `page` on the left rail; without it the rail shows the plugin's initials.
- `instanceConfigSchema`: object of `string | number | integer | boolean` fields with `title`, `description`, `default`, `enum`, `minimum`, `maximum`, `format: "url" | "textarea"`. Config is stored as plain text: never put tokens or passwords there.
- Cron `schedule`: 5 fields, local time, `*`, `*/n`, `a-b`, `a,b` (day of week 0 or 7 = Sunday).
- Slots: `sidebar` (left sidebar), `globalToolbarButton` (top bar), `agentMenu` (agent ⋯ menu) with either `"open": { "url": "{config.x}/…?ws={workspace.name}", "target": "browser" | "external" }` or `"action": "<key>"`; `page` (main tab next to Kanban / Agents / Artifacts) `settingsPage` (tab in the plugin's Settings page) and `dashboardWidget` (a cell in the agent grid, added by the user with "+ Widget") with `path` to an `.html` file in the UI folder; `statusBarItem` (short text in the status bar under the grid): text = `displayName`, or the worker's `getData(dataKey)` returning a string or `{ text, tooltip?, tone?: 'default' | 'ok' | 'warn' | 'error' }` (≤ 80 chars), re-read on open, every 60 s and when the worker calls `ctx.streams.emit('statusBar', {})`; `open` / `action` optional.
- A new version that asks for more capabilities stops until the user approves again — ask for the least you need.

| Capability | Allows |
| --- | --- |
| `ui.sidebar.register` / `ui.action.register` | `sidebar` / `globalToolbarButton` + `agentMenu` + `statusBarItem` slots |
| `ui.page.register` / `instance.settings.register` / `ui.dashboardWidget.register` | `page` / `settingsPage` / `dashboardWidget` slots |
| `agent.tools.register` | `tools` |
| `events.subscribe` | `events`: see the event list under Worker |
| `agents.read` | `ctx.agents.list()` → `{ workspaces: [{id,name,path}], agents: [{id,name,role,kind,workspaceId,running,activity}] }` |
| `agent.sessions.send` | `ctx.agents.send(agentId, text)` — types into the agent's terminal (risky); `ctx.agents.ask(agentId, text)` → `{ status: 'sent' \| 'queued' \| 'opened' }` — sends it like a user message when the agent is idle, or opens a new session that starts with it |
| `board.read` | `ctx.board.list(workspaceId)` → kanban tasks `{id, agentId, agentName, title, scope, status: open|done|dropped, createdAt, doneAt?, summary?, files?}` |
| `vault.read` / `vault.write` | `ctx.vault.read(workspaceId, 'Folder/Note.md')` / `.write(workspaceId, path, content)` (creates folders, overwrites) |
| `plugin.state.read` / `plugin.state.write` | `ctx.state.get / set / delete(key, scope?)` — JSON, 5 MB total |
| `ui.notify` | `ctx.notify(title, body)` — Windows notification |
| `jobs.schedule` | `jobs` |
| `webhooks.receive` | `webhooks` |
| `files.read` | `ctx.files.list` / `ctx.files.read` — files in the workspace's project folder (text ≤ 1 MB; `.git`, `.stag`, `.sessions`, `node_modules` and the vault are excluded; secret-bearing files such as `.env*`, `.mcp.json`, `.npmrc`, `*.pem`, `*.key` are listed but cannot be read) |
| `http.outbound` | Declares network use; also lets UI pages fetch / load images from the network |
| `artifacts.publish` | `ctx.artifacts.publish(workspaceId, agentId, { file, title, description })` → `{ id }` — puts a project file on the Artifacts tab under that agent's open (or latest) task; publishing the same file again adds a version |
| `browser.cookies` | `ctx.browser.cookies(workspaceId, 'youtube.com')` → `{ text, count }` — the Browser pane's cookies for that domain as a Netscape cookies.txt (risky: sign-in cookies; write them to a temp file and delete it right after use) |

## Worker

```js
import { definePlugin, runWorker } from './stag-plugin-sdk.mjs'

runWorker(
  definePlugin({
    async setup(ctx) {
      ctx.tools.register('word_count', async ({ text }, run) => ({ content: `${text.split(/\s+/).length} words` })) // or { content, isError: true }
      ctx.actions.register('reportNow', async (params, run) => ({ message: 'Done' })) // or { openUrl, target: 'browser' | 'external' }
      ctx.data.register('stats', async (params, run) => ({ count: 3 })) // pages read it with host.getData('stats')
      ctx.events.on('task.done', async (e) => ctx.logger.info(e.agentName, e.data.title))
      ctx.jobs.register('weekly', async (job) => {}) // job.key, job.runId, job.trigger: 'schedule' | 'manual'
      ctx.webhooks.register('github', async (req) => ({ status: 200, body: { ok: true } })) // req.headers, req.query, req.rawBody, req.parsedBody
      ctx.streams.emit('stats', { count: 4 }) // push to open pages: host.on('stats', fn)
      const entries = await ctx.files.list(run.workspaceId, 'src') // [{ name, path, type: 'file'|'dir', size }], one level, dirs first
      const { text } = await ctx.files.read(run.workspaceId, 'src/index.ts') // UTF-8 text ≤ 1 MB; throws for binary / too big / outside the project
    },
    async onValidateConfig(config) { return { ok: true } }, // { ok: false, errors: ['…'] } rejects a save
    async onConfigChanged(config) {},
    async onHealth() { return { status: 'ok' } },
    async onShutdown() {}
  })
)
```

- `run` (call context): `workspaceId`, `workspaceName`, `workspacePath`, `agentId`, `agentName` — filled by the app (the workspace being viewed, or the agent calling the tool); tool calls also get `projectPath` (the agent's project folder, or the workspace root).
- `ctx.config.get()` returns the current config; `ctx.logger.info / warn / error` and stdout / stderr go to the plugin's log (Settings → Plugins → Status).
- Events (`e.type`, `e.at`, `e.workspaceId`, `e.agentId?`, `e.agentName?`, `e.data`): `agent.session.started` / `agent.session.stopped` (`kind`), `agent.waiting` (`reason`), `task.started` (`title`, `scope`), `task.done` (`title`), `artifact.written` (`{ path, kind: 'write'|'edit' }`), `vault.note.changed` (`{ path, by: 'agent'|'user' }`, not fired for the plugin's own writes), `handoff.done` (`{ percent, fromSessionId, summary }`), `scope.conflict` (`{ path, paths, ownerAgentId, ownerAgentName, taskTitle, entry, command?, decision: 'ask'|'allowed'|'denied'|'blocked'|'warned' }`). `artifact.written` / `vault.note.changed` are limited to one event per file per 5 s.
- Events arrive one at a time, in order. A call without the capability throws `The plugin has not been granted the "<capability>" capability.`
- The worker is restarted after a crash (3 times in 10 minutes, then it stays in "Error").
- Jobs run only while the app is open; a job is never run twice at once; 10 minute limit.
- Webhook URL (shown in Status, with a secret token): `POST http://127.0.0.1:<port>/plugins/<id>/webhooks/<endpointKey>?token=…`; 1 MB body; JSON bodies arrive parsed; 30 s limit. Outside services need a tunnel.

## Pages (`entrypoints.ui`)

Pages run in a sandboxed iframe with origin `null`: no `window.stag`, no access to the app, no `localStorage`, no navigation away, only the package's own files (network only with `http.outbound`). Use the SDK the app serves:

```html
<link rel="stylesheet" href="/__stag/ui.css" />  <!-- app colours: --stag-bg, --stag-fg, --stag-muted, --stag-accent; .card, .muted, button.primary -->
<script type="module">
  import { host } from '/__stag/ui.js'
  const ctx = await host.ready // { pluginId, slotId, slotType, workspace: {id,name,path} | null, theme, locale: 'vi' | 'en' }
  const stats = await host.getData('stats', { any: 'params' })
  const r = await host.action('reportNow')
  host.on('stats', (data) => {})
  host.onContext((ctx) => {}) // user switched workspace
  await host.toast(r.message)
  await host.openUrl('https://example.com', 'browser')
  // also: host.config.get(), host.state.*, host.agents.list(), host.board.list(), host.vault.read(path) / write(path, text), host.files.list(path?) / read(path), host.notify(title, body)
  host.onTheme((theme) => {}); host.onLocale((locale) => {}) // translate your own strings: the app is Vietnamese or English
  video.src = host.fileUrl('clips/a.mp4') // files.read: <img> / <video> from the project folder (seekable)
  const path = await host.pickFile('Pick a video', [{ name: 'Video', extensions: ['mp4', 'mkv'] }]) // full path or null
  await host.reveal('clips/a.mp4') // show the file in Explorer
  await host.openSettings() // Settings → Plugins → this plugin
  await host.agents.ask(agentId, 'Please …') // agent.sessions.send
</script>
```

Inline scripts are allowed; keep everything else as files in the UI folder. A `settingsPage` grows with its content.

## Checklist before handing back

1. `package.json` parses and every slot / tool / job / webhook has its capability; the worker file exists.
2. `stag-plugin-sdk.mjs` sits next to the worker and is unchanged.
3. Tell the user to press "Reload package" (or install the folder) and approve the capabilities; list any new capability and why it is needed.
4. Test what you can: call the tool from the agent, press the buttons, "Run now" for jobs, `curl -X POST` for webhooks; read the plugin log in Status.
