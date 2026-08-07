/**
 * The metadata a configuration export carries into its filename and its title block.
 *
 * Split out of `useConfigHandlers`, which is past the size at which the workspace rules require a
 * split before new functionality lands.
 *
 * Every field goes through the overlay. The exported file leaves the building - it is attached to a
 * quote, sent to a vendor, dropped into a folder someone else reads - so a value that is one edit
 * out of date here is one that arrives wrong somewhere BluePLM cannot correct it. Revision used to
 * be read straight off the committed row while the number and description beside it went through
 * the overlay, which meant bumping a revision to C and exporting before check-in produced a file
 * named for revision B.
 */

import { log } from '@/lib/logger'
import {
  resolveConfigurationDescription,
  resolveConfigurationTab,
  resolveDescription,
  resolvePartNumber,
  resolveRevision,
  resolvedText,
  type ResolvedMetadataField,
} from '@/lib/metadata/overlay'
import { combineBaseAndTab, getSerializationSettings } from '@/lib/serialization'
import type { LocalFile } from '@/stores/pdmStore'

/** What the SolidWorks service substitutes into an export's filename pattern. */
export interface ExportPdmMetadata {
  /** The full configuration-specific item number: base plus tab. */
  partNumber: string
  tabNumber: string
  revision: string
  description: string
}

export interface ConfigurationExportMetadataInput {
  file: LocalFile | undefined
  configuration: string
  /** The configuration as the tree loaded it, for the tab and description read out of the file. */
  loaded?: { tabNumber?: string; description?: string }
  organizationId?: string
}

/**
 * What BluePLM says about a field, or `undefined` when it has nothing to say.
 *
 * A cleared field comes back as `''` - an answer - while a field neither side ever set comes back
 * as `undefined`, which is what lets a caller fall through to the document for the second without
 * falling through for the first.
 */
function decided(field: ResolvedMetadataField): string | undefined {
  return field.source === 'absent' ? undefined : (field.value ?? '')
}

/**
 * Combine the base number with a configuration's tab, using the organisation's separator rules.
 *
 * Falls back to a plain dash when the settings cannot be read, which is what the export filename
 * has always done rather than dropping the tab and naming two configurations the same thing.
 */
async function fullItemNumber(
  baseNumber: string,
  tabNumber: string,
  organizationId: string | undefined,
): Promise<string> {
  if (!tabNumber || !organizationId) return baseNumber

  try {
    const settings = await getSerializationSettings(organizationId)
    if (settings?.tab_enabled) return combineBaseAndTab(baseNumber, tabNumber, settings)
  } catch (error) {
    log.debug('[Export]', 'Failed to get serialization settings, using simple concatenation', {
      error,
    })
  }

  return baseNumber ? `${baseNumber}-${tabNumber}` : baseNumber
}

export async function buildConfigurationExportMetadata(
  input: ConfigurationExportMetadataInput,
): Promise<ExportPdmMetadata> {
  const { file, configuration, loaded, organizationId } = input

  if (!file) return { partNumber: '', tabNumber: '', revision: '', description: '' }

  // The overlay first, then whatever the configuration tree read out of the document.
  //
  // `decided`, not `||`. `.value` is null for a field the user cleared and for one nobody ever set,
  // so a truthiness chain reads a deletion as an absence and falls through to the document - and
  // the export then leaves the building carrying the value the user had just removed, in its
  // filename and in its title block. `.source` is the only place the two are distinguishable.
  const tabNumber = decided(resolveConfigurationTab(file, configuration)) ?? loaded?.tabNumber ?? ''
  const description =
    decided(resolveConfigurationDescription(file, configuration)) ??
    loaded?.description ??
    resolvedText(resolveDescription(file))

  const baseNumber = resolvedText(resolvePartNumber(file))

  return {
    partNumber: await fullItemNumber(baseNumber, tabNumber, organizationId),
    tabNumber,
    revision: resolvedText(resolveRevision(file)),
    description,
  }
}
