/**
 * What the difference between entries requested and entries added actually means.
 *
 * The receipt used to be read with one subtraction - `entriesRequested - entriesAdded` - and the
 * page said the whole of it was entries the row already held. That sentence is true of one of the
 * three reasons a request can go unapplied and reassuring about the other two:
 *
 * - **Already there.** The row gained fewer keys than were asked for because it was ahead of the
 *   scan. The merge is `computed || existing`, the row wins every shared key, and this is the
 *   intended outcome of applying a plan that has aged.
 * - **Unreachable.** The row did not resolve at all - moved, deleted, or belonging to another
 *   organisation. Every entry asked for on that file was dropped. Until schema 95 the SQL did not
 *   count these into `entries_requested` while `files_requested` counted the file, so the
 *   subtraction read **zero** for exactly the batch that had lost the most.
 * - **No record to restore into.** The row carries no reserved map under that key, so there is
 *   nothing to fill a gap in. Deliberate - inventing a map would be the `unattributed` verdict the
 *   scanner exists to keep out of a repair - but still an entry that did not land.
 *
 * Pure: no I/O, no store access, no React.
 */

import type { VaultAuditRepairOutcome } from '@/types/vaultAudit'

/** The three reasons an approved entry did not reach the database, and their sum. */
export interface VaultAuditRepairShortfall {
  /** `entriesRequested - entriesAdded`, never negative. */
  total: number
  /** Entries on files whose row could not be resolved. */
  unreachable: number
  /** Entries asked for under a reserved map the row does not carry. */
  noRecord: number
  /**
   * The remainder: entries the row already held.
   *
   * The residual, not a count. `unreachable` and `noRecord` are read from the receipt and whatever
   * is left over is what is called safe - never the other way round. A refusal the database grows
   * later and this module has not been taught about therefore shrinks this line rather than being
   * absorbed into it, and being absorbed into it is the whole failure this module exists to end.
   */
  alreadyPresent: number
}

export function describeShortfall(outcome: VaultAuditRepairOutcome): VaultAuditRepairShortfall {
  const total = Math.max(0, outcome.entriesRequested - outcome.entriesAdded)

  let unreachable = 0
  let noRecord = 0
  for (const file of outcome.files) {
    if (file.refused !== null) {
      unreachable += file.entriesRequested
      continue
    }
    noRecord += file.entriesUnderAbsentMap
  }

  return {
    total,
    unreachable,
    noRecord,
    // Floored rather than allowed to go negative. The two sides come from different parts of one
    // receipt and a self-inconsistent receipt must not render "-3 were already there".
    alreadyPresent: Math.max(0, total - unreachable - noRecord),
  }
}
