/**
 * What happens to a datacard edit once the file write it triggered comes back.
 *
 * The impure counterpart to `pendingEdits.ts`: that module decides, this one applies the decision
 * to the store and tells the user. Both write paths - the details panel and the configuration
 * saver - go through it so there is one rule about when an edit is taken back, rather than two
 * that drift.
 *
 * Why an edit is taken back at all, when discarding a user's typing is normally the worse bug:
 * `pendingMetadata` is now the only record that the edit was made, and check-in promotes whatever
 * it finds pending into the database. A value left behind by a write that never reached the file
 * would arrive in the database at the next check-in looking exactly like one the file had
 * accepted. Until a pending value can carry its own write state, the choice is between losing the
 * keystroke - loudly, with the toast below saying so - and silently shipping a divergence that
 * nothing in the app can see afterwards.
 */

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { PendingMetadataRollback } from '@/stores/types'

import { shouldRevertPendingMetadata, type MetadataWriteOutcome } from './pendingEdits'

/** Numbers for the partial-write message, which names how much of the write landed. */
export interface MetadataWriteCounts {
  saved: number
  failed: number
}

/**
 * Settle one metadata write: undo the pending edit if nothing reached the file, and report what
 * happened either way.
 *
 * `landed` and `not-applicable` leave the edit pending on purpose - it is still owed to the
 * database and check-in is what delivers it.
 */
export function reportMetadataWrite(
  rollback: PendingMetadataRollback,
  outcome: MetadataWriteOutcome,
  counts?: MetadataWriteCounts,
): void {
  const { addToast, revertPendingMetadata } = usePDMStore.getState()

  if (shouldRevertPendingMetadata(outcome)) {
    log.warn('[MetadataWrite]', 'Write did not reach the file; reverting the pending edit', {
      path: rollback.path,
      fields: rollback.fields,
      outcome,
    })
    revertPendingMetadata(rollback)
    addToast(
      'error',
      outcome === 'unattempted'
        ? t('source.metadataWrite.serviceOffline')
        : t('source.metadataWrite.failed'),
    )
    return
  }

  if (outcome === 'partial') {
    addToast(
      'warning',
      t('source.metadataWrite.partial', {
        saved: counts?.saved ?? 0,
        failed: counts?.failed ?? 0,
      }),
    )
    return
  }

  if (outcome === 'landed') addToast('success', t('source.metadataWrite.saved'))
}
