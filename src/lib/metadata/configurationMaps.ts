/**
 * The reserved per-configuration maps under `files.custom_properties`, and the one rule for
 * turning a partial edit into a payload that cannot express itself as a total replacement.
 *
 * `pendingMetadata.config_tabs` holds only the configurations the user actually edited - the store
 * merges a new edit into the prior *pending* edits, never into the committed values - so sending it
 * as-is describes a file with one configuration. Nothing downstream can tell that apart from a file
 * that genuinely has one. `checkin_file` now merges entry by entry rather than replacing the map,
 * which fixes it at the server; sending the complete map fixes it at the source, and the two
 * together mean a new client against an old database is safe as well.
 *
 * This module is pure: no I/O, no store access, no imports that can reach Supabase or SolidWorks.
 */

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from './divergence'
import type { PendingMetadata } from '@/stores/types'

/**
 * The two configuration maps as they travel to `checkin_file` under `p_custom_properties`.
 *
 * A type alias rather than an interface because the generated RPC signature takes `Json`, and only
 * an alias gets the implicit index signature that makes it assignable to one.
 */
export type ConfigurationMapPayload = {
  _config_tabs?: Record<string, string>
  _config_descriptions?: Record<string, string>
}

/**
 * Read one reserved map out of a row's `custom_properties`.
 *
 * Anything that is not an object of scalars is treated as absent rather than coerced: the map is
 * written by this application, and a shape it does not recognise is not something it should try to
 * merge into.
 */
export function readConfigurationMap(
  customProperties: unknown,
  key: string,
): Record<string, string> {
  if (typeof customProperties !== 'object' || customProperties === null) return {}
  const raw = (customProperties as Record<string, unknown>)[key]
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}

  const map: Record<string, string> = {}
  for (const [configuration, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') map[configuration] = value
    else if (typeof value === 'number') map[configuration] = String(value)
  }
  return map
}

/**
 * Overlay the edited configurations onto the committed ones.
 *
 * An empty string is kept rather than dropped: the user clearing a configuration's tab is an edit,
 * and it has to reach the server as one. Deleting the entry outright is a different intent, and the
 * RPC spells it `null`; nothing in the client asks for it yet.
 */
export function mergeConfigurationMap(
  committed: Readonly<Record<string, string>>,
  pending: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return { ...committed, ...(pending ?? {}) }
}

/**
 * Build the `custom_properties` patch for a check-in from the file's complete configuration state.
 *
 * Returns `null` when the user edited no configuration, so a file with only file-level edits still
 * sends no `p_custom_properties` and still takes the same path it always did. A map is included
 * only when that map was edited: sending `_config_descriptions` because `_config_tabs` changed
 * would widen the write for no reason.
 */
export function buildConfigurationMapPayload(
  committedCustomProperties: unknown,
  pending: Pick<PendingMetadata, 'config_tabs' | 'config_descriptions'> | undefined,
): ConfigurationMapPayload | null {
  const pendingTabs = pending?.config_tabs
  const pendingDescriptions = pending?.config_descriptions

  const tabsEdited = pendingTabs !== undefined && Object.keys(pendingTabs).length > 0
  const descriptionsEdited =
    pendingDescriptions !== undefined && Object.keys(pendingDescriptions).length > 0

  if (!tabsEdited && !descriptionsEdited) return null

  const payload: ConfigurationMapPayload = {}

  if (tabsEdited) {
    payload._config_tabs = mergeConfigurationMap(
      readConfigurationMap(committedCustomProperties, CONFIG_TABS_KEY),
      pendingTabs,
    )
  }
  if (descriptionsEdited) {
    payload._config_descriptions = mergeConfigurationMap(
      readConfigurationMap(committedCustomProperties, CONFIG_DESCRIPTIONS_KEY),
      pendingDescriptions,
    )
  }

  return payload
}
