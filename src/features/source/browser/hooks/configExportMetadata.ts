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
  const tabNumber = resolveConfigurationTab(file, configuration).value || loaded?.tabNumber || ''
  const description =
    resolveConfigurationDescription(file, configuration).value ||
    loaded?.description ||
    resolvedText(resolveDescription(file))

  const baseNumber = resolvedText(resolvePartNumber(file))

  return {
    partNumber: await fullItemNumber(baseNumber, tabNumber, organizationId),
    tabNumber,
    revision: resolvedText(resolveRevision(file)),
    description,
  }
}
