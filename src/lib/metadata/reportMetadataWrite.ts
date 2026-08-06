/**
 * What happens to a datacard edit once the file write it triggered comes back.
 *
 * The impure counterpart to `writeState.ts`: that module decides what a set of outcomes means, this
 * one records them against the file and tells the user. Every write path goes through it, so there
 * is one rule about how an outcome is recorded rather than several that drift.
 *
 * For one release this function reverted the edit when nothing reached the file. That was the only
 * defence available: `pendingMetadata` was the sole record that the edit existed and check-in
 * promoted whatever it found there, so a value left behind by a failed write would arrive in the
 * database looking exactly like one the file had accepted. Throwing away the keystroke was chosen
 * over shipping a silent divergence, and the choice was documented as a compromise rather than a
 * design.
 *
 * It is no longer necessary. The value stays, the addresses that did not reach the file are marked,
 * and check-in reads the marks. Nothing here deletes a value the user typed.
 */

import { t } from '@/lib/i18n'
import { log } from '@/lib/logger'
import { usePDMStore } from '@/stores/pdmStore'
import type { PendingMetadataEdit } from '@/stores/types'

import type { MetadataWriteOutcome } from './pendingEdits'
import type { VerifiedAddress } from './verifyWrite'
import { listWriteAddresses, type MetadataWriteState } from './writeState'

/** What one settled write is being reported. */
export interface MetadataWriteReport {
  outcome: MetadataWriteOutcome
  /** Per-address verdicts. Empty when the write was never issued. */
  addresses: readonly VerifiedAddress[]
}

/**
 * A report for a write that was never issued, covering every address the edit touched.
 *
 * `unattempted` rather than `failed` because nothing was written and we know it: the remedy is to
 * start the service and retry, and telling the user their file might have changed would be false.
 */
export function unattemptedWrite(
  edit: PendingMetadataEdit,
  reason: string,
): MetadataWriteReport {
  return {
    outcome: 'unattempted',
    addresses: listWriteAddresses(edit.pending).map((address) => ({
      address,
      state: 'unattempted' as MetadataWriteState,
      reason,
    })),
  }
}

/**
 * Record one write's per-address verdicts and say what happened.
 *
 * The edit stays pending in every case, including outright failure - it is still the user's value
 * and still owed to the database. What changes is the mark it carries, which is what stops check-in
 * from promoting an unconfirmed value as though the file had taken it.
 */
export function reportMetadataWrite(
  edit: PendingMetadataEdit,
  report: MetadataWriteReport,
): void {
  const { addToast, recordMetadataWriteStates } = usePDMStore.getState()

  if (report.addresses.length > 0) {
    recordMetadataWriteStates(
      edit.path,
      report.addresses.map((entry) => ({
        address: entry.address,
        state: entry.state,
        reason: entry.reason,
      })),
    )
  }

  const verified = report.addresses.filter((entry) => entry.state === 'verified').length
  const total = report.addresses.length

  switch (report.outcome) {
    case 'verified':
      addToast('success', t('source.metadataWrite.saved'))
      return

    case 'unverified':
      log.warn('[MetadataWrite]', 'Write could not be confirmed against the file', {
        path: edit.path,
        addresses: total,
      })
      addToast('warning', t('source.metadataWrite.unverified'))
      return

    case 'partial':
      log.warn('[MetadataWrite]', 'Write landed in some scopes and not others', {
        path: edit.path,
        verified,
        total,
      })
      addToast('warning', t('source.metadataWrite.partial', { saved: verified, total }))
      return

    case 'unattempted':
      log.warn('[MetadataWrite]', 'Write could not be issued; the edit is kept and marked', {
        path: edit.path,
        fields: edit.fields,
      })
      addToast('error', t('source.metadataWrite.serviceOffline'))
      return

    case 'failed':
      log.warn('[MetadataWrite]', 'Write did not reach the file; the edit is kept and marked', {
        path: edit.path,
        fields: edit.fields,
      })
      addToast('error', t('source.metadataWrite.failed'))
      return

    case 'not-applicable':
      return
  }
}
