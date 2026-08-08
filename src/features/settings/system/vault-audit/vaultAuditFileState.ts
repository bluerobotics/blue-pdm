/**
 * Whether a document may be written to, and if not, whose problem that is.
 *
 * The audit produces findings from database rows, and a row says nothing about who is holding the
 * document right now. Sync Metadata will refuse a file that is not yours, so the write is already
 * safe - but a refusal arriving after the click is the wrong place for this information. Somebody
 * reading a list of four hundred files needs to know which of them are somebody else's *before*
 * they start ticking.
 *
 * ## Two refusals that look the same and are not
 *
 * A file that is **checked in** is one you can have: check it out and the write becomes available.
 * It is a step, not an obstacle, and counting it as an obstacle would make a healthy vault look
 * closed.
 *
 * A file **another user is holding** is not yours to take. They may have it open, they may have
 * unsaved changes, and a check-in of theirs will overwrite anything written underneath them. This
 * one never becomes available by waiting, and the audit does not offer it at all.
 *
 * Reporting both as "not eligible" was the original shape here, and it left the reader unable to
 * tell a vault that needs ten checkouts from a vault where a colleague has the whole folder out.
 *
 * Pure: no React, no store, no I/O.
 */

import type { LocalFile } from '@/stores/pdmStore'

export type VaultAuditFileAvailability =
  /** Local-only, or checked out by this user. Sync Metadata will accept it. */
  | { state: 'writable' }
  /** In BluePLM and nobody is holding it. Available after a checkout. */
  | { state: 'not-checked-out' }
  /** Held by somebody else. Named where the row carries a name. */
  | { state: 'held-by-other'; holder: string | null }
  /** No local copy loaded, so there is no document on disk to write to. */
  | { state: 'not-loaded' }

/** Who is holding it, as the rest of the app would name them. Null when the row does not say. */
function holderOf(file: LocalFile): string | null {
  const user = file.pdmData?.checked_out_user
  if (!user) return null
  return user.full_name || user.email || null
}

/**
 * Classify one loaded file against the user asking.
 *
 * The writable test is the same one `sync-metadata` applies, restated rather than imported because
 * the command is what enforces it and this is only allowed to predict the answer. If the two ever
 * disagree the command wins and the count above the button was wrong, which is a display bug; the
 * alternative - this module deciding and the command trusting it - is a write that skipped its own
 * precondition.
 */
export function availabilityOf(
  file: LocalFile | undefined,
  currentUserId: string | undefined,
): VaultAuditFileAvailability {
  if (!file) return { state: 'not-loaded' }

  const checkedOutBy = file.pdmData?.checked_out_by
  const isLocalOnly = !file.pdmData?.id

  if (isLocalOnly || checkedOutBy === currentUserId) return { state: 'writable' }
  if (!checkedOutBy) return { state: 'not-checked-out' }

  return { state: 'held-by-other', holder: holderOf(file) }
}

/** What a set of files amounts to, for the line above the button. */
export interface VaultAuditAvailabilityTally {
  writable: number
  notCheckedOut: number
  heldByOther: number
  notLoaded: number
  /** Distinct names, so the notice can say who rather than only how many. */
  holders: string[]
}

export function tallyAvailability(
  availabilities: Iterable<VaultAuditFileAvailability>,
): VaultAuditAvailabilityTally {
  const tally: VaultAuditAvailabilityTally = {
    writable: 0,
    notCheckedOut: 0,
    heldByOther: 0,
    notLoaded: 0,
    holders: [],
  }

  const holders = new Set<string>()
  for (const availability of availabilities) {
    switch (availability.state) {
      case 'writable':
        tally.writable += 1
        break
      case 'not-checked-out':
        tally.notCheckedOut += 1
        break
      case 'held-by-other':
        tally.heldByOther += 1
        if (availability.holder) holders.add(availability.holder)
        break
      case 'not-loaded':
        tally.notLoaded += 1
        break
    }
  }

  tally.holders = [...holders].sort((a, b) => a.localeCompare(b))
  return tally
}
