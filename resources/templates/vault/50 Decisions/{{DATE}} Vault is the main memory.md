---
type: decision
date: {{DATE}}
---
# Decision: The vault is the main memory

Back to: [[_INDEX]] · [[Memory Protocol]]

## Context
The {{PROJECT}} project is worked on across many sessions and many agents. It needs one place for long-term knowledge that the user can read and edit, independent of any single session's context.

## Decision
The Obsidian vault `{{VAULT_DIR}}/` in the project folder is the **primary memory (source of truth)**. Claude Code's auto memory is only a **short cache** pointing to the vault. Conflict → the vault wins. Every session must recall `_INDEX.md` before working. All vault content is written in English.

## Rationale
- The user reads and edits it directly in Obsidian, with links between notes.
- It sits next to the code and is independent of any specific AI tool.

## Rejected alternatives
- Using only Claude Code's auto memory: hard to read/edit, tied to one tool.

## Consequences
- The vault and `.obsidian/` are not in git.
- Renaming/moving the vault requires fixing the path in `CLAUDE.md`, [[Memory Protocol]] and the cache.
