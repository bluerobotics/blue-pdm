// Pending metadata is the set of datacard edits that exist locally but are not yet
// committed to the server, and any non-empty set forces a file to render as modified
// (see the finalDiffStatus branch in useLoadFiles).
//
// That makes a pending value equal to the committed value actively harmful: it marks a
// file as needing check-in forever without a single byte differing. Reading properties
// back out of a SolidWorks file produces exactly that whenever the file already agrees
// with the database, so every read has to be reconciled against the committed values
// before it is stored.

import type { PendingMetadata } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

/**
 * Committed per-configuration maps, which live under reserved keys in the file's
 * `custom_properties` JSONB rather than as columns.
 */
const CONFIG_TABS_KEY = '_config_tabs'
const CONFIG_DESCRIPTIONS_KEY = '_config_descriptions'

function getCommittedConfigMap(
  pdmData: PDMFile | undefined,
  key: string,
): Record<string, string> | undefined {
  const customProperties = pdmData?.custom_properties as Record<string, unknown> | undefined
  return customProperties?.[key] as Record<string, string> | undefined
}

/** Treats null, undefined and '' as the same absent value, the way the datacard does. */
function isSameValue(pending: string | null | undefined, committed: string | null | undefined) {
  return (pending ?? '') === (committed ?? '')
}

function sameConfigMap(
  pending: Record<string, string>,
  committed: Record<string, string> | undefined,
): boolean {
  // Only the keys actually being set matter: a pending map is a partial overlay, so
  // configurations it does not mention are not a difference.
  return Object.entries(pending).every(([config, value]) =>
    isSameValue(value, committed?.[config]),
  )
}

/**
 * Strips fields that already match what is committed on the server.
 *
 * Returns `undefined` when nothing is left, which callers use as the signal that there is
 * no real edit to record.
 *
 * `tab_number` is passed through untouched: it has no server column, so there is no
 * committed value to compare it against and it can only ever be pending.
 */
export function dropCommittedPendingMetadata(
  pending: PendingMetadata | undefined,
  pdmData: PDMFile | undefined,
): PendingMetadata | undefined {
  if (!pending) return undefined

  // Without server data nothing can be shown to be committed, so the edit stands as-is.
  if (!pdmData) return Object.keys(pending).length > 0 ? pending : undefined

  const result: PendingMetadata = {}

  if (pending.part_number !== undefined && !isSameValue(pending.part_number, pdmData.part_number)) {
    result.part_number = pending.part_number
  }
  if (pending.description !== undefined && !isSameValue(pending.description, pdmData.description)) {
    result.description = pending.description
  }
  if (pending.revision !== undefined && !isSameValue(pending.revision, pdmData.revision)) {
    result.revision = pending.revision
  }
  if (pending.tab_number !== undefined) {
    result.tab_number = pending.tab_number
  }
  if (
    pending.config_tabs &&
    Object.keys(pending.config_tabs).length > 0 &&
    !sameConfigMap(pending.config_tabs, getCommittedConfigMap(pdmData, CONFIG_TABS_KEY))
  ) {
    result.config_tabs = pending.config_tabs
  }
  if (
    pending.config_descriptions &&
    Object.keys(pending.config_descriptions).length > 0 &&
    !sameConfigMap(
      pending.config_descriptions,
      getCommittedConfigMap(pdmData, CONFIG_DESCRIPTIONS_KEY),
    )
  ) {
    result.config_descriptions = pending.config_descriptions
  }

  return Object.keys(result).length > 0 ? result : undefined
}
