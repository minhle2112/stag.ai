---
type: protocol
updated: {{DATE}}
---
# Memory Protocol

Back to: [[_INDEX]]

**Absolute path of the vault:** `{{VAULT_PATH}}`

## Roles
| Where | Role | Notes |
|---|---|---|
| This vault (`{{VAULT_DIR}}/`) | **Primary memory** (source of truth) | All long-term project knowledge lives here |
| Claude Code auto memory (`{{AUTO_MEMORY_PATH}}`) | **Short cache** | Only points to the vault, reminds to recall |
| Conflict between the two | **The vault wins** | Fix the cache to match the vault |

## Recall (required)
1. At the start of every session: read [[_INDEX]] first.
2. Then read the notes related to the upcoming work (project, feature, decision, latest log).
3. **Do not act on "memory" before recalling.**

**How:** agents running inside stag.ai use the `memory_*` tools of the app's MCP server `stag` — `memory_read` (also lists backlinks), `memory_search`, `memory_query`, `memory_list` to recall; `memory_append`, `memory_patch`, `memory_write`, `memory_move` to record. Other tools read and edit the `.md` files directly; the format is the same (markdown + `[[links]]` + frontmatter).

## Record
| What was learned | Where to write it |
|---|---|
| Process / convention / tip / error encountered | [[Learnings]] or a note in `30 Features/` |
| Finished work with something non-obvious | `40 Log/<YYYY-MM-DD>.md` (per the [[40 Log/_Template|template]]) |
| Important decision + rationale | `50 Decisions/<YYYY-MM-DD> <name>.md` (per the [[50 Decisions/_Template|template]]) |
| Something specific to one agent (role, habits, unfinished work) | `60 Agents/<agent name>.md` |
| Status change of an open item | "Open items" section in [[_INDEX]] |

After recording: update the auto memory cache if needed (pointers only, do not copy content).

**Written by stag.ai itself:** when an agent's task closes, the app adds one line to `40 Log/<YYYY-MM-DD>.md` (section "Agent work (auto)") and to the "Work done" list of that agent's note; when an agent note grows past its budget, old "Work done" items move to `60 Agents/<agent name> archive.md`; when `_INDEX.md` grows past its budget, done items (`- [x]`) of "Open items" whose latest date is older than a few days move to `00 Meta/_INDEX archive.md` (open `- [ ]` items always stay). Agents do not write those lines by hand.

## Language
- **All vault content is written in English**: file and folder names, frontmatter, headings, body.
- Chat with the user may be in another language. UI strings or the user's exact words may be quoted verbatim with an English gloss.

## Forbidden
- **Never store passwords / API keys / tokens / secrets** in the vault.

## Note conventions
- Every note has frontmatter `type:` (index / protocol / project / workflow / feature / log / decision / agent) and `date:` or `updated:`.
- Connect notes with `[[link]]`.

## Renaming / moving the vault
If the vault folder is renamed or moved:
1. Fix the path in `CLAUDE.md` at the project root, in this note, and in the auto memory cache (`MEMORY.md`).

## Worktree
The vault only lives in the main project folder. Sessions running in a git worktree must point to the vault by the absolute path above.

## Git
The vault is personal data → listed in `.gitignore`, never pushed to GitHub.
