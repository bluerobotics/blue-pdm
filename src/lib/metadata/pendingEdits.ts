/**
 * Recording a datacard edit as pending, and undoing it when the write it was made for never landed.
 *
 * `updatePendingMetadata` used to copy the edited fields into `pdmData` as well, so the edit read
 * back as though the server already held it. That made two separate things impossible: telling a
 * requested value apart from a confirmed one, and undoing a request that turned out not to be
 * granted. The copy is gone; this module is the other half of its removal.
 *
 * An edit therefore has to be reversible, because `pendingMetadata` is now the only place the
 * attempted value exists and check-in promotes whatever it finds there. A value left behind by a
 * write that failed would reach the database at the next check-in as though the file had accepted
 * it - which is the divergence this whole phase is about, arrived at by a different route.
 *
 * Reverting is scoped to the fields the write actually attempted. A blanket clear would also throw
 * away edits from earlier saves that did land in the file but have not been checked in yet, and
 * those are the ones the database is still waiting for.
 *
 * Pure: no I/O, no store access, no React. The slice supplies the current state and applies what
 * comes back.
 */

import type { DiffStatus, PendingMetadata, PendingMetadataRollback } from '@/stores/types'

/** The fields a rollback can name. */
export type PendingMetadataField = keyof PendingMetadata

/**
 * What a metadata write did, at the granularity the callers can honestly report today.
 *
 * There is no `verified` here: nothing reads the file back yet, so `landed` means the service said
 * it wrote and nothing has checked. Naming the states anyway keeps the two call sites from each
 * inventing a rule, and gives read-back verification somewhere to attach when it arrives.
 */
export type MetadataWriteOutcome =
  /** Every scope the write attempted reported success. */
  | 'landed'
  /** Some scopes wrote and some did not, so the value is in the file and must stay pending. */
  | 'partial'
  /** Nothing was written, and the service said so. */
  | 'failed'
  /** The write could not be started - no service, no response - so nothing was written. */
  | 'unattempted'
  /** This file has no property write at all; `pendingMetadata` is the only record of the edit. */
  | 'not-applicable'

/**
 * Whether the edit should be taken back out of `pendingMetadata`.
 *
 * Only when nothing reached the file. A partial write leaves the value in some configurations, so
 * dropping it would guarantee the divergence rather than prevent it, and `not-applicable` covers
 * the files - anything that is not a SolidWorks document - whose pending edit is meant to go
 * straight to the database at check-in.
 */
export function shouldRevertPendingMetadata(outcome: MetadataWriteOutcome): boolean {
  return outcome === 'failed' || outcome === 'unattempted'
}

/** The edited pending set, plus what it takes to put things back. */
export interface PendingEdit {
  pending: PendingMetadata
  rollback: PendingMetadataRollback
}

/** A rollback that restores nothing, for the paths that record no edit. */
export function noPendingEdit(path: string): PendingMetadataRollback {
  return { path, fields: [], previous: undefined, previousDiffStatus: undefined }
}

function mergeConfigEdit(
  existing: Record<string, string> | undefined,
  edit: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!edit) return existing
  return { ...(existing ?? {}), ...edit }
}

/**
 * Fold one edit into the pending set.
 *
 * The two configuration maps merge rather than replace, because an edit names only the
 * configurations the user just touched and the rest of the pending map is still owed to the
 * database. Every other field replaces, including with `null`, which is how a deliberate clear is
 * distinguished from never having been set.
 */
export function applyPendingEdit(
  path: string,
  existing: PendingMetadata | undefined,
  edit: PendingMetadata,
  previousDiffStatus: DiffStatus | undefined,
): PendingEdit {
  const base = existing ?? {}

  const pending: PendingMetadata = {
    ...base,
    ...edit,
    config_tabs: mergeConfigEdit(base.config_tabs, edit.config_tabs),
    config_descriptions: mergeConfigEdit(base.config_descriptions, edit.config_descriptions),
  }

  return {
    pending,
    rollback: {
      path,
      fields: Object.keys(edit) as PendingMetadataField[],
      previous: existing,
      previousDiffStatus,
    },
  }
}

function restoreField<K extends PendingMetadataField>(
  target: PendingMetadata,
  field: K,
  previous: PendingMetadata | undefined,
): void {
  const value = previous?.[field]
  if (value === undefined) delete target[field]
  else target[field] = value
}

/** Whether anything is still owed to the server. An empty configuration map owes nothing. */
export function hasPendingMetadata(pending: PendingMetadata | undefined): boolean {
  if (!pending) return false

  return Object.entries(pending).some(([, value]) => {
    if (value === undefined) return false
    if (value !== null && typeof value === 'object') return Object.keys(value).length > 0
    return true
  })
}

/**
 * Put the fields a failed write attempted back to what they were, and leave the rest alone.
 *
 * Returns `undefined` when nothing is left pending, which is the signal that the file is no longer
 * waiting on a check-in and its diff status should go back to whatever the rollback recorded.
 */
export function revertPendingEdit(
  current: PendingMetadata | undefined,
  rollback: PendingMetadataRollback,
): PendingMetadata | undefined {
  if (rollback.fields.length === 0) return current

  const restored: PendingMetadata = { ...(current ?? {}) }
  for (const field of rollback.fields) restoreField(restored, field, rollback.previous)

  return hasPendingMetadata(restored) ? restored : undefined
}
