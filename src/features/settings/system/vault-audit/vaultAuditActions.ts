/**
 * Which of the two writes a finding can actually be given, today, by this build.
 *
 * `resolutionOf` in `vaultAuditView` says what *would* settle a finding. That is a statement about
 * the data and it stays true whatever the app can do. This is the other half: whether BluePLM owns
 * a writer that performs it. The two are deliberately separate, because a row whose resolution is
 * known and whose writer is missing has to say both things, and collapsing them into one verdict
 * would report "nothing can be done" about a value that is one feature away from being fixed.
 *
 * ## The two writers, and how much of a row each one covers
 *
 * **Into the database** is `repair_config_maps`, and it is per *value*. It adds an entry to a
 * reserved configuration map and cannot do anything else - not overwrite an entry that is already
 * there, and not touch `part_number`, `description` or `revision`, which are columns and have no
 * merge to be part of. So a ticked row means exactly that value.
 *
 * **Into the file** is the existing Sync Metadata command, and it is per *file*. It rebuilds every
 * BluePLM-owned property except file-driven revision in the document from the row, at file scope
 * and at every configuration scope, and verifies the result by reading it back. There is no way to
 * ask it for one field. So a ticked row means the file that row is in, and the interface has to say
 * so rather than implying a precision the command does not have.
 *
 * That asymmetry is the reason selection is counted in values on one side and in files on the
 * other, and it is not a rough edge to be smoothed over: pretending the file write is per-value
 * would let someone tick one description and be surprised by a changed part number.
 *
 * Pure: no React, no I/O, no store.
 */

import type { VaultAuditFinding } from '@/types/vaultAudit'

/** Shared so the default argument does not allocate a set per row. */
const EMPTY: ReadonlySet<string> = new Set()

// ============================================
// Vocabulary
// ============================================

export type VaultAuditActionKind =
  /** Add this value to the row's reserved configuration map. Per value. */
  | 'write-to-vault'
  /** Rebuild this document's BluePLM-owned properties from the row. Per file. */
  | 'write-to-file'

/** Why a finding whose resolution is known still has no button. */
export type VaultAuditBlockedReason =
  /** No write settles it at all - nothing survives to copy, or the value is not BluePLM's. */
  | 'no-write-resolves-it'
  /**
   * The resolution is to take the document's value, and the field lives in a column rather than
   * in a reserved map. Nothing in BluePLM writes a column from a scan, so this needs a person.
   */
  | 'no-vault-writer-for-field'
  /**
   * The resolution is to take the document's value into a configuration map that already carries a
   * key for that configuration. The merge is additive by construction, so it would refuse.
   */
  | 'entry-already-recorded'
  /**
   * The resolution is to write the document, and somebody else has it checked out.
   *
   * Blocks only the document write. The database write is a merge into the row's configuration map
   * that cannot overwrite an entry and never opens the file, so a colleague's checkout is not a
   * reason to withhold it - and withholding it would stop the recovery this audit exists for on
   * every file anyone happens to be holding.
   */
  | 'held-by-another-user'

export type VaultAuditRowAction =
  | { available: true; kind: VaultAuditActionKind }
  | { available: false; reason: VaultAuditBlockedReason }

// ============================================
// Deciding
// ============================================

/**
 * The id this finding carries in the repair proposal, or null when it could never have one.
 *
 * `buildRepairCandidates` keys on file, field and configuration and omits the scope, because
 * everything it produces is configuration scope. Rebuilding the same key here rather than
 * threading candidates through the table is what keeps the findings list independent of the
 * proposal's own filtering - a finding that is not a candidate has to render, and say why.
 */
export function repairCandidateIdOf(finding: VaultAuditFinding): string | null {
  if (finding.scope !== 'configuration' || finding.configuration === null) return null
  if (finding.field !== 'config_tab' && finding.field !== 'config_description') return null
  return `${finding.fileId}:${finding.field}:${finding.configuration}`
}

/**
 * What this row's checkbox would do, or why it has none.
 *
 * `repairable` is the set of candidate ids the proposal actually produced. It is passed in rather
 * than recomputed because it depends on the derived-tabs option and on the row's existing map
 * keys, both of which the proposal has already resolved and neither of which a finding carries.
 *
 * Note what `choose-a-side` gets: the file write, and only the file write. Both directions settle
 * a conflict in principle, and only one of them exists, so the row offers the one that exists and
 * the interface says the other is unavailable. Offering neither would be more symmetrical and
 * would leave the single largest actionable category with no action in it.
 */
export function actionForFinding(
  finding: VaultAuditFinding,
  repairable: ReadonlySet<string>,
  heldByOthers: ReadonlySet<string> = EMPTY,
): VaultAuditRowAction {
  // Revision is always driven by the file. Keep this guard even though `resolutionOf` currently
  // avoids these directions, because stale or externally-produced reports must not expose a file
  // writer for revision.
  if (
    finding.field === 'revision' &&
    (finding.resolution === 'push-vault-value' || finding.resolution === 'choose-a-side')
  ) {
    return { available: false, reason: 'no-write-resolves-it' }
  }

  switch (finding.resolution) {
    case 'push-vault-value':
    case 'choose-a-side':
      // Sync Metadata would refuse this file anyway. Refusing it here as well is what keeps the
      // refusal in front of the person choosing, rather than in a summary after they chose.
      if (heldByOthers.has(finding.fileId)) {
        return { available: false, reason: 'held-by-another-user' }
      }
      return { available: true, kind: 'write-to-file' }

    case 'adopt-file-value': {
      const id = repairCandidateIdOf(finding)
      if (id === null) return { available: false, reason: 'no-vault-writer-for-field' }
      if (repairable.has(id)) return { available: true, kind: 'write-to-vault' }
      return { available: false, reason: 'entry-already-recorded' }
    }

    case 'nothing-to-restore':
    case 'file-is-authoritative':
    case 'fix-on-parent-model':
    case 'leave-alone':
      return { available: false, reason: 'no-write-resolves-it' }
  }
}

/**
 * The one action a whole category admits, or null when it admits none.
 *
 * A category is a single resolution in all but one case, so its rows agree about direction and the
 * action bar can carry one button rather than one per row. The exception is `recoverable`, whose
 * rows are all `adopt-file-value` but some of which have no writer; those rows are excluded from
 * the selection rather than changing what the category's button says.
 */
export function categoryActionOf(
  findings: readonly VaultAuditFinding[],
  repairable: ReadonlySet<string>,
  heldByOthers: ReadonlySet<string> = EMPTY,
): VaultAuditActionKind | null {
  for (const finding of findings) {
    const action = actionForFinding(finding, repairable, heldByOthers)
    if (action.available) return action.kind
  }
  return null
}

/**
 * The direction a category would take if nothing were in the way.
 *
 * `categoryActionOf` answers from the rows that can actually be acted on, which is the right answer
 * for deciding whether to draw a button - and the wrong one for a category every row of which is
 * checked out to somebody else, where it collapses to "nothing can be done here" and hides the
 * reason. This ignores availability and reports the intent.
 */
export function categoryDirectionOf(
  findings: readonly VaultAuditFinding[],
): VaultAuditActionKind | null {
  for (const finding of findings) {
    switch (finding.resolution) {
      case 'push-vault-value':
      case 'choose-a-side':
        if (finding.field === 'revision') continue
        return 'write-to-file'
      case 'adopt-file-value':
        return 'write-to-vault'
      default:
        continue
    }
  }
  return null
}
