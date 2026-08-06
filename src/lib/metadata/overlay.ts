/**
 * The one rule for reading a metadata field that has both a committed value and a pending edit.
 *
 * `pdmData` is what the server said. `pendingMetadata` is what the user asked for. Every layer that
 * displays, exports, copies or writes one of these fields has to decide between them, and before
 * this module each layer decided for itself - five different ways, three of them with the
 * precedence backwards. They agreed only because `updatePendingMetadata` also copied the pending
 * value into `pdmData`, which made every variant return the same string. Remove that copy and the
 * disagreements become visible, so the rule has to be shared before the copy can go.
 *
 * The rule: **presence decides, not truthiness.** A key that exists in `pendingMetadata` is an edit,
 * including an edit to nothing. `''` and `null` mean the user cleared the field, which is a
 * different intention from never having set it, and `||` collapses the two. That is the case every
 * variant below got wrong in a different way, so it is the case this module is built around.
 *
 * This module is pure: no I/O, no store access, no React, no imports that can reach Supabase or
 * SolidWorks. That is what lets command handlers, selectors and components all call it.
 */

import { mergeConfigurationMap, readConfigurationMap } from './configurationMaps'
import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import type { PendingMetadata } from '@/stores/types'
import type { PDMFile } from '@/types/pdm'

// ============================================
// Vocabulary
// ============================================

/**
 * Which side supplied the resolved value.
 *
 * `'pending'` with a `null` value is the case that has no vocabulary anywhere else in the codebase:
 * the user deliberately cleared the field. `'absent'` is the field nobody ever set. They render the
 * same and they mean different things, so the distinction is carried here rather than in the value.
 */
export type MetadataFieldSource = 'pending' | 'committed' | 'absent'

/** One field, resolved. `value` is `null` whenever there is nothing to show, never `''`. */
export interface ResolvedMetadataField {
  value: string | null
  source: MetadataFieldSource
}

/** The three file-scope fields, resolved together. */
export interface ResolvedFileMetadata {
  partNumber: ResolvedMetadataField
  description: ResolvedMetadataField
  revision: ResolvedMetadataField
}

/**
 * Anything carrying both sides of the overlay. `LocalFile` satisfies this structurally, so call
 * sites pass the file straight in, but so does a bare pair, which is what the tests use.
 */
export interface MetadataOverlaySource {
  pendingMetadata?: PendingMetadata
  pdmData?: PDMFile
}

/** A committed or pending scalar as the two sides actually type them. */
type OverlayInput = string | null | undefined

// ============================================
// The rule
// ============================================

/** `''` is not a value. Only the source distinguishes "cleared" from "never set". */
function present(value: OverlayInput): string | null {
  return value === undefined || value === null || value === '' ? null : value
}

/**
 * Choose between a pending edit and a committed value.
 *
 * `pending === undefined` is the only thing that means "no edit". A pending `''` or `null` is an
 * edit to nothing and wins over the committed value, which is the behaviour `??` and `||` both
 * fail to produce - `??` lets a clear to `null` fall through, `||` lets a clear to `''` fall
 * through, and both then show the user the value they just deleted.
 */
export function resolveMetadataField(
  pending: OverlayInput,
  committed: OverlayInput,
): ResolvedMetadataField {
  if (pending !== undefined) return { value: present(pending), source: 'pending' }

  const value = present(committed)
  return { value, source: value === null ? 'absent' : 'committed' }
}

/** The resolved value as a string, for the many call sites that want one. */
export function resolvedText(field: ResolvedMetadataField, placeholder = ''): string {
  return field.value ?? placeholder
}

// ============================================
// File-scope fields
// ============================================

export function resolvePartNumber(source: MetadataOverlaySource): ResolvedMetadataField {
  return resolveMetadataField(source.pendingMetadata?.part_number, source.pdmData?.part_number)
}

export function resolveDescription(source: MetadataOverlaySource): ResolvedMetadataField {
  return resolveMetadataField(source.pendingMetadata?.description, source.pdmData?.description)
}

export function resolveRevision(source: MetadataOverlaySource): ResolvedMetadataField {
  return resolveMetadataField(source.pendingMetadata?.revision, source.pdmData?.revision)
}

export function resolveFileMetadata(source: MetadataOverlaySource): ResolvedFileMetadata {
  return {
    partNumber: resolvePartNumber(source),
    description: resolveDescription(source),
    revision: resolveRevision(source),
  }
}

/**
 * The file-level tab number, which is pending-only.
 *
 * There is no server column for it - see `dropCommittedPendingMetadata` - so it resolves against
 * nothing. It goes through the same rule anyway so that call sites do not have to remember which
 * fields have a committed side and which do not.
 */
export function resolveTabNumber(source: MetadataOverlaySource): ResolvedMetadataField {
  return resolveMetadataField(source.pendingMetadata?.tab_number, undefined)
}

// ============================================
// Configuration-scope maps
// ============================================

/**
 * Overlay the edited configurations onto the committed ones.
 *
 * A pending map is a *partial* overlay - the store merges a new edit into the prior pending edits,
 * never into the committed values - so it names only the configurations the user touched. Choosing
 * it over the committed map, rather than merging into it, describes a file whose only
 * configurations are the edited ones. That is the same mistake `checkin_file` used to make with
 * `jsonb ||`, and `mergeConfigurationMap` is the fix that was written for it.
 */
export function resolveConfigurationTabs(source: MetadataOverlaySource): Record<string, string> {
  return mergeConfigurationMap(
    readConfigurationMap(source.pdmData?.custom_properties, CONFIG_TABS_KEY),
    source.pendingMetadata?.config_tabs,
  )
}

export function resolveConfigurationDescriptions(
  source: MetadataOverlaySource,
): Record<string, string> {
  return mergeConfigurationMap(
    readConfigurationMap(source.pdmData?.custom_properties, CONFIG_DESCRIPTIONS_KEY),
    source.pendingMetadata?.config_descriptions,
  )
}

/** One configuration's tab number, resolved through the same presence rule as a scalar field. */
export function resolveConfigurationTab(
  source: MetadataOverlaySource,
  configuration: string,
): ResolvedMetadataField {
  return resolveMetadataField(
    source.pendingMetadata?.config_tabs?.[configuration],
    readConfigurationMap(source.pdmData?.custom_properties, CONFIG_TABS_KEY)[configuration],
  )
}

/** One configuration's description, resolved through the same presence rule as a scalar field. */
export function resolveConfigurationDescription(
  source: MetadataOverlaySource,
  configuration: string,
): ResolvedMetadataField {
  return resolveMetadataField(
    source.pendingMetadata?.config_descriptions?.[configuration],
    readConfigurationMap(source.pdmData?.custom_properties, CONFIG_DESCRIPTIONS_KEY)[configuration],
  )
}
