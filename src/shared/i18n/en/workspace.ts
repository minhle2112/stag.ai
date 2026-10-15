import type { EnNamespace } from '../types'
import type vi from '../vi/workspace'

const en: EnNamespace<typeof vi> = {
  // Create workspace dialog
  'create.title': 'Create workspace',
  'create.submit': 'Create workspace',
  'create.creating': 'Creating…',
  'create.projectFolder': 'Project folder',
  'create.projectName': 'Project name',
  'create.projectItself': '(the project folder itself)',
  'create.vault': 'Vault (memory)',
  'create.useExisting': 'Use existing vault: {name}',
  'create.augment': 'Add missing folders / notes from the template (only adds, never edits or deletes)',
  'create.newVault': 'Create new vault: {name}',
  'create.noVaults': 'No vault found in this folder.',
  'create.pickOther': 'Choose another vault folder…',
  'create.pickOtherLong': 'Choose another vault folder… (any folder, even outside the project)',
  'create.gitRepo': 'The folder is a git repo: the app will add the vault and .sessions/ to .gitignore.',
  'create.gitRepoOutside': 'The folder is a git repo: the app will add .sessions/ to .gitignore.',
  'create.gitInit': 'Initialize git for this folder',
  'create.claudeNote': 'The app also makes sure there is a CLAUDE.md (vault recall rules) and a Claude Code auto memory cache. Existing files are not overwritten.',
  'tag.empty': 'empty folder',
  'tag.stag': 'stag.ai layout',
  'tag.other': 'other layout',
  'tag.custom': 'picked',
  'tag.outside': 'outside the project folder',

  // Errors while creating (main)
  'err.creating': 'A workspace is already being created for this folder',
  'err.noFolder': 'Folder not found: {path}',
  'err.noVault': 'Vault folder not found: {path}',
  'err.already': 'This folder is already a workspace in the app',
  'err.vaultExists': 'Folder "{dir}" already exists. Choose "Use existing vault".',

  // Report after creating (main → "Created workspace" dialog)
  'report.title': 'Created workspace "{name}"',
  'report.gitInit': 'Initialized git (branch main)',
  'report.newVault': { one: 'Created new vault "{dir}" ({count} note)', other: 'Created new vault "{dir}" ({count} notes)' },
  'report.augmented': 'Added to the existing vault (nothing overwritten): {files}',
  'report.vaultComplete': 'The existing vault already has the full structure; nothing added',
  'report.vaultKept': 'Using the existing vault "{dir}" as is',
  'report.gitignoreVaultIsProject': '.gitignore: the vault is the project folder itself, so it cannot be added to .gitignore',
  'report.gitignoreOutside': '.gitignore: the vault is outside the project folder, no need to exclude it',
  'report.gitignoreOutsideAdded': '.gitignore: the vault is outside the project folder, no need to exclude it; added {items}',
  'report.gitignoreAdded': '.gitignore: added {items}',
  'report.gitignoreKept': '.gitignore: vault and .sessions/ already excluded, unchanged',
  'report.claudeMdCreated': 'Created CLAUDE.md with the vault recall rules',
  'report.claudeMdKept': 'CLAUDE.md already has a Memory section, unchanged',
  'report.claudeMdAppended': 'Existing CLAUDE.md: added a Memory section at the end',
  'report.memoryCreated': 'Created the auto memory cache pointing to the vault',
  'report.memoryKept': 'The auto memory cache already points to the vault, unchanged',
  'report.memoryAppended': 'Existing auto memory cache: added a line pointing to the vault'
}

export default en
