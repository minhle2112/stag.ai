import type { EnNamespace } from '../types'
import type vi from '../vi/secrets'

const en: EnNamespace<typeof vi> = {
  // Kho bí mật (main/secrets.ts)
  'error.noCipher': 'Windows data encryption (safeStorage) isn\'t available, so the app can\'t save secrets.',
  'error.badName': 'Invalid secret name "{name}": use only letters, digits and "_", and don\'t start with a digit.',
  'error.empty': 'Secret {name} is empty.',
  'error.tooLong': 'Secret {name} is longer than {max} characters.',

  // Trang Kho bí mật (SecretsSection.tsx)
  'title': 'Secrets',
  'desc': 'Tokens and API keys for connectors. The app encrypts them with Windows (tied to your Windows account) and passes them to agent sessions as environment variables — never on the command line, never in settings or the vault. Saved values cannot be viewed again, only replaced or deleted.',
  'unavailable': 'Windows data encryption (safeStorage) isn\'t available, so the app can\'t save secrets. Connectors that need secrets won\'t run.',
  'missing': 'Connectors need secrets that are not saved',
  'add': 'Add secret',
  'name': 'Name',
  'nameDesc': 'Letters, digits and _ (e.g. GITHUB_TOKEN). Same name = replaces the old value.',
  'value': 'Value',
  'replace': 'Replace',
  'saved': 'Saved ({count})',
  'empty': 'No secrets yet.',
  'oauth': 'OAuth sign-in (managed by the app)',
  'savedAt': 'Saved {time}',
  'usedBy': 'used by {list}',
  'unused': 'not used by any connector',
  'newValueFor': 'New value for {name}',
  'replaceValue': 'Replace value',
  'inUse': 'In use by {names}',
  'reallyDelete': 'Really delete',
  'note': 'Note: an agent can read its connectors\' secrets inside its session (they are in the session\'s environment variables). Only turn connectors on for agents you trust. The secrets file lives in the app\'s data folder (secrets.json); copied to another computer or Windows account, it can\'t be decrypted.'
}

export default en
