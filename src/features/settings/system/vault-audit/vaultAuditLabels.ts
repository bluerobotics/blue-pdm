/**
 * Names for the audit's vocabulary.
 *
 * Field and reason strings reuse the `divergence.*` keys the terminal report already ships, so the
 * page and the report call the same thing by the same name. The category names are the page's own,
 * because "unrecoverable" is a classification and "Lost from both sides" is an answer.
 */

import { t } from '@/lib/i18n'
import type { OwnedField, UnattributedReason } from '@/lib/metadata/divergence'
import type {
  VaultAuditCategoryKind,
  VaultAuditResolution,
  VaultAuditTone,
} from '@/types/vaultAudit'

import type { VaultAuditBlockedReason } from './vaultAuditActions'
import type { ValueDifferenceKind } from './valueDifference'

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
    case 'absent-from-file':
      return t('vaultAudit.category.absentFromFile')
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
    case 'absent-from-file':
      return t('vaultAudit.category.absentFromFileDescription')
    case 'unattributed':
      return t('vaultAudit.category.unattributedDescription')
  }
}

/**
 * The resolution as an instruction, phrased as the write it would be.
 *
 * Deliberately named after the direction rather than the evidence: "Use the file's value" says
 * what happens, where "recoverable" needs the reader to already know which way a recovery runs.
 */
export function resolutionLabel(resolution: VaultAuditResolution): string {
  switch (resolution) {
    case 'adopt-file-value':
      return t('vaultAudit.resolution.adoptFileValue')
    case 'push-vault-value':
      return t('vaultAudit.resolution.pushVaultValue')
    case 'file-is-authoritative':
      return t('vaultAudit.resolution.fileAuthoritative')
    case 'choose-a-side':
      return t('vaultAudit.resolution.chooseASide')
    case 'nothing-to-restore':
      return t('vaultAudit.resolution.nothingToRestore')
    case 'fix-on-parent-model':
      return t('vaultAudit.resolution.fixOnParentModel')
    case 'leave-alone':
      return t('vaultAudit.resolution.leaveAlone')
  }
}

/** The reasoning behind the instruction, shown on hover rather than in the row. */
export function resolutionHint(resolution: VaultAuditResolution): string {
  switch (resolution) {
    case 'adopt-file-value':
      return t('vaultAudit.resolution.adoptFileValueHint')
    case 'push-vault-value':
      return t('vaultAudit.resolution.pushVaultValueHint')
    case 'file-is-authoritative':
      return t('vaultAudit.resolution.fileAuthoritativeHint')
    case 'choose-a-side':
      return t('vaultAudit.resolution.chooseASideHint')
    case 'nothing-to-restore':
      return t('vaultAudit.resolution.nothingToRestoreHint')
    case 'fix-on-parent-model':
      return t('vaultAudit.resolution.fixOnParentModelHint')
    case 'leave-alone':
      return t('vaultAudit.resolution.leaveAloneHint')
  }
}

/**
 * Why a row whose resolution is known still has no checkbox.
 *
 * The held-by case has a better answer where the file is loaded, because the row can name the
 * colleague - see `heldByLabel` in the table. This is what is left to say when it cannot.
 */
export function blockedReasonLabel(reason: VaultAuditBlockedReason): string {
  switch (reason) {
    case 'no-write-resolves-it':
      return t('vaultAudit.blocked.noWriteResolvesIt')
    case 'no-vault-writer-for-field':
      return t('vaultAudit.blocked.noVaultWriterForField')
    case 'entry-already-recorded':
      return t('vaultAudit.blocked.entryAlreadyRecorded')
    case 'held-by-another-user':
      return t('vaultAudit.blocked.heldByAnotherUser')
  }
}

/**
 * A note on differences nobody typed on purpose, or null for one worth reading.
 *
 * Null rather than an empty string: a substantive difference has nothing to add beyond the two
 * values already on the row, and returning "" would put an empty element into every conflict row.
 */
export function differenceLabel(kind: ValueDifferenceKind): string | null {
  switch (kind) {
    case 'case-only':
      return t('vaultAudit.difference.caseOnly')
    case 'whitespace-only':
      return t('vaultAudit.difference.whitespaceOnly')
    case 'case-and-whitespace':
      return t('vaultAudit.difference.caseAndWhitespace')
    case 'substantive':
      return null
  }
}

/**
 * Which way the write runs, or null when the resolution is not a write.
 *
 * The findings table puts the two values in a BluePLM column and a file column, and an arrow
 * pointing from the surviving copy to the one that would be overwritten says the direction in the
 * same terms the columns are already in.
 */
export function resolutionDirection(
  resolution: VaultAuditResolution,
): 'file-to-vault' | 'vault-to-file' | null {
  if (resolution === 'adopt-file-value') return 'file-to-vault'
  if (resolution === 'push-vault-value') return 'vault-to-file'
  return null
}

/** Text colour per tone. Zero counts are muted by the caller so an empty category reads as calm. */
export const TONE_TEXT: Record<VaultAuditTone, string> = {
  critical: 'text-plm-error',
  warning: 'text-yellow-500',
  repairable: 'text-plm-accent',
  neutral: 'text-plm-fg-muted',
}
