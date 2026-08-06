/**
 * Names for the audit's vocabulary.
 *
 * Field and reason strings reuse the `divergence.*` keys the terminal report already ships, so the
 * page and the report call the same thing by the same name. The category names are the page's own,
 * because "unrecoverable" is a classification and "Lost from both sides" is an answer.
 */

import { t } from '@/lib/i18n'
import type { OwnedField, UnattributedReason } from '@/lib/metadata/divergence'
import type { VaultAuditCategoryKind, VaultAuditTone } from '@/types/vaultAudit'

export function fieldLabel(field: OwnedField): string {
  switch (field) {
    case 'part_number':
      return t('divergence.field.partNumber')
    case 'description':
      return t('divergence.field.description')
    case 'revision':
      return t('divergence.field.revision')
    case 'config_tab':
      return t('divergence.field.configTab')
    case 'config_description':
      return t('divergence.field.configDescription')
  }
}

export function unattributedReasonLabel(reason: UnattributedReason): string {
  switch (reason) {
    case 'database-never-held-it':
      return t('divergence.unattributedReason.neverHeld')
    case 'not-database-owned':
      return t('divergence.unattributedReason.notOwned')
    case 'no-transcribable-value':
      return t('divergence.unattributedReason.notTranscribable')
  }
}

export function categoryLabel(kind: VaultAuditCategoryKind): string {
  switch (kind) {
    case 'lost':
      return t('vaultAudit.category.lost')
    case 'conflicting':
      return t('vaultAudit.category.conflicting')
    case 'recoverable':
      return t('vaultAudit.category.recoverable')
    case 'unattributed':
      return t('vaultAudit.category.unattributed')
  }
}

export function categoryDescription(kind: VaultAuditCategoryKind): string {
  switch (kind) {
    case 'lost':
      return t('vaultAudit.category.lostDescription')
    case 'conflicting':
      return t('vaultAudit.category.conflictingDescription')
    case 'recoverable':
      return t('vaultAudit.category.recoverableDescription')
    case 'unattributed':
      return t('vaultAudit.category.unattributedDescription')
  }
}

/** Text colour per tone. Zero counts are muted by the caller so an empty category reads as calm. */
export const TONE_TEXT: Record<VaultAuditTone, string> = {
  critical: 'text-plm-error',
  warning: 'text-yellow-500',
  repairable: 'text-plm-accent',
  neutral: 'text-plm-fg-muted',
}
