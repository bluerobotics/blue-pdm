/**
 * What check-in does with pending metadata: hand it to the database and claim nothing further.
 *
 * Check-in used to write. It pushed every field still owed into the SolidWorks document, read it
 * back, and only then let the database take the value, so the two could not disagree. Two things
 * were wrong with that. It changed the bytes of the very file being checked in, which the hash a
 * few lines later read as new content, so checking in a folder cut a version on every drawing
 * carrying a pending edit whether or not anyone had opened it - and the file watcher then read
 * those writes as external edits and refilled `pendingMetadata` from them, so the next check-in
 * did it again. Putting a value into a document is the user's Sync Metadata now and nothing else's.
 *
 * The second thing was the premise. That write existed to catch a datacard save that had silently
 * failed, and the editing paths no longer work that way: an item number or description typed in
 * the browser list is written to the document on Enter and records its own outcome, and if it
 * fails the user is told there and then. A drawing is the other live source of a pending value,
 * and its value is read out of the parent model on purpose - the drawing is not where it was ever
 * going to live. So an address with nothing recorded against it is not a suspicious address, and
 * check-in treating it as one would put a warning on the normal case.
 *
 * What is left is narrow, and all of it is about marks somebody else made:
 *
 * - **Promote either way.** The value is the user's and the database owns it.
 * - **Forget a settled address.** `verified` means the file has it and `pending` means nothing was
 *   ever attempted; neither is worth a marker once the pending value is gone.
 * - **Keep a mark somebody earned.** `failed`, `unverified` and `unattempted` each record a write
 *   that was tried and did not confirm. Those survive check-in and gain `promoted`, which is the
 *   durable statement that the database took the value anyway. That flag is the one thing here
 *   that is a fact about the database rather than about the document.
 *
 * Pure: no I/O, no store access, no React. That is the guarantee now rather than an implementation
 * note - a check-in that touches the document is the defect this module exists to have removed.
 */

import { log } from '@/lib/logger'
import type { LocalFile } from '@/stores/types'

import {
  applyWriteState,
  clearWriteState,
  listWriteAddresses,
  readWriteState,
  writeStateOf,
  type MetadataWriteAddress,
  type MetadataWriteState,
  type MetadataWriteStateRecord,
} from './writeState'

/**
 * The states that say nothing check-in should carry forward.
 *
 * `verified` is settled in the file's favour and `pending` was never attempted. Everything else is
 * a write that ran and could not be confirmed, which is exactly what a marker is for.
 */
const NOTHING_TO_REPORT: ReadonlySet<MetadataWriteState> = new Set<MetadataWriteState>([
  'verified',
  'pending',
])

/** What check-in learned, and the record it must carry forward. */
export interface CheckinMetadataOutcome {
  /** The write state to store on the file after promotion. Undefined means nothing left to say. */
  writeState: MetadataWriteStateRecord | undefined
  /** Addresses whose values reach the database over a write that is known to have not landed. */
  promotedUnconfirmed: MetadataWriteAddress[]
}

/**
 * Say what the database may take, and keep whatever marks the file already carried.
 *
 * Returns the record to store rather than storing it, so check-in can fold it into the batched
 * update it already makes per file instead of triggering a separate render.
 */
export function promoteMetadataForCheckin(file: LocalFile): CheckinMetadataOutcome {
  const record = file.metadataWriteState
  const edited = listWriteAddresses(file.pendingMetadata)

  const settled: MetadataWriteAddress[] = []
  const unconfirmed: MetadataWriteAddress[] = []
  for (const address of edited) {
    if (NOTHING_TO_REPORT.has(writeStateOf(record, address))) settled.push(address)
    else unconfirmed.push(address)
  }

  let next = clearWriteState(record, settled)
  if (unconfirmed.length > 0) {
    // Re-applied one address at a time, each carrying back its own `at` and `reason`. A batch
    // would stamp them all with this check-in's clock, and when the write failed is the useful
    // half of the mark - check-in is not the event being recorded, it is only adding `promoted`.
    for (const address of unconfirmed) {
      const entry = readWriteState(record, address)
      next = applyWriteState(next, [address], writeStateOf(record, address), {
        at: entry?.at,
        reason: entry?.reason,
        promoted: true,
      })
    }

    log.warn('[CheckinMetadata]', 'Promoting values whose write into the file did not land', {
      path: file.relativePath,
      count: unconfirmed.length,
      addresses: unconfirmed.map((address) =>
        address.scope === 'file' ? address.field : `${address.field}:${address.configuration}`,
      ),
    })
  }

  return { writeState: next, promotedUnconfirmed: unconfirmed }
}
