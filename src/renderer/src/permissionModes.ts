import type { AgentKind, PermissionMode } from '@shared/types'
import { t } from '@shared/i18n'

/** Mức quyền theo CLI của agent (main đổi sang cờ của từng CLI, xem agents.ts / codex.ts). */
export function permissionModes(kind: AgentKind): Array<{ id: PermissionMode; label: string; hint: string }> {
  if (kind === 'codex')
    return [
      { id: 'default', label: t('agents.perm.codex.default'), hint: t('agents.perm.codex.defaultHint') },
      { id: 'acceptEdits', label: t('agents.perm.acceptEdits'), hint: t('agents.perm.codex.acceptEditsHint') },
      { id: 'auto', label: t('agents.perm.auto'), hint: t('agents.perm.codex.autoHint') },
      { id: 'plan', label: t('agents.perm.codex.plan'), hint: t('agents.perm.codex.planHint') }
    ]
  return [
    { id: 'default', label: t('agents.perm.claude.default'), hint: t('agents.perm.claude.defaultHint') },
    { id: 'acceptEdits', label: t('agents.perm.acceptEdits'), hint: t('agents.perm.claude.acceptEditsHint') },
    { id: 'auto', label: t('agents.perm.auto'), hint: t('agents.perm.claude.autoHint') },
    { id: 'plan', label: t('agents.perm.claude.plan'), hint: t('agents.perm.claude.planHint') }
  ]
}
