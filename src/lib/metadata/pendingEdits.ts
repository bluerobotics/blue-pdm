/**
 * Recording a datacard edit as pending.
 *
 * `updatePendingMetadata` used to copy the edited fields into `pdmData` as well, so the edit read
 * back as though the server already held it. That made it impossible to tell a requested value apart
 * from a confirmed one. The copy is gone; this module is the other half of its removal.
 *
 * For one release the removal came with a price. `pendingMetadata` was the only place the attempted
 * value existed and check-in promoted whatever it found there, so a value left behind by a failed
 * write would reach the database as though the file had accepted it. The only defence available then
 * was to revert the edit, which threw away what the user had typed - data loss chosen over
 * divergence because nothing could express "this value is real but it is not in the file".
 *
 * `writeState.ts` expresses exactly that, so the revert is gone: an edit is now recorded once, kept,
 * and marked. What remains here is the fold of an edit into the pending set and the question of
 * whether anything is still owed to the server.
 *
 * Pure: no I/O, no store access, no React. The slice supplies the current state and applies what
 * comes back.
 */

import type { PendingMetadata, PendingMetadataEdit } from '@/stores/types'

/** The fields an edit can name. */
export type PendingMetadataField = keyof PendingMetadata

/**
 * What a metadata write did, per the write path's own reckoning.
 *
 * `verified` and `unverified` are separate because a read-back that confirms the value is a
 * different fact from a service call that returned without error, and the plan is explicit that no
 * layer may collapse them. `partial` says the outcome differs between configurations and the
 * per-address record is the only place the detail lives.
 */
export type MetadataWriteOutcome =
  /** Written and read back, and the file agrees. */
  | 'verified'
  /** The service reported success but the value could not be read back to confirm it. */
  | 'unverified'
  /** Outcomes differ across the addresses the write attempted; consult the per-address record. */
  | 'partial'
  /** Nothing was written, and the service said so. */
  | 'failed'
  /** The write could not be started - no service, no response - so nothing was written. */
  | 'unattempted'
  /** This file has no property write at all; `pendingMetadata` is the only record of the edit. */
  | 'not-applicable'

/** The edited pending set, plus the token a caller passes to the write it is about to issue. */
export interface PendingEdit {
  pending: PendingMetadata
  edit: PendingMetadataEdit
}

/** An edit token that names nothing, for the paths that record no edit. */
export function noPendingEdit(path: string): PendingMetadataEdit {
  return { path, fields: [], pending: {} }
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
    edit: {
      path,
      fields: Object.keys(edit) as PendingMetadataField[],
      pending,
    },
  }
}

/**
 * An edit token for retrying a write that never landed, naming everything still pending.
 *
 * A retry is not a new edit - nothing about the value changes - but the write path needs a token to
 * report against, and it has to cover every field, since the point of a retry is that the user does
 * not have to remember which of them failed.
 */
export function retryEdit(
  path: string,
  pending: PendingMetadata | undefined,
): PendingMetadataEdit {
  const set = pending ?? {}
  return {
    path,
    fields: (Object.keys(set) as PendingMetadataField[]).filter((field) => set[field] !== undefined),
    pending: set,
  }
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
