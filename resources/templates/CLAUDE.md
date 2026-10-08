# {{PROJECT}}

_(Describe the project in 2–3 lines.)_

**Language:** reply in the language the user writes in. (To fix one language for this project, write it here, e.g. "Conversation language: Vietnamese".)

## Memory (REQUIRED)
- Vault: `{{VAULT_PATH}}`
- **The vault is the main memory**; Claude Code's auto memory is only a cache pointing to the vault. Conflict → the vault wins.
- **Every session must read `{{VAULT_DIR}}/_INDEX.md` (then the related notes) before doing anything.** In a worktree, use the absolute path above.
- Learned something new (convention, error, decision, finished work) → record it in the vault per `{{VAULT_DIR}}/00 Meta/Memory Protocol.md`.
- **The vault is written entirely in English** (file and folder names, frontmatter, headings, body), whatever language the conversation uses.
- **Never store passwords / API keys / tokens** in the vault.
