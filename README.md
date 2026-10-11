# stag.ai

A Windows desktop app for running a team of AI coding agents side by side. Each project is a **workspace**, and each workspace has its own markdown **vault** that the agents use as long-term memory.

Agents are the CLI tools you already have installed and signed in to: Claude Code, Codex, or a plain terminal. stag.ai does not call any model API itself and does not need an API key to run agents.

> The app's interface is in Vietnamese for now.

## Features

- **Free canvas of cells**
  - Each agent runs in its own cell: a Claude Code or Codex CLI, a chat-style cell for Claude, or a plain terminal.
  - Drag, resize and zoom cells, or maximize one to fill the window.
  - Send one message to several agents at once.
- **Vault memory per workspace**
  - Creating a workspace sets up a structured vault, plus `CLAUDE.md` rules telling agents to read it first.
  - Built-in `memory_*` MCP tools let agents read, search and edit the vault.
  - The app writes finished agent work into a daily log.
- **Vault viewer**: read and edit notes, follow backlinks, search, and see a graph view, all inside the app.
- **Scope lock**: before an agent edits files inside another agent's open task, the app asks you.
- **Context meter and handoff**: each session shows how full its context is, and the app hands work over to a fresh session at a threshold you choose.
- **Agent API**: from chat, an agent can create, message, stop or hand work over to other agents, each step behind a confirm card.
- **Built-in browser**
  - A right-hand pane styled after Claude desktop, which agents can drive through `browser_*` tools.
  - A new tab detects the project's dev server, runs it in a terminal cell and opens the page.
  - The choice is saved to `.stag/launch.json`.
  - Agents can do the same with `preview_list`, `preview_start`, `preview_logs` and `preview_stop`.
- **Artifacts tab**: every file the agents created or edited, with in-app previews for PDF, Word, Excel/CSV, PowerPoint, HTML, images, zip and fonts.
- **Settings**
  - Adapters (Claude Code, Codex, terminal, external adapters).
  - MCP connectors with a catalog, OAuth sign-in and a secret store.
  - Skills and plugins (pages, jobs, webhooks, widgets).
  - Settings apply per app, per workspace and per agent.
- **Vietnamese voice input**
  - Hold-to-talk dictation into any cell, using the local Qwen3-ASR model or the Soniox cloud engine.
  - Optional AI correction, and typing into other apps.

## Install

Download `stag.ai-Setup-<version>.exe` from [Releases](../../releases) and run it.

- The installer is per-user and does not need admin rights.
- It is not code-signed yet, so Windows SmartScreen may warn you: choose **More info → Run anyway**.

To use agent cells, install and sign in to at least one agent CLI:

- [Claude Code](https://docs.claude.com/en/docs/claude-code): `npm install -g @anthropic-ai/claude-code`, then `claude`
- [Codex CLI](https://github.com/openai/codex): `npm install -g @openai/codex`, then `codex`

## Development

Requirements: Windows 10/11 x64 and a current Node.js LTS.

```bash
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run typecheck` | Type-check main, preload and renderer |
| `npm test` | Run the vitest suite (`npm run test:watch` to keep it running) |
| `npm run build` | Build into `out/` |
| `npm run dist` | Build the Windows installer into `release/` (`npm run dist:dir` builds only the unpacked folder) |

### Project layout

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: workspaces, vaults, agents and PTYs, the in-app browser, the MCP server, settings, plugins, voice |
| `src/preload/` | The `window.stag` bridge |
| `src/renderer/` | React UI (zustand stores, Tailwind) |
| `src/shared/` | IPC channels, shared types and pure logic |
| `resources/` | Vault and `CLAUDE.md` templates, skill and plugin catalogs, plugin SDK, icons |
| `docs/` | Guides for adapters, connectors, skills and plugins |
| `examples/` | Example external adapter |
| `scripts/` | Dev helpers (CDP probes, screenshots, catalog importers, voice benchmarks) |

Tests live next to the code as `*.test.ts`.

## Stack

Electron 44 · electron-vite 5 · Vite 7 · React 19 · TypeScript 7 · Tailwind 4 · xterm.js 6 · node-pty · zustand · Model Context Protocol SDK · sherpa-onnx

## License

[MIT](LICENSE)
