## Memory (REQUIRED)
- Vault: `{{VAULT_PATH}}` (an existing markdown vault, not in the stag.ai layout)
- **The vault is the main memory**; Claude Code's auto memory is only a cache pointing to the vault. Conflict → the vault wins.
- **Every session must find and read the related notes in the vault before doing anything.** In a worktree, use the absolute path above.
- Learned something new (convention, error, decision, finished work) → write it as a note in the vault, linked to related notes with `[[link]]`.
- **The vault is written entirely in English** (file and folder names, frontmatter, headings, body), whatever language the conversation uses.
- **Never store passwords / API keys / tokens** in the vault.
